# @ari/web

Protected single-page app of the ARI-PST Portal (React, Vite). Hebrew (RTL, default) and English. The API serves the built app at `/` on the same origin as `/api/v1`.

## Scripts

| Command | What it does |
|---|---|
| `pnpm --filter @ari/web mock` | Starts the mock API on port 3000 (`mock-server/server.mjs`) |
| `pnpm --filter @ari/web dev` | Starts Vite on port 5173. `/api` goes to `API_URL` (default `http://localhost:3000`) |
| `pnpm --filter @ari/web build` | Type check and production build to `dist/` |
| `pnpm --filter @ari/web test` | Unit tests (Vitest) |
| `pnpm --filter @ari/web test:e2e` | Builds, then runs Playwright against the mock API |
| `pnpm --filter @ari/web typecheck` | TypeScript check of the app and the e2e tests |
| `pnpm --filter @ari/web lint` | ESLint, no warnings allowed |

To use the real API: `API_URL=http://localhost:8080 pnpm --filter @ari/web dev`. Use `localhost`, not `127.0.0.1`, because of the `__Host-` cookies.

## Key files

| Path | Content |
|---|---|
| `src/zod-config.ts` | zod jitless mode. Imported first, so the CSP needs no `unsafe-eval` |
| `src/main.tsx` | Entry point |
| `src/routes/route-table.tsx` | Routes and the roles that may open each one |
| `src/app/` | Session and locale providers |
| `src/features/` | Screens per module (search, requests, ingestion, governance, audit) |
| `mock-server/` | Mock API for development and Playwright |
| `e2e/` | Playwright tests per role |

The app uses `@ari/design-system`, `@ari/i18n` and `@ari/api-client`. CSS uses logical properties only.
