import { randomUUID } from "node:crypto";
import type { CollectionPlan } from "@workspace/api-zod";
import { BusinessError, now, type DemoState } from "./model";
import { audit, decide, findPlan } from "./service";

export function approveCustomerDispatch(state: DemoState, sourceId: string, customerId: string, expectedVersion: number): CollectionPlan {
  const source = findPlan(state, sourceId);
  if (source.dispatchSourcePlanId || !source.scoringSnapshot)
    throw new BusinessError("Select a current split-queue review plan.", 409);
  const existing = state.plans.find(batch => batch.dispatchCustomerId === customerId &&
    state.plans.find(parent => parent.id === batch.dispatchSourcePlanId)?.familyId === source.familyId);
  if (existing) {
    audit(state, "Customer approval reused", "An immutable customer batch already exists for this source family. No duplicate batch or send was created.",
      customerId, sourceId, existing.id, existing, { result: "Success" });
    return existing;
  }
  if (source.status !== "Pending" || source.version !== expectedVersion)
    throw new BusinessError("The review plan changed. Reload before approving this customer.", 409);
  if (state.plans.some(parent => parent.familyId === source.familyId && !parent.dispatchSourcePlanId &&
    (state.smtpDispatches?.[parent.id] || state.executions.some(row => row.planId === parent.id))))
    throw new BusinessError("A whole-plan execution already exists. Reconcile it before approving individual customers.", 409);
  const tasks = source.tasks.filter(task => task.customerId === customerId);
  const reviews = (source.customerReviews ?? []).filter(review => review.customerId === customerId);
  if (!tasks.length || reviews.length !== 1 || !reviews[0]!.reason.trim() || tasks.some(task => !task.noticeVariants))
    throw new BusinessError("Save this customer's decision and both bilingual notice variants before approval.", 409);
  if (state.noticeGenerationJobs?.[`${source.id}:${customerId}`])
    throw new BusinessError("This customer's notices are still generating. Wait before approving.", 409);
  const batchId = `PLN-${randomUUID().slice(0, 8)}`;
  const batch: CollectionPlan = {
    ...structuredClone(source), id: batchId, familyId: batchId, version: 1, createdAt: now(),
    status: "Pending", dispatchSourcePlanId: source.id, dispatchCustomerId: customerId,
    tasks: structuredClone(tasks), customerReviews: structuredClone(reviews), manualMerge: undefined,
    notes: `Customer-only approval from ${source.id} v${source.version}. ${reviews[0]!.reason}`,
  };
  state.plans.push(batch);
  const approved = decide(state, batch.id, { decision: "approve", notes: batch.notes });
  audit(state, "Customer dispatch approved", "Approved only this customer's frozen tasks and bilingual messages. Other customers remain unapproved; no email has been sent.",
    customerId, source.id, approved.id, approved, { result: "Success" });
  return approved;
}
