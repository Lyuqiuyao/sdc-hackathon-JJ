import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetWorkspaceQueryKey, useGetWorkspace } from '@workspace/api-client-react';

export const rm = (cents: number | undefined | null) =>
  'MYR ' +
  ((cents ?? 0) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const rmShort = (cents: number) => {
  const v = cents / 100;
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(0) + 'k';
  return v.toFixed(0);
};

export const fmtDate = (iso?: string) => {
  if (!iso) return '-';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const fmtDateTime = (iso?: string) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

export const errMsg = (e: unknown): string => {
  const x = e as { data?: { error?: string } | null; message?: string };
  return x?.data?.error || x?.message || 'Unexpected error';
};

export type Tone = 'red' | 'orange' | 'green' | 'blue' | 'gray';

export const toneOf = (s: string): Tone => {
  const k = s.toLowerCase();
  if (['overdue', 'high', 'rejected', 'expired', 'c', 'failed'].includes(k)) return 'red';
  if (['due soon', 'medium', 'partial', 'pending', 'deferred', 'needs information'].includes(k)) return 'orange';
  if (['paid', 'low', 'approved', 'executed', 'a', 'normal'].includes(k)) return 'green';
  if (['upcoming', 'b'].includes(k)) return 'blue';
  return 'gray';
};

export const toCsv = (rows: (string | number)[][]) =>
  rows
    .map((r) => r.map((c) => {
      const value = String(c ?? '');
      const safe = typeof c === 'string' && /^[=+@\-\t\r]/.test(value) ? "'" + value : value;
      return `"${safe.replace(/"/g, '""')}"`;
    }).join(','))
    .join('\r\n');

export const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export function useWs() {
  return useGetWorkspace({ query: { queryKey: getGetWorkspaceQueryKey(), refetchInterval: 15000 } });
}

export function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
}

export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    document.title = `${title} | Arus`;
    let m = document.querySelector('meta[name="description"]');
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute('name', 'description');
      document.head.appendChild(m);
    }
    m.setAttribute('content', description);
  }, [title, description]);
}

export const METHODS = [
  'Friendly reminder',
  'Due date reminder',
  'Overdue collection',
  'Installment negotiation',
  'Extension negotiation',
  'Priority human follow-up',
];

export const METHOD_ZH: Record<string, string> = {
  'Friendly reminder': '友好付款提醒',
  'Due date reminder': '到期提醒',
  'Overdue collection': '逾期催收',
  'Installment negotiation': '分期付款协商',
  'Extension negotiation': '延期付款协商',
  'Priority human follow-up': '人工重点跟进',
};

export const fmtfix = (c: number) => (c / 100).toFixed(2);
