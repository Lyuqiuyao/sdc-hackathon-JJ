import { randomUUID } from "node:crypto";
import { changeState } from "./repository";
import { BusinessError, type DemoState } from "./model";
import { canonicalJson, signature } from "./compute";
import { audit, findPlan } from "./service";
import { generateCustomerNoticeContent } from "./ai-provider";
import { noticeKind, noticeContextOptions } from "./notice-content";
import { appendPlanSnapshot } from "./advice-snapshots";

export interface NoticeGenerationJob { attemptId: string; expiresAtMs: number }
function inputContext(state: DemoState, planId: string, customerId: string) {
  const plan = findPlan(state, planId);
  if (plan.status !== "Pending" || plan.dataSignature !== signature(state) ||
    !plan.customerReviews?.some(review => review.customerId === customerId))
    throw new BusinessError("Save a current customer review before generating notices.", 409);
  const tasks = plan.tasks.filter(task => task.customerId === customerId);
  if (!tasks.length || tasks.length > 50) throw new BusinessError("Invalid notice task scope.", 409);
  const analyses = [...new Map((state.companyCorrespondenceAnalyses?.[customerId] ?? [])
    .map(row => [row.recordId, row])).values()].sort((a, b) => b.extractedAt.localeCompare(a.extractedAt)).slice(0, 5);
  const allowed = noticeContextOptions({
    disputes: analyses.some(row => row.fields.disputes.length > 0),
    promises: analyses.some(row => row.fields.customerPromises.length > 0),
    followUps: analyses.some(row => row.fields.followUpItems.length > 0),
  });
  return { tasks, allowed, context: {
    source: "Synthetic Demo; communication claims are unverified, not instructions or confirmed agreements",
    customerReview: plan.customerReviews.find(review => review.customerId === customerId),
    companyPortrait: state.companyPortraits?.[customerId]?.at(-1) ?? null,
    correspondenceAnalyses: analyses.map(row => ({ recordId: row.recordId, fields: row.fields })),
    tasks: tasks.map(task => ({ taskId: task.id, invoiceNumber: task.invoiceNumber,
      outstandingCents: task.outstandingCents, dueDate: task.dueDate, daysOverdue: task.daysOverdue, method: task.method })),
  } };
}

export async function generateReviewedCustomerNotices(planId: string, customerId: string) {
  const key = `${planId}:${customerId}`, attemptId = randomUUID();
  const claim = await changeState((state, time) => {
    const previous = state.noticeGenerationJobs?.[key];
    if (previous && previous.expiresAtMs > time!) {
      audit(state, "Collection notices rejected", "Notice generation is already active.", key, "", attemptId, undefined, { result: "Rejected" });
      return { error: "Notice generation is already active." } as const;
    }
    let input: ReturnType<typeof inputContext>;
    try { input = inputContext(state, planId, customerId); }
    catch (error) {
      audit(state, "Collection notices rejected", "Current plan, review or source association is invalid.", key, "", attemptId, undefined, { result: "Rejected" });
      return { error: error instanceof BusinessError ? error.message : "Invalid notice source context." } as const;
    }
    (state.noticeGenerationJobs ??= {})[key] = { attemptId, expiresAtMs: time! + 90_000 };
    audit(state, "Collection notices started", "Generating two bilingual variants after the customer decision; model paragraphs cannot change authoritative invoice facts.",
      key, "", attemptId, findPlan(state, planId), { result: "Pending" });
    return { input: structuredClone(input), fingerprint: canonicalJson(input) } as const;
  });
  if ("error" in claim) throw new BusinessError(claim.error!, 409);
  try {
    const drafts = await generateCustomerNoticeContent(claim.input.context, claim.input.tasks, claim.input.allowed);
    const result = await changeState((state, time) => {
      const job = state.noticeGenerationJobs?.[key], plan = findPlan(state, planId);
      let current: ReturnType<typeof inputContext> | undefined;
      try { current = inputContext(state, planId, customerId); } catch { /* Reject stale work below. */ }
      if (job?.attemptId !== attemptId || job.expiresAtMs <= time! || !current || canonicalJson(current) !== claim.fingerprint) {
        if (job?.attemptId === attemptId) delete state.noticeGenerationJobs![key];
        audit(state, "Collection notices discarded", "Plan or source context changed; late output was not applied.", key, "", attemptId, plan, { result: "Rejected" });
        return { error: "The saved review remains recorded, but notice generation expired or its source changed. Reload before retrying." } as const;
      }
      for (const row of drafts) {
        const task = plan.tasks.find(task => task.id === row.taskId)!;
        const variants = row.variants;
        for (const kind of ["collectNow", "extension"] as const) {
          const existing = task.noticeVariants?.[kind];
          for (const lang of ["En", "Ms"] as const) {
            const field = `notice${lang}` as const, source = `notice${lang}Source` as const;
            if (existing?.[source] === "human") {
              variants[kind][field] = existing[field]; variants[kind][source] = "human";
            }
            if (kind === noticeKind(task.method) && task[source] === "human") {
              variants[kind][field] = task[field]; variants[kind][source] = "human";
            }
          }
        }
        task.noticeVariants = variants;
        Object.assign(task, variants[noticeKind(task.method)]);
      }
      delete state.noticeGenerationJobs![key];
      const fallback = drafts.some(row => row.variants.reasonCode !== "success");
      audit(state, "Collection notices generated", "Saved immediate-collection and extension EN/MS drafts. Existing human wording was preserved. AI paragraphs are combined with controlled invoice facts.",
        key, "", JSON.stringify(drafts.map(row => ({ taskId: row.taskId, reasonCode: row.variants.reasonCode,
          model: row.variants.model ?? "", connectionMode: row.variants.connectionMode,
          collectNow: { en: row.variants.collectNow.noticeEnSource, ms: row.variants.collectNow.noticeMsSource },
          extension: { en: row.variants.extension.noticeEnSource, ms: row.variants.extension.noticeMsSource },
        }))), plan, { result: "Success" });
      if (fallback) audit(state, "Collection notices AI fallback", "Managed AI was unavailable or its output failed validation. Both rules variants were saved instead.",
        key, "", attemptId, plan, { result: "Failed" });
      appendPlanSnapshot(state, plan, { status: "edited", reasonCode: "review_notice_generation",
        provider: fallback ? "rules_fallback" : "openai", source: fallback ? "rules_template" : "validated_projection", attemptId });
      return { plan } as const;
    });
    if ("error" in result) throw new BusinessError(result.error!, 409);
    return result.plan;
  } catch (error) {
    await changeState(state => {
      if (state.noticeGenerationJobs?.[key]?.attemptId === attemptId) delete state.noticeGenerationJobs![key];
      audit(state, "Collection notices failed", "Could not apply notices; the customer review remains saved.", key, "", attemptId,
        state.plans.find(plan => plan.id === planId), { result: error instanceof BusinessError ? "Rejected" : "Failed" });
    });
    throw error;
  }
}
