# Deployment guide (Render)

Status: Phase 1. Data is synthetic only (`DATA_CLASSIFICATION=synthetic`) until GATE-PROD-DATA closes.
Region: Frankfurt (GATE-REGION). No Cloudflare or other proxy in Phase 1 (RT-11): Render's own CDN and TLS are used.

## 1. Why the first deploy failed: `T4C: command not found`

The service `ARI-PST` was created by hand from branch `main` with Build Command `yarn` and Start Command `T4C`. It is still in the Render workspace and still broken. The owner will delete it (section 3, step 1). The working demo is the Blueprint in section 13.
Two things were wrong at the time:

1. `T4C` is not a program. A Start Command must be a real command that starts a server, such as `node apps/api/dist/server.js`. Render ran `T4C` in a shell, the shell found no such command, and the deploy failed.
2. `main` held only a README. There was no code to build or start. This is fixed: PR #1 merged the code from `claude/sweet-allen-jpkmu4` into `main`.

The fix is not a better Start Command. The fix is to let the Blueprint (`render.yaml`, in the repo root) create the services. It contains every command, health check and database link, so nobody types them by hand.

## 2. What the Blueprint creates

| Resource | Type | What it is |
|---|---|---|
| `ari-public` | static site | Public Astro site (he/en). Deploys by itself after CI passes. |
| `ari-api` | web service | One service. It serves `/api/v1` and the protected SPA (`apps/web/dist`) on the same host (decision C-03). 2 instances. Auto-deploy is OFF. Deploys go through the approval workflow. |
| `ari-db` | Postgres 16 | Frankfurt. Private network only. |
| `ari-cron-staleness` | cron | Daily 05:10 UTC |
| `ari-cron-audit-verify` | cron | Hourly, minute 35 |
| `ari-cron-purge` | cron | Nightly 02:40 UTC |
| `ari-cron-export` | cron | Daily 02:20 UTC. Break-glass only: fails by design until `DATABASE_URL_BREAKGLASS` is set for an approved window. Encryption is not built yet |
| `ari-cron-snapshot` | cron | Hourly, minute 5. Publishes the privacy snapshot that search counts read |

There is no separate `ari-app` static site. A static site would sit on a different host, and the `__Host-sid` cookie then fails. So `ari-api` builds and serves the SPA. Staging uses `infra/render.staging.yaml` (names start with `ari-stg-`, branch `staging`, auto-deploy after CI).

## 3. Step by step (owner, once)

Before you start, read section 5 (what must be on `main`) and section 12 (assumptions and open gaps).

1. **Delete the broken service.** Render Dashboard, open the failed web service `ARI-PST`, Settings, scroll to the bottom, Delete Web Service. (Repairing it by hand is possible, but the Blueprint would then create a second service with the same purpose. Delete is cleaner.)
2. **Put the code on `main`.** Done once with PR #1. Later changes also go from `claude/sweet-allen-jpkmu4` into `main` by pull request (orchestrator or owner merges; agents do not merge). Wait for CI. Confirm `render.yaml` is visible on `main` at the repo root.
3. **Create the Blueprint.** Dashboard, New, Blueprint. Connect the GitHub repo `johnny882020/ARI-PST`. Select branch `main`. Render reads `render.yaml`. Leave the Blueprint file path empty (root). The production Blueprint needs paid plans. For a free demo use section 13 instead.
4. **Secret prompts.** Render asks for every `sync: false` value (section 4). For the first synthetic run you may leave ALL of them empty. Render generates the passwords and keys itself.
5. **Apply.** Render creates the database, then the services. Before `ari-api` starts, the pre-deploy step `node scripts/render-predeploy.mjs` runs (section 3a).
6. **Check the host names.** `render.yaml` assumes the hosts `ari-api.onrender.com` and `ari-public.onrender.com`. If Render gave other names (the name was taken), change them in one pull request: `PUBLIC_PORTAL_URL`, `PUBLIC_API_BASE`, the two hosts inside the `Content-Security-Policy` header, the `/app/*` redirect and `PUBLIC_SITE_ORIGIN`. Then run `python3 scripts/gen-staging.py`.
7. **Check.** Run `BASE_URL=https://<ari-api host> bash scripts/smoke.sh --wait 120`. Expect `OK: livez + readyz`. `/readyz` shows the git commit and the migration level (from `portal.migration_level()`).
8. **Sign in.** Copy `SEED_USER_PASSWORD` from Dashboard, `ari-api`, Environment. On your own computer run `SEED_USER_PASSWORD='...' node scripts/seed-credentials.mjs`. It prints the synthetic users, their TOTP secrets and the current code. Do not paste the output into chat or tickets.
9. **Plan slugs.** If Render rejects a plan name (`pro-4gb` for the database, `starter` for services), pick the nearest plan in the Dashboard and fix `render.yaml` through a pull request. Do not change plans by hand in the Dashboard (drift).
10. **Staging (optional, later).** Create the `staging` branch from `main`, then New, Blueprint, branch `staging`, Blueprint file path `infra/render.staging.yaml`.

