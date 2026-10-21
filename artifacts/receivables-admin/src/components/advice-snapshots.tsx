import { useEffect, useMemo, useState } from 'react';
import { useGetPlanAdviceSnapshots, getGetPlanAdviceSnapshotsQueryKey } from '@workspace/api-client-react';
import type { AdviceSnapshot, ApprovalRecord, CollectionPlan } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Panel, Tag, EmptyState, KV } from '@/components/kit';
import { fmtDateTime } from '@/lib/arus';
import { arr, findApproval, isRec, parseSnapshotContent, rawRetention, snapshotOutcome, snapshotList, str, type Rec } from '@/lib/advice-snapshot';

function Unavailable({ what }: { what: string }) {
  return <p className="text-xs text-muted-foreground" data-testid="text-snapshot-unavailable">{what} unavailable (unrecorded or malformed).</p>;
}

function Notices({ tasks }: { tasks: unknown[] }) {
  const rows = tasks.filter(isRec);
  if (!rows.length) return <Unavailable what="Final notices" />;
  return <div className="space-y-2" data-testid="list-final-notices">{rows.map((t, i) => {
    const n = isRec(t.notices) ? t.notices : {};
    const en = str(t.noticeEn) || str(n.en) || str(n.noticeEn), ms = str(t.noticeMs) || str(n.ms) || str(n.noticeMs);
    return <div key={i} className="rounded border p-2 text-xs">
      <div className="mb-1 font-medium">{str(t.invoiceNumber) || str(t.id) || str(t.taskId) || `Task ${i + 1}`}</div>
      <div><Tag>EN source: {str(t.noticeEnSource) || 'unrecorded'}</Tag> <p className="mt-1 whitespace-pre-wrap">{en || 'Unrecorded'}</p></div>
      <div className="mt-2"><Tag>MS source: {str(t.noticeMsSource) || 'unrecorded'}</Tag> <p className="mt-1 whitespace-pre-wrap">{ms || 'Unrecorded'}</p></div>
    </div>;
  })}</div>;
}

