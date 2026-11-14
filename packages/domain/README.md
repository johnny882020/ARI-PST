# @ari/domain

Pure domain core of the ARI-PST Portal. It holds the rules and the ports. It imports no platform library (no database, HTTP, storage or e-mail code). `pnpm arch` enforces this.

## Scripts

| Command | What it does |
|---|---|
| `pnpm --filter @ari/domain test` | Unit tests (Vitest) |
| `pnpm --filter @ari/domain exec vitest run src/request-state.test.ts` | One test file |
| `pnpm --filter @ari/domain typecheck` | TypeScript check |

## Key files

| Path | Content |
|---|---|
| `src/roles.ts` | The seven roles |
| `src/capabilities.ts` | One role table per operation. It generates the OpenAPI `x-roles`, the authz matrix test and the route guards |
| `src/request-state.ts`, `src/request-flow.ts` | Request state machine (canonical enum) and close reasons |
| `src/voting.ts` | N-of-M committee voting |
| `src/k-anonymity.ts` | k-anonymity rules (k ≥ 5) |
| `src/identifier-guard.ts` | Patterns that block identifier-like text |
| `src/session-policy.ts` | Idle and absolute timeouts, step-up age |
| `src/staleness.ts`, `src/import-rules.ts`, `src/budget.ts` | Freshness, import and query budget rules |
| `src/ports.ts` | Ports: Repository, Auth, ObjectStore, Mailer, Clock, Audit |

The database enforces the same request moves with triggers (`db/migrations/0006_request_workflow.sql`). Keep both in step.
