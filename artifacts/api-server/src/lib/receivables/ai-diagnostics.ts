import type { AdviceDiagnostic, CollectionPlan } from "@workspace/api-zod";

const stages: AdviceDiagnostic["stage"][] = ["preflight", "transport", "json", "schema", "business", "safety", "projection"];
const outcomes: AdviceDiagnostic["outcome"][] = ["passed", "rejected", "replaced", "not_run"];
const fields = new Set(["tasks", "riskExplanation", "taskId", "reasoning", "assumptions", "uncertainties",
  "esgEvidence", "esgRating", "esgConsiderations", "strategies", "kind", "proposal", "conditions", "noticeEn", "noticeMs"]);
function safePath(parts: readonly unknown[]) {
  let path = "";
  for (const part of parts.slice(0, 12)) {
    if (typeof part === "number" && Number.isInteger(part) && part >= 0 && part < 50) path += `[${part}]`;
    else if (typeof part === "string" && fields.has(part)) path += `${path ? "." : ""}${part}`;
    else break; // Never retain unrecognized model-supplied property names.
  }
  return path || "$";
}
export class AdviceDiagnostics {
  readonly rows: AdviceDiagnostic[] = [];
  stage: AdviceDiagnostic["stage"] = "preflight";
  private readonly ids: Set<string>;
  constructor(plan: CollectionPlan) {
    this.ids = new Set((Array.isArray(plan.tasks) ? plan.tasks : []).map(t => t?.id).filter(id => typeof id === "string"));
  }
  record(stage: AdviceDiagnostic["stage"], path: string, outcome: AdviceDiagnostic["outcome"], reasonCode: string, taskId?: string) {
    this.stage = stage;
    if (!stages.includes(stage) || !outcomes.includes(outcome)) return;
    if (this.rows.length >= 3999) {
      if (this.rows.length === 3999) this.rows.push({stage, path:"$", outcome:"not_run", reasonCode:"diagnostics_truncated"});
      return;
    }
    const parts = path === "$" ? [] : path.replace(/\[(\d+)\]/g, ".$1").split(".").map(p => /^\d+$/.test(p) ? Number(p) : p);
    this.rows.push({ stage, path: safePath(parts), outcome,
      reasonCode: /^[a-z_]{1,80}$/.test(reasonCode) ? reasonCode : "diagnostic_unavailable",
      ...(taskId && this.ids.has(taskId) ? { taskId } : {}) });
  }
  schemaIssues(issues: readonly { code: string; path: readonly unknown[] }[]) {
    for (const issue of issues.slice(0, 100)) {
      const code = issue.code === "unrecognized_keys" ? "schema_extra_fields"
        : issue.code === "invalid_type" ? "schema_type_or_required"
        : ["too_big", "too_small"].includes(issue.code) ? "schema_bounds" : "schema_invalid_value";
      this.record("schema", safePath(issue.path), "rejected", code);
    }
  }
  failure(reason: string, skipped = false) {
    this.record(this.stage, "$", skipped ? "not_run" : "rejected", reason);
    if (!skipped) this.record("projection", "$", "rejected", "whole_response_rejected");
    for (const stage of stages) if (!this.rows.some(d => d.stage === stage))
      this.record(stage, "$", "not_run", "not_executed");
  }
}
export function sanitizeDiagnostics(rows: readonly AdviceDiagnostic[], plan: CollectionPlan) {
  const recorder = new AdviceDiagnostics(plan);
  for (const row of rows.slice(0, 4000)) recorder.record(row.stage, row.path, row.outcome, row.reasonCode, row.taskId);
  return recorder.rows;
}
