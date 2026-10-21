import assert from "node:assert/strict";
import { seedState } from "../src/lib/receivables/seed";
import { generate, applyAdvice, decide, execute } from "../src/lib/receivables/service";
import { generateAdvice } from "../src/lib/receivables/ai-provider";
import { geminiConfigured, officialGeminiTransport } from "../src/lib/receivables/legacy-gemini";

// This is a REAL Google request, no mocks or test transport. Only synthetic,
// in-memory records are used; no customer/workspace data is modified.
// Archived diagnostic entry point is disabled after migration; never call Google.
if (true) {
  console.log(JSON.stringify({result:"NOT_RUN",reason:"Gemini retired. Use test:openai-live."}));
  process.exitCode=2;
} else if (!geminiConfigured()) {
  console.log(JSON.stringify({result:"NOT_RUN",reason:"GEMINI_API_KEY is missing; no live API request issued."}));
  process.exitCode=2;
} else {
  const state=seedState();state.settings.aiMode="gemini";
  const plan=generate(state,{});
  const before=JSON.stringify({invoices:state.invoices,settings:state.settings,documents:state.documents});
  const snapshot=JSON.stringify(plan);
  const result=await generateAdvice(state,plan,{transport:async(context,signal)=>{
    try{return await officialGeminiTransport(context,signal);}
    catch(error){
      const e=error as {status?:number;message?:string};
      // Never print the raw exception/request. These allowlisted diagnostics
      // distinguish quota/permission/schema failures without exposing secrets.
      const text=String(e.message??"");
      const category=["API_KEY_INVALID","PERMISSION_DENIED","RESOURCE_EXHAUSTED","NOT_FOUND","INVALID_ARGUMENT","SERVICE_DISABLED"]
        .find(s=>text.includes(s))??"UNCLASSIFIED";
      const unknownFields=[...text.matchAll(/Unknown name [\\"]+([A-Za-z0-9_$]+)[\\"]+/g)].map(m=>m[1]);
      console.log(JSON.stringify({httpStatus:Number(e.status)||null,category,unknownFields}));
      throw error;
    }
  }});
  if(result.providerMode!=="gemini"){
    console.log(JSON.stringify({result:"FAIL",reason:result.generation.reasonCode,model:result.generation.model}));
    process.exitCode=1;
  } else {
    applyAdvice(state,plan.id,result,snapshot);
    assert.equal(plan.status,"Pending");
    assert.throws(()=>execute(state,plan.id),/not been approved/);
    decide(state,plan.id,{decision:"approve",notes:"Synthetic live-provider verification"});
    execute(state,plan.id);
    assert.equal(JSON.stringify({invoices:state.invoices,settings:state.settings,documents:state.documents}),before);
    console.log(JSON.stringify({result:"PASS",realApiRequest:true,providerMode:result.providerMode,
      status:result.generation.status,model:result.generation.model,durationMs:result.generation.durationMs,
      taskCount:plan.tasks.length,allHaveThreeStrategies:plan.tasks.every(t=>t.aiAdvice?.strategies.length===3),
      bilingualNotices:plan.tasks.every(t=>t.noticeEnSource==="gemini"&&t.noticeMsSource==="gemini"),
      approvalGateVerified:true,financialDataUnchanged:true}));
  }
}
