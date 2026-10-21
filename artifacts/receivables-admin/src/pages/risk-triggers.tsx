import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { CheckCircle2, MinusCircle, Play, Sparkles } from 'lucide-react';
import { useGeneratePlan, useRunRiskCheck, type RiskEvent } from '@workspace/api-client-react';
import { Page, Panel, Tag, EmptyState } from '@/components/kit';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { errMsg, fmtDateTime, rm, useRefresh } from '@/lib/arus';

export default function RiskTriggers() {
  const { toast } = useToast();
  const [, setLoc] = useLocation();
  const refresh = useRefresh();
  const run = useRunRiskCheck();
  const gen = useGeneratePlan();
  const [latest, setLatest] = useState<RiskEvent | null>(null);
  const [err, setErr] = useState('');

  const doRun = async () => {
    setErr('');
    try { const e = await run.mutateAsync(); setLatest(e); await refresh(); toast({ title: `Risk check complete: ${e.level}`, description: e.level === 'Low' ? 'Risk event recorded; no automatic collection draft needed.' : 'Risk event recorded and a pending draft created if collectible invoices exist. Human approval is required.' }); } catch (e) { setErr(errMsg(e)); }
  };
  const doGen = async (id: string) => {
    setErr('');
    try { const plan = await gen.mutateAsync({ data: { riskEventId: id } }); await refresh(); toast({ title: 'Collection plan generated', description: 'Awaiting approval.' }); setLoc(`/approvals?plan=${encodeURIComponent(plan.id)}`); } catch (e) { setErr(errMsg(e)); }
  };

  return (
    <Page title="Risk Triggers" zh="风险触发中心" description="Explainable cash-flow rules, repeatable checks and event history"
      actions={<Button onClick={doRun} disabled={run.isPending} data-testid="button-run-risk-check"><Play className="mr-1 h-4 w-4" />{run.isPending ? 'Checking...' : 'Run Risk Check / 模拟触发风险检测'}</Button>}>
      {(ws) => {
        const s = ws.settings;
        const r = latest ?? ws.dashboard.risk;
        const live = ws.dashboard.risk;
        const events = [...ws.riskEvents].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const open = ws.invoices.filter((i) => !['Paid', 'Cancelled'].includes(i.status) && i.outstandingCents > 0);
        const inHorizon = open.filter((i) => i.dueDate >= ws.today && (new Date(i.dueDate).getTime() - new Date(ws.today).getTime()) / 864e5 <= s.horizonDays);
        const large = open.filter((i) => i.daysOverdue > 0 && i.outstandingCents >= s.largeInvoiceCents);
        const medLine = Math.round(s.minimumCashCents * (1 + s.mediumBufferPercent / 100));
        const rules = [
          { n: 'R1', t: 'Projected cash below minimum operating cash', d: `Projected cash (cash + ${s.collectionRatePercent}% of not-yet-overdue invoices due within ${s.horizonDays} days - expected expenses) < minimum cash ${rm(s.minimumCashCents)} triggers High.`, hit: live.projectedCashCents < s.minimumCashCents, v: `Projected ${rm(live.projectedCashCents)}` },
          { n: 'R2', t: 'Cash only slightly above minimum', d: `Projected cash at or below minimum + ${s.mediumBufferPercent}% buffer (${rm(medLine)}) triggers Medium.`, hit: live.projectedCashCents >= s.minimumCashCents && live.projectedCashCents <= medLine, v: `Buffer line ${rm(medLine)}` },
          { n: 'R3', t: 'Overdue amount too high', d: `Overdue outstanding at or above ${rm(s.overdueThresholdCents)} triggers at least Medium.`, hit: live.overdueCents >= s.overdueThresholdCents, v: `Overdue ${rm(live.overdueCents)}` },
          { n: 'R4', t: 'Invoices concentrated in horizon', d: `${s.concentrationCount} or more not-yet-overdue open invoices due within ${s.horizonDays} days triggers at least Medium.`, hit: inHorizon.length >= s.concentrationCount, v: `${inHorizon.length} invoices` },
          { n: 'R5', t: 'Large invoice delayed', d: `Any overdue invoice of ${rm(s.largeInvoiceCents)} or more triggers at least Medium.`, hit: large.length > 0, v: `${large.length} large invoice(s)` },
        ];
        return (
          <div className="space-y-4">
            {err && <Alert variant="destructive" data-testid="alert-risk-error"><AlertTitle>Action failed</AlertTitle><AlertDescription>{err}</AlertDescription></Alert>}
            <div className="grid gap-4 xl:grid-cols-5">
              <Panel title={latest ? 'Latest check result' : 'Current live risk'} zh="检测结果" className="xl:col-span-2" data-testid="panel-risk-result">
                <div className="flex items-center gap-3"><Tag className="px-3 py-1 text-sm">{r.level}</Tag><span className="text-xs text-muted-foreground">{'createdAt' in r ? fmtDateTime(r.createdAt) : ''}</span></div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  {[['Due in horizon', r.dueCents], ['Overdue', r.overdueCents], ['Expected collection', r.expectedCollectionCents], ['Projected cash', r.projectedCashCents], ['Gap vs minimum', r.gapCents]].map(([k, v]) => (
                    <div key={k as string} className="rounded-md bg-muted/60 p-2"><dt className="text-muted-foreground">{k}</dt><dd className="font-mono font-semibold">{rm(v as number)}</dd></div>))}
                  <div className="rounded-md bg-muted/60 p-2"><dt className="text-muted-foreground">Horizon</dt><dd className="font-mono font-semibold">{r.horizonDays} days</dd></div>
                </dl>
                <ul className="mt-3 list-disc pl-4 text-xs text-muted-foreground">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
                <div className="mt-4 flex flex-wrap gap-2">
                  {latest ? <Button onClick={() => doGen(latest.id)} disabled={gen.isPending} data-testid="button-generate-plan"><Sparkles className="mr-1 h-4 w-4" />{gen.isPending ? 'Generating...' : 'Generate AI Collection Plan'}</Button> : <p className="text-xs text-muted-foreground">Run a risk check to create an event, then generate a plan from it.</p>}
                  <Button asChild variant="outline"><Link href="/ai-planner">Open planner</Link></Button>
                </div>
              </Panel>
              <Panel title="Rules and live test" zh="规则可解释 · 可测试" className="xl:col-span-3" bodyClass="space-y-2">
                <p className="text-xs text-muted-foreground">Live values recalculate on workspace reads; there is no background scheduled check. Run Risk Check records an event and starts a pending draft for Medium/High risk. Approval and execution remain separate.</p>
                <p className="text-xs text-muted-foreground">Thresholds come from Settings. Each rule is evaluated now against current data; the server remains the authority when you run a check.</p>
                {rules.map((x) => (
                  <div key={x.n} className="flex items-start gap-3 rounded-md border p-3" data-testid={`rule-${x.n}`}>
                    {x.hit ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-orange-600" /> : <MinusCircle className="mt-0.5 h-4 w-4 text-muted-foreground" />}
                    <div className="flex-1"><div className="text-sm font-medium">{x.n}. {x.t}</div><div className="text-xs text-muted-foreground">{x.d}</div></div>
                    <div className="text-right"><Tag tone={x.hit ? 'orange' : 'green'}>{x.hit ? 'Triggered' : 'Not triggered'}</Tag><div className="mt-1 font-mono text-[10px] text-muted-foreground">{x.v}</div></div>
                  </div>))}
                <Button asChild size="sm" variant="ghost"><Link href="/settings">Edit thresholds</Link></Button>
              </Panel>
            </div>
            <Panel title={`Event history (${events.length})`} zh="风险事件历史" bodyClass="p-0">
              {events.length === 0 ? <div className="p-4"><EmptyState title="No risk events yet" hint="Run a risk check to record the first event." /></div> : (
                <div className="overflow-x-auto"><Table>
                  <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Level</TableHead><TableHead className="text-right">Due</TableHead><TableHead className="text-right">Overdue</TableHead><TableHead className="text-right">Projected cash</TableHead><TableHead className="text-right">Gap</TableHead><TableHead>Plans</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>{events.map((e) => {
                    const ps = ws.plans.filter((p) => p.riskEventId === e.id);
                    return (<TableRow key={e.id} data-testid={`row-event-${e.id}`}>
                      <TableCell className="whitespace-nowrap">{fmtDateTime(e.createdAt)}</TableCell><TableCell><Tag>{e.level}</Tag></TableCell>
                      <TableCell className="text-right font-mono text-xs">{rm(e.dueCents)}</TableCell><TableCell className="text-right font-mono text-xs">{rm(e.overdueCents)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{rm(e.projectedCashCents)}</TableCell><TableCell className="text-right font-mono text-xs">{rm(e.gapCents)}</TableCell>
                      <TableCell className="text-xs">{ps.length ? ps.map((p) => `v${p.version} ${p.status}`).join(', ') : 'None'}</TableCell>
                      <TableCell><Button size="sm" variant="outline" disabled={gen.isPending} onClick={() => doGen(e.id)} data-testid={`button-plan-${e.id}`}>Generate plan</Button></TableCell></TableRow>);
                  })}</TableBody>
                </Table></div>)}
            </Panel>
          </div>
        );
      }}
    </Page>
  );
}
