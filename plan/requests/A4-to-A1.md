# A4 to A1 (Architecture)
1. State machine enums (`REQUEST_STATES`, `CLOSE_REASONS`, `ITEM_STATES`) are in plan/04-product-workflow/02-access-request-state-machine.md. Please reuse them in `packages/domain` and OpenAPI.
2. Workflow timers, committee quorum, criteria, k, `stale_after_days` are data tables (`workflow_config`, `committee_config`, `decision_criteria`). Please model them.
3. Need a scheduler (Render cron) for timers, stale job, daily `index.snapshot_taken`.
4. Request items store `sample_code` or a saved filter; applicants must not see record-level data before delivery.
5. Idempotency key on submit; optimistic locking on requests.
