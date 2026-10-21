import assert from "node:assert/strict";
console.log(JSON.stringify({result:"NOT_RUN",reason:"Archived Gemini diagnostic. No request issued. See docs/OPENAI_SETUP.md."}));
process.exit(2);
const origin=process.argv[2];
if(!origin?.startsWith("http"))throw new Error("Pass the running synthetic demo origin.");
async function api(path,method="GET",body,status=200){
  const response=await fetch(`${origin.replace(/\/$/,"")}/api${path}`,{
    method,headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined,
  });
  const result=await response.json();
  assert.equal(response.status,status,`${method} ${path}`);return result;
}
const before=await api("/workspace");
assert.equal(before.demo,true);assert.equal(before.aiAvailable,true,"Configure the server key first.");
let plan,audit;
try{
  await api("/settings","PUT",{...before.settings,aiMode:"gemini"});
  const event=await api("/risk-checks","POST");
  let w=await api("/workspace");
  plan=w.plans.find(p=>p.riskEventId===event.id);
  if(!plan){plan=await api("/plans","POST",{riskEventId:event.id});w=await api("/workspace");}
  assert.ok(plan);assert.equal(plan.status,"Pending");
  assert.equal(plan.aiGeneration.requestedProvider,"gemini");
  assert.ok(["gemini","rules_fallback"].includes(plan.providerMode));
  assert.equal(plan.aiGeneration.status,plan.providerMode==="gemini"?"success":"fallback");
  assert.notEqual(plan.aiGeneration.reasonCode,"missing_api_key");
  audit=w.auditLogs.find(a=>a.type==="AI generation"&&a.planVersion.startsWith(plan.id));
  assert.ok(audit,"Persisted provider generation audit is missing");
  if(plan.providerMode==="gemini"){
    assert.ok(plan.aiRiskExplanation);
    assert.ok(plan.tasks.every(t=>t.aiAdvice?.strategies.length===3&&t.noticeEnSource==="gemini"&&t.noticeMsSource==="gemini"));
  }else{
    assert.ok(plan.tasks.every(t=>!t.aiAdvice&&t.noticeEnSource==="rules_fallback"));
  }
  await api(`/plans/${plan.id}/execute`,"POST",undefined,409);
}finally{await api("/settings","PUT",before.settings);}
const after=await api("/workspace");
for(const key of ["customers","invoices","documents","settings","approvals","executions"])
  assert.deepEqual(after[key],before[key],`${key} changed`);
for(const entry of before.auditLogs)assert.deepEqual(after.auditLogs.find(a=>a.id===entry.id),entry);
for(const entry of before.plans)assert.deepEqual(after.plans.find(p=>p.id===entry.id),entry);
console.log(JSON.stringify({result:plan.providerMode==="gemini"?"LIVE_GENERATION_PASS":"FALLBACK_VERIFIED_ONLY",
  planId:plan.id,providerMode:plan.providerMode,generation:plan.aiGeneration,taskCount:plan.tasks.length,
  aiAuditPersisted:!!audit,unapprovedExecutionBlocked:true,settingsRestored:true,originalDataAndHistoryIntact:true},null,2));
if(plan.providerMode!=="gemini")process.exitCode=2;
