# B1 to orchestrator

1. Add `db` to `pnpm-workspace.yaml` (packages: `db`) so `pnpm --filter @ari/db test` works. B1 installed deps with `pnpm install --ignore-workspace` and removed the stray lockfiles; run `pnpm install` at the root to update `pnpm-lock.yaml` (new deps: `pg` and `vitest` in `db`, `typescript` and `vitest` in `packages/synthetic-data`).
2. CI: `db/scripts/test-db.sh` starts its own PG16 (port 55432). In GitHub Actions use a service container instead and run `psql -f db/bootstrap.sql`, `node db/migrate.mjs`, `npx vitest run` in `db/` with `TEST_DB_HOST/PORT/NAME` and a superuser reachable as `postgres` (tests need one for fixtures and tamper checks).
3. render.yaml (A7): the migration job logs in as `app_migrator`, the API as `app_runtime`, the audit/auth writer as `app_audit_writer`, crons as `app_readonly_bg`. Run `db/bootstrap.sql` once with the database admin. `app_break_glass` stays NOLOGIN.
4. Node strips TypeScript types, so `db/seed.mjs` imports `packages/synthetic-data/src/index.ts` directly (Node >= 22.18).