### 3a. What the pre-deploy step does

`scripts/render-predeploy.mjs` runs before every deploy. It is safe to run again. If it fails, the deploy stops and the old version keeps serving.

1. **Roles.** Render creates one database user, `ari_owner`. It is not a superuser. The step logs in as that user (`DATABASE_URL_OWNER`), creates the roles `app_migrator`, `app_runtime` and `app_readonly_bg` with the passwords Render generated (`DB_PASSWORD_*`), and runs `db/bootstrap.sql`. After this the database belongs to `app_migrator`, and `PUBLIC` cannot connect. Render makes its own user the owner of schema `public`, so `bootstrap.sql` grants `USAGE, CREATE` on `public` to `app_migrator` (it creates `public.schema_migrations`) and `USAGE` to `app_core`. `db/migrate.mjs` grants `SELECT` on `public.schema_migrations` to `app_core`, so `portal.migration_level()` (owned by `app_core`) can read the ledger for `/readyz`. The step then checks the result (no app role is elevated, `app_runtime` is a member of nothing) and fails if a check does not hold.
2. **Migrations.** `node db/migrate.mjs` as `app_migrator`. Forward-only.
3. **Vocabulary.** Loads the diagnosis vocabulary if the table is empty (see the gap in section 12).
4. **Synthetic seed.** Only when `SEED_SYNTHETIC=true` or `IS_PULL_REQUEST=true`, and only when `DATA_CLASSIFICATION=synthetic`. Otherwise it refuses.

The API logs in as `app_runtime`. Cron jobs log in as `app_readonly_bg`. Neither uses the `ari_owner` connection string. The API refuses to start in production if its login is a superuser, the owner or `app_migrator`.

Assumption, not verified against Render (the site was not reachable from the build session): the Render database user has the `CREATEROLE` right. The whole sequence was verified on a local PostgreSQL 16 with one non-superuser owner (`bash scripts/sim-render-db.sh`, then `pnpm test:e2e:full`). If the Render user has no `CREATEROLE`, the step stops with a clear message before it changes anything. Then create the three roles by hand with the passwords from the Dashboard, run `db/bootstrap.sql` as a database admin, and set `PREDEPLOY_SKIP_BOOTSTRAP=true` on `ari-api`.

## 4. Variables

`apps/api/src/config.ts` is the single source for names. `apps/api/.env.example` lists every variable. `python3 scripts/verify-render-yaml.py` fails when a Blueprint misses a required variable or sets a name the code does not read.

