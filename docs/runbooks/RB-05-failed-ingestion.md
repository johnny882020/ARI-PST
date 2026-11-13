# RB-05 Failed ingestion
Trigger: import job failed or over 20% of rows rejected. Severity: Sev3.

## Steps
1. Open the import run report: counts and reject reason codes. No row values.
2. `schema_mismatch` or `missing_field`: tell the coordinator which field codes failed. They fix the file. Never hand-edit data in the database.
3. `forbidden_field` (a column that looks like an identifier): treat as RB-03. Quarantine the staged file. Delete it only after the Privacy lead decides.
4. `job_error`: check logs by `traceId`, fix, rerun. Import is idempotent by `sample_code`.
5. Confirm record counts changed as expected and `last_verified_at` updated.
6. Tell the coordinator the result through notifications.

## Verify
The next run succeeds.
