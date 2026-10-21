import { useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { useResetDemo, useSaveSettings, type SystemSetting, type Workspace } from '@workspace/api-client-react';
import { Page, Panel, Field, Tag } from '@/components/kit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { errMsg, useRefresh } from '@/lib/arus';

type Form = Record<string, string>;
const MONEY = [
  ['cashCents', 'Available cash (MYR) · 可用现金'], ['minimumCashCents', 'Minimum operating cash (MYR) · 最低运营现金'], ['expectedExpenseCents', 'Expected expenses in horizon (MYR) · 预计支出'],
  ['overdueThresholdCents', 'Overdue amount threshold (MYR) · 逾期金额阈值'], ['largeInvoiceCents', 'Large invoice threshold (MYR) · 大额账单阈值'],
] as const;
const NUM = [
  ['horizonDays', 'Detection horizon (days, 1-90) · 检测天数'], ['mediumBufferPercent', 'Medium-risk buffer above minimum (%) · 中风险缓冲'],
  ['collectionRatePercent', 'Expected collection rate (%) · 预计收款率'], ['concentrationCount', 'Concentration count (invoices) · 集中到期笔数'],
] as const;

function init(s: SystemSetting): Form {
  const f: Form = { language: s.language, aiMode: s.aiMode === 'gemini' ? 'rules' : s.aiMode };
  MONEY.forEach(([k]) => (f[k] = (s[k] / 100).toFixed(2)));
  NUM.forEach(([k]) => (f[k] = String(s[k])));
  (['lateFee', 'urgency', 'importance', 'esg'] as const).forEach((k) => (f['w_' + k] = String(s.weights[k])));
  return f;
}

function SettingsForm({ ws }: { ws: Workspace }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const save = useSaveSettings();
  const reset = useResetDemo();
  const [f, setF] = useState<Form>(() => init(ws.settings));
  const [err, setErr] = useState('');
  const [ask, setAsk] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const wsum = ['lateFee', 'urgency', 'importance', 'esg'].reduce((a, k) => a + (Number(f['w_' + k]) || 0), 0);

  const submit = async () => {
    setErr('');
    if (wsum !== 100) { setErr('Scoring weights must total exactly 100.'); return; }
    const c = (k: string) => Math.round((Number(f[k]) || 0) * 100);
    const n = (k: string) => Number(f[k]) || 0;
    const body: SystemSetting = {
      currency: 'MYR', cashCents: c('cashCents'), minimumCashCents: c('minimumCashCents'), expectedExpenseCents: c('expectedExpenseCents'),
      horizonDays: n('horizonDays'), mediumBufferPercent: n('mediumBufferPercent'), collectionRatePercent: n('collectionRatePercent'),
      overdueThresholdCents: c('overdueThresholdCents'), largeInvoiceCents: c('largeInvoiceCents'), concentrationCount: n('concentrationCount'),
      weights: { lateFee: n('w_lateFee'), urgency: n('w_urgency'), importance: n('w_importance'), esg: n('w_esg') },
      language: f.language as SystemSetting['language'], aiMode: f.aiMode as SystemSetting['aiMode'],
    };
    try { await save.mutateAsync({ data: body }); await refresh(); toast({ title: 'Settings saved', description: 'Existing plans may need Defer & Recalculate before approval.' }); } catch (e) { setErr(errMsg(e)); }
  };
  const doReset = async () => {
    setAsk(false); setErr('');
    try { await reset.mutateAsync({ data: { confirm: true } }); await refresh(); toast({ title: 'Demo data reset', description: 'Audit history is retained.' }); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div className="space-y-4">
      {err && <Alert variant="destructive" data-testid="alert-settings-error"><AlertTitle>Could not complete</AlertTitle><AlertDescription>{err}</AlertDescription></Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Cash and risk thresholds" zh="现金与风险阈值" bodyClass="grid gap-3 sm:grid-cols-2">
          <Field label="Currency · 币种"><Input value="MYR" disabled data-testid="input-currency" /></Field>
          {MONEY.map(([k, l]) => <Field key={k} label={l}><Input type="number" min={0} step="0.01" value={f[k]} onChange={(e) => set(k, e.target.value)} data-testid={`input-${k}`} /></Field>)}
          {NUM.map(([k, l]) => <Field key={k} label={l}><Input type="number" min={0} value={f[k]} onChange={(e) => set(k, e.target.value)} data-testid={`input-${k}`} /></Field>)}
        </Panel>
        <div className="space-y-4">
          <Panel title="Scoring weights" zh="四维评分权重 (合计 100%)" bodyClass="grid gap-3 sm:grid-cols-2">
            {([['lateFee', 'Late fee impact'], ['urgency', 'Due urgency'], ['importance', 'Importance'], ['esg', 'ESG']] as const).map(([k, l]) => (
              <Field key={k} label={`${l} (%)`}><Input type="number" min={0} max={100} value={f['w_' + k]} onChange={(e) => set('w_' + k, e.target.value)} data-testid={`input-w-${k}`} /></Field>))}
            <div className={`sm:col-span-2 rounded-md p-2 text-sm font-semibold ${wsum === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>Total {wsum}%</div>
          </Panel>
          <Panel title="Language and AI mode" zh="通知语言与 AI 模式" bodyClass="space-y-3">
            <Field label="Default notice language · 默认通知语言"><Select value={f.language} onValueChange={(v) => set('language', v)}><SelectTrigger data-testid="select-language"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="ms">Bahasa Melayu</SelectItem></SelectContent></Select></Field>
            <Field label="AI mode · AI 模式"><Select value={f.aiMode} onValueChange={(v) => set('aiMode', v)}><SelectTrigger data-testid="select-ai-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="rules">Rules engine (explainable demo)</SelectItem><SelectItem value="openai">OpenAI (Replit managed)</SelectItem></SelectContent></Select></Field>
            <Alert><AlertDescription className="text-xs"><Tag tone={ws.aiAvailable ? 'green' : 'orange'}>{ws.aiAvailable ? 'Managed configuration present (not connectivity verified)' : 'Managed configuration unavailable'}</Tag> <span className="ml-1">{ws.aiMessage}</span> Enable OpenAI through the official Replit AI Integrations flow, not a private API key. Selecting managed OpenAI sends minimal synthetic context through Replit when a new draft is generated; runtime model usage is billed to Replit credits. Failures retain rules_fallback, never a private-key fallback. Existing approved versions are not rewritten.{ws.settings.aiMode === 'gemini' && ' Saved Gemini mode is retired; choose and save Rules or managed OpenAI explicitly. Historical records keep their original provider labels.'}</AlertDescription></Alert>
          </Panel>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={save.isPending} data-testid="button-save-settings"><Save className="mr-1 h-4 w-4" />{save.isPending ? 'Saving...' : 'Save settings'}</Button>
        <Button variant="outline" onClick={() => setF(init(ws.settings))} data-testid="button-revert">Revert changes</Button>
        <Button variant="destructive" className="ml-auto" onClick={() => setAsk(true)} disabled={reset.isPending} data-testid="button-reset-demo"><RotateCcw className="mr-1 h-4 w-4" />Reset demo data</Button>
      </div>
      <AlertDialog open={ask} onOpenChange={setAsk}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Reset all demo data?</AlertDialogTitle><AlertDialogDescription>Invoices, customers and settings return to the synthetic seed. Audit logs, approvals, executions and old plan versions are kept; active plans are superseded.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={doReset} data-testid="button-confirm-reset">Reset</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function Settings() {
  return (
    <Page title="Settings" zh="系统设置" description="Cash parameters, rule thresholds, weights, language and AI mode">
      {(ws) => <SettingsForm key={JSON.stringify(ws.settings)} ws={ws} />}
    </Page>
  );
}
