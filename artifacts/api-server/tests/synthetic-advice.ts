import { generateAdvice } from "../src/lib/receivables/ai-provider";
import type { CollectionPlan } from "@workspace/api-zod";
import type { DemoState } from "../src/lib/receivables/model";

export function syntheticResponse(context: object) {
  const prose = "Synthetic conditional proposal; human review and separate consent are required.";
    const input = context as { tasks: {taskId:string;esg:{evidence:string;rating:string}}[] };
    return {
      riskExplanation: prose,
      tasks: input.tasks.map(t => ({
        taskId: t.taskId, reasoning: prose, assumptions: [prose], uncertainties: [prose],
        esgEvidence: t.esg.evidence, esgRating: t.esg.rating, esgConsiderations: prose,
        strategies: ["payment_full", "installments", "extension"].map(kind => ({kind,proposal:prose,conditions:prose})),
        noticeEn: "Synthetic Demo draft — no message sent. Dear Accounts Payable, please discuss this invoice with finance.",
        noticeMs: "Draf demo sintetik — tiada mesej dihantar. Tuan/Puan, sila berbincang dengan pihak kewangan.",
      })),
    };
}
export function syntheticAdvice(state: DemoState, plan: CollectionPlan, beforeTransport = async () => {}) {
  return generateAdvice(state, plan, { configured: true, transport: async context => {
    await beforeTransport();
    return JSON.stringify(syntheticResponse(context));
  } });
}
