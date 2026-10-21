import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'wouter';
import { ArrowDown, ArrowUp, CheckCircle2, Clock3, Save, XCircle } from 'lucide-react';
import { useDecidePlan, useEditPlan, type CollectionPlan, type Workspace } from '@workspace/api-client-react';
import { Page, Panel, Tag, EmptyState, Field } from '@/components/kit';
import { TaskDetail, TaskHead } from '@/components/plan';
import { ProviderDetails } from '@/components/provider-details';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { METHODS, errMsg, fmtDateTime, rm, useRefresh } from '@/lib/arus';

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
  const editable = plan.status === 'Pending';
  const byId = useMemo(() => new Map(plan.tasks.map((t) => [t.id, t])), [plan]);
  const dirty = JSON.stringify(drafts) !== JSON.stringify(plan.tasks.map((t) => ({ id: t.id, method: t.method, noticeEn: t.noticeEn, noticeMs: t.noticeMs }))) || notes !== plan.notes;
  const event = ws.riskEvents.find((e) => e.id === plan.riskEventId);
  const records = ws.approvals.filter((a) => ws.plans.some((p) => p.id === a.planId && p.familyId === plan.familyId));
  const move = (i: number, d: -1 | 1) => setDrafts((a) => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b; });
  const patch = (i: number, p: Partial<Draft>) => setDrafts((a) => a.map((x, k) => (k === i ? { ...x, ...p } : x)));

  const save = async () => {
    setErr('');
    try {
      const np = await edit.mutateAsync({ id: plan.id, data: { tasks: drafts, notes } });
      await refresh(); onSelect(np.id);
      toast({ title: `Saved as new version v${np.version}`, description: `v${plan.version} is now Superseded.` });
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
      {err && <Alert variant="destructive" data-testid="alert-approval-error"><AlertTitle>Action failed</AlertTitle><AlertDescription>{err}</AlertDescription></Alert>}
      {!editable && <Alert><AlertDescription>This version is {plan.status} and read-only. {plan.status === 'Approved' ? 'Execute it from Execution Results.' : 'Changes require a new pending version.'}</AlertDescription></Alert>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Risk event" zh="风险事件" bodyClass="space-y-1 text-xs">
          {event ? <><div className="flex items-center gap-2"><Tag>{event.level}</Tag><span>{fmtDateTime(event.createdAt)}</span></div>
            <div>Due {rm(event.dueCents)} · Overdue {rm(event.overdueCents)}</div><div>Projected cash {rm(event.projectedCashCents)} · Gap {rm(event.gapCents)}</div>
            <ul className="list-disc pl-4 text-muted-foreground">{event.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></> : <p className="text-muted-foreground">Event record not found.</p>}
        </Panel>
        <Panel title="Scoring" zh="评分因素与权重" bodyClass="space-y-1 text-xs">
          <div>Late fee {plan.weights.lateFee}% · Urgency {plan.weights.urgency}% · Importance {plan.weights.importance}% · ESG {plan.weights.esg}%</div>
          <ProviderDetails plan={plan} /><div className="text-muted-foreground">Data signature <span className="font-mono">{plan.dataSignature.slice(0, 16)}</span></div>
          <div className="text-muted-foreground">Missing ESG data is scored neutral 50 and flagged per task.</div>
        </Panel>
        <Panel title="Notes" zh="审批备注"><Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} placeholder="Approval notes" data-testid="input-notes" /></Panel>
      </div>
      <Panel title="Tasks (order = collection sequence)" zh="催收任务 · 调整顺序与文案" bodyClass="space-y-2">
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
                <Field label="Collection method · 催收方式">
                  <Select value={d.method} onValueChange={(v) => patch(i, { method: v })} disabled={!editable}><SelectTrigger className="sm:w-72" data-testid={`select-method-${d.id}`}><SelectValue /></SelectTrigger><SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select>
                </Field>
                {d.method !== t.method && <p className="text-xs text-orange-700">On save, unchanged EN/MS templates follow the new method. Custom wording is preserved; review both languages before approval.</p>}
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Notice (English)"><Textarea rows={7} value={d.noticeEn} onChange={(e) => patch(i, { noticeEn: e.target.value })} disabled={!editable} data-testid={`input-notice-en-${d.id}`} /></Field>
                  <Field label="Notis (Bahasa Melayu)"><Textarea rows={7} value={d.noticeMs} onChange={(e) => patch(i, { noticeMs: e.target.value })} disabled={!editable} data-testid={`input-notice-ms-${d.id}`} /></Field>
                </div>
                <TaskDetail t={t} weights={plan.weights} defaultLanguage={ws.settings.language} />
              </div>
            </details>
          );
        })}
      </Panel>
      <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-md">
        <Button variant="outline" onClick={save} disabled={!editable || !dirty || busy} data-testid="button-save-edits"><Save className="mr-1 h-4 w-4" />Save edits as new version</Button>
        {dirty && editable && <span className="text-xs text-orange-700">Unsaved edits. Save before deciding.</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button className="bg-emerald-700 hover:bg-emerald-800" onClick={() => setConfirm('approve')} disabled={!editable || dirty || busy} data-testid="button-approve"><CheckCircle2 className="mr-1 h-4 w-4" />Approve & Simulate Execution</Button>
          <Button variant="outline" onClick={() => setConfirm('defer')} disabled={!editable || dirty || busy} data-testid="button-defer"><Clock3 className="mr-1 h-4 w-4" />Defer & Recalculate</Button>
          <Button variant="destructive" onClick={() => setConfirm('reject')} disabled={!editable || dirty || busy} data-testid="button-reject"><XCircle className="mr-1 h-4 w-4" />Reject Plan</Button>
        </div>
      </div>
      <Panel title="Decision history" zh="审批记录" bodyClass="space-y-2">
        {records.length === 0 ? <p className="text-sm text-muted-foreground">No decisions recorded for this plan family.</p> : records.map((a) => (
          <details key={a.id} className="rounded-md border p-2 text-sm" data-testid={`approval-record-${a.id}`}>
            <summary className="cursor-pointer"><Tag>{a.decision}</Tag> v{a.version} · {a.actor} · {fmtDateTime(a.createdAt)} {a.notes && `· ${a.notes}`}</summary>
            <div className="mt-2 grid gap-2 md:grid-cols-2"><div><div className="text-xs font-semibold">Original</div><pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[10px]">{a.originalSnapshot}</pre></div><div><div className="text-xs font-semibold">Final</div><pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[10px]">{a.finalSnapshot}</pre></div></div>
          </details>))}
      </Panel>
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{confirm === 'approve' ? 'Approve this plan?' : confirm === 'defer' ? 'Defer and recalculate?' : 'Reject this plan?'}</AlertDialogTitle>
            <AlertDialogDescription>{confirm === 'approve' ? 'The plan becomes Approved. Execution is a separate simulated step; no real notices are sent.' : confirm === 'defer' ? 'This version is deferred and a new pending version is recalculated.' : 'The plan is rejected and cannot be executed.'}</AlertDialogDescription></AlertDialogHeader>
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
    <Page title="Approval Center" zh="人工审批中心" description="Review, adjust and decide on AI collection plans">
      {(ws) => {
        const plans = [...ws.plans].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        if (!plans.length) return <EmptyState title="No plans yet" hint="Generate a plan from a risk event." action={<Button asChild size="sm"><Link href="/risk-triggers">Go to Risk Triggers</Link></Button>} />;
        const plan = plans.find((p) => p.id === sel) ?? plans.find((p) => p.status === 'Pending') ?? plans[0];
        return (
          <div className="space-y-4">
            <Panel bodyClass="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">Plan / version</span>
              <Select value={plan.id} onValueChange={selectPlan}><SelectTrigger className="w-full sm:w-96" data-testid="select-plan"><SelectValue /></SelectTrigger>
                <SelectContent>{plans.map((p) => <SelectItem key={p.id} value={p.id}>Family {p.familyId.slice(-6)} · v{p.version} · {p.status} · {fmtDateTime(p.createdAt)}</SelectItem>)}</SelectContent></Select>
              <Tag>{plan.status}</Tag>
              <span className="text-xs text-muted-foreground">{ws.plans.filter((p) => p.status === 'Pending').length} pending</span>
            </Panel>
            <Editor key={plan.id} ws={ws} plan={plan} onSelect={selectPlan} />
          </div>
        );
      }}
    </Page>
  );
}
