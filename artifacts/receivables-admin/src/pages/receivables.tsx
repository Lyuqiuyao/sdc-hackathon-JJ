import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, FileDown, Upload } from 'lucide-react';
import { useImportInvoices, type Invoice } from '@workspace/api-client-react';
import { Page, Panel, Tag, EmptyState, KV } from '@/components/kit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { download, errMsg, fmtfix, rm, toCsv, useRefresh, fmtDate, fmtDateTime } from '@/lib/arus';

const STATUSES = ['Upcoming', 'Due soon', 'Overdue', 'Partial', 'Paid', 'Cancelled'];
type SortKey = 'outstandingCents' | 'dueDate' | 'daysOverdue';

const TEMPLATE = [
  ['invoice_number', 'customer_name', 'invoice_date', 'due_date', 'total_amount', 'amount_paid', 'late_fee_rate', 'currency', 'business_importance', 'payment_status'],
  ['INV-DEMO-0001', 'Sample Customer Sdn Bhd', '2025-01-05', '2025-02-04', '12500.00', '0.00', '12', 'MYR', 'Medium', 'Upcoming'],
];

export default function Receivables() {
  const { toast } = useToast();
  const refresh = useRefresh();
  const imp = useImportInvoices();
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [sort, setSort] = useState<SortKey>('dueDate');
  const [dir, setDir] = useState<1 | -1>(1);
  const [sel, setSel] = useState<Invoice | null>(null);
  const [result, setResult] = useState<{ imported: number; errors: string[]; warnings: string[]; message: string; file: string } | null>(null);
  const [upErr, setUpErr] = useState('');

  const upload = async (f?: File) => {
    if (!f) return;
    setUpErr('');
    try {
      const csv = await f.text();
      const r = await imp.mutateAsync({ data: { csv, filename: f.name } });
      setResult({ ...r, file: f.name });
      await refresh();
      toast({ title: `Import finished: ${r.imported} invoice(s)`, description: r.message });
    } catch (e) {
      setUpErr(errMsg(e));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Page
      title="Receivables" zh="应收账款管理" description="Search, filter, import and export invoices"
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => download('arus-invoice-template.csv', toCsv(TEMPLATE))} data-testid="button-template"><FileDown className="mr-1 h-4 w-4" />Template</Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => upload(e.target.files?.[0])} data-testid="input-csv" />
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={imp.isPending} data-testid="button-upload-csv"><Upload className="mr-1 h-4 w-4" />{imp.isPending ? 'Importing...' : 'Upload CSV'}</Button>
        </>
      }
    >
      {(ws) => {
        const minC = min ? Math.round(Number(min) * 100) : null;
        const maxC = max ? Math.round(Number(max) * 100) : null;
        const rows = ws.invoices
          .filter((i) => {
            const t = q.trim().toLowerCase();
            if (t && !i.customerName.toLowerCase().includes(t) && !i.number.toLowerCase().includes(t)) return false;
            if (status !== 'all' && i.status !== status) return false;
            if (from && i.dueDate.slice(0, 10) < from) return false;
            if (to && i.dueDate.slice(0, 10) > to) return false;
            if (minC !== null && i.outstandingCents < minC) return false;
            if (maxC !== null && i.outstandingCents > maxC) return false;
            return true;
          })
          .sort((a, b) => {
            const x = a[sort], y = b[sort];
            return (x < y ? -1 : x > y ? 1 : 0) * dir;
          });
        const exportCsv = () => {
          const head = ['invoice_number', 'customer_name', 'invoice_date', 'due_date', 'total_amount_MYR', 'amount_paid_MYR', 'outstanding_MYR', 'late_fee_rate_percent_per_year', 'status', 'days_overdue', 'business_importance', 'esg_rating', 'source', 'imported_at'];
          download('arus-receivables-filtered.csv', toCsv([head, ...rows.map((i) => [i.number, i.customerName, i.invoiceDate, i.dueDate, fmtfix(i.totalCents), fmtfix(i.paidCents), fmtfix(i.outstandingCents), (i.lateFeeBps / 100).toFixed(2), i.status, i.daysOverdue, i.importance, i.esgRating, i.source, i.importedAt])]));
        };
        const th = (label: string, k: SortKey, right?: boolean) => (
          <TableHead className={right ? 'text-right' : ''}>
            <button className="inline-flex items-center gap-1 font-medium hover:text-foreground" onClick={() => (sort === k ? setDir((d) => (d === 1 ? -1 : 1)) : (setSort(k), setDir(1)))} data-testid={`sort-${k}`}>
              {label}{sort === k && (dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
            </button>
          </TableHead>
        );
        return (
          <div className="space-y-4">
            {upErr && <Alert variant="destructive" data-testid="alert-import-error"><AlertTitle>Import failed</AlertTitle><AlertDescription>{upErr}</AlertDescription></Alert>}
            {result && (
              <Alert data-testid="alert-import-result">
                <AlertTitle>{result.file}: {result.imported} imported · {result.message}</AlertTitle>
                <AlertDescription>
                  {result.errors.length > 0 && <div className="mt-1"><b className="text-red-700">{result.errors.length} error(s)</b><ul className="max-h-32 list-disc overflow-auto pl-4">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
                  {result.warnings.length > 0 && <div className="mt-1"><b className="text-orange-700">{result.warnings.length} warning(s)</b><ul className="max-h-32 list-disc overflow-auto pl-4">{result.warnings.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
                  <p className="mt-1 text-xs">Only MYR rows are accepted. Missing paid or outstanding fields are estimated and flagged on the invoice.</p>
                </AlertDescription>
              </Alert>
            )}
            <Panel bodyClass="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <Input className="lg:col-span-2" placeholder="Search customer or invoice number" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-search" />
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger data-testid="select-status"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All statuses</SelectItem>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Due from" title="Due from" data-testid="input-due-from" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Due to" title="Due to" data-testid="input-due-to" />
              <div className="flex gap-2">
                <Input type="number" min={0} placeholder="Min MYR" value={min} onChange={(e) => setMin(e.target.value)} data-testid="input-min" />
                <Input type="number" min={0} placeholder="Max MYR" value={max} onChange={(e) => setMax(e.target.value)} data-testid="input-max" />
              </div>
            </Panel>
            <Panel title={`${rows.length} of ${ws.invoices.length} invoices`} zh="Amounts are outstanding balances in MYR" actions={<Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length} data-testid="button-export-csv"><Download className="mr-1 h-4 w-4" />Export filtered CSV</Button>} bodyClass="p-0">
              {rows.length === 0 ? <div className="p-4"><EmptyState title="No invoices match" hint="Adjust filters or upload a CSV." action={<Button size="sm" variant="outline" onClick={() => { setQ(''); setStatus('all'); setFrom(''); setTo(''); setMin(''); setMax(''); }}>Clear filters</Button>} /></div> : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Invoice</TableHead><TableHead>Customer</TableHead>{th('Due', 'dueDate')}
                      <TableHead className="text-right">Total</TableHead>{th('Outstanding', 'outstandingCents', true)}{th('Overdue', 'daysOverdue', true)}
                      <TableHead>Status</TableHead><TableHead>Importance</TableHead><TableHead>ESG</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {rows.map((i) => (
                        <TableRow key={i.id} className="cursor-pointer" onClick={() => setSel(i)} data-testid={`row-invoice-${i.id}`}>
                          <TableCell className="font-mono text-xs">{i.number}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{i.customerName}</TableCell>
                          <TableCell className="whitespace-nowrap">{fmtDate(i.dueDate)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{rm(i.totalCents)}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-semibold">{rm(i.outstandingCents)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{i.daysOverdue > 0 ? `${i.daysOverdue}d` : '-'}</TableCell>
                          <TableCell><Tag>{i.status}</Tag></TableCell>
                          <TableCell><Tag>{i.importance}</Tag></TableCell>
                          <TableCell><Tag>{i.esgRating}</Tag></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Panel>
            <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
              <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
                {sel && (
                  <>
                    <DialogHeader><DialogTitle>Invoice {sel.number}</DialogTitle><DialogDescription>{sel.customerName} · synthetic demo record</DialogDescription></DialogHeader>
                    <dl data-testid="detail-invoice">
                      <KV k="Invoice ID" v={<span className="font-mono text-xs">{sel.id}</span>} />
                      <KV k="Customer ID" v={sel.customerId} />
                      <KV k="Invoice date" v={fmtDate(sel.invoiceDate)} />
                      <KV k="Due date" v={fmtDate(sel.dueDate)} />
                      <KV k="Total amount" v={rm(sel.totalCents)} />
                      <KV k="Amount paid" v={rm(sel.paidCents)} />
                      <KV k="Outstanding" v={rm(sel.outstandingCents)} />
                      <KV k="Currency" v={sel.currency} />
                      <KV k="Late fee rate (annual)" v={`${(sel.lateFeeBps / 100).toFixed(2)}% per year`} />
                      <KV k="Status" v={<Tag>{sel.status}</Tag>} />
                      <KV k="Days overdue" v={sel.daysOverdue} />
                      <KV k="Business importance" v={<Tag>{sel.importance}</Tag>} />
                      <KV k="ESG rating" v={<Tag>{sel.esgRating}</Tag>} />
                      <KV k="Data source" v={sel.source} />
                      <KV k="Imported at" v={fmtDateTime(sel.importedAt)} />
                      <KV k="Estimated fields" v={sel.estimatedFields.length ? sel.estimatedFields.join(', ') : 'None'} />
                    </dl>
                    {sel.estimatedFields.length > 0 && <p className="text-xs text-orange-700">Fields listed above were estimated by a demo rule, not taken from source data.</p>}
                  </>
                )}
              </DialogContent>
            </Dialog>
          </div>
        );
      }}
    </Page>
  );
}
