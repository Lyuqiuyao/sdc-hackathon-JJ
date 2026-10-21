import { useRef, useState } from 'react';
import { FileJson, Save, Send } from 'lucide-react';
import {
  useSaveCompanyProfile, useSubmitSedg,
  type CompanyProfileInput, type Customer, type Workspace,
} from '@workspace/api-client-react';
import { EmptyState, Field, KV, Tag } from '@/components/kit';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { errMsg, fmtDate, fmtDateTime, rm, safeHistorical, useRefresh } from '@/lib/arus';

type Rating = CompanyProfileInput['existingEsgRating'];
const SEDG_FIELDS = ['environmental', 'social', 'governance', 'sourceReference'] as const;
type SedgForm = Record<(typeof SEDG_FIELDS)[number], string>;
const EMPTY_SEDG: SedgForm = { environmental: '', social: '', governance: '', sourceReference: '' };
const LIMITS: SedgForm = { environmental: '2000', social: '2000', governance: '2000', sourceReference: '300' };

/** Validates a parsed structured SEDG import. Returns field values or a list of readable errors. */
export function validateSedgJson(text: string): { ok: true; value: SedgForm } | { ok: false; errors: string[] } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, errors: ['Input is not valid JSON.'] }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, errors: ['JSON must be a single object, not an array or a value.'] };
  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];
  const value = { ...EMPTY_SEDG };
  for (const k of SEDG_FIELDS) {
    const v = obj[k];
    if (typeof v !== 'string') errors.push(`"${k}" must be a string${v === undefined ? ' (missing)' : ''}.`);
    else if (!v.trim()) errors.push(`"${k}" must not be empty.`);
    else if (v.length > Number(LIMITS[k])) errors.push(`"${k}" is longer than ${LIMITS[k]} characters.`);
    else value[k] = v.trim();
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

function ProfileEditor({ customer }: { customer: Customer }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const save = useSaveCompanyProfile();
  const [f, setF] = useState({
    industry: customer.industry,
    paymentHistory: customer.paymentHistory ?? '',
    profileSummary: customer.profileSummary ?? '',
    existingEsgRating: (['A', 'B', 'C'].includes(customer.esgRating) ? customer.esgRating : 'unknown') as Rating,
  });
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState('');
  const valid = f.industry.trim() && f.paymentHistory.trim() && f.profileSummary.trim() && ok;
  const submit = async () => {
    setErr('');
    try {
      await save.mutateAsync({ id: customer.id, data: { ...f, industry: f.industry.trim(), paymentHistory: f.paymentHistory.trim(), profileSummary: f.profileSummary.trim(), expectedVersion: customer.profileVersion ?? 0, syntheticConfirmed: true } });
      await refresh(); setOk(false);
      toast({ title: 'Company profile saved', description: 'Recorded in the audit log. Existing plans are not rescored.' });
    } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div className="space-y-3 rounded-md border p-3" data-testid="form-profile">
      <Field label="Industry"><Input value={f.industry} maxLength={200} onChange={(e) => setF({ ...f, industry: e.target.value })} data-testid="input-profile-industry" /></Field>
      <Field label="Payment history"><Textarea rows={2} value={f.paymentHistory} maxLength={2000} onChange={(e) => setF({ ...f, paymentHistory: e.target.value })} data-testid="input-profile-payment" /></Field>
      <Field label="Profile summary"><Textarea rows={3} value={f.profileSummary} maxLength={3000} onChange={(e) => setF({ ...f, profileSummary: e.target.value })} data-testid="input-profile-summary" /></Field>
      <Field label="Existing ESG rating (imported)" hint="Records a rating that already exists in the synthetic data. It is not calculated or certified here. Choose unknown if there is none.">
        <Select value={f.existingEsgRating} onValueChange={(v) => setF({ ...f, existingEsgRating: v as Rating })}><SelectTrigger className="sm:w-48" data-testid="select-profile-esg"><SelectValue /></SelectTrigger>
          <SelectContent>{['A', 'B', 'C', 'unknown'].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select>
      </Field>
      <label className="flex items-start gap-2 text-xs"><Checkbox checked={ok} onCheckedChange={(v) => setOk(v === true)} data-testid="check-profile-synthetic" /><span>I confirm this is synthetic demo data and not a real company record.</span></label>
      {err && <Alert variant="destructive" data-testid="alert-profile-error"><AlertDescription>{err}</AlertDescription></Alert>}
      <Button size="sm" onClick={submit} disabled={!valid || save.isPending} data-testid="button-save-profile"><Save className="mr-1 h-4 w-4" />{save.isPending ? 'Saving...' : 'Save profile'}</Button>
      <p className="text-[11px] text-muted-foreground">Profile version {customer.profileVersion ?? 0}. If another edit saved first, reload and retry.</p>
    </div>
  );
}

function SedgPanel({ customer, ws }: { customer: Customer; ws: Workspace }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const submitSedg = useSubmitSedg();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState<SedgForm>(EMPTY_SEDG);
  const [json, setJson] = useState('');
  const [jsonErrors, setJsonErrors] = useState<string[]>([]);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState('');
  const history = (ws.sedgSubmissions ?? []).filter((s) => s.customerId === customer.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const valid = SEDG_FIELDS.every((k) => f[k].trim()) && ok;

  const applyJson = (text: string) => {
    const r = validateSedgJson(text);
    if (r.ok) { setF(r.value); setJsonErrors([]); toast({ title: 'JSON loaded into the form', description: 'Review the fields, confirm the attestation, then submit.' }); }
    else setJsonErrors(r.errors);
  };
  const onFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 100_000) { setJsonErrors(['File is larger than 100 KB.']); return; }
    const text = await file.text(); // read once for parsing only; file bytes are never stored
    setJson(text); applyJson(text);
    if (fileRef.current) fileRef.current.value = '';
  };
  const submit = async () => {
    setErr('');
    try {
      await submitSedg.mutateAsync({ id: customer.id, data: { environmental: f.environmental.trim(), social: f.social.trim(), governance: f.governance.trim(), sourceReference: f.sourceReference.trim(), syntheticConfirmed: true } });
      await refresh(); setF(EMPTY_SEDG); setJson(''); setOk(false);
      toast({ title: 'SEDG declaration appended', description: 'Status: Submitted - unverified. It is not a verification.' });
    } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div className="space-y-3" data-testid="panel-sedg">
      <Alert><AlertDescription className="text-xs">A SEDG submission is a self-declared, append-only record with status "Submitted - unverified". It is not a verification or certification. A customer with no submission is treated as neutral, never as bad risk.</AlertDescription></Alert>
      <div className="space-y-2 rounded-md border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-semibold">Structured JSON import</h4>
          <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} data-testid="button-sedg-file"><FileJson className="mr-1 h-4 w-4" />Choose .json file</Button></div>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} data-testid="input-sedg-file" />
        <Textarea rows={4} className="font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} placeholder={'{"environmental": "...", "social": "...", "governance": "...", "sourceReference": "..."}'} data-testid="input-sedg-json" />
        <Button type="button" size="sm" variant="secondary" onClick={() => applyJson(json)} disabled={!json.trim()} data-testid="button-sedg-load-json">Validate and load into form</Button>
        {jsonErrors.length > 0 && <ul className="list-disc space-y-0.5 rounded border border-red-200 bg-red-50 p-2 pl-6 text-xs text-red-700" data-testid="list-sedg-json-errors">{jsonErrors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <p className="text-[11px] text-muted-foreground">Only the text fields are kept. The file itself is not stored.</p>
      </div>
      <div className="space-y-3 rounded-md border p-3" data-testid="form-sedg">
        <Field label="Environmental"><Textarea rows={2} maxLength={2000} value={f.environmental} onChange={(e) => setF({ ...f, environmental: e.target.value })} data-testid="input-sedg-environmental" /></Field>
        <Field label="Social"><Textarea rows={2} maxLength={2000} value={f.social} onChange={(e) => setF({ ...f, social: e.target.value })} data-testid="input-sedg-social" /></Field>
        <Field label="Governance"><Textarea rows={2} maxLength={2000} value={f.governance} onChange={(e) => setF({ ...f, governance: e.target.value })} data-testid="input-sedg-governance" /></Field>
        <Field label="Source reference"><Input maxLength={300} value={f.sourceReference} onChange={(e) => setF({ ...f, sourceReference: e.target.value })} data-testid="input-sedg-source" /></Field>
        <label className="flex items-start gap-2 text-xs"><Checkbox checked={ok} onCheckedChange={(v) => setOk(v === true)} data-testid="check-sedg-synthetic" /><span>I confirm this declaration is synthetic demo data and understand it is stored as unverified.</span></label>
        {err && <Alert variant="destructive" data-testid="alert-sedg-error"><AlertDescription>{err}</AlertDescription></Alert>}
        <Button size="sm" onClick={submit} disabled={!valid || submitSedg.isPending} data-testid="button-submit-sedg"><Send className="mr-1 h-4 w-4" />{submitSedg.isPending ? 'Submitting...' : 'Submit declaration'}</Button>
      </div>
      <h4 className="text-xs font-semibold">Submission history ({history.length})</h4>
      {history.length === 0 ? <EmptyState title="No SEDG submitted" hint="Not submitted means neutral. It does not raise risk." /> : (
        <ul className="space-y-2 text-xs">{history.map((s) => (
          <li key={s.id} className="rounded-md border p-2" data-testid={`sedg-${s.id}`}>
            <div className="flex flex-wrap items-center gap-2"><Tag tone="orange">{s.status}</Tag><span className="font-mono">{s.id.slice(-8)}</span><span className="text-muted-foreground">{s.actor} · {fmtDateTime(s.createdAt)} · {safeHistorical(s.source)}</span></div>
            <dl className="mt-1 space-y-0.5"><div><b>Environmental: </b>{safeHistorical(s.environmental)}</div><div><b>Social: </b>{safeHistorical(s.social)}</div><div><b>Governance: </b>{safeHistorical(s.governance)}</div><div><b>Source: </b>{safeHistorical(s.sourceReference)}</div></dl>
          </li>))}</ul>)}
    </div>
  );
}

export function CompanyFolder({ customer: sel, ws }: { customer: Customer; ws: Workspace }) {
  const [editing, setEditing] = useState(false);
  const invs = ws.invoices.filter((i) => i.customerId === sel.id);
  const docs = ws.documents.filter((d) => d.customerId === sel.id);
  const comms = ws.plans.flatMap((p) => p.tasks.filter((t) => t.customerId === sel.id).map((t) => ({ ...t, v: p.version, ps: p.status })));
  const execs = ws.executions.filter((e) => e.customerName === sel.name);
  const reviews = ws.plans.flatMap((p) => (p.customerReviews ?? []).filter((r) => r.customerId === sel.id).map((r) => ({ ...r, v: p.version })));
  return (
    <div className="space-y-5" data-testid="detail-customer">
      <section>
        <div className="mb-1 flex items-center justify-between"><h3 className="text-sm font-semibold">Profile</h3>
          <Button size="sm" variant="outline" onClick={() => setEditing((x) => !x)} data-testid="button-edit-profile">{editing ? 'Close editor' : 'Edit profile'}</Button></div>
        <dl>
          <KV k="Business importance" v={<Tag>{sel.importance}</Tag>} /><KV k="Existing ESG rating (imported, unverified)" v={<Tag>{sel.esgRating || 'Uncertified'}</Tag>} />
          <KV k="Outstanding" v={rm(sel.outstandingCents)} /><KV k="Overdue" v={rm(sel.overdueCents)} /><KV k="Earliest due" v={sel.earliestDue ? fmtDate(sel.earliestDue) : '-'} /><KV k="Risk status" v={<Tag>{sel.risk}</Tag>} />
          <KV k="Profile version" v={`v${sel.profileVersion ?? 0}${sel.profileSource ? ` · ${safeHistorical(sel.profileSource)}` : ''}`} />
        </dl>
        <p className="mt-2 rounded-md bg-muted/60 p-3 text-sm" data-testid="text-profile-summary">{sel.profileSummary ? safeHistorical(sel.profileSummary) : 'No profile summary recorded yet.'}</p>
        {editing && <div className="mt-3"><ProfileEditor key={`${sel.id}-${sel.profileVersion ?? 0}`} customer={sel} /></div>}
      </section>
      <section><h3 className="mb-1 text-sm font-semibold">Risk explanation</h3>
        <p className="rounded-md bg-muted/60 p-3 text-sm">{sel.risk} risk is based on deterministic invoice rules using overdue days and outstanding amounts, not on ESG, SEDG or payment-history prose. Missing ESG rating or SEDG submission is treated as neutral.</p></section>
      <section><h3 className="mb-1 text-sm font-semibold">Payment history</h3><p className="text-sm text-muted-foreground" data-testid="text-payment-history">{safeHistorical(sel.paymentHistory) || 'Unknown'}</p></section>
      <section><h3 className="mb-1 text-sm font-semibold">Linked invoices ({invs.length})</h3>
        {invs.length === 0 ? <EmptyState title="No linked invoices" /> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>No.</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>{invs.map((i) => <TableRow key={i.id}><TableCell className="font-mono text-xs">{i.number}</TableCell><TableCell>{fmtDate(i.dueDate)}</TableCell><TableCell className="text-right font-mono text-xs">{rm(i.outstandingCents)}</TableCell><TableCell><Tag>{i.status}</Tag></TableCell></TableRow>)}</TableBody></Table></div>}</section>
      <section><h3 className="mb-1 text-sm font-semibold">ESG documents ({docs.length})</h3>
        {docs.length === 0 ? <p className="text-sm text-muted-foreground">No documents on record.</p> : <ul className="space-y-1 text-sm">{docs.map((d) => <li key={d.id} className="flex items-center justify-between"><span>{d.type} · {d.number}</span><Tag>{d.status}</Tag></li>)}</ul>}</section>
      <section><h3 className="mb-1 text-sm font-semibold">SEDG declarations</h3><SedgPanel customer={sel} ws={ws} /></section>
      {reviews.length > 0 && <section><h3 className="mb-1 text-sm font-semibold">Plan reviews ({reviews.length})</h3>
        <ul className="space-y-1 text-xs">{reviews.map((r, i) => <li key={`${r.v}-${i}`} className="rounded-md border p-2"><Tag>{r.decision === 'collect_now' ? 'Collect now' : 'Negotiable extension'}</Tag> plan v{r.v} · {r.actor} · {fmtDateTime(r.createdAt)} · profile v{r.profileVersion}{r.sedgSubmissionId ? ` · SEDG ${r.sedgSubmissionId.slice(-6)}` : ''}<div className="text-muted-foreground">{r.reason}</div></li>)}</ul></section>}
      <section><h3 className="mb-1 text-sm font-semibold">Collection communications</h3>
        {comms.length === 0 && execs.length === 0 ? <p className="text-sm text-muted-foreground">No communications recorded. Notices are drafts only; nothing is sent.</p> : (
          <ul className="space-y-2 text-sm">
            {comms.map((t) => <li key={t.id} className="rounded-md border p-2"><div className="flex justify-between"><span>{t.invoiceNumber} · {t.method}</span><Tag>{t.ps}</Tag></div><div className="text-xs text-muted-foreground">Plan v{t.v} · {fmtDate(t.scheduledAt)} · draft notice</div></li>)}
            {execs.map((e) => <li key={e.id} className="rounded-md border border-dashed p-2 text-xs"><b>Simulated email:</b> {e.invoiceNumber} · {e.recipient ?? 'recipient not recorded'} · {e.noticeStatus} · {fmtDate(e.executedAt)}</li>)}
          </ul>)}</section>
    </div>
  );
}
