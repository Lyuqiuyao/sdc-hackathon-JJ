# Manual correspondence extraction

`POST /api/company/:id/correspondence/:recordId/analyze` analyzes only an
existing record associated with that company. Uploading or viewing a record
never starts analysis automatically.

The existing `ai-provider` module owns the managed OpenAI call. It reuses the
managed client, model, 45-second timeout, zero automatic retries and
`store: false`. No private-key fallback or new dependency is introduced.

## Fields and provenance

- Overdue days, with an exact source quote or null.
- Debt amount in integer cents and explicitly stated currency, with a source
  quote; missing or ambiguous values remain null.
- Follow-up items, customer promises and disputes as source excerpts.
- Company/record association, source hash, actor, time, provider, model and
  fallback reason.

These are unverified claims from correspondence, not validated financial facts,
confirmed promises, speaker attribution, legal findings or a company profile.
No invoice, customer profile, score, plan, approval or SMTP behavior is updated.

Results are appended to company-keyed communication history in the existing
repository. The latest result is exposed as the company's
`correspondenceAnalysis` response field. It is not written to the signed raw
customer object, so extraction does not invalidate existing collection plans.
The company folder displays the source and all five fields, including nulls.

## Failure boundaries

Missing managed configuration, provider errors, timeouts, incomplete responses,
invalid JSON, schema failures and unsupported evidence use deterministic regex
fallback. Records above 60,000 characters use full-record regex scanning rather
than silently truncating model input. Rule lists retain up to 10 excerpts and
numeric candidate scanning is bounded; ambiguous numeric values remain null.
Regex matching is not complete semantic understanding and does not resolve who
made a promise or whether a quoted statement is valid.

Every manual attempt is audited, including start, completion with source and
fallback reason, rejection, expiry/discard and persistence failure where the
repository is available. Raw model responses are not retained in audit logs.
The provider call runs outside row locks. A per-record lease prevents normal
concurrent calls and discards late results. It does not guarantee exactly-once
provider billing after a process crash or expired lease.

## Verification scope

Per the user's instruction, no automated tests or live model requests were run.
Type checks, service startup and read-only page inspection do not prove live
OpenAI generation or extraction accuracy.
