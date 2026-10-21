import assert from "node:assert/strict";
const origin=process.argv[2];
if(!origin?.startsWith("http"))throw new Error("Pass the running demo origin.");
async function api(path,method="GET",body,status=200){
  const response=await fetch(`${origin.replace(/\/$/,"")}/api${path}`,{
    method,headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined,
  });
  const result=await response.json();
  assert.equal(response.status,status,`${method} ${path}`);return result;
}
const before=await api("/workspace");
assert.equal(before.demo,true);
if(before.aiAvailable)throw new Error("Missing-key test skipped: key is configured. Use the real live verification instead.");
let finalPlan;
try {
  await api("/settings","PUT",{...before.settings,aiMode:"gemini"});
  const event=await api("/risk-checks","POST");
  const w=await api("/workspace");
  finalPlan=w.plans.find(p=>p.riskEventId===event.id);
  if(!finalPlan)finalPlan=await api("/plans","POST",{riskEventId:event.id});
  assert.equal(finalPlan.providerMode,"rules_fallback");
  assert.equal(finalPlan.aiGeneration.reasonCode,"missing_api_key");
  assert.equal(finalPlan.aiGeneration.requestedProvider,"gemini");
  assert.equal(finalPlan.status,"Pending");
  assert.ok(finalPlan.tasks.every(t=>!t.aiAdvice && t.noticeEnSource==="rules_fallback"));
  await api(`/plans/${finalPlan.id}/execute`,"POST",undefined,409);
  assert.ok(w.auditLogs.some(a=>a.type==="AI generation"&&a.planVersion.startsWith(finalPlan.id)));
} finally {
  await api("/settings","PUT",before.settings);
}
const after=await api("/workspace");
for(const key of ["customers","invoices","documents","settings","approvals","executions"])
  assert.deepEqual(after[key],before[key],`${key} changed`);
for(const record of before.auditLogs)
  assert.deepEqual(after.auditLogs.find(a=>a.id===record.id),record,"Existing audit modified");
for(const plan of before.plans)
  assert.deepEqual(after.plans.find(p=>p.id===plan.id),plan,"Existing plan modified");
console.log(JSON.stringify({result:"PASS",providerMode:finalPlan.providerMode,reason:finalPlan.aiGeneration.reasonCode,
  actualGeminiRequest:false,pendingTasks:finalPlan.tasks.length,settingsRestored:true,
  originalDataApprovalAndAuditHistoryIntact:true,unapprovedExecutionBlocked:true},null,2));
