import test from "node:test";
import assert from "node:assert/strict";
import { seedState } from "../src/lib/receivables/seed";
import { seedState as legacySeed } from "./legacy-fixture";
import { buildPlan } from "../src/lib/receivables/planner";
import { SCORING, splitScores } from "../src/lib/receivables/scoring";
import { calculateRisk, signature } from "../src/lib/receivables/compute";
import { saveProfile, submitSedg } from "../src/lib/receivables/company";
import { generate, edit, decide, execute, workspace, settings } from "../src/lib/receivables/service";
import { syntheticAdvice, syntheticResponse } from "./synthetic-advice";
import { businessContext, generateAdvice } from "../src/lib/receivables/ai-provider";
import type { CollectionPlan } from "@workspace/api-zod";
import type { DemoState } from "../src/lib/receivables/model";

const edits = (p: CollectionPlan) => p.tasks.map(({ id, method, noticeEn, noticeMs }) => ({ id, method, noticeEn, noticeMs }));
function reviewed(state: DemoState, plan = state.plans[0]!) {
  for (const customerId of new Set(plan.tasks.filter(t => t.queue === "two_dimensional").map(t => t.customerId)))
    plan = edit(state, plan.id, { notes: "", tasks: edits(plan), expectedVersion: plan.version,
      customerReview: { customerId, decision: "negotiable_extension", reason: "Synthetic human review: discuss timing without changing contractual dates." } });
  return plan;
}
function merged(state: DemoState) {
  const plan = reviewed(state);
  return edit(state, plan.id, { tasks: edits(plan).reverse(), notes: "", expectedVersion: plan.version,
    mergeReason: "Synthetic administrator-confirmed execution order after individual company reviews." });
}
const sedg = { environmental: "Synthetic energy usage declaration.", social: "Synthetic worker safety declaration.",
  governance: "Synthetic governance declaration.", sourceReference: "Synthetic structured SEDG example", syntheticConfirmed: true };

