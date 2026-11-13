# ADR-003 — Database
Status: Proposed. Date: 2026-11-13. Covers: REQ-043, REQ-048, REQ-054.

## Context
Need managed DB, RLS, full-text search, backups, export. Baseline says PostgreSQL.

## Decision
- Render managed PostgreSQL, current major version supported by Render (pin it).
- Paid instance with PITR from day one. HA on production when plan allows. Render docs say HA needs Pro-class instance types or above (source: Render docs via search, 2026-11-13; UNVERIFIED for current plans).
- Extensions: `pg_trgm`, `pgcrypto` (check Render allow-list; UNVERIFIED).
- Plain `.sql` forward-only migrations in `db/migrations`, expand/contract.
- Nightly logical dump (`pg_dump`) by cron to the object store, in addition to Render backups. This is the portable export (REQ-054).
- Connection pool: app-side pool, max set by plan limit.

## Consequences
- Standard Postgres = portable to any host.
- PITR retention depends on workspace plan: 3 days (Hobby), 7 days (Pro+) per Render article via search, 2026-11-13 (UNVERIFIED on official page).
- RPO 15 min in ASSUMPTION-05 is met by PITR (WAL) in principle; verify.

## Trade-off
Managed DB gives less control (no superuser, limited extensions) but far less ops. Self-hosted Postgres on a VM rejected: too much ops for 3-6 people.
