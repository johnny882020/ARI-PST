# Changelog

All notable changes to the ARI-PST Portal are in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The version is the `version` field of the root `package.json`. The repository has no git tags yet, so each entry names its pull requests.
Every release uses synthetic data only.

## [Unreleased]

### Added
- Google Cloud migration guide, step by step: [`migration/google-cloud.md`](migration/google-cloud.md), with Cloud Run templates, a two-pass Cloud SQL restore script and a local restore rehearsal (PR #9).
- Documentation index [`docs/README.md`](README.md).

### Changed
- CI container scan has a scoped trivy ignore for the Cloud Run Job example (KSV-0118).
- Documentation rewritten to show the current system only. Runbooks use one template.

### Removed
- `docs/DOCS-AUDIT.md`. Its role moved to [`docs/README.md`](README.md).

## [0.1.0] - 2026-11-14

First Phase 1 release. PR #1 (merged 2026-11-13) brought the code to `main`. PR #7 (merged 2026-11-14) fixed the Render deploy and made CI green.

### Added
- **Monorepo.** pnpm workspaces, `pnpm arch` (dependency-cruiser: the domain imports no platform library), CI with `ci-gate` as the single required check.
- **Domain core** (`packages/domain`). Roles and capabilities, request state machine (canonical enum C-01), N-of-M voting, k-anonymity rules, staleness, session policy, import rules, identifier guard, ports.
- **Contract.** `packages/contracts/openapi.yaml` (OpenAPI 3.1, `x-roles` on every operation, `/livez`, `/readyz`). Generated client in `packages/api-client`.
- **Database** (`db/`). `bootstrap.sql` (roles C-06), forward-only migrations 0001 to 0010, runner `migrate.mjs`, vocabulary seed, export and import, SQL tests (privacy, security, workflow, governance, audit, retention, round trip, performance).
- **API** (`apps/api`). Fastify, ten modules, adapters (postgres, auth-local with Argon2id, passkeys and TOTP, object store, e-mail, clock), jobs (staleness, audit-verify, purge, export, snapshot, seed-synthetic). Serves the SPA from `WEB_DIST_DIR`.
- **Protected app** (`apps/web`). React and Vite SPA, he and en, RTL, role-based route table, e-mail verification and MFA setup screens, mock API, Playwright tests.
- **Public site** (`apps/public-site`). Astro static site, he and en, Decap CMS with editor isolation (`cms-guard`), consent-based analytics, forms.
- **Shared packages.** `design-system` (tokens, components, gallery, logical CSS only), `i18n`, `synthetic-data`.
- **Delivery.** Production Blueprint `render.yaml`, generated staging Blueprint, free demo Blueprint `infra/render.free.yaml`, Blueprint policy, pre-deploy, smoke, seed-credentials, backup and restore-drill scripts, deploy workflow with a GitHub Environment approval, full-stack test `pnpm test:e2e:full`.
- **Free demo** on Render: Blueprint `ari-pst-demo`, service `ari-demo-api-7teo`, database `ari-demo-db-7teo`, Frankfurt. The start command runs `scripts/render-predeploy.mjs` and then the server.
- **Docs.** Architecture, deployment guide, operating model, runbooks RB-01 to RB-08, QA report and screenshots, code review.

### Changed
- Request status in `apps/web` uses the canonical enum (`closed` plus `closeReason`). The API client was regenerated.
- Dependencies: `nodemailer` and `@fastify/static` (`apps/api`), `zod` 4 and `@hookform/resolvers` (`apps/web`).

### Fixed
- `/readyz` on Render: `db/bootstrap.sql` grants `USAGE, CREATE` on schema `public` to `app_migrator` and `USAGE` to `app_core`. `db/migrate.mjs` grants `SELECT` on `public.schema_migrations` to `app_core`.
- QA UI bugs QA-003 to QA-009, QA-011 and QA-012 (`qa/BUGS.md`). QA-002: the `snapshot` job refreshes search counts.
- CI jobs `cms-guard`, container scan, SBOM and licence check.

### Security
- Adding a second factor to an account that has one needs a fresh step-up (review R-01).
- A `national_coordinator` search reports the `k` of the policy (review R-02).
- AES-GCM for TOTP secrets uses `authTagLength: 16` and rejects a malformed IV or tag.
- `apps/web/src/zod-config.ts` sets `z.config({ jitless: true })`, so the CSP needs no `unsafe-eval`.
- Dependency graph enabled for `dependency-review-action`.
