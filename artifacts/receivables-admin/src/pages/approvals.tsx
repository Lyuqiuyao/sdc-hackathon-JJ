import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'wouter';
import { ArrowDown, ArrowUp, CheckCircle2, Clock3, ExternalLink, ListChecks, Save, XCircle } from 'lucide-react';
import { useDecidePlan, useEditPlan, type CollectionPlan, type CustomerReviewInput, type Workspace } from '@workspace/api-client-react';
import { Page, Panel, Tag, EmptyState, Field } from '@/components/kit';
import { QueuesOverview, ScoringSummary, TaskDetail, TaskHead } from '@/components/plan';
import { ProviderDetails } from '@/components/provider-details';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { CompanyFolder } from '@/components/company-folder';
import { useToast } from '@/hooks/use-toast';
import { METHODS, errMsg, fmtDate, fmtDateTime, rm, safeHistorical, useRefresh } from '@/lib/arus';

type Draft = { id: string; method: string; noticeEn: string; noticeMs: string };

function Editor({ ws, plan, onSelect }: { ws: Workspace; plan: CollectionPlan; onSelect: (id: string) => void }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const edit = useEditPlan();
  const decide = useDecidePlan();
  const [drafts, setDrafts] = useState<Draft[]>(() => plan.tasks.map((t) => ({ id: t.id, method: t.method, noticeEn: t.noticeEn, noticeMs: t.noticeMs })));
  const [notes, setNotes] = useState(plan.notes);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState<'approve' | 'defer' | 'reject' | null>(null);
  const [mergeReason, setMergeReason] = useState('');
  const [reviewForms, setReviewForms] = useState<Record<string, { decision: CustomerReviewInput['decision']; reason: string }>>({});
  const [folderCustomerId, setFolderCustomerId] = useState<string | null>(null);
  const folderCompany = ws.customers.find(customer => customer.id === folderCustomerId);
  const planCompanies = ws.customers.filter(customer => plan.tasks.some(task => task.customerId === customer.id));
  const editable = plan.status === 'Pending';
  const byId = useMemo(() => new Map(plan.tasks.map((t) => [t.id, t])), [plan]);
  const dirty = JSON.stringify(drafts) !== JSON.stringify(plan.tasks.map((t) => ({ id: t.id, method: t.method, noticeEn: t.noticeEn, noticeMs: t.noticeMs }))) || notes !== plan.notes;
  const event = ws.riskEvents.find((e) => e.id === plan.riskEventId);
  const records = ws.approvals.filter((a) => ws.plans.some((p) => p.id === a.planId && p.familyId === plan.familyId));
  const move = (i: number, d: -1 | 1) => setDrafts((a) => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b; });
  const patch = (i: number, p: Partial<Draft>) => setDrafts((a) => a.map((x, k) => (k === i ? { ...x, ...p } : x)));

  const persisted = useMemo(() => plan.tasks.map((t) => ({ id: t.id, method: t.method, noticeEn: t.noticeEn, noticeMs: t.noticeMs })), [plan]);
  const isV2 = !!plan.scoringSnapshot;
  const reviewsBy = useMemo(() => new Map((plan.customerReviews ?? []).map((r) => [r.customerId, r])), [plan]);
  const reviewCustomers = useMemo(() => {
    const m = new Map<string, { id: string; name: string; queue?: string; esg?: string; outstandingCents: number; days: number; tasks: number; firstRank: number }>();
    for (const t of plan.tasks) {
      const c = m.get(t.customerId) ?? { id: t.customerId, name: t.customerName, queue: t.queue, esg: t.assignedEsgRating, outstandingCents: 0, days: 0, tasks: 0, firstRank: t.rank };
      c.outstandingCents += t.outstandingCents; c.days = Math.max(c.days, t.daysOverdue); c.tasks += 1; c.firstRank = Math.min(c.firstRank, t.rank);
      m.set(t.customerId, c);
    }
    return [...m.values()].filter((c) => c.queue === 'two_dimensional' || c.esg === 'unknown').sort((a, b) => a.firstRank - b.firstRank);
  }, [plan]);
  const pendingReviews = reviewCustomers.filter((c) => !reviewsBy.has(c.id));
  const blockers: string[] = [];
  if (isV2 && pendingReviews.length) blockers.push(`${pendingReviews.length} customer review(s) pending`);
  if (isV2 && !plan.manualMerge) blockers.push('Final merged order not confirmed');
  if (dirty) blockers.push('Unsaved edits');

  const afterSave = async (np: CollectionPlan, title: string, description: string) => {
    await refresh(); onSelect(np.id);
    toast({ title, description });
  };
  const save = async () => {
    setErr('');
    try {
      const np = await edit.mutateAsync({ id: plan.id, data: { tasks: drafts, notes, expectedVersion: plan.version } });
      await afterSave(np, `Saved as new version v${np.version}`, `v${plan.version} is now Superseded.${isV2 ? ' Customer reviews are kept; the final merge was reset.' : ''}`);
    } catch (e) { setErr(errMsg(e)); }
  };
  const saveReview = async (customerId: string) => {
    const f = reviewForms[customerId];
    if (!f || !f.reason.trim()) return;
    setErr('');
    try {
      const np = await edit.mutateAsync({ id: plan.id, data: { tasks: persisted, notes: plan.notes, expectedVersion: plan.version, customerReview: { customerId, decision: f.decision, reason: f.reason.trim() } } });
      await afterSave(np, `Review saved as new version v${np.version}`, 'The decision was applied to all tasks of this customer. The final merge was reset.');
    } catch (e) { setErr(errMsg(e)); }
  };
  const confirmMerge = async () => {
    if (!mergeReason.trim()) return;
    setErr('');
    try {
      const np = await edit.mutateAsync({ id: plan.id, data: { tasks: drafts, notes, expectedVersion: plan.version, mergeReason: mergeReason.trim() } });
      await afterSave(np, `Final order confirmed in v${np.version}`, 'Manual merge recorded. Any later edit or review resets it.');
    } catch (e) { setErr(errMsg(e)); }
  };
  const doDecide = async () => {
    if (!confirm) return;
    const decision = confirm; setConfirm(null); setErr('');
    try {
      const np = await decide.mutateAsync({ id: plan.id, data: { decision, notes } });
      await refresh(); onSelect(np.id);
      toast({ title: decision === 'approve' ? 'Plan approved' : decision === 'reject' ? 'Plan rejected' : `Deferred, new pending v${np.version} created`, description: 'Recorded in the audit log.' });
    } catch (e) { setErr(errMsg(e)); }
  };
  const busy = edit.isPending || decide.isPending;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">Company folder and AI portrait</span>
        <Select value={folderCustomerId ?? ''} onValueChange={setFolderCustomerId}>
          <SelectTrigger className="w-full sm:w-80" data-testid="select-approval-company-folder"><SelectValue placeholder="Open a company folder" /></SelectTrigger>
          <SelectContent>{planCompanies.map(company => <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {err && <Alert variant="destructive" data-testid="alert-approval-error"><AlertTitle>Action failed</AlertTitle><AlertDescription>{err}</AlertDescription></Alert>}
      {!editable && <Alert><AlertDescription>This version is {plan.status} and read-only. {plan.status === 'Approved' ? 'Execute it from Execution Results.' : 'Changes require a new pending version.'}</AlertDescription></Alert>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Risk event" bodyClass="space-y-1 text-xs">
          {event ? <><div className="flex items-center gap-2"><Tag>{event.level}</Tag><span>{fmtDateTime(event.createdAt)}</span></div>
            <div>Due {rm(event.dueCents)} · Overdue {rm(event.overdueCents)}</div><div>Projected cash {rm(event.projectedCashCents)} · Gap {rm(event.gapCents)}</div>
            <ul className="list-disc pl-4 text-muted-foreground">{event.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></> : <p className="text-muted-foreground">Event record not found.</p>}
        </Panel>
        <Panel title="Scoring" bodyClass="space-y-1 text-xs">
          <ScoringSummary plan={plan} />
          <ProviderDetails plan={plan} /><div className="text-muted-foreground">Data signature <span className="font-mono">{plan.dataSignature.slice(0, 16)}</span></div>
        </Panel>
        <Panel title="Notes"><Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} placeholder="Approval notes" data-testid="input-notes" /></Panel>
      </div>
      {isV2 && <>
        <Panel title="Initial queues" bodyClass="space-y-2"><QueuesOverview tasks={plan.tasks} /></Panel>
        <Panel title={`Customer review (${reviewCustomers.length - pendingReviews.length}/${reviewCustomers.length} done)`} bodyClass="space-y-3" data-testid="panel-customer-reviews">
          <p className="text-xs text-muted-foreground">Review every 2D-queue customer (including unknown ESG) before merging. Unknown or missing ESG is never treated as bad risk. A decision applies to all of that customer's tasks and saves a new Pending version.</p>
          {reviewCustomers.length === 0 && <p className="text-sm text-muted-foreground">No customers need review in this plan.</p>}
          {reviewCustomers.map((c) => {
            const cust = ws.customers.find((x) => x.id === c.id);
            const sedg = (ws.sedgSubmissions ?? []).filter((x) => x.customerId === c.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
            const done = reviewsBy.get(c.id);
            const f = reviewForms[c.id] ?? { decision: done?.decision ?? 'collect_now', reason: '' };
            return (
              <div key={c.id} className="rounded-md border p-3 text-xs" data-testid={`review-customer-${c.id}`}>
                <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{c.name}</span><Tag tone="gray">{c.queue === 'two_dimensional' ? '2D queue' : '3D queue'}</Tag><Tag>{c.esg ?? 'unknown'}</Tag>
                  {done ? <Tag tone="green">Reviewed: {done.decision === 'collect_now' ? 'Collect now' : 'Negotiable extension'}</Tag> : <Tag tone="orange">Review pending</Tag>}
                  <Button type="button" size="sm" variant="outline" onClick={() => setFolderCustomerId(c.id)} className="ml-auto" data-testid={`link-folder-${c.id}`}><ExternalLink className="mr-1 h-3 w-3" />Open company folder</Button></div>
                <div className="mt-1 grid gap-x-4 gap-y-0.5 text-muted-foreground sm:grid-cols-2">
                  <div>Total outstanding {rm(c.outstandingCents)} across {c.tasks} task(s)</div><div>Max days overdue {c.days}</div>
                  <div>Profile: {cust?.profileSummary ? `v${cust.profileVersion ?? 0}, ${safeHistorical(cust.profileSummary).slice(0, 120)}` : 'No profile summary recorded'}</div>
                  <div>SEDG: {sedg ? `${sedg.status}, ${fmtDate(sedg.createdAt)}` : 'Not submitted (neutral, not a risk signal)'}</div>
                </div>
                {done && <div className="mt-1 text-muted-foreground">Last review by {done.actor} at {fmtDateTime(done.createdAt)}: {done.reason} (profile v{done.profileVersion}{done.sedgSubmissionId ? `, SEDG ${done.sedgSubmissionId.slice(-6)}` : ', no SEDG'})</div>}
                {editable && <div className="mt-2 grid gap-2 sm:grid-cols-[200px_1fr_auto] sm:items-end">
                  <Select value={f.decision} onValueChange={(v) => setReviewForms((x) => ({ ...x, [c.id]: { ...f, decision: v as CustomerReviewInput['decision'] } }))}><SelectTrigger data-testid={`select-review-decision-${c.id}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="collect_now">Collect now</SelectItem><SelectItem value="negotiable_extension">Negotiable extension</SelectItem></SelectContent></Select>
                  <Textarea rows={2} value={f.reason} onChange={(e) => setReviewForms((x) => ({ ...x, [c.id]: { ...f, reason: e.target.value } }))} placeholder="Reason for this decision (required)" data-testid={`input-review-reason-${c.id}`} />
                  <Button size="sm" onClick={() => saveReview(c.id)} disabled={dirty || busy || !f.reason.trim()} data-testid={`button-save-review-${c.id}`}>{done ? 'Update review' : 'Save review'}</Button>
                </div>}
                {editable && dirty && <p className="mt-1 text-[11px] text-orange-700">Save or discard task edits before recording a review.</p>}
              </div>);
          })}
        </Panel>
        <Panel title="Final merged order" bodyClass="space-y-2" data-testid="panel-merge">
          {plan.manualMerge ? <Alert><AlertDescription data-testid="text-merge-confirmed">Final order confirmed by {plan.manualMerge.actor} at {fmtDateTime(plan.manualMerge.createdAt)}: {plan.manualMerge.reason}</AlertDescription></Alert>
            : <Alert><AlertDescription>Final order not confirmed. The initial order is the 2D queue followed by the 3D queue. Reorder tasks below, give a reason, then confirm. Approval and execution stay blocked until then.</AlertDescription></Alert>}
          {editable && <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <Textarea rows={2} value={mergeReason} onChange={(e) => setMergeReason(e.target.value)} placeholder="Reason for the final order (required)" data-testid="input-merge-reason" />
            <Button onClick={confirmMerge} disabled={busy || !mergeReason.trim() || pendingReviews.length > 0} data-testid="button-confirm-merge"><ListChecks className="mr-1 h-4 w-4" />Confirm final order</Button>
          </div>}
          {editable && pendingReviews.length > 0 && <p className="text-xs text-orange-700">Complete all 2D customer reviews first.</p>}
          {editable && dirty && <p className="text-xs text-muted-foreground">Confirming also saves the current order and edits as a new version.</p>}
        </Panel>
      </>}
      <Panel title="Tasks (order = collection sequence)" bodyClass="space-y-2">
        {drafts.length === 0 && <EmptyState title="Plan has no tasks" />}
        {drafts.map((d, i) => {
          const t = byId.get(d.id); if (!t) return null;
          return (
            <details key={d.id} className="rounded-md border" data-testid={`approval-task-${d.id}`}>
              <summary className="flex cursor-pointer items-center gap-2 p-3 hover:bg-accent/50">
                <span className="flex flex-col"><button type="button" disabled={!editable || i === 0} onClick={(e) => { e.preventDefault(); move(i, -1); }} className="rounded p-0.5 hover:bg-muted disabled:opacity-30" aria-label="Move up" data-testid={`button-up-${d.id}`}><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button type="button" disabled={!editable || i === drafts.length - 1} onClick={(e) => { e.preventDefault(); move(i, 1); }} className="rounded p-0.5 hover:bg-muted disabled:opacity-30" aria-label="Move down" data-testid={`button-down-${d.id}`}><ArrowDown className="h-3.5 w-3.5" /></button></span>
                <div className="flex-1"><TaskHead t={{ ...t, rank: i + 1, method: d.method }} /></div>
              </summary>
              <div className="space-y-3 border-t p-3">
                <Field label="Collection method">
                  <Select value={d.method} onValueChange={(v) => patch(i, { method: v })} disabled={!editable}><SelectTrigger className="sm:w-72" data-testid={`select-method-${d.id}`}><SelectValue /></SelectTrigger><SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select>
                </Field>
                {d.method !== t.method && <p className="text-xs text-orange-700">On save, unchanged EN/MS templates follow the new method. Custom wording is preserved; review both languages before approval.</p>}
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Notice (English)"><Textarea rows={7} value={d.noticeEn} onChange={(e) => patch(i, { noticeEn: e.target.value })} disabled={!editable} data-testid={`input-notice-en-${d.id}`} /></Field>
                  <Field label="Notis (Bahasa Melayu)"><Textarea rows={7} value={d.noticeMs} onChange={(e) => patch(i, { noticeMs: e.target.value })} disabled={!editable} data-testid={`input-notice-ms-${d.id}`} /></Field>
                </div>
                <TaskDetail t={t} weights={plan.weights} snapshot={plan.scoringSnapshot} defaultLanguage={ws.settings.language} />
              </div>
            </details>
          );
        })}
      </Panel>
      <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-md">
        <Button variant="outline" onClick={save} disabled={!editable || !dirty || busy} data-testid="button-save-edits"><Save className="mr-1 h-4 w-4" />Save edits as new version</Button>
        {editable && blockers.length > 0 && <span className="text-xs text-orange-700" data-testid="text-approve-blockers">Approval blocked: {blockers.join('; ')}.</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button className="bg-emerald-700 hover:bg-emerald-800" onClick={() => setConfirm('approve')} disabled={!editable || blockers.length > 0 || busy} data-testid="button-approve"><CheckCircle2 className="mr-1 h-4 w-4" />{ws.smtpEnabled ? 'Approve for SMTP execution' : 'Approve & Simulate Execution'}</Button>
          <Button variant="outline" onClick={() => setConfirm('defer')} disabled={!editable || dirty || busy} data-testid="button-defer"><Clock3 className="mr-1 h-4 w-4" />Defer & Recalculate</Button>
          <Button variant="destructive" onClick={() => setConfirm('reject')} disabled={!editable || dirty || busy} data-testid="button-reject"><XCircle className="mr-1 h-4 w-4" />Reject Plan</Button>
        </div>
      </div>
      <Panel title="Decision history" bodyClass="space-y-2">
        {records.length === 0 ? <p className="text-sm text-muted-foreground">No decisions recorded for this plan family.</p> : records.map((a) => (
          <details key={a.id} className="rounded-md border p-2 text-sm" data-testid={`approval-record-${a.id}`}>
            <summary className="cursor-pointer"><Tag>{a.decision}</Tag> v{a.version} · {a.actor} · {fmtDateTime(a.createdAt)} {a.notes && `· ${a.notes}`}</summary>
            <div className="mt-2 grid gap-2 md:grid-cols-2"><div><div className="text-xs font-semibold">Original</div><pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[10px]">{safeHistorical(a.originalSnapshot)}</pre></div><div><div className="text-xs font-semibold">Final</div><pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[10px]">{safeHistorical(a.finalSnapshot)}</pre></div></div>
          </details>))}
      </Panel>
      <Sheet open={!!folderCompany} onOpenChange={open => { if (!open) setFolderCustomerId(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {folderCompany && <div className="space-y-4">
            <SheetHeader><SheetTitle>{folderCompany.name}</SheetTitle><SheetDescription>Company folder · {folderCompany.id} · AI portrait and supporting evidence</SheetDescription></SheetHeader>
            <CompanyFolder key={folderCompany.id} customer={folderCompany} ws={ws} />
          </div>}
        </SheetContent>
      </Sheet>
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{confirm === 'approve' ? 'Approve this plan?' : confirm === 'defer' ? 'Defer and recalculate?' : 'Reject this plan?'}</AlertDialogTitle>
            <AlertDialogDescription>{confirm === 'approve' ? ws.smtpEnabled ? 'The plan becomes Approved. Execution is a separate step that sends real email through SMTP to the configured recipient.' : 'The plan becomes Approved. Execution is a separate simulated step; no real notices are sent.' : confirm === 'defer' ? 'This version is deferred and a new pending version is recalculated.' : 'The plan is rejected and cannot be executed.'}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={doDecide} data-testid="button-confirm-decision">Confirm</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function Approvals() {
  const [params, setParams] = useSearchParams();
  const sel = params.get('plan') ?? '';
  const selectPlan = (id: string) => {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('plan', id);
      return next;
    }, { replace: true });
  };
  return (
    <Page title="Approval Center" description="Review, adjust and decide on AI collection plans">
      {(ws) => {
        const plans = [...ws.plans].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const plan = plans.find((p) => p.id === sel) ?? plans.find((p) => p.status === 'Pending') ?? plans[0];
        return (
          <div className="space-y-4">
            <Alert data-testid="smtp-mode-status">
              <AlertDescription>{ws.smtpEnabled ? '【当前：真实发送模式】' : '【当前：模拟模式】'}</AlertDescription>
            </Alert>
            {!plan ? <EmptyState title="No plans yet" hint="Generate a plan from a risk event." action={<Button asChild size="sm"><Link href="/risk-triggers">Go to Risk Triggers</Link></Button>} /> : <>
            <Panel bodyClass="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">Plan / version</span>
              <Select value={plan.id} onValueChange={selectPlan}><SelectTrigger className="w-full sm:w-96" data-testid="select-plan"><SelectValue /></SelectTrigger>
                <SelectContent>{plans.map((p) => <SelectItem key={p.id} value={p.id}>Family {p.familyId.slice(-6)} · v{p.version} · {p.status} · {fmtDateTime(p.createdAt)}</SelectItem>)}</SelectContent></Select>
              <Tag>{plan.status}</Tag>
              <span className="text-xs text-muted-foreground">{ws.plans.filter((p) => p.status === 'Pending').length} pending</span>
            </Panel>
            <Editor key={plan.id} ws={ws} plan={plan} onSelect={selectPlan} />
            </>}
          </div>
        );
      }}
    </Page>
  );
}
