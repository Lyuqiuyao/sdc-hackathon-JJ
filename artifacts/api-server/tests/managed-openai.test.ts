import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { seedState } from "../src/lib/receivables/seed";
import { businessContext, createOpenAITransport, generateAdvice, openaiConfigured,
  loadManagedOpenAIClient, OPENAI_TIMEOUT_MS } from "../src/lib/receivables/ai-provider";
import { applyAdvice, workspace, generate } from "../src/lib/receivables/service";
import { GetWorkspaceResponse } from "@workspace/api-zod";

function fixture() {
  const state=seedState();state.settings.aiMode="openai";
  const plan=generate(state,{}),ctx=businessContext(state,plan);
  const prose="Synthetic conditional proposal only; a person must verify and agree.";
  const data={riskExplanation:"Synthetic liquidity pressure requires review; the supplied scoring and forecasts remain authoritative.",
    tasks:ctx.tasks.map(t=>({
      taskId:t.taskId,reasoning:prose,assumptions:[prose],uncertainties:[prose],
      esgEvidence:t.esg.evidence,esgRating:t.esg.rating,esgConsiderations:prose,
      strategies:["payment_full","installments","extension"].map(kind=>({kind,proposal:prose,conditions:prose})),
      noticeEn:"Synthetic Demo draft — no message sent. Dear Accounts Payable, please contact finance to discuss the supplied invoice.",
      noticeMs:"Draf demo sintetik — tiada mesej dihantar. Tuan/Puan, sila hubungi pihak kewangan untuk berbincang.",
    }))};
  return {state,plan,data};
}
function mockResponse(text:string,status="completed") {
  return new Response(JSON.stringify({id:"resp_synthetic",object:"response",status,
    ...(status==="incomplete"?{incomplete_details:{reason:"max_output_tokens"}}:{}),
    output:[{type:"message",role:"assistant",content:[{type:"output_text",text,annotations:[]}]}]}),
    {status:200,headers:{"content-type":"application/json"}});
}

