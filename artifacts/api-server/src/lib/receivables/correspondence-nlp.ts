import { z } from "zod/v4";
import type { CorrespondenceExtraction } from "@workspace/api-zod";

// The generated API validators use Zod 3. Keep the provider's JSON-schema
// conversion on a local Zod 4 schema, as in the existing advice provider.
const quote = z.string().min(1).max(500);
export const correspondenceFieldsSchema = z.object({
  overdueDays: z.number().int().min(0).max(36500).nullable(),
  debtAmountCents: z.number().int().min(0).max(9_000_000_000_000).nullable(),
  currency: z.enum(["MYR", "USD", "SGD", "CNY", "EUR", "GBP"]).nullable(),
  overdueEvidence: quote.nullable(), amountEvidence: quote.nullable(),
  followUpItems: z.array(quote).max(10), customerPromises: z.array(quote).max(10), disputes: z.array(quote).max(10),
}).strict();
export const MAX_NLP_INPUT_CHARS = 60_000;

function wireSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wireSchema);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["$schema", "minLength", "maxLength", "minItems", "maxItems"].includes(key))
    .map(([key, child]) => [key, wireSchema(child)]));
  return value;
}
export const correspondenceJsonSchema = wireSchema(z.toJSONSchema(correspondenceFieldsSchema)) as Record<string, unknown>;

type Currency = CorrespondenceExtraction["currency"];
type DaysMatch = { value: number; quote: string };
type AmountMatch = { value: number; currency: Currency; quote: string };
const currencyOf = (code?: string): Currency => code ? (code.toUpperCase() === "RM" ? "MYR" : code.toUpperCase()) as Currency : null;
const negated = (text: string, index: number) =>
  /(?:\bnot\s+|\bno longer\s+|\bnever\s+|\u4e0d\u662f|\u5e76\u975e|\u6ca1\u6709)\s*$/i.test(text.slice(Math.max(0, index - 30), index));

function daysMatches(text: string): DaysMatch[] {
  const patterns = [
    /\b(?:overdue|past due)\s*(?:(?:by|for|is|:)\s*)?(\d{1,5})(?!\d)\s*days?\b/gi,
    /\b(\d{1,5})\s*days?\s*(?:overdue|past due)\b/gi,
    /\u903e\u671f\s*(\d{1,5})(?!\d)\s*\u5929/gu,
    /\b(?:lewat|tertunggak)\s*(\d{1,5})\s*hari\b/gi,
  ];
  const rows: DaysMatch[] = [];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) {
    const value = Number(match[1]);
    if (value <= 36500 && !negated(text, match.index)) rows.push({ value, quote: match[0] });
    if (rows.length >= 50) return rows;
  }
  return rows;
}

function amountMatches(text: string): AmountMatch[] {
  const number = String.raw`((?:\d{1,3}(?:,\d{3}){1,4}|\d{1,14})(?:\.\d{1,2})?)(?!\d|[.,]\d)`;
  const currency = "(MYR|RM|USD|SGD|CNY|EUR|GBP)";
  const debt = String.raw`(?:outstanding(?:\s+(?:amount|balance))?|amount\s+due|debt(?:\s+amount)?|owe[ds]?|balance\s+due|tunggakan|baki\s+tertunggak|\u6b20\u6b3e(?:\u91d1\u989d)?|\u5c1a\u6b20|\u672a\u4ed8(?:\u91d1\u989d)?)`;
  const pattern = new RegExp(`${debt}\\s*(?:(?:is|of|:|=|\\u4e3a|\\u662f|\\uff1a)\\s*)?(?:${currency}\\s*)?${number}(?:\\s*${currency}\\b)?`, "giu");
  const rows: AmountMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    if (negated(text, match.index)) continue;
    // Reject abbreviations, unsupported currencies and decimal-comma formats.
    if (/^\s*(?:[kKmM]\b|million\b|thousand\b|\u4e07|\u5343|AUD\b|JPY\b|IDR\b)/i.test(text.slice(match.index + match[0].length))) continue;
    const [whole, fraction = ""] = match[2]!.replaceAll(",", "").split(".");
    const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
    if (cents > 9_000_000_000_000n) continue;
    if (match[1] && match[3] && currencyOf(match[1]) !== currencyOf(match[3])) continue;
    rows.push({ value: Number(cents), currency: currencyOf(match[1] ?? match[3]), quote: match[0].slice(0, 500) });
    if (rows.length >= 50) break;
  }
  return rows;
}

