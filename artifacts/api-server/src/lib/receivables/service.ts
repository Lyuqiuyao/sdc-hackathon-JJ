import { randomUUID } from "node:crypto";
import type {
  AuditLog, CollectionPlan, PlanInput, PlanEdit, ApprovalInput,
  SystemSetting, Workspace, ImportInput,
} from "@workspace/api-zod";
import { type DemoState, BusinessError, now, today, collectible } from "./model";
import { calculateRisk, customersNow, dashboard, invoicesNow, signature, validateWeights } from "./compute";
import { buildPlan, METHODS } from "./planner";
import { importCsv } from "./csv";
import { seedState } from "./seed";
import { rulesAdvisor } from "./ai-provider";

export function audit(state: DemoState, type: string, content: string, related = "",
  before = "", after = "", plan?: CollectionPlan) {
  const entry: AuditLog = {
    id: `LOG-${randomUUID().slice(0, 12)}`, type, createdAt: now(), actor: "Demo Admin",
    related, content, before, after, planVersion: plan ? `${plan.id} v${plan.version}` : "", result: "Success",
  };
  state.auditLogs.push(entry);
}

export function workspace(state: DemoState): Workspace {
  const invoices = invoicesNow(state);
  return {
    demo: true, today: today(), source: "Synthetic Demo Data · shared administrator sandbox",
    aiAvailable: false,
    aiMessage: "Gemini is not connected. This demo uses an explainable rules engine and editable EN/MS templates, not LLM output. The server-side provider interface is reserved for a future integration.",
    customers: customersNow(state, invoices), invoices,
    documents: state.documents.map(d => ({ ...d, status: d.validUntil < today() ? "Expired" : d.status })),
    riskEvents: [...state.riskEvents].reverse(), plans: [...state.plans].reverse(),
    approvals: [...state.approvals].reverse(), executions: [...state.executions].reverse(),
    auditLogs: [...state.auditLogs].reverse(), settings: state.settings, dashboard: dashboard(state),
  };
}

export function riskCheck(state: DemoState) {
  const event = calculateRisk(state, `RSK-${randomUUID().slice(0, 8)}`);
  state.riskEvents.push(event);
  audit(state, "Risk check", `Recalculated ${event.horizonDays}-day risk: ${event.level}. ${event.reasons.join(" ")}`,
    event.id, "", JSON.stringify(event));
  return event;
}

export function generate(state: DemoState, input: PlanInput) {
  if (state.settings.aiMode !== "rules") throw new BusinessError("Gemini is not connected. Switch to Rules-engine Demo.");
  const risk = input.riskEventId ? state.riskEvents.find(r => r.id === input.riskEventId) :
    state.riskEvents[state.riskEvents.length - 1] ?? riskCheck(state);
  if (!risk) throw new BusinessError("Risk event not found.", 404);
  const weights = input.weights ?? state.settings.weights;
  validateWeights(weights);
  const dataSignature = signature(state);
  const existing = state.plans.find(p => p.riskEventId === risk.id && p.status === "Pending" &&
    p.dataSignature === dataSignature && JSON.stringify(p.weights) === JSON.stringify(weights));
  if (existing) return existing;
  const plan = rulesAdvisor.createDraft(state, risk.id, weights);
  state.plans.push(plan);
  audit(state, "Plan generated", "Generated explainable four-factor rules-engine plan and bilingual notification templates; human approval required.",
    plan.tasks.map(t => `${t.invoiceNumber} ${t.customerName}`).join(", "), "", JSON.stringify(plan), plan);
  return plan;
}

function findPlan(state: DemoState, id: string) {
  const plan = state.plans.find(p => p.id === id);
  if (!plan) throw new BusinessError("Plan not found.", 404);
  return plan;
}

