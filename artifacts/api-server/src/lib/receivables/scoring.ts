import type { CollectionPlan, CollectionTask, ScoringSnapshot } from "@workspace/api-zod";
import { BusinessError, type DemoState, addDays, now, today } from "./model";
import { invoicesNow, signature } from "./compute";
import { communication } from "./communication";
import { randomUUID } from "node:crypto";

export const SCORING: Readonly<ScoringSnapshot> = Object.freeze({
  version: "split_v2", overdueCapDays: 90, amountCapCents: 10_000_000,
  twoDimensional: Object.freeze({ overdue: 60, amount: 40 }),
  threeDimensional: Object.freeze({ overdue: 51, amount: 34, esg: 15 }),
  esgMapping: Object.freeze({ A: 30, B: 50, C: 70 }),
});
export const assignedRating = (state: DemoState, customerId: string): "A" | "B" | "C" | "unknown" => {
  const rating = state.customers.find(c => c.id === customerId)?.esgRating;
  return rating === "A" || rating === "B" || rating === "C" ? rating : "unknown";
};
const round = (value: number) => Math.round(value * 100) / 100;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function splitScores(daysOverdue: number, outstandingCents: number, rating: ReturnType<typeof assignedRating>) {
  const overdueScore = round(100 * Math.min(Math.max(daysOverdue, 0) / SCORING.overdueCapDays, 1));
  const amountScore = round(100 * Math.min(outstandingCents / SCORING.amountCapCents, 1));
  const esgScore = rating === "unknown" ? null : SCORING.esgMapping[rating];
  return { overdueScore, amountScore, esgScore,
    score: round(esgScore === null ? .60 * overdueScore + .40 * amountScore :
      .51 * overdueScore + .34 * amountScore + .15 * esgScore) };
}
export function buildSplitPlan(state: DemoState, riskEventId: string, previous?: CollectionPlan, deferred = false): CollectionPlan {
  const id = `PLN-${randomUUID().slice(0, 8)}`;
  const source = state.invoices.filter(i => !["Cancelled", "Paid"].includes(i.status));
  if (new Set(source.map(i => i.id)).size !== source.length) throw new BusinessError("Duplicate invoice IDs.");
  for (const i of source) {
    if (!state.customers.some(c => c.id === i.customerId) ||
      ![i.totalCents, i.paidCents, i.lateFeeBps].every(Number.isSafeInteger) ||
      i.totalCents <= 0 || i.paidCents < 0 || i.paidCents > i.totalCents || i.currency !== "MYR" ||
      i.lateFeeBps < 0 || i.lateFeeBps > 10000 || !validDate(i.dueDate) || !validDate(i.invoiceDate) ||
      i.invoiceDate > i.dueDate) throw new BusinessError("Invalid invoice, date or customer association. Fix the synthetic input before planning.");
  }
  const tasks: CollectionTask[] = invoicesNow(state).filter(i => !["Cancelled", "Paid"].includes(i.status) && i.outstandingCents > 0)
    .map(i => {
      const rating = assignedRating(state, i.customerId);
      const scores = splitScores(i.daysOverdue, i.outstandingCents, rating);
      const method = i.daysOverdue > 0 ? "Overdue collection" : "Due date reminder";
      const prose = communication({ ...i, invoiceNumber: i.number }, method);
      return { id: `TSK-${randomUUID().slice(0, 8)}`, invoiceId: i.id, invoiceNumber: i.number,
        customerId: i.customerId, customerName: i.customerName, outstandingCents: i.outstandingCents,
        dueDate: i.dueDate, daysOverdue: i.daysOverdue, rank: 0, queueRank: 0,
        queue: rating === "unknown" ? "two_dimensional" as const : "three_dimensional" as const,
        assignedEsgRating: rating, ...scores,
        // Compatibility fields are not components of split_v2 ranking.
        lateFeeScore: 0, urgencyScore: scores.overdueScore, importanceScore: 0,
        method, scheduledAt: "", ...prose, status: "Draft",
        reason: `${rating === "unknown" ? "2D: overdue 60%, outstanding 40%; ESG excluded" :
          `3D: overdue 51%, outstanding 34%, assigned ESG 15% (${rating})`}. Overdue ${scores.overdueScore}/100; amount ${scores.amountScore}/100; score ${scores.score}. Rank is within this queue only; human review must merge queues.`,
        uncertainty: "Synthetic Demo scoring parameters, not a validated credit model. No cross-queue score comparison. Human review and exact-version approval required.",
        esgNote: rating === "unknown" ? "Unknown/unverified ESG; excluded from scoring, not penalized. SEDG may inform human collection review, never automatic certification." :
          `Existing synthetic customer rating ${rating}; auxiliary scheduling only, not independently verified credit or certification evidence.`,
      };
    });
  if (!tasks.length) throw new BusinessError("There are no collectible invoices.");
  tasks.sort((a, b) => a.queue!.localeCompare(b.queue!) || b.score - a.score ||
    a.dueDate.localeCompare(b.dueDate) || a.invoiceNumber.localeCompare(b.invoiceNumber) || a.invoiceId.localeCompare(b.invoiceId));
  const counters: Record<string, number> = {};
  tasks.forEach((t, n) => {
    t.queueRank = counters[t.queue!] = (counters[t.queue!] ?? 0) + 1;
    t.rank = n + 1; // Display position, not a merged priority claim.
    t.scheduledAt = `${addDays(today(), (deferred ? 2 : 0) + Math.floor(n / 8) + 1)}T${String(9 + n % 8).padStart(2, "0")}:00:00+08:00`;
  });
  return { id, familyId: previous?.familyId ?? id,
    version: previous ? Math.max(...state.plans.filter(p => p.familyId === previous.familyId).map(p => p.version)) + 1 : 1,
    createdAt: now(), riskEventId, status: "Pending", mode: "rules_fallback", providerMode: "rules_fallback",
    aiGeneration: { requestedProvider: state.settings.aiMode, generatedAt: now(), durationMs: 0, status: "fallback",
      reasonCode: state.settings.aiMode === "openai" ? "pending_generation" : "rules_selected", model: "",
      ...(state.settings.aiMode === "openai" ? { connectionMode: "replit_managed" as const } : {}) },
    weights: structuredClone(state.settings.weights), scoringSnapshot: structuredClone(SCORING), customerReviews: [],
    tasks, notes: "", dataSignature: signature(state) };
}
