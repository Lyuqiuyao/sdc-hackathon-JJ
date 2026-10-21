# Arus — SME Receivables Risk & AI Collection Scheduler

中小微企业应收账款风险预警与 ESG 加权催收排程管理员演示系统。

## Run & Operate

- Start the managed workflows `artifacts/api-server: API Server` and `artifacts/receivables-admin: web`; they supply ports and routing.
- `pnpm --filter @workspace/api-server run dev` — API workflow command
- `pnpm --filter @workspace/receivables-admin run dev` — web workflow command
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React, Vite, Tailwind CSS, Recharts, TanStack Query
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/receivables-admin/src/pages/` — dashboard and ten supporting administrator pages
- `artifacts/receivables-admin/src/components/` — layout, tables, score breakdown and notification views
- `artifacts/receivables-admin/src/index.css` — visual tokens and theme
- `artifacts/api-server/src/lib/receivables/` — typed models, seed, computation, planner, provider contract, CSV validation, transactional persistence and workflow operations
- `artifacts/api-server/src/routes/receivables.ts` — validated HTTP routes
- `lib/api-spec/openapi.yaml` — API contract; regenerate clients after changing it
- `lib/db/src/schema/demo-workspace.ts` — PostgreSQL aggregate schema
- `docs/DEMO_GUIDE.md` — architecture, CSV contract, seven demo scenarios and simulation boundaries

## Architecture decisions

- Demo entities are stored in one typed JSONB aggregate rather than ten normalized tables. This keeps version snapshots and audit entries atomic with workflow changes and allows straightforward migration to normalized repositories later. This is a competition MVP, not a multi-tenant accounting ledger.
- Row locks serialize workflow mutations across browser tabs. An operation and its audit record commit together; failed operations roll back.
- The demo role entry deliberately has no identity protection. All visitors share one synthetic workspace. It must not hold real customer data.
- OpenAI uses Replit AI Integrations managed credentials via the official client template, loaded lazily. Only `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY` configure production calls; NEVER fall back to private `OPENAI_API_KEY`. Responses strict JSON Schema, local validation, 8192 output tokens, 45-second cancellation and zero automatic retries remain. Missing configuration/initialization/errors/timeouts/invalid output retain `rules_fallback`. External I/O stays outside the database row lock; optimistic checks protect edited, stale or approved plans.
- Provider/per-language sources preserve historical OpenAI/Gemini labels. New OpenAI attempts carry optional `connectionMode: replit_managed`; do not infer this on old records. Archived transports/keys remain unused by production. See `docs/REPLIT_MANAGED_OPENAI.md`; legacy direct-provider documentation remains for reference.

## Product

Ten administrator modules: Dashboard, Receivables, Customers, ESG Documents, Risk Triggers, AI Collection Planner, Approval Center, Execution Results, Audit Logs and Settings. Default demo includes 10 customers, 26 invoices, 8 simulated ESG reviews and one pending plan.

## User preferences

See project scope memory for standing exclusions. Visual brief: navy/white/light gray, orange warning, red high risk, green normal; desktop-first responsive SaaS admin.

## Gotchas

- Monetary API values use integer MYR cents; annual late-fee rates use basis points (1200 = 12%). Critical amount products use BigInt integer rounding.
- Current dates use Asia/Kuala_Lumpur. Seed dates are relative to initialization/reset, and statuses are recalculated on every read.
- Changing invoices, settings, ESG validity or the calendar day invalidates existing plan data signatures; Defer & Recalculate before approval/execution.
- Both bilingual drafts are generated; the saved default language controls the initially selected notice tab.
- Reset restores financial demo data but preserves audit history, old plan versions, approvals and execution records; old active plans are superseded.
- For shell verification use typecheck, not frontend build, which depends on workflow-supplied PORT/BASE_PATH.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
