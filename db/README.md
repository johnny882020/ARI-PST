# ARI-PST database (B1)

PostgreSQL 16. Forward-only SQL migrations, a runner, tests that run as the real non-superuser roles, synthetic seed, and a full export/import.
Synthetic data only until GATE-PROD-DATA. Canonical decisions (`plan/11-integration/canonical-decisions.md`) win over this file.

## Layout
| Path | Purpose |
|---|---|
| `bootstrap.sql` | Run ONCE by an admin: creates roles (C-06), database ownership, grants. Idempotent. |
| `migrations/0001..0010` | Plain SQL, one transaction each, recorded in `public.schema_migrations(version,name,checksum,applied_at)`. |
| `migrate.mjs` | Runner: `DATABASE_URL_MIGRATOR=... node db/migrate.mjs [--dry-run] [--dir d]`. Checksums, advisory lock, rollback on error, refuses superuser. |
| `seed.mjs`, `seeds/` | Vocabulary + synthetic dataset (`packages/synthetic-data`) + requests driven through the real functions. Needs `DATABASE_URL_ADMIN` (bypasses RLS) and `DATABASE_URL_RUNTIME`. Refuses when `GATE_PROD_DATA_CLOSED=true` or non-synthetic samples exist. |
| `export.mjs` / `import.mjs` | NDJSON per table + `manifest.json` (sha256, counts, audit chain heads). `--include-keys` adds `audit.chain_key` (ops only). |
| `scripts/test-db.sh` | Starts PG16 on port 55432 (data `/tmp/ari-pst-pg`, trust auth), bootstraps, migrates, runs vitest. Extra args go to vitest. |
| `tests/` | 10 files, 134 tests. `lib/session.mjs` is the reference for the API adapter. |

## Roles (canonical C-06)
| Role | Use | Notes |
|---|---|---|
| `app_migrator` | owns tables, runs migrations only | FORCE RLS has no policy for it: it cannot read data. Not superuser. |
| `app_runtime` | the API | Member of no role, so no `SET ROLE`. Owns nothing. Statement timeout 15 s. |
| `app_audit_writer` | only role with INSERT on `audit.audit_events`; auth adapter may log in as it for `audit.record_trusted` | |
| `app_readonly_bg` | cron: snapshot refresh, expiry, staleness, retention, audit verify/anchor | No table privilege; only `EXECUTE` on maintenance functions. |
| `app_break_glass` | NOLOGIN until ops enable it; reads rows only during a 2-approver, 1-hour grant | Used by `export.mjs`. |
| `app_core`, `app_agg` | internal NOLOGIN owners of definer functions | Not reachable by the runtime. |
Schemas: `portal`, `audit`, `search`, `ext`, `agg`, `authn`, `ops`. Redefining a definer function in a later migration: `SET LOCAL ROLE app_core; CREATE OR REPLACE ...; RESET ROLE;` (needs `GRANT CREATE` on the schema for the transaction), then call `SELECT portal._assign_owners();`. New functions get no PUBLIC execute (default privileges): add explicit `GRANT EXECUTE`.

## How the API must talk to the DB
```sql
BEGIN;
SELECT portal.begin_session('usr_...', 'researcher_il');   -- or (NULL,'anonymous'); once per transaction; role must be assigned and user active
-- ... statements and function calls ...
COMMIT;
```
`begin_session` verifies the role against `role_assignments`, derives the center for `center_clinician`, and stores an HMAC-signed context in a transaction-local setting. Setting `app.*` GUCs yourself does nothing (fail closed). The signature secret never leaves the DB. The caller authenticates the user (AuthPort, MFA); the DB trusts that and passes a fresh step-up age (`p_stepup_age_s`, <= 300 s) to approvals. Use one transaction per request. Denials: write them with `audit.record_denial(...)` in a NEW transaction after the failed one rolled back.
Errors are SQLSTATE + short message code (no identifiers): `42501 forbidden|stepup_required|second_approver_required|session_denied(28000)|session_already_started`, `23514 invalid_transition|form_incomplete|checklist_incomplete|k_floor|separation_of_duties|...`, `P0002 not_found`, `23505 already_voted`, `22023 invalid_*|filter_limit|unknown_facet`.

