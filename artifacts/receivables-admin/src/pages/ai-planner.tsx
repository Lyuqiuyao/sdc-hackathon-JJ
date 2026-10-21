import { useState } from "react";
import { Link } from 'wouter';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { useGeneratePlan, type Weights, type Workspace } from '@workspace/api-client-react';
import { Page, Panel, Tag, EmptyState, Field } from '@/components/kit';
import { TaskDetail, TaskHead } from '@/components/plan';
import { ProviderDetails } from '@/components/provider-details';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { errMsg, fmtDateTime, useRefresh } from '@/lib/arus';

const WF: { k: keyof Weights; en: string; zh: string }[] = [
  { k: 'lateFee', en: 'Late fee impact', zh: '逾期罚息影响' },
  { k: 'urgency', en: 'Due urgency', zh: '到期紧急度' },
  { k: 'importance', en: 'Customer importance', zh: '客户业务重要度' },
  { k: 'esg', en: 'ESG rating', zh: 'ESG 评级' },
];

export default function AiPlanner() {
  const { toast } = useToast();
  const refresh = useRefresh();
  const gen = useGeneratePlan();
  const [w, setW] = useState<Weights | null>(null);
  const [eventId, setEventId] = useState('');
  const [planId, setPlanId] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');

  return (
    <Page title="AI Collection Planner" zh="AI 催收决策" description="Four-factor explainable scoring with adjustable weights">
      {(ws) => inner(ws)}
    </Page>
  );

  function inner(ws: Workspace) {
    const events = [...ws.riskEvents].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const evId = eventId || events[0]?.id || '';
    const cur = w ?? ws.settings.weights;
    const sum = cur.lateFee + cur.urgency + cur.importance + cur.esg;
    const plans = [...ws.plans].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const plan = ws.plans.find((p) => p.id === planId) ?? plans[0];
    const generate = async () => {
      setErr('');
      try {
        const p = await gen.mutateAsync({ data: { riskEventId: evId || undefined, weights: cur } });
        setPlanId(p.id); await refresh();
        toast({ title: 'Plan generated', description: `Version ${p.version} is Pending approval.` });
      } catch (e) { setErr(errMsg(e)); }
    };
    return (
      <div className="space-y-4">
        <Alert><AlertTitle>Recommendations: {ws.settings.aiMode === 'gemini' ? 'Gemini with safe fallback' : 'Explainable rules engine'}</AlertTitle><AlertDescription>{ws.aiMessage} Scoring always remains deterministic; weights are demo defaults, not validated business parameters.</AlertDescription></Alert>
        {err && <Alert variant="destructive" data-testid="alert-plan-error"><AlertDescription>{err}</AlertDescription></Alert>}
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Scoring weights" zh="四维权重 (合计须为 100%)" className="lg:col-span-1">
            <div className="space-y-3">
              {WF.map((f) => (
                <Field key={f.k} label={`${f.en} · ${f.zh}`}>
                  <div className="flex items-center gap-2">
                    <Input type="number" min={0} max={100} value={cur[f.k]} onChange={(e) => setW({ ...cur, [f.k]: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} data-testid={`input-weight-${f.k}`} />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </Field>
              ))}
              <div className={`flex items-center justify-between rounded-md p-2 text-sm font-semibold ${sum === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`} data-testid="text-weight-sum"><span>Total</span><span>{sum}% {sum === 100 ? 'OK' : 'must equal 100'}</span></div>
              <Button variant="ghost" size="sm" onClick={() => setW({ ...ws.settings.weights })} data-testid="button-reset-weights">Reset to saved settings</Button>
              <Field label="Risk event · 风险事件">
                <Select value={evId} onValueChange={setEventId} disabled={!events.length}>
                  <SelectTrigger data-testid="select-event"><SelectValue placeholder="No events" /></SelectTrigger>
                  <SelectContent>{events.map((e) => <SelectItem key={e.id} value={e.id}>{fmtDateTime(e.createdAt)} · {e.level}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Button className="w-full" onClick={generate} disabled={sum !== 100 || gen.isPending || !evId} data-testid="button-generate-plan"><Sparkles className="mr-1 h-4 w-4" />{gen.isPending ? 'Generating...' : 'Generate Collection Plan'}</Button>
              {!events.length && <p className="text-xs text-muted-foreground">Run a risk check first in <Link href="/risk-triggers" className="underline">Risk Triggers</Link>.</p>}
            </div>
          </Panel>
          <Panel title="How scores work" zh="评分说明" className="lg:col-span-2" bodyClass="space-y-2 text-sm">
            <p>Each open invoice receives four 0-100 scores, combined by the weights on the left into a priority score. Paid and cancelled invoices are never scheduled.</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li><b className="text-foreground">Late fee impact:</b> financial cost of delay from the annual late fee rate and outstanding amount.</li>
              <li><b className="text-foreground">Due urgency:</b> days to due date or days overdue, weighted by amount.</li>
              <li><b className="text-foreground">Importance:</b> relationship value of the customer (High, Medium, Low).</li>
              <li><b className="text-foreground">ESG:</b> only reviewed and still-valid ratings. Missing data is neutral 50 and is never treated as bad debt risk.</li>
            </ul>
            <p className="text-xs text-muted-foreground">Every plan enters Pending status and must be approved by an administrator before simulated execution.</p>
          </Panel>
        </div>
        <Panel title={plan ? `Plan v${plan.version} · ${plan.tasks.length} tasks` : 'Plan output'} zh="排程输出" actions={<>
          {plan && <Select value={plan.id} onValueChange={setPlanId}><SelectTrigger className="h-8 w-60 text-xs" data-testid="select-plan"><SelectValue /></SelectTrigger><SelectContent>{plans.map((p) => <SelectItem key={p.id} value={p.id}>v{p.version} · {p.status} · {fmtDateTime(p.createdAt)}</SelectItem>)}</SelectContent></Select>}
          {plan && <Button asChild size="sm" variant="outline"><Link href={`/approvals?plan=${encodeURIComponent(plan.id)}`} data-testid="link-approvals">Go to approval</Link></Button>}</>}>
          {!plan ? <EmptyState title="No plan generated yet" hint="Choose a risk event and generate a plan." /> : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Tag>{plan.status}</Tag><span>Weights {plan.weights.lateFee}/{plan.weights.urgency}/{plan.weights.importance}/{plan.weights.esg}</span></div>
              <ProviderDetails plan={plan} />
              {plan.tasks.length === 0 && <EmptyState title="No open invoices to schedule" />}
              {plan.tasks.map((t) => (
                <div key={t.id} className="rounded-md border" data-testid={`task-${t.id}`}>
                  <button className="flex w-full items-center gap-2 p-3 text-left hover:bg-accent/50" onClick={() => setOpen(open === t.id ? null : t.id)} data-testid={`button-toggle-${t.id}`}>
                    {open === t.id ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}<div className="flex-1"><TaskHead t={t} /></div>
                  </button>
                  {open === t.id && <div className="border-t p-3"><TaskDetail t={t} weights={plan.weights} defaultLanguage={ws.settings.language} /></div>}
                </div>))}
            </div>)}
        </Panel>
      </div>
    );
  }
}
