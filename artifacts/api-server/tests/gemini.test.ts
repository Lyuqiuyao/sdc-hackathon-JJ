import test from "node:test";
import assert from "node:assert/strict";
import { seedState } from "../src/lib/receivables/seed";
// Historical filename retained so existing test commands continue to work.
import { businessContext, createOpenAITransport, generateAdvice, OPENAI_MODEL } from "../src/lib/receivables/ai-provider";
import { applyAdvice, decide, edit, execute, workspace } from "../src/lib/receivables/service";
import type { AdviceResponse } from "../src/lib/receivables/ai-schema";
import type { CollectionPlan } from "@workspace/api-zod";

function setup() {
  const state = seedState(); state.settings.aiMode = "openai";
  // Generate a fresh deterministic plan after changing only this isolated fixture.
  const event = state.riskEvents[0]!;
  const plan = state.plans[0]!;
  return {state,event,plan};
}
function response(state: ReturnType<typeof seedState>, plan: CollectionPlan): AdviceResponse {
  const ctx=businessContext(state,plan);
  return {riskExplanation:"Cash projected below the operating minimum; overdue balances and due-date concentration amplify the synthetic liquidity gap.",
    tasks:ctx.tasks.map(t=>({
      taskId:t.taskId,
      reasoning:`Priority ${t.rank} follows supplied urgency and cost scores; use the supplied ${t.preliminaryMethod} as the starting point.`,
      assumptions:["Payment willingness is unknown and must be confirmed by a person."],
      uncertainties:["A forecast is not a guaranteed collection or credit-loss probability."],
      esgEvidence:t.esg.evidence as "verified"|"unknown",esgRating:t.esg.rating as "A"|"B"|"C"|"unknown",
      esgConsiderations:"Only supplied reviewed evidence may inform auxiliary scheduling; no credit conclusion is justified.",
      strategies:[
        {kind:"payment_full" as const,proposal:"Request the contractual outstanding payment in full.",conditions:"No additional fees or new contract terms are imposed."},
        {kind:"installments" as const,proposal:"Discuss a possible installment arrangement with the customer.",conditions:"Separate customer and human consent is required before any change."},
        {kind:"extension" as const,proposal:"Discuss whether a short extension is appropriate for the relationship.",conditions:"This is not a granted extension and does not change the invoice due date."},
      ],
      noticeEn:`Dear Accounts Payable Team, please review [Invoice reference], outstanding MYR ${t.outstandingMYR}, due ${t.dueDate}. Please discuss payment arrangements with finance. Synthetic Demo draft — no message sent.`,
      noticeMs:`Tuan/Puan, sila semak [Invoice reference], baki MYR ${t.outstandingMYR}, tarikh akhir ${t.dueDate}. Sila hubungi pihak kewangan untuk berbincang. Draf demo sintetik — tiada mesej dihantar.`,
    }))};
}
function core(p:CollectionPlan) {
  return {id:p.id,status:p.status,weights:p.weights,riskEventId:p.riskEventId,
    tasks:p.tasks.map(({aiAdvice,noticeEn,noticeMs,noticeEnSource,noticeMsSource,...t})=>t)};
}
test("missing key falls back without issuing any transport request",async()=>{
  const {state,plan}=setup();let calls=0;
  const result=await generateAdvice(state,plan,{configured:false,transport:async()=>{calls++;throw Error();}});
  assert.equal(calls,0);assert.equal(result.providerMode,"rules_fallback");
  assert.equal(result.generation.reasonCode,"missing_api_key");assert.equal(result.generation.status,"fallback");
});
test("explicit rules mode works even when a key is configured",async()=>{
  const {state,plan}=setup();state.settings.aiMode="rules";
  const result=await generateAdvice(state,plan,{configured:true,transport:async()=>{throw Error("must not call");}});
  assert.equal(result.generation.reasonCode,"rules_selected");
});
test("successful structured output contains contextual explanation, alternatives, EN/MS and unknown ESG neutrality",async()=>{
  const {state,plan}=setup();let calls=0;
  const result=await generateAdvice(state,plan,{configured:true,transport:async context=>{
    calls++;assert.ok(context);return JSON.stringify(response(state,plan));
  }});
  assert.equal(calls,1);assert.equal(result.providerMode,"openai");assert.equal(result.generation.status,"success");
  assert.equal(result.generation.model,OPENAI_MODEL);assert.ok(result.generation.generatedAt);
  for(const t of result.advice!.tasks){
    assert.equal(t.strategies.length,3);assert.match(t.noticeMs,/Tuan\/Puan/);
    if(t.esgEvidence==="unknown"){assert.equal(t.esgRating,"unknown");assert.match(t.esgConsiderations,/not evidence/);}
  }
});
test("official OpenAI SDK constructs strict Responses request (intercepted, NOT a live API test)",async()=>{
  const {state,plan}=setup();let calls=0;
  const transport=createOpenAITransport("synthetic-test-value-not-a-real-key",async (input,init)=>{
    calls++;assert.equal(String(input),"https://api.openai.com/v1/responses");
    const payload=JSON.parse(String(init?.body));
    assert.equal(payload.model,OPENAI_MODEL);assert.equal(payload.store,false);
    assert.equal(payload.text.format.type,"json_schema");assert.equal(payload.text.format.strict,true);
    assert.equal(payload.text.format.schema.additionalProperties,false);
    assert.ok(payload.instructions);assert.ok(payload.input);
    return new Response(JSON.stringify({id:"resp_synthetic",object:"response",status:"completed",
      output:[{type:"message",role:"assistant",content:[{type:"output_text",text:JSON.stringify(response(state,plan)),annotations:[]}]}]}),
      {status:200,headers:{"Content-Type":"application/json"}});
  });
  const result=await generateAdvice(state,plan,{configured:true,transport});
  assert.equal(calls,1);assert.equal(result.providerMode,"openai");
});
test("malformed JSON and schema violations activate fallback with no raw errors",async()=>{
  const {state,plan}=setup();
  for(const raw of ["not JSON","{}",JSON.stringify({riskExplanation:"Too short",tasks:[]})]){
    const result=await generateAdvice(state,plan,{configured:true,transport:async()=>raw});
    assert.equal(result.generation.reasonCode,"invalid_response");assert.equal(result.advice,undefined);
  }
});
test("API failure is sanitized and keeps rule templates",async()=>{
  const {state,plan}=setup(),before=JSON.stringify(plan.tasks);
  const result=await generateAdvice(state,plan,{configured:true,transport:async()=>{throw Error("PRIVATE_ERROR_MUST_NOT_PERSIST");}});
  assert.equal(result.generation.reasonCode,"api_error");
  assert.ok(!JSON.stringify(result).includes("PRIVATE_ERROR"));assert.equal(JSON.stringify(plan.tasks),before);
});
test("both full synthetic labels and no-send declarations are mandatory in model notices",async()=>{
  const {state,plan}=setup();
  for(const field of ["noticeEn","noticeMs"] as const){
    for(const text of ["This is only a demo reminder and an example of a generic notice without the required declaration.",
      field==="noticeEn"?"Synthetic Demo draft. Please contact finance regarding your outstanding balance."
        :"Draf demo sintetik. Sila hubungi pihak kewangan untuk membincangkan baki tertunggak."]){
      const data=response(state,plan);data.tasks[0]![field]=text;
      const result=await generateAdvice(state,plan,{configured:true,transport:async()=>JSON.stringify(data)});
      assert.equal(result.generation.reasonCode,"invalid_response");
    }
  }
  const data=response(state,plan);data.tasks[0]!.strategies[2]!.kind="payment_full";
  assert.equal((await generateAdvice(state,plan,{configured:true,transport:async()=>JSON.stringify(data)})).generation.reasonCode,"invalid_response");
});
test("timeout aborts request and safely falls back",async()=>{
  const {state,plan}=setup();let signal:AbortSignal|undefined;
  const result=await generateAdvice(state,plan,{configured:true,timeoutMs:5,transport:async(_,s)=>{
    signal=s;return new Promise(()=>{});
  }});
  assert.equal(result.generation.reasonCode,"timeout");assert.equal(signal!.aborted,true);
});
test("model attempting scores, approval or missing-ESG rating mutations is rejected",async()=>{
  const {state,plan}=setup();
  for(const kind of ["score","approval","esg","duplicate","missing"]){
    const data:any=response(state,plan);
    if(kind==="score")data.tasks[0].score=999;
    if(kind==="approval")data.status="Approved";
    if(kind==="esg"){const t=data.tasks.find((a:any)=>a.esgEvidence==="unknown");t.esgRating="C";}
    if(kind==="duplicate")data.tasks[1].taskId=data.tasks[0].taskId;
    if(kind==="missing")data.tasks.pop();
    const result=await generateAdvice(state,plan,{configured:true,transport:async()=>JSON.stringify(data)});
    assert.equal(result.providerMode,"rules_fallback",kind);assert.equal(result.generation.reasonCode,"invalid_response",kind);
  }
});
test("whitelisted AI merge preserves deterministic results, finances/history/settings and approval gate",async()=>{
  const {state,plan}=setup();
  // Restore the fixture signature after setting AI mode (production creates fresh events/plans).
  const {signature}=await import("../src/lib/receivables/compute");plan.dataSignature=signature(state);
  const beforeCore=core(plan),baseline=JSON.stringify({invoices:state.invoices,settings:state.settings,documents:state.documents,approvals:state.approvals});
  const audits=state.auditLogs.length,expected=JSON.stringify(plan);
  const result=await generateAdvice(state,plan,{configured:true,transport:async()=>JSON.stringify(response(state,plan))});
  applyAdvice(state,plan.id,result,expected);
  assert.deepEqual(core(plan),beforeCore);assert.equal(plan.providerMode,"openai");
  assert.equal(plan.tasks[0]!.noticeEnSource,"openai");assert.match(plan.aiRiskExplanation!,/Cash projected/);
  assert.equal(JSON.stringify({invoices:state.invoices,settings:state.settings,documents:state.documents,approvals:state.approvals}),baseline);
  assert.equal(state.auditLogs.length,audits+1);assert.equal(state.auditLogs.at(-1)!.type,"AI generation");
  assert.throws(()=>execute(state,plan.id),/not been approved/);
  decide(state,plan.id,{decision:"approve",notes:"Synthetic test approval"});
  execute(state,plan.id);assert.equal(state.executions.length,plan.tasks.length);
});
test("late AI response cannot overwrite human edits or approved plan",async()=>{
  const {state,plan}=setup();
  const {signature}=await import("../src/lib/receivables/compute");plan.dataSignature=signature(state);
  const expected=JSON.stringify(plan);
  const result=await generateAdvice(state,plan,{configured:true,transport:async()=>JSON.stringify(response(state,plan))});
  decide(state,plan.id,{decision:"approve",notes:"Approve while model is still pending"});
  const snapshot=JSON.stringify(plan);
  applyAdvice(state,plan.id,result,expected);
  assert.equal(JSON.stringify(plan),snapshot);assert.equal(state.auditLogs.at(-1)!.type,"AI generation discarded");
});
test("AI merge is discarded when invoice data changes during the request",async()=>{
  const {state,plan}=setup();
  const {signature}=await import("../src/lib/receivables/compute");plan.dataSignature=signature(state);
  const expected=JSON.stringify(plan),before=JSON.stringify(plan);
  const result=await generateAdvice(state,plan,{configured:true,transport:async()=>JSON.stringify(response(state,plan))});
  state.invoices[0]!.paidCents++;
  applyAdvice(state,plan.id,result,expected);assert.equal(JSON.stringify(plan),before);
});
test("human and method/template edits keep per-language source honest",async()=>{
  const {state,plan}=setup();const {signature}=await import("../src/lib/receivables/compute");plan.dataSignature=signature(state);
  const expected=JSON.stringify(plan);
  applyAdvice(state,plan.id,await generateAdvice(state,plan,{configured:true,transport:async()=>JSON.stringify(response(state,plan))}),expected);
  const tasks=plan.tasks.map(t=>({id:t.id,method:t.method,noticeEn:t.noticeEn,noticeMs:t.noticeMs}));
  tasks[0]!.method="Extension negotiation";tasks[0]!.noticeEn="Human custom draft: synthetic demo.";
  const next=edit(state,plan.id,{tasks,notes:"Human edit"});
  assert.equal(next.tasks[0]!.noticeEnSource,"human");assert.equal(next.tasks[0]!.noticeMsSource,"rules_fallback");
  assert.equal(next.tasks[1]!.noticeEnSource,"openai");
});
test("outbound context excludes customer names, contact data, approval/audit history and document identifiers",()=>{
  const {state,plan}=setup(),context=JSON.stringify(businessContext(state,plan));
  for(const customer of state.customers)assert.ok(!context.includes(customer.name));
  for(const document of state.documents)assert.ok(!context.includes(document.number));
  assert.ok(!context.includes("approval"));assert.ok(!context.includes("auditLogs"));
  assert.equal(workspace(state).source,"Synthetic Demo Data · shared administrator sandbox");
});
test("a retry never overwrites a draft that already contains saved human changes",async()=>{
  const {state,plan}=setup();const {signature}=await import("../src/lib/receivables/compute");plan.dataSignature=signature(state);
  const tasks=plan.tasks.map(t=>({id:t.id,method:t.method,noticeEn:t.noticeEn,noticeMs:t.noticeMs}));
  tasks[0]!.noticeEn="Human-saved synthetic collection draft. Keep this wording.";
  const edited=edit(state,plan.id,{tasks,notes:"Already manually reviewed"}),snapshot=JSON.stringify(edited);
  const result=await generateAdvice(state,edited,{configured:true,transport:async()=>JSON.stringify(response(state,edited))});
  applyAdvice(state,edited.id,result,snapshot);
  assert.equal(JSON.stringify(edited),snapshot);
  assert.equal(state.auditLogs.at(-1)!.type,"AI generation discarded");
});
