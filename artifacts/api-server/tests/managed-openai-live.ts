import assert from "node:assert/strict";
import { seedState } from "../src/lib/receivables/seed";
import { generate, applyAdvice, decide, execute } from "../src/lib/receivables/service";
import { createOpenAITransport, generateAdvice, openaiConfigured } from "../src/lib/receivables/ai-provider";

// Future verification ONLY after separate authorization; never imported by tests.
if(!process.argv.includes("--allow-managed-live") || !openaiConfigured()){
  console.log(JSON.stringify({result:"NOT_RUN",reason:"Explicit live opt-in and managed configuration required."}));
  process.exit(2);
}
const state=seedState();state.settings.aiMode="openai";
const plan=generate(state,{}),before=JSON.stringify({invoices:state.invoices,settings:state.settings,documents:state.documents});
let calls=0,httpStatus:number|undefined,requestId:string|undefined;
const target=new URL(`${process.env.AI_INTEGRATIONS_OPENAI_BASE_URL!.replace(/\/$/,"")}/responses`);
if(target.protocol!=="https:"||target.hostname==="api.openai.com"||target.username||target.password||target.search)
  throw Error("Managed live target rejected");
const transport=createOpenAITransport({fetch:async(input,init)=>{
  if(String(input)!==target.href||++calls>1)throw Error("Unexpected managed target or retry");
  const r=await globalThis.fetch(input,{...init,redirect:"error"});
  httpStatus=r.status;const id=r.headers.get("x-request-id");
  if(id&&/^[A-Za-z0-9_.:-]{1,160}$/.test(id))requestId=id;
  return r;
}});
const result=await generateAdvice(state,plan,{transport});
if(result.providerMode!=="openai"){
  console.log(JSON.stringify({result:"FALLBACK_ONLY",calls,httpStatus,requestId,generation:result.generation}));
  process.exitCode=1;
}else{
  applyAdvice(state,plan.id,result,JSON.stringify(plan));
  assert.equal(plan.aiGeneration?.connectionMode,"replit_managed");
  assert.throws(()=>execute(state,plan.id),/not been approved/);
  decide(state,plan.id,{decision:"approve",notes:"Synthetic managed-live verification"});
  execute(state,plan.id);
  assert.equal(JSON.stringify({invoices:state.invoices,settings:state.settings,documents:state.documents}),before);
  console.log(JSON.stringify({result:"PASS",calls,httpStatus,requestId,generation:result.generation,
    tasks:plan.tasks.length,approvalGateVerified:true,financialDataUnchanged:true}));
}
