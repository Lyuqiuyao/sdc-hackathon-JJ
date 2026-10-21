import test from "node:test";
import assert from "node:assert/strict";
import { seedState } from "../src/lib/receivables/seed";
import { generateAdvice, createOpenAITransport } from "../src/lib/receivables/ai-provider";
import { openaiJsonSchema, responseJsonSchema, responseSchema } from "../src/lib/receivables/ai-schema";
import { workspace } from "../src/lib/receivables/service";
import { GetWorkspaceResponse } from "@workspace/api-zod";

test("wire schema keeps every object strict and required; local bounds remain intact",()=>{
  const walk=(schema:any)=>{
    if(schema.type==="object"){
      assert.equal(schema.additionalProperties,false);
      assert.deepEqual([...schema.required].sort(),Object.keys(schema.properties).sort());
      Object.values(schema.properties).forEach(walk);
    }
    if(schema.items)walk(schema.items);
  };
  walk(openaiJsonSchema);assert.equal(openaiJsonSchema.$schema,undefined);
  assert.ok(JSON.stringify(responseJsonSchema).includes("minLength"));
  assert.equal(responseSchema.safeParse({riskExplanation:"short",tasks:[]}).success,false);
});
test("retired Gemini setting never invokes either provider and old records still parse",async()=>{
  const state=seedState();state.settings.aiMode="gemini";let calls=0;
  const result=await generateAdvice(state,state.plans[0]!,{configured:true,transport:async()=>{calls++;return "";}});
  assert.equal(calls,0);assert.equal(result.generation.reasonCode,"legacy_provider_retired");
  const plan=state.plans[0]!;plan.mode="gemini";plan.providerMode="gemini";
  GetWorkspaceResponse.parse(workspace(state));
});
test("official SDK API failure makes one request, no automatic retries",async()=>{
  const state=seedState();state.settings.aiMode="openai";let calls=0;
  const transport=createOpenAITransport({fetch:async()=>{
    calls++;return new Response(JSON.stringify({error:{message:"PRIVATE",type:"server_error"}}),
      {status:504,headers:{"content-type":"application/json"}});
  }});
  const result=await generateAdvice(state,state.plans[0]!,{configured:true,transport});
  assert.equal(calls,1);assert.equal(result.generation.reasonCode,"api_error");
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
});
test("successful HTTP with incomplete or empty model response cannot be accepted",async()=>{
  for(const status of ["incomplete","completed"]){
    const state=seedState();state.settings.aiMode="openai";
    const transport=createOpenAITransport({fetch:async()=>new Response(JSON.stringify({
      id:"resp_synthetic",object:"response",status,output:[]}),{status:200,headers:{"content-type":"application/json"}})});
    const result=await generateAdvice(state,state.plans[0]!,{configured:true,transport});
    assert.equal(result.providerMode,"rules_fallback");
    assert.equal(result.generation.reasonCode,status==="incomplete"?"api_error":"invalid_response");
  }
});
