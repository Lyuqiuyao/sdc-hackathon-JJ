import { useState } from 'react';
import { Link } from 'wouter';
import { Download, PlayCircle } from 'lucide-react';
import { getExecutionMode, getPlanRecipients, useExecutePlan, type GetExecutionModeQueryResult, type PlanRecipients } from '@workspace/api-client-react';
import { Page, Panel, Tag, EmptyState } from '@/components/kit';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { download, errMsg, fmtDateTime, fmtfix, rm, toCsv, useRefresh } from '@/lib/arus';
import { ProviderDetails } from '@/components/provider-details';
import { ScoringSummary } from '@/components/plan';

export default function ExecutionResults() {
  const { toast } = useToast();
  const refresh = useRefresh();
  const exec = useExecutePlan();
  const [sel, setSel] = useState('');
  const [ask, setAsk] = useState(false);
  const [checkingMode, setCheckingMode] = useState(false);
  const [confirmation, setConfirmation] = useState<(GetExecutionModeQueryResult & PlanRecipients & { planId: string }) | null>(null);
  const [err, setErr] = useState('');
  return (
    <Page title="Execution Results" description="Execution records for approved plans">
      {(ws) => {
        const plans = ws.plans.filter((p) => ['Approved', 'Executed'].includes(p.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const plan = plans.find((p) => p.id === sel) ?? plans[0];
        const recs = plan ? ws.executions.filter((e) => e.planId === plan.id) : [];
        const approval = plan ? ws.approvals.filter((a) => a.planId === plan.id).slice(-1)[0] : undefined;
        const confirmExecution = async () => {
          if (!plan) return;
          setErr(''); setConfirmation(null); setCheckingMode(true);
          try {
            // Direct request for each confirmation, not a workspace/query cache.
            const current = await getExecutionMode({ cache: 'no-store' });
            const recipients = await getPlanRecipients(plan.id, { cache: 'no-store' });
            setConfirmation({ ...current, ...recipients, planId: plan.id }); setAsk(true);
          } catch (e) { setErr(errMsg(e)); }
          finally { setCheckingMode(false); }
        };
        const run = async () => {
          if (!confirmation) return;
          const confirmed = confirmation;
          setAsk(false); setConfirmation(null); setErr('');
          try {
            await exec.mutateAsync({ id: confirmed.planId, data: { expectedSmtpEnabled: confirmed.smtpEnabled,
              expectedRecipientsSignature: confirmed.signature } }); await refresh();
            toast({ title: 'Execution state recorded',
              description: 'Review the execution records for actual channels and outcomes. No invoice payment was changed.' });
          } catch (e) {
            setErr(errMsg(e));
            // Earlier tasks may already have been accepted before a later SMTP failure.
            await refresh();
          }
        };
        const v2Blockers: string[] = [];
        if (plan?.scoringSnapshot) {
          const need = new Set(plan.tasks.filter((t) => t.queue === 'two_dimensional' || t.assignedEsgRating === 'unknown').map((t) => t.customerId));
          const done = new Set((plan.customerReviews ?? []).map((r) => r.customerId));
          const missing = [...need].filter((id) => !done.has(id)).length;
          if (missing) v2Blockers.push(`${missing} customer review(s) pending`);
          if (!plan.manualMerge) v2Blockers.push('final merged order not confirmed');
        }
        const report = () => {
          if (!plan) return;
          const head = ['rank', 'invoice_number', 'customer', 'outstanding_MYR', 'due_date', 'priority_score', 'method', 'scheduled_at', 'plan_version', 'plan_status', 'task_status', 'execution_result', 'notice_status', 'notice_en', 'notice_ms', 'provider_mode', 'generation_status', 'generated_at', 'notice_en_source', 'notice_ms_source', 'data_source'];
          download(`arus-plan-v${plan.version}-report.csv`, toCsv([head, ...plan.tasks.map((t) => { const r = recs.find((x) => x.taskId === t.id); return [t.rank, t.invoiceNumber, t.customerName, fmtfix(t.outstandingCents), t.dueDate, t.score.toFixed(1), t.method, t.scheduledAt, plan.version, plan.status, t.status, r?.result ?? 'Not executed', r?.noticeStatus ?? '-', t.noticeEn, t.noticeMs, plan.providerMode ?? 'rules_fallback', plan.aiGeneration?.status ?? 'legacy', plan.aiGeneration?.generatedAt ?? '', t.noticeEnSource ?? 'rules_fallback', t.noticeMsSource ?? 'rules_fallback', 'Synthetic Demo Data']; })]));
        };
        return (
          <div className="space-y-4">
            <Alert><AlertDescription>Execution mode is checked directly with the server before confirmation. Simulation sends no messages; real SMTP sends to the configured SMTP_TO mailbox. SMTP acceptance does not guarantee inbox delivery. Invoice payment records are not changed.</AlertDescription></Alert>
            {err && <Alert variant="destructive" data-testid="alert-exec-error"><AlertTitle>Execution failed</AlertTitle><AlertDescription>{err}</AlertDescription></Alert>}
            {!plan ? <EmptyState title="No approved plan yet" hint="Only approved plans can be executed. Approve a pending plan first." action={<Button asChild size="sm"><Link href="/approvals">Open Approval Center</Link></Button>} /> : (
              <>
                <Panel bodyClass="flex flex-wrap items-center gap-3">
                  <Select value={plan.id} onValueChange={setSel}><SelectTrigger className="w-full sm:w-96" data-testid="select-plan"><SelectValue /></SelectTrigger>
                    <SelectContent>{plans.map((p) => <SelectItem key={p.id} value={p.id}>v{p.version} · {p.status} · {fmtDateTime(p.createdAt)}</SelectItem>)}</SelectContent></Select>
                  <Tag>{plan.status}</Tag>
                  {approval && <span className="text-xs text-muted-foreground">Approved by {approval.actor} at {fmtDateTime(approval.createdAt)}</span>}
                  <div className="ml-auto flex flex-wrap gap-2">
                    <Button variant="outline" onClick={report} data-testid="button-export-report"><Download className="mr-1 h-4 w-4" />Export Report</Button>
                    <Button onClick={confirmExecution} disabled={plan.status !== 'Approved' || exec.isPending || checkingMode || v2Blockers.length > 0} data-testid="button-execute"><PlayCircle className="mr-1 h-4 w-4" />{checkingMode ? 'Checking server mode...' : exec.isPending ? 'Executing...' : 'Execute Approved Plan'}</Button>
                  </div>
                </Panel>
                {v2Blockers.length > 0 && <Alert data-testid="alert-exec-blocked"><AlertDescription>Execution blocked: {v2Blockers.join('; ')}. Complete these in the Approval Center.</AlertDescription></Alert>}
                <Panel title="Scoring method" bodyClass="text-xs"><ScoringSummary plan={plan} />{plan.manualMerge && <p className="mt-2" data-testid="text-exec-merge">Final order confirmed by {plan.manualMerge.actor} at {fmtDateTime(plan.manualMerge.createdAt)}: {plan.manualMerge.reason}</p>}</Panel>
                <ProviderDetails plan={plan} />
                <Panel title={`Final collection order · ${plan.tasks.length} tasks`} bodyClass="p-0">
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead>Method</TableHead><TableHead>Scheduled</TableHead><TableHead className="text-right">Score</TableHead><TableHead>Approval</TableHead><TableHead>Execution</TableHead></TableRow></TableHeader>
                    <TableBody>{plan.tasks.map((t) => { const r = recs.find((x) => x.taskId === t.id); return (
                      <TableRow key={t.id} data-testid={`row-task-${t.id}`}>
                        <TableCell>{t.rank}</TableCell><TableCell className="font-mono text-xs">{t.invoiceNumber}</TableCell><TableCell>{t.customerName}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{rm(t.outstandingCents)}</TableCell><TableCell className="text-xs">{t.method}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(t.scheduledAt)}</TableCell><TableCell className="text-right font-mono text-xs">{t.score.toFixed(1)}</TableCell>
                        <TableCell><Tag>{plan.status}</Tag></TableCell><TableCell>{r ? <span className="text-xs"><Tag tone="green">{r.result}</Tag> <span className="text-muted-foreground">{r.noticeStatus}</span></span> : <Tag tone="gray">{t.status || 'Not executed'}</Tag>}</TableCell>
                      </TableRow>); })}</TableBody>
                  </Table></div>
                </Panel>
                <Panel title="Task notices" bodyClass="space-y-2">
                  {plan.tasks.map((t) => <details key={t.id} className="rounded-md border p-2 text-sm"><summary className="cursor-pointer">{t.rank}. {t.invoiceNumber} · {t.customerName}</summary><div className="mt-2 grid gap-2 md:grid-cols-2"><pre className="whitespace-pre-wrap rounded bg-muted/60 p-2 font-sans text-xs">{t.noticeEn}</pre><pre className="whitespace-pre-wrap rounded bg-muted/60 p-2 font-sans text-xs">{t.noticeMs}</pre></div></details>)}
                </Panel>
                <Panel title={`Execution records (${ws.executions.length})`} bodyClass="p-0">
                  {ws.executions.length === 0 ? <div className="p-4"><EmptyState title="Nothing executed yet" /></div> : (
                    <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Executed</TableHead><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Channel</TableHead><TableHead>Recipient</TableHead><TableHead>Plan</TableHead><TableHead>Actor</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                      <TableBody>{[...ws.executions].sort((a, b) => b.executedAt.localeCompare(a.executedAt)).map((e) => {
                        const ap = ws.approvals.filter((a) => a.planId === e.planId && a.decision.toLowerCase().startsWith('approv')).slice(-1)[0];
                        return (
                          <TableRow key={e.id} data-testid={`row-execution-${e.id}`}><TableCell className="whitespace-nowrap text-xs">{fmtDateTime(e.executedAt)}</TableCell><TableCell className="font-mono text-xs">{e.invoiceNumber}</TableCell><TableCell>{e.customerName}</TableCell>
                            <TableCell className="text-xs">{e.channel ?? 'Not recorded'}</TableCell><TableCell className="font-mono text-xs">{e.recipient ?? 'Not recorded'}</TableCell><TableCell className="text-xs">{e.planVersion !== undefined ? `v${e.planVersion}` : 'Not recorded'}</TableCell>
                            <TableCell>{e.actor}</TableCell>
                            <TableCell className="text-xs"><div>{e.result}</div><div className="text-muted-foreground">{e.noticeStatus}</div>{ap && <div className="text-muted-foreground">Approval: {ap.actor}, {fmtDateTime(ap.createdAt)}</div>}
                              <details className="mt-1"><summary className="cursor-pointer text-primary">{e.channel === 'SMTP Email' ? 'SMTP message' : 'Simulated message'}</summary>
                                {e.noticeEn || e.noticeMs ? <div className="mt-1 grid min-w-[280px] gap-2 md:grid-cols-2"><div><div className="font-semibold">English</div><pre className="whitespace-pre-wrap rounded bg-muted/60 p-2 font-sans">{e.noticeEn ?? 'Not recorded'}</pre></div><div><div className="font-semibold">Bahasa Melayu</div><pre className="whitespace-pre-wrap rounded bg-muted/60 p-2 font-sans">{e.noticeMs ?? 'Not recorded'}</pre></div></div> : <p className="mt-1 text-muted-foreground">Message body not recorded (legacy record).</p>}
                                <p className="mt-1 text-muted-foreground">{e.channel === 'SMTP Email' ? 'Accepted by SMTP. Delivery to a real mailbox is not guaranteed.' : 'Simulation only. Nothing was delivered to a real mailbox.'}</p></details></TableCell></TableRow>); })}</TableBody></Table></div>)}
                </Panel>
              </>)}
            <AlertDialog open={ask} onOpenChange={open => { setAsk(open); if (!open) setConfirmation(null); }}>
              <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmation?.smtpEnabled ? 'Execute approved plan (real SMTP)?' : 'Execute approved plan (simulation)?'}</AlertDialogTitle><AlertDialogDescription>{confirmation?.smtpEnabled ? 'Real SMTP sends each selected bilingual variant to its confirmed customer mailbox below. Previously accepted tasks are not resent. Changes to mode, recipients or approved messages require reconfirmation.' : 'Simulation only. No real message is sent. Missing customer mailboxes use synthetic example.invalid addresses in simulated records.'}</AlertDialogDescription></AlertDialogHeader>
                <ul className="max-h-52 space-y-2 overflow-auto text-xs" data-testid="list-confirm-recipients">{confirmation?.recipients.map(row =>
                  <li key={row.taskId} className="rounded border p-2"><b>{row.customerName}</b> · {row.noticeKind === 'extension' ? 'Negotiable extension' : 'Immediate collection'}<div className={row.valid ? '' : 'text-red-700'}>{row.recipient || 'Customer collection email not configured'}{!row.valid && row.recipient ? ' (invalid)' : ''}</div></li>)}</ul>
                {confirmation?.smtpEnabled && confirmation.recipients.some(row => !row.valid) && <p className="text-xs text-red-700" role="alert">Set valid customer collection emails and obtain current approval before real sending.</p>}
                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={!confirmation || exec.isPending || (confirmation.smtpEnabled && confirmation.recipients.some(row => !row.valid))} onClick={run} data-testid="button-confirm-execute">Execute</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
            </AlertDialog>
          </div>
        );
      }}
    </Page>
  );
}
