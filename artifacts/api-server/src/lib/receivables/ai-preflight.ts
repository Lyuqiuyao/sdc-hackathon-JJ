import type { CollectionPlan } from "@workspace/api-zod";
import { signature } from "./compute";
import { today, type DemoState } from "./model";

export class AdviceBoundaryError extends Error {
  constructor(public readonly reasonCode: string) { super(reasonCode); }
}
const fail = (reason: string): never => { throw new AdviceBoundaryError(reason); };
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

// Pure validation only: no repository, network, data mutation or rescoring.
export function assertAdviceInput(state: DemoState, plan: CollectionPlan) {
  if (!state.plans.some(p => p.id === plan.id && p.familyId === plan.familyId && p.version === plan.version))
    fail("missing_plan");
  if (plan.status !== "Pending") fail("plan_not_pending");
  if (state.plans.some(p => p.familyId === plan.familyId && p.version > plan.version))
    fail("plan_superseded");
  if (state.auditLogs.some(a => a.type === "Manual adjustment" && a.planVersion === `${plan.id} v${plan.version}`))
    fail("human_modified");
  if (!plan.tasks.length) fail("empty_tasks");
  if (plan.tasks.length > 50) fail("context_limit");
  if (new Set(plan.tasks.map(t => t.id)).size !== plan.tasks.length || plan.tasks.some(t => !t.id))
    fail("duplicate_task_id");
  if (new Set(plan.tasks.map(t => t.invoiceId)).size !== plan.tasks.length) fail("duplicate_invoice");
  const risk = state.riskEvents.find(r => r.id === plan.riskEventId);
  if (!risk) return fail("missing_risk");
  if (!risk.settingsSnapshot ||
    ![risk.dueCents, risk.overdueCents, risk.expectedCollectionCents, risk.projectedCashCents,
      risk.gapCents, risk.settingsSnapshot.cashCents, risk.settingsSnapshot.minimumCashCents,
      risk.settingsSnapshot.expectedExpenseCents].every(Number.isSafeInteger) ||
    !["Low", "Medium", "High"].includes(risk.level) ||
    !Object.values(plan.weights).every(w => Number.isInteger(w) && w >= 0 && w <= 100) ||
    plan.weights.lateFee + plan.weights.urgency + plan.weights.importance + plan.weights.esg !== 100)
    fail("invalid_business_data");
  for (const task of plan.tasks) {
    const invoice = state.invoices.find(i => i.id === task.invoiceId) ?? fail("missing_invoice");
    const customer = state.customers.find(c => c.id === task.customerId) ?? fail("missing_customer");
    if (invoice.customerId !== task.customerId || invoice.number !== task.invoiceNumber)
      fail("invalid_association");
    if (invoice.currency !== "MYR" ||
      ![invoice.totalCents, invoice.paidCents, invoice.lateFeeBps, task.outstandingCents].every(Number.isSafeInteger) ||
      invoice.totalCents <= 0 || invoice.paidCents < 0 || invoice.paidCents > invoice.totalCents ||
      invoice.lateFeeBps < 0 || invoice.lateFeeBps > 10000 ||
      task.outstandingCents <= 0 || task.outstandingCents !== invoice.totalCents - invoice.paidCents ||
      invoice.status === "Cancelled" || invoice.status === "Paid" ||
      !validDate(invoice.invoiceDate) || !validDate(invoice.dueDate) ||
      invoice.invoiceDate > invoice.dueDate || task.dueDate !== invoice.dueDate ||
      !Number.isInteger(task.rank) || task.rank !== plan.tasks.indexOf(task) + 1 ||
      ![task.score, task.lateFeeScore, task.urgencyScore, task.importanceScore, task.esgScore]
        .every(score => Number.isFinite(score) && score >= 0 && score <= 100) ||
      task.daysOverdue !== Math.max(0, Math.round((Date.parse(today()) - Date.parse(invoice.dueDate)) / 86400000)) ||
      !["High", "Medium", "Low"].includes(customer.importance))
      fail("invalid_business_data");
  }
  try {
    const current = signature(state);
    if (plan.dataSignature !== current || risk.dataSignature !== current) fail("stale_context");
  } catch (error) {
    if (error instanceof AdviceBoundaryError) throw error;
    fail("invalid_business_data");
  }
  return risk;
}
