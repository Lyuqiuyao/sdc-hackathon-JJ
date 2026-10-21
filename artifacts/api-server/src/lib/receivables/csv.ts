import { randomUUID } from "node:crypto";
import type { Customer, ImportInput, ImportResult, Invoice } from "@workspace/api-zod";
import { type DemoState, BusinessError, now } from "./model";

// RFC4180-compatible comma/quote/newline parser; malformed quotes are rejected.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false, closedQuote = false;
  text = text.replace(/^\uFEFF/, "");
  for (let n = 0; n < text.length; n++) {
    const c = text[n]!;
    if (quoted) {
      if (c === '"' && text[n + 1] === '"') { value += '"'; n++; }
      else if (c === '"') { quoted = false; closedQuote = true; }
      else value += c;
    } else if (c === '"' && value === "" && !closedQuote) {
      quoted = true;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(value.trim()); value = ""; closedQuote = false;
      if (c !== ",") {
        if (c === "\r" && text[n + 1] === "\n") n++;
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else {
      if (closedQuote && c.trim()) throw new BusinessError("Malformed CSV: unexpected characters after a closing quote.");
      if (c === '"') throw new BusinessError("Malformed CSV: quotes must wrap an entire field.");
      value += c;
    }
  }
  if (quoted) throw new BusinessError("Malformed CSV: unclosed quoted field.");
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function money(text: string, name: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error(`${name} must be a non-negative MYR amount with at most two decimal places`);
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0")));
  if (!Number.isSafeInteger(cents) || cents > 100000000000) throw new Error(`${name} is too large`);
  return cents;
}
function date(text: string, name: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) ||
    new Date(text).toISOString().slice(0, 10) !== text) throw new Error(`${name} must be a valid YYYY-MM-DD date`);
  return text;
}