function quotedLines(text: string, pattern: RegExp): string[] {
  const rows: string[] = [];
  for (const line of text.matchAll(/[^\r\n]+/g)) {
    const hit = pattern.exec(line[0]);
    if (!hit) continue;
    const start = Math.max(0, hit.index - 120);
    const quote = line[0].slice(start, start + 500).trim();
    if (quote && !rows.includes(quote)) rows.push(quote);
    if (rows.length === 10) break;
  }
  return rows;
}

export function extractCorrespondenceRules(text: string): { fields: CorrespondenceExtraction; warnings: string[] } {
  const days = daysMatches(text), amounts = amountMatches(text);
  const distinctDays = new Set(days.map(row => row.value));
  const distinctAmounts = new Set(amounts.map(row => `${row.value}:${row.currency}`));
  const day = distinctDays.size === 1 && days.length < 50 ? days[0] : undefined;
  const amount = distinctAmounts.size === 1 && amounts.length < 50 ? amounts[0] : undefined;
  const warnings = ["Unverified text extraction only. Quotes are not proof of customer agreement, debt or invoice facts. Rules return at most 10 source excerpts per list.",
    "Keyword matches may include negated statements or a different speaker. Verify the original context and speaker manually."];
  if (distinctDays.size > 1) warnings.push("Multiple overdue-day values found; manual review required.");
  if (distinctAmounts.size > 1) warnings.push("Multiple debt amounts or currencies found; manual review required.");
  if (days.length === 50 || amounts.length === 50) warnings.push("Numeric candidate limit reached; values require manual review.");
  return { fields: {
    overdueDays: day?.value ?? null, debtAmountCents: amount?.value ?? null,
    currency: amount?.currency ?? null, overdueEvidence: day?.quote ?? null, amountEvidence: amount?.quote ?? null,
    followUpItems: quotedLines(text, /follow[\s-]*up|please\s+(?:send|confirm|check|call|provide)|pending|susulan|\u5f85\u8ddf\u8fdb|\u8bf7\u786e\u8ba4|\u9700\u8981\u8ddf\u8fdb/i),
    customerPromises: quotedLines(text, /\b(?:promise|commit|we will|i will|agree to pay|berjanji|akan bayar)\b|\u627f\u8bfa|\u4fdd\u8bc1|\u7b54\u5e94/i),
    disputes: quotedLines(text, /\b(?:dispute|disagree|incorrect|wrong invoice|pertikaian|tidak setuju)\b|\u4e89\u8bae|\u5f02\u8bae|\u91d1\u989d\u4e0d\u5bf9/i),
  }, warnings };
}

export function validateCorrespondenceExtraction(raw: string, source: string): CorrespondenceExtraction {
  if (raw.length > 40_000 || raw.includes("\ufffd")) throw new Error("Invalid extraction response");
  const fields = correspondenceFieldsSchema.parse(JSON.parse(raw));
  for (const quote of [...fields.followUpItems, ...fields.customerPromises, ...fields.disputes]) {
    if (!quote.trim() || !source.includes(quote)) throw new Error("Ungrounded source quote");
  }
  if (fields.overdueDays === null) {
    if (fields.overdueEvidence !== null) throw new Error("Unexpected overdue evidence");
  } else if (!fields.overdueEvidence || !source.includes(fields.overdueEvidence) ||
    !daysMatches(source).some(row => row.value === fields.overdueDays && fields.overdueEvidence!.includes(row.quote))) {
    throw new Error("Unsupported overdue value");
  }
  if (fields.debtAmountCents === null) {
    if (fields.amountEvidence !== null || fields.currency !== null) throw new Error("Unexpected amount evidence");
  } else if (!fields.amountEvidence || !source.includes(fields.amountEvidence) ||
    !amountMatches(source).some(row => row.value === fields.debtAmountCents && row.currency === fields.currency && fields.amountEvidence!.includes(row.quote))) {
    throw new Error("Unsupported debt amount");
  }
  return fields;
}
