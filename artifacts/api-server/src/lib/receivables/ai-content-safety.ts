import type { CollectionPlan } from "@workspace/api-zod";
import type { AdviceResponse } from "./ai-schema";
import { adviceEsg } from "./compute";
import { communication } from "./communication";
import { type DemoState } from "./model";
import { AdviceBoundaryError } from "./ai-preflight";
type Diagnose = (path: string, outcome: "passed" | "rejected" | "replaced", reason: string, taskId?: string) => void;

// Deliberately conservative. These checks are NOT a general natural-language
// fact checker. Consequential customer notices are always server-authored.
const esgTerms = /\b(?:esg|certif\w*|uncertif\w*|sustainab\w*|environment\w*|labou?r|fraud\w*|unethical|unverified|unreviewed|pensijilan|alam\s+sekitar|tidak\s+patuh)\b/i;
const commitments = /\b(?:(?:extension|installments?|terms?|fees?|penalt(?:y|ies)|payment|lanjutan|ansuran|terma|bayaran)\s+(?:(?:has|have|had)\s+been\s+|(?:is|are|was|were|telah|sudah)\s+)(?:approved|granted|waived|changed|extended|diluluskan|dilanjutkan)|we\s+(?:(?:have|hereby)\s+)?(?:approve|grant|waive|guarantee)|kami\s+(?:telah\s+)?(?:meluluskan|menjamin))\b/i;
const facts = /\d|\b(?:MYR|RM|USD|percent|peratus)\b|[%$€£]/i;
const reject = (): never => { throw new AdviceBoundaryError("unsafe_content"); };
function checkInternal(text: string, rank?: number, diagnose?: Diagnose, path = "$", taskId?: string) {
  // A supplied priority number is explanatory, never a financial fact.
  const prose = rank === undefined ? text : text.replace(new RegExp(`\\bPriority ${rank}\\b`, "g"), "Priority");
  if (facts.test(prose) || esgTerms.test(prose) || commitments.test(prose)) {
    diagnose?.(path, "rejected", "unsafe_internal_prose", taskId); reject();
  }
  diagnose?.(path, "passed", "conservative_prose_checks", taskId);
}
export function protectAdviceContent(result: AdviceResponse, state: DemoState, plan: CollectionPlan, diagnose?: Diagnose) {
  checkInternal(result.riskExplanation, undefined, diagnose, "riskExplanation");
  // With unknown ESG anywhere, a model-authored global explanation could make
  // an indirect negative inference without using a recognizable ESG keyword.
  // Render authoritative risk reasons instead of claiming regex can prove it safe.
  if (plan.tasks.some(t => adviceEsg(state, plan, t.customerId).evidence === "unknown")) {
    const risk = state.riskEvents.find(r => r.id === plan.riskEventId) ?? reject();
    result.riskExplanation = `Synthetic deterministic cash-flow risk: ${risk.level}. ${risk.reasons.join(" ")} Unknown ESG is neutral and does not establish credit or bad-debt risk.`;
    diagnose?.("riskExplanation", "replaced", "unknown_esg_global_projection");
  }
  for (const [index, advice] of result.tasks.entries()) {
    const task = plan.tasks.find(t => t.id === advice.taskId) ?? reject();
    const path = `tasks[${index}]`;
    const texts: [string, string][] = [
      [`${path}.reasoning`, advice.reasoning],
      ...advice.assumptions.map((v, i): [string,string] => [`${path}.assumptions[${i}]`, v]),
      ...advice.uncertainties.map((v, i): [string,string] => [`${path}.uncertainties[${i}]`, v]),
      ...advice.strategies.flatMap((s, i): [string,string][] => [
        [`${path}.strategies[${i}].proposal`, s.proposal], [`${path}.strategies[${i}].conditions`, s.conditions],
      ]),
    ];
    for (const [field, text] of texts) checkInternal(text, task.rank, diagnose, field, task.id);
    // ESG prose is never authoritative, even for known ratings. Only the local
    // reviewed record is rendered; unknown has exactly the same neutral policy.
    const esg = adviceEsg(state, plan, task.customerId);
    const hasEvidence = esg.evidence === "verified";
    advice.esgConsiderations = hasEvidence
      ? `Synthetic reviewed ESG rating ${esg.rating}; use only as an auxiliary scheduling factor. No credit or default inference is established by this record.`
      : plan.scoringSnapshot && esg.rating !== "unknown"
        ? `Existing synthetic customer rating ${esg.rating}; evidence unverified. SEDG is not certification. No credit or default inference is established.`
        : "Unknown/unverified ESG evidence; neutral treatment. Missing ESG is not evidence of low ESG, fraud, or bad-debt risk.";
    diagnose?.(`${path}.esgConsiderations`, "replaced", "reviewed_evidence_template", task.id);
    if (!hasEvidence) {
      // All task prose, not just the ESG field, is controlled for unknown ESG.
      // This is a safety projection, not a newly inferred ESG rating.
      advice.reasoning = "The supplied deterministic financial scores and current collection method govern this draft. Unknown ESG receives neutral treatment and does not establish credit risk.";
      advice.assumptions = ["Customer willingness and payment arrangements require separate human confirmation."];
      advice.uncertainties = ["Collection timing is uncertain; missing ESG does not imply poor performance or bad debt."];
      for (const field of ["reasoning", "assumptions", "uncertainties"])
        diagnose?.(`${path}.${field}`, "replaced", "unknown_esg_neutral_projection", task.id);
      const proposals = {
        payment_full: "Discuss payment of the recorded outstanding balance under the existing contract.",
        installments: "Discuss whether an installment proposal is appropriate, subject to a separate agreement.",
        extension: "Discuss whether an extension proposal is appropriate, without granting or changing any due date.",
      };
      for (const strategy of advice.strategies) {
        strategy.proposal = proposals[strategy.kind];
        strategy.conditions = "This is a conditional draft only. Human review and customer consent are required; no contract change is approved.";
      }
      for (let i = 0; i < advice.strategies.length; i++)
        for (const field of ["proposal", "conditions"])
          diagnose?.(`${path}.strategies[${i}].${field}`, "replaced", "unknown_esg_neutral_projection", task.id);
    }
    // Incoming notice numbers may only repeat the exact amount, date or overdue
    // days. Even matching text is not dispatched or retained as executable prose.
    const permitted = new Set([
      ...((task.outstandingCents / 100).toFixed(2).match(/\d+(?:\.\d+)?/g) ?? []),
      ...(task.dueDate.match(/\d+/g) ?? []), String(task.daysOverdue),
    ]);
    for (const field of ["noticeEn", "noticeMs"] as const) {
      const notice = advice[field];
      const normalized = notice.normalize("NFKC").replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "");
      if (esgTerms.test(normalized) || commitments.test(normalized) || /\b(?:USD|EUR|GBP)\b|[$€£]/i.test(normalized) ||
        (normalized.match(/\d+(?:\.\d+)?/g) ?? []).some(n => !permitted.has(n))) {
        diagnose?.(`${path}.${field}`, "rejected", "unsafe_customer_notice", task.id); reject();
      }
      diagnose?.(`${path}.${field}`, "passed", "notice_fact_allowlist", task.id);
    }
    const safe = communication(task, task.method);
    advice.noticeEn = safe.noticeEn;
    advice.noticeMs = safe.noticeMs;
    for (const field of ["noticeEn", "noticeMs"])
      diagnose?.(`${path}.${field}`, "replaced", "server_communication_template", task.id);
    // Keep alternatives conditional irrespective of what the model proposed.
    for (const strategy of advice.strategies)
      strategy.conditions += " Subject to separate human review and customer consent; no contractual change is approved.";
    for (let i = 0; i < advice.strategies.length; i++)
      diagnose?.(`${path}.strategies[${i}].conditions`, "replaced", "conditional_consent_guard", task.id);
  }
}