function Block({ title, v, testid }: { title: string; v: unknown; testid: string }) {
  return <div data-testid={testid}><div className="mb-1 text-xs font-semibold">{title}</div>
    {v === undefined || v === null ? <Unavailable what={title} /> :
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[11px]">{typeof v === 'string' ? v : JSON.stringify(v, null, 2)}</pre>}</div>;
}

export function AdviceSnapshotDetails({ snapshot, approvals }: { snapshot: AdviceSnapshot; approvals?: ApprovalRecord[] }) {
  const content = parseSnapshotContent(snapshot.contentJson);
  const o = snapshotOutcome(snapshot);
  const raw = rawRetention(snapshot, content);
  const ap = findApproval(approvals, snapshot);
  const d: Rec = content.ok ? content.data : {};
  const plan = isRec(d.planAtEvent) ? d.planAtEvent : null;
  const diag = Array.isArray(snapshot.diagnostics) ? snapshot.diagnostics : null;
  return <div className="space-y-3 text-xs" data-testid={`snapshot-details-${snapshot.id}`}>
    <div className="flex flex-wrap items-center gap-2">
      <Tag tone={o.tone}><span data-testid="badge-snapshot-outcome">{o.label}</span></Tag>
      <Tag tone={snapshot.validation === 'passed' ? 'green' : snapshot.validation === 'failed' ? 'red' : 'gray'}>Validation: {snapshot.validation}</Tag>
      <span className="text-muted-foreground">Validation only checks shape and evidence; it is not AI success or application.</span>
    </div>
    <dl>
      <KV k="Attempt / workspace" v={`${snapshot.attemptId} / ${snapshot.workspaceId}`} />
      <KV k="Plan / risk event" v={`${snapshot.planId} v${snapshot.planVersion} / ${snapshot.riskEventId}`} />
      <KV k="Created" v={fmtDateTime(snapshot.createdAt)} />
      <KV k="Provider / source" v={`${snapshot.provider} / ${snapshot.source}`} />
      <KV k="Status" v={`${snapshot.status} (${snapshot.reasonCode})`} />
      <KV k="Model" v={snapshot.model ? <span data-testid="text-snapshot-model">{snapshot.model} ({snapshot.modelOrigin === 'request_config' ? 'request configuration, not response-confirmed' : 'origin unrecorded'})</span> : 'Unrecorded'} />
      <KV k="Raw model text" v={<span data-testid="text-raw-retention">{raw === 'not_retained' ? 'Not retained; original text cannot be reconstructed' : 'Unrecorded / unknown'}</span>} />
      <KV k="Content policy" v={snapshot.contentPolicy || 'Unrecorded'} />
      <KV k="Previous snapshot" v={snapshot.previousSnapshotId ? <span className="font-mono" data-testid="text-prev-snapshot">{snapshot.previousSnapshotId}</span> : 'None recorded'} />
      <KV k="Previous plan" v={snapshot.previousPlanId ? <span className="font-mono" data-testid="text-prev-plan">{snapshot.previousPlanId}</span> : 'None recorded'} />
      <KV k="Approval" v={snapshot.approvalId ? (ap
        ? <span data-testid="text-approval-link">{ap.decision} by {ap.actor} at {fmtDateTime(ap.createdAt)}, exact version v{ap.version}</span>
        : <span data-testid="text-approval-missing">Approval link missing: no matching record for {snapshot.approvalId} at v{snapshot.planVersion}</span>) : 'No approval linked'} />
    </dl>
    <div data-testid="list-diagnostics"><div className="mb-1 font-semibold">Diagnostics (server metadata)</div>
      {diag === null ? <p className="text-muted-foreground">Unrecorded (older record).</p> : diag.length === 0 ? <p className="text-muted-foreground">None recorded.</p> :
        <ul className="space-y-0.5">{diag.map((x, i) => <li key={i} className="font-mono text-[11px]">{String(x?.stage)} · {String(x?.path)} · {String(x?.outcome)} · {String(x?.reasonCode)}{x?.taskId ? ` · ${String(x.taskId)}` : ''}</li>)}</ul>}
    </div>
    {!content.ok ? <p className="rounded border border-dashed p-2" data-testid="text-content-malformed">Snapshot content unavailable: contentJson is invalid or malformed. Metadata above is still shown.</p>
      : snapshot.source === 'metadata_only' ? <p data-testid="text-metadata-only">Metadata only: no unvalidated or unapplied advice is displayed.</p> : <>
      <Block title="Validated model summary" v={d.validatedModelSummary} testid="block-model-summary" />
      <Block title="Effective advice" v={snapshot.source === 'validated_projection' && snapshot.validation === 'passed' && snapshot.status === 'applied' ? d.effectiveAdvice : null} testid="block-effective-advice" />
      <Block title="Controlled templates" v={d.controlledTemplates} testid="block-controlled-templates" />
      <div><div className="mb-1 font-semibold">Final bilingual notices 最终通知</div>
        <Notices tasks={arr(d.finalNotices).length ? arr(d.finalNotices) : arr(plan?.tasks)} /></div>
      <Block title="Human version" v={d.humanVersion} testid="block-human-version" />
    </>}
    <p className="text-muted-foreground">Read-only. The AI never approves or executes.</p>
  </div>;
}

export function PlanSnapshotsPanel({ plans, approvals }: { plans: CollectionPlan[]; approvals: ApprovalRecord[] }) {
  const sorted = useMemo(() => [...plans].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [plans]);
  const [planId, setPlanId] = useState('');
  const [snapId, setSnapId] = useState('');
  const q = useGetPlanAdviceSnapshots(planId, { query: { enabled: !!planId, refetchInterval: 15000, queryKey: getGetPlanAdviceSnapshotsQueryKey(planId) } });
  const parsedList = useMemo(() => snapshotList(q.data, planId), [q.data, planId]);
  const list = parsedList ?? [];
  useEffect(() => { setSnapId(''); }, [planId]);
  const selected = list.find((s) => s.id === snapId) ?? list[0];
  return <Panel title="AI advice snapshots 建议快照" bodyClass="space-y-3">
    <div data-testid="snapshot-panel" className="space-y-3">
      <Select value={planId} onValueChange={setPlanId}>
        <SelectTrigger data-testid="select-snapshot-plan"><SelectValue placeholder="Select plan version" /></SelectTrigger>
        <SelectContent>{sorted.map((p) => <SelectItem key={p.id} value={p.id}>{p.id.slice(-8)} · v{p.version} · {p.status} · {fmtDateTime(p.createdAt)}</SelectItem>)}</SelectContent>
      </Select>
      {!planId ? <EmptyState title="Select a plan version" hint="No request is made until a plan is chosen." />
        : q.isLoading ? <div className="h-16 animate-pulse rounded bg-muted" data-testid="state-snapshots-loading" />
        : q.isError ? <div data-testid="state-snapshots-error" className="flex items-center gap-2 text-xs">Snapshots could not be loaded. <Button size="sm" variant="outline" onClick={() => q.refetch()} data-testid="button-retry-snapshots">Retry</Button></div>
        : parsedList === null ? <p data-testid="state-snapshots-malformed" className="text-xs">Snapshot response malformed or belongs to a different plan.</p>
        : list.length === 0 ? <div data-testid="state-snapshots-empty"><EmptyState title="No snapshots recorded" hint="Older plans have no snapshots; lineage and model are unrecorded." /></div>
        : <div className="space-y-3">
          <Select value={selected?.id ?? ''} onValueChange={setSnapId}>
            <SelectTrigger data-testid="select-snapshot"><SelectValue /></SelectTrigger>
            <SelectContent>{list.map((s) => <SelectItem key={s.id} value={s.id}>{fmtDateTime(s.createdAt)} · v{s.planVersion} · {s.status}</SelectItem>)}</SelectContent>
          </Select>
          {selected && <AdviceSnapshotDetails snapshot={selected} approvals={approvals} />}
        </div>}
    </div>
  </Panel>;
}
