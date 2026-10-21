import { createHash } from "node:crypto";
import type { Invoice, Customer, RiskEvent, Weights, Dashboard } from "@workspace/api-zod";
import { type DemoState, today, dayDiff, addDays, ratio, sumCents, collectible, myr, now, BusinessError } from "./model";

export function validEsg(state: DemoState, customerId: string) {
  return state.documents
    .filter(d => d.customerId === customerId && d.status === "Approved" &&
      d.validUntil >= today() && ["A", "B", "C"].includes(d.rating))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
}

export function invoicesNow(state: DemoState): Invoice[] {
  return state.invoices.map(i => {
    const days = dayDiff(today(), i.dueDate);
    const outstandingCents = i.status === "Cancelled" ? 0 : i.totalCents - i.paidCents;
    const status = i.status === "Cancelled" ? "Cancelled" : outstandingCents === 0 ? "Paid" :
      i.paidCents > 0 ? "Partial" : days > 0 ? "Overdue" : days >= -7 ? "Due soon" : "Upcoming";
    const customer = state.customers.find(c => c.id === i.customerId);
    const pending = state.documents.some(d => d.customerId === i.customerId && d.status === "Pending" && d.validUntil >= today());
    return { ...i, outstandingCents, status, daysOverdue: Math.max(0, days),
      customerName: customer?.name ?? "Unknown",
      importance: customer?.importance ?? "Medium",
      esgRating: validEsg(state, i.customerId)?.rating ?? (pending ? "Pending" : "Uncertified") };
  });
}

export function customersNow(state: DemoState, invoices: Invoice[]): Customer[] {
  return state.customers.map(c => {
    const rows = invoices.filter(i => i.customerId === c.id && collectible(i));
    const overdue = rows.filter(i => i.daysOverdue > 0);
    return { ...c, esgRating: validEsg(state, c.id)?.rating ??
      (state.documents.some(d => d.customerId === c.id && d.status === "Pending" && d.validUntil >= today()) ? "Pending" : "Uncertified"),
      outstandingCents: sumCents(rows), overdueCents: sumCents(overdue),
      earliestDue: rows.map(i => i.dueDate).sort()[0] ?? "",
      risk: overdue.some(i => i.daysOverdue > 30 || i.outstandingCents >= state.settings.largeInvoiceCents)
        ? "High" : overdue.length ? "Medium" : "Low" };
  });
}

export function calculateRisk(state: DemoState, id = "live"): RiskEvent {
  const invoices = invoicesNow(state).filter(collectible);
  const s = state.settings;
  const due = invoices.filter(i => dayDiff(i.dueDate, today()) >= 0 && dayDiff(i.dueDate, today()) <= s.horizonDays);
  const overdue = invoices.filter(i => i.daysOverdue > 0);
  const dueCents = sumCents(due), overdueCents = sumCents(overdue);
  // Overdue invoices are disclosed separately; never assumed collected in the horizon.
  const expectedCollectionCents = ratio(dueCents, s.collectionRatePercent, 100);
  const projectedCashCents = s.cashCents + expectedCollectionCents - s.expectedExpenseCents;
  const gapCents = Math.max(0, s.minimumCashCents - projectedCashCents);
  const reasons: string[] = [];
  let level: RiskEvent["level"] = "Low";
  if (gapCents > 0) {
    level = "High";
    reasons.push(`Projected cash ${myr(projectedCashCents)} is below the operating minimum ${myr(s.minimumCashCents)}; shortfall ${myr(gapCents)}.`);
  } else if (projectedCashCents <= ratio(s.minimumCashCents, 100 + s.mediumBufferPercent, 100)) {
    level = "Medium";
    reasons.push(`Projected cash is within the ${s.mediumBufferPercent}% caution buffer above the operating minimum.`);
  }
  const warn = (reason: string) => { reasons.push(reason); if (level === "Low") level = "Medium"; };
  if (due.length >= s.concentrationCount) warn(`${due.length} open invoices (${myr(dueCents)}) fall due within ${s.horizonDays} days; concentration threshold is ${s.concentrationCount}.`);
  if (overdueCents >= s.overdueThresholdCents) warn(`Overdue exposure ${myr(overdueCents)} meets the ${myr(s.overdueThresholdCents)} warning threshold.`);
  const large = overdue.filter(i => i.outstandingCents >= s.largeInvoiceCents);
  if (large.length) warn(`${large.length} delayed invoice(s) exceed the large-invoice threshold of ${myr(s.largeInvoiceCents)}.`);
  if (!reasons.length) reasons.push("Projected cash exceeds the minimum plus caution buffer; no concentration, overdue or large-invoice rule is triggered.");
  reasons.push(`Demo forecast: current cash + ${s.collectionRatePercent}% of not-yet-overdue receivables due in ${s.horizonDays} days − expected horizon expenses. Overdue recovery is not assumed. This is not a guaranteed receipt forecast.`);
  return { id, createdAt: now(), level, reasons, dueCents, overdueCents,
    expectedCollectionCents, projectedCashCents, gapCents, horizonDays: s.horizonDays, settingsSnapshot: structuredClone(s) };
}

export function validateWeights(w: Weights) {
  if (Object.values(w).some(n => !Number.isInteger(n) || n < 0 || n > 100) ||
    w.lateFee + w.urgency + w.importance + w.esg !== 100) {
    throw new BusinessError("The four scoring weights must be whole percentages totaling exactly 100%.");
  }
}

export function signature(state: DemoState) {
  return createHash("sha256").update(JSON.stringify({
    date: today(), invoices: invoicesNow(state), customers: state.customers,
    documents: state.documents, settings: state.settings,
  })).digest("hex");
}

export function dashboard(state: DemoState): Dashboard {
  const all = invoicesNow(state), open = all.filter(collectible);
  const due = (days: number) => open.filter(i => dayDiff(i.dueDate, today()) >= 0 && dayDiff(i.dueDate, today()) <= days);
  const overdue = open.filter(i => i.daysOverdue > 0);
  let cumulative = 0;
  const trend = Array.from({ length: 31 }, (_, d) => {
    const date = addDays(today(), d);
    const dueCents = sumCents(open.filter(i => i.dueDate === date));
    cumulative += dueCents;
    return { date, dueCents, cumulativeCents: cumulative,
      projectedCashCents: state.settings.cashCents + ratio(cumulative, state.settings.collectionRatePercent, 100) -
        ratio(state.settings.expectedExpenseCents, Math.min(d, state.settings.horizonDays), state.settings.horizonDays) };
  });
  return {
    cashCents: state.settings.cashCents, outstandingCents: sumCents(open), outstandingCount: open.length,
    overdueCents: sumCents(overdue), overdueCount: overdue.length,
    due7Cents: sumCents(due(7)), due7Count: due(7).length, due30Cents: sumCents(due(30)),
    paidCents: all.filter(i => i.status !== "Cancelled").reduce((n, i) => n + i.paidCents, 0),
    pendingApprovals: state.plans.filter(p => p.status === "Pending").length,
    esgUpdates: state.documents.filter(d => d.status !== "Approved" || d.validUntil < today()).length,
    statusGroups: ["Upcoming", "Due soon", "Overdue", "Partial", "Paid", "Cancelled"].map(status => {
      const group = all.filter(i => i.status === status);
      return { status, count: group.length, amountCents: group.reduce((n, i) => n +
        (status === "Paid" ? i.paidCents : i.outstandingCents), 0) };
    }),
    trend, risk: calculateRisk(state),
  };
}
