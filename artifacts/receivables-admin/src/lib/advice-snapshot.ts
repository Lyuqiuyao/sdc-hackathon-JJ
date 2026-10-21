import type { AdviceSnapshot, AuditLog } from '@workspace/api-client-react';
import { safeHistorical } from '@/lib/arus';

export type Rec = Record<string, unknown>;
export const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export type ParsedContent = { ok: true; data: Rec } | { ok: false };

export function parseSnapshotContent(json: unknown): ParsedContent {
  if (typeof json !== 'string') return { ok: false };
  try {
    const v: unknown = JSON.parse(safeHistorical(json));
    return isRec(v) ? { ok: true, data: v } : { ok: false };
  } catch { return { ok: false }; }
}

export type AiOutcome = { label: string; tone: 'green' | 'orange' | 'red' | 'gray' | 'blue'; detail: string };

/** AI outcome from the log's "after" JSON; generic log result is never AI success. */
export function deriveAiOutcome(log: Pick<AuditLog, 'type' | 'after'>): AiOutcome | null {
  if (log.type !== 'AI generation') return null;
  const p = parseSnapshotContent(log.after);
  if (!p.ok) return { label: 'AI outcome unrecorded', tone: 'gray', detail: 'After value is not parseable JSON.' };
  const s = (k: string) => (typeof p.data[k] === 'string' ? (p.data[k] as string) : '');
  const mode = s('providerMode'), status = s('status'), reason = s('reasonCode');
  if (mode === 'openai' && status === 'success') return { label: 'Validated AI suggestion applied to draft', tone: 'green', detail: reason };
  if (mode === 'rules_fallback' || status === 'fallback') return { label: 'Rules fallback', tone: 'orange', detail: reason };
  if (mode === 'gemini') return { label: 'Historical Gemini', tone: 'gray', detail: reason };
  return { label: 'AI outcome unrecorded', tone: 'gray', detail: reason };
}

export function snapshotOutcome(s: AdviceSnapshot): AiOutcome {
  const r = s.reasonCode;
  if (s.status === 'discarded') return { label: 'Discarded', tone: 'red', detail: r };
  if (s.status === 'expired') return { label: 'Expired', tone: 'red', detail: r };
  if (s.status === 'rejected') return { label: 'Rejected', tone: 'red', detail: r };
  if (s.status === 'started') return { label: 'Started, not completed', tone: 'blue', detail: r };
  if (s.source === 'metadata_only') return { label: 'Metadata only', tone: 'gray', detail: 'No advice content was recorded for this event.' };
  if (s.status === 'approved' || s.status === 'deferred') return { label: `Human decision: ${s.status}`, tone: 'blue', detail: r };
  if (s.source === 'human' || s.status === 'edited') return { label: 'Human version', tone: 'blue', detail: r };
  if (s.status === 'fallback' || s.provider === 'rules_fallback' || s.source === 'rules_template')
    return { label: 'Rules fallback', tone: 'orange', detail: r };
  if (s.status === 'applied' && s.provider === 'openai' && s.validation === 'passed')
    return { label: 'Validated suggestion applied', tone: 'green', detail: r };
  return { label: `${s.status}`, tone: 'gray', detail: r };
}

export function rawRetention(s: AdviceSnapshot, c: ParsedContent): 'not_retained' | 'unrecorded' {
  if (s.rawResponseRetained === false) return 'not_retained';
  if (s.rawResponseRetained !== undefined) return 'unrecorded';
  if (c.ok && isRec(c.data.rawModel) && c.data.rawModel.retained === false) return 'not_retained';
  return 'unrecorded';
}

export function findApproval<A extends { id: string; planId: string; version: number }>(
  approvals: A[] | undefined, s: Pick<AdviceSnapshot, 'approvalId' | 'planId' | 'planVersion'>): A | undefined {
  if (!s.approvalId) return undefined;
  return (approvals ?? []).find((a) => a.id === s.approvalId && a.planId === s.planId && a.version === s.planVersion);
}

export const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function snapshotList(value: unknown, planId: string): AdviceSnapshot[] | null {
  if (!Array.isArray(value)) return null;
  const strings = ['id','workspaceId','planId','riskEventId','attemptId','createdAt','provider','source','status','reasonCode','contentPolicy','validation','contentJson'];
  if (value.some(v => !isRec(v) || strings.some(k => typeof v[k] !== 'string') ||
    v.planId !== planId || !Number.isInteger(v.planVersion) || !Number.isFinite(Date.parse(v.createdAt as string)))) return null;
  // Append order resolves equal timestamps: terminal event must precede started.
  return [...value].reverse().sort((a,b) => b.createdAt.localeCompare(a.createdAt)) as AdviceSnapshot[];
}
