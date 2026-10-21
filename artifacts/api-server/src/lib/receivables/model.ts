import type {
  Customer, Invoice, ESGDocument, RiskEvent, CollectionPlan, ApprovalRecord,
  ExecutionRecord, AuditLog, SystemSetting,
  AdviceSnapshot,
  SedgSubmission,
} from "@workspace/api-zod";
import type { GenerationLease } from "./ai-coordination";

export const DEMO_WORKSPACE_ID = "synthetic-demo-admin";

export interface DemoState {
  schemaVersion: 1;
  customers: Customer[];
  invoices: Invoice[];
  documents: ESGDocument[];
  riskEvents: RiskEvent[];
  plans: CollectionPlan[];
  approvals: ApprovalRecord[];
  executions: ExecutionRecord[];
  auditLogs: AuditLog[];
  settings: SystemSetting;
  workspaceId?: string;
  aiLeases?: Record<string, GenerationLease>;
  adviceSnapshots?: AdviceSnapshot[];
  sedgSubmissions?: SedgSubmission[];
}

export class BusinessError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const now = () => new Date().toISOString();
export const today = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
export const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
export function myr(cents: number) {
  return `MYR ${(cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
// All critical amount multiplication is performed using integer arithmetic.
export function ratio(cents: number, numerator: number, denominator: number) {
  return Number((BigInt(cents) * BigInt(numerator) + BigInt(Math.floor(denominator / 2))) / BigInt(denominator));
}
export const sumCents = (rows: Invoice[]) => rows.reduce((n, i) => n + i.outstandingCents, 0);
export const collectible = (i: Invoice) => i.status !== "Cancelled" && i.status !== "Paid" && i.outstandingCents > 0;
