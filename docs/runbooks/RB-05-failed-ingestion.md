# RB-05 Failed ingestion

## When to use
- An import job failed.
- Over 20% of the rows of an import were rejected.

Severity: Sev3.

## Prerequisites
- `national_coordinator` access to the import run report.
- Log access by `traceId`.

## Steps
1. Open the import run report: counts and reject reason codes. It shows no row values.
2. `schema_mismatch` or `missing_field`: tell the coordinator which field codes failed. The coordinator fixes the file. Never hand-edit data in the database.
3. `forbidden_field` (a column that looks like an identifier): treat it as RB-03. Quarantine the staged file. Delete it only after the Privacy lead decides.
4. `job_error`: check the logs by `traceId`, fix the cause, run the import again. Import is idempotent by `sample_code`.
5. Confirm that record counts changed as expected and that `last_verified_at` was updated.
6. Tell the coordinator the result through notifications.

## Verify
The next run succeeds.

## Rollback
An import that was committed in error: the coordinator retires the affected samples. Do not delete rows in the database.

## Escalation
Data owner. Privacy lead for a `forbidden_field`.