test("approved split weights, normalization caps and ESG mappings are exact; no missing-ESG numeric surrogate", () => {
  assert.deepEqual(SCORING.twoDimensional, {overdue:60,amount:40});
  assert.deepEqual(SCORING.threeDimensional, {overdue:51,amount:34,esg:15});
  assert.deepEqual(splitScores(45,5_000_000,"unknown"), {overdueScore:50,amountScore:50,esgScore:null,score:50});
  assert.equal(splitScores(45,5_000_000,"A").score,47);
  assert.equal(splitScores(45,5_000_000,"B").score,50);
  assert.equal(splitScores(45,5_000_000,"C").score,53);
  assert.equal(splitScores(900,100_000_000,"unknown").score,100);
  assert.equal(splitScores(-10,1_000_000,"unknown").overdueScore,0);
});
test("new invoice queues are separately deterministic; late fee and importance do not affect ranking", () => {
  const s=seedState(),p=s.plans[0]!;
  for(const queue of ["two_dimensional","three_dimensional"]) {
    const rows=p.tasks.filter(t=>t.queue===queue);
    assert.ok(rows.length);
    assert.deepEqual(rows.map(t=>t.queueRank),rows.map((_,i)=>i+1));
    assert.ok(rows.every((t,i)=>i===0||rows[i-1]!.score>=t.score));
  }
  assert.equal(new Set(p.tasks.map(t=>t.invoiceId)).size,p.tasks.length);
  assert.ok(p.tasks.every(t=>!["Cancelled","Paid"].includes(s.invoices.find(i=>i.id===t.invoiceId)!.status)));
  const before=p.tasks.map(t=>[t.invoiceId,t.score]);
  s.invoices.forEach(i=>i.lateFeeBps=9999);s.customers.forEach(c=>c.importance="Low");
  assert.deepEqual(buildPlan(s,p.riskEventId,s.settings.weights).tasks.map(t=>[t.invoiceId,t.score]),before);
  assert.equal(p.manualMerge,undefined);
});
test("customer stored rating controls branching; mismatching or expired evidence cannot manufacture a rating", async()=>{
  const s=seedState();s.customers[0]!.esgRating="unknown";
  const p=generate(s,{});
  assert.ok(p.tasks.filter(t=>t.customerId===s.customers[0]!.id).every(t=>t.queue==="two_dimensional"&&t.esgScore===null));
  s.settings.aiMode="openai";
  const fresh=generate(s,{}),context=businessContext(s,fresh);
  const input=context.tasks.find(t=>t.taskId===fresh.tasks.find(t=>t.customerId==="CUS-005")!.id)!;
  assert.deepEqual({rating:input.esg.rating,evidence:input.esg.evidence},{rating:"C",evidence:"unknown"});
  const result=await syntheticAdvice(s,fresh);
  assert.equal(result.generation.status,"success");
  assert.ok(result.advice!.tasks.some(t=>t.esgRating==="C"&&t.esgEvidence==="unknown"));
});
test("unknown ESG remains 2D with or without SEDG; declarations do not certify or change financial data",()=>{
  const s=seedState(),before=JSON.stringify({customers:s.customers,invoices:s.invoices,documents:s.documents,cash:s.settings.cashCents});
  const row=submitSedg(s,"CUS-003",sedg);
  assert.equal(row.status,"Submitted - unverified");assert.equal(s.sedgSubmissions!.length,1);
  assert.equal(JSON.stringify({customers:s.customers,invoices:s.invoices,documents:s.documents,cash:s.settings.cashCents}),before);
  assert.ok(workspace(s).sedgSubmissions?.some(x=>x.id===row.id));
  const p=generate(s,{});
  assert.ok(p.tasks.filter(t=>t.customerId==="CUS-003").every(t=>t.queue==="two_dimensional"&&t.esgScore===null));
  assert.throws(()=>submitSedg(s,"CUS-003",{...sedg,syntheticConfirmed:false}),/Confirm/);
  assert.throws(()=>submitSedg(s,"missing",sedg),/not found/);
});
test("company profile uses optimistic version and explicit synthetic attestation, not inferred certification",()=>{
  const s=seedState(),c=s.customers[2]!;
  const input={industry:c.industry,paymentHistory:c.paymentHistory,profileSummary:"Synthetic structured company summary.",
    existingEsgRating:"B" as const,expectedVersion:0,syntheticConfirmed:true};
  assert.throws(()=>saveProfile(s,c.id,{...input,syntheticConfirmed:false}),/synthetic/);
  saveProfile(s,c.id,input);assert.equal(c.profileVersion,1);assert.equal(c.esgRating,"B");
  assert.throws(()=>saveProfile(s,c.id,input),/Reload/);
  assert.equal(s.documents.filter(d=>d.customerId===c.id&&d.status==="Approved").length,0);
  assert.equal(generate(s,{}).tasks.find(t=>t.customerId===c.id)!.queue,"three_dimensional");
});
test("all unknown customers need review plus explicit manual merge; partial review never opens approval",()=>{
  const s=seedState(),p=s.plans[0]!;
  assert.throws(()=>decide(s,p.id,{decision:"approve",notes:""}),/reviews/);
  assert.throws(()=>edit(s,p.id,{tasks:edits(p),notes:"",mergeReason:"Proposed order"}),/reviews/);
  assert.equal(p.status,"Pending");
  const q=reviewed(s);
  assert.throws(()=>decide(s,q.id,{decision:"approve",notes:""}),/merged order/);
  for(const r of q.customerReviews!) {
    assert.equal(r.actor,"Demo Admin");
    assert.ok(q.tasks.filter(t=>t.customerId===r.customerId).every(t=>t.method==="Extension negotiation"));
  }
  const m=edit(s,q.id,{tasks:edits(q),notes:"",mergeReason:"Reviewed and merged final order"});
  decide(s,m.id,{decision:"approve",notes:"Synthetic approved version"});
  assert.equal(m.status,"Approved");
});
test("human edits preserve deterministic scores/queue ranks, reset merge and require reasons",()=>{
  const s=seedState(),p=merged(s);
  assert.throws(()=>edit(s,p.id,{tasks:edits(p),notes:""}),/reason/);
  const before=p.tasks.map(t=>[t.invoiceId,t.score,t.queue,t.queueRank]).sort();
  const q=edit(s,p.id,{tasks:edits(p).reverse(),notes:"Synthetic reordering reason",expectedVersion:p.version});
  assert.equal(q.manualMerge,undefined);
  assert.deepEqual(q.tasks.map(t=>[t.invoiceId,t.score,t.queue,t.queueRank]).sort(),before);
  assert.equal(p.status,"Superseded");assert.ok(q.version>p.version);
  assert.throws(()=>edit(s,p.id,{tasks:edits(p),notes:"Stale tab"}),/immutable/);
  assert.throws(()=>edit(s,q.id,{tasks:edits(q),notes:"Wrong version",expectedVersion:q.version+1}),/version changed/);
});
test("new collection-method changes invalidate matching customer reviews",()=>{
  const s=seedState(),p=merged(s),tasks=edits(p);
  const target=p.tasks.find(t=>t.queue==="two_dimensional")!;
  tasks.find(t=>t.id===target.id)!.method="Overdue collection";
  const q=edit(s,p.id,{tasks,notes:"Synthetic method changed; review again"});
  assert.ok(!q.customerReviews?.some(r=>r.customerId===target.customerId));
  assert.throws(()=>decide(s,q.id,{decision:"approve",notes:""}),/reviews/);
});
test("profile and SEDG changes invalidate approval; defer recalculates queues and clears review/merge",()=>{
  for(const mutate of [(s:DemoState)=>submitSedg(s,"CUS-003",sedg),(s:DemoState)=>{s.customers[2]!.profileVersion=1;}]) {
    const s=seedState(),p=merged(s);mutate(s);
    assert.throws(()=>decide(s,p.id,{decision:"approve",notes:""}),/changed after/);
    const q=decide(s,p.id,{decision:"defer",notes:"Refresh changed evidence"});
    assert.equal(q.familyId,p.familyId);assert.ok(q.version>p.version);
    assert.equal(q.manualMerge,undefined);assert.deepEqual(q.customerReviews,[]);
  }
});
test("exact approved version executes idempotent simulated Email snapshots only",()=>{
  const s=seedState(),p=merged(s);
  assert.throws(()=>execute(s,p.id),/blocked/);
  decide(s,p.id,{decision:"approve",notes:"Synthetic execution approval"});
  const financial=JSON.stringify({invoices:s.invoices,cash:s.settings.cashCents,documents:s.documents});
  execute(s,p.id);const count=s.executions.length;execute(s,p.id);
  assert.equal(s.executions.length,count);assert.equal(count,p.tasks.length);
  assert.ok(s.executions.every(e=>e.channel==="Simulated Email"&&e.recipient!.endsWith("@example.invalid")&&e.planVersion===p.version));
  assert.ok(s.executions.every(e=>e.noticeEn!.includes("Synthetic Demo")&&e.noticeMs!.includes("Synthetic Demo")));
  assert.equal(JSON.stringify({invoices:s.invoices,cash:s.settings.cashCents,documents:s.documents}),financial);
  assert.ok(s.auditLogs.some(a=>a.type==="Customer collection review"));
  assert.ok(s.auditLogs.some(a=>a.type==="Human queue merge"));
  assert.ok((s.adviceSnapshots??[]).some(a=>a.status==="approved"&&a.approvalId));
});
test("invalid dates, amounts, associations and empty/duplicate invoice sets fail explicitly",()=>{
  for(const change of [(s:DemoState)=>{s.invoices[0]!.dueDate="2026-02-30";},
    (s:DemoState)=>{s.invoices[0]!.totalCents=NaN;},(s:DemoState)=>{s.invoices[0]!.customerId="missing";},
    (s:DemoState)=>{s.invoices.push(structuredClone(s.invoices[0]!));},(s:DemoState)=>{s.invoices=[];}]) {
    const s=seedState();change(s);assert.throws(()=>buildPlan(s,"test",s.settings.weights));
  }
});
test("new preflight verifies split scores and model context, rejects score/config mutations",async()=>{
  const s=seedState();s.settings.aiMode="openai";const p=generate(s,{});
  const context=businessContext(s,p);
  assert.deepEqual(context.weights,SCORING);
  assert.ok(context.tasks.some(t=>t.queue==="two_dimensional"&&t.esgScore===null));
  for(const change of [(q:CollectionPlan)=>{q.tasks[0]!.score+=1;},(q:CollectionPlan)=>{q.scoringSnapshot!.amountCapCents+=1;}]) {
    const copy=structuredClone(s),q=copy.plans.find(x=>x.id===p.id)!;change(q);
    let calls=0;const result=await generateAdvice(copy,q,{configured:true,transport:async()=>{calls++;return"unused";}});
    assert.equal(calls,0);assert.equal(result.providerMode,"rules_fallback");
  }
});
test("Han content is rejected at new-data and AI boundaries without retaining model raw text",async()=>{
  const s=seedState();assert.throws(()=>submitSedg(s,"CUS-003",{...sedg,environmental:"\u4e2d"}),/English/);
  s.settings.aiMode="openai";const p=generate(s,{});
  for(const escaped of [false,true]) {
    const result=await generateAdvice(s,p,{configured:true,transport:async ctx=>{
      const response=syntheticResponse(ctx);response.riskExplanation="\u4e2d";
      const raw=JSON.stringify(response);
      return escaped?raw.replace(/\p{Script=Han}/gu,c=>"\\u"+c.codePointAt(0)!.toString(16).padStart(4,"0")):raw;
    }});
    assert.equal(result.providerMode,"rules_fallback");assert.equal(result.advice,undefined);
    assert.ok(result.generation.diagnostics?.some(d=>d.reasonCode==="unsupported_output_language"));
  }
});
test("legacy plans keep four weights, independent risk formula and immutable snapshots",()=>{
  const legacy=legacySeed(),p=legacy.plans[0]!,snapshot=JSON.stringify(p);
  assert.equal(p.scoringSnapshot,undefined);assert.equal(p.tasks.find(t=>t.esgScore===50)!.esgScore,50);
  legacy.settings.scoringVersion="split_v2";
  const riskBefore=calculateRisk(legacy);
  const q=generate(legacy,{});
  assert.ok(q.scoringSnapshot);assert.equal(JSON.stringify(p),snapshot);
  const riskAfter=calculateRisk(legacy);
  assert.deepEqual({...riskAfter,createdAt:"timestamp"},{...riskBefore,createdAt:"timestamp"});
  assert.throws(()=>generate(legacy,{weights:legacy.settings.weights}),/Legacy weight overrides/);
  assert.throws(()=>settings(legacy,{...legacy.settings,scoringVersion:"legacy_v1"}),/historical/);
  assert.equal(q.dataSignature,signature(legacy));
});
test("JSONB object-key ordering preserves fingerprints and valid structured model preflight",async()=>{
  const s=seedState();s.settings.aiMode="openai";const p=generate(s,{});
  const reorder=(value:unknown):unknown=>Array.isArray(value)?value.map(reorder):
    value&&typeof value==="object"?Object.fromEntries(Object.entries(value).sort(([a],[b])=>b.localeCompare(a)).map(([key,v])=>[key,reorder(v)])):value;
  const loaded=reorder(s) as DemoState;
  assert.equal(signature(loaded),signature(s));
  const result=await syntheticAdvice(loaded,loaded.plans.find(q=>q.id===p.id)!);
  assert.equal(result.generation.status,"success");
});