## Function contract (all `SECURITY DEFINER`, `EXECUTE` for `app_runtime` unless noted)
**Session / audit**
- `portal.begin_session(p_user_id text, p_role text) -> void`
- `portal.cur_user_id()`, `portal.cur_role()`, `portal.cur_center_id() -> text`
- `audit.record(p_action text, p_object_type text=NULL, p_object_id text=NULL, p_outcome text='allow', p_details jsonb='{}', p_trace text=NULL) -> void` (actor and role come from the session; outcome `allow|deny|error`; action `^[a-z_]+(\.[a-z_]+)+$`)
- `audit.record_denial(p_action, p_object_type, p_object_id, p_reason_code, p_trace) -> void`
- `audit.record_trusted(p_actor, p_role, p_center, p_action, p_object_type, p_object_id, p_outcome, p_details, p_trace) -> void` (only the `app_audit_writer` login: auth events before a session exists)
- `audit.read_events(p_since, p_until, p_action_prefix, p_limit) -> (id, occurred_at, actor_user_id, actor_role, action, object_type, object_id, outcome, details, lane, lane_seq, entry_hash)`; scoped by role; logs `audit.read`
- `audit.verify_chain(p_log boolean=true) -> (lane, broken_seq, reason)` (empty = intact; `app_readonly_bg` or system_admin), `audit.anchor() -> (lane, last_seq, last_hash, anchor_hmac)` for the daily external anchor
Chain: 8 lanes, each a gapless HMAC-SHA256 chain with a key held only in the DB (`audit.chain_key`); writers take any unlocked lane (no global lock). Purge only whole prefixes with a truncation record.

**Users and governance** (two-person rules enforced here)
- `portal.user_register(email, display_name, locale, requested_role) -> (user_id, verification_token)` (anonymous), `portal.user_verify_email(user_id, token) -> boolean`
- `authn.register_researcher(id, email, display_name, institution, requested_role, locale) -> boolean` (anonymous; false when e-mail exists) with `portal.registrations_pending()` and `portal.approve_registration(user_id)` / `portal.researcher_approve(user_id)` / `portal.researcher_reject(user_id)` (coordinator; needs verified e-mail)
- `portal.user_invite(email, name, locale) -> id` (admin, coordinator), `portal.user_set_status(user_id, 'active'|'suspended'|'closed')` (admin, not self), `portal.role_revoke(assignment_id)` (admin)
- `portal.change_propose(kind, payload jsonb) -> change_id`; `portal.change_approve(change_id, p_stepup_age_s int)`; `portal.change_reject(change_id)`
  - `role_grant` `{user_id, role, center_id?}`: coordinator/admin propose clinician grants (other of the two approves); admin proposes coordinator (committee approves), committee_member (coordinator approves), system_admin (another admin approves)
  - `k_policy` `{field_set, k}` (k >= 5): admin proposes, committee_member approves. `committee_config` `{votes_needed >= 2, members_total >= votes_needed}`: same
  - The proposer can never approve. `portal.config_set(key, scope, value)` for `staleness.*` (coordinator/admin) and `request.*`/`retention.*` (admin).
- `portal.breakglass_request(purpose_code)` (admin), `portal.breakglass_approve(id, stepup)` (two distinct committee/coordinator users), `portal.breakglass_active()`
- `portal.user_update_self(display_name, locale)`, `portal.user_admin_rename(user_id, name)`
- `portal.bootstrap_first_admin(email, name)` only `app_migrator` (ops, once)

**Samples**: direct DML as coordinator through RLS (clinician read-only, own center). Read through `portal.v_samples` (never `SELECT *` on `portal.samples`: `donor_ref` has no SELECT grant). `portal.sample_donor_ref(sample_id)` to add another sample of the same donor, `portal.donor_correct(sample_id, dx, sex, age_band)`, `portal.sample_verify(sample_id)` (clinician own center, coordinator). Samples of one donor must agree on diagnosis, sex, age band, center (DB check).

**Search / privacy engine** (`agg`, any of researcher_il, researcher_intl, center_clinician, national_coordinator, committee_member; not admin, not anonymous)
- `agg.total_count(p_filters jsonb) -> (n int, band text, masked boolean)`
- `agg.facet_counts(p_filters jsonb, p_facet text) -> (bucket, bucket_level, n, band, masked, merged)`; facets `diagnosis|sampleType|ageBand|sex|center|timepoint|availability|attachedData`
- `n` is exact only when >= 10; 5..9 gives `band='lt10'`, `n=NULL`; masked gives nothing (UI text "Too few to show"). k, thresholds and donor refs are never returned. Filters: `diagnosis, sampleType, ageBand, sex, centerId, timepoint, availability, attachedData`; at most 4 keys, 3 values per key.
- `agg.current_epoch() -> int` (cache key), `agg.refresh_snapshot() -> int` (bg, nightly). New samples appear after the next refresh.
- `search.expand_query(q text, limit int) -> (diagnosis_code, score, matched_via)`
- `ops.log_query(query_key, institution, cost)`, `ops.budget_spent(institution) -> (day_cost, d30_cost, inst_30d_cost)`: budgets Q_DAY_COST etc. are the API's job, the DB keeps the ledger.

