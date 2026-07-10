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

## Database layer (`packages/db`)

The schema is the deepest part of the codebase: **95 Prisma models + 60 enums across 115
hand-written, hand-reviewed migrations** covering the full clinical domain — patients,
encounters, examinations, surgery (safety checklists, IOL lens lots, surgical kits), billing
(invoices, payments, two-stage refunds, cash-register closures, commissions), pharmacy POS
(batch stock, returns, cash handover), procurement, fraud rules, consent, recall, messaging,
and the AI agent's own tables (config revisions, conversations, tool actions).

Design decisions worth reading in the migrations:

- **Row Level Security as the tenancy boundary** — every tenant table carries a null-safe
  `tenant_isolation` policy (135+ RLS statements across migrations). The API runs with a
  dedicated non-`BYPASSRLS` role inside per-request tenant transactions, so a missing `WHERE
  tenant_id` in application code cannot leak data. Background/cross-tenant work uses a separate
  `BYPASSRLS` non-superuser role; migrations run as a third, schema-owning role
  (`docker/postgres/init.sh` bootstraps all three).
- **Partitioned audit log** — `audit_logs` is monthly `PARTITION BY RANGE` with automated
  partition creation and retention-based drops, so 180-day retention is a cheap
  `DROP TABLE`, not a `DELETE` storm.
- **Offline-first sync scaffolding** — `sync_outbox` / `sync_conflicts` tables (trigger-fed,
  RLS-scoped) queue every tenant mutation for the hybrid local↔cloud replication model.
- **Race-free counters** — patient MRNs come from an atomic
  `INSERT … ON CONFLICT … RETURNING` counter per (tenant, year), formatted with a Verhoeff
  check digit; invoice numbers use the same pattern.
- **Concurrency where it matters** — IOL lens inventory uses a 3-state quantity model
  (available/reserved/consumed) with an optimistic-concurrency `version` column and
  conditional `updateMany`; appointment overlaps are excluded with a `btree_gist` range
  constraint; fuzzy patient search runs on `pg_trgm` GIN indexes (every OR-branch indexed).
- **Schema/DB drift is a CI concern** — raw-SQL indexes and partial constraints are mirrored
  back into `schema.prisma` (or documented inline when Prisma can't model them), verified with
  `prisma migrate diff`, so generated migrations never silently plan to drop hand-built indexes.

Seeds are split by purpose (`seed.ts` dev fixtures, `seed-realistic.ts` demo data,
domain seeds for pharmacy/S15) and are **dev-only by policy** — staging and production
never run synthetic data.

## How we build it (engineering practices)

This is a two-developer team shipping ~20 PRs/day with heavy AI-agent assistance, so the
process is designed to make mistakes structurally impossible rather than rely on discipline:

```
  dev laptops (git worktrees, one per issue/session)
        │  push → PR → review
        ▼
  GitHub ──► CI on self-hosted runners
        │      fast PR gate: lint · tsc · build · unit  (+ Docker build gate)
        │      heavy suite: e2e + Playwright on schedule
        │
        │ squash-merge to main
        ├───────────────────────────────┐
        ▼                               ▼
  staging box (private Tailscale     container registry
  mesh, no public exposure)          (last green image)
    local build · docker compose        │  pull, off-hours
        │                               ▼
        │ telemetry ~30 s          clinic appliance (in-clinic primary, LAN)
        ▼                            backup → migration rehearsal → deploy
  live status panel                  → health check → auto-rollback
  (airmed-monitor)                      │
                                        ▼
                                   encrypted offsite backups
```

The staging box streams telemetry to a **live status panel** —
[airmed-monitor](https://github.com/dereyurtali/airmed-monitor), a single-file,
dependency-free dashboard (public UI shell; the data stays in a private repo) that shows
CI runs with per-step progress, deploys, host vitals, and the merge log at a glance.

- **Worktree-isolated parallel sessions** — every change lives in its own git worktree
  (one issue = one branch = one worktree = one session). Claude Code `PreToolUse` hooks
  physically **block** file edits and commits in the main clone, so multiple concurrent
  AI/human sessions can never commit onto each other's branches. Branch names embed the issue
  number, making collisions impossible by construction.
- **Two-lane CI on self-hosted runners** — every PR gets a fast blocking gate (lint with 0
  warnings, strict `tsc`, full build, unit tests — minutes, not hours) plus a Docker
  build gate for all three images. The heavy suite (Jest e2e with per-worker isolated
  databases, Playwright) runs on a schedule and on demand, with a one-variable switch to
  make it per-merge once real patient data goes live. Local buildx layer caches keep image
  builds fast without shipping layers over the network.
- **Merge → staging automatically** — every squash-merge to `main` is built locally by the
  runner and deployed to a staging box with `docker compose`. Staging is reachable **only over
  a private Tailscale mesh** — no public DNS, no exposed ports, and by policy it never
  receives production data (not even masked).
- **Pull-based production deploys** — the clinic appliance is never SSH'd into by CI. It
  pulls the last green image from the registry on an off-hours schedule and runs a deploy
  script that does: backup → **in-box migration rehearsal against a copy** → `migrate deploy`
  → health check → automatic rollback on failure. Activation is double-gated behind a repo
  variable and a GitHub Environment with required reviewers.
- **Data-residency by architecture** — the primary server lives inside the clinic (staff use
  the LAN; no per-desk VPN or installs), with encrypted offsite backups. The only publicly
  reachable surface of the whole system is a single allowlisted webhook path for the patient
  assistant; both apps stay inside the mesh.
- **AI agents with guardrails** — a CI pipeline lets a Claude Code agent turn triaged bug
  issues into **draft** PRs from PII-scrubbed error context; merging is always human, and the
  same red/green CI gates apply. Repo-committed agent instructions, shared memory files, and
  hooks keep both developers' AI sessions consistent.
- **Boring, auditable git** — conventional commits (commitlint-enforced), short-lived
  branches, squash merges, gitleaks in pre-commit *and* CI, secret-free repo history.

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
