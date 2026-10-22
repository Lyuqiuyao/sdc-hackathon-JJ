import { BusinessError } from "./model";

export const smtpEnabled = () => process.env.SMTP_ENABLED === "true";

export function smtpConfiguration() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM?.trim();
  const to = process.env.SMTP_TO?.trim();
  const port = Number(process.env.SMTP_PORT || "587");
  const secure = process.env.SMTP_SECURE === undefined ? port === 465 : process.env.SMTP_SECURE === "true";
  // A single explicit mailbox, not a generated synthetic customer address or header.
  const mailbox = /^[^\s@<>,;:\r\n]+@[^\s@<>,;:\r\n]+\.[^\s@<>,;:\r\n]+$/;
  if (!host || /[\s/]/.test(host) || !user || !pass || !from || !to ||
    !mailbox.test(from) || !mailbox.test(to) ||
    !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new BusinessError("SMTP configuration is incomplete or invalid. Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM and SMTP_TO. No simulated success was recorded.", 503);
  }
  return { host, port, secure, auth: { user, pass }, from, to };
}
