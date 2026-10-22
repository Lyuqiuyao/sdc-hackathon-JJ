# Advisory AI company portrait

`POST /api/company/:id/portrait` manually generates a portrait using that
company's structured invoice data and the latest persisted NLP result for each
correspondence record. It does not analyze uploads again or create another
customer profile editor.

The existing `ai-provider` owns the managed OpenAI call, with the existing
model/client, a 45-second deadline, zero retries and `store: false`. Missing
configuration, failed calls, timeouts and invalid output use a basic rules
portrait. No new dependency or environment setting is required.

## Controlled content

- Risk tags use invoice evidence; open invoices overdue more than 60 days
  produce a high-risk signal. This is a portrait label, not a planner score.
- NLP disputes, promises and follow-ups are explicitly unverified mentions.
  They do not establish who spoke, whether a dispute is valid or whether a
  promise was fulfilled.
- Existing ESG ratings and synthetic evidence are distinguished. Missing ESG
  remains neutral; no rating or certification is created.
- Payment observations disclose currently available balances and invoice aging.
  Without settlement timestamps, historical on-time habits cannot be inferred.
- OpenAI arranges the allowed risk tags and selects from controlled payment
  observations; it cannot invent financial facts, labels, severity or ESG claims.
  The UI explicitly labels this as OpenAI-assisted controlled facts.

## Persistence and visibility

Portraits are appended in a company-keyed repository field, not the signed
customer/invoice data. Generation does not invalidate collection plans or modify
planner.ts. Workspace responses expose the latest portrait as `Customer.aiPortrait`.
Changes to invoice/NLP/ESG inputs or the calendar day mark it stale. A model
result is discarded if source data changes while generation is in progress.

The portrait panel is at the top of the company folder, always expanded.
Saved portraits are immediately visible when the folder opens; first generation
and regeneration are explicit button actions, never automatic billable calls.
Approval Center opens the company folder in a sheet without leaving the current
review. The selector includes every company in the current plan, including 3D
and historical plans.

Every attempt is audited: start, completion with actual provider/fallback reason,
rejection, expiry/discard and persistence failure where storage is available.
Raw model output is not retained. Provider I/O occurs outside database locks.
A durable lease prevents normal concurrent generation but cannot guarantee
exactly-once provider billing after an expired lease or process crash.

## Verification scope

No automated tests or live portrait generations were run, per the user's
instruction. Type checks, service startup and read-only page inspection do not
prove live OpenAI generation or interactive end-to-end behavior.
