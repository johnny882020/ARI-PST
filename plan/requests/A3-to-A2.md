# A3 to A2 (Security and Privacy)
1. **k-rule.** Please confirm the rules in `03-data-integration/04-search-design.md` section "How k-anonymity is applied": gate below k, roll-up type > family > group > other, complementary suppression, no merge for overlapping `attachedData`. k = 5 default, field sets `default`, `diagnosis`, `center`, `partner` (Phase 3).
2. **Count banding.** Decide if `search.count_label` (shows `5-9`) is on for facets, request carts, both, or off.
3. **Differencing.** SQL cannot stop repeated-query attacks. Please set per-user rate limits, a distinct-filter-combination cap, and the audit event `search.aggregate` (filter hash only). Add the residual risk to your register.
4. **DB role model.** External roles have no SELECT on samples (tested). API must run `SET LOCAL ROLE` + `set_config('app.user_id'|'app.center_id')` per transaction. Confirm you accept this model (file `sql/002_roles_rls.sql`). Credentials live in schema `authn`, owned by your adapter. Not defined by A3.
5. **Identifier guards.** `yaml/import-columns.yaml` lists regex guards G1..G6 for import cells. Please review the patterns and add request-form (free text) scanning on submit.
6. **Audit.** Hash chain and `audit.append()` are in `sql/001_core.sql`. Please define: the audit action list, daily anchor of `last_hash` to write-once storage, retention (A3 proposes 7 years).
7. **Full export vs separation of duties (OPEN-A3-07).** A full export contains samples, but `system_admin` must not read sample data. A3 proposes an automated job, ops-only key, dual control. Please confirm or change.
8. **Retention proposals** in `08-retention-export-backup.md` need your review and legal review.
9. **Consent status vocabulary** is a placeholder (ASSUMPTION-A3-04). Needs legal review.
