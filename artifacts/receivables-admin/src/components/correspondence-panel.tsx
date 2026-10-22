import { useState } from 'react';
import {
  getGetCompanyCorrespondenceQueryKey, useGetCompanyCorrespondence,
  useAnalyzeCompanyCorrespondence,
  useGenerateCompanyPortrait,
  useGetCompanyCorrespondenceRecord,
  getGetCompanyCorrespondenceRecordQueryKey,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { errMsg, fmtDateTime, useRefresh } from '@/lib/arus';

function CorrespondenceFullText({ companyId, recordId }: { companyId: string; recordId: string }) {
  const detail = useGetCompanyCorrespondenceRecord(companyId, recordId, {
    query: { queryKey: getGetCompanyCorrespondenceRecordQueryKey(companyId, recordId),
      retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: false },
  });
  if (detail.isLoading) return <p className="mt-2">Loading original text...</p>;
  if (detail.isError) return <div className="mt-2" role="alert">Cannot load this record; it may have been removed by the five-record limit.
    <Button size="sm" variant="outline" onClick={() => detail.refetch()}>Retry</Button></div>;
  return <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/60 p-2 font-sans">{detail.data?.rawText}</pre>;
}

export function CorrespondencePanel({ companyId }: { companyId: string }) {
  const queryKey = getGetCompanyCorrespondenceQueryKey(companyId);
  const records = useGetCompanyCorrespondence(companyId, { query: { queryKey, refetchInterval: 15000 } });
  const analyze = useAnalyzeCompanyCorrespondence();
  const portrait = useGenerateCompanyPortrait();
  const refresh = useRefresh();
  const { toast } = useToast();
  const [analysisError, setAnalysisError] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const busy = analyze.isPending || portrait.isPending;

  const analyzeRecord = async (recordId: string) => {
    setAnalysisError('');
    let stage = 'NLP analysis';
    try {
      const result = await analyze.mutateAsync({ id: companyId, recordId });
      stage = 'Company portrait generation';
      const saved = await portrait.mutateAsync({ id: companyId });
      toast({ title: 'Communication extraction and company portrait saved',
        description: `${result.provider === 'openai' ? 'OpenAI extraction' : 'Rules extraction fallback'}; ${saved.provider === 'openai' ? 'OpenAI-assisted portrait' : 'Rules portrait fallback'}. Source claims remain unverified.` });
    } catch (e) {
      setAnalysisError(`Correspondence is saved. ${stage} failed: ${errMsg(e)}. Retry analysis without uploading again.`);
    } finally {
      await refresh();
    }
  };

  return <section className="space-y-3" data-testid="panel-correspondence">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Uploaded correspondence</h3>
    </div>
    <p className="text-xs text-muted-foreground">{analyze.isPending ? 'Analyzing communication...' : portrait.isPending ? 'Generating company portrait...' : 'Upload correspondence through the central intake on the Customers page. Analyze is an optional retry that re-runs NLP analysis and then updates the company portrait (managed OpenAI; errors use rules fallback).'}</p>
    {analysisError && <Alert variant="destructive" data-testid="alert-correspondence-analysis-error"><AlertDescription>{analysisError}</AlertDescription></Alert>}
    {records.isLoading ? <p className="text-xs">Loading correspondence...</p>
      : records.isError ? <div className="text-xs" role="alert">Could not load correspondence. <Button size="sm" variant="outline" onClick={() => records.refetch()}>Retry</Button></div>
      : !records.data?.length ? <p className="text-xs text-muted-foreground">No correspondence archived yet. Use the central intake on the Customers page.</p>
      : <ul className="space-y-2 text-xs" data-testid="list-correspondence">
        {records.data.map(record => <li key={record.id} className="rounded-md border p-2">
          <div className="break-all font-medium">{record.filename} · {record.fileType}</div>
          <div className="text-muted-foreground">{record.uploadedBy} · {fmtDateTime(record.uploadedAt)}</div>
          <Button size="sm" variant="outline" className="mt-2" disabled={busy} data-testid={`button-analyze-${record.id}`}
            onClick={() => analyzeRecord(record.id)}>{analyze.isPending && analyze.variables?.recordId === record.id ? 'Analyzing...' : 'Analyze communication'}</Button>
          <details className="mt-1" onToggle={event => {
            const isOpen = event.currentTarget.open;
            setExpanded(current => current[record.id] === isOpen ? current : { ...current, [record.id]: isOpen });
          }}><summary className="cursor-pointer">View original text</summary>
            {expanded[record.id] && <CorrespondenceFullText companyId={companyId} recordId={record.id} />}
          </details>
        </li>)}
      </ul>}
  </section>;
}
