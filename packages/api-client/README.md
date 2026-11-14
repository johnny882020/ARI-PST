# @ari/api-client

Typed client for the portal API. The types are generated from `packages/contracts/openapi.yaml`. Do not edit `src/generated/` by hand.

## Scripts

| Command | What it does |
|---|---|
| `pnpm --filter @ari/api-client gen` | Regenerates `src/generated/schema.d.ts` (`openapi-typescript`) |
| `pnpm --filter @ari/api-client gen:check` | Regenerates and fails if `src/generated/` changed |
| `pnpm --filter @ari/api-client test` | Unit tests |
| `pnpm --filter @ari/api-client typecheck` | TypeScript check |

## Key files

| Path | Content |
|---|---|
| `src/generated/schema.d.ts` | Generated types |
| `src/client.ts` | Fetch client with CSRF header and same-origin cookies |
| `src/problem.ts` | Problem+json error type |
| `src/ext.ts` | Small hand-written type extensions |