test("configuration requires both managed variables; private credentials never satisfy it",()=>{
  for(const env of [{},{OPENAI_API_KEY:"synthetic-private"},
    {AI_INTEGRATIONS_OPENAI_BASE_URL:"https://synthetic.invalid",OPENAI_API_KEY:"synthetic-private"},
    {AI_INTEGRATIONS_OPENAI_API_KEY:"synthetic-managed",OPENAI_API_KEY:"synthetic-private"}])
    assert.equal(openaiConfigured(env),false);
  assert.equal(openaiConfigured({AI_INTEGRATIONS_OPENAI_BASE_URL:"https://synthetic.invalid",
    AI_INTEGRATIONS_OPENAI_API_KEY:"synthetic-managed"}),true);
});
test("missing managed configuration with private key present never calls transport",async()=>{
  // These worker values are synthetic, supplied by the offline test runner.
  const base=process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,key=process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  assert.equal(process.env.OPENAI_API_KEY,"synthetic-private-key-must-never-be-used");
  try{
    delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const {state,plan}=fixture();let calls=0;
    const result=await generateAdvice(state,plan,{transport:async()=>{calls++;throw Error("Must not call");}});
    assert.equal(calls,0);assert.equal(result.generation.reasonCode,"missing_managed_config");
    assert.equal(result.generation.connectionMode,"replit_managed");
    assert.equal(workspace(state).aiAvailable,false);
  }finally{
    if(base!==undefined)process.env.AI_INTEGRATIONS_OPENAI_BASE_URL=base;
    if(key!==undefined)process.env.AI_INTEGRATIONS_OPENAI_API_KEY=key;
  }
});
test("application loads and Rules works despite actual official-client initialization failure",()=>{
  for(const missing of ["AI_INTEGRATIONS_OPENAI_BASE_URL","AI_INTEGRATIONS_OPENAI_API_KEY"]){
    const env:NodeJS.ProcessEnv={PATH:process.env.PATH,
      OPENAI_API_KEY:"synthetic-private-key-must-never-be-used",
      AI_INTEGRATIONS_OPENAI_BASE_URL:"https://managed-openai.synthetic.invalid/proxy/v1",
      AI_INTEGRATIONS_OPENAI_API_KEY:"synthetic-managed-credential-not-real"};
    delete env[missing];
    const result=spawnSync(process.execPath,[fileURLToPath(new URL("./managed-startup.mjs",import.meta.url))],
      {env,encoding:"utf8"});
    assert.equal(result.status,0,"Isolated startup probe failed");
    assert.equal(JSON.parse(result.stdout.trim()).rulesUsable,true);
  }
});
test("client-loader failure is contained, sanitized and never falls back to private transport",async()=>{
  const {state,plan}=fixture();let loads=0;
  const transport=createOpenAITransport({loadClient:async()=>{loads++;throw Error("PRIVATE_INITIALIZATION_ERROR");}});
  const result=await generateAdvice(state,plan,{configured:true,transport});
  assert.equal(loads,1);assert.equal(result.providerMode,"rules_fallback");assert.equal(result.advice,undefined);
  assert.equal(result.generation.reasonCode,"api_error");assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  state.settings.aiMode="rules";assert.equal((await generateAdvice(state,plan)).generation.reasonCode,"rules_selected");
});
test("official template uses managed target/credential with strict output, 45s and zero retries",async()=>{
  const {state,plan,data}=fixture();let calls=0;
  const observed:{url?:string;headers?:Headers;signal?:boolean;body?:any;timeout?:number;maxRetries?:number}={};
  const transport=createOpenAITransport({loadClient:async()=>{
    const client=await loadManagedOpenAIClient();
    assert.equal(client.baseURL,"https://managed-openai.synthetic.invalid/proxy/v1");
    return new Proxy(client,{get(target,key,receiver){
      if(key==="withOptions")return (options:Parameters<typeof client.withOptions>[0])=>{
        const configured=target.withOptions(options);
        observed.timeout=configured.timeout;observed.maxRetries=configured.maxRetries;
        return configured;
      };
      return Reflect.get(target,key,receiver);
    }});
  },fetch:async(input,init)=>{
    calls++;observed.url=String(input);observed.headers=new Headers(init?.headers);
    observed.signal=Boolean(init?.signal);observed.body=JSON.parse(String(init?.body));
    return mockResponse(JSON.stringify(data));
  }});
  const result=await generateAdvice(state,plan,{configured:true,transport});
  // Assert outside the production fallback catch, so assertion failures remain visible.
  assert.equal(observed.timeout,OPENAI_TIMEOUT_MS);assert.equal(observed.maxRetries,0);
  assert.equal(observed.url,"https://managed-openai.synthetic.invalid/proxy/v1/responses");
  assert.equal(observed.headers?.get("authorization"),"Bearer synthetic-managed-credential-not-real");
  assert.equal(observed.headers?.get("x-stainless-retry-count"),"0");
  assert.equal(observed.signal,true);assert.equal(observed.body.max_output_tokens,8192);
  assert.equal(observed.body.store,false);assert.equal(observed.body.text.format.strict,true);
  assert.equal(observed.body.text.format.type,"json_schema");
  assert.equal(calls,1);assert.equal(result.providerMode,"openai");
  assert.equal(result.generation.connectionMode,"replit_managed");
});
test("HTTP 429 from managed route falls back with one attempt and no credential failover",async()=>{
  const {state,plan}=fixture();let calls=0;
  const result=await generateAdvice(state,plan,{configured:true,transport:createOpenAITransport({fetch:async()=>{
    calls++;return new Response(JSON.stringify({error:{message:"SYNTHETIC",type:"rate_limit_error"}}),
      {status:429,headers:{"content-type":"application/json"}});
  }})});
  assert.equal(calls,1);assert.equal(result.generation.reasonCode,"api_error");assert.equal(result.advice,undefined);
});
test("incomplete status rejects even valid JSON; truncated, partial, schema and ESG failures reject whole response",async()=>{
  const {state,plan,data}=fixture(),before=JSON.stringify(plan);
  const incomplete=await generateAdvice(state,plan,{configured:true,transport:createOpenAITransport({
    fetch:async()=>mockResponse(JSON.stringify(data),"incomplete")})});
  assert.equal(incomplete.providerMode,"rules_fallback");assert.equal(incomplete.advice,undefined);
  for(const kind of ["truncated","missing_task","schema","esg"]){
    const invalid=structuredClone(data);
    if(kind==="missing_task")invalid.tasks.pop();
    if(kind==="schema")invalid.tasks[0]!.strategies.pop();
    if(kind==="esg")invalid.tasks.find(t=>t.esgEvidence==="unknown")!.esgRating="C";
    const raw=kind==="truncated"?JSON.stringify(invalid).slice(0,-30):JSON.stringify(invalid);
    const result=await generateAdvice(state,plan,{configured:true,transport:async()=>raw});
    assert.equal(result.providerMode,"rules_fallback",kind);assert.equal(result.generation.reasonCode,"invalid_response",kind);
    assert.equal(result.advice,undefined);assert.equal(JSON.stringify(plan),before);
  }
});
test("new managed generation audit preserves connection metadata; historical records stay unlabelled",async()=>{
  const {state,plan,data}=fixture();
  const {signature}=await import("../src/lib/receivables/compute");plan.dataSignature=signature(state);
  const previous=structuredClone(plan);previous.id="PLN-synthetic-historical";previous.providerMode="openai";
  previous.aiGeneration={requestedProvider:"openai",status:"success",reasonCode:"validated_response",
    model:"legacy-synthetic-model",generatedAt:"2026-01-01T00:00:00.000Z",durationMs:1};
  state.plans.push(previous);const before=JSON.stringify(previous);
  const result=await generateAdvice(state,plan,{configured:true,transport:async()=>JSON.stringify(data)});
  applyAdvice(state,plan.id,result,JSON.stringify(plan));
  assert.equal(plan.aiGeneration?.connectionMode,"replit_managed");
  assert.equal(JSON.parse(state.auditLogs.at(-1)!.after).connectionMode,"replit_managed");
  assert.equal(JSON.stringify(previous),before);assert.equal(previous.aiGeneration?.connectionMode,undefined);
  GetWorkspaceResponse.parse(workspace(state));
});
