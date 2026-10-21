import { type CollectionPlan, type CollectionTask, type ScoringSnapshot } from '@workspace/api-client-react';
import { Tag } from '@/components/kit';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fmtDate, fmtDateTime, rm } from '@/lib/arus';

export const QUEUE_LABEL = { two_dimensional: '2D queue', three_dimensional: '3D queue' } as const;

export function ScoreBar({ label, value, weight, note }: { label: string; value: number | null; weight?: number; note?: string }) {
  return (
    <div>
      <div className="flex justify-between text-[11px]"><span>{label}</span>
        <span className="font-mono">{value === null ? (note ?? 'not scored') : value.toFixed(1)}{value !== null && weight !== undefined && <span className="text-muted-foreground"> x {weight}%</span>}</span></div>
      <div className="mt-0.5 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></div>
    </div>
  );
}

/** Explains which scoring algorithm produced a plan. Legacy plans stay labelled as the historical four-dimensional algorithm. */
export function ScoringSummary({ plan }: { plan: CollectionPlan }) {
  const s = plan.scoringSnapshot;
  if (!s) {
    return <div className="space-y-0.5" data-testid="text-scoring-legacy"><Tag tone="gray">Legacy four-dimensional algorithm (historical)</Tag>
      <div>Late fee {plan.weights.lateFee}% · Urgency {plan.weights.urgency}% · Importance {plan.weights.importance}% · ESG {plan.weights.esg}%</div>
      <div className="text-muted-foreground">Historical plan: recorded weights are shown as they were applied, not mapped to the current method.</div></div>;
  }
  return <div className="space-y-0.5" data-testid="text-scoring-split">
    <Tag tone="blue">Split scoring {s.version}</Tag>
    <div>2D queue: overdue {s.twoDimensional.overdue}% · amount {s.twoDimensional.amount}%</div>
    <div>3D queue: overdue {s.threeDimensional.overdue}% · amount {s.threeDimensional.amount}% · ESG {s.threeDimensional.esg}%</div>
    <div className="text-muted-foreground">Caps: {s.overdueCapDays} days overdue, {rm(s.amountCapCents)} outstanding. Existing ESG rating mapping: A {s.esgMapping.A}, B {s.esgMapping.B}, C {s.esgMapping.C}. Unknown ESG customers use the 2D queue and are never scored as poor.</div>
  </div>;
}

