import { createHash } from "node:crypto";
import type { CollectionPlan, PlanRecipients } from "@workspace/api-zod";
import type { DemoState } from "./model";
import { canonicalJson } from "./compute";
import { noticeKind } from "./notice-content";

export const validMailbox = (value: string) => value.length <= 254 &&
  /^[^\s@<>,;:\r\n]+@[^\s@<>,;:\r\n]+\.[^\s@<>,;:\r\n]+$/.test(value);

export function planRecipients(state: DemoState, plan: CollectionPlan): PlanRecipients {
  const recipients = plan.tasks.map(task => {
    const customer = state.customers.find(row => row.id === task.customerId);
    const recipient = task.recipientEmail ?? customer?.collectionEmail ?? "";
    return { taskId: task.id, customerName: task.customerName, recipient, valid: validMailbox(recipient),
      noticeKind: noticeKind(task.method) };
  });
  const signature = createHash("sha256").update(canonicalJson({
    planId: plan.id, version: plan.version, recipients,
    messages: plan.tasks.map(task => ({ id: task.id, noticeEn: task.noticeEn, noticeMs: task.noticeMs })),
  })).digest("hex");
  return { signature, recipients };
}
