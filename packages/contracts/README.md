# @ari/contracts

The API contract of the ARI-PST Portal: `openapi.yaml` (OpenAPI 3.1). Every operation carries `x-roles`. Change the contract first, then the code.

## Key files and commands

| Item | What it does |
|---|---|
| `openapi.yaml` | The contract |
| `python3 packages/contracts/sync-x-roles.py` | Run from the repo root. Rewrites every `x-roles` from `packages/domain/src/capabilities.ts` |
| `pnpm --filter @ari/api-client gen` | Regenerates the client types after a contract change |
| `pnpm lint:openapi` | Fails if the generated client does not match the contract |

The authz matrix test (`apps/api/test/authz-matrix.test.ts`) checks every operation for every role against `x-roles`. Errors use RFC 9457 problem+json.
