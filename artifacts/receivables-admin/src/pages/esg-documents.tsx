import { useState } from 'react';
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

export default function EsgDocuments() {
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
    <Page title="ESG Documents" zh="ESG 凭证查看" description="Read-only view of certificate records and reviewer conclusions">
      {(ws) => {
        const rows = ws.documents.filter((d) => (status === 'all' || d.status === status) && (!q.trim() || (d.customerName + d.type + d.number).toLowerCase().includes(q.trim().toLowerCase())));
        return (
          <div className="space-y-4">
            <Alert><AlertDescription>Administrators view records only; certification review is performed elsewhere. Documents are clearly marked demo records, not official certificates. ESG is a supporting scheduling factor and never overrides amounts or due dates.</AlertDescription></Alert>
            {err && <Alert variant="destructive" data-testid="alert-doc-error"><AlertDescription>{err}</AlertDescription></Alert>}
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
