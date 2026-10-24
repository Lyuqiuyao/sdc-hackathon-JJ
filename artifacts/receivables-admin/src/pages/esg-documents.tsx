import { useState } from 'react';
import { Link } from 'wouter';
import { Eye } from 'lucide-react';
import { useViewDocument, type DocumentView } from '@workspace/api-client-react';
import { Page, Panel, Tag, EmptyState } from '@/components/kit';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errMsg, fmtDate, useRefresh } from '@/lib/arus';
import { SedgReference } from '@/components/sedg-reference';

export default function SedgInformation() {
  const view = useViewDocument();
  const refresh = useRefresh();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const open = async (id: string) => {
    setErr(''); setBusy(id);
    try { setDoc(await view.mutateAsync({ id })); await refresh(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(''); }
  };
  return (
    <Page title="SEDG Information" description="Customer declarations for manual ordering and collection decisions after 2D/3D pre-ranking">
      {(ws) => {
        const rows = ws.documents.filter((d) => (status === 'all' || d.status === status) && (!q.trim() || (d.customerName + d.type + d.number).toLowerCase().includes(q.trim().toLowerCase())));
        return (
          <div className="space-y-4">
            <Alert><AlertDescription>First generate the separate 3D queue for customers with an existing ESG rating and the 2D queue for customers without one. Then consult SEDG and company information to adjust the final order in the Approval Center and choose Collect now or Negotiable extension for every customer. There is no separate SEDG approval or rejection, and no ESG assessment here. SEDG does not automatically change scores or ratings.</AlertDescription></Alert>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><Link href="/ai-planner">View 2D / 3D pre-ranking</Link></Button>
              <Button asChild><Link href="/approvals">Adjust final order and collection decisions</Link></Button>
            </div>
            <SedgReference ws={ws} />
            {err && <Alert variant="destructive" data-testid="alert-doc-error"><AlertDescription>{err}</AlertDescription></Alert>}
            <details className="space-y-3 rounded-lg border p-4" data-testid="section-historical-esg">
              <summary className="cursor-pointer text-sm font-semibold">Historical ESG documents (read-only)</summary>
              <p className="text-xs text-muted-foreground">Recorded statuses and conclusions below are historical synthetic data, not approval tasks for this administrator. They are not SEDG decisions or verified certifications.</p>
            <Panel bodyClass="grid gap-3 sm:grid-cols-3">
              <Input placeholder="Search customer, type or number" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-search" />
              <Select value={status} onValueChange={setStatus}><SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{['Approved', 'Pending', 'Rejected', 'Expired', 'Needs information'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            </Panel>
            <Panel title={`${rows.length} documents`} bodyClass="p-0">
              {rows.length === 0 ? <div className="p-4"><EmptyState title="No documents match" /></div> : (
                <div className="overflow-x-auto"><Table>
                  <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Type</TableHead><TableHead>Number</TableHead><TableHead>Uploaded</TableHead><TableHead>Valid until</TableHead><TableHead>Status</TableHead><TableHead>Rating</TableHead><TableHead>Conclusion</TableHead><TableHead>Reason</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>{rows.map((d) => (
                    <TableRow key={d.id} data-testid={`row-doc-${d.id}`}>
                      <TableCell className="font-medium">{d.customerName}</TableCell><TableCell>{d.type}</TableCell><TableCell className="font-mono text-xs">{d.number}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtDate(d.uploadedAt)}</TableCell><TableCell className="whitespace-nowrap">{fmtDate(d.validUntil)}</TableCell>
                      <TableCell><Tag>{d.status}</Tag></TableCell><TableCell><Tag>{d.rating}</Tag></TableCell>
                      <TableCell className="max-w-[180px] text-xs">{d.conclusion}</TableCell><TableCell className="max-w-[220px] text-xs text-muted-foreground">{d.reason}<div className="mt-0.5 text-[10px]">Source: {d.source}</div></TableCell>
                      <TableCell><Button size="sm" variant="outline" disabled={busy === d.id} onClick={() => open(d.id)} data-testid={`button-view-doc-${d.id}`}><Eye className="mr-1 h-3.5 w-3.5" />View</Button></TableCell>
                    </TableRow>))}</TableBody>
                </Table></div>
              )}
            </Panel>
            </details>
            <Dialog open={!!doc} onOpenChange={(o) => !o && setDoc(null)}>
              <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
                {doc && <>
                  <DialogHeader><DialogTitle>{doc.title}</DialogTitle><DialogDescription>Demo record, not an official certificate</DialogDescription></DialogHeader>
                  <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs" data-testid="text-doc-content">{doc.content}</pre>
                </>}
              </DialogContent>
            </Dialog>
          </div>
        );
      }}
    </Page>
  );
}
