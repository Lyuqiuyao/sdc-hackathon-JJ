import { useState } from 'react';
import { Page, Panel, Tag, EmptyState, KV } from '@/components/kit';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fmtDate, rm } from '@/lib/arus';

export default function Customers() {
  const [q, setQ] = useState('');
  const [imp, setImp] = useState('all');
  const [esg, setEsg] = useState('all');
  const [sort, setSort] = useState('outstanding');
  const [selId, setSelId] = useState<string | null>(null);
  return (
    <Page title="Customers" zh="客户管理" description="Customer profiles, linked invoices and risk explanations">
      {(ws) => {
        const rows = ws.customers
          .filter((c) => (!q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()) || c.id.toLowerCase().includes(q.trim().toLowerCase())) && (imp === 'all' || c.importance === imp) && (esg === 'all' || c.esgRating === esg))
          .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'overdue' ? b.overdueCents - a.overdueCents : sort === 'earliest' ? (a.earliestDue || '9').localeCompare(b.earliestDue || '9') : b.outstandingCents - a.outstandingCents);
        const sel = ws.customers.find((c) => c.id === selId);
        const invs = sel ? ws.invoices.filter((i) => i.customerId === sel.id) : [];
        const docs = sel ? ws.documents.filter((d) => d.customerId === sel.id) : [];
        const comms = sel ? ws.plans.flatMap((p) => p.tasks.filter((t) => t.customerId === sel.id).map((t) => ({ ...t, v: p.version, ps: p.status }))) : [];
        const execs = sel ? ws.executions.filter((e) => e.customerName === sel.name) : [];
        return (
          <div className="space-y-4">
            <Panel bodyClass="grid gap-3 sm:grid-cols-4">
              <Input placeholder="Search name or ID" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-search" />
              <Select value={imp} onValueChange={setImp}><SelectTrigger data-testid="select-importance"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All importance</SelectItem>{['High', 'Medium', 'Low'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
              <Select value={esg} onValueChange={setEsg}><SelectTrigger data-testid="select-esg"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All ESG ratings</SelectItem>{['A', 'B', 'C', 'Pending', 'Uncertified'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
              <Select value={sort} onValueChange={setSort}><SelectTrigger data-testid="select-sort"><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="outstanding">Sort: outstanding</SelectItem><SelectItem value="overdue">Sort: overdue</SelectItem><SelectItem value="earliest">Sort: earliest due</SelectItem><SelectItem value="name">Sort: name</SelectItem></SelectContent></Select>
            </Panel>
            <Panel title={`${rows.length} customers`} zh="Synthetic demo customers" bodyClass="p-0">
              {rows.length === 0 ? <div className="p-4"><EmptyState title="No customers match" hint="Change the search or filters." /></div> : (
                <div className="overflow-x-auto"><Table>
                  <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Customer</TableHead><TableHead>Industry</TableHead><TableHead>Importance</TableHead><TableHead>ESG</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead className="text-right">Overdue</TableHead><TableHead>Earliest due</TableHead><TableHead>Risk</TableHead></TableRow></TableHeader>
                  <TableBody>{rows.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelId(c.id)} data-testid={`row-customer-${c.id}`}>
                      <TableCell className="font-mono text-xs">{c.id}</TableCell><TableCell className="font-medium">{c.name}</TableCell><TableCell>{c.industry}</TableCell>
                      <TableCell><Tag>{c.importance}</Tag></TableCell><TableCell><Tag>{c.esgRating || 'Uncertified'}</Tag></TableCell>
                      <TableCell className="text-right font-mono text-xs">{rm(c.outstandingCents)}</TableCell><TableCell className="text-right font-mono text-xs">{rm(c.overdueCents)}</TableCell>
                      <TableCell className="whitespace-nowrap">{c.earliestDue ? fmtDate(c.earliestDue) : '-'}</TableCell><TableCell><Tag>{c.risk}</Tag></TableCell>
                    </TableRow>))}</TableBody>
                </Table></div>
              )}
            </Panel>
            <Sheet open={!!sel} onOpenChange={(o) => !o && setSelId(null)}>
              <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
                {sel && (
                  <div className="space-y-5" data-testid="detail-customer">
                    <SheetHeader><SheetTitle>{sel.name}</SheetTitle><SheetDescription>{sel.id} · {sel.industry}</SheetDescription></SheetHeader>
                    <section><h3 className="mb-1 text-sm font-semibold">Profile</h3><dl>
                      <KV k="Business importance" v={<Tag>{sel.importance}</Tag>} /><KV k="ESG rating" v={<Tag>{sel.esgRating || 'Uncertified'}</Tag>} />
                      <KV k="Outstanding" v={rm(sel.outstandingCents)} /><KV k="Overdue" v={rm(sel.overdueCents)} /><KV k="Earliest due" v={sel.earliestDue ? fmtDate(sel.earliestDue) : '-'} /><KV k="Risk status" v={<Tag>{sel.risk}</Tag>} /></dl></section>
                    <section><h3 className="mb-1 text-sm font-semibold">Risk explanation · 风险解释</h3>
                      <p className="rounded-md bg-muted/60 p-3 text-sm">{sel.risk} risk is based on overdue amounts and payment history, not on ESG status alone. Missing ESG certification is treated as neutral.</p></section>
                    <section><h3 className="mb-1 text-sm font-semibold">Payment history · 历史付款</h3><p className="text-sm text-muted-foreground" data-testid="text-payment-history">{sel.paymentHistory || 'Unknown'}</p></section>
                    <section><h3 className="mb-1 text-sm font-semibold">Linked invoices ({invs.length})</h3>
                      {invs.length === 0 ? <EmptyState title="No linked invoices" /> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>No.</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                        <TableBody>{invs.map((i) => <TableRow key={i.id}><TableCell className="font-mono text-xs">{i.number}</TableCell><TableCell>{fmtDate(i.dueDate)}</TableCell><TableCell className="text-right font-mono text-xs">{rm(i.outstandingCents)}</TableCell><TableCell><Tag>{i.status}</Tag></TableCell></TableRow>)}</TableBody></Table></div>}</section>
                    <section><h3 className="mb-1 text-sm font-semibold">ESG documents ({docs.length})</h3>
                      {docs.length === 0 ? <p className="text-sm text-muted-foreground">No documents on record (Uncertified).</p> : <ul className="space-y-1 text-sm">{docs.map((d) => <li key={d.id} className="flex items-center justify-between"><span>{d.type} · {d.number}</span><Tag>{d.status}</Tag></li>)}</ul>}</section>
                    <section><h3 className="mb-1 text-sm font-semibold">Collection communications · 催收沟通记录</h3>
                      {comms.length === 0 && execs.length === 0 ? <p className="text-sm text-muted-foreground">No communications recorded. Notices are drafts only; nothing is sent.</p> : (
                        <ul className="space-y-2 text-sm">
                          {comms.map((t) => <li key={t.id} className="rounded-md border p-2"><div className="flex justify-between"><span>{t.invoiceNumber} · {t.method}</span><Tag>{t.ps}</Tag></div><div className="text-xs text-muted-foreground">Plan v{t.v} · {fmtDate(t.scheduledAt)} · draft notice</div></li>)}
                          {execs.map((e) => <li key={e.id} className="rounded-md border border-dashed p-2 text-xs"><b>Simulated:</b> {e.invoiceNumber} · {e.noticeStatus} · {fmtDate(e.executedAt)}</li>)}
                        </ul>)}</section>
                  </div>
                )}
              </SheetContent>
            </Sheet>
          </div>
        );
      }}
    </Page>
  );
}
