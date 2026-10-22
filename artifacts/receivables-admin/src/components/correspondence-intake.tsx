import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetCompanyCorrespondenceQueryKey, useAnalyzeCompanyCorrespondence, useArchiveCorrespondenceGroup,
  useGenerateCompanyPortrait, useIdentifyCorrespondence,
  type CorrespondenceInput, type CorrespondenceIntake, type CorrespondenceIntakeGroup, type Customer,
} from '@workspace/api-client-react';
import { Panel, Tag } from '@/components/kit';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { errMsg, fmtDateTime, useRefresh } from '@/lib/arus';

const MAX_BYTES = 10 * 1024 * 1024;
const PREVIEW_LINES = 30;
const EMPTY_DRAFT: CorrespondenceInput = { fileType: 'text', filename: 'Pasted text', rawText: '' };

type Step = 'archive' | 'analyze' | 'portrait' | 'refresh';
type GroupState = {
  selectedCompanyId: string;
  recordId: string | null;
  archivedCompanyId: string | null;
  analyzed: boolean;
  analysisProvider: 'openai' | 'rules_fallback' | null;
  portraitDone: boolean;
  portraitProvider: 'openai' | 'rules_fallback' | null;
  refreshed: boolean;
  running: Step | null;
  failedStep: Step | null;
  error: string;
};
type Snapshot = { intake: CorrespondenceIntake; input: CorrespondenceInput; lines: string[] };
type Receipt = { id: string; createdAt: string; provider: string; reasonCode: string; filename: string; groups: number };

const STEP_LABEL: Record<Step, string> = { archive: 'Archive', analyze: 'NLP analysis', portrait: 'Portrait generation', refresh: 'Workspace refresh' };

export function splitLines(raw: string) { return raw.split(/\r\n|\r|\n/); }

export function groupText(lines: string[], group: CorrespondenceIntakeGroup): string {
  return group.spans.map((s) => lines.slice(s.startLine - 1, s.endLine).join('\n')).join('\n');
}

function initState(g: CorrespondenceIntakeGroup): GroupState {
  return { selectedCompanyId: g.resolution === 'matched' ? g.companyId ?? '' : '', recordId: null, archivedCompanyId: null,
    analyzed: false, analysisProvider: null, portraitDone: false, portraitProvider: null,
    refreshed: false, running: null, failedStep: null, error: '' };
}

function Lines({ text, testId }: { text: string; testId: string }) {
  const [all, setAll] = useState(false);
  const lines = splitLines(text);
  const shown = all ? text : lines.slice(0, PREVIEW_LINES).join('\n');
  return <div>
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/60 p-2 font-sans text-xs" data-testid={testId}>{shown}</pre>
    {lines.length > PREVIEW_LINES && <Button size="sm" variant="ghost" className="mt-1 h-7 text-xs" onClick={() => setAll(!all)} data-testid={`${testId}-toggle`}>
      {all ? 'Show less' : `Show all ${lines.length} lines`}</Button>}
  </div>;
}

