import test from "node:test";
import assert from "node:assert/strict";
import { seedState } from "../src/lib/receivables/seed";
import { calculateRisk, invoicesNow, signature } from "../src/lib/receivables/compute";
import { buildPlan } from "../src/lib/receivables/planner";
import { addDays, today } from "../src/lib/receivables/model";
import * as service from "../src/lib/receivables/service";

function quiet() {
  const s = seedState();
  s.invoices = [];
  Object.assign(s.settings, { cashCents: 20000, minimumCashCents: 10000, expectedExpenseCents: 0,
    collectionRatePercent: 100, overdueThresholdCents: 1000000, largeInvoiceCents: 1000000, concentrationCount: 100 });
  return s;
}
function withInvoice(offset: number, amount = 10000) {
  const s = quiet();
  const i = structuredClone(seedState().invoices[0]!);
  Object.assign(i, { dueDate: addDays(today(), offset), totalCents: amount, paidCents: 0, status: "Upcoming" });
  s.invoices = [i];
  return s;
}
function edits(p: ReturnType<typeof buildPlan>) {
  return p.tasks.map(t => ({ id: t.id, method: t.method, noticeEn: t.noticeEn, noticeMs: t.noticeMs }));
}

test("R1: below minimum is High; minimum boundary is not High", () => {
  const s = quiet(); s.settings.cashCents = 9999;
  assert.equal(calculateRisk(s).level, "High");
  assert.equal(calculateRisk(s).gapCents, 1);
  s.settings.cashCents = 10000; assert.equal(calculateRisk(s).level, "Medium");
});
test("R2: buffer upper boundary inclusive; above buffer Low", () => {
  const s = quiet(); s.settings.cashCents = 12000;
  assert.equal(calculateRisk(s).level, "Medium");
  s.settings.cashCents++; assert.equal(calculateRisk(s).level, "Low");
});
test("R3: overdue partial outstanding, not original total, at threshold", () => {
  const s = withInvoice(-1); s.invoices[0]!.paidCents = 4000; s.settings.overdueThresholdCents = 6000;
  assert.equal(calculateRisk(s).overdueCents, 6000); assert.equal(calculateRisk(s).level, "Medium");
  s.settings.overdueThresholdCents++; assert.equal(calculateRisk(s).level, "Low");
});
test("R4: today and horizon end included; overdue and day+8 excluded", () => {
  const s = withInvoice(0); s.settings.concentrationCount = 1;
  for (const offset of [0, 7]) { s.invoices[0]!.dueDate = addDays(today(), offset); assert.equal(calculateRisk(s).level, "Medium"); }
  for (const offset of [-1, 8]) { s.invoices[0]!.dueDate = addDays(today(), offset); assert.equal(calculateRisk(s).level, "Low"); }
});
test("R5: overdue large at threshold; future large does not trigger", () => {
  const s = withInvoice(-1); s.settings.largeInvoiceCents = 10000;
  assert.equal(calculateRisk(s).level, "Medium");
  s.invoices[0]!.dueDate = today(); assert.equal(calculateRisk(s).level, "Low");
});
test("risk reads cash, dates, paid amount and excludes Paid/Cancelled", () => {
  const s = withInvoice(1); s.settings.collectionRatePercent = 60; s.settings.expectedExpenseCents = 3000;
  s.invoices[0]!.paidCents = 1000;
  let r = calculateRisk(s); assert.equal(r.dueCents, 9000); assert.equal(r.expectedCollectionCents, 5400); assert.equal(r.projectedCashCents, 22400);
  s.invoices[0]!.status = "Cancelled"; assert.equal(calculateRisk(s).dueCents, 0);
  s.invoices[0]!.status = "Paid"; s.invoices[0]!.paidCents = 10000; assert.equal(calculateRisk(s).dueCents, 0);
});
test("all four weights execute exact weighted sum and stable rank", () => {
  const s = seedState(), p = buildPlan(s, s.riskEvents[0]!.id, s.settings.weights);
  for (const t of p.tasks) {
    const w = p.weights;
    assert.equal(t.score, Math.round((t.lateFeeScore*w.lateFee+t.urgencyScore*w.urgency+t.importanceScore*w.importance+t.esgScore*w.esg))/100);
    assert.ok(t.reason.includes("Weighted score"));
  }
  assert.ok(p.tasks.every((t, n) => t.rank === n+1 && (!n || p.tasks[n-1]!.score >= t.score)));
  for (const factor of ["lateFee", "urgency", "importance", "esg"] as const) {
    const w = {lateFee:0,urgency:0,importance:0,esg:0}; w[factor]=100;
    const q = buildPlan(s, s.riskEvents[0]!.id, w);
    for (const t of q.tasks) assert.equal(t.score, t[`${factor}Score`]);
  }
  assert.throws(() => buildPlan(s, "", {lateFee:30,urgency:35,importance:25,esg:11}), /100/);
});
test("late fee and business importance actually affect scores", () => {
  const s = withInvoice(-10), w = {lateFee:100,urgency:0,importance:0,esg:0};
  const before = buildPlan(s, "", w).tasks[0]!; s.invoices[0]!.lateFeeBps *= 2;
  assert.ok(buildPlan(s, "", w).tasks[0]!.score > before.score);
  s.customers[0]!.importance = "Low";
  assert.equal(buildPlan(s, "", {lateFee:0,urgency:0,importance:100,esg:0}).tasks[0]!.score, 80);
});
test("missing, Pending, rejected and expired ESG all neutral, not credit warnings", () => {
  for (const status of ["Missing", "Pending", "Rejected", "Expired", "Needs information"]) {
    const s = withInvoice(2);
    s.documents = status === "Missing" ? [] : [{...s.documents[0]!, status, rating:"C",
      validUntil: addDays(today(), status === "Expired" ? -1 : 10)}];
    const t = buildPlan(s, "", s.settings.weights).tasks[0]!;
    assert.equal(t.esgScore, 50); assert.match(t.reason, /not evidence of bad debt/);
    assert.match(t.esgNote, /No ESG compliance alert/);
  }
});
test("only valid approved A/B/C gives 30/50/70; future unverified ratings do not qualify", () => {
  const s=withInvoice(2);
  for(const [rating,score] of [["A",30],["B",50],["C",70]] as const) {
    s.documents=[{...s.documents[0]!,status:"Approved",rating,validUntil:addDays(today(),1)}];
    assert.equal(buildPlan(s,"",s.settings.weights).tasks[0]!.esgScore,score);
  }
});
test("manual risk check starts a Pending plan, never executes", () => {
  const s = seedState(), e = service.riskCheck(s);
  const p = s.plans.find(p => p.riskEventId === e.id);
  assert.ok(p); assert.equal(p.status, "Pending"); assert.equal(s.executions.length, 0);
  assert.ok(s.auditLogs.some(a => a.type === "Risk check" && a.related === e.id));
  assert.ok(s.auditLogs.some(a => a.type === "Plan generated" && a.planVersion.startsWith(p.id)));
});
test("Low risk is recorded without starting collection", () => {
  const s = quiet(), count=s.plans.length; const r=service.riskCheck(s);
  assert.equal(r.level,"Low"); assert.equal(s.plans.length,count);
});
test("stale historical risk is refreshed when generating, preserving old event", () => {
  const s=seedState(), old=s.riskEvents[0]!, oldSnapshot=JSON.stringify(old);
  s.settings.cashCents+=999;
  const p=service.generate(s,{riskEventId:old.id});
  const event=s.riskEvents.find(e=>e.id===p.riskEventId)!;
  assert.notEqual(event.id,old.id); assert.equal(event.projectedCashCents,calculateRisk(s).projectedCashCents);
  assert.equal(JSON.stringify(old),oldSnapshot);
});
test("defer recalculates risk too, retains family and requires new approval", () => {
  const s=seedState(), old=s.plans[0]!; s.settings.cashCents+=999;
  const next=service.decide(s,old.id,{decision:"defer",notes:"TEST defer"});
  assert.equal(old.status,"Deferred"); assert.equal(next.familyId,old.familyId); assert.equal(next.version,2);
  assert.equal(next.status,"Pending"); assert.notEqual(next.riskEventId,old.riskEventId);
  assert.equal(next.dataSignature,signature(s)); assert.throws(()=>service.execute(s,next.id),/not been approved/);
});
test("method override updates untouched templates and recommendation", () => {
  const s=seedState(), old=s.plans[0]!, input=edits(old); input[0]!.method="Extension negotiation";
  const p=service.edit(s,old.id,{tasks:input,notes:"TEST extension"});
  assert.match(p.tasks[0]!.noticeEn,/extension/i); assert.match(p.tasks[0]!.noticeMs,/lanjutan/i);
  assert.match(p.tasks[0]!.negotiation,/extension/i);
});
test("manual order and bilingual edits create immutable new version", () => {
  const s=seedState(), old=s.plans[0]!, input=edits(old).reverse();
  input[0]!.noticeEn="TEST custom English"; input[0]!.noticeMs="TEST Bahasa Melayu";
  const snapshot=JSON.stringify(old.tasks), p=service.edit(s,old.id,{tasks:input,notes:"TEST reorder"});
  assert.equal(old.status,"Superseded"); assert.equal(JSON.stringify(old.tasks),snapshot);
  assert.equal(p.version,2); assert.equal(p.tasks[0]!.invoiceId,old.tasks.at(-1)!.invoiceId);
  assert.equal(p.tasks[0]!.noticeEn,"TEST custom English"); assert.equal(p.tasks[0]!.noticeMs,"TEST Bahasa Melayu");
  assert.ok(s.auditLogs.some(a=>a.type==="Manual adjustment" && a.before.includes(old.id) && a.after.includes(p.id)));
});
test("unapproved/rejected/superseded plans cannot execute", () => {
  const s=seedState(), p=s.plans[0]!;
  assert.throws(()=>service.execute(s,p.id),/not been approved/);
  service.decide(s,p.id,{decision:"reject",notes:"TEST reject"});
  assert.equal(p.status,"Rejected"); assert.throws(()=>service.execute(s,p.id),/not been approved/);
  assert.throws(()=>service.edit(s,p.id,{tasks:edits(p),notes:""}),/immutable/);
});
test("approved execution is idempotent and never changes invoices/cash", () => {
  const s=seedState(), p=s.plans[0]!, invoices=JSON.stringify(s.invoices),cash=s.settings.cashCents;
  service.decide(s,p.id,{decision:"approve",notes:"TEST approve"});
  assert.equal(s.executions.length,0);
  service.execute(s,p.id); const count=s.executions.length, logs=s.auditLogs.length;
  assert.equal(count,p.tasks.length); assert.equal(p.status,"Executed");
  assert.equal(JSON.stringify(s.invoices),invoices); assert.equal(s.settings.cashCents,cash);
  service.execute(s,p.id); assert.equal(s.executions.length,count); assert.equal(s.auditLogs.length,logs);
  assert.ok(s.approvals[0]!.originalSnapshot); assert.ok(s.approvals[0]!.finalSnapshot);
});
test("settings/invoice/ESG mutation blocks stale approval or execution", () => {
  for (const mutate of [(s:ReturnType<typeof seedState>)=>s.settings.cashCents++,
    (s:ReturnType<typeof seedState>)=>s.invoices[0]!.paidCents++,
    (s:ReturnType<typeof seedState>)=>s.documents[0]!.status="Rejected"]) {
    const s=seedState(), p=s.plans[0]!; mutate(s);
    assert.throws(()=>service.decide(s,p.id,{decision:"approve",notes:""}),/changed/);
    const fresh=seedState(), q=fresh.plans[0]!; service.decide(fresh,q.id,{decision:"approve",notes:""});
    mutate(fresh); assert.throws(()=>service.execute(fresh,q.id),/changed/);
  }
});
test("rules fallback, bilingual notices and synthetic source are explicit", () => {
  const s=seedState(), ws=service.workspace(s);
  assert.equal(ws.demo,true); assert.equal(typeof ws.aiAvailable,"boolean"); assert.match(ws.source,/Synthetic/);
  assert.ok(ws.invoices.every(i=>i.source.includes("Synthetic")));
  for(const t of ws.plans[0]!.tasks) { assert.match(t.noticeEn,/Demo/); assert.match(t.noticeMs,/Demo/); }
  assert.equal(service.settings(s,{...s.settings,aiMode:"gemini"}).aiMode,"gemini");
  assert.ok(service.generate(s,{}).tasks.length>0);
});
test("planning separates escalation from extension, supplies alternatives", () => {
  const s=seedState(), p=buildPlan(s,s.riskEvents[0]!.id,s.settings.weights);
  assert.ok(p.tasks.some(t=>t.method==="Priority human follow-up"));
  assert.ok(p.tasks.some(t=>t.method==="Extension negotiation"));
  for(const t of p.tasks) { assert.match(t.negotiation,/Option 1/); assert.match(t.negotiation,/Option 2/); assert.match(t.negotiation,/Option 3/); }
});
test("ESG read is audited with full synthetic review provenance, not admin review", () => {
  const s=seedState(), d=s.documents[0]!, before=JSON.stringify(s.documents);
  const result=service.documentView(s,d.id); assert.match(result.content,/NOT AN OFFICIAL/);
  assert.equal(JSON.stringify(s.documents),before);
  assert.ok(s.auditLogs.at(-1)!.after.includes(d.conclusion));
});
test("dashboard amounts derive from the same model", () => {
  const s=seedState(), ws=service.workspace(s), open=invoicesNow(s).filter(i=>i.outstandingCents>0);
  assert.equal(ws.dashboard.outstandingCents,open.reduce((n,i)=>n+i.outstandingCents,0));
  assert.equal(ws.dashboard.cashCents,s.settings.cashCents);
  assert.equal(ws.dashboard.risk.projectedCashCents,calculateRisk(s).projectedCashCents);
  assert.equal(ws.plans[0]!.tasks.length,open.length);
});
