# Deployment guide (Render)

Status: Phase 1. Data is synthetic only (`DATA_CLASSIFICATION=synthetic`) until GATE-PROD-DATA closes.
Region: Frankfurt (GATE-REGION). No Cloudflare or other proxy in Phase 1 (RT-11): Render's own CDN and TLS are used.

## 1. Why the first deploy failed: `T4C: command not found`

The service was created by hand from branch `main` with Start Command `T4C`.
Two things were wrong:

1. `T4C` is not a program. A Start Command must be a real command that starts a server, such as `node apps/api/dist/server.js`. Render ran `T4C` in a shell, the shell found no such command, and the deploy failed.
2. `main` held only a README. There was no code to build or start. The build lives on branch `claude/sweet-allen-jpkmu4`.

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
| `ari-cron-export` | cron | Daily 02:20 UTC, encrypted export |

There is no separate `ari-app` static site. A static site would sit on a different host, and the `__Host-sid` cookie then fails. So `ari-api` builds and serves the SPA. Staging uses `infra/render.staging.yaml` (names start with `ari-stg-`, branch `staging`, auto-deploy after CI).

## 3. Step by step (owner, once)

Before you start, read section 5 (what must be on `main`).

1. **Delete the broken service.** Render Dashboard, open the failed web service, Settings, scroll to the bottom, Delete Web Service. (Repairing it by hand is possible, but the Blueprint would then create a second service with the same purpose. Delete is cleaner.)
2. **Put the code on `main`.** Open a pull request from `claude/sweet-allen-jpkmu4` into `main` and merge it (orchestrator or owner does this; the DevOps agent does not merge). Wait for CI. Confirm `render.yaml` is visible on `main` at the repo root.
3. **Create the Blueprint.** Dashboard, New, Blueprint. Connect the GitHub repo `johnny882020/ARI-PST`. Select branch `main`. Render reads `render.yaml`. Leave the Blueprint file path empty (root).
4. **Fill the secret prompts.** Render asks for every `sync: false` value (see section 4). You can leave optional ones empty for the first synthetic run, except `PUBLIC_ORIGIN`.
5. **Apply.** Render creates the database first, then the services. The first `ari-api` deploy runs `node db/migrate.mjs` before it starts.
6. **Check.** Run `BASE_URL=https://<ari-api>.onrender.com bash scripts/smoke.sh --wait 120`. Expect `OK: livez + readyz`.
7. **Plan slugs.** If Render rejects a plan name (`pro-4gb` for the database, `starter` for services), pick the nearest plan in the Dashboard and fix `render.yaml` through a pull request. Do not change plans by hand in the Dashboard (drift).
8. **Staging (optional, later).** Create the `staging` branch from `main`, then New, Blueprint, branch `staging`, Blueprint file path `infra/render.staging.yaml`.

## 4. Secrets: what you type in the Dashboard

Never put these in Git, chat or tickets.

| Variable | Service | Note |
|---|---|---|
| `PUBLIC_ORIGIN` | `ari-api` | `https://` plus the final host. Use the `onrender.com` URL first. |
| `SMTP_URL` | `ari-api` | Email provider. Keep a fallback provider (RT-14). |
| `OBJECTSTORE_*` | `ari-api`, `ari-cron-export` | S3-compatible bucket in the EU. |
| `BACKUP_AGE_PUBLIC_KEY` | `ari-cron-export` | Public key only. Private key stays offline with two key holders. |
| `ALERT_WEBHOOK_URL`, `HEARTBEAT_URL_*` | crons | Outside monitor. |

Render generates `SESSION_SECRET`, `AUDIT_HMAC_KEY` and `CSRF_SECRET` itself (group `ari-secrets-generated`).
Variables marked `sync: false` are not copied into pull request previews. Previews therefore run with no email and no object store, and the API must fall back to in-memory adapters (see `plan/requests/B5-to-orchestrator.md`).

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

## 9. Previews

Every pull request gets a preview with a new empty database. The API seeds synthetic data when `IS_PULL_REQUEST=true` (Render sets it in previews; UNVERIFIED) or `SEED_SYNTHETIC=true`. The API must refuse to start if `DATA_CLASSIFICATION` is not `synthetic` outside production. Previews expire after 3 days. Cron jobs do not run in previews. Previews of forked PRs must stay disabled in Render's GitHub settings.

## 10. Rollback

Dashboard, `ari-api`, Events or Deploys, pick the last good deploy, Rollback. Then follow `docs/runbooks/RB-01-bad-deploy.md`. The database is never rolled back by a code rollback (forward-only migrations).

## 11. Checks you can run locally

```
python3 scripts/verify-render-yaml.py
python3 scripts/gen-staging.py --check
render blueprints validate render.yaml        # Render CLI 2.7.0+, needs login
BASE_URL=https://host bash scripts/smoke.sh --wait 60
```