/** Shows the two initial queues side by side; scores are never compared across queues. */
export function QueuesOverview({ tasks }: { tasks: CollectionTask[] }) {
  const q2 = tasks.filter((t) => t.queue === 'two_dimensional').sort((a, b) => (a.queueRank ?? 0) - (b.queueRank ?? 0));
  const q3 = tasks.filter((t) => t.queue === 'three_dimensional').sort((a, b) => (a.queueRank ?? 0) - (b.queueRank ?? 0));
  if (!q2.length && !q3.length) return null;
  const col = (title: string, sub: string, list: CollectionTask[], id: string) => (
    <div className="rounded-md border p-3" data-testid={`queue-${id}`}>
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{title}</h3><Tag tone="gray">{list.length} tasks</Tag></div>
      <p className="mb-2 text-[11px] text-muted-foreground">{sub}</p>
      {list.length === 0 ? <p className="text-xs text-muted-foreground">No tasks in this queue.</p> : <ol className="space-y-1 text-xs">
        {list.map((t) => <li key={t.id} className="flex items-center gap-2"><span className="w-6 font-mono text-muted-foreground">#{t.queueRank}</span><span className="flex-1 truncate">{t.customerName} · {t.invoiceNumber}</span><span className="font-mono">{t.score.toFixed(1)}</span></li>)}
      </ol>}
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="grid gap-3 md:grid-cols-2">
        {col('2D queue: overdue + amount', 'Includes customers with unknown ESG. Needs per-customer human review.', q2, '2d')}
        {col('3D queue: overdue + amount + ESG', 'Customers with an existing A/B/C rating (unverified).', q3, '3d')}
      </div>
      <p className="text-[11px] text-muted-foreground">Scores come from different formulas and must not be compared across queues. The initial order is the 2D queue followed by the 3D queue and is not merged automatically.</p>
    </div>
  );
}

export function TaskDetail({ t, weights, snapshot, defaultLanguage = 'en' }: { t: CollectionTask; weights?: { lateFee: number; urgency: number; importance: number; esg: number }; snapshot?: ScoringSnapshot; defaultLanguage?: 'en' | 'ms' }) {
  const split = !!t.queue && !!snapshot;
  const w = snapshot ? (t.queue === 'three_dimensional' ? snapshot.threeDimensional : snapshot.twoDimensional) : undefined;
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid={`detail-task-${t.id}`}>
      <div className="space-y-2">
        {split && w ? <>
          <ScoreBar label="Overdue (days, capped)" value={t.overdueScore ?? 0} weight={w.overdue} />
          <ScoreBar label="Amount (outstanding, capped)" value={t.amountScore ?? 0} weight={w.amount} />
          <ScoreBar label="ESG (existing rating mapping)" value={t.esgScore} weight={'esg' in w ? (w.esg as number) : undefined} note="not in 2D formula" />
          <p className="text-[11px] text-muted-foreground">{t.queue === 'two_dimensional' ? '2D' : '3D'} queue score {t.score.toFixed(1)} / 100, queue rank #{t.queueRank}. Assigned ESG rating: {t.assignedEsgRating ?? 'unknown'} (existing synthetic rating, unverified). Not comparable with the other queue.</p>
        </> : <>
          <p className="text-[11px] font-semibold text-muted-foreground">Legacy four-dimensional algorithm (historical)</p>
          <ScoreBar label="Late fee impact" value={t.lateFeeScore} weight={weights?.lateFee} />
          <ScoreBar label="Urgency" value={t.urgencyScore} weight={weights?.urgency} />
          <ScoreBar label="Importance" value={t.importanceScore} weight={weights?.importance} />
          <ScoreBar label="ESG" value={t.esgScore} weight={weights?.esg} />
          <p className="text-[11px] text-muted-foreground">Missing ESG data was scored neutral (50) by the legacy method. Composite {t.score.toFixed(1)} / 100.</p>
        </>}
        <dl className="space-y-1 text-xs">
          <div><dt className="inline font-semibold">Method: </dt><dd className="inline">{t.method}</dd></div>
          <div><dt className="inline font-semibold">Suggested time: </dt><dd className="inline">{fmtDateTime(t.scheduledAt)}</dd></div>
          <div><dt className="inline font-semibold">Negotiation: </dt><dd className="inline">{t.negotiation}</dd></div>
          <div><dt className="inline font-semibold">Reason: </dt><dd className="inline">{t.reason}</dd></div>
          <div><dt className="inline font-semibold">Risk and uncertainty: </dt><dd className="inline">{t.uncertainty}</dd></div>
          {t.esgNote && <div><dt className="inline font-semibold">ESG note: </dt><dd className="inline">{t.esgNote}</dd></div>}
        </dl>
        {t.aiAdvice && <div className="space-y-2 rounded border p-2 text-xs" data-testid={`ai-advice-${t.id}`}>
          <strong>{t.noticeEnSource === 'gemini' || t.noticeMsSource === 'gemini' ? 'Historical Gemini' : 'Advisory'} recommendations</strong>
          <p>{t.aiAdvice.reasoning}</p>
          <ul className="list-disc space-y-1 pl-4">{t.aiAdvice.strategies.map(s => <li key={s.kind}><strong>{s.kind}: </strong>{s.proposal} <span className="text-muted-foreground">{s.conditions}</span></li>)}</ul>
          <p><strong>Assumptions: </strong>{t.aiAdvice.assumptions.join(' ')}</p>
          <p><strong>Uncertainty: </strong>{t.aiAdvice.uncertainties.join(' ')}</p>
          <p><strong>ESG ({t.aiAdvice.esgEvidence} / {t.aiAdvice.esgRating}): </strong>{t.aiAdvice.esgConsiderations}</p>
        </div>}
      </div>
      <Tabs key={defaultLanguage} defaultValue={defaultLanguage}>
        <TabsList><TabsTrigger value="en">English notice</TabsTrigger><TabsTrigger value="ms">Bahasa Melayu</TabsTrigger></TabsList>
        <TabsContent value="en"><pre className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 font-sans text-xs">{t.noticeEn}</pre><p className="mt-1 text-[10px]">English source: {t.noticeEnSource ?? 'rules_fallback'}</p></TabsContent>
        <TabsContent value="ms"><pre className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 font-sans text-xs">{t.noticeMs}</pre><p className="mt-1 text-[10px]">Bahasa Melayu source: {t.noticeMsSource ?? 'rules_fallback'}</p></TabsContent>
        <p className="mt-1 text-[10px] text-muted-foreground">Synthetic demo draft. Editable in Approval Center, subject to human review, never auto-sent.</p>
      </Tabs>
    </div>
  );
}

export function TaskHead({ t }: { t: CollectionTask }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{t.rank}</span>
      <span className="font-mono text-xs">{t.invoiceNumber}</span>
      <span className="font-medium">{t.customerName}</span>
      <span className="font-mono text-xs">{rm(t.outstandingCents)}</span>
      <span className="text-xs text-muted-foreground">Due {fmtDate(t.dueDate)}{t.daysOverdue > 0 && ` · ${t.daysOverdue}d overdue`}</span>
      {t.queue && <Tag tone={t.queue === 'two_dimensional' ? 'gray' : 'blue'}>{QUEUE_LABEL[t.queue]} #{t.queueRank}</Tag>}
      <Tag tone="blue">{t.method}</Tag>
      <span className="ml-auto font-mono text-xs font-semibold">Score {t.score.toFixed(1)}{t.queue ? (t.queue === 'two_dimensional' ? ' (2D)' : ' (3D)') : ''}</span>
    </div>
  );
}
