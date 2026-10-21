# Final Administrator MVP Implementation and Verification

## Scope and business approval

The user approved invoice-level scoring, customer-level human review, separate deterministic queues and a human-confirmed final merge. This remains an administrator-only synthetic demonstration. The existing architecture, page structure, financial fixtures and historical advice snapshots are retained.

No shared database operation, real model request, Secret change, real email, debit, transfer or financial-status change was performed by the implementation checks.

## Requirement matrix

| Requirement | Implementation | Evidence and boundary |
|---|---|---|
| English administrator UI | Removed Han captions, labels and translation maps; English-only interface around English/Malay drafts | Source scan: 132 files, zero Han-containing locations; changed journey exercised in browser |
| Automatic language regression check | `scripts/check-english-ui.mjs`; included in root build | Full Unicode Script=Han scan, no private data read |
| Synthetic company information | Optimistic-version profile form and API, explicit synthetic attestation | Node and isolated API tests; browser saves profile v1 |
| Existing ESG rating, not generated rating | Customer's stored A/B/C field controls new scoring; evidence has a separate status | Tests cover known rating with mismatching evidence and unknown rating with an Approved document |
| Administrator SEDG submission/import | Structured form or JSON import; append-only declarations, unverified status | Invalid JSON browser check, valid submit, API validation and state comparison |
| No ESG/SEDG penalty | Missing rating is excluded, not assigned a numeric surrogate; missing SEDG is neutral | Formula, branching and no-rating-generation tests |
| Company information folder | Profile, existing rating, invoices, documents, SEDG history, customer collection reviews and communications | Real frontend against isolated in-browser API |
| Two-dimensional scoring | Overdue 60%, outstanding 40% | Exact formula and normalization tests |
| Three-dimensional scoring | Overdue 51%, outstanding 34%, assigned ESG 15% | Exact formula, mapping and context tests |
| Independent risk checks | Existing deterministic cash-flow/concentration/overdue calculations retained | Original regression suite plus unchanged risk-result test |
| Separate queue ordering | Scores compared only within the same queue; queue rank retained | Deterministic order, no fee/importance dependency tests |
| Human customer decisions | Collect now / negotiable extension, required reason, actor, profile version, latest SEDG association | Node, real isolated API and browser tests |
| Human final merge | Explicit merge reason and new version; no automatic comparison across queues | Approval blocked before review/merge; browser v2 review -> v3 merge |
| AI advisory boundary | Canonical context, local Schema/business checks, controlled notices, Rules fallback | Existing provider/safety tests retained; new split preflight tests |
| No raw model retention | Existing policy unchanged; new scoring/review/merge metadata enters safe snapshots | Snapshot checks and original append-only regressions |
| Human changes preserve scores | Edits retain financial scores and initial queue ranks, reset merge, create a new Pending version | Node and browser checks |
| Specific-version approval | Approval and execution gates require review, merge, freshness and exact approved version | Node, real isolated API and browser checks |
| Simulated Email | Reserved `.invalid` recipient, channel, final EN/MS bodies, version, actor, time and explicit simulation result | 20 fixture tasks -> 20 execution records; idempotence and financial non-mutation checks |
| Historical compatibility | Legacy scoring code and weights remain for historical plans and explicit legacy test fixtures | Original 128 regression tests retained; no history backfill or relabel |
| No separate portals | Existing administrator navigation retained | No new customer/certifier app or role switch |
| NLP profiling | Deliberately not implemented | Deferred per user scope, not claimed complete |

## Approved scoring specification

All amounts are integer MYR cents.

```text
D = round2(100 * min(max(daysOverdue, 0) / 90, 1))
A = round2(100 * min(outstandingCents / 10_000_000, 1))

2D score = round2(0.60 * D + 0.40 * A)

E(A) = 30; E(B) = 50; E(C) = 70
3D score = round2(0.51 * D + 0.34 * A + 0.15 * E)
```

The amount cap is MYR 100,000. These are explicitly approved **illustrative demo parameters**, not an empirically validated credit/default model.

For 2D tasks `esgScore` is null. Legacy compatibility fields do not participate in new scoring. Initial queue concatenation is only a display arrangement, not a merged execution priority. Within each queue, ties use due date, invoice number and invoice ID. Manual order changes retain the original queue rank and score.

The new synthetic seed explicitly supplies existing illustrative customer ratings and structured profiles. It does not alter shared records or derive ratings from SEDG. Existing ESG documents and invoice amounts/payments remain unchanged. An imported existing rating is not an assertion of independent certification.

