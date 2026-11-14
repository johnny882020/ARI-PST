# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is
ARI-PST Portal: a national index of de-identified pediatric solid-tumor samples (Hebrew RTL + English), plus a public site. Source product spec is the Hebrew "מסמך תפיסה ואפיון" v1.0; its requirements are `REQ-001..072` in `plan/00-contract-pack.md`. The portal holds an **index, never identified data**. Tissue and identity stay in the medical centers.

## Read order before changing anything
1. `plan/00-contract-pack.md` — binding: requirements, roles, decision gates, naming rules, file ownership.
2. `plan/11-integration/canonical-decisions.md` — **wins over every agent plan** (request-state enum, session/cookie/origin model, DB role model, retention, k floor).
3. `plan/10-review/red-team.md` — known attack paths. Do not reintroduce them.
Other plan folders `01`–`09` are area designs. If code and plan disagree, the canonical-decisions file decides.

## Commands
Monorepo uses pnpm workspaces (Node ≥ 22.18, pnpm 10).
```
pnpm install
pnpm test                          # all packages that define a test script
pnpm --filter @ari/domain test     # one package
pnpm --filter @ari/domain exec vitest run src/request-state.test.ts   # one test file
pnpm typecheck | pnpm lint | pnpm build
pnpm arch                          # dependency-cruiser: fails if domain/api break boundary rules
```
Database tests need a local PostgreSQL 16 (binaries in `/usr/lib/postgresql/16/bin`). `pnpm --filter @ari/db test` runs `db/scripts/test-db.sh` (throwaway cluster on port 55432: `db/bootstrap.sql`, then `db/migrate.mjs` as `app_migrator`, then vitest). API integration tests use `apps/api/scripts/test-db.sh` (port 55433). The migration runner reads `DATABASE_URL_MIGRATOR`; see the header of `db/migrate.mjs`.
Other useful commands: `pnpm --filter @ari/web mock` (mock API), `pnpm --filter @ari/web test:e2e` (Playwright), `pnpm --filter @ari/api-client gen:check` (generated client matches the OpenAPI spec), `python3 scripts/verify-render-yaml.py` (all three Blueprints), `bash scripts/smoke.sh`, `pnpm test:e2e:full` (simulated Render database on port 55435, pre-deploy step, API on 18080, browser flow).

## Architecture (big picture)
- **Modular monolith, hexagonal.** `packages/domain` holds pure rules and ports (Repository, Auth, ObjectStore, Mailer, Clock, Audit). It must import **no** platform library (pg, fastify, aws-sdk, nodemailer…). `pnpm arch` enforces this. Platform code lives only in `apps/api/src/adapters/*`. This keeps a later move from Render to Base44 cheap.
- **Contracts first.** `packages/contracts/openapi.yaml` (OpenAPI 3.1) and `db/migrations/*.sql` are the stable interfaces. `packages/api-client` is generated from the spec; do not hand-edit generated types. Every operation carries `x-roles`; the authz-matrix tests generate from it.
- **Privacy is enforced in the database, not only the API.** Row-Level Security by center. External roles (`researcher_il`, `researcher_intl`) have **no** grant on sample rows. They get counts only through `SECURITY DEFINER` functions that apply k-anonymity (k ≥ 5, distinct-donor counts, neighbour/complement suppression). The UI shows "Too few to show" and never prints a threshold.
- **Request workflow** is one state machine (`packages/domain/src/request-state.ts`), mirrored by DB triggers and N-of-M committee voting. Close reasons (`withdrawn`, `expired`, …) are not states.
- **Same-origin deployment.** SPA at `/`, API at `/api/v1`, cookie `__Host-sid` (Strict) + `__Host-csrf`. No CORS in production, except `POST /api/v1/public/forms/*` from `PUBLIC_SITE_ORIGIN` (no credentials). Strict CSP with no `unsafe-eval`: `apps/web` keeps zod 4 in jitless mode (`apps/web/src/zod-config.ts`, imported first).
- **Two front ends.** `apps/public-site` (Astro static, Git-based Decap CMS) and `apps/web` (React + Vite SPA for the protected area). Shared UI in `packages/design-system`; strings in `packages/i18n` (he default).
- **Two-step coding.** The portal issues random code blocks; centers map them locally. No link key is ever stored. A clinician sees the coded own-center record plus a link out to the center's own system.

## Hard rules
- **Synthetic data only** in every environment, until `GATE-PROD-DATA` closes (DPA, region control, export round trip, migration path, legal review, pen-test). Never add real or realistic personal data to code, tests, fixtures, logs or docs. Use `packages/synthetic-data`.
- Never put direct identifiers, link keys, free-text clinical notes or exact dates into the index. Sample collection date is `YYYY-MM` only.
- Logs and errors carry no identifiers. Errors use RFC 9457 problem+json.
- CSS uses **logical properties only** (no `margin-left`, `left:`, `text-align:left`…); a test checks this.
- `system_admin` cannot approve requests, read sample data, or change `k` alone. Role grants and `k` changes need a second approver.
- Migrations are forward-only, expand/contract, and run as `app_migrator`, not the runtime role. SQL tests must run as the real non-superuser roles.
- Legal and regulatory statements are "needs legal review". Do not present them as advice.

## Delivery
Git is the source of truth; auto-deploy to Render via `render.yaml` (Blueprint). The live demo today is the free-plan Blueprint `infra/render.free.yaml` (Blueprint `ari-pst-demo`, service `ari-demo-api-7teo`, database `ari-demo-db-7teo`, branch `main`, manual deploy); its start command runs `scripts/render-predeploy.mjs` before the server because free services have no pre-deploy step. The hand-made service `ARI-PST` is broken and will be deleted. Public site deploys after CI passes. The protected area waits for a GitHub Environment approval, then a Render deploy hook. Preview environments use synthetic data. Render has no built-in approval gate, so this design is deliberate. See `docs/deployment.md` (section 12 known gaps, section 13 free demo), `docs/KNOWN-ISSUES.md` and `docs/REVIEW-2026-11.md`. `render.com` may be blocked in the Claude session network, so Render facts in the plan are partly UNVERIFIED.

## Working with the plan and agents
- Parallel build agents own separate folders; do not edit another agent's folder. Cross-agent needs go in `plan/requests/<from>-to-<to>.md`.
- Agents do not commit; the orchestrator commits and pushes to `claude/sweet-allen-jpkmu4`.
- Open decisions live in `plan/decision-register.md`; use the default in the contract pack until a gate closes. Do not decide a gate silently.
