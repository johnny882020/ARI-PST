# Changelog

## Phase 1 build (2026-11-13), synthetic data only

Status: built and in verification. No real data. See `KNOWN-ISSUES.md` for gaps. Test results are not claimed here; run the commands in `README.md`.

### Added
- **Monorepo and rules.** pnpm workspaces, `pnpm arch` (dependency-cruiser: the domain imports no platform library), CI workflows in `.github/workflows/` with `ci-gate` as the single required check.
- **Domain core (`packages/domain`).** Roles and capabilities, request state machine (canonical C-01 enum), N-of-M voting, k-anonymity rules, staleness, session policy, import rules, identifier guard, ports.
- **Contract.** `packages/contracts/openapi.yaml` (OpenAPI 3.1, `x-roles` on every operation, `/livez`, `/readyz`). Generated client in `packages/api-client`.
- **Database (`db/`).** `bootstrap.sql` (C-06 roles), forward-only migrations 0001 to 0009 (foundation, core tables, audit hash chain, RLS and grants, governance, request workflow, privacy engine, search and retention and import, break-glass and export), runner `migrate.mjs`, vocabulary seed, SQL tests (privacy, security, workflow, performance).
- **API (`apps/api`).** Fastify, ten modules (identity-access, sample-index, search-discovery, access-requests, audit-log, center-ingestion, admin-governance, notifications, observability, public-site), adapters (postgres, auth-local with Argon2id, passkeys and TOTP, objectstore, email, clock), cron jobs (staleness, audit-verify, purge, export), serves the SPA from `WEB_DIST_DIR`.
- **Protected app (`apps/web`).** React and Vite SPA, he and en, RTL, role-based route table, mock server, Playwright tests.
- **Public site (`apps/public-site`).** Astro static site, he and en, Decap CMS with editor isolation (`cms-guard`, `CMS-SECURITY.md`), consent-based analytics, forms.
- **Shared packages.** `design-system` (tokens, components, gallery, logical CSS only), `i18n`, `synthetic-data`.
- **Delivery.** `render.yaml` (one `ari-api` serves API and SPA, `ari-public`, `ari-db`, four crons), generated staging Blueprint, conftest policy, smoke, backup and restore-drill scripts, deploy workflow with a GitHub Environment approval.
- **Docs.** Architecture, deployment guide, operating model, runbooks RB-01 to RB-08, QA scripts and screenshots under `docs/qa/`.

### Documentation changes in this pass (DOCS-1)
- Canonical decisions C-01 to C-21 applied to the plan documents (see `DOCS-AUDIT.md`).
- Plan index files updated with a build status. `docs/KNOWN-ISSUES.md` and `docs/DOCS-AUDIT.md` added.
- Deviation recorded: no `ari-app` and no `ari-internal` service (C-04 amendment).
