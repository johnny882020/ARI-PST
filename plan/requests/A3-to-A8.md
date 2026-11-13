# A3 to A8 (V&V)
1. Executable SQL checks exist: `03-data-integration/sql/tests/test_rls_k.sql` (passes on PostgreSQL 16.15). Extend them, do not replace them.
2. Synthetic generator spec: `09-synthetic-data-spec.md` and `yaml/synthetic-generator.yaml`. Profiles `tiny`, `kedge`, `stale`, `preview`, `load`. Dirty import corpus with expected rules.
3. Properties to test: no external facet cell below k; shown buckets sum to total unless suppressed; filter gate; RLS matrix; separation-of-duties trigger; audit chain tamper detection (change a row in a test DB as superuser with triggers disabled, expect `verify_chain` to return its seq).
4. Export round trip (see `08-retention-export-backup.md`).
5. Import: identifier guards must reject rows and the report must contain no cell values (assert on the report bytes).