export function CorrespondenceIntakePanel({ customers, onOpenCompany }: { customers: Customer[]; onOpenCompany: (id: string) => void }) {
  const identify = useIdentifyCorrespondence();
  const archive = useArchiveCorrespondenceGroup();
  const analyze = useAnalyzeCompanyCorrespondence();
  const portrait = useGenerateCompanyPortrait();
  const qc = useQueryClient();
  const refresh = useRefresh();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<CorrespondenceInput>(EMPTY_DRAFT);
  const [reading, setReading] = useState(false);
  const [formError, setFormError] = useState('');
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const snapRef = useRef<Snapshot | null>(null);
  const statesRef = useRef<Record<string, GroupState>>({});
  const locks = useRef<Set<string>>(new Set());
  const executionLock = useRef(false);
  const identificationLock = useRef(false);
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [autoRunning, setAutoRunning] = useState(false);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);

  const patch = (id: string, p: Partial<GroupState>) => {
    statesRef.current = { ...statesRef.current, [id]: { ...statesRef.current[id], ...p } };
    rerender();
  };

  const states = statesRef.current;
  const groups = snap?.intake.groups ?? [];
  const processing = autoRunning || identify.isPending || groups.some((g) => states[g.id]?.running);
  const pending = groups.filter((g) => !states[g.id]?.recordId && groupText(snap!.lines, g).trim()).length;
  const expired = !!snap && now >= new Date(snap.intake.expiresAt).getTime();
  const nameOf = (id: string | null) => customers.find((c) => c.id === id)?.name ?? id ?? '-';

  const guardRef = useRef(false);
  guardRef.current = processing || pending > 0;
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (guardRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  const confirmDiscard = () => !guardRef.current || window.confirm('Unarchived text from the current identification will be lost. Continue?');
  const clearIntake = () => { snapRef.current = null; statesRef.current = {}; locks.current.clear(); setSnap(null); };

  const replaceDraft = (next: CorrespondenceInput) => {
    if (processing) return;
    if (snapRef.current) { if (!confirmDiscard()) return; clearIntake(); }
    setDraft(next);
  };

  const readFile = async (file?: File) => {
    if (!file || processing) return;
    setFormError('');
    if (snapRef.current) { if (!confirmDiscard()) { if (fileRef.current) fileRef.current.value = ''; return; } clearIntake(); }
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'txt' && ext !== 'csv') { setFormError('Choose a .txt or .csv file.'); if (fileRef.current) fileRef.current.value = ''; return; }
    if (file.size > MAX_BYTES) { setFormError('File exceeds the 10 MiB limit.'); if (fileRef.current) fileRef.current.value = ''; return; }
    setReading(true);
    try {
      const rawText = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (rawText.includes('\0')) throw new Error('nul');
      setDraft({ fileType: ext, filename: file.name, rawText });
    } catch {
      setFormError('Cannot read this file as UTF-8 plain text. Export it as UTF-8 .txt or .csv and retry.');
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Runs remaining steps for a group; each completed step is stored synchronously so retries resume at the failed step.
  const runGroup = async (groupId: string) => {
    const s0 = snapRef.current;
    if (!s0 || locks.current.has(groupId) || executionLock.current) return;
    const group = s0.intake.groups.find((g) => g.id === groupId);
    if (!group || group.resolution === 'conflicting') return;
    locks.current.add(groupId);
    executionLock.current = true;
    let step: Step = 'archive';
    try {
      let st = statesRef.current[groupId];
      if (!st.recordId) {
        if (Date.now() >= new Date(s0.intake.expiresAt).getTime()) throw new Error('This identification has expired. Identify the source again.');
        const companyId = group.resolution === 'matched' ? group.companyId : st.selectedCompanyId;
        if (!companyId) throw new Error('Select a company first.');
        const rawText = groupText(s0.lines, group);
        if (!rawText.trim()) throw new Error('This group has no text.');
        patch(groupId, { running: 'archive', error: '', failedStep: null });
        const rec = await archive.mutateAsync({ id: s0.intake.id, data: { groupId, companyId, rawText, manualConfirmed: group.resolution !== 'matched' } });
        patch(groupId, { recordId: rec.id, archivedCompanyId: rec.companyId });
        void qc.invalidateQueries({ queryKey: getGetCompanyCorrespondenceQueryKey(rec.companyId) });
      }
      st = statesRef.current[groupId];
      const cid = st.archivedCompanyId!;
      if (!st.analyzed) {
        step = 'analyze'; patch(groupId, { running: 'analyze', error: '', failedStep: null });
        const analyzed = await analyze.mutateAsync({ id: cid, recordId: st.recordId! });
        patch(groupId, { analyzed: true, analysisProvider: analyzed.provider });
      }
      if (!statesRef.current[groupId].portraitDone) {
        step = 'portrait'; patch(groupId, { running: 'portrait', error: '', failedStep: null });
        const saved = await portrait.mutateAsync({ id: cid });
        patch(groupId, { portraitDone: true, portraitProvider: saved.provider });
      }
      step = 'refresh'; patch(groupId, { running: 'refresh', error: '', failedStep: null });
      await qc.invalidateQueries({ queryKey: getGetCompanyCorrespondenceQueryKey(cid) });
      await refresh();
      patch(groupId, { refreshed: true, running: null });
    } catch (e) {
      if (snapRef.current === s0) patch(groupId, { failedStep: step, error: errMsg(e) });
      if (statesRef.current[groupId]?.recordId) {
        try { await refresh(); } catch { /* Keep the failed step and saved record available for retry. */ }
      }
    } finally {
      if (snapRef.current === s0) patch(groupId, { running: null });
      locks.current.delete(groupId);
      executionLock.current = false;
    }
  };

  const submit = async () => {
    setFormError('');
    if (processing || reading || identificationLock.current) return;
    if (!draft.rawText.trim()) { setFormError('Paste text or choose a non-empty file.'); return; }
    if (new TextEncoder().encode(draft.rawText).byteLength > MAX_BYTES) { setFormError('Source exceeds the 10 MiB limit.'); return; }
    if (draft.rawText.includes('\0')) { setFormError('Only plain text is supported.'); return; }
    const input: CorrespondenceInput = { ...draft };
    identificationLock.current = true;
    let intake: CorrespondenceIntake;
    try { intake = await identify.mutateAsync({ data: input }); }
    catch (e) { setFormError(errMsg(e)); identificationLock.current = false; return; }
    const next: Snapshot = { intake, input, lines: splitLines(input.rawText) };
    snapRef.current = next;
    statesRef.current = Object.fromEntries(intake.groups.map((g) => [g.id, initState(g)]));
    locks.current.clear();
    setSnap(next);
    setReceipts((r) => [{ id: intake.id, createdAt: intake.createdAt, provider: intake.provider, reasonCode: intake.reasonCode, filename: input.filename, groups: intake.groups.length }, ...r].slice(0, 20));
    setAutoRunning(true);
    try {
      for (const g of intake.groups) {
        if (snapRef.current !== next) break;
        if (g.resolution === 'matched' && g.companyId && groupText(next.lines, g).trim()) await runGroup(g.id);
      }
    } finally { setAutoRunning(false); identificationLock.current = false; }
  };

  const reset = () => {
    if (processing || !confirmDiscard()) return;
    clearIntake(); setDraft(EMPTY_DRAFT); setFormError('');
  };

  const formLocked = processing || reading;

  return <Panel title="Correspondence intake" zh="One upload may cover several companies" data-testid="panel-correspondence-intake" bodyClass="space-y-3">
    <p className="text-xs text-muted-foreground">Synthetic demo only. Paste WhatsApp or Excel-exported text, or choose a UTF-8 .txt/.csv file (max 10 MiB). AI splits the source by company; clear matches are archived, analyzed and added to each company portrait automatically. Uncertain groups need your confirmation. Each company keeps its latest five records.</p>
    <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
      <div className="space-y-2">
        <input ref={fileRef} type="file" accept=".txt,.csv,text/plain,text/csv" disabled={formLocked}
          aria-label="Correspondence file" data-testid="input-intake-file" className="block w-full text-xs"
          onChange={(e) => { void readFile(e.target.files?.[0]); }} />
        <p className="break-all text-xs" data-testid="text-intake-source">{reading ? 'Reading file...' : `Source: ${draft.filename} (${draft.fileType})`}</p>
        <Textarea rows={4} value={draft.rawText} disabled={formLocked} aria-label="Raw correspondence" data-testid="input-intake-text"
          placeholder="Paste correspondence for one or more companies"
          onChange={(e) => replaceDraft({ fileType: 'text', filename: 'Pasted text', rawText: e.target.value })} />
      </div>
      <div className="flex gap-2 md:flex-col">
        <Button size="sm" onClick={submit} disabled={formLocked || !draft.rawText.trim() || !!snap} data-testid="button-identify-correspondence">
          {identify.isPending ? 'Identifying...' : 'Identify companies'}</Button>
        <Button size="sm" variant="outline" onClick={reset} disabled={formLocked || (!snap && !draft.rawText)} data-testid="button-intake-reset">New import</Button>
      </div>
    </div>
    {formError && <Alert variant="destructive"><AlertDescription data-testid="text-intake-error">{formError}</AlertDescription></Alert>}
    {processing && <Alert data-testid="alert-intake-processing"><AlertDescription>Processing. Keep this page open until all groups finish.</AlertDescription></Alert>}

    {snap && <div className="space-y-3" data-testid="intake-result">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Tag tone={snap.intake.provider === 'openai' ? 'blue' : 'orange'}>{snap.intake.provider === 'openai' ? 'OpenAI identification' : 'Rules fallback identification'}</Tag>
        <span className="text-muted-foreground">{snap.intake.reasonCode} · {snap.intake.groups.length} group(s) · expires {fmtDateTime(snap.intake.expiresAt)}</span>
      </div>
      {expired && <Alert variant="destructive" data-testid="alert-intake-expired"><AlertDescription>This identification expired. Unarchived groups can no longer be archived; start a new import. Steps after archive can still be retried.</AlertDescription></Alert>}
      {pending > 0 && <p className="text-xs text-muted-foreground" data-testid="text-intake-pending">{pending} group(s) not yet archived. Unarchived text is not saved and will be lost on reload.</p>}
      <details className="text-xs"><summary className="cursor-pointer">Source preview ({snap.lines.length} lines)</summary>
        <div className="mt-2"><Lines text={snap.input.rawText} testId="text-intake-preview" /></div></details>
      {snap.intake.groups.length === 0 && <p className="text-xs text-muted-foreground">No company groups identified. Edit the source and identify again.</p>}
      <ul className="space-y-2">
        {snap.intake.groups.map((g, i) => {
          const st = states[g.id];
          const text = groupText(snap.lines, g);
          const done = st.refreshed;
          const conflict = g.resolution === 'conflicting';
          const empty = !text.trim();
          return <li key={g.id} className="space-y-2 rounded-md border p-3 text-xs" data-testid={`card-intake-group-${g.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Group {i + 1}</span>
              <Tag tone={conflict ? 'red' : g.resolution === 'matched' ? 'green' : 'orange'}>{conflict ? 'Conflicting' : g.resolution === 'matched' ? 'Matched' : 'Needs confirmation'}</Tag>
              <span className="text-muted-foreground">Lines {g.spans.map((s) => s.startLine === s.endLine ? s.startLine : `${s.startLine}-${s.endLine}`).join(', ')}</span>
              <span className="ml-auto" data-testid={`status-intake-group-${g.id}`}>
                {st.running ? `${STEP_LABEL[st.running]}...` : done ? 'Archived, analyzed, portrait updated'
                  : st.failedStep ? `${STEP_LABEL[st.failedStep]} failed` : st.recordId ? 'Archived' : conflict ? 'Not archived' : 'Awaiting archive'}
              </span>
            </div>
            <p className="text-muted-foreground">{g.reason}</p>
            {g.resolution === 'matched' && <p>Company: <span className="font-medium">{nameOf(g.companyId)}</span></p>}
            {g.resolution === 'needs_confirmation' && (st.recordId
              ? <p>Company: <span className="font-medium">{nameOf(st.archivedCompanyId)}</span> (confirmed manually)</p>
              : <div className="flex flex-wrap items-center gap-2">
                {g.suggestedCompanyId && <span className="text-muted-foreground">Suggestion only: {nameOf(g.suggestedCompanyId)}</span>}
                <Select value={st.selectedCompanyId} disabled={processing || expired} onValueChange={(v) => { if (!statesRef.current[g.id].recordId) patch(g.id, { selectedCompanyId: v }); }}>
                  <SelectTrigger className="h-8 w-64" data-testid={`select-intake-company-${g.id}`}><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} · {c.id}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="sm" disabled={!st.selectedCompanyId || processing || expired || empty} onClick={() => void runGroup(g.id)} data-testid={`button-intake-confirm-${g.id}`}>Confirm and archive</Button>
              </div>)}
            {conflict && <Alert variant="destructive"><AlertDescription>This group mixes companies or is ambiguous and will not be archived. Split or edit the source, then start a new import.</AlertDescription></Alert>}
            {empty && !conflict && <p className="text-destructive">This group has no text and cannot be archived.</p>}
            {st.error && <Alert variant="destructive" data-testid={`alert-intake-group-error-${g.id}`}><AlertDescription>
              {st.recordId ? 'Record is saved. ' : ''}{st.failedStep ? STEP_LABEL[st.failedStep] : 'Step'} failed: {st.error}</AlertDescription></Alert>}
            {(st.analysisProvider || st.portraitProvider) && <p className="text-muted-foreground" data-testid={`source-intake-group-${g.id}`}>
              NLP: {st.analysisProvider === 'openai' ? 'OpenAI' : st.analysisProvider ? 'Rules fallback' : 'Pending'} ·
              Portrait: {st.portraitProvider === 'openai' ? 'OpenAI-assisted' : st.portraitProvider ? 'Rules fallback' : 'Pending'}
            </p>}
            <div className="flex flex-wrap gap-2">
              {st.failedStep && !st.running && !(st.failedStep === 'archive' && expired) && (g.resolution === 'matched' || st.recordId || st.selectedCompanyId) &&
                <Button size="sm" variant="outline" disabled={processing} onClick={() => void runGroup(g.id)} data-testid={`button-intake-retry-${g.id}`}>Retry {STEP_LABEL[st.failedStep].toLowerCase()}</Button>}
              {st.recordId && st.archivedCompanyId && <Button size="sm" variant="outline" onClick={() => onOpenCompany(st.archivedCompanyId!)} data-testid={`button-intake-open-${g.id}`}>Open company folder</Button>}
            </div>
            <details><summary className="cursor-pointer">Group text</summary><div className="mt-2"><Lines text={text} testId={`text-intake-group-${g.id}`} /></div></details>
          </li>;
        })}
      </ul>
    </div>}

    {receipts.length > 0 && <details className="text-xs" data-testid="list-intake-receipts"><summary className="cursor-pointer">Recent identifications this session ({receipts.length})</summary>
      <ul className="mt-2 space-y-1">{receipts.map((r) => <li key={r.id} className="break-all text-muted-foreground">
        {fmtDateTime(r.createdAt)} · {r.filename} · {r.groups} group(s) · {r.provider === 'openai' ? 'OpenAI' : 'Rules fallback'} ({r.reasonCode})</li>)}</ul></details>}
  </Panel>;
}
