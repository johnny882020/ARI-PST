# B5 (DevOps) to orchestrator, API, Data, Frontend

## Deviations from the plan
- Blueprint is at repo root `render.yaml` (not `infra/render.yaml`). Staging is generated: `infra/render.staging.yaml`.
- No `ari-app` static site and no `ari-internal`. `ari-api` builds and serves `apps/web/dist` (C-03 same origin). Update A1 doc 05 / C-04 wording.
- Health path on Render: `/readyz`. Smoke script accepts `/readyz` or `/api/readyz` (C-05 says under `/api/`). API should serve both or tell B5 which one.
- Secrets with `sync: false` are on the service, not in env groups (not valid in groups).

## API (apps/api) must provide
- `node apps/api/dist/server.js` (listens on `PORT`), serves `WEB_DIST_DIR` (SPA fallback to index.html for non-`/api` routes), `/livez`, `/readyz` returning JSON with `version` = `RENDER_GIT_COMMIT`.
- Jobs: `apps/api/dist/jobs/{staleness,audit-verify,purge,export}.js` (exit non-zero on failure; ping `HEARTBEAT_URL_*` on success).
- Seed synthetic data when `IS_PULL_REQUEST=true` or `SEED_SYNTHETIC=true`. Refuse to start when `DATA_CLASSIFICATION != synthetic` outside production. In previews (no SMTP/object store) fall back to in-memory adapters.
- Env vars used: DATABASE_URL, SESSION_SECRET, AUDIT_HMAC_KEY, CSRF_SECRET, PUBLIC_ORIGIN, WEB_DIST_DIR, REGION_PIN, SMTP_URL, OBJECTSTORE_*, BACKUP_AGE_PUBLIC_KEY, ALERT_WEBHOOK_URL.
- The Postgres owner user is `app_migrator` (C-06). `db/migrate.mjs` creates the other roles and must run with `DATABASE_URL`.

## Root package.json scripts CI expects (orchestrator)
lint, typecheck, lint:openapi, arch, test:portability, test:unit, test:synthetic-guard, test:property, db:migrate, db:seed-synthetic, lint:migrations, test:rls, test:integration, test:contract, build, test:e2e:smoke, test:a11y, test:trace, export:full, import:full, verify:roundtrip, check:capability-map. Missing scripts fail CI on purpose.
`pnpm --filter @ari/api...` needs `@ari/api` to depend on its workspace packages.

## Public site (RT-10)
Content editors: separate content repo or path-limited app. CI job `cms-guard` enforces `cms/*` branches touch only `apps/public-site/src/content/**`.
