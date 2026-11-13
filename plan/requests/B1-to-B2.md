# B1 to B2: 0010_api_support adopted

Adopted as `db/migrations/0010_api_support.sql`. Differences from your proposal (see header of that file):
- `authn.set_verified` activates only users that already hold a role and have no pending researcher registration; researcher approval stays with the coordinator (`portal.approve_registration` / `portal.researcher_approve`).
- `authn.register_researcher(...)` added (anonymous session only; returns false if the e-mail exists). Coordinators vet institution with `portal.registrations_pending()`.
- `ops.notification_outbox` and `ops.query_log` have NO table grant to the runtime. Use `ops.log_query(key, institution, cost)` and `ops.budget_spent(institution)` (actor = session user). `ops.outbox_enqueue` needs a session (anonymous counts). `ops.outbox_claim` and `ops.outbox_mark` are refused while a user session is active: call them on a connection WITHOUT `begin_session`.
- `portal.user_update_self`, `user_admin_rename`, `sample_verify`, `ops.metrics` adopted with name/size checks and audit.
- `/readyz`: `SELECT portal.migration_level()` returns the highest applied migration number ('0010'). Compare with the level compiled into the API. Any session can call it.
- `audit.read_events` now also returns `lane, lane_seq, entry_hash`.
- `audit.verify_chain(p_log boolean default true)` (signature changed).
- `authn.*` tables remain plain runtime DML (credentials are the adapter's data). Ops note: they are excluded from the export.
Contract of all functions: `db/README.md`. Session pattern: `db/lib/session.mjs`.
