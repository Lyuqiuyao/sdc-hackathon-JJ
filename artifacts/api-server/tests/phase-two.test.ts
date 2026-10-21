import test from "node:test";
import assert from "node:assert/strict";
import { seedState } from "./legacy-fixture";
import { generate, edit, decide } from "../src/lib/receivables/service";
import { createPlanEnricher } from "../src/lib/receivables/ai-enrichment";
import { claimGeneration, generationKey } from "../src/lib/receivables/ai-coordination";
import { generateAdvice, businessContext } from "../src/lib/receivables/ai-provider";
import { appendPlanSnapshot, listAdviceSnapshots } from "../src/lib/receivables/advice-snapshots";
import { GetPlanAdviceSnapshotsResponse } from "@workspace/api-zod";
import { sharedMemoryStore } from "./memory-advice-repository";
import { syntheticAdvice } from "./synthetic-advice";

function fixture() {
  const state=seedState();state.settings.aiMode="openai";const plan=generate(state,{});
  const prose="Synthetic conditional suggestion; human review and separate agreement remain necessary.";
  const data={riskExplanation:prose,tasks:businessContext(state,plan).tasks.map(t=>({
    taskId:t.taskId,reasoning:prose,assumptions:[prose],uncertainties:[prose],
    esgEvidence:t.esg.evidence,esgRating:t.esg.rating,esgConsiderations:prose,
    strategies:["payment_full","installments","extension"].map(kind=>({kind,proposal:prose,conditions:prose})),
    noticeEn:"Synthetic Demo draft — no message sent. Dear Accounts Payable, please discuss the supplied invoice with finance.",
    noticeMs:"Draf demo sintetik — tiada mesej dihantar. Tuan/Puan, sila berbincang dengan pihak kewangan.",
  }))};
  const advice=(s:typeof state,p:typeof plan)=>generateAdvice(s,p,{configured:true,transport:async()=>JSON.stringify(data)});
  return {state,plan,data,advice};
}
function gate() { let release!:()=>void;const wait=new Promise<void>(r=>{release=r;});return {wait,release}; }
const editedTasks=(plan:ReturnType<typeof generate>)=>plan.tasks.map(t=>({id:t.id,method:t.method,noticeEn:t.noticeEn,noticeMs:t.noticeMs}));

