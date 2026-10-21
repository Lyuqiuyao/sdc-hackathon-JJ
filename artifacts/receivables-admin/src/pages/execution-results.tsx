import { useState } from 'react';
import { Link } from 'wouter';
import { Download, PlayCircle } from 'lucide-react';
import { useExecutePlan } from '@workspace/api-client-react';
import { Page, Panel, Tag, EmptyState } from '@/components/kit';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { download, errMsg, fmtDate, fmtDateTime, fmtfix, rm, toCsv, useRefresh } from '@/lib/arus';

export default function ExecutionResults() {
  const { toast } = useToast();
  const refresh = useRefresh();
  const exec = useExecutePlan();
  const [sel, setSel] = useState('');
  const [ask, setAsk] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Page title="Execution Results" zh="执行结果" description="Simulated execution of approved plans only">
      {(ws) => {
        const plans = ws.plans.filter((p) => ['Approved', 'Executed'].includes(p.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const plan = plans.find((p) => p.id === sel) ?? plans[0];
        const recs = plan ? ws.executions.filter((e) => e.planId === plan.id) : [];
        const approval = plan ? ws.approvals.filter((a) => a.planId === plan.id).slice(-1)[0] : undefined;
        const run = async () => {
          if (!plan) return; setAsk(false); setErr('');
          try { await exec.mutateAsync({ id: plan.id }); await refresh(); toast({ title: 'Simulated execution recorded', description: 'No real notices were sent and no payments changed.' }); } catch (e) { setErr(errMsg(e)); }
        };
        const report = () => {
          if (!plan) return;
          const head = ['rank', 'invoice_number', 'customer', 'outstanding_MYR', 'due_date', 'priority_score', 'method', 'scheduled_at', 'plan_version', 'plan_status', 'task_status', 'execution_result', 'notice_status', 'notice_en', 'notice_ms'];
          download(`arus-plan-v${plan.version}-report.csv`, toCsv([head, ...plan.tasks.map((t) => { const r = recs.find((x) => x.taskId === t.id); return [t.rank, t.invoiceNumber, t.customerName, fmtfix(t.outstandingCents), t.dueDate, t.score.toFixed(1), t.method, t.scheduledAt, plan.version, plan.status, t.status, r?.result ?? 'Not executed', r?.noticeStatus ?? '-', t.noticeEn, t.noticeMs]; })]));
        };
        return (
          <div className="space-y-4">
            <Alert><AlertDescription>Execution is a demo simulation. It records tasks and marks notices as generated or simulated only; no email or message is sent and invoice payment records are not changed.</AlertDescription></Alert>
            {err && <Alert variant="destructive" data-testid="alert-exec-error"><AlertTitle>Execution failed</AlertTitle><AlertDescription>{err}</AlertDescription></Alert>}
            {!plan ? <EmptyState title="No approved plan yet" hint="Only approved plans can be executed. Approve a pending plan first." action={<Button asChild size="sm"><Link href="/approvals">Open Approval Center</Link></Button>} /> : (
              <>
                <Panel bodyClass="flex flex-wrap items-center gap-3">
                  <Select value={plan.id} onValueChange={setSel}><SelectTrigger className="w-full sm:w-96" data-testid="select-plan"><SelectValue /></SelectTrigger>
                    <SelectContent>{plans.map((p) => <SelectItem key={p.id} value={p.id}>v{p.version} · {p.status} · {fmtDateTime(p.createdAt)}</SelectItem>)}</SelectContent></Select>
                  <Tag>{plan.status}</Tag>
                  {approval && <span className="text-xs text-muted-foreground">Approved by {approval.actor} at {fmtDateTime(approval.createdAt)}</span>}
                  <div className="ml-auto flex gap-2">
                    <Button variant="outline" onClick={report} data-testid="button-export-report"><Download className="mr-1 h-4 w-4" />Export Report</Button>
                    <Button onClick={() => setAsk(true)} disabled={plan.status !== 'Approved' || exec.isPending} data-testid="button-execute"><PlayCircle className="mr-1 h-4 w-4" />{exec.isPending ? 'Executing...' : 'Execute Approved Plan'}</Button>
                  </div>
                </Panel>
                <Panel title={`Final collection order · ${plan.tasks.length} tasks`} zh="最终催收顺序" bodyClass="p-0">
                  <div className="overflow-x-auto"><Table>
                    <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead>Method</TableHead><TableHead>Scheduled</TableHead><TableHead className="text-right">Score</TableHead><TableHead>Approval</TableHead><TableHead>Simulated execution</TableHead></TableRow></TableHeader>
                    <TableBody>{plan.tasks.map((t) => { const r = recs.find((x) => x.taskId === t.id); return (
                      <TableRow key={t.id} data-testid={`row-task-${t.id}`}>
                        <TableCell>{t.rank}</TableCell><TableCell className="font-mono text-xs">{t.invoiceNumber}</TableCell><TableCell>{t.customerName}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{rm(t.outstandingCents)}</TableCell><TableCell className="text-xs">{t.method}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(t.scheduledAt)}</TableCell><TableCell className="text-right font-mono text-xs">{t.score.toFixed(1)}</TableCell>
                        <TableCell><Tag>{plan.status}</Tag></TableCell><TableCell>{r ? <span className="text-xs"><Tag tone="green">{r.result}</Tag> <span className="text-muted-foreground">{r.noticeStatus}</span></span> : <Tag tone="gray">{t.status || 'Not executed'}</Tag>}</TableCell>
                      </TableRow>); })}</TableBody>
                  </Table></div>
                </Panel>
                <Panel title="Task notices" zh="通知文案 (草稿)" bodyClass="space-y-2">
                  {plan.tasks.map((t) => <details key={t.id} className="rounded-md border p-2 text-sm"><summary className="cursor-pointer">{t.rank}. {t.invoiceNumber} · {t.customerName}</summary><div className="mt-2 grid gap-2 md:grid-cols-2"><pre className="whitespace-pre-wrap rounded bg-muted/60 p-2 font-sans text-xs">{t.noticeEn}</pre><pre className="whitespace-pre-wrap rounded bg-muted/60 p-2 font-sans text-xs">{t.noticeMs}</pre></div></details>)}
                </Panel>
                <Panel title={`Execution records (${ws.executions.length})`} zh="执行记录" bodyClass="p-0">
                  {ws.executions.length === 0 ? <div className="p-4"><EmptyState title="Nothing executed yet" /></div> : (
                    <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Executed</TableHead><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Actor</TableHead><TableHead>Result</TableHead><TableHead>Notice</TableHead></TableRow></TableHeader>
                      <TableBody>{[...ws.executions].sort((a, b) => b.executedAt.localeCompare(a.executedAt)).map((e) => <TableRow key={e.id}><TableCell className="whitespace-nowrap text-xs">{fmtDate(e.executedAt)} {fmtDateTime(e.executedAt).slice(-5)}</TableCell><TableCell className="font-mono text-xs">{e.invoiceNumber}</TableCell><TableCell>{e.customerName}</TableCell><TableCell>{e.actor}</TableCell><TableCell className="text-xs">{e.result}</TableCell><TableCell className="text-xs">{e.noticeStatus}</TableCell></TableRow>)}</TableBody></Table></div>)}
                </Panel>
              </>)}
            <AlertDialog open={ask} onOpenChange={setAsk}>
              <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Execute approved plan (simulation)?</AlertDialogTitle><AlertDialogDescription>Creates execution records for each task. No real message is sent and no invoice payment is modified.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={run} data-testid="button-confirm-execute">Execute</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
            </AlertDialog>
          </div>
        );
      }}
    </Page>
  );
}
