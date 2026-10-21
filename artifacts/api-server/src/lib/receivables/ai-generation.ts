import { readState, changeState } from "./repository";
import { createPlanEnricher } from "./ai-enrichment";

export const enrichPlan = createPlanEnricher({ readState, changeState });

export async function enrichRiskDraft(eventId: string) {
  const state = await readState();
  const plan = state.plans.find(p => p.riskEventId === eventId && p.status === "Pending");
  if (plan) await enrichPlan(plan.id);
}
