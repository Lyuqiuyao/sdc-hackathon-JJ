import { type ReactNode, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Bell, BarChart3, FileText, LayoutDashboard, LogOut, Menu, ReceiptText, ScrollText, Settings, ShieldAlert,
  ShieldCheck, Sparkles, UserCheck, Users, PlayCircle, X,
} from 'lucide-react';
import { useHealthCheck } from '@workspace/api-client-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tag } from '@/components/kit';
import { cn } from '@/lib/utils';
import { fmtDate, useWs } from '@/lib/arus';

const NAV = [
  { href: '/', en: 'Dashboard', icon: LayoutDashboard },
  { href: '/receivables', en: 'Receivables', icon: ReceiptText },
  { href: '/customers', en: 'Customers', icon: Users },
  { href: '/sedg-information', en: 'SEDG Information', icon: ShieldCheck },
  { href: '/risk-triggers', en: 'Risk Triggers', icon: ShieldAlert },
  { href: '/ai-planner', en: 'AI Collection Planner', icon: Sparkles },
  { href: '/approvals', en: 'Approval Center', icon: UserCheck },
  { href: '/execution-results', en: 'Execution Results', icon: PlayCircle },
  { href: '/audit-logs', en: 'Audit Logs', icon: ScrollText },
  { href: '/settings', en: 'Settings', icon: Settings },
];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-4 py-5" data-testid="link-brand">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-orange-500 text-white">
        <BarChart3 className="h-4.5 w-4.5" />
      </div>
      <div className="leading-tight">
        <div className="text-lg font-semibold tracking-wide text-white">Arus</div>
        <div className="text-[10px] uppercase tracking-widest text-sidebar-foreground/60">Cash flow ·</div>
      </div>
    </Link>
  );
}

function SideNav({ onNav }: { onNav?: () => void }) {
  const [loc, setLoc] = useLocation();
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <Brand />
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2">
        {NAV.map((n) => {
          const active = n.href === '/' ? loc === '/' : loc.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNav}
              data-testid={`nav-${n.href === '/' ? 'dashboard' : n.href.slice(1)}`}
              className={cn(
                'group flex items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm transition-colors',
                active
                  ? 'border-orange-500 bg-sidebar-accent text-white'
                  : 'border-transparent hover:bg-sidebar-accent/60 hover:text-white',
              )}
            >
              <n.icon className="h-4 w-4 shrink-0" />
              <span className="leading-tight">
                <span className="block">{n.en}</span>
              </span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-md p-2 text-left hover:bg-sidebar-accent/60" data-testid="button-user-menu">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-white">DA</span>
              <span className="leading-tight">
                <span className="block text-sm text-white">Demo Admin</span>
                <span className="block text-[10px] text-sidebar-foreground/60">Finance admin · demo only</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-52">
            <DropdownMenuItem onClick={() => { setLoc('/settings'); onNav?.(); }} data-testid="menu-settings">
              <Settings className="mr-2 h-4 w-4" /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLoc('/login')} data-testid="menu-logout">
              <LogOut className="mr-2 h-4 w-4" /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function Notifications() {
  const { data } = useWs();
  const d = data?.dashboard;
  const pending = data?.plans.filter((p) => p.status === 'Pending') ?? [];
  const sedgCustomers = new Set(data?.sedgSubmissions?.map(submission => submission.customerId)).size;
  const items = d
    ? [
        { href: '/approvals', label: `${pending.length} plan(s) awaiting approval`, sub: pending.map((p) => `v${p.version}`).join(', ') || 'None', n: pending.length, tone: 'orange' as const },
        { href: '/risk-triggers', label: `Cash-flow risk: ${d.risk.level}`, sub: d.risk.reasons[0] ?? 'No trigger reasons', n: d.risk.level === 'Low' ? 0 : 1, tone: d.risk.level === 'High' ? ('red' as const) : ('orange' as const) },
        { href: '/receivables', label: `${d.overdueCount} overdue invoice(s)`, sub: 'Review in Receivables', n: d.overdueCount, tone: 'red' as const },
        { href: '/sedg-information', label: `${sedgCustomers} customer SEDG submission(s) available`, sub: 'Reference for manual ordering; no SEDG approval required', n: sedgCustomers, tone: 'blue' as const },
      ]
    : [];
  const total = items.reduce((a, b) => a + (b.n > 0 ? 1 : 0), 0);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="relative rounded-md border bg-card p-2 hover:bg-accent" aria-label="Notifications" data-testid="button-notifications">
          <Bell className="h-4 w-4" />
          {total > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">{total}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-sm font-semibold">Pending overview ·</div>
        {items.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">Workspace not loaded yet.</p>
        ) : (
          items.map((i) => (
            <Link key={i.href} href={i.href} className="flex items-start justify-between gap-2 border-b px-3 py-2.5 last:border-0 hover:bg-accent" data-testid={`notif-${i.href.slice(1)}`}>
              <span>
                <span className="block text-sm font-medium">{i.label}</span>
                <span className="block text-xs text-muted-foreground">{i.sub}</span>
              </span>
              {i.n > 0 ? <Tag tone={i.tone}>Action</Tag> : <Tag tone="green">Clear</Tag>}
            </Link>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { data } = useWs();
  const health = useHealthCheck();
  const ok = health.data?.status && !health.isError;
  return (
    <div className="flex min-h-[100dvh]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 md:block">
        <SideNav />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">
            <SideNav onNav={() => setOpen(false)} />
          </div>
          <button className="absolute right-3 top-3 text-white" onClick={() => setOpen(false)} aria-label="Close menu"><X /></button>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col md:pl-64">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b bg-card/95 px-4 py-2.5 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <button className="rounded-md border p-2 md:hidden" onClick={() => setOpen(true)} aria-label="Open menu" data-testid="button-open-menu"><Menu className="h-4 w-4" /></button>
            <Tag tone="orange" className="hidden sm:inline-flex"><FileText className="h-3 w-3" /> Synthetic demo data · MYR</Tag>
            {data && <span className="hidden text-xs text-muted-foreground lg:inline">Workspace date {fmtDate(data.today)}</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="status-system">
              <span className={cn('h-2 w-2 rounded-full', ok ? 'bg-emerald-500' : health.isLoading ? 'bg-slate-400' : 'bg-red-500')} />
              {ok ? 'API online' : health.isLoading ? 'Checking' : 'API unreachable'}
            </span>
            <Notifications />
            <span className="hidden text-right leading-tight sm:block">
              <span className="block text-sm font-medium" data-testid="text-admin">Demo Admin</span>
              <span className="block text-[10px] text-muted-foreground">Demo entry, not secure auth</span>
            </span>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
