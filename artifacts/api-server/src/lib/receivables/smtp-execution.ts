import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import type { CollectionPlan, CollectionTask, ExecutionRecord } from "@workspace/api-zod";
import { changeState, readState } from "./repository";
import { BusinessError, now, type DemoState } from "./model";
import { audit, execute } from "./service";
import { smtpConfiguration, smtpEnabled } from "./smtp-config";
import { planRecipients } from "./email-recipients";
import { canonicalJson } from "./compute";

export interface SmtpDispatch {
  attemptId: string;
  status: "sending" | "failed" | "uncertain" | "complete";
  recipient?: string;
  recipients?: Record<string, string>;
  currentTaskId?: string;
}

// Reuse all existing approval, freshness and human-review gates on a disposable
// copy. Simulation records/audits from this copy are never persisted.
function approvedPlan(state: DemoState, id: string): CollectionPlan {
  execute(structuredClone(state), id);
  const plan = state.plans.find(p => p.id === id);
  if (!plan) throw new BusinessError("Plan not found.", 404);
  return plan;
}

const safeSmtpCode = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" &&
    ["EAUTH", "EENVELOPE", "EDNS", "ECONNECTION", "ETIMEDOUT", "ESOCKET", "ETLS", "EMESSAGE", "ESTREAM"].includes(code)
    ? code : "SMTP_ERROR";
};

// Only remove the trailing unsent assertion, never the Synthetic Demo label.
const smtpNotice = (text: string) => text.replace(
  /[ \t]*(?:[—–-][ \t]*)?(?:no message(?: has been)? sent|tiada mesej dihantar)\.?\s*$/i, "",
).trimEnd();

