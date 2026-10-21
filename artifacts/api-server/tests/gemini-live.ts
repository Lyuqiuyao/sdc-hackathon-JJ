import assert from "node:assert/strict";
import { seedState } from "../src/lib/receivables/seed";
import { generate, applyAdvice, decide, execute } from "../src/lib/receivables/service";
import { generateAdvice, geminiConfigured } from "../src/lib/receivables/ai-provider";

// This is a REAL Google request, no mocks or test transport. Only synthetic,
// in-memory records are used; no customer/workspace data is modified.
if (!geminiConfigured()) {
  console.log(JSON.stringify({result:"NOT_RUN",reason:"GEMINI_API_KEY is missing; no live API request issued."}));
  process.exitCode=2;
} else {
  const state=seedState();state.settings.aiMode="gemini";
  const plan=generate(state,{});
  const before=JSON.stringify({invoices:state.invoices,settings:state.settings,documents:state.documents});
  const snapshot=JSON.stringify(plan);
  const result=await generateAdvice(state,plan);
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