## Changed files

### Server

Under `artifacts/api-server/src/lib/receivables/`:

- New `scoring.ts`: approved formula, fixed parameters, invoice input checks and separate deterministic queues.
- New `company.ts`: synthetic company profile update and SEDG submission.
- New `language.ts`: Han-content rejection for new administrator input.
- `model.ts`: optional SEDG aggregate.
- `seed.ts`: default split scoring and synthetic structured profiles; explicit legacy fixture option.
- `planner.ts`: split default, preserved legacy implementation.
- `compute.ts`: assigned rating separated from document evidence; SEDG included in source fingerprint; canonical JSON hashing.
- `service.ts`: versioned customer reviews, reasoned merges, review/merge approval gates, simulated Email snapshots, inactive legacy override rejection and updated audit attribution.
- `ai-preflight.ts`: split configuration/dimension/score/queue checks, nullable ESG handling.
- `ai-provider.ts`: split context, authoritative rating/evidence matching, parsed-language rejection including escaped Han.
- `ai-content-safety.ts`: preserve neutral handling and controlled text while distinguishing assigned rating from evidence.
- `advice-snapshots.ts`: include scoring specification, customer reviews and manual merge in safe plan-at-event snapshots.

`artifacts/api-server/src/routes/receivables.ts` adds the generated profile/SEDG contracts and returns safe English validation errors without echoing rejected input.

### Frontend

Under `artifacts/receivables-admin/src/`:

- New `components/company-folder.tsx`: profile, SEDG JSON/form input, unverified history and linked company information.
- `components/plan.tsx`: version-aware scoring display and separate queues.
- `pages/approvals.tsx`: per-customer review, merge confirmation, new-version selection and approval gates.
- `pages/customers.tsx`: folder and deep-link integration.
- `pages/ai-planner.tsx`: fixed approved scoring, no legacy weight override.
- `pages/settings.tsx`: fixed new formula display and legacy-compatible settings round-trip.
- `pages/execution-results.tsx`: exact simulated Email recipient/body/version and legacy missing-field handling.
- `lib/arus.ts`, `lib/advice-snapshot.ts`: English historical-display fallback; no stored history rewrite.
- `components/kit.tsx`, `components/shell.tsx`, `components/provider-details.tsx`, `components/advice-snapshots.tsx`, `pages/login.tsx`, `pages/dashboard.tsx`, `pages/receivables.tsx`, `pages/esg-documents.tsx`, `pages/risk-triggers.tsx`, `pages/audit-logs.tsx`: English interface cleanup and compatible shared presentation.

### Contracts and verification

- `lib/api-spec/openapi.yaml`: new input/result schemas, two endpoints and optional backward-compatible fields.
- Generated `lib/api-client-react/src/generated/api.ts`, `api.schemas.ts`, `lib/api-zod/src/generated/api.ts` and associated generated types: produced by codegen, not hand-edited.
- `artifacts/api-server/tests/mvp.test.ts`: 15 new test cases.
- `tests/legacy-fixture.ts`: original regression cases explicitly use the historical scoring fixture. Updated imports in workflow, Gemini compatibility, managed OpenAI, startup, safety, phase-one, phase-two and audit test files; their original assertions remain.
- `tests/isolated-postgres.test.ts`: full real local API round-trip; immutability test now explicitly creates its own snapshot rather than relying on seed history.
- `test-workflow.mjs`: runs the new MVP suite.
- `tests/mvp-browser-fixture.ts`, `test-mvp-preview.mjs`: test-only in-browser API and temporary preview builder/cleaner.
- `scripts/check-english-ui.mjs`, root `package.json`: language gate.
- `.gitignore`, `.replitignore`: exclude generated preview assets from history/deployment.

## Actual final commands and results

| Command | Result |
|---|---|
| `pnpm --filter @workspace/api-spec run codegen` | Passed, including library typecheck |
| `pnpm --filter @workspace/api-server run test:workflow` | **143/143 passed** |
| `pnpm --filter @workspace/api-server run test:isolated-db` | **6/6 passed** |
| `PORT=3000 BASE_PATH=/ pnpm run build` | Language check, all workspace typechecks and production builds passed |
| `git diff --check` | Passed |
| `node test-mvp-preview.mjs` / `--clean`, from API directory | Generated and then removed isolated preview; copied output also cleaned |

