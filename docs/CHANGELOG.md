# Changelog

## Integration, deploy and review fixes (2026-11-14), synthetic data only

### Deploy
- Free demo Blueprint `infra/render.free.yaml` is live as Blueprint `ari-pst-demo` (branch `main`, Frankfurt, free): web service `ari-demo-api-7teo`, database `ari-demo-db-7teo`. Free services have no `preDeployCommand`, so the start command runs `scripts/render-predeploy.mjs` and then the API. See `deployment.md` section 13.
- PR #1 merged the code into `main`. PR #7 is open.
- `db/bootstrap.sql` grants `USAGE, CREATE` on schema `public` to `app_migrator` and `USAGE` to `app_core` (Render makes its user the owner of `public`). `db/migrate.mjs` grants `SELECT` on `public.schema_migrations` to `app_core`. `/readyz` reads `portal.migration_level()`.

### Security and dependencies
- `nodemailer` and `@fastify/static` upgraded (`apps/api`). `zod` 4 and the latest `@hookform/resolvers` in `apps/web`. `apps/web/src/zod-config.ts` sets `z.config({ jitless: true })`, so the strict CSP needs no `unsafe-eval`.
- AES-GCM in `apps/api/src/adapters/auth-local` uses `authTagLength: 16` and rejects a malformed IV or tag.
- Review fixes (REVIEW-1, `REVIEW-2026-11.md`): adding a second factor to an account that has one needs a fresh step-up; a `national_coordinator` search now reports the `k` of the policy (it always reported 5). Both have tests in `apps/api/test`.

### CI
- `cms-guard` regex no longer matches its own step. Container scan runs the pinned trivy image. SBOM uses `cyclonedx-npm --ignore-npm-errors`. Licence check runs per app with `--excludePrivatePackages`.

### UI
- QA fixes from `qa/BUGS.md`, section "Fix verification": QA-003 to QA-009, QA-011, QA-012. Request status in `apps/web` uses the canonical enum (`closed` + `closeReason`).

### Test counts (local run, 2026-11-14)
`pnpm -r --if-present test`: 455 tests pass (api 55, db 134, design-system 114, public-site 50, web 48, domain 35, synthetic-data 9, api-client 5, i18n 5).

## Phase 1 build (2026-11-13), synthetic data only

Status: built and in verification. No real data. See `KNOWN-ISSUES.md` for gaps. Test results are not claimed here; run the commands in `README.md`.

### Added
- **Monorepo and rules.** pnpm workspaces, `pnpm arch` (dependency-cruiser: the domain imports no platform library), CI workflows in `.github/workflows/` with `ci-gate` as the single required check.
- **Domain core (`packages/domain`).** Roles and capabilities, request state machine (canonical C-01 enum), N-of-M voting, k-anonymity rules, staleness, session policy, import rules, identifier guard, ports.
- **Contract.** `packages/contracts/openapi.yaml` (OpenAPI 3.1, `x-roles` on every operation, `/livez`, `/readyz`). Generated client in `packages/api-client`.
- **Database (`db/`).** `bootstrap.sql` (C-06 roles), forward-only migrations 0001 to 0010 (foundation, core tables, audit hash chain, RLS and grants, governance, request workflow, privacy engine, search and retention and import, break-glass and export, API support), runner `migrate.mjs`, vocabulary seed, SQL tests (privacy, security, workflow, performance).
- **API (`apps/api`).** Fastify, ten modules (identity-access, sample-index, search-discovery, access-requests, audit-log, center-ingestion, admin-governance, notifications, observability, public-site), adapters (postgres, auth-local with Argon2id, passkeys and TOTP, objectstore, email, clock), jobs (staleness, audit-verify, purge, export, snapshot, seed-synthetic), serves the SPA from `WEB_DIST_DIR`.
- **Protected app (`apps/web`).** React and Vite SPA, he and en, RTL, role-based route table, mock server, Playwright tests.
- **Public site (`apps/public-site`).** Astro static site, he and en, Decap CMS with editor isolation (`cms-guard`, `CMS-SECURITY.md`), consent-based analytics, forms.
- **Shared packages.** `design-system` (tokens, components, gallery, logical CSS only), `i18n`, `synthetic-data`.
- **Delivery.** `render.yaml` (one `ari-api` serves API and SPA, `ari-public`, `ari-db`, five crons), generated staging Blueprint, conftest policy, smoke, backup and restore-drill scripts, deploy workflow with a GitHub Environment approval.
- **Docs.** Architecture, deployment guide, operating model, runbooks RB-01 to RB-08, QA scripts and screenshots under `docs/qa/`.

### Documentation changes in this pass (DOCS-1)
- Canonical decisions C-01 to C-21 applied to the plan documents (see `DOCS-AUDIT.md`).
- Plan index files updated with a build status. `docs/KNOWN-ISSUES.md` and `docs/DOCS-AUDIT.md` added.
- Deviation recorded: no `ari-app` and no `ari-internal` service (C-04 amendment).
