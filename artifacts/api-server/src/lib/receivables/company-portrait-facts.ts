import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { CompanyPortraitRiskTag, Invoice } from "@workspace/api-zod";
import { BusinessError, collectible, myr, today, type DemoState } from "./model";
import { canonicalJson, invoicesNow, validEsg } from "./compute";

export function companyPortraitFacts(state: DemoState, companyId: string, invoices: Invoice[] = invoicesNow(state)) {
  const company = state.customers.find(row => row.id === companyId);
  if (!company) throw new BusinessError("Company not found.", 404);
  const linked = invoices.filter(row => row.customerId === companyId);
  const active = linked.filter(row => row.status !== "Cancelled");
  const open = active.filter(collectible), overdue = open.filter(row => row.daysOverdue > 0);
  const maxOverdue = open.reduce((max, row) => Math.max(max, row.daysOverdue), 0);
  const outstanding = open.reduce((sum, row) => sum + row.outstandingCents, 0);
  const paid = active.reduce((sum, row) => sum + row.paidCents, 0);
  // Use only the latest extraction for each record; do not double-count reanalysis.
  const latest = new Map((state.companyCorrespondenceAnalyses?.[companyId] ?? []).map(row => [row.recordId, row]));
  const analyses = [...latest.values()].sort((a, b) => a.recordId.localeCompare(b.recordId));
  const counts = analyses.reduce((sum, row) => ({
    disputes: sum.disputes + row.fields.disputes.length,
    promises: sum.promises + row.fields.customerPromises.length,
    followUps: sum.followUps + row.fields.followUpItems.length,
  }), { disputes: 0, promises: 0, followUps: 0 });
  const riskTags: CompanyPortraitRiskTag[] = [];
  const tag = (code: string, label: string, level: CompanyPortraitRiskTag["level"]) => riskTags.push({ code, label, level });
  if (!active.length) tag("no_invoice_evidence", "Insufficient invoice evidence", "information");
  else if (!open.length) tag("no_open_balance", "No open invoice balance currently recorded", "information");
  else if (maxOverdue > 60) tag("overdue_over_60", "High risk signal: open invoices overdue more than 60 days", "high");
  else if (overdue.length) tag("open_overdue", "Attention: open overdue invoices", "attention");
  else tag("open_not_overdue", "Open invoices, none currently overdue", "information");
  if (counts.disputes) tag("unverified_disputes", "Dispute mentioned in NLP records (unverified)", "attention");
  if (counts.followUps) tag("unverified_follow_ups", "Follow-up items mentioned (unverified)", "attention");
  if (counts.promises) tag("unverified_promises", "Customer promises mentioned; fulfillment unknown", "information");
  if (!analyses.length) tag("no_nlp_evidence", "No prior communication extraction available", "information");

  const assigned = ["A", "B", "C"].includes(company.esgRating) ? company.esgRating : "unknown";
  const document = validEsg(state, companyId);
  const matches = assigned !== "unknown" && document?.rating === assigned;
  const sedg = (state.sedgSubmissions ?? []).filter(row => row.customerId === companyId);
  const esgHintCode = assigned === "unknown" ? "missing_neutral" : "existing_rating";
  const esgHint = assigned === "unknown"
    ? `No assigned ESG rating. Missing ESG is neutral, not evidence of poor cooperation or bad debt. ${sedg.length} unverified SEDG submission(s); no rating is generated here.`
    : `Existing imported ESG rating: ${assigned}. ${matches ? "A matching synthetic reviewed record is present; this is not independent certification." : "Supporting reviewed evidence is unknown or does not match; do not treat the rating as verified."} ESG does not establish payment ability or alter collection ranking here.`;
  const observations = {
    invoice_summary: `${active.length} non-cancelled invoice(s): ${open.length} open and ${overdue.length} overdue.`,
    balances: `Recorded open balance: ${myr(outstanding)}. Recorded paid amount across non-cancelled invoices: ${myr(paid)}.`,
    aging: open.length ? `Maximum current overdue age among open invoices: ${maxOverdue} day(s).` : "There is no current open balance from which to describe overdue age.",
    communications: analyses.length ? `${analyses.length} record(s) have prior NLP results, with ${counts.promises} promise, ${counts.followUps} follow-up and ${counts.disputes} dispute excerpt(s). These are unverified text mentions, not confirmed conduct or fulfilled payments.` : "No prior NLP result is available; no communication-based payment habit is inferred.",
    history_limit: "Settlement timestamps and a verified historical payment timeline are not available. Historical on-time payment habits and promise fulfillment cannot be established.",
  };
  const inputSignature = createHash("sha256").update(canonicalJson({
    companyId, date: today(), invoices: linked,
    analyses: analyses.map(row => ({ id: row.id, recordId: row.recordId, sourceHash: row.sourceHash, fields: row.fields })),
    esg: { assigned, documentId: document?.id, validUntil: document?.validUntil, matches, sedgIds: sedg.map(row => row.id) },
  })).digest("hex");
  return { companyId, riskTags, esgHintCode, esgHint, observations, inputSignature,
    sourceAnalysisIds: analyses.map(row => row.id) };
}
export type CompanyPortraitFacts = ReturnType<typeof companyPortraitFacts>;

const selectionSchema = z.object({
  riskTagCodes: z.array(z.string().min(1).max(64)).max(8),
  esgHintCode: z.string().min(1).max(64),
  paymentObservationCodes: z.array(z.string().min(1).max(64)).min(2).max(5),
}).strict();
function wireSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wireSchema);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["$schema", "minLength", "maxLength", "minItems", "maxItems"].includes(key))
    .map(([key, child]) => [key, wireSchema(child)]));
  return value;
}
export const portraitJsonSchema = wireSchema(z.toJSONSchema(selectionSchema)) as Record<string, unknown>;

export function basicPortraitContent(facts: CompanyPortraitFacts) {
  return { riskTags: facts.riskTags, esgHint: facts.esgHint,
    paymentHabitSummary: Object.values(facts.observations).join("\n") };
}
export function validatePortraitSelection(raw: string, facts: CompanyPortraitFacts) {
  if (raw.length > 20_000 || raw.includes("\ufffd")) throw new Error("Invalid portrait output");
  const selection = selectionSchema.parse(JSON.parse(raw));
  const tags = new Map(facts.riskTags.map(tag => [tag.code, tag]));
  if (new Set(selection.riskTagCodes).size !== tags.size || selection.riskTagCodes.length !== tags.size ||
    selection.riskTagCodes.some(code => !tags.has(code)) || selection.esgHintCode !== facts.esgHintCode ||
    new Set(selection.paymentObservationCodes).size !== selection.paymentObservationCodes.length ||
    !selection.paymentObservationCodes.includes("invoice_summary") || !selection.paymentObservationCodes.includes("history_limit") ||
    selection.paymentObservationCodes.some(code => !Object.hasOwn(facts.observations, code)))
    throw new Error("Unsupported portrait selection");
  return { riskTags: selection.riskTagCodes.map(code => tags.get(code)!), esgHint: facts.esgHint,
    paymentHabitSummary: selection.paymentObservationCodes.map(code => facts.observations[code as keyof typeof facts.observations]).join("\n") };
}