Temporary PostgreSQL used private Unix sockets and a replaced child-only URL. Local Express listened on an ephemeral loopback port. The six tests exercise row-lock concurrency, abandoned lease recovery, snapshot rollback, workspace association, GET contracts, and the full new API workflow. Temporary databases were stopped and removed.

The original test assertions were not weakened to accept new behavior. They run against an explicitly named legacy fixture; new tests exercise the production split default.

## Defects found and fixed

1. JSONB changes object-key order. Source fingerprints and split-configuration comparison now use canonical JSON so legitimate persisted data is not rejected solely because of serialization order. A reversed-key regression and real cross-process tests cover this.
2. The immutability test assumed every seed plan already had advice snapshots. It now explicitly creates a test snapshot; no production history was backfilled.
3. New customer-folder risk text initially mentioned payment history as a computed input. It now accurately attributes the existing rule to invoice overdue days and outstanding amounts.
4. Parsed AI language checks reject both literal Han and JSON-escaped Han, preventing an encoding bypass.
5. A whitespace issue in navigation source was removed.

Existing noncanonical fingerprints are not silently rewritten. Older active plans may need recalculation and fresh review/approval after activation; historical scoring and advice records remain intact.

## Browser verification

A real browser used the production frontend mounted over an **in-browser synthetic API**, with an abort guard installed before navigation. No genuine `/api/` network request was observed and no external fetch was attempted by the fixture.

Verified: profile v1; malformed SEDG JSON rejected; valid unverified SEDG accepted without rating change; Rules planner; separate queues; CUS-003 review -> Pending v2; explicit merge -> Pending v3; exact v3 approval; simulation of all 20 tasks; unchanged scores/initial ranks/financial fields; audit events; safe reload from fixture session state.

This does not establish shared-server persistence or real-model compatibility. The browser fixture uses a deterministic test-only checksum in place of Node crypto; real SHA-256 and PostgreSQL behavior are exercised separately in Node/API tests. The offline fixture omitted healthz during the run, explaining its unavailable-health badge; a mock health response was added for future runs, but the run was not repeated to claim that badge verified.

At 390 x 844 the Execution Results document had 36px of horizontal overflow. Desktop behavior passed; the minor mobile issue remains. Production Vite reports the existing large-chunk warning.

## Language check scope

132 files: administrator `src`, public text excluding generated checks, server business/routes, tests/fixtures, administrator HTML and OpenAPI. Zero literal Han-containing locations.

Exclusions: uploaded source material, historical reports, agent memory, dependencies, generated/build output and all database content. Malay Latin-script drafts are allowed. Unicode escapes in rejection tests are technical negative fixtures, not rendered content.

Changed workflow screens were checked in the browser; all website routes, loading/error branches and arbitrary historical records were not exhaustively browser-verified. This is not a claim of complete linguistic classification of arbitrary English-looking text.

## Demonstration sequence after separately authorized activation

1. Keep Rules mode; do not enable or invoke a model.
2. Open Customers and a company folder. Import/edit structured synthetic company information and retain the explicit existing-rating provenance.
3. Enter/import synthetic SEDG JSON, attest synthetic data, submit, inspect the unverified history.
4. Trigger risk detection or generate from AI Collection Planner; inspect separate 2D/3D scores and queue ranks.
5. In Approval Center, review every 2D customer and record Collect now or Negotiable extension plus a reason. Each save selects a new Pending version.
6. Adjust final order if needed, provide the merge reason and confirm. Verify the new selected version and unchanged algorithm scores.
7. Approve that exact version. Any later edit resets merge and requires new approval.
8. Open Execution Results, execute the approved plan in simulation, inspect reserved recipient, final bilingual body, actor/time/version and no-delivery declaration.
9. Inspect Audit Logs and advice snapshots for scoring, review, merge, approval and simulation events. Raw model text remains unretained.

## Activation and remaining boundaries

The shared API workflow was **not restarted** and the shared database was **not accessed by these tests**. Source/build completion does not prove the currently running shared API loaded the new code. Controlled activation and shared read-only checks require separate permission; do not reset/backfill existing data to make the new flow appear ready.

Real managed OpenAI generation remains unverified and needs separate explicit cost authorization. Formal authentication, independent ESG/identity/file verification, NLP extraction, real email and raw-response retention remain out of scope. Existing workspaces may lack the new profile fields and remain unknown until an administrator explicitly imports synthetic existing ratings.
