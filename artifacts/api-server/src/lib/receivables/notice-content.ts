import { z } from "zod/v4";
import type { CollectionTask, NoticeDraft, NoticeVariants, TaskEdit } from "@workspace/api-zod";
import { communication } from "./communication";
import { now } from "./model";

export const noticeKind = (method: string) => method === "Extension negotiation" ? "extension" as const : "collectNow" as const;
const paragraph = z.object({ en: z.string().min(1).max(1200), ms: z.string().min(1).max(1200) }).strict();
const response = z.object({ tasks: z.array(z.object({
  taskId: z.string(), collectNow: paragraph, extension: paragraph,
}).strict()).min(1).max(50) }).strict();
function modelSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(modelSchema);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["$schema", "minLength", "maxLength", "minItems", "maxItems"].includes(key))
    .map(([key, child]) => [key, modelSchema(child)]));
  return value;
}
export const noticeParagraphSchema = modelSchema(z.toJSONSchema(response)) as Record<string, unknown>;

export function basicNoticeVariants(task: CollectionTask, reasonCode: string): NoticeVariants {
  const draft = (method: string): NoticeDraft => {
    const { noticeEn, noticeMs } = communication(task, method);
    return { noticeEn, noticeMs, noticeEnSource: "rules_fallback", noticeMsSource: "rules_fallback" };
  };
  return { collectNow: draft(task.daysOverdue > 0 ? "Overdue collection" : "Due date reminder"),
    extension: draft("Extension negotiation"), generatedAt: now(), reasonCode,
    contentPolicy: "contextual_paragraph_with_controlled_facts" };
}

// A lexical blacklist cannot prove a natural-language financial assertion safe.
// Only evidence-appropriate, server-approved conditional sentences are accepted.
// The model chooses/order-composes these sentences; its validated paragraph is
// retained verbatim, rather than overwritten with the old generic notice.
export function noticeContextOptions(evidence: { disputes: boolean; promises: boolean; followUps: boolean }) {
  const common: { en: string; ms: string }[] = [];
  if (evidence.disputes) common.push({
    en: "If there are unresolved questions about this invoice, please share the supporting details for review.",
    ms: "Jika terdapat persoalan yang belum selesai tentang invois ini, sila kongsikan butiran sokongan untuk semakan.",
  });
  if (evidence.promises) common.push({
    en: "If an earlier communication contains a proposed next step, please confirm its current status.",
    ms: "Jika komunikasi terdahulu mengandungi cadangan langkah seterusnya, sila sahkan status semasanya.",
  });
  if (evidence.followUps) common.push({
    en: "Please let us know which follow-up queries need attention so we can discuss the next steps.",
    ms: "Sila maklumkan pertanyaan susulan yang memerlukan perhatian supaya kita boleh membincangkan langkah seterusnya.",
  });
  return {
    collectNow: [{ en: "Please let us know if any clarification would help you respond to this notice.",
      ms: "Sila maklumkan jika sebarang penjelasan dapat membantu anda memberikan maklum balas terhadap notis ini." }, ...common],
    extension: [{ en: "If additional time would help, please contact us to discuss a proposal, subject to separate consent.",
      ms: "Jika masa tambahan dapat membantu, sila hubungi kami untuk membincangkan cadangan, tertakluk kepada persetujuan berasingan." }, ...common],
  };
}
export type NoticeContextOptions = ReturnType<typeof noticeContextOptions>;

function assertContextParagraph(text: string, allowed: string[]) {
  let remaining = text.trim(), count = 0;
  const used = new Set<string>();
  while (remaining) {
    const sentence = allowed.find(value => remaining === value || remaining.startsWith(`${value} `));
    if (!sentence || used.has(sentence) || ++count > 3) throw new Error("Unsupported contextual sentence");
    used.add(sentence);
    remaining = remaining.slice(sentence.length).trimStart();
  }
  if (!count) throw new Error("Empty contextual paragraph");
}

export function contextualNoticeVariants(raw: string, tasks: CollectionTask[], allowed: NoticeContextOptions) {
  if (raw.length > 100_000 || raw.includes("\ufffd")) throw new Error("Invalid notice response");
  const parsed = response.parse(JSON.parse(raw));
  if (parsed.tasks.length !== tasks.length || new Set(parsed.tasks.map(t => t.taskId)).size !== tasks.length ||
    parsed.tasks.some(row => !tasks.some(task => task.id === row.taskId))) throw new Error("Notice task mismatch");
  return tasks.map(task => {
    const row = parsed.tasks.find(item => item.taskId === task.id)!;
    const variants = basicNoticeVariants(task, "success");
    for (const kind of ["collectNow", "extension"] as const) {
      assertContextParagraph(row[kind].en, allowed[kind].map(value => value.en));
      assertContextParagraph(row[kind].ms, allowed[kind].map(value => value.ms));
      const enOrder = allowed[kind].filter(value => row[kind].en.includes(value.en)).map(value => value.en);
      const msOrder = allowed[kind].filter(value => row[kind].ms.includes(value.ms)).map(value => value.en);
      if (JSON.stringify(enOrder) !== JSON.stringify(msOrder)) throw new Error("Bilingual context mismatch");
      variants[kind] = {
        noticeEn: variants[kind].noticeEn.replace("\n\n", `\n\n${row[kind].en.trim()}\n\n`),
        noticeMs: variants[kind].noticeMs.replace("\n\n", `\n\n${row[kind].ms.trim()}\n\n`),
        noticeEnSource: "openai", noticeMsSource: "openai",
      };
    }
    return { taskId: task.id, variants };
  });
}

// Client input cannot forge model provenance. Existing server versions determine
// sources; only genuinely changed text is marked as a human edit.
export function editedNoticeVariants(old: CollectionTask, edited: TaskEdit) {
  if (!old.noticeVariants) return undefined;
  const variants = structuredClone(old.noticeVariants);
  for (const kind of ["collectNow", "extension"] as const) {
    for (const lang of ["En", "Ms"] as const) {
      const field = `notice${lang}` as const, source = `notice${lang}Source` as const;
      const incoming = edited.noticeVariants?.[kind][field];
      if (incoming !== undefined && incoming !== variants[kind][field]) {
        variants[kind][field] = incoming;
        variants[kind][source] = "human";
      }
    }
  }
  // Preserve older clients which edit only the selected English/Malay fields.
  const selected = variants[noticeKind(edited.method)];
  for (const lang of ["En", "Ms"] as const) {
    const field = `notice${lang}` as const, source = `notice${lang}Source` as const;
    if (edited[field] !== old[field] && (!edited.noticeVariants || edited[field] !== selected[field])) {
      selected[field] = edited[field]; selected[source] = "human";
    }
  }
  return variants;
}
