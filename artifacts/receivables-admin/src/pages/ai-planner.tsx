import { useState } from "react";
import { Link } from 'wouter';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { useGeneratePlan, type Workspace } from '@workspace/api-client-react';
import { Page, Panel, Tag, EmptyState, Field } from '@/components/kit';
import { QueuesOverview, ScoringSummary, TaskDetail, TaskHead } from '@/components/plan';
import { ProviderDetails } from '@/components/provider-details';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { errMsg, fmtDateTime, useRefresh } from '@/lib/arus';

export default function AiPlanner() {
  const { toast } = useToast();
  const refresh = useRefresh();
  const gen = useGeneratePlan();
  const [eventId, setEventId] = useState('');
  const [planId, setPlanId] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');

  return (
    <Page title="AI Collection Planner" description="Deterministic split 2D/3D scoring queues, reviewed by a human before any simulated action">
      {(ws) => inner(ws)}
    </Page>
  );

  function inner(ws: Workspace) {
    const events = [...ws.riskEvents].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const evId = eventId || events[0]?.id || '';
    const plans = [...ws.plans].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const plan = ws.plans.find((p) => p.id === planId) ?? plans[0];
    const generate = async () => {
      setErr('');
      try {
        const p = await gen.mutateAsync({ data: { riskEventId: evId || undefined } });
        setPlanId(p.id); await refresh();
        toast({ title: 'Plan generated', description: `Version ${p.version} is Pending approval.` });
      } catch (e) { setErr(errMsg(e)); }
    };
    return (
      <div className="space-y-4">
        <Alert><AlertTitle>Recommendations: {ws.settings.aiMode === 'openai' ? 'OpenAI (Replit managed) with safe fallback' : ws.settings.aiMode === 'gemini' ? 'Legacy Gemini retired — select OpenAI in Settings' : 'Explainable rules engine'}</AlertTitle><AlertDescription>{ws.aiMessage} Scoring always remains deterministic; scoring weights are fixed business-approved demo parameters for this synthetic data.</AlertDescription></Alert>
        <Alert><AlertDescription className="text-xs">Changing a customer profile or SEDG declaration invalidates the data signature of existing plans. Generate a new plan afterwards; reviews and the final merge are recorded per plan version.</AlertDescription></Alert>
        {err && <Alert variant="destructive" data-testid="alert-plan-error"><AlertDescription>{err}</AlertDescription></Alert>}
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Generate plan" className="lg:col-span-1">
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Scoring weights are fixed (see Settings and the explanation on the right). They are not editable for new plans.</p>
              <Field label="Risk event">
                <Select value={evId} onValueChange={setEventId} disabled={!events.length}>
                  <SelectTrigger data-testid="select-event"><SelectValue placeholder="No events" /></SelectTrigger>
                  <SelectContent>{events.map((e) => <SelectItem key={e.id} value={e.id}>{fmtDateTime(e.createdAt)} · {e.level}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Button className="w-full" onClick={generate} disabled={gen.isPending || !evId} data-testid="button-generate-plan"><Sparkles className="mr-1 h-4 w-4" />{gen.isPending ? 'Generating...' : 'Generate Collection Plan'}</Button>
              {!events.length && <p className="text-xs text-muted-foreground">Run a risk check first in <Link href="/risk-triggers" className="underline">Risk Triggers</Link>.</p>}
            </div>
          </Panel>
          <Panel title="How scores work" className="lg:col-span-2" bodyClass="space-y-2 text-sm">
            <p>Open invoices are split into two separate queues. Paid and cancelled invoices are never scheduled.</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li><b className="text-foreground">2D queue:</b> overdue days (capped at 90) 60% plus outstanding amount (capped at MYR 100,000.00) 40%. Includes customers whose ESG rating is unknown.</li>
              <li><b className="text-foreground">3D queue:</b> overdue 51%, amount 34%, ESG 15%, using an existing synthetic A/B/C rating mapped to 30, 50 or 70. The rating is imported, not calculated or certified here.</li>
              <li><b className="text-foreground">No automatic merge:</b> scores from the two queues are never compared. An administrator reviews 2D customers, then confirms the final order manually in the Approval Center.</li>
              <li><b className="text-foreground">Missing ESG or SEDG</b> is never treated as bad risk.</li>
            </ul>
            <p className="text-xs text-muted-foreground">Every plan enters Pending status and must be approved by an administrator before simulated execution.</p>
          </Panel>
        </div>
        <Panel title={plan ? `Plan v${plan.version} · ${plan.tasks.length} tasks` : 'Plan output'} actions={<>
          {plan && <Select value={plan.id} onValueChange={setPlanId}><SelectTrigger className="h-8 w-60 text-xs" data-testid="select-plan"><SelectValue /></SelectTrigger><SelectContent>{plans.map((p) => <SelectItem key={p.id} value={p.id}>v{p.version} · {p.status} · {fmtDateTime(p.createdAt)}</SelectItem>)}</SelectContent></Select>}
          {plan && <Button asChild size="sm" variant="outline"><Link href={`/approvals?plan=${encodeURIComponent(plan.id)}`} data-testid="link-approvals">Go to approval</Link></Button>}</>}>
          {!plan ? <EmptyState title="No plan generated yet" hint="Choose a risk event and generate a plan." /> : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Tag>{plan.status}</Tag></div>
              <div className="text-xs"><ScoringSummary plan={plan} /></div>
              {plan.scoringSnapshot && <QueuesOverview tasks={plan.tasks} />}
              <ProviderDetails plan={plan} />
              {plan.tasks.length === 0 && <EmptyState title="No open invoices to schedule" />}
              {plan.tasks.map((t) => (
                <div key={t.id} className="rounded-md border" data-testid={`task-${t.id}`}>
                  <button className="flex w-full items-center gap-2 p-3 text-left hover:bg-accent/50" onClick={() => setOpen(open === t.id ? null : t.id)} data-testid={`button-toggle-${t.id}`}>
                    {open === t.id ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}<div className="flex-1"><TaskHead t={t} /></div>
                  </button>
                  {open === t.id && <div className="border-t p-3"><TaskDetail t={t} weights={plan.weights} snapshot={plan.scoringSnapshot} defaultLanguage={ws.settings.language} /></div>}
                </div>))}
            </div>)}
        </Panel>
      </div>
    );
  }
}
