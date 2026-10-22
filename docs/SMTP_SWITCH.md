# SMTP execution switch

`SMTP_ENABLED` defaults to false when absent. Only the exact value `true`
activates SMTP. No credentials or activation values are supplied by this change.
Restart the API workflow after changing environment settings.

## Environment-only configuration

- `SMTP_ENABLED`: `false` by default; `true` permits real sending.
- `SMTP_HOST`: SMTP hostname.
- `SMTP_PORT`: SMTP port, default `587`.
- `SMTP_SECURE`: implicit TLS when `true`; defaults to true for port 465.
  Otherwise STARTTLS is mandatory. Certificate verification remains enabled.
- `SMTP_USER`, `SMTP_PASS`: credentials from server-side secrets only.
- `SMTP_FROM`: one sender email address.
- `SMTP_TO`: one explicit destination email address.

The existing synthetic company model has no real email address field.
All real submissions therefore go to the explicitly configured `SMTP_TO`
mailbox, not to generated example.invalid addresses. Do not enable this switch
on the public shared demo with unrestricted recipients. This change does not
add authentication, customer contact management or a production email service.

## Behavior

- Disabled: existing simulation executor, including exact-version approval,
  freshness, review, task order and financial invariants. New send audits carry
  `isRealSmtp: false`.
- Enabled: same approval and freshness gates, then one SMTP message per task
  containing the approved English and Malay drafts. No AI calls.
- Attempts, accepted submissions, failures and completion are audited with
  `isRealSmtp: true`; historical missing values remain missing.
- SMTP acceptance is not proof of inbox delivery. No invoice is paid or cash
  changed by SMTP. Approval itself still does not send email.
- Credentials and raw provider error responses are never copied into audit
  logs or returned to the browser.
- Missing configuration produces HTTP 503; provider errors produce HTTP 502.
  Errors are shown by the existing execution page rather than crashing it.
- SMTP I/O happens outside database row locks. Durable per-plan ownership
  blocks concurrent submissions, and persisted accepted tasks are skipped on
  retry after a definite failure.
- A crash during SMTP submission or a network timeout after DATA may leave
  an uncertain outcome. There is no automatic retry or automatic takeover:
  reconcile the SMTP server logs and persisted task/audit records first.
  This does not claim exactly-once SMTP delivery. Manual reconciliation tooling
  is not included in this step.

## Verification scope

Per the user's instruction, no automated tests or real SMTP sends were run.
TypeScript compilation and read-only preview/log inspection are not tests of
SMTP connectivity, authentication or delivery.
