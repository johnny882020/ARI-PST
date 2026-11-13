# Known issues and unverified items

Honest list as of 2026-11-13 (Phase 1 build, synthetic data only). Owners are suggestions. Severity: B = blocks first deploy or CI, G = gap in a feature, U = unverified fact, L = needs legal review.

## Build and deploy
Closed by the integration pass (INT-1), verified locally with `pnpm test:e2e:full`: root scripts for CI (old #1), `DATABASE_URL_MIGRATOR` and role bootstrap on Render (#2, #3), API tables in `db/migrations/0010` (#4), env var names (#5), preview seeding and the `DATA_CLASSIFICATION` guard (#6), CORS for the public forms (#7), heartbeat pings after cron runs (#8), `db/README.md` (#9). Also fixed: stale `pnpm-lock.yaml`, API crash with a relative `WEB_DIST_DIR`, `/readyz` did not compare migration levels, no job refreshed the privacy snapshot (QA-002), portal link on the public site (QA-010).

| # | Sev | Issue | Owner |
|---|---|---|---|
| 1 | U | The Render database user must have `CREATEROLE` for `scripts/render-predeploy.mjs`. Verified only on a local PostgreSQL 16 that simulates it. Fallback: `docs/deployment.md` section 3a. | DevOps, owner |
| 2 | U | `render.yaml` hard-codes the hosts `ari-api.onrender.com` and `ari-public.onrender.com` (Blueprints have no variables). If Render assigns other names, public forms and the sign-in link break until the five places are changed (`docs/deployment.md` section 3, step 6). | DevOps, owner |
| 3 | G | `app_core` cannot execute `search.norm()`, so the vocabulary cannot be loaded by the pre-deploy step. The synthetic seed loads it through a coordinator session. Without the seed the diagnosis list is empty. `plan/requests/INT-to-B1.md`. | Data |
| 4 | G | The service `ari-api` holds the owner connection string and the migrator password in its environment (Render runs the pre-deploy step there). The API deletes them from its process at start. A separate one-off job would be cleaner. | DevOps |
| 5 | G | No object store or SMTP is configured in the Blueprint. Uploads live in memory per instance (2 instances: an import staged on one instance cannot be committed on the other). No e-mail is sent: invitations and e-mail verification cannot complete on a deployed stack. | Owner (provide bucket and SMTP) |
| 6 | G | `ari-cron-export` fails daily by design until a break-glass window is opened. Output is plain NDJSON; `BACKUP_AGE_PUBLIC_KEY` is not read by the code. Suspend the cron until the export design is done. | Backend, DevOps |
| 7 | G | Rate limits, the search result cache and the "seen query" budget cache are in process memory. With 2 instances they are per instance (stricter budget, looser rate limit). | Backend |
| 8 | G | Rotation of `SECRETS_KEY` (TOTP encryption) has no tool. Changing the value locks out every TOTP user. | Backend |
| 9 | G | `DEMO_MODE=true` is reported by `/livez` (`checks.demo`). The SPA shows no banner yet (UI files were owned by another agent in this pass). | Frontend |
| 10 | G | `ALERT_WEBHOOK_URL` is not implemented. A failed cron is visible only in Render. | Backend |
| 11 | G | Synthetic users share one password (`SEED_USER_PASSWORD`) and have TOTP secrets derived from it. Acceptable for synthetic data only. The seed must be off before GATE-PROD-DATA closes. | Owner |
| 12 | G | QA-001 (add to cart returned 404 on QA's dev stack) did not reproduce on the production-like stack: the cart step passes in `scripts/e2e-fullstack.mjs`. Likely cause was QA's hand-made seed. QA-013 (401 on first `GET /auth/session`) is unchanged. | QA, Backend |
| 13 | G | `db/seed.mjs` needs a superuser and cannot run on Render. The API job `seed-synthetic` replaces it there. | Data |

## CI gates not yet enforced
`ci.yml` calls only scripts that exist and do real work. These planned gates have no tool or test yet and are NOT enforced. The workflow says so in comments.
| Gate | Today |
|---|---|
| Spectral ruleset on OpenAPI | `lint:openapi` only checks that the generated client matches the spec |
| fast-check property tests | `test:property` runs the privacy attack simulation in `db/tests/privacy.test.mjs` |
| Schemathesis fuzzing, oasdiff breaking-change check | `test:contract` runs the authz matrix and IDOR/contract tests (responses validated against OpenAPI) |
| Migration lint, "old schema from `main` + seed + new migrations" | Not run |
| REQ-to-test traceability (`trace-check`) | Job removed. Tests carry no REQ ids |
| axe on the protected SPA | `test:a11y` covers the public site only |
| Export/import round trip (`roundtrip.yml`) | Schedule removed. A manual run fails on purpose: the tools do not exist |
| CI itself | Not run on GitHub yet. `actionlint` passes. The database jobs assume PostgreSQL 16 binaries at `/usr/lib/postgresql/16/bin` on `ubuntu-24.04` runners (UNVERIFIED) |

## Not built in the protected app
Invite accept (`/invite/:token`), password reset, recovery-code page, sample edit page, request coordination page, audit export page, user detail, invitations, committee settings, content admin, admin health, notifications, metrics dashboards. The API may expose some of these; the UI does not. The Phase 1 acceptance checklist (`plan/04-product-workflow/07-phase1-acceptance-checklist.md`) must be re-checked against this list.

## Unverified (UNVERIFIED)
- Render: database user rights (`CREATEROLE`), `preDeployCommand` on free instances, `RENDER_EXTERNAL_URL` and `RENDER_GIT_COMMIT` in every service, redirect to an external URL from a static site, `NODE_VERSION` handling. Plan slugs (`pro-4gb`, `starter`, `free`), valid disk sizes, PITR window and whether it meets RPO 15 min, `IS_PULL_REQUEST` in previews, preview cron opt-out, name uniqueness across Blueprints, `render blueprints validate`. `render.com` was not reachable from the build session.
- Render has no built-in approval gate. The GitHub Environment plus deploy hook design needs the owner's acceptance.
- CI was not run end to end. Lighthouse CI (`apps/public-site/lighthouserc.json`) was not run. No axe or Lighthouse scores are claimed.
- Pen-test, DAST and the privacy attack simulation at scale were not run on a deployed stack.
- Performance: p95 800 ms at 50,000 records (C-12) is a target. A test exists in `db/tests/perf.test.mjs`; no deployed measurement.

## Content and design
- Fonts (Heebo, Rubik, Assistant) are not bundled. Licence is UNVERIFIED (`packages/design-system/fonts/README.md`). System fallbacks are used.
- Hebrew copy (UI, public site, legal pages) is a machine draft. A Hebrew editor must review it. Diagnosis vocabulary and Hebrew labels need clinical sign-off (GATE-SCHEMA).
- Partner logos are not shipped. Shaare Zedek logo needs permission (`OPEN-LOGO-PERMISSION`, `plan/05-design-brand/partner-logos/README.md`). Logo concept choice is open.
- Accessibility statement and the binding Israeli standard edition need legal review (OPEN-A5-02). Screen reader testing with real users was not done.

## Legal and compliance (L)
All items need legal review: retention periods (C-07), GDPR and Israeli privacy law applicability to coded data, HIPAA, region (Frankfurt, GATE-REGION), DPA with Render and sub-processors, breach notice windows, privacy and terms pages, consent and analytics text. `GATE-PROD-DATA` stays closed: no real data in any environment.

## Open gates
GATE-OPERATOR, GATE-BUDGET, GATE-SCHEMA, GATE-COMMITTEE, GATE-COMPLIANCE, GATE-GENOMICS, GATE-INGEST, GATE-PATHOLOGY, GATE-PROD-DATA. See `plan/decision-register.md`.

## Documentation
- The plan folders keep their original text under short "Superseded by C-xx" notes where they differ from the build. Where an old plan file and `plan/11-integration/canonical-decisions.md` differ, the canonical file wins.
- `plan/07-devops-cicd/examples/` holds the original drafts. The live copies are `render.yaml`, `infra/`, `.github/workflows/`, `scripts/`.
