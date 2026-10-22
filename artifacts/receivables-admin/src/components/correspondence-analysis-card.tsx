import type { CorrespondenceAnalysis } from '@workspace/api-client-react';
import { fmtDateTime } from '@/lib/arus';

export function CorrespondenceAnalysisCard({ analysis }: { analysis?: CorrespondenceAnalysis }) {
  if (!analysis) return null;
  const { fields } = analysis;
  const excerpts = [
    { title: 'Follow-up items', rows: fields.followUpItems },
    { title: 'Customer promises (unverified)', rows: fields.customerPromises },
    { title: 'Disputes', rows: fields.disputes },
  ];
  return <section className="space-y-3 rounded-md border bg-muted/30 p-3 text-xs" data-testid="card-correspondence-analysis">
    <h3 className="text-sm font-semibold">Latest communication extraction</h3>
    <p className="text-muted-foreground">Unverified source claims, not invoice facts, confirmed agreements or a company profile. This does not change scores, schedules or approvals.</p>
    <p className="break-all">Source: {analysis.filename} · {analysis.recordId}</p>
    <p>{analysis.provider === 'openai' ? 'OpenAI · Replit managed' : 'Regex rules fallback'} · {analysis.reasonCode} · {analysis.actor} · {fmtDateTime(analysis.extractedAt)}</p>
    <dl className="grid gap-3 sm:grid-cols-2">
      <div><dt className="font-semibold">Overdue days (text claim)</dt><dd>{fields.overdueDays === null ? 'Not identified' : `${fields.overdueDays} days`}</dd>
        {fields.overdueEvidence && <dd className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{fields.overdueEvidence}</dd>}</div>
      <div><dt className="font-semibold">Debt amount (text claim)</dt><dd>{fields.debtAmountCents === null ? 'Not identified' :
        `${fields.currency ?? 'Currency not stated'} ${(fields.debtAmountCents / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</dd>
        {fields.amountEvidence && <dd className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{fields.amountEvidence}</dd>}</div>
    </dl>
    {excerpts.map(group => <div key={group.title}><h4 className="font-semibold">{group.title}</h4>
      {group.rows.length ? <ul className="mt-1 list-disc space-y-1 pl-4">{group.rows.map((quote, index) =>
        <li key={index} className="whitespace-pre-wrap break-words">{quote}</li>)}</ul> : <p className="text-muted-foreground">Not identified</p>}
    </div>)}
    <ul className="space-y-1 text-muted-foreground">{analysis.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
  </section>;
}
