import type { CollectionPlan, Weights } from "@workspace/api-zod";
import { type DemoState, BusinessError } from "./model";
import { buildPlan } from "./planner";

// Server-only provider contract. A future Gemini integration may suggest wording
// and explain rankings, but it must NEVER approve plans or perform execution.
export interface CollectionAdvisor {
  readonly mode: "rules" | "gemini";
  createDraft(state: DemoState, riskEventId: string, weights: Weights): CollectionPlan;
}
export const rulesAdvisor: CollectionAdvisor = {
  mode: "rules",
  createDraft: (state, riskEventId, weights) => buildPlan(state, riskEventId, weights),
};
export const geminiAdvisor: CollectionAdvisor = {
  mode: "gemini",
  createDraft() {
    throw new BusinessError("Gemini provider is reserved but not connected. Select Rules-engine Demo. No external API call was made.");
  },
};
