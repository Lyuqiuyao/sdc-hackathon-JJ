import { useState } from 'react';
import { useGenerateCompanyPortrait, type Customer } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tag } from '@/components/kit';
import { useToast } from '@/hooks/use-toast';
import { errMsg, fmtDateTime, useRefresh } from '@/lib/arus';

export function CompanyPortraitPanel({ customer }: { customer: Customer }) {
  const generate = useGenerateCompanyPortrait();
  const refresh = useRefresh();
  const { toast } = useToast();
  const [error, setError] = useState('');
  const portrait = customer.aiPortrait;
  const run = async () => {
    setError('');
    try {
      const saved = await generate.mutateAsync({ id: customer.id });
      await refresh();
      toast({ title: 'Company portrait saved', description: saved.provider === 'openai'
        ? 'OpenAI-assisted arrangement of controlled facts. No scoring or planning changed.'
        : `Basic rules portrait saved (${saved.reasonCode}). No scoring or planning changed.` });
    } catch (e) { setError(errMsg(e)); }
  };
  return <section className="space-y-3 rounded-md border bg-muted/30 p-3" data-testid="company-portrait-card">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">AI company portrait</h3>
      <Button size="sm" variant="outline" disabled={generate.isPending} onClick={run} data-testid="button-generate-portrait">
        {generate.isPending ? 'Generating...' : portrait ? 'Regenerate portrait' : 'Generate portrait'}
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">Advisory only. Based on structured invoices and prior NLP excerpts, not a credit score or certification. Generation uses the existing managed OpenAI service; credit usage may apply. Errors use rules fallback.</p>
    {error && <Alert variant="destructive" data-testid="portrait-error"><AlertDescription>{error}</AlertDescription></Alert>}
    {!portrait ? <p className="text-xs text-muted-foreground">No portrait saved yet. Generate a portrait to show cooperation risk signals, ESG context and a payment-data summary here.</p> : <>
      {portrait.isStale && <Alert data-testid="portrait-stale"><AlertDescription>Source invoices, NLP results, ESG context or the calendar day changed. This saved portrait may be out of date; regenerate before relying on it.</AlertDescription></Alert>}
      <p className="text-xs text-muted-foreground">{portrait.provider === 'openai' ? 'OpenAI-assisted · controlled facts' : 'Basic rules fallback'} · {portrait.reasonCode} · {fmtDateTime(portrait.generatedAt)}</p>
      <div><h4 className="mb-2 text-xs font-semibold">Cooperation risk signals</h4>
        <div className="flex flex-wrap gap-2">{portrait.riskTags.map(tag =>
          <Tag key={tag.code} tone={tag.level === 'high' ? 'red' : tag.level === 'attention' ? 'orange' : 'gray'}>{tag.label}</Tag>)}</div>
      </div>
      <div><h4 className="text-xs font-semibold">ESG context</h4><p className="mt-1 text-xs">{portrait.esgHint}</p></div>
      <div><h4 className="text-xs font-semibold">Payment habit summary (available evidence only)</h4>
        <p className="mt-1 whitespace-pre-wrap text-xs">{portrait.paymentHabitSummary}</p></div>
      <p className="break-all text-[11px] text-muted-foreground">{portrait.sourceAnalysisIds.length} NLP record result(s) referenced · {portrait.actor} · {portrait.id}</p>
    </>}
  </section>;
}
