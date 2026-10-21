import assert from "node:assert/strict";

// Intentionally appends synthetic workflow/audit history. Never resets data,
// imports invoices or changes settings, cash, documents or payment amounts.
const base = process.argv[2];
if (!base?.startsWith("http")) throw new Error("Pass the running demo origin as the first argument.");
let checks = 0;
async function api(path, method = "GET", body, expected = 200) {
  const response = await fetch(`${base.replace(/\/$/, "")}/api${path}`, {
    method, headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(json)}`);
  checks++;
  return json;
}
const initial = await api("/workspace");
assert.equal(initial.demo, true);
assert.match(initial.source, /Synthetic/);
const baseline = JSON.stringify({
  invoices: initial.invoices, settings: initial.settings, documents: initial.documents, customers: initial.customers,
});
const event = await api("/risk-checks", "POST");
let ws = await api("/workspace");
let plan = ws.plans.find(p => p.riskEventId === event.id && p.status === "Pending");
if (event.level === "Low") plan = await api("/plans", "POST", { riskEventId: event.id });
assert.ok(plan, "Risk trigger must create pending draft for actionable risk.");
assert.equal(event.dataSignature, plan.dataSignature); checks++;
const duplicate = await api("/plans", "POST", { riskEventId: event.id });
assert.equal(duplicate.id, plan.id); checks++;
await api(`/plans/${plan.id}/execute`, "POST", undefined, 409);
const blocked = await api("/workspace");
assert.equal(blocked.executions.length, initial.executions.length);
const bad = plan.tasks.map(t => ({ id: t.id, method: t.method, noticeEn: t.noticeEn, noticeMs: t.noticeMs })).slice(1);
await api(`/plans/${plan.id}`, "PATCH", { tasks: bad, notes: "API TEST invalid edit must roll back" }, 400);
const afterBad = await api("/workspace");
assert.equal(afterBad.plans.length, blocked.plans.length);
assert.equal(afterBad.auditLogs.length, blocked.auditLogs.length); checks++;
const tasks = plan.tasks.map(t => ({ id:t.id, method:t.method, noticeEn:t.noticeEn, noticeMs:t.noticeMs })).reverse();
tasks[0].noticeEn = "SYNTHETIC DEMO — API workflow edited English draft; do not send.";
tasks[0].noticeMs = "SYNTHETIC DEMO — Draf Bahasa Melayu untuk ujian; jangan hantar.";
const edited = await api(`/plans/${plan.id}`, "PATCH", {tasks, notes:"SYNTHETIC API workflow validation"});
assert.equal(edited.familyId, plan.familyId); assert.equal(edited.version, plan.version+1);
assert.equal(edited.tasks[0].invoiceId, plan.tasks.at(-1).invoiceId);
assert.equal(edited.tasks[0].noticeMs, tasks[0].noticeMs); checks++;
await api(`/plans/${plan.id}/execute`, "POST", undefined, 409);
const deferred = await api(`/plans/${edited.id}/decision`, "POST", {decision:"defer",notes:"SYNTHETIC API defer and recalculate"});
assert.equal(deferred.status,"Pending"); assert.equal(deferred.version,edited.version+1);
assert.notEqual(deferred.riskEventId,edited.riskEventId); checks++;
await api(`/plans/${deferred.id}/execute`, "POST", undefined, 409);
await api(`/plans/${deferred.id}/decision`, "POST", {decision:"reject",notes:"SYNTHETIC API rejection"});
await api(`/plans/${deferred.id}/execute`, "POST", undefined, 409);
const e2 = await api("/risk-checks","POST");
ws = await api("/workspace");
let approvedPlan = ws.plans.find(p=>p.riskEventId===e2.id && p.status==="Pending");
if (!approvedPlan) approvedPlan=await api("/plans","POST",{riskEventId:e2.id});
const approved = await api(`/plans/${approvedPlan.id}/decision`,"POST",{decision:"approve",notes:"SYNTHETIC API execution validation"});
assert.equal(approved.status,"Approved"); checks++;
const preExec = await api("/workspace");
assert.equal(preExec.executions.length,initial.executions.length);
await Promise.all([api(`/plans/${approved.id}/execute`,"POST"),api(`/plans/${approved.id}/execute`,"POST")]);
const executed = await api("/workspace");
const records = executed.executions.filter(e=>e.planId===approved.id);
assert.equal(records.length,approved.tasks.length);
assert.equal(new Set(records.map(e=>e.taskId)).size,approved.tasks.length); checks++;
await api(`/documents/${initial.documents[0].id}/view`,"POST");
const final = await api("/workspace");
assert.equal(JSON.stringify({invoices:final.invoices,settings:final.settings,documents:final.documents,customers:final.customers}),baseline);
assert.ok(final.approvals.some(a=>a.planId===approved.id && a.decision==="approve" && a.originalSnapshot && a.finalSnapshot));
for(const type of ["Risk check","Plan generated","Manual adjustment","Plan approval","Simulated execution","ESG document view"]) {
  assert.ok(final.auditLogs.slice(0,final.auditLogs.length-initial.auditLogs.length).some(a=>a.type===type),type);
}
const viewAudit=final.auditLogs.find(a=>a.type==="ESG document view");
assert.match(viewAudit.after,/Synthetic preloaded review outcome/);
checks++;
console.log(JSON.stringify({result:"PASS",checks, risk:event.level, executionTasks:records.length,
  appendedPlans:final.plans.length-initial.plans.length, appendedAudits:final.auditLogs.length-initial.auditLogs.length,
  financialAndEsgDataUnchanged:true, concurrentExecutionIdempotent:true},null,2));
