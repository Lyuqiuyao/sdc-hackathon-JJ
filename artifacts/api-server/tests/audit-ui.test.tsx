import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdviceSnapshotDetails, PlanSnapshotsPanel } from "../../receivables-admin/src/components/advice-snapshots";
import { deriveAiOutcome, rawRetention, parseSnapshotContent, findApproval, snapshotList } from "../../receivables-admin/src/lib/advice-snapshot";
import { seedState } from "./legacy-fixture";
import { generate } from "../src/lib/receivables/service";
import { appendPlanSnapshot } from "../src/lib/receivables/advice-snapshots";
import type { AdviceSnapshot } from "@workspace/api-zod";
function fixture() {
  const state=seedState(),plan=generate(state,{});
  const snapshot=appendPlanSnapshot(state,plan,{status:"fallback",reasonCode:"rules_selected",provider:"rules_fallback"});
  return {state,plan,snapshot};
}
const html=(snapshot:AdviceSnapshot,approvals:any[]=[])=>renderToStaticMarkup(createElement(AdviceSnapshotDetails,{snapshot,approvals}));
test("SSR fallback and old records are honest; original raw text is not reconstructible",()=>{
  const {snapshot}=fixture();
  assert.match(html(snapshot),/Rules fallback/);assert.match(html(snapshot),/original text cannot be reconstructed/);
  const old={...snapshot,contentJson:"{}",rawResponseRetained:undefined,diagnostics:undefined,model:undefined};
  assert.match(html(old),/Unrecorded \/ unknown/);assert.match(html(old),/Unrecorded \(older record\)/);
});
test("metadata-only discarded/expired/started results remain distinct and never expose advice",()=>{
  const {snapshot}=fixture();
  for(const [status,label] of [["discarded","Discarded"],["expired","Expired"],["started","Started, not completed"]] as const) {
    const h=html({...snapshot,status,source:"metadata_only",contentJson:JSON.stringify({effectiveAdvice:"NEVER_DISPLAY_UNVALIDATED"})});
    assert.ok(h.includes(label));assert.ok(!h.includes("NEVER_DISPLAY_UNVALIDATED"));
    assert.ok(h.includes('data-testid="text-metadata-only"'));
  }
});
test("malformed content and list responses do not crash or cross plan boundaries",()=>{
  const {snapshot}=fixture();
  for(const raw of ["broken","null","[]"])assert.ok(html({...snapshot,contentJson:raw}).includes("text-content-malformed"));
  for(const raw of [null,{},[null],[{id:"bad"}],[{...snapshot,planId:"other"}]])assert.equal(snapshotList(raw,snapshot.planId),null);
  assert.equal(snapshotList([{...snapshot,id:"started"},{...snapshot,id:"applied"}],snapshot.planId)![0]!.id,"applied");
});
test("request model, attempt/version, diagnostics and escaped final notices render",()=>{
  const {snapshot}=fixture();
  const s={...snapshot,status:"applied" as const,provider:"openai" as const,source:"validated_projection" as const,validation:"passed" as const,
    model:"gpt-5-mini",modelOrigin:"request_config" as const,diagnostics:[{stage:"projection" as const,path:"tasks[0].noticeEn",outcome:"replaced" as const,reasonCode:"server_communication_template"}],
    contentJson:JSON.stringify({rawModel:{retained:false},effectiveAdvice:{riskExplanation:"Synthetic advice"},
      finalNotices:[{taskId:"SYNTH-TASK",noticeEn:"<script>unsafe()</script>",noticeMs:"Draf demo sintetik",noticeEnSource:"rules_fallback",noticeMsSource:"human"}]})};
  const h=html(s);
  for(const text of ["request configuration, not response-confirmed",snapshot.attemptId,snapshot.workspaceId,"server_communication_template","SYNTH-TASK","EN source:","human","Synthetic advice"])
    assert.ok(h.includes(text));
  assert.ok(!h.includes("<script>"));assert.ok(h.includes("&lt;script&gt;"));
});
test("approval links require id, plan id and exact version; actor remains demo identity",()=>{
  const {snapshot}=fixture(),s={...snapshot,approvalId:"APR-SYNTH",status:"approved" as const,source:"human" as const};
  const a={id:s.approvalId,planId:s.planId,version:s.planVersion,actor:"Demo Admin",createdAt:s.createdAt,decision:"approve",notes:"",originalSnapshot:"",finalSnapshot:""};
  assert.match(html(s,[a]),/Human decision: approved/);assert.match(html(s,[a]),/Demo Admin/);
  assert.ok(html(s,[{...a,version:a.version+1}]).includes("text-approval-missing"));
  assert.equal(findApproval([{...a,planId:"other"}],s),undefined);
});
test("AI outcome never comes from generic Success; raw legacy retention cannot be inferred",()=>{
  for(const after of ["bad","{}",JSON.stringify({providerMode:"rules_fallback",status:"fallback",reasonCode:"timeout"})]) {
    const o=deriveAiOutcome({type:"AI generation",after})!;
    assert.notEqual(o.tone,"green");
  }
  const {snapshot}=fixture();
  assert.equal(rawRetention({...snapshot,rawResponseRetained:undefined},parseSnapshotContent("{}")),"unrecorded");
  assert.equal(rawRetention({...snapshot,rawResponseRetained:true},parseSnapshotContent(snapshot.contentJson)),"unrecorded");
});
test("SSR panel without plan selection makes no request and offers only read actions",()=>{
  const q=new QueryClient();
  const {state}=fixture();
  const h=renderToStaticMarkup(createElement(QueryClientProvider,{client:q},createElement(PlanSnapshotsPanel,{plans:state.plans,approvals:[]})));
  assert.ok(h.includes("No request is made"));assert.equal(q.getQueryCache().findAll().every(x=>x.state.fetchStatus==="idle"),true);
  assert.ok(!h.includes("Execute")&&!h.includes("Approve"));
  q.clear();
});
