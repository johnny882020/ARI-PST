# Deployment guide (Render)

Data is synthetic only (`DATA_CLASSIFICATION=synthetic`) until `GATE-PROD-DATA` closes.
Region: Frankfurt (GATE-REGION, needs legal review). Render's own CDN and TLS are used. There is no other proxy (RT-11).

## 1. Overview

| Target | Blueprint | State | Section |
|---|---|---|---|
| Free demo | `infra/render.free.yaml` | Live: Blueprint `ari-pst-demo`, service `ari-demo-api-7teo` | [13](#13-free-demo) |
| Production | `render.yaml` (repo root, paid plans) | Not applied | [3](#3-production-blueprint-step-by-step) |
| Staging | `infra/render.staging.yaml` (generated from `render.yaml`) | Not applied | [3](#3-production-blueprint-step-by-step), step 10 |
| Google Cloud | none | Guide only | [14](#14-moving-off-render) |

Rule: let a Blueprint create every service. Do not create services or type commands by hand in the Dashboard.

## 2. Before you start

1. Delete the old hand-made service `ARI-PST` (build `yarn`, start `T4C`). It is broken and fails on every push to `main`. Render Dashboard, service `ARI-PST`, Settings, Delete Web Service.
2. Read [section 12](#12-open-gaps) (open gaps).
3. Confirm that `main` holds the code ([section 5](#5-what-must-be-on-main)).

## 3. Production Blueprint: step by step

The production Blueprint `render.yaml` creates these resources:

| Resource | Type | What it is |
|---|---|---|
| `ari-public` | Static site | Public Astro site (he/en). Deploys after CI passes (`checksPass`). |
| `ari-api` | Web service | Serves `/api/v1` and the protected SPA (`apps/web/dist`) on one host (C-03). 2 instances. Auto-deploy off: deploys go through the approval workflow. |
| `ari-db` | Postgres 16 | Frankfurt. Private network only. |
| `ari-cron-staleness` | Cron | Daily 05:10 UTC |
| `ari-cron-audit-verify` | Cron | Hourly, minute 35 |
| `ari-cron-purge` | Cron | Daily 02:40 UTC |
| `ari-cron-export` | Cron | Daily 02:20 UTC. Break-glass only: fails by design until `DATABASE_URL_BREAKGLASS` is set for an approved window |
| `ari-cron-snapshot` | Cron | Hourly, minute 5. Refreshes the privacy snapshot that search counts read |

Steps (owner, once):

1. **Create the Blueprint.** Dashboard, New, Blueprint. Connect the GitHub repository. Select branch `main`. Leave the Blueprint file path empty (root `render.yaml`).
2. **Answer the secret prompts.** Render asks for every `sync: false` value ([section 4](#4-variables)). For a synthetic run you may leave all of them empty. Render generates the passwords and keys.
3. **Apply.** Render creates the database, then the services. Before `ari-api` starts, the pre-deploy step `node scripts/render-predeploy.mjs` runs ([section 3a](#3a-what-the-pre-deploy-step-does)).
4. **Check the host names.** `render.yaml` assumes `ari-api.onrender.com` and `ari-public.onrender.com`. If Render assigned other names, change them in one pull request: `PUBLIC_PORTAL_URL`, `PUBLIC_API_BASE`, the two hosts in the `Content-Security-Policy` header, the `/app/*` redirect and `PUBLIC_SITE_ORIGIN`. Then run `python3 scripts/gen-staging.py`.
5. **Run the smoke test.** `BASE_URL=https://<ari-api host> bash scripts/smoke.sh --wait 120`. Expect `OK: livez + readyz`. `/readyz` shows the git commit and the migration level.
6. **Sign in.** See [section 9](#9-previews-synthetic-data-and-sign-in).
7. **Fix plan names if needed.** If Render rejects a plan name (`pro-4gb` for the database, `starter` for services), pick the nearest plan and change `render.yaml` in a pull request. Do not change plans in the Dashboard (drift).
8. **Apply the GitHub settings** in [section 6](#6-github-settings).
9. **Suspend `ari-cron-export`** in the Dashboard until the export design is finished ([section 12](#12-open-gaps)).
10. **Staging (optional).** Create the `staging` branch from `main`. Then New, Blueprint, branch `staging`, Blueprint file path `infra/render.staging.yaml`. Names start with `ari-stg-`. Staging deploys after CI.

### 3a. What the pre-deploy step does

`scripts/render-predeploy.mjs` runs before every deploy. It is idempotent. If it fails, the deploy stops and the old version keeps serving.

1. **Roles.** Render creates one database user, `ari_owner` (not a superuser). The step logs in as that user (`DATABASE_URL_OWNER`). It creates `app_migrator`, `app_runtime` and `app_readonly_bg` with the generated passwords (`DB_PASSWORD_*`) and runs `db/bootstrap.sql`. Render makes its own user the owner of schema `public`, so `bootstrap.sql` grants `USAGE, CREATE` on `public` to `app_migrator` and `USAGE` to `app_core`. The step then checks that no app role is elevated and that `app_runtime` is a member of no role.
2. **Migrations.** `node db/migrate.mjs` as `app_migrator`. Forward-only. The runner grants `SELECT` on `public.schema_migrations` to `app_core`, so `/readyz` can read the level.
3. **Vocabulary.** Loads the diagnosis vocabulary if the table is empty.
4. **Synthetic seed.** Only when `SEED_SYNTHETIC=true` or `IS_PULL_REQUEST=true`, and only when `DATA_CLASSIFICATION=synthetic`. Otherwise it refuses.

The API logs in as `app_runtime`. Cron jobs log in as `app_readonly_bg`. The API refuses to start in production if its login is a superuser, the owner or `app_migrator`.

If the Render user has no `CREATEROLE` right (UNVERIFIED), the step stops with a clear message before it changes anything. Then:
1. Create the three roles by hand with the passwords from the Dashboard.
2. Run `db/bootstrap.sql` as a database admin.
3. Set `PREDEPLOY_SKIP_BOOTSTRAP=true` on `ari-api`.

The sequence is tested locally on PostgreSQL 16 with one non-superuser owner: `bash scripts/sim-render-db.sh`, then `pnpm test:e2e:full`.

## 4. Variables

`apps/api/src/config.ts` is the single source for names. `apps/api/.env.example` lists every variable. `python3 scripts/verify-render-yaml.py` fails when a Blueprint misses a required variable or sets a name the code does not read.

| Source | Variables |
|---|---|
| Set by the Blueprint | `NODE_ENV`, `NODE_VERSION`, `DATA_CLASSIFICATION=synthetic`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DATABASE_URL_OWNER`, `WEB_DIST_DIR`, `SEED_SYNTHETIC`, `SEED_PROFILE`, `PUBLIC_SITE_ORIGIN` |
| Generated by Render | `IP_HASH_SALT`, `SECRETS_KEY`, `DB_PASSWORD_MIGRATOR`, `DB_PASSWORD_RUNTIME`, `DB_PASSWORD_BG`, `SEED_USER_PASSWORD` |

Typed in the Dashboard (all optional while data is synthetic). Never put these in Git, chat or tickets.

| Variable | Service | Note |
|---|---|---|
| `PUBLIC_ORIGIN` | `ari-api` | Empty means Render's URL (`RENDER_EXTERNAL_URL`). Set it for a custom domain. |
| `SMTP_URL`, `MAIL_FROM`, `CONTACT_INBOX` | `ari-api` | Empty means no e-mail is sent. Keep a fallback provider (RT-14). |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | `ari-api`, `ari-cron-export` | S3-compatible bucket in the EU. Empty means uploads stay in memory per instance. |
| `DATABASE_URL_BREAKGLASS` | `ari-cron-export` | Only for an approved break-glass window. |
| `HEARTBEAT_URL_<JOB>` | Crons | Outside monitor, pinged after a successful run. |

With data that is not synthetic, the API refuses to start unless `GATE_PROD_DATA_CLOSED=true`. Then `SMTP_URL` and `S3_BUCKET` are mandatory.

Residual risk: Render runs the pre-deploy step with the environment of `ari-api`. So that service holds the owner connection string and the migrator password. The API deletes them from its own process at start, but they stay readable in the Dashboard.

## 5. What must be on `main`

`main` must contain `render.yaml`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `apps/*`, `packages/*` and `db/`. Render builds from the branch it tracks.

Changes reach `main` by pull request only, with squash merge. After merge:
1. CI runs.
2. A bot fast-forwards the `staging` branch. Staging deploys.
3. Workflow `deploy-protected` waits for two reviewers in the GitHub Environment `production-protected`.
4. After approval it calls the Render deploy hook and runs the smoke test.

## 6. GitHub settings

| Setting | Value | State |
|---|---|---|
| Required check | `ci-gate` only. It passes only when every CI job passes | Green on `main` |
| Dependency graph | On (needed by `dependency-review-action`) | On |
| Branch protection `main`, `staging` | PR required, linear history, code owner review, include administrators, no force push. `staging`: only the bot pushes | Owner to confirm |
| Environment `production-protected` | 2 required reviewers (release approvers), prevent self-review, deployment branch `main` | Owner to apply |
| Environment secrets | `RENDER_DEPLOY_HOOK_API`, `RENDER_DEPLOY_HOOKS_CRON` (one URL per line), `RENDER_API_KEY_ROLLBACK` | Owner to apply |
| Repository variables | `STAGING_URL`, `PROD_URL`, `RENDER_API_SERVICE_ID`, `DEPLOY_PAUSED` (`false`) | Owner to apply |
| Secret scanning and push protection | On | Owner to confirm |
| Actions | Fork PR workflows need approval. No `pull_request_target` | Enforced by `cms-guard` |
| CODEOWNERS | Replace the `@ARI-ORG/...` placeholders. Create the teams first | Open |

Deploy hook URLs: Render service, Settings, Deploy Hook.

## 7. Content editors (RT-10)

Editors work through Decap CMS on `cms/*` branches or a fork. CI job `cms-guard` rejects a `cms/*` branch that changes anything outside `apps/public-site/src/content/`. Editors get no access to `production-protected` or to any secret. Details: [`apps/public-site/CMS-SECURITY.md`](../apps/public-site/CMS-SECURITY.md).

## 8. Account safety (RT-14)

- Own the Render workspace through an organisation with at least 2 owners. Each owner uses a hardware key.
- Use a paid database plan with point-in-time recovery. Record the retention window (Dashboard, Database, Recovery).
- Run restore drills DR-1, DR-2, DR-3 and DR-6 before any real data ([RB-02](runbooks/RB-02-database-restore.md)).
- Rotate deploy hooks and API keys every 90 days.

## 9. Previews, synthetic data and sign-in

Every pull request gets a preview with a new, empty database. Render sets `IS_PULL_REQUEST=true` there (UNVERIFIED), so the pre-deploy step seeds synthetic data (`SEED_PROFILE=preview`: 3 centers, 14 users, 600 samples, 9 requests). The same seed runs on `main` while `SEED_SYNTHETIC=true` is in `render.yaml`. Remove that line by ADR when `GATE-PROD-DATA` closes.

Seed guards: the seed refuses when `DATA_CLASSIFICATION` is not `synthetic`, when `GATE_PROD_DATA_CLOSED=true`, or when a non-synthetic sample exists.

To sign in to any seeded stack:
1. Copy `SEED_USER_PASSWORD` from Dashboard, the API service, Environment.
2. On your own computer, run `SEED_USER_PASSWORD='<value>' node scripts/seed-credentials.mjs`.
3. The script prints each synthetic user (`synthetic.<name>@example.invalid`), the role, the TOTP secret and the current code.
4. Do not paste the output into chat or tickets.

Previews expire after 3 days. Cron jobs do not run in previews. Keep previews of fork PRs disabled.

## 10. Rollback

1. Pause deploys: set repository variable `DEPLOY_PAUSED=true`.
2. Render Dashboard, the service, Deploys. Pick the last good deploy. Click Rollback.
3. Run `BASE_URL=https://<host> bash scripts/smoke.sh --wait 60`.
4. Do not roll back the database. Migrations are forward-only and expand/contract.
5. Open a revert pull request. Merge after CI. Set `DEPLOY_PAUSED=false`.

Full procedure: [RB-01](runbooks/RB-01-bad-deploy.md). `deploy-protected` also rolls back by itself when its smoke step fails.

## 11. Local checks

```bash
python3 scripts/verify-render-yaml.py   # structure, env names vs config.ts, headers; all three Blueprints
python3 scripts/gen-staging.py --check  # staging Blueprint matches render.yaml
pnpm -r build && pnpm test:e2e:full     # simulated Render database, pre-deploy, API in production mode, browser flow
BASE_URL=https://<host> bash scripts/smoke.sh --wait 60
render blueprints validate render.yaml  # Render CLI 2.7.0 or later, needs login
```

`pnpm test:e2e:full` (`scripts/e2e-fullstack.mjs`):
1. Starts PostgreSQL 16 on port 55435 with one non-superuser owner.
2. Runs the pre-deploy step twice.
3. Starts `node apps/api/dist/server.js` on port 18080.
4. Drives Chromium: every role signs in with password and TOTP. A researcher searches and submits a request. The request goes through pre-check, committee votes, center coordination, agreement and delivery to `closed`.

## 12. Open gaps

Details and owners: [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md).

| Item | Effect | What to do |
|---|---|---|
| Render database user has `CREATEROLE`: UNVERIFIED | First deploy stops in the pre-deploy step | [Section 3a](#3a-what-the-pre-deploy-step-does), fallback |
| Host names are assumed | Public forms blocked by CSP/CORS, wrong sign-in link | [Section 3](#3-production-blueprint-step-by-step), step 4 |
| Plan slugs, `IS_PULL_REQUEST`, PITR window: UNVERIFIED | Blueprint rejected, or a preview starts without seed | Step 7. `SEED_SYNTHETIC` is already set |
| No object store and no SMTP | Uploads in memory per instance. No e-mail leaves the system | Set the `S3_*` and `SMTP_URL` variables |
| Rate limits and search cache are in memory | Limits are per instance | Accepted for Phase 1 |
| `ari-cron-export` | Fails daily until break-glass is enabled. Output is not encrypted | Suspend the cron |

## 13. Free demo

For a demo on Render free plans. Synthetic data only. Not for production.

**Current demo**

| Item | Value |
|---|---|
| Blueprint | `ari-pst-demo`, branch `main`, file path `infra/render.free.yaml` |
| Web service | `ari-demo-api-7teo`: <https://ari-demo-api-7teo.onrender.com> |
| Database | `ari-demo-db-7teo` (free Postgres 16) |
| Region | Frankfurt |
| Deploy | Manual: Dashboard, the service, Manual Deploy |
| Seed | `SEED_PROFILE=tiny`: 40 samples, 2 centers |

Render added the suffix `-7teo` to the names in the file.

**To deploy a new version**
1. Merge the change into `main`.
2. Dashboard, `ari-demo-api-7teo`, Manual Deploy, Deploy latest commit.
3. Wait for the start. The first start takes a few minutes.
4. Run `BASE_URL=https://ari-demo-api-7teo.onrender.com bash scripts/smoke.sh --wait 180`.

**To create the demo again**
1. Dashboard, New, Blueprint, this repository, branch `main`, Blueprint file path `infra/render.free.yaml`.
2. Apply. No values to type. Render creates `ari-demo-db` and `ari-demo-api`, maybe with a suffix.
3. Free services have no `preDeployCommand`. So the start command is `node scripts/render-predeploy.mjs && node apps/api/dist/server.js`. Roles, migrations, vocabulary and the synthetic seed run at every start. Then the API starts.
4. Open `https://<service host>/`. Sign in as in [section 9](#9-previews-synthetic-data-and-sign-in).

**What is off in the demo**

| Off | Why |
|---|---|
| Public site and its forms | One web service only |
| All cron jobs | Cron jobs are paid. The snapshot is refreshed at every start and after a coordinator import |
| Second instance, zero-downtime deploys | One free instance. It sleeps when idle; the first request after a pause is slow |
| Backups and point-in-time recovery | Free Postgres has none. Render deletes it after the free period (UNVERIFIED: 30 days) |
| E-mail and object store | Invites are not delivered. Uploads are lost on restart |
| PR previews, staging, approval gate | Deploy by hand |

`DEMO_MODE=true` is set. `/livez` reports it (`checks.demo = "on"`). The SPA shows no demo banner yet.
Because the pre-deploy step runs at every start, the owner connection string and the migrator password stay in the service environment (same residual risk as [section 4](#4-variables)).

## 14. Moving off Render

A step-by-step guide to move every part of the portal to Google Cloud is in [`migration/google-cloud.md`](migration/google-cloud.md). It keeps synthetic data only until `GATE-PROD-DATA` closes.
