import test from "node:test";
import assert from "node:assert/strict";
import { seedState } from "../src/lib/receivables/seed";
import { generate, applyAdvice, edit, decide, execute, importData } from "../src/lib/receivables/service";
import { businessContext, generateAdvice } from "../src/lib/receivables/ai-provider";
import { createPlanEnricher, type AdviceRepository } from "../src/lib/receivables/ai-enrichment";
import { communication } from "../src/lib/receivables/communication";
import { ImportInvoicesBody } from "@workspace/api-zod";
import type { AdviceResponse } from "../src/lib/receivables/ai-schema";
import type { DemoState } from "../src/lib/receivables/model";

function fixture() {
  const state = seedState(); state.settings.aiMode = "openai";
  const plan = generate(state, {});
  const text = "Synthetic conditional proposal only; a person must verify and agree.";
  const data: AdviceResponse = {
    riskExplanation: "Synthetic cash pressure requires human review; the supplied forecast remains authoritative.",
    tasks: businessContext(state, plan).tasks.map(t => ({
      taskId: t.taskId, reasoning: text, assumptions: [text], uncertainties: [text],
      esgEvidence: t.esg.evidence as "verified" | "unknown",
      esgRating: t.esg.rating as "A" | "B" | "C" | "unknown",
      esgConsiderations: text,
      strategies: (["payment_full", "installments", "extension"] as const).map(kind => ({ kind, proposal: text, conditions: text })),
      noticeEn: "Synthetic Demo draft — no message sent. Dear Accounts Payable, please contact finance to discuss the supplied invoice.",
      noticeMs: "Draf demo sintetik — tiada mesej dihantar. Tuan/Puan, sila hubungi pihak kewangan untuk berbincang.",
    })),
  };
  return { state, plan, data };
}
const invalidInputs: [string, (s: DemoState, p: ReturnType<typeof generate>) => void, string][] = [
  ["missing plan version", s => { s.plans = []; }, "missing_plan"],
  ["missing risk", s => { s.riskEvents = []; }, "missing_risk"],
  ["missing customer", (s,p) => { s.customers = s.customers.filter(c => c.id !== p.tasks[0]!.customerId); }, "missing_customer"],
  ["missing invoice", (s,p) => { s.invoices = s.invoices.filter(i => i.id !== p.tasks[0]!.invoiceId); }, "missing_invoice"],
  ["empty tasks", (_,p) => { p.tasks = []; }, "empty_tasks"],
  ["duplicate ID", (_,p) => { p.tasks[1]!.id = p.tasks[0]!.id; }, "duplicate_task_id"],
  ["too many tasks", (_,p) => { p.tasks = Array.from({length:51}, () => structuredClone(p.tasks[0]!)); }, "context_limit"],
  ["stale settings", s => { s.settings.cashCents++; }, "stale_context"],
  ["not pending", (_,p) => { p.status = "Approved"; }, "plan_not_pending"],
  ["newer version", (s,p) => { s.plans.push({...structuredClone(p), id:"newer-synthetic", version:p.version+1}); }, "plan_superseded"],
  ["wrong association", (s,p) => { s.invoices.find(i=>i.id===p.tasks[0]!.invoiceId)!.customerId="missing"; }, "invalid_association"],
  ["wrong amount", (_,p) => { p.tasks[0]!.outstandingCents++; }, "invalid_business_data"],
  ["wrong date", (_,p) => { p.tasks[0]!.dueDate="2026-02-30"; }, "invalid_business_data"],
  ["wrong currency", (s,p) => { (s.invoices.find(i=>i.id===p.tasks[0]!.invoiceId)! as {currency:string}).currency="USD"; }, "invalid_business_data"],
  ["human modified", (s,p) => { edit(s,p.id,{tasks:p.tasks.map(t=>({id:t.id,method:t.method,noticeEn:t.noticeEn,noticeMs:t.noticeMs})),notes:"Synthetic protected version"}); const next=s.plans.at(-1)!; Object.assign(p,next); }, "human_modified"],
];
for (const [name, mutate, reason] of invalidInputs) test(`preflight ${name}: no Transport call`, async () => {
  const {state,plan}=fixture(); mutate(state,plan); let calls=0;
  const result=await generateAdvice(state,plan,{configured:true,transport:async()=>{calls++;return "{}";}});
  assert.equal(calls,0);assert.equal(result.generation.reasonCode,reason);
  assert.equal(result.providerMode,"rules_fallback");assert.equal(result.advice,undefined);
});
test("context preserves authoritative cents, MYR, dates, bps, scores and order",()=>{
  const {state,plan}=fixture(), context=businessContext(state,plan);
  assert.deepEqual(context.weights,plan.weights);
  context.tasks.forEach((t,n)=>{
    const task=plan.tasks[n]!, invoice=state.invoices.find(i=>i.id===task.invoiceId)!;
    assert.equal(t.taskId,task.id);assert.equal(t.rank,task.rank);assert.equal(t.score,task.score);
    assert.equal(t.outstandingMYR,(task.outstandingCents/100).toFixed(2));
    assert.equal(t.outstandingCents,invoice.totalCents-invoice.paidCents);
    assert.equal(t.dueDate,invoice.dueDate);assert.equal(t.annualLateFeeBps,invoice.lateFeeBps);
  });
});
test("exactly 50 tasks remains allowed without increasing the existing limit",async()=>{
  const state=seedState();state.settings.aiMode="openai";
  const invoice=state.invoices[0]!;
  state.invoices=Array.from({length:50},(_,n)=>({...structuredClone(invoice),id:`INV-SYNTH-${n}`,number:`SYNTH-${n}`}));
  const plan=generate(state,{});let calls=0;
  assert.equal(plan.tasks.length,50);
  const result=await generateAdvice(state,plan,{configured:true,transport:async()=>{calls++;return "invalid synthetic response";}});
  assert.equal(calls,1);assert.equal(result.generation.reasonCode,"invalid_response");
});
for (const [name, mutate] of [
  ["wrong amount", (d:AdviceResponse)=>{d.tasks[0]!.noticeEn+=" Outstanding MYR 999999999.99.";}],
  ["wrong date", (d:AdviceResponse)=>{d.tasks[0]!.noticeMs+=" Tarikh akhir 2099-12-31.";}],
  ["approved extension", (d:AdviceResponse)=>{d.tasks[0]!.noticeEn+=" Your extension has been approved.";}],
  ["Malay approved extension", (d:AdviceResponse)=>{d.tasks[0]!.noticeMs+=" Lanjutan telah diluluskan.";}],
  ["internal invented fee", (d:AdviceResponse)=>{d.tasks[0]!.strategies[0]!.proposal="Pay an additional fee of MYR 99 immediately.";}],
] as const) test(`unsafe business prose: ${name}`,async()=>{
  const {state,plan,data}=fixture();mutate(data);const before=JSON.stringify(plan);
  const result=await generateAdvice(state,plan,{configured:true,transport:async()=>JSON.stringify(data)});
  assert.equal(result.generation.reasonCode,"unsafe_content");assert.equal(result.advice,undefined);
  applyAdvice(state,plan.id,result,before);
  assert.deepEqual(plan.tasks,JSON.parse(before).tasks);assert.equal(plan.providerMode,"rules_fallback");
});
for (const field of ["risk","reasoning","assumptions","uncertainties","proposal","conditions","noticeEn","noticeMs"])
  test(`unknown ESG inference cannot pass via ${field}`,async()=>{
    const {state,plan,data}=fixture();
    const t=data.tasks.find(t=>t.esgEvidence==="unknown")!;
    const bad="Missing ESG certification proves poor sustainability and high bad-debt risk.";
    if(field==="risk")data.riskExplanation=bad;
    else if(field==="assumptions"||field==="uncertainties")t[field]=[bad];
    else if(field==="proposal"||field==="conditions")t.strategies[0]![field]=bad;
    else t[field as "reasoning"|"noticeEn"|"noticeMs"]+=` ${bad}`;
    const result=await generateAdvice(state,plan,{configured:true,transport:async()=>JSON.stringify(data)});
    assert.equal(result.generation.reasonCode,"unsafe_content");assert.equal(result.advice,undefined);
  });
