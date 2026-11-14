# @ari/api

Fastify API of the ARI-PST Portal. It serves `/api/v1`, `/livez`, `/readyz` and the built protected SPA (`WEB_DIST_DIR`) on one origin. Synthetic data only.

## Scripts

| Command | What it does |
|---|---|
| `pnpm --filter @ari/api dev` | Starts the API with reload (`tsx watch`), port 8080 by default |
| `pnpm --filter @ari/api build` | Builds `dist/` (tsup) |
| `pnpm --filter @ari/api start` | Runs `dist/server.js` |
| `pnpm --filter @ari/api test` | Integration tests on a throwaway PostgreSQL 16 (`scripts/test-db.sh`, port 55433) |
| `pnpm --filter @ari/api typecheck` | TypeScript check |
| `pnpm --filter @ari/api lint` | TypeScript check and project rules (`scripts/lint-rules.mjs`) |
| `pnpm --filter @ari/api seed:synthetic` | Runs the synthetic seed job from `dist/` |

## Configuration

`src/config.ts` is the single source of variable names. `.env.example` lists every variable with a note. The API reads the process environment only; export the variables in your shell. Never commit real values.

## Key files

| Path | Content |
|---|---|
| `src/server.ts` | Start, production guards (no elevated database login) |
| `src/app.ts` | Fastify app, plugins, static SPA |
| `src/http/` | Routing from the OpenAPI file, CSRF and origin checks, problem+json errors |
| `src/modules/` | Ten modules, one per bounded context |
| `src/adapters/` | `postgres`, `auth-local` (Argon2id, passkeys, TOTP), `objectstore`, `email`, `clock` |
| `src/jobs/` | Cron jobs: `staleness`, `audit-verify`, `purge`, `export`, `snapshot`, `seed-synthetic` |
| `test/` | Authz matrix (from `x-roles`), IDOR and contract tests, request flow, auth, import |

Architecture rule: only `src/adapters/` may import platform libraries. `pnpm arch` checks this.
