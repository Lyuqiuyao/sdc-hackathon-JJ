import { useState } from 'react';
import { Page, Panel, Tag, EmptyState } from '@/components/kit';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { KV } from '@/components/kit';
import { fmtDateTime, safeHistorical } from '@/lib/arus';
import { PlanSnapshotsPanel } from '@/components/advice-snapshots';
import { deriveAiOutcome } from '@/lib/advice-snapshot';
import type { AuditLog } from '@workspace/api-client-react';

export default function AuditLogs() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('all');
  const [actor, setActor] = useState('');
  const [cust, setCust] = useState('');
  const [inv, setInv] = useState('');
  const [sel, setSel] = useState<AuditLog | null>(null);
  return (
    <Page title="Audit Logs" description="Append-only record of every action. Logs cannot be edited or deleted here.">
      {(ws) => {
        const types = Array.from(new Set(ws.auditLogs.map((l) => l.type))).sort();
        const rows = [...ws.auditLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter((l) => {
          const d = l.createdAt.slice(0, 10);
          if (from && d < from) return false; if (to && d > to) return false;
          if (type !== 'all' && l.type !== type) return false;
          if (actor && !l.actor.toLowerCase().includes(actor.toLowerCase())) return false;
          const rel = l.related.toLowerCase();
          if (cust && !(rel.includes(cust.toLowerCase()) || l.content.toLowerCase().includes(cust.toLowerCase()))) return false;
          if (inv && !(rel.includes(inv.toLowerCase()) || l.content.toLowerCase().includes(inv.toLowerCase()))) return false;
          return true;
        });
        return (
          <div className="space-y-4">
            <Panel bodyClass="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="From date" data-testid="input-from" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="To date" data-testid="input-to" />
              <Select value={type} onValueChange={setType}><SelectTrigger data-testid="select-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem>{types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
              <Input placeholder="Actor" value={actor} onChange={(e) => setActor(e.target.value)} data-testid="input-actor" />
              <Input placeholder="Customer" value={cust} onChange={(e) => setCust(e.target.value)} data-testid="input-customer" />
              <Input placeholder="Invoice number" value={inv} onChange={(e) => setInv(e.target.value)} data-testid="input-invoice" />
            </Panel>
            <Panel title={`${rows.length} of ${ws.auditLogs.length} entries`} bodyClass="p-0">
              {rows.length === 0 ? <div className="p-4"><EmptyState title="No log entries match" action={<Button size="sm" variant="outline" onClick={() => { setFrom(''); setTo(''); setType('all'); setActor(''); setCust(''); setInv(''); }}>Clear filters</Button>} /></div> : (
                <div className="overflow-x-auto"><Table>
                  <TableHeader><TableRow><TableHead>Log ID</TableHead><TableHead>Time</TableHead><TableHead>Type</TableHead><TableHead>Actor</TableHead><TableHead>Related</TableHead><TableHead>Content</TableHead><TableHead>Plan</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
                  <TableBody>{rows.map((l) => (
                    <TableRow key={l.id} className="cursor-pointer" onClick={() => setSel(l)} data-testid={`row-log-${l.id}`}>
                      <TableCell className="font-mono text-[11px]">{l.id.slice(-8)}</TableCell><TableCell className="whitespace-nowrap text-xs">{fmtDateTime(l.createdAt)}</TableCell>
                      <TableCell><Tag tone="blue">{l.type}</Tag></TableCell><TableCell className="text-xs">{l.actor}</TableCell><TableCell className="max-w-[160px] truncate text-xs">{l.related || '-'}</TableCell>
                      <TableCell className="max-w-[300px] truncate text-xs">{safeHistorical(l.content)}</TableCell><TableCell className="text-xs">{l.planVersion || '-'}</TableCell><TableCell><Tag>{l.result}</Tag>{(() => { const a = deriveAiOutcome(l); return a ? <div className="mt-1" data-testid={`badge-ai-outcome-${l.id}`}><Tag tone={a.tone}>{a.label}</Tag></div> : null; })()}</TableCell>
                    </TableRow>))}</TableBody>
                </Table></div>)}
            </Panel>
            <PlanSnapshotsPanel plans={ws.plans} approvals={ws.approvals} />
            <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
              <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
                {sel && <>
                  <DialogHeader><DialogTitle>{sel.type}</DialogTitle><DialogDescription>Read-only log entry {sel.id}</DialogDescription></DialogHeader>
                  <dl data-testid="detail-log"><KV k="Time" v={fmtDateTime(sel.createdAt)} /><KV k="Actor" v={sel.actor} /><KV k="Related" v={sel.related || '-'} /><KV k="Content" v={safeHistorical(sel.content)} /><KV k="Plan version" v={sel.planVersion || '-'} /><KV k="Result (log action only)" v={sel.result} />{(() => { const a = deriveAiOutcome(sel); return a ? <KV k="AI outcome" v={<span data-testid="detail-ai-outcome">{a.label}{a.detail ? ` (${a.detail})` : ''}</span>} /> : null; })()}</dl>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div><div className="mb-1 text-xs font-semibold">Before</div><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[11px]">{safeHistorical(sel.before) || '-'}</pre></div>
                    <div><div className="mb-1 text-xs font-semibold">After</div><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[11px]">{safeHistorical(sel.after) || '-'}</pre></div>
                  </div>
                </>}
              </DialogContent>
            </Dialog>
          </div>
        );
      }}
    </Page>
  );
}
