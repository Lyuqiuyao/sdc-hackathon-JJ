import type { CollectionPlan } from "@workspace/api-zod";
import { readState, changeState } from "./repository";
import { generateAdvice, geminiConfigured } from "./ai-provider";
import { applyAdvice, humanAdjusted } from "./service";
import { BusinessError } from "./model";

const inFlight = new Map<string, Promise<CollectionPlan>>();

// External I/O is deliberately outside the PostgreSQL row lock. After the call,
// optimistic checks prevent overwriting an intervening edit/approval/data change.
export function enrichPlan(id: string): Promise<CollectionPlan> {
  const existing = inFlight.get(id);
  if (existing) return existing;
  const run = (async () => {
    const state = await readState();
    const plan = state.plans.find(p => p.id === id);
    if (!plan) throw new BusinessError("Plan not found.", 404);
    if (plan.status !== "Pending" || plan.providerMode === "gemini" || humanAdjusted(state, plan)) return plan;
    if (state.settings.aiMode === "rules" && plan.aiGeneration?.reasonCode === "rules_selected") return plan;
    if (!geminiConfigured() && plan.aiGeneration?.reasonCode === "missing_api_key") return plan;
    const expected = JSON.stringify(plan);
    const result = await generateAdvice(state, plan);
    return changeState(current => applyAdvice(current, id, result, expected));
  })();
  inFlight.set(id, run);
  void run.finally(() => { if (inFlight.get(id) === run) inFlight.delete(id); }).catch(() => {});
  return run;
}

export async function enrichRiskDraft(eventId: string) {
  const state = await readState();
  const plan = state.plans.find(p => p.riskEventId === eventId && p.status === "Pending");
  if (plan) await enrichPlan(plan.id);
}
