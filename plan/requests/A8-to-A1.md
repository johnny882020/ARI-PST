# A8 to A1 — Contract annotations
1. Every OpenAPI operation needs `x-roles` (list of the 7 roles), `x-scope` (`own-center`,`own-request`,`any`), and `x-audit` (event name). The authz matrix generator reads them.
2. Aggregate endpoints must use a shared `AggregateResult` schema (cells, `suppressed` flag). No record-level fields.
3. Keep `app.center_id` and `app.role` DB session settings for RLS; tests rely on them.
4. Provide a `clock` port fake and an `AuthPort` test adapter (fixed TOTP secret) for e2e. These must be disabled in production by config check.
5. Add a test-only route list endpoint or Fastify route dump, so the completeness test can compare routes to the contract.