test("two independently constructed instances share a lease, not a process Map",async()=>{
  const {state,plan,advice}=fixture(),store=sharedMemoryStore(state);
  const entered=gate(),hold=gate();let first=0,second=0;
  const a=createPlanEnricher(store.repository(),async(s,p)=>{first++;entered.release();await hold.wait;return advice(s,p);});
  const b=createPlanEnricher(store.repository(),async(s,p)=>{second++;return advice(s,p);});
  const running=a(plan.id);await entered.wait;await b(plan.id);assert.equal(second,0);
  hold.release();await running;await b(plan.id);
  assert.equal(first,1);assert.equal(second,0);
  const current=await store.repository().readState();
  assert.equal(current.adviceSnapshots!.filter(s=>s.status==="applied").length,1);
  assert.equal(Object.values(current.aiLeases!)[0]!.status,"succeeded");
});
test("coordination keys distinguish workspace, event, plan version and task input",()=>{
  const {plan}=fixture(),base=generationKey("one",plan);
  assert.notEqual(generationKey("two",plan),base);
  for(const patch of [{version:plan.version+1},{riskEventId:"other"},{id:"other"},{dataSignature:"other"}])
    assert.notEqual(generationKey("one",{...plan,...patch}),base);
});
test("two instances may claim different plan versions without sharing generation rights",async()=>{
  const {state,plan}=fixture(),next={...structuredClone(plan),id:"SYNTH-NEXT",version:plan.version+1};
  state.plans.push(next);const store=sharedMemoryStore(state);
  const one=store.repository(),two=store.repository();
  const [a,b]=await Promise.all([
    one.changeState(s=>claimGeneration(s,s.plans.find(p=>p.id===plan.id)!,"synthetic-demo-admin",100,1000)),
    two.changeState(s=>claimGeneration(s,s.plans.find(p=>p.id===next.id)!,"synthetic-demo-admin",100,1000)),
  ]);
  assert.equal(a.kind,"claimed");assert.equal(b.kind,"claimed");
  if(a.kind==="claimed"&&b.kind==="claimed")assert.notEqual(a.lease.key,b.lease.key);
});
for(const failure of ["api_error","timeout","throw"] as const) test(`explicit subsequent request recovers after ${failure}`,async()=>{
  const {state,plan,advice}=fixture(),store=sharedMemoryStore(state);
  const a=createPlanEnricher(store.repository(),async(s,p)=>{
    if(failure==="throw")throw Error("Authorization: Bearer never-retain-this");
    return generateAdvice(s,p,{configured:true,timeoutMs:1,transport:async()=>{
      if(failure==="timeout")await new Promise(r=>setTimeout(r,5));
      throw Error("PRIVATE");
    }});
  });
  const fallback=await a(plan.id);assert.equal(fallback.providerMode,"rules_fallback");
  const failed=await store.repository().readState();
  assert.ok(["failed","timed_out"].includes(Object.values(failed.aiLeases!)[0]!.status));
  const b=createPlanEnricher(store.repository(),advice);
  const result=await b(plan.id);assert.equal(result.providerMode,"openai");
  const current=await store.repository().readState();
  assert.equal(current.adviceSnapshots!.filter(s=>s.status==="started").length,2);
  assert.ok(!JSON.stringify(current.adviceSnapshots).includes("never-retain-this"));
});
test("expired lease is taken over; late old owner is fenced and cannot overwrite success",async()=>{
  const {state,plan,advice}=fixture();let clock=100;
  const store=sharedMemoryStore(state,()=>clock),entered=gate(),hold=gate();
  const a=createPlanEnricher(store.repository(),async(s,p)=>{entered.release();await hold.wait;return advice(s,p);},{leaseMs:20,clock:()=>clock});
  const b=createPlanEnricher(store.repository(),advice,{leaseMs:20,clock:()=>clock});
  const old=a(plan.id);await entered.wait;clock=121;
  const winner=await b(plan.id),snapshot=JSON.stringify(winner);
  hold.release();await old;
  const current=await store.repository().readState();
  assert.equal(JSON.stringify(current.plans.find(p=>p.id===plan.id)),snapshot);
  const terminal=current.adviceSnapshots!.filter(s=>s.status==="discarded").at(-1)!;
  assert.equal(terminal.reasonCode,"lease_lost");assert.equal(terminal.source,"metadata_only");
  assert.equal(JSON.parse(terminal.contentJson).effectiveAdvice,undefined);
  assert.ok(current.adviceSnapshots!.some(s=>s.status==="expired"));
});
test("abrupt exit leaves recoverable lease rather than permanent placeholder",async()=>{
  const {state,plan,advice}=fixture();let time=10;
  const store=sharedMemoryStore(state,()=>time),repo=store.repository();
  await repo.changeState(s=>claimGeneration(s,s.plans.find(p=>p.id===plan.id)!,"synthetic-demo-admin",time,10));
  let calls=0;const survivor=createPlanEnricher(store.repository(),async(s,p)=>{calls++;return advice(s,p);},{clock:()=>time,leaseMs:10});
  await survivor(plan.id);assert.equal(calls,0);time=21;
  assert.equal((await survivor(plan.id)).providerMode,"openai");assert.equal(calls,1);
});
test("new version finishes while an older version is still in flight; output is never reused",async()=>{
  const {state,plan}=fixture(),store=sharedMemoryStore(state),repo=store.repository();
  const entered=gate(),hold=gate();let oldCalls=0,newCalls=0;
  const a=createPlanEnricher(repo,async(s,p)=>{
    const result=await syntheticAdvice(s,p,async()=>{oldCalls++;});
    entered.release();await hold.wait;return result;
  });
  const old=a(plan.id);await entered.wait;
  const next=await repo.changeState(s=>decide(s,plan.id,{decision:"defer",notes:"Synthetic new version"}));
  const b=createPlanEnricher(store.repository(),(s,p)=>syntheticAdvice(s,p,async()=>{newCalls++;}));
  const winner=await b(next.id);assert.equal(winner.providerMode,"openai");
  const winnerBefore=JSON.stringify(winner);
  hold.release();const stale=await old;
  assert.equal(stale.status,"Deferred");assert.notEqual(stale.providerMode,"openai");
  const current=await repo.readState();
  assert.equal(JSON.stringify(current.plans.find(p=>p.id===next.id)),winnerBefore);
  assert.equal(oldCalls,1);assert.equal(newCalls,1);assert.equal(Object.keys(current.aiLeases!).length,2);
  const applied=current.adviceSnapshots!.find(s=>s.status==="applied")!;
  assert.equal(applied.planVersion,next.version);assert.equal(applied.planId,next.id);
});
test("an owner past its deadline cannot apply even when no successor has claimed yet",async()=>{
  const {state,plan}=fixture();let time=100;
  const store=sharedMemoryStore(state,()=>time);
  const a=createPlanEnricher(store.repository(),async(s,p)=>{
    const result=await syntheticAdvice(s,p);time=111;return result;
  },{leaseMs:10,clock:()=>time});
  assert.notEqual((await a(plan.id)).providerMode,"openai");
  const current=await store.repository().readState();
  assert.equal(current.adviceSnapshots!.at(-1)!.reasonCode,"lease_expired");
  assert.equal(Object.values(current.aiLeases!)[0]!.status,"timed_out");
  assert.equal((await createPlanEnricher(store.repository(),syntheticAdvice,{clock:()=>time})(plan.id)).providerMode,"openai");
});
for(const action of ["edit","approve","reject","defer"] as const) test(`late response after ${action} is audited, never applied`,async()=>{
  const {state,plan,advice}=fixture(),store=sharedMemoryStore(state),repo=store.repository();
  const a=createPlanEnricher(repo,async(s,p)=>{
    const result=await advice(s,p);
    await repo.changeState(current=>{
      const old=current.plans.find(p=>p.id===plan.id)!;
      if(action==="edit")edit(current,old.id,{tasks:editedTasks(old),notes:"Synthetic edit"});
      else decide(current,old.id,{decision:action,notes:"Synthetic decision"});
    });
    return result;
  });
  const result=await a(plan.id);
  assert.notEqual(result.providerMode,"openai");
  const current=await repo.readState(),snapshot=current.adviceSnapshots!.at(-1)!;
  assert.equal(snapshot.status,"discarded");assert.equal(snapshot.reasonCode,"plan_changed");
});
test("success snapshots reconstruct effective advice, controlled templates and notices; no raw text",async()=>{
  const {state,plan,advice}=fixture(),store=sharedMemoryStore(state),repo=store.repository();
  const result=await createPlanEnricher(repo,advice)(plan.id);
  const snapshots=listAdviceSnapshots(await repo.readState(),plan.id);
  GetPlanAdviceSnapshotsResponse.parse(snapshots);
  const applied=snapshots.find(s=>s.status==="applied")!,content=JSON.parse(applied.contentJson);
  assert.equal(content.rawModel.retained,false);assert.ok(content.validatedModelSummary.length>0);
  assert.equal(content.validatedModelSummary[0].reasoning,undefined);
  assert.equal(content.effectiveAdvice.tasks.length,result.tasks.length);
  assert.deepEqual(content.finalNotices.map((t:any)=>t.noticeEn),result.tasks.map(t=>t.noticeEn));
  assert.ok(content.controlledTemplates.tasks.every((t:any)=>t.noticeEn));
  assert.equal(applied.validation,"passed");assert.equal(applied.contentPolicy,"server_controlled_v1");
  assert.ok(applied.attemptId.startsWith("ATT-"));assert.ok(applied.previousSnapshotId);
});
test("fallback snapshot restores rule content and cannot be mistaken for model success",async()=>{
  const {state,plan}=fixture(),store=sharedMemoryStore(state),repo=store.repository();
  await createPlanEnricher(repo,(s,p)=>generateAdvice(s,p,{configured:false}))(plan.id);
  const item=listAdviceSnapshots(await repo.readState(),plan.id).at(-1)!;
  assert.equal(item.status,"fallback");assert.equal(item.provider,"rules_fallback");
  assert.equal(item.source,"rules_template");assert.equal(item.reasonCode,"missing_managed_config");
  assert.ok(JSON.parse(item.contentJson).finalNotices.length);
});
test("human edit, approval and deferred versions never overwrite earlier snapshots",async()=>{
  const {state,plan,advice}=fixture(),store=sharedMemoryStore(state),repo=store.repository();
  await createPlanEnricher(repo,advice)(plan.id);
  const original=JSON.stringify((await repo.readState()).adviceSnapshots);
  const edited=await repo.changeState(s=>edit(s,plan.id,{tasks:editedTasks(s.plans.find(p=>p.id===plan.id)!),notes:"Synthetic human change"}));
  await repo.changeState(s=>decide(s,edited.id,{decision:"approve",notes:"Synthetic approval"}));
  const current=await repo.readState(),earlier=JSON.parse(original);
  assert.deepEqual(current.adviceSnapshots!.slice(0,earlier.length),earlier);
  const approved=current.adviceSnapshots!.find(s=>s.status==="approved")!;
  const approval=current.approvals.find(a=>a.id===approved.approvalId)!;
  assert.equal(approved.planId,approval.planId);assert.equal(approved.planVersion,approval.version);
  const human=current.adviceSnapshots!.find(s=>s.status==="edited")!;
  assert.equal(human.previousPlanId,plan.id);assert.equal(human.source,"human");
  const fresh=await repo.changeState(s=>edit(s,edited.id,{tasks:editedTasks(s.plans.find(p=>p.id===edited.id)!),notes:"New synthetic version"}));
  const deferred=await repo.changeState(s=>decide(s,fresh.id,{decision:"defer",notes:"Synthetic defer"}));
  assert.ok((await repo.readState()).adviceSnapshots!.some(s=>s.planId===deferred.id&&s.previousPlanId===fresh.id));
  assert.deepEqual((await repo.readState()).adviceSnapshots!.slice(0,earlier.length),earlier);
});
test("snapshots redact credential-like human text; modifying returned copies cannot alter stored records",async()=>{
  const {state,plan}=fixture();
  const tasks=editedTasks(plan);tasks[0]!.noticeEn="Authorization: Bearer synthetic-private-credential\napi_key=synthetic-key-value\nsk-synthetic-private-value\nhttps://synthetic-user:synthetic-password@invalid.example/path";
  const edited=edit(state,plan.id,{tasks,notes:"Synthetic redaction test"});
  const snapshots=listAdviceSnapshots(state,edited.id),serialized=JSON.stringify(snapshots);
  for(const forbidden of ["synthetic-private-credential","synthetic-key-value","sk-synthetic-private-value","synthetic-password"])
    assert.ok(!serialized.includes(forbidden));
  snapshots[0]!.reasonCode="changed";
  assert.notEqual(state.adviceSnapshots!.at(-1)!.reasonCode,"changed");
});
test("append-only guard rejects mutation and deletion with transactional rollback",async()=>{
  const {state}=fixture(),repo=sharedMemoryStore(state).repository(),before=await repo.readState();
  await assert.rejects(repo.changeState(s=>{s.adviceSnapshots![0]!.reasonCode="changed";}),/append-only/);
  await assert.rejects(repo.changeState(s=>{s.adviceSnapshots=[];}),/append-only/);
  assert.deepEqual(await repo.readState(),before);
});
test("missing snapshot association rejects safely without a successful record",()=>{
  const {state,plan}=fixture(),before=JSON.stringify(state.adviceSnapshots);
  assert.throws(()=>appendPlanSnapshot(state,{...plan,id:"missing"},{status:"applied",reasonCode:"validated_response"}),/association/);
  assert.throws(()=>listAdviceSnapshots(state,"missing"),/association/);
  assert.equal(JSON.stringify(state.adviceSnapshots),before);
});
