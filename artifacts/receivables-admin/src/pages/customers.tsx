import { useState } from 'react';
import { useSearchParams } from 'wouter';
import { Page, Panel, Tag, EmptyState } from '@/components/kit';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CompanyFolder } from '@/components/company-folder';
import { fmtDate, rm } from '@/lib/arus';

export default function Customers() {
  const [q, setQ] = useState('');
  const [imp, setImp] = useState('all');
  const [esg, setEsg] = useState('all');
  const [sort, setSort] = useState('outstanding');
  const [params, setParams] = useSearchParams();
  const selId = params.get('customer');
  const setSelId = (id: string | null) => setParams((prev) => { const n = new URLSearchParams(prev); if (id) n.set('customer', id); else n.delete('customer'); return n; }, { replace: true });
  return (
    <Page title="Customers" description="Company folders: profile, SEDG declarations, invoices and communications">
      {(ws) => {
        const rows = ws.customers
          .filter((c) => (!q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()) || c.id.toLowerCase().includes(q.trim().toLowerCase())) && (imp === 'all' || c.importance === imp) && (esg === 'all' || c.esgRating === esg))
          .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'overdue' ? b.overdueCents - a.overdueCents : sort === 'earliest' ? (a.earliestDue || '9').localeCompare(b.earliestDue || '9') : b.outstandingCents - a.outstandingCents);
        const sel = ws.customers.find((c) => c.id === selId);
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
                  <div className="space-y-4">
                    <SheetHeader><SheetTitle>{sel.name}</SheetTitle><SheetDescription>Company folder · {sel.id} · {sel.industry}</SheetDescription></SheetHeader>
                    <CompanyFolder customer={sel} ws={ws} />
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
