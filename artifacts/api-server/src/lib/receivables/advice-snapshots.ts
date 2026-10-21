import { randomUUID } from "node:crypto";
import type { AdviceSnapshot, CollectionPlan } from "@workspace/api-zod";
import { BusinessError, DEMO_WORKSPACE_ID, type DemoState } from "./model";
import type { AdvisorResult } from "./ai-provider";
import { communication } from "./communication";
import { sanitizeDiagnostics } from "./ai-diagnostics";

// No raw model response/exception retention. These known credential forms are
// also redacted from otherwise allowlisted human and validated prose.
function redact(value: unknown): unknown {
  if (typeof value === "string") return value
    .replace(/https?:\/\/[^\s/"<>]+:[^\s/@<>]+@[^\s"'<>]+/gi, "[REDACTED_CREDENTIAL_URL]")
    .replace(/\b(?:sk-[\w-]+|AIza[\w-]+|Bearer\s+[^\s"'<>]+)\b/gi, "[REDACTED]")
    .replace(/\b(?:authorization|api[-_ ]?key|OPENAI_API_KEY|GEMINI_API_KEY|AI_INTEGRATIONS_OPENAI_API_KEY|password|secret)\s*[:=]\s*[^\r\n"'<>]+/gi, "[REDACTED]");
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key, /authorization|api.?key|password|secret|access.?token/i.test(key) ? "[REDACTED]" : redact(child),
    ]),
  );
  return value;
}
export function assertSnapshotsAppendOnly(before: readonly AdviceSnapshot[], after: readonly AdviceSnapshot[]) {
  if (after.length < before.length || before.some((s, i) => JSON.stringify(s) !== JSON.stringify(after[i])))
    throw new BusinessError("Advice snapshots are append-only.", 409);
  if (new Set(after.map(s => s.id)).size !== after.length)
    throw new BusinessError("Duplicate snapshot identifier.", 409);
}
export function listAdviceSnapshots(state: DemoState, planId: string) {
  if (!state.plans.some(p => p.id === planId)) throw new BusinessError("Snapshot plan association not found.", 404);
  return structuredClone((state.adviceSnapshots ?? []).filter(s => s.planId === planId));
}
export function appendPlanSnapshot(state: DemoState, plan: CollectionPlan, input: {
  status: AdviceSnapshot["status"]; reasonCode: string; attemptId?: string;
  provider?: AdviceSnapshot["provider"]; source?: AdviceSnapshot["source"];
  validation?: AdviceSnapshot["validation"]; previousPlanId?: string; approvalId?: string;
  result?: AdvisorResult; metadataOnly?: boolean; createdAtMs?: number;
}) {
  if (!state.plans.some(p => p.id === plan.id && p.version === plan.version) ||
    !state.riskEvents.some(r => r.id === plan.riskEventId))
    throw new BusinessError("Snapshot association not found.", 409);
  const entries = state.adviceSnapshots ?? [];
  const familyIds = new Set(state.plans.filter(p => p.familyId === plan.familyId).map(p => p.id));
  const previous = [...entries].reverse().find(s => familyIds.has(s.planId));
  const finalNotices = plan.tasks.map(t => ({
    taskId: t.id, noticeEn: t.noticeEn, noticeMs: t.noticeMs,
    noticeEnSource: t.noticeEnSource ?? "rules_fallback", noticeMsSource: t.noticeMsSource ?? "rules_fallback",
  }));
  const content = {
    rawModel: { retained: false, reason: "No raw-text retention: no production identity/access-control or raw-text retention policy." },
    ...(!input.metadataOnly ? {
      validatedModelSummary: input.result?.validatedModelSummary ?? null,
      effectiveAdvice: input.result?.advice ?? null,
      controlledTemplates: {
        policy: plan.aiGeneration?.contentPolicy ?? "rules_template",
        riskExplanation: plan.aiGeneration?.contentPolicy === "server_controlled_v1" &&
          plan.tasks.some(t => t.aiAdvice?.esgEvidence === "unknown") ? plan.aiRiskExplanation : null,
        tasks: plan.tasks.map(t => ({
          taskId: t.id, esgConsiderations: t.aiAdvice?.esgConsiderations ?? t.esgNote,
          unknownEsgTaskProjection: t.aiAdvice?.esgEvidence === "unknown" ? t.aiAdvice : null,
          noticeEn: communication(t, t.method).noticeEn, noticeMs: communication(t, t.method).noticeMs,
        })),
      },
      finalNotices,
      humanVersion: input.status === "edited" ? {
        planId: plan.id, version: plan.version, previousPlanId: input.previousPlanId, finalNotices,
      } : null,
      planAtEvent: { status: plan.status, weights: plan.weights, scoringSnapshot: plan.scoringSnapshot,
        customerReviews: plan.customerReviews, manualMerge: plan.manualMerge, tasks: plan.tasks,
        aiRiskExplanation: plan.aiRiskExplanation, providerMode: plan.providerMode, aiGeneration: plan.aiGeneration },
      approval: input.approvalId ? state.approvals.filter(a => a.id === input.approvalId).map(a => ({
        id: a.id, planId: a.planId, version: a.version, decision: a.decision, createdAt: a.createdAt, actor: a.actor,
      }))[0] : null,
    } : {}),
  };
  const snapshot: AdviceSnapshot = {
    id: `SNP-${randomUUID()}`, workspaceId: state.workspaceId ?? DEMO_WORKSPACE_ID,
    planId: plan.id, riskEventId: plan.riskEventId, planVersion: plan.version,
    attemptId: input.attemptId ?? `EVT-${randomUUID()}`,
    createdAt: new Date(input.createdAtMs ?? Date.now()).toISOString(),
    provider: input.provider ?? plan.providerMode ?? "rules_fallback",
    source: input.source ?? (input.metadataOnly ? "metadata_only" : "rules_template"),
    status: input.status, reasonCode: /^[a-z_]{1,80}$/.test(input.reasonCode) ? input.reasonCode : "unclassified",
    contentPolicy: plan.aiGeneration?.contentPolicy ?? "rules_template",
    validation: input.validation ?? "not_run",
    rawResponseRetained: false,
    ...(input.result?.generation.model && input.result.generation.connectionMode === "replit_managed" ? {
      model: input.result.generation.model, modelOrigin: "request_config" as const,
    } : {}),
    ...(input.result?.generation.diagnostics ? {
      diagnostics: sanitizeDiagnostics(input.result.generation.diagnostics, plan),
    } : {}),
    ...(previous ? { previousSnapshotId: previous.id } : {}),
    ...(input.previousPlanId ? { previousPlanId: input.previousPlanId } : {}),
    ...(input.approvalId ? { approvalId: input.approvalId } : {}),
    contentJson: JSON.stringify(redact(content)),
  };
  state.adviceSnapshots = [...entries, Object.freeze(snapshot)];
  return snapshot;
}
