# Known issues

Current gaps of the Phase 1 system (synthetic data only). Owners are suggestions.
Code review findings with file and line references: [`REVIEW-2026-11.md`](REVIEW-2026-11.md). QA bugs: [`qa/BUGS.md`](qa/BUGS.md).

Severity:

| Level | Meaning |
|---|---|
| High | Blocks a production deploy or a core user flow on a deployed stack |
| Medium | A feature or control is weaker than the plan, or an operation needs manual work |
| Low | Polish, hardening or a decision that is still open |

## High

| # | Issue | Owner |
|---|---|---|
| H-1 | No object store and no SMTP are configured. Uploads live in memory per instance: with 2 instances, an import staged on one instance cannot be committed on the other. No e-mail is sent until a mail service is set: `SMTP_URL`, or `MAIL_API_KEY` for Brevo or Resend over HTTPS ([deployment.md section 13a](deployment.md#13a-e-mail-for-the-demo)). Without it, invitations and e-mail verification cannot complete. | Owner (provide bucket and mail key) |
| H-2 | The production Blueprint `render.yaml` is not applied. Plan slugs, `CREATEROLE` for the Render database user and the PITR window are UNVERIFIED (see [Unverified](#unverified)). | Owner, DevOps |

## Medium

| # | Issue | Owner |
|---|---|---|
| M-1 | The SPA has no step-up dialog. Votes, role grants, `k` changes, registration decisions and adding a second factor fail when the sign-in is older than 5 minutes. The user must sign in again. Review R-03. | Frontend |
| M-2 | Not built in the protected app: invite accept page (`/invite/:token`), password reset (no API operation), change-password form, recovery-code page, sample edit page, audit export page, user detail, committee settings, content admin, admin health page, notifications, metrics dashboards. Re-check the Phase 1 acceptance checklist ([`plan/04-product-workflow/07-phase1-acceptance-checklist.md`](../plan/04-product-workflow/07-phase1-acceptance-checklist.md)) against this list. | Frontend, product |
| M-3 | `ari-api` holds the owner connection string and the migrator password in its environment, because Render runs the pre-deploy step there. The free demo keeps them too, because its start command runs the step at every start. The API deletes them from its process at start. A separate one-off job would be cleaner. | DevOps |
| M-4 | `render.yaml` hard-codes the hosts `ari-api.onrender.com` and `ari-public.onrender.com`. If Render assigns other names, public forms and the sign-in link break until five places are changed ([`deployment.md`](deployment.md#3-production-blueprint-step-by-step), step 4). | DevOps |
| M-5 | `ari-cron-export` fails daily by design until a break-glass window is open. Output is plain NDJSON; the code does not read `BACKUP_AGE_PUBLIC_KEY`. Suspend the cron until the export design is done. | Backend, DevOps |
| M-6 | `SECRETS_KEY` (TOTP encryption) has no rotation tool. A new value locks out every TOTP user. The audit chain key has no rotation function either. | Backend |
| M-7 | The per-address rate limit trusts the left-most `X-Forwarded-For` value (`trustProxy: true`). It can be bypassed. The account lock-out still holds. Review R-04. | Backend |
| M-8 | No database role can take a full logical dump (no superuser, `FORCE ROW LEVEL SECURITY`, no audit read grant for `app_migrator`). `scripts/backup-export.sh` and the offsite dump path of RB-02 do not work on managed hosts; only the provider's own backup has full rights. Finding F-1 in [`migration/google-cloud.md`](migration/google-cloud.md#56-findings-that-need-a-decision). | Data, DevOps |

## Low

| # | Issue | Owner |
|---|---|---|
| L-1 | `app_core` cannot execute `search.norm()`, so the pre-deploy step cannot load the vocabulary as `app_core`. The synthetic seed loads it. Fix: migration 0011 (review R-13). | Data |
| L-2 | Rate limits, the search cache and the query budget cache are in process memory, so they are per instance. Accepted for Phase 1. | Backend |
| L-3 | `/livez` reports `DEMO_MODE` (`checks.demo`), but the SPA shows no demo banner. | Frontend |
| L-4 | `ALERT_WEBHOOK_URL` is not implemented. A failed cron is visible only in Render. | Backend |
| L-5 | Synthetic users share one password (`SEED_USER_PASSWORD`) with TOTP secrets derived from it. Acceptable for synthetic data only. The seed must be off before `GATE-PROD-DATA` closes. | Owner |
| L-6 | `db/seed.mjs` needs a role that bypasses RLS, so it cannot run on Render. The API job `seed-synthetic` seeds there. | Data |
| L-7 | Every first load logs a 401 for `GET /auth/session` (QA-013). Changing it is an API contract decision. | Backend |
| L-8 | The public site has no theme switch; it follows the OS (QA-014). Needs a product decision. | Product |
| L-9 | The old hand-made Render service `ARI-PST` (start command `T4C`) still exists and fails on every push to `main`. Delete it ([`deployment.md`](deployment.md#2-before-you-start)). | Owner |
| L-10 | Other open code review findings (R-05 to R-12): [`REVIEW-2026-11.md`](REVIEW-2026-11.md#open-findings). | Backend, Frontend |

## CI gates not yet enforced

`ci-gate` is green, and every job it needs runs a real check. These planned gates have no tool or test yet. The workflow says so in comments.

| Planned gate | What CI runs today |
|---|---|
| Spectral ruleset on OpenAPI | `lint:openapi`: the generated client matches the spec |
| fast-check property tests | `test:property`: the privacy attack simulation in `db/tests/privacy.test.mjs` |
| Schemathesis fuzzing, oasdiff breaking-change check | `test:contract`: authz matrix and IDOR/contract tests (responses validated against OpenAPI) |
| Migration lint, old schema from `main` + seed + new migrations | Not run |
| REQ-to-test traceability (`trace-check`) | Not run. Tests carry no REQ ids |
| axe on the protected SPA | `test:a11y` covers the public site only |
| Export/import round trip (`roundtrip.yml`) | Manual only. It fails on purpose: the tools do not exist |
| Actions pinned to commit SHAs | Pinned by tag. List: [`.github/SHA-PINNING-TODO.md`](../.github/SHA-PINNING-TODO.md) |

## Unverified

- **Render:** `CREATEROLE` for the database user; `preDeployCommand` on free instances; `RENDER_EXTERNAL_URL` and `RENDER_GIT_COMMIT` in every service; redirect to an external URL from a static site; `NODE_VERSION` handling; plan slugs (`pro-4gb`, `starter`); disk sizes; PITR window and whether it meets RPO 15 min; `IS_PULL_REQUEST` in previews; preview cron opt-out; name uniqueness across Blueprints; `render blueprints validate`; free Postgres lifetime (30 days).
- **Approval gate:** Render has no built-in approval gate. The GitHub Environment plus deploy hook design needs the owner's acceptance.
- **Quality:** Lighthouse CI (`apps/public-site/lighthouserc.json`) was not run. No Lighthouse scores are claimed.
- **Security testing:** pen-test, DAST and the privacy attack simulation at scale were not run on a deployed stack.
- **Performance:** p95 800 ms at 50,000 records (C-12) is a target. `db/tests/perf.test.mjs` measures about 850 ms locally. No deployed measurement.

## Content and design

- Fonts (Heebo, Rubik, Assistant) are not bundled. The licence is UNVERIFIED ([`packages/design-system/fonts/README.md`](../packages/design-system/fonts/README.md)). System fallbacks are used.
- Hebrew copy (UI, public site, legal pages) is a machine draft. A Hebrew editor must review it. The diagnosis vocabulary and Hebrew labels need clinical sign-off (GATE-SCHEMA).
- Partner logos are not shipped. The Shaare Zedek logo needs permission (`OPEN-LOGO-PERMISSION`). The logo concept is open.
- Screen reader testing with real users was not done.

## Needs legal review

Retention periods (C-07); GDPR and Israeli privacy law for coded data; HIPAA; region (Frankfurt, GATE-REGION); DPA with Render and sub-processors; breach notice windows; privacy, terms, accessibility, consent and analytics pages; the binding Israeli accessibility standard edition (OPEN-A5-02). These are not legal advice.

## Open gates

GATE-OPERATOR, GATE-BUDGET, GATE-SCHEMA, GATE-COMMITTEE, GATE-COMPLIANCE, GATE-GENOMICS, GATE-INGEST, GATE-PATHOLOGY, GATE-PROD-DATA. `GATE-PROD-DATA` blocks real data in every environment. Details: [`plan/decision-register.md`](../plan/decision-register.md).
