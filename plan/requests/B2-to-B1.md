# B2 (API) to B1 (DB): objects the API needs that are not in 0001-0003

Source: `apps/api` adapters. Names are what the adapters call. If you prefer other names, tell B2 or keep these.
All objects are owned by `app_migrator` (definer functions handed to `app_core` as usual). Runtime role = `app_runtime`.

## 1. Schema `authn` (credentials and sessions). No RLS needed. GRANT SELECT, INSERT, UPDATE, DELETE to `app_runtime`.
```sql
CREATE SCHEMA authn;
CREATE TABLE authn.credentials (
  user_id text PRIMARY KEY REFERENCES portal.users(id) ON DELETE CASCADE,
  password_hash text NOT NULL, password_changed_at timestamptz NOT NULL DEFAULT now(),
  failed_count int NOT NULL DEFAULT 0, locked_until timestamptz,
  totp_secret_enc text, totp_confirmed_at timestamptz, totp_last_step bigint NOT NULL DEFAULT -1);
CREATE TABLE authn.webauthn_credentials (
  credential_id text PRIMARY KEY, user_id text NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  public_key bytea NOT NULL, counter bigint NOT NULL DEFAULT 0, transports text[], created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz);
CREATE TABLE authn.recovery_codes (id bigserial PRIMARY KEY, user_id text NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE, code_hash bytea NOT NULL, used_at timestamptz);
CREATE TABLE authn.sessions (
  id_hash bytea PRIMARY KEY, user_id text NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), mfa_at timestamptz,
  ip_hash text, csrf_token text NOT NULL, roles jsonb NOT NULL, display_name text NOT NULL, locale text NOT NULL, revoked_at timestamptz);
CREATE INDEX ON authn.sessions (user_id);
CREATE TABLE authn.challenges (
  token_hash bytea PRIMARY KEY, user_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('login','webauthn_reg','webauthn_auth','email_verify','invite')),
  webauthn_challenge text, attempts int NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL);
```
## 2. Login lookups before a session exists (SECURITY DEFINER, EXECUTE to app_runtime)
- `authn.find_login(p_email text) RETURNS TABLE(user_id text, status text, email_verified boolean)`
- `authn.user_roles(p_user_id text) RETURNS TABLE(id text, role text, center_id text, granted_at timestamptz)` (active only)
- `authn.register_researcher(p_id text, p_email text, p_display_name text, p_institution text, p_requested_role text, p_locale text) RETURNS boolean`
  (creates `users` status `invited`, a `researcher_registrations` row; returns false when the email exists; no error either way)
- `authn.set_user_status(p_user_id text, p_status text)` and `authn.touch_login(p_user_id text)` (login timestamp)
- `authn.verify_email_token(p_user_id ...)` is NOT needed: the API keeps tokens in `authn.challenges` (kind email_verify/invite).
## 3. Other
- `portal.notification_outbox(id text pk, template text, to_user_id text, to_email text, locale text, params jsonb, status text default 'pending', attempts int default 0, created_at, sent_at)`; INSERT for all runtime roles; claim/mark functions for the in-process worker (or direct grant on app_core path).
- `search.query_log(user_id text, institution text, query_key text, cost int, at timestamptz default now())` plus `search.budget_spent(user, institution)` or SELECT grant, for Q_DAY_COST / Q_30D_COST / INST budgets.
- `portal.registration_institution` column on `researcher_registrations` (`institution text`, `is_israeli_academic boolean`) so coordinators can approve; `portal.approve_registration(p_user_id text)` (coordinator; grants researcher_il/intl; sets user `active`, needs verified email).

## UPDATE (B2, after reading 0001-0009)
The concrete DDL is now in `apps/api/db-support/0010_api_support.sql`. Please take it over as migration `0010_api_support.sql` (owned by app_migrator, definer functions through `_assign_owners`, add RLS-free tables to the grant model). It adds: `authn.*` (credentials, TOTP, passkeys, recovery codes, sessions, login challenges), login lookup functions, `ops.notification_outbox` + enqueue/claim/mark/list, `ops.query_log` (query budget, Q_DAY_COST etc.), `ops.metrics()`, `portal.sample_verify(id)` (clinician own center / coordinator; the runtime has no UPDATE policy for clinicians).
Other gaps seen in 0001-0009 (no action needed unless you agree): `researcher_registrations` has no institution column (coordinator cannot vet); no `diagnosis_map` table (import maps by code/label/synonym only); no endpoint-side donor linking (API creates one donor per sample); `portal.request_declare_conflict` exists but is not exposed in the contract yet; k and committee changes are approved by committee_member in `change_approve`, the API follows the DB.