export function edit(state: DemoState, id: string, input: PlanEdit) {
  const original = findPlan(state, id);
  if (!["Pending", "Approved"].includes(original.status)) throw new BusinessError("This version is immutable. Select a current pending or approved version.", 409);
  const taskIds = new Set(original.tasks.map(t => t.id));
  if (input.tasks.length !== taskIds.size || new Set(input.tasks.map(t => t.id)).size !== taskIds.size ||
    input.tasks.some(t => !taskIds.has(t.id))) throw new BusinessError("Task edits must contain each original task exactly once.");
  if (input.tasks.some(t => !METHODS.includes(t.method))) throw new BusinessError("Unsupported collection method.");
  const before = JSON.stringify(original);
  const newId = `PLN-${randomUUID().slice(0, 8)}`;
  const plan: CollectionPlan = {
    ...structuredClone(original), id: newId, createdAt: now(), status: "Pending",
    version: Math.max(...state.plans.filter(p => p.familyId === original.familyId).map(p => p.version)) + 1,
    notes: input.notes,
    tasks: input.tasks.map((edited, n) => {
      const old = original.tasks.find(t => t.id === edited.id)!;
      // Keep recommended time slots ordered when human priority order changes.
      return { ...old, ...edited, id: `TSK-${randomUUID().slice(0, 8)}`, rank: n + 1,
        scheduledAt: original.tasks[n]!.scheduledAt, status: "Draft" };
    }),
  };
  original.status = "Superseded";
  state.plans.push(plan);
  audit(state, "Manual adjustment", "Human reordered tasks and/or edited methods and bilingual drafts. New version needs approval.",
    plan.tasks.map(t => `${t.invoiceNumber} ${t.customerName}`).join(", "), before, JSON.stringify(plan), plan);
  return plan;
}

function assertFresh(state: DemoState, plan: CollectionPlan) {
  if (plan.dataSignature !== signature(state)) throw new BusinessError(
    "Invoices, ESG validity, demo date or settings changed after this plan was generated. Defer & Recalculate to create a current version before approving/executing.", 409);
  const openIds = new Set(invoicesNow(state).filter(collectible).map(i => i.id));
  if (plan.tasks.some(t => !openIds.has(t.invoiceId))) throw new BusinessError("A task invoice is no longer collectible. Recalculate this plan.", 409);
}

export function decide(state: DemoState, id: string, input: ApprovalInput) {
  const plan = findPlan(state, id);
  if (plan.status !== "Pending") throw new BusinessError("Only pending plans can be approved, deferred or rejected.", 409);
  if (input.decision === "approve") assertFresh(state, plan);
  const before = JSON.stringify(plan);
  plan.status = input.decision === "approve" ? "Approved" : input.decision === "reject" ? "Rejected" : "Deferred";
  plan.notes = input.notes;
  if (input.decision === "approve") plan.tasks.forEach(t => { t.status = "Approved"; });
  state.approvals.push({
    id: `APR-${randomUUID().slice(0, 8)}`, planId: plan.id, version: plan.version,
    decision: input.decision, notes: input.notes, actor: "Demo Admin", createdAt: now(),
    originalSnapshot: before, finalSnapshot: JSON.stringify(plan),
  });
  audit(state, "Plan approval", `${input.decision}: ${input.notes || "No additional notes"}. No real notification or financial transaction.`,
    plan.tasks.map(t => `${t.invoiceNumber} ${t.customerName}`).join(", "), before, JSON.stringify(plan), plan);
  if (input.decision === "defer") {
    const next = buildPlan(state, plan.riskEventId, state.settings.weights, plan, true);
    next.notes = `Recalculated from ${plan.id} v${plan.version}. ${input.notes}`;
    state.plans.push(next);
    audit(state, "Plan generated", "Deferred plan recalculated from current data and current settings; communication shifted by two demo days; new approval required.",
      plan.id, before, JSON.stringify(next), next);
    return next;
  }
  return plan;
}

export function execute(state: DemoState, id: string) {
  const plan = findPlan(state, id);
  if (plan.status === "Executed") return plan;
  if (plan.status !== "Approved" || !state.approvals.some(a => a.planId === plan.id && a.decision === "approve")) {
    throw new BusinessError("Execution blocked: this exact plan version has not been approved by an administrator.", 409);
  }
  assertFresh(state, plan);
  const before = JSON.stringify(plan);
  for (const task of plan.tasks) {
    task.status = "Simulated complete";
    const record = { id: `EXE-${randomUUID().slice(0, 8)}`, planId: plan.id, taskId: task.id,
      invoiceNumber: task.invoiceNumber, customerName: task.customerName, actor: "Demo Admin",
      executedAt: now(), result: "Demo simulation complete — no real message sent and no money collected.",
      noticeStatus: "Simulated send · template only" };
    state.executions.push(record);
    audit(state, "Simulated execution", `Simulated task ${task.rank}: ${task.method}. Notice marked simulated only; invoice payment is unchanged.`,
      `${task.invoiceNumber} ${task.customerName}`, "Approved task", JSON.stringify(record), plan);
  }
  plan.status = "Executed";
  audit(state, "Simulated execution", "Approved plan completed in Demo simulation. No actual dispatch, debit, transfer or invoice settlement.",
    plan.id, before, JSON.stringify(plan), plan);
  return plan;
}

