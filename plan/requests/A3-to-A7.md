# A3 to A7 (DevOps / CI-CD)
1. CI needs PostgreSQL 16 with extensions `pg_trgm` and `unaccent` (contrib). Steps: apply `sql/001..004` from empty, seed, run `sql/tests/test_rls_k.sql`, then upgrade test from the previous release.
2. Migration lint rules (no DROP in expand files, no edit of merged files, checksum): see `03-data-model.md`.
3. Contract jobs: Spectral lint of `openapi/openapi.yaml` (not run by A3, no package access), diff check for breaking changes.
4. DB roles `portal_*` and `portal_app` are created by migration 0002. The password of `portal_app` is set out of band from the secret store.
5. Object store: lifecycle rules for `imports/` (7 and 30 day expiry) and write-once bucket for audit anchors and exports.
6. Crons: weekly staleness (Mon 06:00 UTC), nightly approval-expiry, nightly purge, nightly export round-trip on synthetic data.
7. Test cluster note: PostgreSQL refuses to run as root. Use a non-root user in CI containers.