**Requests** (state machine and votes live in the DB; status columns are not writable by the runtime)
- Applicant: `portal.request_create(idem_key) -> id`; then `UPDATE portal.requests SET research_question, applicant_ethics_ref, planned_use, funding_sources` and `INSERT INTO portal.request_items` while draft/needs_info; `request_submit(id, idem_key) -> state` (auto precheck when a coordinator exists), `request_respond_info(id)`, `request_withdraw(id)`, `request_start_appeal(id)`, `request_timeline(id) -> jsonb`
- Coordinator: `request_start_precheck`, `request_ask_info(id, reason_code, public_note)` (also committee), `request_precheck_pass(id, checklist jsonb)`, `request_precheck_reject(id, reason_code)`, insert `request_item_samples (request_item_id, sample_id)` once approved, `request_start_center_coordination(id) -> n centers`, `request_center_respond(id, center_id, accept, note)` (clinician own center or coordinator), `request_record_agreement(id, center_id, 'mta'|'dta', doc_ref)`, `request_start_delivery(id)`, `request_cancel_policy(id, detail)` (also admin)
- Committee: `request_cast_vote(id, 'approve'|'reject'|'abstain', rationale_code, comment) -> 'recorded'|'approved'|'rejected'`, `request_declare_conflict(id)`. One vote per member per round; reject needs a rationale code; quorum N-of-M from `committee_config`; appeal round excludes first-round voters when enough others remain.
- Delivery: only the holding center's clinician: `request_center_delivered(id, center_id)`; the last one closes the request as `delivered`. The coordinator cannot.
- Admin: `request_metadata(limit)` (no content). Background: `request_expire_overdue(now)`.
- Canonical states and close reasons: `portal.request_status`, `portal.close_reason`; allowed moves are rows of `portal.request_transition_rules` (also enforced by trigger even for superusers). `closed` is terminal.

**Operations (background role)**: `agg.refresh_snapshot()`, `portal.request_expire_overdue()`, `portal.staleness_run()`, `portal.retention_run(now)`, `audit.verify_chain()`, `audit.anchor()`, `portal.migration_level()`.
**Notifications**: `ops.outbox_enqueue(id, template, to_role, to_user, to_email, locale, params)` (needs a session), `ops.outbox_claim(limit)` / `ops.outbox_mark(id, ok, give_up)` (worker only: refused while a user session is active), `ops.outbox_list(limit)` (admin). `ops.metrics()`.

## /readyz
`SELECT portal.migration_level()` returns the highest applied migration number (`'0010'` now). `/readyz` = query succeeds AND the value equals (or is >=) the level compiled into the API. Works for any session and for `app_readonly_bg`.

## Privacy engine summary (RT-01, RT-02, RT-28, C-08, C-09)
Counts are distinct donors from the epoch snapshot `agg.snapshot` / `agg.donor_snapshot`. A cell is shown only if donors >= k (k >= 5, CHECK) and no displayable neighbour query (drop a filter, parent diagnosis, remove one OR value, tight single-dimension cover of the cell's donors in sex/age/center/diagnosis) differs by 1..k-1 donors. Small or unsafe cells are merged up the diagnosis hierarchy, then into one `other` cell; if that is small or unsafe the smallest shown cell is pulled in. Pairs where both answers are banded (< 10) are not comparable and are ignored. The test `privacy.test.mjs` brute-forces ~250 queries and all shown facet cells against the raw data and fails on any pair with a 1..4 difference.

## Retention (needs legal review, values in `portal.workflow_config`)
Request free text wiped 24 months after close, record purged after 7 years, soft-deleted samples purged after 24 months (request history keeps `sample_code` + center as tombstone), closed users anonymised after 12 months, import jobs/rows, idempotency keys 24 h, query log 13 months, audit events 7 years (whole prefixes + truncation record). Backups are rotated by the provider (35 days, UNVERIFIED).

## Known gaps
- Aggregate p95 at 50k samples is about 850 ms on the CI VM (target C-12: 800 ms); the perf test budget is 1500 ms (`PERF_P95_MS`). The API should cache per canonical query and `agg.current_epoch()`.
- Privacy engine residual risk: deeper multi-predicate combinations beyond single-dimension covers, and exact-vs-banded pairs (range, not a point), are not checked. The API must still apply rate limits, cost budgets and predicate caps. Zero-vs-small is identical for `attachedData` and masked totals, but a facet shows an `other` row only when something small exists.
- `begin_session` trusts the caller for authentication and step-up age (DB cannot verify MFA). A compromised API can impersonate users; the DB still stops privilege escalation, SoD violations and direct state changes.
- Audit chain key lives in the DB (not an external KMS). Daily external anchor is a job outside the DB (`audit.anchor()` provides the material). No key rotation function yet (`key_version` column is ready).
- Denial events are written by the API in a new transaction; there is no DB-side rate limit on `audit.record_denial`.
- Seeding needs a role that bypasses RLS (superuser or BYPASSRLS). Render preview databases may not allow this: use the API bootstrap instead (not built).
- xlsx import files and the importer itself are not part of B1. `makeImportFile` produces CSV corpus only. No `diagnosis_map` table.
- Export signature (detached `manifest.json.sig`) and `docs/data-dictionary.md` generation are not built. `authn.*`, `ops.*` and `agg.*` are excluded from export by design.
- Needs legal review: all retention periods, break-glass governance, and the whole coded-data regime.
