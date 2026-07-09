# AirMed-HBYS

**Multi-tenant Hospital Information System with an LLM-powered patient assistant — built for ophthalmology clinics**

> NestJS · Prisma · tRPC · Zod · React · Vite · PostgreSQL 16 (RLS) · TypeScript strict · Claude / OpenRouter LLMs

AirMed-HBYS is a production HIS for ophthalmology clinics in Central Asia and Türkiye
(TR / RU / TG trilingual UI). This repository is a **sanitized public snapshot** of the private
production monorepo: commercial documents, client materials, and deployment/infrastructure
internals have been removed; the full application code, schema, and test suites are intact.

## AI patient assistant (`apps/api/src/automation/`)

An LLM agent that talks to patients over **WhatsApp / Telegram / Instagram** (via Chatwoot
webhooks) and books real appointments directly in the HIS:

- **Agentic tool-use loop** — `agent-orchestrator.service.ts` runs a multi-turn model loop
  where the LLM calls typed tools (`agent-tools.service.ts`) that execute against the same
  audited domain services the staff UI uses: patient lookup/registration, doctor availability,
  appointment booking/rescheduling, clinic FAQ from a DB-managed knowledge base.
- **Three-phase transaction design** — read-tx → model loop (deliberately _outside_ any DB
  transaction, so an LLM round-trip never holds a connection) → write-tx; every tool call runs
  in its own short tenant-scoped RLS transaction.
- **Provider abstraction** — `model-provider.ts` supports Anthropic (Claude) and OpenRouter
  backends behind one interface; model, temperature, and budgets are runtime-configurable.
- **Prompts & knowledge base are data, not code** — system prompt and clinic KB live in the DB
  with revision history and an admin UI; iterating on the prompt requires zero deploys.
  `default-system-prompt.ts` only seeds the "reset to default" action.
- **Secrets handled properly** — bot tokens / API keys are AES-256-GCM encrypted at rest
  (`secret-crypto.service.ts`), write-only through the API (last-4 display), never returned in
  plaintext.
- **Human handover** — the bot answers only `pending` conversations; staff can take over in
  Chatwoot and hand back from the HIS; conversation status syncs bidirectionally.
- **Fail-safe ingestion** — signed webhook, queue-based worker (`automation.worker.ts`),
  503 fail-closed when unconfigured; full unit test coverage across orchestrator, tools,
  ingest, and admin services.

There is also an **auto-fix agent pipeline** in CI (label a bug issue → a Claude Code agent
reads the scrubbed error context and opens a draft PR — never merges; humans review) and
**PII-scrubbing observability** (`packages/observability`) so error reports carry structure,
never patient data.

## Platform highlights (beyond AI)

- **Multi-tenancy with PostgreSQL Row Level Security** — every tenant query runs inside an RLS
  transaction with a dedicated non-`BYPASSRLS` DB role; cross-tenant access uses a separate
  audited role. Isolation is enforced at the database, not just the application layer.
- **Two products, one backend** — clinic app (`apps/web`, tenant JWT) and platform admin panel
  (`apps/admin`, separate JWT + mandatory TOTP + IP allowlist) share one NestJS API with
  strictly separated `/api/*` and `/platform/*` surfaces.
- **End-to-end typesafe API** — tRPC v11 + Zod schemas shared between backend and frontend; a
  single permission registry package (`@airmed/contracts`) imported by both sides makes
  role/permission drift structurally impossible.
- **Clinical workflow engine** — appointment → check-in → payment gate → measurement station →
  examination → surgery pipeline with service-layer business rules (pay-before-service,
  consent-before-surgery, eye-laterality (OD/OS) enforcement, doctor concurrency caps,
  3-state IOL lens inventory with optimistic concurrency).
- **Role / attribute / mode authorization** — 10 clinic roles plus per-user attributes
  (e.g. visiting doctor) and login-time modes (e.g. nurse kiosk mode with a locked permission
  allowlist baked into the JWT), all enforced server-side.
- **Quality gates** — ESLint (0 warnings), strict `tsc`, Jest unit + e2e (per-worker isolated
  DBs), Vitest, Playwright, gitleaks + semgrep + npm-audit CI, Docker build gates.

## Architecture

| Layer    | Frontend   | Backend prefix | Auth                                 |
| -------- | ---------- | -------------- | ------------------------------------ |
| Clinic   | apps/web   | `/api/*`       | Tenant JWT (15 min + refresh cookie) |
| Platform | apps/admin | `/platform/*`  | Platform JWT + TOTP + IP allowlist   |

```
airmed-hbys/
├── apps/
│   ├── api/            # NestJS 11 — clinic + platform endpoints, tRPC router
│   │   └── src/automation/   # ← LLM patient assistant (orchestrator, tools, providers)
│   ├── web/            # React 18 clinic UI (trilingual, role-aware sidebar)
│   └── admin/          # React platform admin (monitoring, tenants, security)
├── packages/
│   ├── contracts/      # Shared permission registry (single source of truth)
│   ├── db/             # Prisma schema + migrations + seeds
│   └── observability/  # PII scrubber for error reporting
├── docker/             # Postgres bootstrap (roles, extensions)
└── .github/workflows/  # CI: lint + typecheck + build + tests + security
```

## Getting started (development)

```bash
docker compose up -d      # Postgres 16 + Redis
npm install
cp .env.example .env      # fill in generated secrets
npm run db:generate
npm run db:migrate
npm run dev               # api :3001 · web :5173 · admin :5174
```

Health check: `curl localhost:3001/api/health`

First admin account: `npm run admin:bootstrap` (interactive CLI — creates tenant, default
roles, and an administrator with a one-time password).

## Stack

| Layer    | Tech                                                      |
| -------- | --------------------------------------------------------- |
| Backend  | NestJS 11 + Prisma 5 + tRPC v11 + Zod                     |
| AI       | Anthropic Claude / OpenRouter, agentic tool-use, Chatwoot |
| Frontend | React 18 + Vite 5 + shadcn/ui + Tailwind + React Query    |
| DB       | PostgreSQL 16 + RLS (`pg_trgm`, `btree_gist`, partitions) |
| Auth     | JWT + httpOnly refresh cookie + bcrypt(12) + TOTP         |
| i18n     | Türkçe / Русский / Тоҷикӣ                                 |
| CI       | GitHub Actions (self-hosted), gitleaks, semgrep, Docker   |

## License

Proprietary — all rights reserved. Published for portfolio/review purposes only;
no license is granted for use, copying, or redistribution.