Set by the Blueprint (nothing to type): `NODE_ENV`, `NODE_VERSION`, `DATA_CLASSIFICATION=synthetic`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DATABASE_URL_OWNER`, `WEB_DIST_DIR`, `SEED_SYNTHETIC`, `SEED_PROFILE`, `PUBLIC_SITE_ORIGIN`.
Generated by Render: `IP_HASH_SALT`, `SECRETS_KEY`, `DB_PASSWORD_MIGRATOR`, `DB_PASSWORD_RUNTIME`, `DB_PASSWORD_BG`, `SEED_USER_PASSWORD`.

Typed in the Dashboard (all optional while data is synthetic). Never put these in Git, chat or tickets.

| Variable | Service | Note |
|---|---|---|
| `PUBLIC_ORIGIN` | `ari-api` | Empty = Render's own URL (`RENDER_EXTERNAL_URL`). Set it when a custom domain is chosen. |
| `SMTP_URL`, `MAIL_FROM`, `CONTACT_INBOX` | `ari-api` | Empty = no e-mail is sent. Keep a fallback provider (RT-14). |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | `ari-api`, `ari-cron-export` | S3-compatible bucket in the EU. Empty = uploads stay in memory (lost on restart, not shared between the two instances). |
| `DATABASE_URL_BREAKGLASS` | `ari-cron-export` | Only for an approved break-glass window. |
| `HEARTBEAT_URL_<JOB>` | crons | Outside monitor. Pinged after a successful run. |

With data that is not synthetic, the API refuses to start unless `GATE_PROD_DATA_CLOSED=true`, and then `SMTP_URL` and `S3_BUCKET` are mandatory.
Residual risk: Render runs the pre-deploy step with the environment of `ari-api`, so that service holds the owner connection string and the migrator password. The API process deletes them from its own environment at start, but they stay readable in the Dashboard and by a new process on the instance.

## 5. What must be on `main`

`main` must contain, at minimum: `render.yaml`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `apps/*`, `packages/*`, `db/migrate.mjs`, `db/migrations/`. Render builds from the branch it tracks. An empty `main` means a failing build. Merge from `claude/sweet-allen-jpkmu4` by pull request. Squash merge only. Do not push directly.

Production deploys of the protected area are not automatic. After merge: CI runs, the `staging` branch is fast-forwarded by a bot, staging deploys, and `deploy-protected` waits for two reviewers in the GitHub Environment `production-protected`. The very first deploy happens when you create the Blueprint (section 3). Later ones go through the workflow.

## 6. GitHub settings the owner must apply

| Setting | Value |
|---|---|
| Branch protection `main`, `staging` | PR required, required check `ci-gate` only, linear history, code owner review, include administrators, no force push. `staging`: only the bot pushes. |
| Environment `production-protected` | 2 required reviewers (from the release-approvers team), prevent self-review, deployment branch `main`. |
| Environment secrets | `RENDER_DEPLOY_HOOK_API`, `RENDER_DEPLOY_HOOKS_CRON` (one URL per line), `RENDER_API_KEY_ROLLBACK` |
| Repo variables | `STAGING_URL`, `PROD_URL`, `RENDER_API_SERVICE_ID`, `DEPLOY_PAUSED` (`false`) |
| Secret scanning + push protection | On |
| Actions | Fork PR workflows need approval. Workflows use the base branch. No `pull_request_target`. |
| CODEOWNERS | Replace `@ARI-ORG/...` team names. Create the teams first. |

Deploy hook URLs: Render service, Settings, Deploy Hook.

## 7. Content editors (RT-10)

Editors work through the CMS on `cms/*` branches or a fork. CI job `cms-guard` rejects a `cms/*` branch that touches anything outside `apps/public-site/src/content/`. Editors never get access to the `production-protected` environment or to any secret. Best practice: use a separate content repository or a path-limited GitHub App. This is open and owned by the public-site agent.

## 8. Account safety (RT-14)

- Create the Render workspace under an organisation. At least 2 owners, each with a hardware key. No single person holds the API key.
- Use a paid plan with point-in-time recovery for the database. Check the retention window in Dashboard, Database, Recovery. Record it.
- Run restore drills DR-1, DR-2, DR-3, DR-6 once before any real data (see `docs/runbooks/RB-02-database-restore.md`).
- Rotate deploy hooks and API keys every 90 days.

## 9. Previews and synthetic data

Every pull request gets a preview with a new empty database. Render sets `IS_PULL_REQUEST=true` there (UNVERIFIED), so the pre-deploy step seeds synthetic data: 3 centers, 14 users (every role), 600 samples, 9 requests in different states (`SEED_PROFILE=preview`). The same seed runs on `main` while `SEED_SYNTHETIC=true` is in `render.yaml`. Remove that line by ADR when GATE-PROD-DATA closes.

Guards: the seed refuses when `DATA_CLASSIFICATION` is not `synthetic`, when `GATE_PROD_DATA_CLOSED=true`, or when a sample that is not synthetic exists. The API refuses to start with another classification unless `GATE_PROD_DATA_CLOSED=true`.
Sign-in: all synthetic users share `SEED_USER_PASSWORD`. Each has a TOTP secret derived from that password and the e-mail address. `node scripts/seed-credentials.mjs` prints the list.
Previews expire after 3 days. Cron jobs do not run in previews. Previews of forked PRs must stay disabled in Render's GitHub settings.

## 10. Rollback

Dashboard, `ari-api`, Events or Deploys, pick the last good deploy, Rollback. Then follow `docs/runbooks/RB-01-bad-deploy.md`. The database is never rolled back by a code rollback (forward-only migrations).

## 11. Checks you can run locally

```
python3 scripts/verify-render-yaml.py         # structure + env names vs config.ts + headers vs _headers, all three Blueprints
python3 scripts/gen-staging.py --check
render blueprints validate render.yaml        # Render CLI 2.7.0+, needs login (not run in the build session)
pnpm -r build && pnpm test:e2e:full           # fresh simulated Render database, pre-deploy, API in production mode, smoke, browser flow
BASE_URL=https://host bash scripts/smoke.sh --wait 60
```

`pnpm test:e2e:full` (`scripts/e2e-fullstack.mjs`) starts PostgreSQL 16 on port 55435 with one non-superuser owner, runs the pre-deploy step twice, starts `node apps/api/dist/server.js` on port 18080, and drives Chromium: every role signs in with password and TOTP, a researcher searches and submits a request, and the request goes through pre-check, committee votes, center coordination, MTA and delivery to closed. Steps without a screen call the real API from the signed-in browser session.

## 12. Assumptions and open gaps (as of the integration pass)

Closed in the integration pass: env var names, database logins and bootstrap, API tables in `db/migrations` (0010), preview seeding, the data guard, CORS for the public forms, static-site headers, `/readyz` migration check, root scripts for CI, a stale `pnpm-lock.yaml` (the Render build would have failed at `pnpm install --frozen-lockfile`), and a crash at start when `WEB_DIST_DIR` was a relative path.

Still open. Details and owners are in `docs/KNOWN-ISSUES.md`.

| Item | Effect | What to do |
|---|---|---|
| Render database user has `CREATEROLE`: UNVERIFIED | If not, the first deploy stops in the pre-deploy step with a clear message | Section 3a, last paragraph |
| Host names `ari-api.onrender.com`, `ari-public.onrender.com` are assumed | If different: public forms are blocked by CSP/CORS and the sign-in link is wrong | Section 3, step 6 |
| Free and preview instances: `preDeployCommand` availability, `IS_PULL_REQUEST`, plan slugs: UNVERIFIED | A preview may start without seed | Set `SEED_SYNTHETIC` (already set) |
| Vocabulary cannot be written by `app_core` (`plan/requests/INT-to-B1.md`) | Without the synthetic seed the diagnosis list stays empty | B1 adds one grant; until then the seed loads it |
| No object store and no SMTP configured | Uploads are in memory, per instance. No e-mail leaves the system (invites, notices) | Set the `S3_*` and `SMTP_URL` variables |
| Two API instances, in-memory rate limits and search cache | Limits are per instance | Accepted for Phase 1 |
| `ari-cron-export` | Fails every day until break-glass is enabled. Output is not encrypted | Suspend the cron in the Dashboard until the export design is finished |
| CI gates not yet enforced | See `docs/KNOWN-ISSUES.md` | |

## 13. Free-plan demo (`infra/render.free.yaml`)

For a demo on Render's free plans. Synthetic data only. Not for production.

**Current demo (checked in the Render workspace on 2026-11-14).** Blueprint `ari-pst-demo`, branch `main`, Blueprint file path `infra/render.free.yaml`, region Frankfurt, free plans. Render added a suffix to the names in the file: web service `ari-demo-api-7teo` (`https://ari-demo-api-7teo.onrender.com`), database `ari-demo-db-7teo`. Auto-deploy is off: deploy by hand (Dashboard, Manual Deploy). The old service `ARI-PST` is not part of the demo (section 1).

To create it again:
1. Dashboard, New, Blueprint, this repo, branch `main`, **Blueprint file path `infra/render.free.yaml`**.
2. Apply. No values to type. Render creates the database `ari-demo-db` and the web service `ari-demo-api` (Render may add a suffix such as `-7teo`).
3. Free services have no `preDeployCommand`. So the start command is `node scripts/render-predeploy.mjs && node apps/api/dist/server.js`: roles, migrations, vocabulary and the synthetic seed (`SEED_PROFILE=tiny`: 40 samples, 2 centers) run at every start, then the API starts. The first start takes a few minutes.
4. Open `https://<ari-demo-api host>/`. Get the sign-in list as in section 3, step 8 (service `ari-demo-api-7teo`).

What is off in the demo:

| Off | Why |
|---|---|
| Public site and its forms | One web service only |
| All cron jobs (hourly snapshot, staleness, purge and retention, audit verify, export) | Cron jobs are paid. The snapshot is refreshed at every start and after a coordinator import |
| Second instance, zero-downtime deploys | Free plan has one instance. It sleeps when idle; the first request after that is slow |
| Backups and point-in-time recovery | Free Postgres has none and Render deletes it after the free period (UNVERIFIED: 30 days) |
| E-mail and object store | Not configured: invites are not delivered, uploads are lost on restart |
| PR previews, staging, approval gate | Deploy by hand in the Dashboard |

`DEMO_MODE=true` is set. `/livez` reports it (`checks.demo = "on"`) so the UI can show a banner. The banner itself is not built yet (`docs/KNOWN-ISSUES.md`). UNVERIFIED: that free web services have no `preDeployCommand` (this is why the start command runs it) and that 512 MB RAM is enough for the build. Because the pre-deploy step runs at every start, the owner connection string and the migrator password must stay in the service environment (same residual risk as section 4).


## Moving off Render
A step-by-step guide to move every part of the portal to Google Cloud is in [`migration/google-cloud.md`](migration/google-cloud.md). It keeps synthetic data only until `GATE-PROD-DATA` closes.