export function importCsv(state: DemoState, input: ImportInput): ImportResult {
  if (input.demoDataConfirmed !== true) return {
    imported: 0, errors: ["Explicit synthetic demo data confirmation is required."], warnings: [],
    message: "Nothing imported. This sandbox accepts user-declared synthetic demo data only; provenance is not verified.",
  };
  const rows = parseCsv(input.csv);
  const headers = rows.shift()?.map(h => h.toLowerCase()) ?? [];
  const errors: string[] = [], warnings: string[] = [];
  const required = ["customer_name", "invoice_date", "due_date", "total_amount"];
  if (!headers.includes("invoice_number") && !headers.includes("invoice_id")) errors.push("Missing invoice_number (or invoice_id) column.");
  required.forEach(h => { if (!headers.includes(h)) errors.push(`Missing ${h} column.`); });
  if (new Set(headers).size !== headers.length) errors.push("Duplicate CSV headers are not allowed.");
  if (!rows.length) errors.push("CSV contains no invoice rows.");
  if (rows.length > 1000) errors.push("Maximum 1,000 rows per import.");
  if (errors.length) return { imported: 0, errors, warnings, message: "Nothing imported. Correct the CSV and retry." };
  const stagedInvoices: Invoice[] = [], stagedCustomers: Customer[] = [];
  const seen = new Set(state.invoices.flatMap(i => [i.id, i.number]));
  rows.forEach((values, n) => {
    const label = `Row ${n + 2}`;
    try {
      if (values.length !== headers.length) throw new Error("column count does not match the header");
      const r: Record<string, string> = Object.fromEntries(headers.map((h, k) => [h, values[k] ?? ""]));
      const number = r.invoice_number || r.invoice_id || "";
      if (!number || number.length > 100) throw new Error("invoice number required (maximum 100 characters)");
      if (seen.has(number)) throw new Error(`duplicate invoice ${number}`);
      if (!r.customer_name || r.customer_name.length > 200) throw new Error("customer_name required (maximum 200 characters)");
      if (r.currency && r.currency.toUpperCase() !== "MYR") throw new Error("only MYR is accepted; convert or exclude this invoice before import");
      const totalCents = money(r.total_amount!, "total_amount");
      if (totalCents === 0) throw new Error("total_amount must be greater than zero");
      const estimatedFields: string[] = [];
      let paidCents: number;
      if (r.amount_paid) paidCents = money(r.amount_paid, "amount_paid");
      else if (r.outstanding_amount) {
        paidCents = totalCents - money(r.outstanding_amount, "outstanding_amount");
        estimatedFields.push("amount_paid derived from total_amount minus outstanding_amount");
      } else {
        paidCents = 0; estimatedFields.push("amount_paid estimated as 0 (Demo import rule)");
      }
      if (paidCents < 0 || paidCents > totalCents) throw new Error("amount_paid must be between 0 and total_amount");
      if (r.outstanding_amount && money(r.outstanding_amount, "outstanding_amount") !== totalCents - paidCents) throw new Error("outstanding_amount does not equal total_amount minus amount_paid");
      if (!r.outstanding_amount) estimatedFields.push("outstanding_amount calculated as total_amount minus amount_paid");
      const invoiceDate = date(r.invoice_date!, "invoice_date"), dueDate = date(r.due_date!, "due_date");
      if (invoiceDate > dueDate) throw new Error("invoice_date must not be after due_date");
      const importance = r.business_importance || "Medium";
      if (!["High", "Medium", "Low"].includes(importance)) throw new Error("business_importance must be High, Medium or Low");
      if (r.payment_status && !["Upcoming", "Due soon", "Overdue", "Partial", "Paid", "Cancelled"].includes(r.payment_status)) throw new Error("unknown payment_status");
      if (r.payment_status === "Paid" && paidCents !== totalCents) throw new Error("Paid status requires full payment");
      const lateFeeBps = r.late_fee_rate ? money(r.late_fee_rate, "late_fee_rate (annual percentage, e.g. 12.00)") : 1200;
      if (lateFeeBps > 10000) throw new Error("annual late_fee_rate must not exceed 100%");
      if (!r.late_fee_rate) estimatedFields.push("late_fee_rate estimated as 12.00% per year (Demo rule)");
      let customer = [...state.customers, ...stagedCustomers].find(c => c.name.toLowerCase() === r.customer_name!.toLowerCase());
      if (!customer) {
        customer = { id: `CUS-${randomUUID().slice(0, 8)}`, name: r.customer_name, industry: r.industry || "Unknown",
          importance: importance as Customer["importance"], esgRating: "Uncertified", outstandingCents: 0, overdueCents: 0,
          earliestDue: "", risk: "Low", paymentHistory: "Unknown — imported record; no verified historical payment evidence." };
        stagedCustomers.push(customer);
      }
      if (r.esg_rating) warnings.push(`${label}: imported ESG rating is not independently reviewed and is NOT used for scoring. Missing verified ESG remains neutral.`);
      if (estimatedFields.length) warnings.push(`${label}: ${estimatedFields.join("; ")}.`);
      stagedInvoices.push({
        id: `INV-${randomUUID().slice(0, 8)}`, number, customerId: customer.id, customerName: customer.name,
        invoiceDate, dueDate, totalCents, paidCents, outstandingCents: r.payment_status === "Cancelled" ? 0 : totalCents - paidCents,
        currency: "MYR", lateFeeBps, status: r.payment_status === "Cancelled" ? "Cancelled" : "Upcoming",
        daysOverdue: 0, importance: customer.importance, esgRating: "Uncertified",
        source: `User-declared synthetic/demo CSV (provenance unverified): ${input.filename}`,
        importedAt: now(), estimatedFields,
      });
      seen.add(number);
    } catch (error) { errors.push(`${label}: ${(error as Error).message}`); }
  });
  if (errors.length) return { imported: 0, errors, warnings, message: "Nothing imported. Validation is atomic; fix all listed rows." };
  state.customers.push(...stagedCustomers);
  state.invoices.push(...stagedInvoices);
  return { imported: stagedInvoices.length, errors, warnings, message: `${stagedInvoices.length} MYR invoices imported as user-declared synthetic/demo data. Provenance is NOT independently verified; estimates are labelled per invoice.` };
}
