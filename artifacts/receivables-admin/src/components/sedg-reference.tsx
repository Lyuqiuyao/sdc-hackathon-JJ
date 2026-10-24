import { useState } from 'react';
import { Link } from 'wouter';
import type { SedgSubmission, Workspace } from '@workspace/api-client-react';
import { EmptyState, Panel, Tag } from '@/components/kit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fmtDateTime } from '@/lib/arus';

const fields = [
  ['repaymentWillingness', 'Repayment willingness'],
  ['cashFlowAssessment', 'Cash-flow self-assessment'],
  ['cooperationYears', 'Years of cooperation'],
  ['overdueCount', 'Overdue occurrences (self-declared)'],
  ['businessAssessment', 'Business self-assessment'],
  ['environmental', 'Environmental'],
  ['social', 'Social'],
  ['governance', 'Governance'],
  ['sourceReference', 'Source reference'],
] as const;

function SubmissionDetails({ submission }: { submission: SedgSubmission }) {
  return <details className="mt-2 text-xs">
    <summary className="cursor-pointer text-primary">View latest SEDG</summary>
    <dl className="mt-2 space-y-2">
      {fields.map(([key, label]) => <div key={key}>
        <dt className="font-semibold">{label}</dt>
        <dd className="whitespace-pre-wrap break-words text-muted-foreground">{submission[key] ?? 'Not provided'}</dd>
      </div>)}
      <div><dt className="font-semibold">Recorded by / source</dt>
        <dd className="break-words text-muted-foreground">{submission.actor} · {submission.source}</dd></div>
    </dl>
  </details>;
}

export function SedgReference({ ws }: { ws: Workspace }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const latest = new Map<string, SedgSubmission>();
  for (const submission of ws.sedgSubmissions ?? []) {
    const previous = latest.get(submission.customerId);
    if (!previous || submission.createdAt > previous.createdAt) latest.set(submission.customerId, submission);
  }
  const rows = ws.customers.filter(customer => {
    const hasEsg = ['A', 'B', 'C'].includes(customer.esgRating);
    const text = `${customer.name} ${customer.id}`.toLowerCase();
    return text.includes(search.trim().toLowerCase()) &&
      (filter === 'all' || (filter === 'without-esg' && !hasEsg) ||
        (filter === 'submitted' && latest.has(customer.id)) ||
        (filter === 'missing' && !latest.has(customer.id)));
  });
  return <Panel title="Customer SEDG information" bodyClass="space-y-4" data-testid="panel-sedg-reference">
    <div className="flex flex-wrap gap-3">
      <Input className="sm:max-w-sm" aria-label="Search SEDG customers" placeholder="Search customer or company ID"
        value={search} onChange={event => setSearch(event.target.value)} data-testid="input-sedg-search" />
      <Select value={filter} onValueChange={setFilter}>
        <SelectTrigger className="sm:w-64" aria-label="Filter SEDG customers" data-testid="select-sedg-filter"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All customers</SelectItem>
          <SelectItem value="without-esg">Without ESG rating (2D)</SelectItem>
          <SelectItem value="submitted">SEDG submitted</SelectItem>
          <SelectItem value="missing">No SEDG submitted</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <p className="text-xs text-muted-foreground">SEDG is reference material, not an approval queue. Missing submissions are neutral.
      Existing ESG ratings are imported inputs, not assessed here. Queue labels describe the planning route, not a generated ranking.</p>
    {rows.length === 0 ? <EmptyState title="No customers match" /> : <div className="overflow-x-auto"><Table>
      <TableHeader><TableRow>
        <TableHead>Customer</TableHead><TableHead>Existing ESG</TableHead><TableHead>Planning route</TableHead>
        <TableHead>Latest SEDG</TableHead><TableHead>Submitted</TableHead><TableHead>Company folder</TableHead>
      </TableRow></TableHeader>
      <TableBody>{rows.map(customer => {
        const submission = latest.get(customer.id);
        const hasEsg = ['A', 'B', 'C'].includes(customer.esgRating);
        return <TableRow key={customer.id} data-testid={`row-sedg-customer-${customer.id}`}>
          <TableCell><div className="font-medium">{customer.name}</div><div className="font-mono text-xs text-muted-foreground">{customer.id}</div></TableCell>
          <TableCell><Tag>{hasEsg ? customer.esgRating : 'Unknown'}</Tag></TableCell>
          <TableCell className="text-xs">{hasEsg ? '3D: overdue / amount / ESG' : '2D: overdue / amount'}</TableCell>
          <TableCell className="min-w-64 max-w-sm">
            {submission ? <><Tag tone="gray">{submission.status}</Tag><SubmissionDetails submission={submission} /></>
              : <span className="text-xs text-muted-foreground">Not submitted — neutral</span>}
          </TableCell>
          <TableCell className="whitespace-nowrap text-xs">{submission ? fmtDateTime(submission.createdAt) : 'Not provided'}</TableCell>
          <TableCell><Button asChild size="sm" variant="outline"><Link href={`/customers?customer=${encodeURIComponent(customer.id)}`}
            data-testid={`link-sedg-folder-${customer.id}`}>Open company folder</Link></Button></TableCell>
        </TableRow>;
      })}</TableBody>
    </Table></div>}
  </Panel>;
}
