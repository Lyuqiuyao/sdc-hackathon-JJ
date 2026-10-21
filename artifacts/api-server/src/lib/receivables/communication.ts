import { myr } from "./model";

interface CommunicationInput {
  customerName: string;
  invoiceNumber: string;
  outstandingCents: number;
  dueDate: string;
  daysOverdue: number;
}

// These are explicit rule/template alternatives, not a generated credit opinion.
export function communication(i: CommunicationInput, method: string) {
  const options = {
    payment: {
      en: "Request payment by the contractual due date, or immediately for overdue balances.",
      ms: "Mohon bayaran pada tarikh kontrak, atau dengan segera bagi baki lewat bayar.",
    },
    installments: {
      en: "Propose two equal installments over 30 days, subject to separate agreement.",
      ms: "Cadangkan dua ansuran sama rata dalam tempoh 30 hari, tertakluk kepada persetujuan berasingan.",
    },
    extension: {
      en: "Discuss a short extension of up to 7 days with a relationship-manager call, subject to separate consent.",
      ms: "Bincangkan lanjutan singkat sehingga 7 hari melalui panggilan pengurus hubungan, tertakluk kepada persetujuan berasingan.",
    },
  };
  const order = method === "Extension negotiation" ? ["extension", "payment", "installments"] as const :
    method === "Installment negotiation" ? ["installments", "payment", "extension"] as const :
    ["payment", "installments", "extension"] as const;
  const negotiation = order.map((key, n) => `Option ${n + 1}: ${options[key].en}`).join("\n") +
    "\nAlternatives require human selection and customer consent. No contractual terms or due dates change automatically.";
  // Only the preferred proposal is placed in the draft; alternatives remain internal.
  const preferred = options[order[0]];
  const noticeEn = `Dear ${i.customerName},\n\nThis is a courteous reminder regarding invoice ${i.invoiceNumber}, with an outstanding balance of ${myr(i.outstandingCents)}, due on ${i.dueDate}. ${i.daysOverdue > 0 ? `Our synthetic demo records show it is ${i.daysOverdue} days overdue.` : "The contractual due date is approaching."}\n\n${preferred.en} No contractual terms change without separate agreement.\nIf payment has already been arranged, please share the remittance details. Thank you for your cooperation.\n\nPlease contact [Finance contact / email / phone].\nTemplate-generated Synthetic Demo draft — no message has been sent.`;
  const noticeMs = `Tuan/Puan ${i.customerName},\n\nIni ialah peringatan mesra bagi invois ${i.invoiceNumber}, dengan baki tertunggak ${myr(i.outstandingCents)} dan tarikh akhir ${i.dueDate}. ${i.daysOverdue > 0 ? `Rekod demo sintetik menunjukkan kelewatan ${i.daysOverdue} hari.` : "Tarikh akhir pembayaran semakin hampir."}\n\n${preferred.ms} Tiada terma kontrak berubah tanpa persetujuan berasingan.\nJika pembayaran telah diatur, sila kongsikan butiran kiriman wang. Terima kasih atas kerjasama anda.\n\nHubungi [Pegawai kewangan / e-mel / telefon].\nDraf templat Synthetic Demo — tiada mesej dihantar.`;
  return { negotiation, noticeEn, noticeMs };
}
