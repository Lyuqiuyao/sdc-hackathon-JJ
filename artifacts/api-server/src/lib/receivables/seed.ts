import type { Customer, Invoice, ESGDocument } from "@workspace/api-zod";
import { type DemoState, addDays, today, now } from "./model";
import { calculateRisk } from "./compute";
import { buildPlan } from "./planner";

export function seedState(): DemoState {
  const names = [
    ["Meranti Packaging Sdn Bhd", "Manufacturing", "High"],
    ["Nusa Food Industries", "Food & beverage", "High"],
    ["Bumi Logistics Sdn Bhd", "Logistics", "Medium"],
    ["Seri Maju Trading", "Wholesale", "Medium"],
    ["Hijau Palm Resources", "Agriculture", "High"],
    ["Kencana Tech Solutions", "Technology", "Low"],
    ["Lestari Build Materials", "Construction", "Medium"],
    ["Bayu Healthcare Supplies", "Healthcare", "High"],
    ["Padi Retail Group", "Retail", "Low"],
    ["Cahaya Textile Works", "Textiles", "Medium"],
  ];
  const customers: Customer[] = names.map(([name, industry, importance], n) => ({
    id: `CUS-${String(n + 1).padStart(3, "0")}`, name: name!, industry: industry!,
    importance: importance as Customer["importance"], esgRating: "Uncertified",
    outstandingCents: 0, overdueCents: 0, earliestDue: "", risk: "Low",
    paymentHistory: n % 3 === 0 ? "Synthetic history: two previous invoices paid on time; one payment delayed 12 days." :
      n % 3 === 1 ? "Synthetic history: payments typically received 5–15 days after due date." :
      "No verified historical record. Current demo invoices are the only available payment evidence.",
  }));
  const offsets = [-58, -42, -31, -24, -18, -12, -7, -3, 0, 1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 28, -20, -8, -5, -2, 12, 16];
  const amounts = [86500, 62400, 48300, 35750, 24800, 45600, 18900, 32400, 15600, 28350, 42500, 19800, 36700, 22400, 58400, 16750, 43800, 26900, 51200, 34400, 23600, 18750, 32400, 45600, 28900, 21500];
  const invoices: Invoice[] = offsets.map((offset, n) => {
    const customer = customers[n % customers.length]!;
    const dueDate = addDays(today(), offset), totalCents = amounts[n]! * 100;
    const paid = n >= 20 && n <= 23 ? totalCents : n % 6 === 1 ? Math.floor(totalCents / 3) : 0;
    return { id: `INV-${String(n + 1).padStart(4, "0")}`, number: `INV-${today().slice(0, 4)}-${String(n + 1).padStart(4, "0")}`,
      customerId: customer.id, customerName: customer.name, invoiceDate: addDays(dueDate, -30), dueDate,
      totalCents, paidCents: paid, outstandingCents: n >= 24 ? 0 : totalCents - paid,
      currency: "MYR", lateFeeBps: [1200, 1000, 800, 1500][n % 4]!,
      status: n >= 24 ? "Cancelled" : paid === totalCents ? "Paid" : paid > 0 ? "Partial" : "Upcoming",
      daysOverdue: 0, importance: customer.importance, esgRating: "Uncertified",
      source: "Synthetic Demo Data", importedAt: now(), estimatedFields: [],
    };
  });
  const statuses = ["Approved", "Approved", "Pending", "Rejected", "Approved", "Expired", "Needs information", "Approved"];
  const documents: ESGDocument[] = statuses.map((status, n) => ({
    id: `DOC-${String(n + 1).padStart(3, "0")}`, customerId: customers[n]!.id,
    customerName: customers[n]!.name, type: ["ISO 14001", "ISO 45001", "MSPO", "MyHIJAU"][n % 4]!,
    number: `DEMO-ESG-${String(n + 1).padStart(4, "0")}`,
    uploadedAt: addDays(today(), -40 - n), validUntil: addDays(today(), status === "Expired" ? -10 : 160 + n * 10),
    status: status!, conclusion: status === "Approved" ? "Approved in synthetic reviewer scenario only; not an actual certification." :
      status === "Rejected" ? "Demo review rejected; no verified rating." : "No currently valid approved rating available.",
    reason: status === "Approved" ? "Demo reviewer marked scope and dates satisfactory. Independent verification has NOT occurred." :
      status === "Rejected" ? "Demo document scope does not match the applicant." :
      status === "Expired" ? "Demo validity period has ended." :
      status === "Needs information" ? "Demo reviewer requests supporting scope information." : "Awaiting synthetic reviewer assessment.",
    rating: status === "Approved" ? ["A", "B", "C"][n % 3]! : "Uncertified",
    source: "Synthetic Demo record — NOT an official certificate",
  }));
  const state: DemoState = {
    schemaVersion: 1, customers, invoices, documents, riskEvents: [], plans: [], approvals: [], executions: [], auditLogs: [],
    settings: { currency: "MYR", cashCents: 4250000, minimumCashCents: 15000000, expectedExpenseCents: 6500000,
      horizonDays: 7, mediumBufferPercent: 20, collectionRatePercent: 60, overdueThresholdCents: 20000000,
      largeInvoiceCents: 5000000, concentrationCount: 5,
      weights: { lateFee: 30, urgency: 35, importance: 25, esg: 10 }, language: "en", aiMode: "rules" },
  };
  const risk = calculateRisk(state, "RSK-DEMO-INITIAL");
  state.riskEvents.push(risk);
  const plan = buildPlan(state, risk.id, state.settings.weights);
  state.plans.push(plan);
  state.auditLogs.push({
    id: "LOG-DEMO-INITIAL", type: "Demo initialization", createdAt: now(), actor: "System Demo",
    related: risk.id, content: "Loaded 10 synthetic customers, 26 invoices and 8 simulated ESG review records; initial risk event and pending plan created for demonstration.",
    before: "Empty demo workspace", after: `${risk.level} risk; ${plan.tasks.length} draft tasks awaiting human approval`,
    planVersion: `${plan.id} v1`, result: "Success",
  });
  return state;
}
