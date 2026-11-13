# A3 to A1 (Architect)
1. Merge `03-data-integration/openapi/openapi.yaml` into `packages/contracts`. Please review path names. New endpoints you may need: `/health`, `/problems/*` docs, `/me`.
2. Ports defined by A3 in `06-integrations.md`: `ClinicalReferencePort`, `BaseDataImportPort`, `PathologyScanPort`, `GenomicsAvailabilityPort`, `PartnerAggregatePort`. Please add them to the module map and the capability map (Base44).
3. The Postgres adapter must open each transaction as: `SET LOCAL ROLE portal_<role>` and `set_config('app.user_id', ..., true)` (+ `app.center_id` for clinicians). Search and audit logic lives in SQL functions (`search.*`, `audit.append`). Decide if this is acceptable for Base44 portability. The fallback is app-side checks. Please record an ADR.
4. Migrations path `db/migrations`, forward-only, expand/contract (see `03-data-model.md`). Table `schema_migrations` is not in A3 DDL yet. Please own the runner.
5. Weekly staleness cron and nightly approval-expiry cron call `notifications`. Define the port.
6. The worker for imports needs its own process (Render background worker or cron-triggered job). Please place it in the architecture.
7. Rows are text IDs with prefix + ULID. Please confirm the ULID library choice and that the API, not the DB, generates IDs.
