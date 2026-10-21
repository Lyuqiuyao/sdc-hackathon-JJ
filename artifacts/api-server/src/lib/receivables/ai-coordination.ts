import { randomUUID, createHash } from "node:crypto";
import type { CollectionPlan } from "@workspace/api-zod";
import type { DemoState } from "./model";
import { BusinessError, DEMO_WORKSPACE_ID } from "./model";
import { appendPlanSnapshot } from "./advice-snapshots";

export interface GenerationLease {
  key: string; attemptId: string; planId: string; planVersion: number;
  status: "running" | "succeeded" | "failed" | "timed_out";
  expiresAtMs: number; reasonCode: string;
}
export interface AdviceRepository {
  workspaceId?: string;
  readState(): Promise<DemoState>;
  changeState<T>(operation: (state: DemoState, databaseNowMs?: number) => T): Promise<T>;
}
export const GENERATION_LEASE_MS = 60_000; // greater than the existing 45s model timeout
export function generationKey(workspaceId: string, plan: CollectionPlan) {
  return createHash("sha256").update(JSON.stringify([
    workspaceId, plan.riskEventId, plan.id, plan.version, plan.dataSignature, "collection_advice",
  ])).digest("hex");
}
export function claimGeneration(state: DemoState, plan: CollectionPlan, workspaceId: string, time: number, leaseMs: number) {
  if (state.workspaceId && state.workspaceId !== workspaceId)
    throw new BusinessError("Workspace association mismatch.", 409);
  const key = generationKey(workspaceId, plan);
  const current = state.aiLeases?.[key];
  if (current?.status === "succeeded") return { kind: "completed" as const };
  if (current?.status === "running" && current.expiresAtMs > time) return { kind: "busy" as const };
  if (current?.status === "running") appendPlanSnapshot(state, plan, {
    status: "expired", reasonCode: "lease_expired", attemptId: current.attemptId,
    provider: "openai", metadataOnly: true, createdAtMs: time,
  });
  const lease: GenerationLease = {
    key, attemptId: `ATT-${randomUUID()}`, planId: plan.id, planVersion: plan.version,
    status: "running", expiresAtMs: time + leaseMs, reasonCode: "generation_in_progress",
  };
  state.workspaceId ??= workspaceId;
  state.aiLeases = { ...state.aiLeases, [key]: lease };
  appendPlanSnapshot(state, plan, { status: "started", reasonCode: "generation_in_progress",
    attemptId: lease.attemptId, provider: state.settings.aiMode === "gemini" ? "gemini" : state.settings.aiMode === "rules" ? "rules_fallback" : "openai",
    metadataOnly: true, createdAtMs: time });
  return { kind: "claimed" as const, lease: structuredClone(lease) };
}
export function currentPlan(state: DemoState, id: string) {
  const plan = state.plans.find(p => p.id === id);
  if (!plan) throw new BusinessError("Plan not found.", 404);
  return plan;
}
export const repositoryWorkspace = (repository: AdviceRepository) => repository.workspaceId ?? DEMO_WORKSPACE_ID;