export function settings(state: DemoState, input: SystemSetting) {
  validateWeights(input.weights);
  if (input.aiMode === "gemini") {
    throw new BusinessError("Gemini is not connected in this demo. No valid server-side provider is enabled. Keep Rules-engine Demo to continue; no external AI request has been made.");
  }
  const before = JSON.stringify(state.settings);
  state.settings = input;
  audit(state, "Settings change", "Updated cash assumptions, risk thresholds, weights or notification preference. Existing plans retain their snapshots; stale plans must be recalculated.",
    "System settings", before, JSON.stringify(input));
  return input;
}

export function importData(state: DemoState, input: ImportInput) {
  const beforeCount = state.invoices.length;
  const result = importCsv(state, input);
  if (result.imported > 0) audit(state, "Data import", `${input.filename}: ${result.message} ${result.warnings.join(" ")}`,
    input.filename, `${beforeCount} invoices`, `${state.invoices.length} invoices`);
  return result;
}

export function documentView(state: DemoState, id: string) {
  const document = state.documents.find(d => d.id === id);
  if (!document) throw new BusinessError("Document not found.", 404);
  audit(state, "ESG document view", "Opened a clearly labelled synthetic ESG review record; NOT an official certification document.",
    `${document.customerName} ${document.number}`, "", document.status);
  return { title: `DEMO RECORD — ${document.type}`,
    content: [
      "SYNTHETIC DEMO RECORD — NOT AN OFFICIAL CERTIFICATE",
      "This text is a simulated review record for the competition demonstration. It is not issued by any certification authority and does not prove actual certification.",
      `Customer: ${document.customerName}`, `Certificate type: ${document.type}`, `Demo reference: ${document.number}`,
      `Uploaded: ${document.uploadedAt}`, `Valid until: ${document.validUntil}`,
      `Simulated reviewer status: ${document.validUntil < today() ? "Expired" : document.status}`,
      `Review conclusion: ${document.conclusion}`, `Review reason: ${document.reason}`,
      `Demo rating: ${document.rating}`, "ESG is auxiliary only. Missing ESG evidence is treated neutrally, never as fraud or default evidence.",
    ].join("\n\n") };
}

export function reset(state: DemoState, confirm: boolean) {
  if (!confirm) throw new BusinessError("Explicit reset confirmation required.");
  const audits = state.auditLogs;
  const previous = `${state.invoices.length} invoices; ${state.plans.length} plans`;
  // Preserve old versions and their approvals/executions, so prior audit links
  // remain resolvable. Pending and approved pre-reset plans are invalidated.
  const archivedPlans = state.plans.map(p => ({
    ...p, status: (p.status === "Pending" || p.status === "Approved") ? "Superseded" as const : p.status,
  }));
  const approvals = state.approvals, executions = state.executions, riskEvents = state.riskEvents;
  const fresh = seedState();
  fresh.riskEvents[0]!.id = `RSK-${randomUUID().slice(0, 8)}`;
  fresh.plans[0]!.riskEventId = fresh.riskEvents[0]!.id;
  Object.assign(state, fresh, {
    auditLogs: audits, plans: [...archivedPlans, ...fresh.plans],
    approvals, executions, riskEvents: [...riskEvents, ...fresh.riskEvents],
  });
  audit(state, "Demo reset", "Reset synthetic customers, invoices, ESG records and settings. Old plan versions, approvals, execution records and append-only audit history retained; old active plans superseded.",
    "Demo workspace", previous, "Fresh synthetic scenario");
  return { message: "Demo financial data reset. Existing audit, approval and execution history retained; old active plans superseded." };
}
