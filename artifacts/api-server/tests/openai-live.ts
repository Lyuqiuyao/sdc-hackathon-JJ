import assert from "node:assert/strict";
import { seedState } from "../src/lib/receivables/seed";
import { generate, applyAdvice, decide, execute } from "../src/lib/receivables/service";
import { generateAdvice, openaiConfigured, OPENAI_MODEL } from "../src/lib/receivables/ai-provider";
import { createLegacyOpenAITransport as createOpenAITransport } from "../src/lib/receivables/legacy-openai";

// Historical private-key diagnostic retained as source only. Never execute it.
console.log(JSON.stringify({result:"NOT_RUN",reason:"Archived private-key diagnostic; use the explicitly authorized managed live entry instead."}));
process.exit(2);

// One real request using only an isolated synthetic fixture. No repository/DB.
if (!openaiConfigured()) {
  console.log(JSON.stringify({result:"NOT_RUN",reason:"missing_api_key"}));
  process.exitCode=2;
} else {
  const state=seedState();state.settings.aiMode="openai";
  const plan=generate(state,{});
  const financial=JSON.stringify({invoices:state.invoices,settings:state.settings,documents:state.documents});
  const core=JSON.stringify(plan.tasks.map(t=>[t.invoiceId,t.outstandingCents,t.dueDate,t.score,t.rank,t.method]));
  let requests=0;
  const http: {domain?:string;path?:string;status?:number;requestId?:string;headersMs?:number;errorCode?:string}={};
  const started=Date.now();
  const transport=createOpenAITransport(process.env.OPENAI_API_KEY!,async(input,init)=>{
    const url=new URL(String(input));
    if(url.origin!=="https://api.openai.com"||url.pathname!=="/v1/responses"||++requests>1)
      throw new Error("Unexpected target or repeat request");
    http.domain=url.hostname;http.path=url.pathname;
    const response=await globalThis.fetch(input,{...init,redirect:"error"});
    http.status=response.status;http.headersMs=Date.now()-started;
    const id=response.headers.get("x-request-id");
    if(id&&/^[A-Za-z0-9_.:-]{1,160}$/.test(id))http.requestId=id;
    return response;
  });
  const result=await generateAdvice(state,plan,{transport:async(context,signal)=>{
    try{return await transport(context,signal);}
    catch(error){
      // Allowlist only; no raw exception, message, body, URL or headers.
      const e=error as {code?:unknown};
      if(typeof e.code==="string"&&["invalid_api_key","insufficient_quota","rate_limit_exceeded",
        "model_not_found","invalid_json_schema","unsupported_parameter"].includes(e.code))http.errorCode=e.code;
      throw error;
    }
  }});
  if(result.providerMode!=="openai"){
    console.log(JSON.stringify({result:"FALLBACK_ONLY",realApiRequest:requests===1,requests,...http,
      generation:result.generation}));
    process.exitCode=1;
  }else{
    applyAdvice(state,plan.id,result,JSON.stringify(plan));
    assert.equal(plan.providerMode,"openai");assert.equal(plan.aiGeneration?.model,OPENAI_MODEL);
    assert.equal(JSON.stringify(plan.tasks.map(t=>[t.invoiceId,t.outstandingCents,t.dueDate,t.score,t.rank,t.method])),core);
    assert.throws(()=>execute(state,plan.id),/not been approved/);
    decide(state,plan.id,{decision:"approve",notes:"Synthetic live OpenAI verification"});
    execute(state,plan.id);
    assert.equal(JSON.stringify({invoices:state.invoices,settings:state.settings,documents:state.documents}),financial);
    console.log(JSON.stringify({result:"PASS",realApiRequest:true,requests,...http,generation:result.generation,
      taskCount:plan.tasks.length,allHaveThreeStrategies:plan.tasks.every(t=>t.aiAdvice?.strategies.length===3),
      bilingualSources:plan.tasks.every(t=>t.noticeEnSource==="openai"&&t.noticeMsSource==="openai"),
      approvalGateVerified:true,deterministicResultsUnchanged:true,financialDataUnchanged:true,
      simulatedExecutions:state.executions.length}));
  }
}
