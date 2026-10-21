import { type ReactNode } from 'react';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { type Tone, toneOf, usePageMeta, useWs } from '@/lib/arus';
import type { Workspace } from '@workspace/api-client-react';

const toneCls: Record<Tone, string> = {
  red: 'bg-red-50 text-red-700 ring-red-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  blue: 'bg-blue-50 text-blue-800 ring-blue-200',
  gray: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export function Tag({ children, tone, className }: { children: ReactNode; tone?: Tone; className?: string }) {
  const t = tone ?? toneOf(String(children));
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        toneCls[t],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Panel({
  title, zh, actions, children, className, bodyClass, ...rest
}: {
  title?: string; zh?: string; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string;
  'data-testid'?: string;
}) {
  return (
    <section className={cn('rounded-lg border bg-card shadow-sm', className)} {...rest}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {zh && <p className="text-[11px] text-muted-foreground">{zh}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('p-4', bodyClass)}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/40 px-6 py-10 text-center">
      <Inbox className="h-7 w-7 text-muted-foreground" />
      <p className="text-sm font-semibold">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-8 text-center"
      data-testid="state-error"
    >
      <AlertTriangle className="h-8 w-8 text-red-600" />
      <p className="text-sm font-semibold text-red-800">Could not load workspace</p>
      <p className="text-xs text-red-700">{message}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} data-testid="button-retry">
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
        </Button>
      )}
    </div>
  );
}

export function LoadingGrid() {
  return (
    <div className="space-y-4" data-testid="state-loading">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-64" />
      <Skeleton className="h-48" />
    </div>
  );
}

export function Page({
  title, description, actions, children,
}: {
  title: string; description: string; actions?: ReactNode;
  children: (ws: Workspace) => ReactNode;
}) {
  usePageMeta(title, description);
  const q = useWs();
  return (
    <div className="mx-auto w-full max-w-[1500px] p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl" data-testid="text-page-title">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {q.isLoading ? (
        <LoadingGrid />
      ) : q.isError || !q.data ? (
        <ErrorState message={(q.error as { data?: { error?: string }; message?: string })?.data?.error || (q.error as Error)?.message || 'Unknown error'} onRetry={() => q.refetch()} />
      ) : (
        children(q.data)
      )}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-dashed py-2 last:border-0 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="text-sm font-medium sm:text-right">{v}</dd>
    </div>
  );
}

export const DEMO_NOTE = 'Synthetic demo data. Not real company financial records.';
