import { type CollectionTask } from '@workspace/api-client-react';
import { Tag } from '@/components/kit';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { METHOD_ZH, fmtDate, fmtDateTime, rm } from '@/lib/arus';

export function ScoreBar({ label, zh, value, weight }: { label: string; zh: string; value: number; weight?: number }) {
  return (
    <div>
      <div className="flex justify-between text-[11px]"><span>{label} <span className="text-muted-foreground">{zh}</span></span><span className="font-mono">{value.toFixed(1)}{weight !== undefined && <span className="text-muted-foreground"> × {weight}%</span>}</span></div>
      <div className="mt-0.5 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
    </div>
  );
}

export function TaskDetail({ t, weights, defaultLanguage = 'en' }: { t: CollectionTask; weights?: { lateFee: number; urgency: number; importance: number; esg: number }; defaultLanguage?: 'en' | 'ms' }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid={`detail-task-${t.id}`}>
      <div className="space-y-2">
        <ScoreBar label="Late fee impact" zh="逾期罚息" value={t.lateFeeScore} weight={weights?.lateFee} />
        <ScoreBar label="Urgency" zh="到期紧急度" value={t.urgencyScore} weight={weights?.urgency} />
        <ScoreBar label="Importance" zh="业务重要度" value={t.importanceScore} weight={weights?.importance} />
        <ScoreBar label="ESG" zh="ESG评级" value={t.esgScore} weight={weights?.esg} />
        <p className="text-[11px] text-muted-foreground">Missing ESG data is scored neutral (50), not as a poor rating. Composite {t.score.toFixed(1)} / 100.</p>
        <dl className="space-y-1 text-xs">
          <div><dt className="inline font-semibold">Method: </dt><dd className="inline">{t.method} ({METHOD_ZH[t.method] ?? ''})</dd></div>
          <div><dt className="inline font-semibold">Suggested time: </dt><dd className="inline">{fmtDateTime(t.scheduledAt)}</dd></div>
          <div><dt className="inline font-semibold">Negotiation: </dt><dd className="inline">{t.negotiation}</dd></div>
          <div><dt className="inline font-semibold">Reason: </dt><dd className="inline">{t.reason}</dd></div>
          <div><dt className="inline font-semibold">Risk and uncertainty: </dt><dd className="inline">{t.uncertainty}</dd></div>
          {t.esgNote && <div><dt className="inline font-semibold">ESG note: </dt><dd className="inline">{t.esgNote}</dd></div>}
        </dl>
        {t.aiAdvice && <div className="space-y-2 rounded border p-2 text-xs" data-testid={`ai-advice-${t.id}`}>
          <strong>Gemini recommendations · 建议（不改变评分或合同）</strong>
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
      <Tag tone="blue">{t.method}</Tag>
      <span className="ml-auto font-mono text-xs font-semibold">Score {t.score.toFixed(1)}</span>
    </div>
  );
}
