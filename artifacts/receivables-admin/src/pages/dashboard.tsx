import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import {
  Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { AlertTriangle, ArrowUpRight, Banknote, CalendarClock, Clock, FileStack, Gauge, Wallet } from 'lucide-react';
import { Page, Panel, Tag, EmptyState } from '@/components/kit';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { fmtDate, fmtDateTime, rm, rmShort } from '@/lib/arus';

const STATUS_COLOR: Record<string, string> = {
  Upcoming: 'hsl(214 45% 55%)', 'Due soon': 'hsl(38 92% 52%)', Overdue: 'hsl(0 70% 50%)',
  Partial: 'hsl(24 92% 54%)', Paid: 'hsl(152 55% 36%)', Cancelled: 'hsl(214 12% 65%)',
};

function Kpi({ href, icon, label, value, sub, accent, id }: {
  href: string; icon: ReactNode; label: string; value: string; sub: string; accent?: string; id: string;
}) {
  return (
    <Link href={href} data-testid={`kpi-${id}`} className="group block rounded-lg border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      <div className="flex items-start justify-between">
        <span className={cn('rounded-md p-1.5', accent ?? 'bg-accent text-accent-foreground')}>{icon}</span>
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
      </div>
      <div className="mt-3 text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-xl font-semibold tracking-tight" data-testid={`value-${id}`}>{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>
    </Link>
  );
}

export default function Dashboard() {
  const [range, setRange] = useState<7 | 30>(30);
  return (
    <Page title="Dashboard" description="Live receivables and cash-flow position from current data">
      {(ws) => {
        const d = ws.dashboard;
        const r = d.risk;
        const riskCls = r.level === 'High' ? 'bg-red-100 text-red-700' : r.level === 'Medium' ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700';
        const pending = ws.plans.filter((p) => p.status === 'Pending');
        const trend = d.trend.slice(0, range + 1).map((t) => ({
          date: t.date.slice(5), Due: t.dueCents / 100, Cumulative: t.cumulativeCents / 100, 'Projected cash': t.projectedCashCents / 100,
        }));
        const groups = d.statusGroups.filter((g) => g.count > 0);
        const recent = ws.auditLogs.slice(0, 8);
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Tag tone="orange">Demo Admin</Tag>
              <span>{ws.source}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Kpi id="cash" href="/settings" icon={<Wallet className="h-4 w-4" />} label="Available cash" value={rm(d.cashCents)} sub="Editable in Settings" />
              <Kpi id="outstanding-count" href="/receivables" icon={<FileStack className="h-4 w-4" />} label="Open invoices" value={String(d.outstandingCount)} sub="Excl. paid and cancelled" />
              <Kpi id="outstanding-total" href="/receivables" icon={<Banknote className="h-4 w-4" />} label="Outstanding" value={rm(d.outstandingCents)} sub={`Paid to date ${rm(d.paidCents)}`} />
              <Kpi id="overdue-count" href="/receivables" accent="bg-red-100 text-red-700" icon={<AlertTriangle className="h-4 w-4" />} label="Overdue" value={String(d.overdueCount)} sub={rm(d.overdueCents)} />
              <Kpi id="due7-count" href="/receivables" accent="bg-orange-100 text-orange-700" icon={<CalendarClock className="h-4 w-4" />} label="Due in 7 days" value={String(d.due7Count)} sub={rm(d.due7Cents)} />
              <Kpi id="risk" href="/risk-triggers" accent={riskCls} icon={<Gauge className="h-4 w-4" />} label="Cash-flow risk" value={r.level} sub={`Gap ${rm(r.gapCents)}`} />
            </div>

            <div className="grid gap-4 xl:grid-cols-5">
              <Panel title="Receivables overview" className="xl:col-span-2" actions={<Button asChild size="sm" variant="outline"><Link href="/receivables" data-testid="link-view-receivables">View invoices</Link></Button>}>
                {groups.length === 0 ? <EmptyState title="No invoices yet" hint="Upload a CSV in Receivables." /> : (
                  <div className="grid items-center gap-2 sm:grid-cols-2">
                    <div className="h-48">
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie data={groups.map((g) => ({ name: g.status, value: g.amountCents / 100 }))} dataKey="value" innerRadius={42} outerRadius={76} paddingAngle={2}>
                            {groups.map((g) => <Cell key={g.status} fill={STATUS_COLOR[g.status] ?? 'hsl(214 30% 62%)'} />)}
                          </Pie>
                          <Tooltip formatter={(v: number) => `MYR ${v.toLocaleString('en-MY')}`} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="space-y-1.5 text-xs" data-testid="list-status-groups">
                      {d.statusGroups.map((g) => (
                        <li key={g.status} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_COLOR[g.status] }} />{g.status} <span className="text-muted-foreground">({g.count})</span></span>
                          <span className="font-mono">{rmShort(g.amountCents)}</span>
                        </li>
                      ))}
                      <li className="pt-1 text-[10px] text-muted-foreground">All amounts MYR. Paid shows amount received; other groups show outstanding.</li>
                    </ul>
                  </div>
                )}
              </Panel>

              <Panel title="Cash-flow risk" className="xl:col-span-3" actions={
                <div className="flex rounded-md border p-0.5 text-xs">
                  {([7, 30] as const).map((n) => (
                    <button key={n} onClick={() => setRange(n)} data-testid={`button-range-${n}`} className={cn('rounded px-2 py-1', range === n ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{n}d</button>
                  ))}
                </div>}>
                <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  {[['Cash now', d.cashCents], ['Expected collection', r.expectedCollectionCents], ['Projected cash', r.projectedCashCents], ['Gap vs minimum', r.gapCents]].map(([k, v]) => (
                    <div key={k as string} className="rounded-md bg-muted/60 p-2">
                      <div className="text-muted-foreground">{k}</div>
                      <div className="font-mono font-semibold">{rm(v as number)}</div>
                    </div>
                  ))}
                </div>
                <div className="h-52">
                  <ResponsiveContainer>
                    <ComposedChart data={trend}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={range === 7 ? 0 : 3} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => rmShort(v * 100)} width={42} />
                      <Tooltip formatter={(v: number) => `MYR ${v.toLocaleString('en-MY')}`} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <ReferenceLine y={ws.settings.minimumCashCents / 100} stroke="hsl(0 70% 50%)" strokeDasharray="4 3" label={{ value: 'Min cash', fontSize: 10, fill: 'hsl(0 70% 50%)' }} />
                      <Bar dataKey="Due" fill="hsl(24 92% 54%)" radius={[2, 2, 0, 0]} />
                      <Line dataKey="Cumulative" stroke="hsl(220 62% 28%)" dot={false} strokeWidth={2} />
                      <Line dataKey="Projected cash" stroke="hsl(152 55% 36%)" dot={false} strokeWidth={2} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap items-start gap-2">
                  <Tag>{r.level}</Tag>
                  <ul className="flex-1 list-disc pl-4 text-xs text-muted-foreground" data-testid="list-risk-reasons">
                    {r.reasons.length ? r.reasons.map((x, i) => <li key={i}>{x}</li>) : <li>No trigger reasons.</li>}
                  </ul>
                </div>
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="To-do" bodyClass="space-y-2">
                {[
                  { href: '/approvals', n: pending.length, t: 'AI collection plans awaiting approval', s: 'Nothing is executed until a human approves.', tone: 'orange' as const, id: 'approvals' },
                  { href: '/risk-triggers', n: r.level === 'Low' ? 0 : 1, t: `Cash-flow risk alert (${r.level})`, s: r.reasons[0] ?? 'No active alert', tone: r.level === 'High' ? ('red' as const) : ('orange' as const), id: 'risk' },
                  { href: '/esg-documents', n: d.esgUpdates, t: 'ESG documents needing attention', s: 'Pending, expired or information requested', tone: 'orange' as const, id: 'esg' },
                ].map((i) => (
                  <Link key={i.id} href={i.href} data-testid={`todo-${i.id}`} className="flex items-center justify-between gap-3 rounded-md border p-3 hover:bg-accent">
                    <div><div className="text-sm font-medium">{i.t}</div><div className="text-xs text-muted-foreground">{i.s}</div></div>
                    <Tag tone={i.n > 0 ? i.tone : 'green'}>{i.n > 0 ? i.n : 'Clear'}</Tag>
                  </Link>
                ))}
              </Panel>
              <Panel title="Recent activity" actions={<Button asChild size="sm" variant="ghost"><Link href="/audit-logs">All logs</Link></Button>}>
                {recent.length === 0 ? <EmptyState title="No activity yet" hint="Run a risk check to begin." /> : (
                  <ul className="divide-y" data-testid="list-recent-activity">
                    {recent.map((a) => (
                      <li key={a.id} className="flex items-start gap-2.5 py-2">
                        <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1"><div className="truncate text-sm">{a.content}</div><div className="text-[11px] text-muted-foreground">{a.type} · {a.actor} · {fmtDateTime(a.createdAt)}</div></div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
            <p className="text-[11px] text-muted-foreground">As of {fmtDate(ws.today)}. Synthetic demo data in MYR; no real notices are sent and no payment records are changed.</p>
          </div>
        );
      }}
    </Page>
  );
}
