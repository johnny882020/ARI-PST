# Changelog

All notable changes to the ARI-PST Portal are in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The version is the `version` field of the root `package.json`. The repository has no git tags yet, so each entry names its pull requests.
Every release uses synthetic data only.

## [Unreleased]

### Added
- Password reset (KNOWN-ISSUES M-2). API: `POST /auth/password-reset/request` and `POST /auth/password-reset/confirm` (anonymous, `x-roles: public`, tight per-address rate limit).
  1. The request always answers `202` before the lookup, so the answer and its time do not tell whether an account exists.
  2. Only an active account with a verified e-mail gets a mail (template `password_reset`, he and en). Three mails per address per hour at most.
  3. The link `/reset-password?token=` works once, for 30 minutes. A new request ends the older link. An invite token cannot reset a password.
  4. Confirm checks the password rules before it uses up the token, sets the password, ends all sessions of the user and writes the audit event `auth.password.reset`. The second factor does not change.
- Web: "Forgot your password?" on the sign-in page, `/forgot-password`, `/reset-password`.
- Invite accept page `/invite/:token`. It sets the first password with `POST /auth/verify-email`. Then the first sign-in opens MFA enrolment. The invite e-mail now links to `/invite/<token>`; old `/verify-email?token=` links still work.
- Change-password page `/account/password` (current password, fresh step-up, ends the other sessions).
- Recovery-code page `/account/recovery-codes`: `GET /auth/recovery-codes` returns the count of unused codes (never a code). "Make new codes" needs step-up, shows the codes once with a copy button, and writes the audit event `auth.recovery.regenerate`.
- Requirements validation of REQ-001 to REQ-072 and the spec: [`validation/REQUIREMENTS-VALIDATION.md`](validation/REQUIREMENTS-VALIDATION.md). Implementation roadmap by phase: [`ROADMAP-IMPLEMENTATION.md`](ROADMAP-IMPLEMENTATION.md).
- Step-up dialog in the protected app (6-digit code or recovery code). The API client sends a call refused with `STEP_UP_REQUIRED` once more after the step-up (review R-03).
- Migration `0012`: `app_core` may execute `search.norm()` (review R-13).
- E-mail over an HTTPS API: `MAIL_TRANSPORT=brevo` or `resend` with `MAIL_API_KEY` and `MAIL_FROM`. Use it where SMTP ports are closed (free Render plans). Setup: [`deployment.md` section 13a](deployment.md#13a-e-mail-for-the-demo). The API logs the mail transport at start.
- Google Cloud migration guide, step by step: [`migration/google-cloud.md`](migration/google-cloud.md), with Cloud Run templates, a two-pass Cloud SQL restore script and a local restore rehearsal (PR #9).
- Documentation index [`docs/README.md`](README.md).
- Center coordination screen `/requests/:id/coordination` (coordinator and center clinician). The coordinator links coded samples per item, starts center coordination, answers on behalf of a center, records the MTA/DTA (type, reference, status, signed month) and moves the request to delivery. The holding clinician accepts or declines for the own center, sees the own linked samples and marks delivery. The request closes as `delivered`.
- `center_clinician` can open `/requests` and `/requests/:id` for requests that involve the own center (row-level security decides).
- API: `GET /requests/{id}/resolved-samples` and `GET /requests/{id}/agreements` (with `x-roles`). `RequestStep.accepted`. The MTA/DTA step takes `status` (`draft`, `sent`, `signed`) and `signedMonth` (`YYYY-MM`, not in the future).
- Migration `0011`: agreement status and signed month; delivery needs a **signed** agreement for every accepted center; a clinician reads only the sample links of the own center.
- Clinician link-out to the center system: build-time template `VITE_CENTER_SYSTEM_URL_TEMPLATE` (`https` only, placeholders `{sampleCode}` and `{centerCode}`, opens in a new tab with `rel=noopener`). Without a template the record shows a labelled reference.
- Import rule `ETHICS_UNKNOWN`: the ethics reference is present but not registered for the center.

### Changed
- `POST /auth/password` needs a fresh step-up (5 minutes or less). The contract lists its `401` answer.
- CI container scan has a scoped trivy ignore for the Cloud Run Job example (KSV-0118).
- Documentation rewritten to show the current system only. Runbooks use one template.
- The researcher tracker and the requests list say "Closed – delivered" for a delivered request.
- `pnpm test:e2e:flows` flow f runs through the UI only (no `[api]` steps). The script always rebuilds `apps/api`.

### Fixed
- A vote, decision, role grant, `k` change or registration decision more than 5 minutes after sign-in sent the user to "Session ended". The `401 STEP_UP_REQUIRED` answer now opens the step-up dialog and keeps the session.
- The pre-deploy step could not load the diagnosis vocabulary without the synthetic seed, so a real-data deployment could not create or import samples. Fixed by migration `0012`.
- Migration `0011` failed on a database that already held MTA/DTA agreements (the live demo): the backfill ran as `app_migrator`, which row-level security blocks, so the new CHECK failed. The backfill now runs as `app_core`. Render kept the previous version live.
- "Mark coordination done" failed with a validation error because no `centerId` was sent. The coordinator now answers per center.
- The cart showed the raw token `10_plus`. It now says "10 or more" (`lt10`: "Fewer than 10").
- Another center's record showed "Something went wrong". It now shows a "Not available" page.
- CSV import said "ethics reference missing" when a reference was present but not registered. That case now has its own rule and message.

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
