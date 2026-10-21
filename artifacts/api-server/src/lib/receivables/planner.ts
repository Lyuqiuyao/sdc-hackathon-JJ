import { randomUUID } from "node:crypto";
import type { CollectionPlan, CollectionTask, Weights } from "@workspace/api-zod";
import { type DemoState, collectible, ratio, today, addDays, myr, now, BusinessError } from "./model";
import { invoicesNow, signature, validEsg, validateWeights } from "./compute";
import { communication } from "./communication";
import { buildSplitPlan } from "./scoring";

export const METHODS = [
  "Friendly reminder", "Due date reminder", "Overdue collection",
  "Installment negotiation", "Extension negotiation", "Priority human follow-up",
];
const round = (n: number) => Math.round(n * 100) / 100;

export function buildPlan(state: DemoState, riskEventId: string, weights: Weights, previous?: CollectionPlan, deferred = false): CollectionPlan {
  if (state.settings.scoringVersion !== "legacy_v1") return buildSplitPlan(state, riskEventId, previous, deferred);
  validateWeights(weights);
  const invoices = invoicesNow(state).filter(collectible);
  if (!invoices.length) throw new BusinessError("There are no collectible invoices.");
  const id = `PLN-${randomUUID().slice(0, 8)}`;
  const tasks: CollectionTask[] = invoices.map(i => {
    const dailyPenaltyCents = ratio(i.outstandingCents, i.lateFeeBps, 3650000);
    const accruedPenaltyCents = ratio(i.outstandingCents, i.lateFeeBps * i.daysOverdue, 3650000);
    const lateFeeScore = round(Math.min(100, accruedPenaltyCents / 1000 + dailyPenaltyCents / 50));
    const daysToDue = Math.max(0, Math.round((Date.parse(i.dueDate) - Date.parse(today())) / 86400000));
    const urgencyScore = round(Math.min(100, (i.daysOverdue > 0 ? 65 + i.daysOverdue : Math.max(0, 60 - daysToDue * 3)) + Math.min(20, i.outstandingCents / 500000)));
    const importanceScore = i.importance === "High" ? 25 : i.importance === "Medium" ? 55 : 80;
    const document = validEsg(state, i.customerId);
    const esgScore = document?.rating === "A" ? 30 : document?.rating === "C" ? 70 : 50;
    const score = round((lateFeeScore * weights.lateFee + urgencyScore * weights.urgency +
      importanceScore * weights.importance + esgScore * weights.esg) / 100);
    const method = i.daysOverdue > 45 ? "Priority human follow-up" :
      i.daysOverdue > 20 && i.outstandingCents >= state.settings.largeInvoiceCents ? "Installment negotiation" :
      i.daysOverdue > 0 ? "Overdue collection" :
      i.importance === "High" && daysToDue > 7 ? "Extension negotiation" :
      daysToDue <= 7 ? "Due date reminder" : "Friendly reminder";
    const { negotiation, noticeEn, noticeMs } = communication({ ...i, invoiceNumber: i.number }, method);
    return {
      id: `TSK-${randomUUID().slice(0, 8)}`, invoiceId: i.id, invoiceNumber: i.number,
      customerId: i.customerId, customerName: i.customerName, outstandingCents: i.outstandingCents,
      dueDate: i.dueDate, daysOverdue: i.daysOverdue, rank: 0, lateFeeScore, urgencyScore, importanceScore, esgScore, score,
      method, scheduledAt: "", negotiation,
      reason: `Annual late fee ${i.lateFeeBps / 100}%: estimated accrued cost ${myr(accruedPenaltyCents)}, daily cost ${myr(dailyPenaltyCents)} (simple interest, not added to invoice). Urgency ${urgencyScore}/100; ${i.importance.toLowerCase()} business importance uses ${importanceScore}/100 to protect key relationships. ${document ? `Valid reviewed ESG ${document.rating} uses ${esgScore}/100.` : "Unverified/missing ESG uses neutral 50/100; it is not evidence of bad debt."} Weighted score ${score}/100.`,
      uncertainty: `Rules-engine Demo, not LLM output or a validated credit model. Payment forecasts and customer willingness are uncertain. Weights are illustrative, not business-validated. ${!document ? "No valid reviewed ESG rating; neutral treatment." : "ESG is auxiliary only and does not override contractual obligations."}`,
      esgNote: document ? `Synthetic Demo ${document.type}, ${document.number}; reviewer status Approved; valid until ${document.validUntil}; rating ${document.rating}. Use only for relationship-sensitive scheduling, never as sole evidence of credit quality.` : "No ESG compliance alert: no currently valid reviewed evidence. Neutral score 50.",
      noticeEn, noticeMs, status: "Draft",
    };
  }).sort((a, b) => b.score - a.score || a.dueDate.localeCompare(b.dueDate) || a.invoiceNumber.localeCompare(b.invoiceNumber));
  tasks.forEach((t, n) => {
    t.rank = n + 1;
    t.scheduledAt = `${addDays(today(), (deferred ? 2 : 0) + Math.floor(n / 8) + 1)}T${String(9 + n % 8).padStart(2, "0")}:00:00+08:00`;
  });
  return { id, familyId: previous?.familyId ?? id,
    version: previous ? Math.max(...state.plans.filter(p => p.familyId === previous.familyId).map(p => p.version)) + 1 : 1,
    riskEventId, createdAt: now(), status: "Pending", mode: "rules_fallback", providerMode: "rules_fallback",
    aiGeneration: { requestedProvider: state.settings.aiMode, generatedAt: now(), durationMs: 0,
      ...(state.settings.aiMode === "openai" ? { connectionMode: "replit_managed" as const } : {}),
      status: "fallback", reasonCode: state.settings.aiMode === "openai" ? "pending_generation"
        : state.settings.aiMode === "gemini" ? "legacy_provider_retired" : "rules_selected", model: "" },
    weights: structuredClone(weights), tasks, notes: "", dataSignature: signature(state) };
}
