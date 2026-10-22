import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import {
  getGetCompanyCorrespondenceQueryKey, useGetCompanyCorrespondence, useUploadCompanyCorrespondence,
  type CorrespondenceInput,
  useAnalyzeCompanyCorrespondence,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { errMsg, fmtDateTime, useRefresh } from '@/lib/arus';

const MAX_BYTES = 10 * 1024 * 1024;

export function CorrespondencePanel({ companyId }: { companyId: string }) {
  const queryKey = getGetCompanyCorrespondenceQueryKey(companyId);
  const records = useGetCompanyCorrespondence(companyId, { query: { queryKey, refetchInterval: 15000 } });
  const upload = useUploadCompanyCorrespondence();
  const analyze = useAnalyzeCompanyCorrespondence();
  const qc = useQueryClient();
  const refresh = useRefresh();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<CorrespondenceInput>({ fileType: 'text', filename: 'Pasted text', rawText: '' });
  const [analysisError, setAnalysisError] = useState('');
  const busy = reading || upload.isPending || analyze.isPending;

  const analyzeRecord = async (recordId: string) => {
    setAnalysisError('');
    try {
      const result = await analyze.mutateAsync({ id: companyId, recordId });
      await refresh();
      toast({ title: 'Communication extraction saved',
        description: result.provider === 'openai' ? 'OpenAI extraction saved as unverified source claims.' : `Rules fallback used (${result.reasonCode}). Review the extracted source claims.` });
    } catch (e) { setAnalysisError(errMsg(e)); }
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
    try {
      await upload.mutateAsync({ id: companyId, data: draft });
    } catch (e) { setError(errMsg(e)); return; }
    setDraft({ fileType: 'text', filename: 'Pasted text', rawText: '' });
    setOpen(false);
    await Promise.all([qc.invalidateQueries({ queryKey }), refresh()]);
    toast({ title: 'Correspondence uploaded', description: 'Saved with an audit entry. No AI processing was performed.' });
  };

  return <section className="space-y-3" data-testid="panel-correspondence">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Uploaded correspondence</h3>
      <Button size="sm" variant="outline" onClick={() => setOpen(!open)} disabled={busy} data-testid="button-upload-correspondence">
        <Upload className="mr-1 h-4 w-4" />{open ? 'Close upload' : 'Upload correspondence'}
      </Button>
    </div>
    {open && <div className="space-y-3 rounded-md border p-3">
      <p className="text-xs text-muted-foreground">Shared synthetic demo only: do not upload real customer information. Paste WhatsApp chat or Excel-exported text, or choose a UTF-8 .txt/.csv file (maximum 10 MB). Upload stores raw text only. AI analysis requires a separate manual action.</p>
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
    <p className="text-xs text-muted-foreground">Analyze sends the selected record to the existing managed OpenAI service (Replit credit usage may apply). Missing configuration, errors or unsupported output use regex rules. Unknown values remain empty; no company profile is generated.</p>
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
          <details className="mt-1"><summary className="cursor-pointer">View original text</summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/60 p-2 font-sans">{record.rawText}</pre>
          </details>
        </li>)}
      </ul>}
  </section>;
}
