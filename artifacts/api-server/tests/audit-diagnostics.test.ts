import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { seedState } from "../src/lib/receivables/seed";
import { generate, decide } from "../src/lib/receivables/service";
import { businessContext, generateAdvice } from "../src/lib/receivables/ai-provider";
import { createPlanEnricher } from "../src/lib/receivables/ai-enrichment";
import { appendPlanSnapshot } from "../src/lib/receivables/advice-snapshots";
import { AdviceDiagnostics } from "../src/lib/receivables/ai-diagnostics";
import { validEsg } from "../src/lib/receivables/compute";
import { sharedMemoryStore } from "./memory-advice-repository";
import { syntheticResponse, syntheticAdvice } from "./synthetic-advice";
function fixture() {
  const state=seedState();state.settings.aiMode="openai";
  const plan=generate(state,{}),wire=syntheticResponse(businessContext(state,plan));
  return {state,plan,wire};
}
test("successful diagnostics trace checks, unknown neutral projection and notice template replacements",async()=>{
  const {state,plan}=fixture(),before=JSON.stringify(state),r=await syntheticAdvice(state,plan);
  assert.equal(r.providerMode,"openai");
  const d=r.generation.diagnostics!;
  assert.ok(d.some(x=>x.stage==="schema"&&x.outcome==="passed"));
  assert.ok(d.some(x=>x.path.endsWith(".noticeEn")&&x.reasonCode==="server_communication_template"));
  assert.ok(d.some(x=>x.path.endsWith(".conditions")&&x.reasonCode==="conditional_consent_guard"));
  for(const t of plan.tasks.filter(t=>!validEsg(state,t.customerId)))
    assert.ok(d.some(x=>x.taskId===t.id&&x.reasonCode==="unknown_esg_neutral_projection"));
  assert.ok(d.every(x=>!x.taskId||plan.tasks.some(t=>t.id===x.taskId)));
  assert.equal(JSON.stringify(state),before);
});
for(const problem of ["json","missing_field","extra_field","wrong_type","duplicate_id","esg_mismatch","unsafe_notice"] as const)
test(`failure diagnostics: ${problem}, no raw values or invented passes`,async()=>{
  const {state,plan,wire}=fixture();let raw:string;
  if(problem==="json")raw="Authorization: Bearer synthetic-secret";
  else {
    if(problem==="missing_field")delete (wire.tasks[0] as any).noticeMs;
    if(problem==="extra_field")(wire as any)["Authorization_synthetic-secret"]={api_key:"DO_NOT_STORE"};
    if(problem==="wrong_type")(wire.tasks[0] as any).noticeMs={secret:"DO_NOT_STORE"};
    if(problem==="duplicate_id")wire.tasks[1]!.taskId=wire.tasks[0]!.taskId;
    if(problem==="esg_mismatch")wire.tasks[0]!.esgRating=wire.tasks[0]!.esgRating==="A"?"B":"A";
    if(problem==="unsafe_notice")wire.tasks[0]!.noticeEn+=" Pay MYR 999999999.99.";
    raw=JSON.stringify(wire);
  }
  const result=await generateAdvice(state,plan,{configured:true,transport:async()=>raw});
  assert.equal(result.providerMode,"rules_fallback");assert.equal(result.advice,undefined);
  const d=result.generation.diagnostics!,text=JSON.stringify(d);
  assert.ok(d.some(x=>x.outcome==="rejected"));
  assert.ok(d.some(x=>x.reasonCode==="whole_response_rejected"));
  for(const value of ["DO_NOT_STORE","synthetic-secret","999999999"])assert.ok(!text.includes(value));
  if(problem==="json")assert.ok(d.some(x=>x.stage==="schema"&&x.outcome==="not_run"));
  if(["missing_field","extra_field","wrong_type"].includes(problem)) {
    assert.ok(d.some(x=>x.stage==="schema"&&x.outcome==="rejected"));
    assert.ok(!d.some(x=>x.stage==="business"&&x.outcome==="passed"));
  }
  if(problem==="missing_field")assert.ok(d.some(x=>x.path==="tasks[0].noticeMs"&&x.outcome==="rejected"));
  if(problem==="unsafe_notice")assert.ok(d.some(x=>x.path==="tasks[0].noticeEn"&&x.outcome==="rejected"));
});
test("Rules/config missing/transport error/timeout distinguish checks not executed",async()=>{
  for(const mode of ["rules","missing","http","timeout"] as const) {
    const {state,plan}=fixture();if(mode==="rules")state.settings.aiMode="rules";
    let calls=0;
    const r=await generateAdvice(state,plan,{configured:mode!=="missing",timeoutMs:2,transport:async()=>{
      calls++;if(mode==="timeout")await new Promise(r=>setTimeout(r,8));
      throw Error("Authorization: Bearer DO_NOT_STORE");
    }});
    assert.equal(r.providerMode,"rules_fallback");
    assert.equal(calls,["rules","missing"].includes(mode)?0:1);
    const rows=r.generation.diagnostics!;
    assert.ok(!rows.some(d=>d.stage==="schema"&&d.outcome==="passed"));
    assert.ok(!JSON.stringify(rows).includes("DO_NOT_STORE"));
    assert.ok(rows.some(d=>d.stage==="schema"&&d.outcome==="not_run"));
  }
});
test("new applied and discarded snapshots retain sanitized diagnostics/model but never raw response",async()=>{
  const {state,plan}=fixture(),repo=sharedMemoryStore(state).repository();
  await createPlanEnricher(repo,syntheticAdvice)(plan.id);
  const current=await repo.readState(),applied=current.adviceSnapshots!.find(s=>s.status==="applied")!;
  assert.equal(applied.model,"gpt-5-mini");assert.equal(applied.modelOrigin,"request_config");
  assert.equal(applied.rawResponseRetained,false);assert.ok(applied.diagnostics!.length>0);
  const result=await syntheticAdvice(state,plan);
  const discarded=appendPlanSnapshot(state,plan,{status:"discarded",reasonCode:"lease_lost",metadataOnly:true,result});
  assert.equal(discarded.model,"gpt-5-mini");assert.ok(discarded.diagnostics!.length>0);
  assert.equal(JSON.parse(discarded.contentJson).effectiveAdvice,undefined);
  const before=JSON.stringify(applied);
  const approved=await repo.changeState(s=>decide(s,plan.id,{decision:"approve",notes:"Synthetic decision"}));
  const next=await repo.readState();
  assert.equal(JSON.stringify(next.adviceSnapshots!.find(s=>s.id===applied.id)),before);
  assert.equal(JSON.parse(next.adviceSnapshots!.at(-1)!.contentJson).approval.actor,"Demo Admin");
  assert.equal(approved.status,"Approved");
});
test("diagnostic paths and task IDs are allowlisted; truncation is explicit",()=>{
  const {plan}=fixture(),d=new AdviceDiagnostics(plan);
  d.schemaIssues([{code:"unrecognized_keys",path:["tasks",0,"Authorization_secret"]}]);
  d.record("business","tasks[0].noticeEn","rejected","Authorization: DO_NOT_STORE","unknown-private-id");
  assert.ok(!JSON.stringify(d.rows).includes("Authorization"));assert.ok(!JSON.stringify(d.rows).includes("unknown-private-id"));
  assert.equal(d.rows[0]!.path,"tasks[0]");
  for(let i=0;i<4100;i++)d.record("schema","$","passed","strict_schema_valid");
  assert.equal(d.rows.length,4000);assert.equal(d.rows.at(-1)!.reasonCode,"diagnostics_truncated");
});
test("admin-only route/nav and read-only ESG API structure: no removal of shared customer/SDK modules",async()=>{
  const front=await readFile("../receivables-admin/src/App.tsx","utf8");
  for(const route of ["/customers","/esg-documents","/audit-logs","/approvals","/execution-results"])
    assert.ok(front.includes(`path="${route}"`));
  assert.ok(front.includes("<Route component={NotFound}"));
  const nav=await readFile("../receivables-admin/src/components/shell.tsx","utf8");
  assert.ok(!/\/certifier|\/customer-portal|\/client-portal/.test(front+nav));
  const routes=await readFile("src/routes/receivables.ts","utf8");
  assert.ok(routes.includes('router.get("/plans/:id/advice-snapshots"'));
  assert.ok(!/router\.(post|put|patch)\(["']\/(?:certifier|customer-portal|documents\/:id\/(?:approve|reject))/.test(routes));
});
