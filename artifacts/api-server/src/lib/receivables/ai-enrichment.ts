import type { CollectionPlan } from "@workspace/api-zod";
import type { DemoState } from "./model";
import { BusinessError } from "./model";
import { generateAdvice, openaiConfigured } from "./ai-provider";
import { applyAdvice, humanAdjusted } from "./service";

export interface AdviceRepository {
  readState(): Promise<DemoState>;
  changeState<T>(operation: (state: DemoState) => T): Promise<T>;
}
// The same orchestrator is used with the transactional production repository
// and a pure in-memory repository in tests. It never imports the database.
export function createPlanEnricher(repository: AdviceRepository, advice = generateAdvice) {
  const inFlight = new Map<string, Promise<CollectionPlan>>();
  return function enrichPlan(id: string): Promise<CollectionPlan> {
    const existing = inFlight.get(id);
    if (existing) return existing;
    const run = (async () => {
      const state = await repository.readState();
      const plan = state.plans.find(p => p.id === id);
      if (!plan) throw new BusinessError("Plan not found.", 404);
      if (plan.status !== "Pending" || plan.providerMode === "openai" || plan.providerMode === "gemini" || humanAdjusted(state, plan)) return plan;
      if (state.settings.aiMode === "rules" && plan.aiGeneration?.reasonCode === "rules_selected") return plan;
      if (!openaiConfigured() && plan.aiGeneration?.requestedProvider === "openai"
        && plan.aiGeneration.reasonCode === "missing_managed_config") return plan;
      const expected = JSON.stringify(plan);
      const result = await advice(state, plan);
      return repository.changeState(current => applyAdvice(current, id, result, expected));
    })();
    inFlight.set(id, run);
    void run.finally(() => { if (inFlight.get(id) === run) inFlight.delete(id); }).catch(() => {});
    return run;
  };
}