test("all ESG prose is projected from records; notices are controlled templates with honest sources",async()=>{
  const {state,plan,data}=fixture();
  for(const t of data.tasks)t.esgConsiderations="Unverified ESG proves fraud and bad debt. This model claim must never survive.";
  const result=await generateAdvice(state,plan,{configured:true,transport:async()=>JSON.stringify(data)});
  assert.equal(result.providerMode,"openai");
  assert.equal(result.generation.contentPolicy,"server_controlled_v1");
  for(const t of result.advice!.tasks) {
    assert.ok(!t.esgConsiderations.includes("This model claim"));
    if(t.esgEvidence==="unknown")assert.match(t.esgConsiderations,/neutral treatment/);
    else assert.match(t.esgConsiderations,new RegExp(`rating ${t.esgRating}`));
    const task=plan.tasks.find(x=>x.id===t.taskId)!;
    assert.equal(t.noticeEn,communication(task,task.method).noticeEn);
    assert.equal(t.noticeMs,communication(task,task.method).noticeMs);
  }
  const baseline=JSON.stringify({invoices:state.invoices,documents:state.documents,settings:state.settings});
  applyAdvice(state,plan.id,result,JSON.stringify(plan));
  assert.ok(plan.tasks.every(t=>t.noticeEnSource==="rules_fallback" && t.noticeMsSource==="rules_fallback"));
  assert.throws(()=>execute(state,plan.id),/not been approved/);
  decide(state,plan.id,{decision:"approve",notes:"Synthetic safety test"});execute(state,plan.id);
  assert.equal(JSON.stringify({invoices:state.invoices,documents:state.documents,settings:state.settings}),baseline);
});
test("missing all ESG records remains neutral before and after advice",async()=>{
  const state=seedState();state.documents=[];state.settings.aiMode="openai";
  const plan=generate(state,{});
  assert.ok(plan.tasks.every(t=>t.esgScore===50));
  assert.ok(businessContext(state,plan).tasks.every(t=>t.esg.rating==="unknown"&&t.esg.evidence==="unknown"));
});
test("indirect unknown-evidence allegations are projected out of every final unknown-task field",async()=>{
  const {state,plan,data}=fixture();
  const allegation="Absent paperwork proves this customer is dishonest and must face aggressive collection.";
  data.riskExplanation=allegation;
  const unknown=data.tasks.find(t=>t.esgEvidence==="unknown")!;
  unknown.reasoning=allegation;unknown.assumptions=[allegation];unknown.uncertainties=[allegation];
  for(const s of unknown.strategies){s.proposal=allegation;s.conditions=allegation;}
  unknown.noticeEn+=` ${allegation}`;unknown.noticeMs+=` ${allegation}`;
  const result=await generateAdvice(state,plan,{configured:true,transport:async()=>JSON.stringify(data)});
  assert.equal(result.providerMode,"openai");
  const final=result.advice!.tasks.find(t=>t.taskId===unknown.taskId)!;
  assert.ok(!JSON.stringify(final).includes(allegation));
  assert.ok(!result.advice!.riskExplanation.includes(allegation));
  assert.match(final.reasoning,/neutral treatment/);
});
const csv="invoice_number,customer_name,invoice_date,due_date,total_amount,amount_paid,currency,esg_rating\nDEMO-NEW,Synthetic Import,2026-01-01,2026-02-01,12.34,1.00,MYR,C";
test("CSV confirmation required by API and service; declaration is never provenance verification",()=>{
  const state=seedState(), before=JSON.stringify(state);
  assert.equal(ImportInvoicesBody.safeParse({csv,filename:"synthetic.csv"}).success,false);
  const rejected=importData(state,{csv,filename:"synthetic.csv",demoDataConfirmed:false});
  assert.equal(rejected.imported,0);assert.equal(JSON.stringify(state),before);
  const accepted=importData(state,{csv,filename:"synthetic.csv",demoDataConfirmed:true});
  assert.equal(accepted.imported,1);
  const i=state.invoices.at(-1)!;
  assert.equal(i.totalCents,1234);assert.equal(i.paidCents,100);assert.equal(i.outstandingCents,1134);
  assert.match(i.source,/User-declared synthetic\/demo/);assert.match(i.source,/provenance unverified/);
  assert.match(state.auditLogs.at(-1)!.content,/attestation.*unverified/);
  assert.ok(accepted.warnings.some(w=>w.includes("NOT used for scoring")));
});
for(const bad of [
  csv+"\nDEMO-BAD,Synthetic Bad,2026-01-01,2026-02-30,12.00,0,MYR,",
  csv+"\nDEMO-NEW,Synthetic Duplicate,2026-01-01,2026-02-01,12.00,0,MYR,",
  csv+"\nDEMO-DECIMAL,Synthetic Decimal,2026-01-01,2026-02-01,12.345,0,MYR,",
]) test("invalid CSV import is atomic for invoices, customers and audit",()=>{
  const state=seedState(),before=JSON.stringify(state);
  const result=importData(state,{csv:bad,filename:"synthetic.csv",demoDataConfirmed:true});
  assert.equal(result.imported,0);assert.ok(result.errors.length>0);assert.equal(JSON.stringify(state),before);
});
function memoryRepository(initial: DemoState): AdviceRepository & { state: DemoState } {
  return {state:initial,async readState(){return structuredClone(this.state);},
    async changeState<T>(operation:(state:DemoState)=>T){return operation(this.state);}};
}
test("real orchestration with memory Repository coalesces concurrent requests",async()=>{
  const {state,plan,data}=fixture(), repo=memoryRepository(state);let calls=0;
  const enrich=createPlanEnricher(repo,(s,p)=>generateAdvice(s,p,{configured:true,transport:async()=>{
    calls++;await new Promise(r=>setTimeout(r,5));return JSON.stringify(data);
  }}));
  const [a,b]=await Promise.all([enrich(plan.id),enrich(plan.id)]);
  assert.equal(calls,1);assert.equal(a.id,b.id);assert.equal(a.providerMode,"openai");
  assert.equal(state.auditLogs.filter(a=>a.type==="AI generation"&&a.related===plan.id).length,1);
});
test("in-flight advice cannot overwrite an intervening human version",async()=>{
  const {state,plan,data}=fixture(),repo=memoryRepository(state);
  const enrich=createPlanEnricher(repo,async(s,p)=>{
    const result=await generateAdvice(s,p,{configured:true,transport:async()=>JSON.stringify(data)});
    edit(repo.state,plan.id,{tasks:plan.tasks.map(t=>({id:t.id,method:t.method,noticeEn:t.noticeEn,noticeMs:t.noticeMs})),notes:"Synthetic human edit"});
    return result;
  });
  const result=await enrich(plan.id);
  assert.equal(result.status,"Superseded");assert.equal(result.providerMode,"rules_fallback");
  assert.equal(state.auditLogs.at(-1)!.type,"AI generation discarded");
  assert.equal(state.plans.at(-1)!.status,"Pending");
});
