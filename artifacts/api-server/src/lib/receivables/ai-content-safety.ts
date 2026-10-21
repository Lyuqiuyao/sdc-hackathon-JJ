import type { CollectionPlan } from "@workspace/api-zod";
import type { AdviceResponse } from "./ai-schema";
import { validEsg } from "./compute";
import { communication } from "./communication";
import { type DemoState } from "./model";
import { AdviceBoundaryError } from "./ai-preflight";

// Deliberately conservative. These checks are NOT a general natural-language
// fact checker. Consequential customer notices are always server-authored.
const esgTerms = /\b(?:esg|certif\w*|uncertif\w*|sustainab\w*|environment\w*|labou?r|fraud\w*|unethical|unverified|unreviewed|pensijilan|alam\s+sekitar|tidak\s+patuh)\b/i;
const commitments = /\b(?:(?:extension|installments?|terms?|fees?|penalt(?:y|ies)|payment|lanjutan|ansuran|terma|bayaran)\s+(?:(?:has|have|had)\s+been\s+|(?:is|are|was|were|telah|sudah)\s+)(?:approved|granted|waived|changed|extended|diluluskan|dilanjutkan)|we\s+(?:(?:have|hereby)\s+)?(?:approve|grant|waive|guarantee)|kami\s+(?:telah\s+)?(?:meluluskan|menjamin))\b/i;
const facts = /\d|\b(?:MYR|RM|USD|percent|peratus)\b|[%$€£]/i;
const reject = (): never => { throw new AdviceBoundaryError("unsafe_content"); };
function checkInternal(text: string, rank?: number) {
  // A supplied priority number is explanatory, never a financial fact.
  const prose = rank === undefined ? text : text.replace(new RegExp(`\\bPriority ${rank}\\b`, "g"), "Priority");
  if (facts.test(prose) || esgTerms.test(prose) || commitments.test(prose)) reject();
}
export function protectAdviceContent(result: AdviceResponse, state: DemoState, plan: CollectionPlan) {
  checkInternal(result.riskExplanation);
  // With unknown ESG anywhere, a model-authored global explanation could make
  // an indirect negative inference without using a recognizable ESG keyword.
  // Render authoritative risk reasons instead of claiming regex can prove it safe.
  if (plan.tasks.some(t => !validEsg(state, t.customerId))) {
    const risk = state.riskEvents.find(r => r.id === plan.riskEventId) ?? reject();
    result.riskExplanation = `Synthetic deterministic cash-flow risk: ${risk.level}. ${risk.reasons.join(" ")} Unknown ESG is neutral and does not establish credit or bad-debt risk.`;
  }
  for (const advice of result.tasks) {
    const task = plan.tasks.find(t => t.id === advice.taskId) ?? reject();
    for (const text of [advice.reasoning, ...advice.assumptions, ...advice.uncertainties,
      ...advice.strategies.flatMap(s => [s.proposal, s.conditions])])
      checkInternal(text, task.rank);
    // ESG prose is never authoritative, even for known ratings. Only the local
    // reviewed record is rendered; unknown has exactly the same neutral policy.
    const doc = validEsg(state, task.customerId);
    advice.esgConsiderations = doc
      ? `Synthetic reviewed ESG rating ${doc.rating}; use only as an auxiliary scheduling factor. No credit or default inference is established by this record.`
      : "Unknown/unverified ESG evidence; neutral treatment. Missing ESG is not evidence of low ESG, fraud, or bad-debt risk.";
    if (!doc) {
      // All task prose, not just the ESG field, is controlled for unknown ESG.
      // This is a safety projection, not a newly inferred ESG rating.
      advice.reasoning = "The supplied deterministic financial scores and current collection method govern this draft. Unknown ESG receives neutral treatment and does not establish credit risk.";
      advice.assumptions = ["Customer willingness and payment arrangements require separate human confirmation."];
      advice.uncertainties = ["Collection timing is uncertain; missing ESG does not imply poor performance or bad debt."];
      const proposals = {
        payment_full: "Discuss payment of the recorded outstanding balance under the existing contract.",
        installments: "Discuss whether an installment proposal is appropriate, subject to a separate agreement.",
        extension: "Discuss whether an extension proposal is appropriate, without granting or changing any due date.",
      };
      for (const strategy of advice.strategies) {
        strategy.proposal = proposals[strategy.kind];
        strategy.conditions = "This is a conditional draft only. Human review and customer consent are required; no contract change is approved.";
      }
    }
    // Incoming notice numbers may only repeat the exact amount, date or overdue
    // days. Even matching text is not dispatched or retained as executable prose.
    const permitted = new Set([
      ...((task.outstandingCents / 100).toFixed(2).match(/\d+(?:\.\d+)?/g) ?? []),
      ...(task.dueDate.match(/\d+/g) ?? []), String(task.daysOverdue),
    ]);
    for (const notice of [advice.noticeEn, advice.noticeMs]) {
      const normalized = notice.normalize("NFKC").replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "");
      if (esgTerms.test(normalized) || commitments.test(normalized) || /\b(?:USD|EUR|GBP)\b|[$€£]/i.test(normalized) ||
        (normalized.match(/\d+(?:\.\d+)?/g) ?? []).some(n => !permitted.has(n))) reject();
    }
    const safe = communication(task, task.method);
    advice.noticeEn = safe.noticeEn;
    advice.noticeMs = safe.noticeMs;
    // Keep alternatives conditional irrespective of what the model proposed.
    for (const strategy of advice.strategies)
      strategy.conditions += " Subject to separate human review and customer consent; no contractual change is approved.";
  }
}
