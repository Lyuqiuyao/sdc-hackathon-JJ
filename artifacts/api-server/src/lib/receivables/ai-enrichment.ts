import type { CollectionPlan } from "@workspace/api-zod";
import { BusinessError } from "./model";
import { generateAdvice, openaiConfigured } from "./ai-provider";
import { applyAdvice, humanAdjusted } from "./service";
import { claimGeneration, currentPlan, GENERATION_LEASE_MS, repositoryWorkspace, type AdviceRepository } from "./ai-coordination";
import { appendPlanSnapshot } from "./advice-snapshots";
export type { AdviceRepository } from "./ai-coordination";
// The same orchestrator is used with the transactional production repository
// and a pure in-memory repository in tests. It never imports the database.
export function createPlanEnricher(repository: AdviceRepository, advice = generateAdvice, options: {
  clock?: () => number; leaseMs?: number;
} = {}) {
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
      // Claim and completion are short transactions. No model I/O holds a row lock.
      const claim = await repository.changeState((current, databaseNow) => {
        const candidate = currentPlan(current, id);
        if (candidate.status !== "Pending" || candidate.providerMode === "openai" ||
          candidate.providerMode === "gemini" || humanAdjusted(current, candidate))
          return { kind: "ineligible" as const };
        const token = claimGeneration(current, candidate, repositoryWorkspace(repository),
          options.clock?.() ?? databaseNow ?? Date.now(), options.leaseMs ?? GENERATION_LEASE_MS);
        return token.kind === "claimed"
          ? { ...token, input: structuredClone(current), expected: JSON.stringify(candidate) } : token;
      });
      if (claim.kind !== "claimed") return currentPlan(await repository.readState(), id);
      let result;
      try { result = await advice(claim.input, currentPlan(claim.input, id)); }
      catch {
        result = { providerMode: "rules_fallback" as const, generation: {
          requestedProvider: claim.input.settings.aiMode, model: "", status: "fallback" as const,
          generatedAt: new Date().toISOString(), durationMs: 0, reasonCode: "orchestration_error",
        } };
      }
      result.generation = { ...result.generation, attemptId: claim.lease.attemptId };
      return repository.changeState((current, databaseNow) => {
        const candidate = currentPlan(current, id);
        const time = options.clock?.() ?? databaseNow ?? Date.now();
        const lease = current.aiLeases?.[claim.lease.key];
        const owns = lease?.attemptId === claim.lease.attemptId && lease.status === "running";
        if (!owns || lease.expiresAtMs <= time) {
          if (owns) { lease.status = "timed_out"; lease.reasonCode = "lease_expired"; }
          appendPlanSnapshot(current, candidate, { status: "discarded", reasonCode: owns ? "lease_expired" : "lease_lost",
            attemptId: claim.lease.attemptId, provider: result.providerMode, metadataOnly: true, result, createdAtMs: time });
          return candidate;
        }
        const applied = applyAdvice(current, id, result, claim.expected);
        const accepted = applied.aiGeneration?.attemptId === claim.lease.attemptId;
        lease.status = accepted && result.providerMode === "openai" ? "succeeded"
          : result.generation.reasonCode === "timeout" ? "timed_out" : "failed";
        lease.reasonCode = accepted ? result.generation.reasonCode : "plan_changed";
        appendPlanSnapshot(current, applied, {
          status: !accepted ? "discarded" : result.providerMode === "openai" ? "applied" : "fallback",
          reasonCode: lease.reasonCode, attemptId: lease.attemptId, provider: result.providerMode,
          source: !accepted ? "metadata_only" : result.providerMode === "openai" ? "validated_projection" : "rules_template",
          validation: result.providerMode === "openai" ? "passed"
            : ["invalid_response", "unsafe_content"].includes(result.generation.reasonCode) ? "failed" : "not_run",
          metadataOnly: !accepted, result, createdAtMs: time,
        });
        return applied;
      });
    })();
    inFlight.set(id, run);
    void run.finally(() => { if (inFlight.get(id) === run) inFlight.delete(id); }).catch(() => {});
    return run;
  };
}
