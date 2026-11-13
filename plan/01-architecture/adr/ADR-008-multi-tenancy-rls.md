# ADR-008 — Multi-tenancy by center (RLS)
Status: Proposed. Date: 2026-11-13. Covers: REQ-015, REQ-037, REQ-041, REQ-045.

## Context
`center_clinician` sees only own center. `national_coordinator` sees all centers (non-identified index). External roles see aggregates only.

## Decision
- Single database, shared schema. Each center-scoped table has `center_id`.
- PostgreSQL RLS enabled and `FORCE`d on those tables. Runtime role has no `BYPASSRLS`.
- Per transaction: `SET LOCAL app.user_id`, `app.role`, `app.center_id`. Policies use `current_setting('app.center_id', true)`.
- Aggregates for external roles come from a SECURITY DEFINER function or view that returns only k-safe counts. Record rows are never granted to external roles at DB level.
- App-layer checks stay as second line (`AccessPolicy`). Both must agree. Tests prove RLS alone blocks cross-center reads.
- Separation of duties: `system_admin` has no policy on `samples`.

## Consequences
- Defense in depth. A bug in a route cannot leak another center's rows.
- Every query path must set context. Pool must reset it (`SET LOCAL` inside a transaction).
- Cost: some query-plan overhead. Measure (NFR-PERF).

## Trade-off
Schema-per-center or DB-per-center gives stronger isolation but breaks cross-center search and multiplies migrations. RLS fits few centers and shared queries.