export async function executeWithSmtpSwitch(id: string, expectedSmtpEnabled?: boolean, expectedRecipientsSignature?: string): Promise<CollectionPlan> {
  const existing = (await readState()).plans.find(plan => plan.id === id);
  if (existing?.status === "Executed") return existing;
  const realMode = smtpEnabled();
  const rejected = !existing ? { message: "Plan not found.", status: 404 }
    : expectedSmtpEnabled !== realMode ? {
      message: "Execution mode changed or was not confirmed. Reopen the confirmation dialog to check the current server mode.", status: 409,
    } : undefined;
  if (rejected) {
    await changeState(state => audit(state, "Execution rejected", rejected.message, id, "", "", existing,
      { isRealSmtp: realMode, result: "Rejected" }));
    throw new BusinessError(rejected.message, rejected.status);
  }
  if (!realMode) {
    const result = await changeState(state => {
      const plan = state.plans.find(plan => plan.id === id);
      if (plan?.status === "Executed") return { plan } as const;
      const error = smtpEnabled() !== expectedSmtpEnabled
        ? "Execution mode changed. Reopen the confirmation dialog."
        : state.smtpDispatches?.[id] ? "A real SMTP attempt exists for this plan. Resolve it before switching this plan to simulation." : undefined;
      if (error) {
        audit(state, "Execution rejected", error, id, "", "", plan, { isRealSmtp: false, result: "Rejected" });
        return { error } as const;
      }
      return { plan: execute(state, id) } as const;
    });
    if ("error" in result) throw new BusinessError(result.error!, 409);
    return result.plan;
  }

  const attemptId = randomUUID();
  let activeTask: CollectionTask | undefined;
  let uncertain = false;
  let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
  try {
    const claim = await changeState(state => {
      const completed = state.plans.find(plan => plan.id === id);
      if (completed?.status === "Executed") return { plan: completed, done: true as const };
      if (!smtpEnabled()) throw new BusinessError("Execution mode changed. Reopen the confirmation dialog.", 409);
      // Completed plans return before credentials are validated, including races.
      const config = smtpConfiguration();
      const plan = approvedPlan(state, id);
      const preview = planRecipients(state, plan);
      if (preview.signature !== expectedRecipientsSignature)
        throw new BusinessError("Recipients or approved messages changed or were not confirmed. Reopen the execution confirmation.", 409);
      if (preview.recipients.some(row => !row.valid))
        throw new BusinessError("Every task needs a valid confirmed customer collection email. No message was sent.", 400);
      const recipients = Object.fromEntries(preview.recipients.map(row => [row.taskId, row.recipient]));
      const previous = state.smtpDispatches?.[id];
      if (previous?.status === "sending" || previous?.status === "uncertain")
        throw new BusinessError("SMTP is already sending or its outcome requires reconciliation. Check the audit and SMTP server logs before retrying.", 409);
      if (previous && (!previous.recipients || canonicalJson(previous.recipients) !== canonicalJson(recipients)))
        throw new BusinessError("Customer recipients changed or a legacy shared-mailbox attempt exists. Reconcile the existing attempt before retrying.", 409);
      (state.smtpDispatches ??= {})[id] = { attemptId, status: "sending", recipients };
      audit(state, "SMTP execution", "Claimed approved plan for real SMTP execution. Invoice payment records remain unchanged.",
        id, "", attemptId, plan, { isRealSmtp: true, result: "Pending" });
      return { plan: structuredClone(plan), config, recipients, done: false as const };
    });
    if (claim.done) return claim.plan;
    const config = claim.config;

    transport = nodemailer.createTransport({
      host: config.host, port: config.port, secure: config.secure, auth: config.auth,
      requireTLS: !config.secure, tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
      pool: false, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
    });
    for (const task of claim.plan.tasks) {
      const recipient = claim.recipients[task.id]!;
      const shouldSend = await changeState(state => {
        if (!smtpEnabled()) throw new BusinessError("Execution mode changed during dispatch. Stop and reconfirm before sending further messages.", 409);
        const plan = approvedPlan(state, id), dispatch = state.smtpDispatches?.[id];
        if (dispatch?.attemptId !== attemptId || dispatch.status !== "sending")
          throw new BusinessError("SMTP execution ownership changed.", 409);
        if (planRecipients(state, plan).signature !== expectedRecipientsSignature)
          throw new BusinessError("Recipients or approved messages changed during dispatch. Stop and reconfirm.", 409);
        if (state.executions.some(e => e.planId === id && e.taskId === task.id && e.channel === "SMTP Email")) return false;
        dispatch.currentTaskId = task.id;
        audit(state, "SMTP send attempt", "Starting real SMTP submission of the approved English and Malay drafts.",
          task.invoiceNumber, "", JSON.stringify({ taskId: task.id, recipient }), plan, { isRealSmtp: true, result: "Pending" });
        return true;
      });
      if (!shouldSend) continue;
      activeTask = task;
      const noticeEn = smtpNotice(task.noticeEn), noticeMs = smtpNotice(task.noticeMs);
      // Never hold the repository row lock during external SMTP I/O.
      // A timeout after DATA may be ambiguous; never automatically retry it.
      uncertain = true;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          transport.sendMail({
            from: config.from, to: recipient,
            subject: `Collection notice - ${task.invoiceNumber.replace(/[\r\n]/g, " ")}`,
            text: `${noticeEn}\n\n--- Bahasa Melayu ---\n\n${noticeMs}`,
            messageId: `<${randomUUID()}@arus.local>`,
          }).then(info => {
            if (!info.accepted?.length || info.rejected?.length)
              throw Object.assign(new Error("SMTP recipient rejected"), { code: "EENVELOPE" });
          }),
          new Promise<never>((_resolve, reject) => {
            deadline = setTimeout(() => {
              transport?.close();
              reject(Object.assign(new Error("SMTP deadline exceeded"), { code: "ETIMEDOUT" }));
            }, 45_000);
          }),
        ]);
      } catch (error) {
        if (["EAUTH", "EENVELOPE", "EDNS"].includes(safeSmtpCode(error))) uncertain = false;
        throw error;
      } finally {
        if (deadline) clearTimeout(deadline);
      }
      await changeState(state => {
        const plan = state.plans.find(p => p.id === id)!;
        const record: ExecutionRecord = {
          id: `EXE-${randomUUID().slice(0, 8)}`, planId: id, taskId: task.id,
          invoiceNumber: task.invoiceNumber, customerName: task.customerName, actor: "Demo Admin",
          executedAt: now(), result: "SMTP server accepted the message. Delivery to the mailbox is not guaranteed. No payment changed.",
          noticeStatus: `SMTP accepted · EN: ${task.noticeEnSource ?? "rules_fallback"} / MS: ${task.noticeMsSource ?? "rules_fallback"}`,
          channel: "SMTP Email", recipient,
          noticeEn, noticeMs, planVersion: claim.plan.version,
        };
        state.executions.push(record);
        delete state.smtpDispatches![id]!.currentTaskId;
        audit(state, "SMTP send accepted", "SMTP server accepted the approved notice; this is not proof of inbox delivery or payment.",
          `${task.invoiceNumber} ${task.customerName}`, "", JSON.stringify(record), plan, { isRealSmtp: true, result: "Success" });
      });
      uncertain = false;
      activeTask = undefined;
    }
    return await changeState(state => {
      const plan = approvedPlan(state, id);
      for (const task of plan.tasks) task.status = "SMTP accepted";
      plan.status = "Executed";
      state.smtpDispatches![id]!.status = "complete";
      audit(state, "SMTP execution completed", "All approved task messages were accepted by SMTP. No invoice payment or cash balance changed.",
        id, "Approved", "Executed", plan, { isRealSmtp: true, result: "Success" });
      return plan;
    });
  } catch (error) {
    const code = error instanceof BusinessError ? "EXECUTION_BLOCKED" : safeSmtpCode(error);
    try {
      await changeState(state => {
        const dispatch = state.smtpDispatches?.[id];
        if (dispatch?.attemptId === attemptId) dispatch.status = uncertain ? "uncertain" : "failed";
        audit(state, "SMTP execution failed", `Real SMTP execution stopped (${code}).${uncertain ? " Outcome uncertain; reconcile SMTP logs before retrying." : " No simulated success was substituted."}`,
          activeTask?.invoiceNumber ?? id, "", activeTask?.id ?? "", state.plans.find(p => p.id === id),
          { isRealSmtp: true, result: error instanceof BusinessError && error.status < 500 ? "Rejected" : "Failed" });
      });
    } catch {
      // Do not use the generic HTTP error that claims nothing was committed:
      // SMTP might have accepted a message before a database outage.
      throw new BusinessError("SMTP outcome could not be saved to the audit log. Messages may already have been accepted. Do not retry until SMTP and database records have been reconciled.", 503);
    }
    if (error instanceof BusinessError) throw error;
    throw new BusinessError(`SMTP sending failed (${code}). Previously accepted messages remain recorded.${uncertain ? " The current outcome is uncertain; check SMTP logs before retrying." : " Check SMTP settings and retry."}`, 502);
  } finally {
    transport?.close();
  }
}
