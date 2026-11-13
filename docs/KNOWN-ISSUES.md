# Known issues and unverified items

Honest list as of 2026-11-13 (Phase 1 build, synthetic data only). Owners are suggestions. Severity: B = blocks first deploy or CI, G = gap in a feature, U = unverified fact, L = needs legal review.

## Build and deploy
| # | Sev | Issue | Owner |
|---|---|---|---|
| 1 | B | `.github/workflows/ci.yml` runs root scripts that `package.json` does not define (`lint:openapi`, `test:portability`, `test:unit`, `test:synthetic-guard`, `test:property`, `db:migrate`, `db:seed-synthetic`, `lint:migrations`, `test:rls`, `test:integration`, `test:contract`, `test:e2e:smoke`, `test:a11y`, `test:trace`). CI fails on purpose until they exist. | Orchestrator |
| 2 | B | `db/migrate.mjs` needs `DATABASE_URL_MIGRATOR`. `render.yaml` sets `DATABASE_URL` only. | DevOps |
| 3 | B | Roles come from `db/bootstrap.sql`, a manual one-time step. The `render.yaml` header says the runner creates them. | DevOps, Data |
| 4 | B | The API tables in schema `authn` are in `apps/api/db-support/0010_api_support.sql`, applied only by `apps/api/scripts/test-db.sh`. They are not in `db/migrations/`. | Data |
| 5 | B | Env var names differ. Code reads `IP_HASH_SALT`, `SECRETS_KEY`, `S3_BUCKET`, `S3_ENDPOINT`, `SMTP_URL`, `MAIL_FROM`, `OBJECT_STORE`. The Blueprint defines `SESSION_SECRET`, `AUDIT_HMAC_KEY`, `CSRF_SECRET`, `OBJECTSTORE_*`. Cron jobs need the same check. | Backend, DevOps |
| 6 | G | Preview seeding (`IS_PULL_REQUEST`, `SEED_SYNTHETIC`) and the `DATA_CLASSIFICATION` start-up guard are not implemented in `apps/api`. | Backend |
| 7 | G | Public site forms post cross-origin to `/api/v1/public/forms/*`. The API sets no CORS headers and C-03 says no CORS. Needs a decision: same host or a narrow CORS rule. | Architect |
| 8 | G | Cron jobs ping `HEARTBEAT_URL_*` and `ALERT_WEBHOOK_URL` per the plan. Not verified in code. | Backend |
| 9 | G | No `db/README.md`. Database instructions are in `CLAUDE.md`, `docs/deployment.md` and the header of `db/migrate.mjs`. | Data |
| 10 | G | Rotation of `SECRETS_KEY` (TOTP encryption) and of `AUDIT_HMAC_KEY` (key versioning) has no tool. | Backend |

## Not built in the protected app
Invite accept (`/invite/:token`), password reset, recovery-code page, sample edit page, request coordination page, audit export page, user detail, invitations, committee settings, content admin, admin health, notifications, metrics dashboards. The API may expose some of these; the UI does not. The Phase 1 acceptance checklist (`plan/04-product-workflow/07-phase1-acceptance-checklist.md`) must be re-checked against this list.

## Unverified (UNVERIFIED)
- Render plan slugs (`pro-4gb`, `starter`), valid disk sizes, PITR window and whether it meets RPO 15 min, `IS_PULL_REQUEST` in previews, preview cron opt-out, name uniqueness across Blueprints, `render blueprints validate`. `render.com` was not reachable from the build session.
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
