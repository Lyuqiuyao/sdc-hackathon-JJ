import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import {
  getGetCompanyCorrespondenceQueryKey, useGetCompanyCorrespondence, useUploadCompanyCorrespondence,
  type CorrespondenceInput,
  useAnalyzeCompanyCorrespondence,
  useGenerateCompanyPortrait,
  useGetCompanyCorrespondenceRecord,
  getGetCompanyCorrespondenceRecordQueryKey,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { errMsg, fmtDateTime, useRefresh } from '@/lib/arus';

const MAX_BYTES = 10 * 1024 * 1024;

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
  const upload = useUploadCompanyCorrespondence();
  const analyze = useAnalyzeCompanyCorrespondence();
  const portrait = useGenerateCompanyPortrait();
  const qc = useQueryClient();
  const refresh = useRefresh();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<CorrespondenceInput>({ fileType: 'text', filename: 'Pasted text', rawText: '' });
  const [analysisError, setAnalysisError] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const busy = reading || upload.isPending || analyze.isPending || portrait.isPending;

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
      setAnalysisError(`Correspondence is saved. ${stage} failed: ${errMsg(e)}. Retry analysis or portrait generation without uploading again.`);
    } finally {
      await refresh();
    }
  };

  const readFile = async (file?: File) => {
    if (!file) return;
    setError('');
    if (file.size > MAX_BYTES) { setError('File exceeds the 10 MB limit.'); return; }
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension !== 'txt' && extension !== 'csv') { setError('Choose a .txt or .csv file.'); return; }
    setReading(true);
    try {
      const rawText = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (rawText.includes('\0')) throw new Error('Only plain text files are supported.');
      setDraft({ fileType: extension, filename: file.name, rawText });
    } catch {
      setError('Cannot read this file as UTF-8 plain text. Export it as UTF-8 .txt or .csv and retry.');
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = async () => {
    setError('');
    if (!draft.rawText.trim()) { setError('Paste text or choose a non-empty file.'); return; }
    if (new TextEncoder().encode(draft.rawText).byteLength > MAX_BYTES) {
      setError('Correspondence exceeds the 10 MB limit.'); return;
    }
    let record;
    try {
      record = await upload.mutateAsync({ id: companyId, data: draft });
    } catch (e) { setError(errMsg(e)); return; }
    setDraft({ fileType: 'text', filename: 'Pasted text', rawText: '' });
    setOpen(false);
    await qc.invalidateQueries({ queryKey });
    await analyzeRecord(record.id);
  };

  return <section className="space-y-3" data-testid="panel-correspondence">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Uploaded correspondence</h3>
      <Button size="sm" variant="outline" onClick={() => setOpen(!open)} disabled={busy} data-testid="button-upload-correspondence">
        <Upload className="mr-1 h-4 w-4" />{open ? 'Close upload' : 'Upload correspondence'}
      </Button>
    </div>
    {open && <div className="space-y-3 rounded-md border p-3">
      <p className="text-xs text-muted-foreground">Shared synthetic demo only: do not upload real customer information. Paste WhatsApp chat or Excel-exported text, or choose a UTF-8 .txt/.csv file (maximum 10 MB). Only the latest five records per company are retained; uploading another automatically deletes the oldest record and its original text. Saving automatically analyzes this record and then generates the company portrait.</p>
      <input ref={fileRef} type="file" accept=".txt,.csv,text/plain,text/csv" disabled={busy}
        aria-label="Correspondence file" data-testid="input-correspondence-file" className="block w-full text-xs"
        onChange={e => { void readFile(e.target.files?.[0]); }} />
      <p className="break-all text-xs">{reading ? 'Reading file...' : `Source: ${draft.filename} (${draft.fileType})`}</p>
      <label className="block text-xs font-medium" htmlFor="correspondence-text">Raw correspondence</label>
      <Textarea id="correspondence-text" rows={5} value={draft.rawText} disabled={busy}
        maxLength={MAX_BYTES} data-testid="input-correspondence-text"
        onChange={e => setDraft({ fileType: 'text', filename: 'Pasted text', rawText: e.target.value })} />
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <Button size="sm" onClick={submit} disabled={busy || !draft.rawText.trim()} data-testid="button-save-correspondence">
        {upload.isPending ? 'Uploading...' : 'Save correspondence'}
      </Button>
    </div>}
    <p className="text-xs text-muted-foreground">{analyze.isPending ? 'Analyzing communication...' : portrait.isPending ? 'Generating company portrait...' : 'Upload automatically runs NLP analysis followed by company portrait generation using the existing managed OpenAI service (Replit credit usage may apply). Missing configuration, errors or unsupported output use rules fallback. Manual buttons are optional retries.'}</p>
    {analysisError && <Alert variant="destructive" data-testid="alert-correspondence-analysis-error"><AlertDescription>{analysisError}</AlertDescription></Alert>}
    {records.isLoading ? <p className="text-xs">Loading correspondence...</p>
      : records.isError ? <div className="text-xs" role="alert">Could not load correspondence. <Button size="sm" variant="outline" onClick={() => records.refetch()}>Retry</Button></div>
      : !records.data?.length ? <p className="text-xs text-muted-foreground">No correspondence uploaded.</p>
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
