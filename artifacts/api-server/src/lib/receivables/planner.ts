import { randomUUID } from "node:crypto";
import type { CollectionPlan, CollectionTask, Weights } from "@workspace/api-zod";
import { type DemoState, collectible, ratio, today, addDays, myr, now, BusinessError } from "./model";
import { invoicesNow, signature, validEsg, validateWeights } from "./compute";

export const METHODS = [
  "Friendly reminder", "Due date reminder", "Overdue collection",
  "Installment negotiation", "Extension negotiation", "Priority human follow-up",
];
const round = (n: number) => Math.round(n * 100) / 100;

export function buildPlan(state: DemoState, riskEventId: string, weights: Weights, previous?: CollectionPlan, deferred = false): CollectionPlan {
  validateWeights(weights);
  const invoices = invoicesNow(state).filter(collectible);
  if (!invoices.length) throw new BusinessError("There are no collectible invoices.");
  const id = `PLN-${randomUUID().slice(0, 8)}`;
  const tasks: CollectionTask[] = invoices.map(i => {
    const dailyPenaltyCents = ratio(i.outstandingCents, i.lateFeeBps, 3650000);
    const accruedPenaltyCents = ratio(i.outstandingCents, i.lateFeeBps * i.daysOverdue, 3650000);
    const lateFeeScore = round(Math.min(100, accruedPenaltyCents / 1000 + dailyPenaltyCents / 50));
    const daysToDue = Math.max(0, Math.round((Date.parse(i.dueDate) - Date.parse(today())) / 86400000));
    const urgencyScore = round(Math.min(100, (i.daysOverdue > 0 ? 65 + i.daysOverdue : Math.max(0, 60 - daysToDue * 3)) + Math.min(20, i.outstandingCents / 500000)));
    const importanceScore = i.importance === "High" ? 25 : i.importance === "Medium" ? 55 : 80;
    const document = validEsg(state, i.customerId);
    const esgScore = document?.rating === "A" ? 30 : document?.rating === "C" ? 70 : 50;
    const score = round((lateFeeScore * weights.lateFee + urgencyScore * weights.urgency +
      importanceScore * weights.importance + esgScore * weights.esg) / 100);
    const method = i.daysOverdue > 45 ? "Priority human follow-up" :
      i.daysOverdue > 20 && i.outstandingCents >= state.settings.largeInvoiceCents ? "Installment negotiation" :
      i.daysOverdue > 0 ? "Overdue collection" : daysToDue <= 7 ? "Due date reminder" : "Friendly reminder";
    const negotiation = method === "Installment negotiation"
      ? "Propose two equal installments over 30 days, subject to customer agreement and a separate contractual review. No terms are changed automatically."
      : i.importance === "High" ? "Offer a relationship-manager call to agree a payment date; any extension needs separate consent."
      : "Request payment by the contractual due date, or discuss a mutually agreed payment date.";
    const noticeEn = `Dear ${i.customerName},\n\nThis is a courteous reminder regarding invoice ${i.number}, with an outstanding balance of ${myr(i.outstandingCents)}, due on ${i.dueDate}. ${i.daysOverdue > 0 ? `Our synthetic demo records show it is ${i.daysOverdue} days overdue.` : "The contractual due date is approaching."}\n\n${negotiation}\nIf payment has already been arranged, please share the remittance details. Thank you for your cooperation.\n\nPlease contact [Finance contact / email / phone].\nTemplate-generated Demo draft — no message has been sent.`;
    const noticeMs = `Tuan/Puan ${i.customerName},\n\nIni ialah peringatan mesra bagi invois ${i.number}, dengan baki tertunggak ${myr(i.outstandingCents)} dan tarikh akhir ${i.dueDate}. ${i.daysOverdue > 0 ? `Rekod demo sintetik menunjukkan kelewatan ${i.daysOverdue} hari.` : "Tarikh akhir pembayaran semakin hampir."}\n\n${method === "Installment negotiation" ? "Kami mencadangkan dua ansuran sama rata dalam tempoh 30 hari, tertakluk kepada persetujuan bersama dan semakan kontrak berasingan." : "Sila buat pembayaran mengikut tarikh kontrak atau hubungi kami untuk membincangkan tarikh pembayaran yang dipersetujui bersama."}\nJika pembayaran telah diatur, sila kongsikan butiran kiriman wang. Terima kasih atas kerjasama anda.\n\nHubungi [Pegawai kewangan / e-mel / telefon].\nDraf templat Demo — tiada mesej dihantar.`;
    return {
      id: `TSK-${randomUUID().slice(0, 8)}`, invoiceId: i.id, invoiceNumber: i.number,
      customerId: i.customerId, customerName: i.customerName, outstandingCents: i.outstandingCents,
      dueDate: i.dueDate, daysOverdue: i.daysOverdue, rank: 0, lateFeeScore, urgencyScore, importanceScore, esgScore, score,
      method, scheduledAt: "", negotiation,
      reason: `Annual late fee ${i.lateFeeBps / 100}%: estimated accrued cost ${myr(accruedPenaltyCents)}, daily cost ${myr(dailyPenaltyCents)} (simple interest, not added to invoice). Urgency ${urgencyScore}/100; ${i.importance.toLowerCase()} business importance uses ${importanceScore}/100 to protect key relationships. ${document ? `Valid reviewed ESG ${document.rating} uses ${esgScore}/100.` : "Unverified/missing ESG uses neutral 50/100; it is not evidence of bad debt."} Weighted score ${score}/100.`,
      uncertainty: `Rules-engine Demo, not LLM output or a validated credit model. Payment forecasts and customer willingness are uncertain. Weights are illustrative, not business-validated. ${!document ? "No valid reviewed ESG rating; neutral treatment." : "ESG is auxiliary only and does not override contractual obligations."}`,
      esgNote: document ? `Synthetic Demo ${document.type}, ${document.number}; reviewer status Approved; valid until ${document.validUntil}; rating ${document.rating}. Use only for relationship-sensitive scheduling, never as sole evidence of credit quality.` : "No ESG compliance alert: no currently valid reviewed evidence. Neutral score 50.",
      noticeEn, noticeMs, status: "Draft",
    };
  }).sort((a, b) => b.score - a.score || a.dueDate.localeCompare(b.dueDate) || a.invoiceNumber.localeCompare(b.invoiceNumber));
  tasks.forEach((t, n) => {
    t.rank = n + 1;
    t.scheduledAt = `${addDays(today(), (deferred ? 2 : 0) + Math.floor(n / 8) + 1)}T${String(9 + n % 8).padStart(2, "0")}:00:00+08:00`;
  });
  return { id, familyId: previous?.familyId ?? id,
    version: previous ? Math.max(...state.plans.filter(p => p.familyId === previous.familyId).map(p => p.version)) + 1 : 1,
    riskEventId, createdAt: now(), status: "Pending", mode: "Rules-engine Demo · editable bilingual templates",
    weights: structuredClone(weights), tasks, notes: "", dataSignature: signature(state) };
}
