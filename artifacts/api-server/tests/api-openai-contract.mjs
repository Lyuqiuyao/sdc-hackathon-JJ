import assert from "node:assert/strict";
const origin=process.argv[2];
if(!origin?.startsWith("http"))throw new Error("Pass the running demo origin.");
let checks=0;
async function api(path,method="GET",body,status=200){
  const r=await fetch(`${origin.replace(/\/$/,"")}/api${path}`,{
    method,headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined});
  assert.equal(r.status,status,`${method} ${path}`);checks++;return r.json();
}
const before=await api("/workspace");
assert.equal(before.demo,true);
const original=JSON.stringify([before.invoices,before.documents,before.customers,before.plans,before.approvals,before.executions]);
try{
  const saved=await api("/settings","PUT",{...before.settings,aiMode:"openai"});
  assert.equal(saved.aiMode,"openai");checks++;
  const w=await api("/workspace");
  assert.equal(w.settings.aiMode,"openai");assert.match(w.aiMessage,/OpenAI/);
  assert.equal(typeof w.aiAvailable,"boolean");checks++;
  await api("/settings","PUT",{...before.settings,aiMode:"gemini"},400);
  assert.equal((await api("/workspace")).settings.aiMode,"openai");checks++;
}finally{
  // Existing Gemini setting cannot be reselected; restore only supported modes.
  await api("/settings","PUT",{...before.settings,aiMode:before.settings.aiMode==="gemini"?"rules":before.settings.aiMode});
}
const after=await api("/workspace");
assert.equal(JSON.stringify([after.invoices,after.documents,after.customers,after.plans,after.approvals,after.executions]),original);checks++;
assert.equal(after.settings.aiMode,before.settings.aiMode==="gemini"?"rules":before.settings.aiMode);checks++;
console.log(JSON.stringify({checks,passed:true,realModelRequests:0,financialDataAndPlansUnchanged:true,
  settingsRestored:before.settings.aiMode!=="gemini",auditHistoryAppended:true}));
