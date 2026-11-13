-- API support objects (proposal from B2 to B1, see plan/requests/B2-to-B1.md). Schemas `authn` (credentials, sessions) and `ops` (outbox, query budget).
-- Apply as app_migrator after 0009. Tests apply it as a superuser when db/migrations does not contain it yet.
CREATE SCHEMA IF NOT EXISTS authn;
CREATE SCHEMA IF NOT EXISTS ops;
GRANT USAGE ON SCHEMA authn, ops TO app_runtime;

CREATE TABLE authn.credentials (
  user_id text PRIMARY KEY REFERENCES portal.users(id) ON DELETE CASCADE,
  password_hash text NOT NULL, password_changed_at timestamptz NOT NULL DEFAULT now(),
  failed_count int NOT NULL DEFAULT 0, locked_until timestamptz,
  totp_secret_enc text, totp_confirmed_at timestamptz, totp_pending_enc text, totp_last_step bigint NOT NULL DEFAULT -1);
CREATE TABLE authn.webauthn_credentials (
  credential_id text PRIMARY KEY, user_id text NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  public_key bytea NOT NULL, counter bigint NOT NULL DEFAULT 0, transports text[], created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz);
CREATE TABLE authn.recovery_codes (id bigserial PRIMARY KEY, user_id text NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE, code_hash bytea NOT NULL, used_at timestamptz);
CREATE INDEX ON authn.recovery_codes (user_id);
CREATE TABLE authn.sessions (
  id_hash bytea PRIMARY KEY, user_id text NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), mfa_at timestamptz,
  ip_hash text, csrf_token text NOT NULL, roles jsonb NOT NULL, display_name text NOT NULL, locale text NOT NULL, revoked_at timestamptz);
CREATE INDEX ON authn.sessions (user_id);
CREATE TABLE authn.challenges (
  token_hash bytea PRIMARY KEY, user_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('login','webauthn_reg','webauthn_auth','invite')),
  webauthn_challenge text, attempts int NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA authn TO app_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA authn TO app_runtime;

CREATE FUNCTION authn.find_login(p_email text) RETURNS TABLE (user_id text, status text, email_verified boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
  SELECT id, status::text, email_verified_at IS NOT NULL FROM portal.users WHERE email = lower(p_email) $$;
CREATE FUNCTION authn.user_roles(p_user_id text) RETURNS TABLE (id text, role text, center_id text, granted_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
  SELECT id, role::text, center_id, granted_at FROM portal.role_assignments WHERE user_id = p_user_id AND revoked_at IS NULL ORDER BY granted_at $$;
CREATE FUNCTION authn.profile(p_user_id text) RETURNS TABLE (email text, display_name text, locale text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
  SELECT email, display_name, locale, status::text FROM portal.users WHERE id = p_user_id $$;
CREATE FUNCTION authn.set_verified(p_user_id text, p_activate boolean) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
  UPDATE portal.users SET email_verified_at = coalesce(email_verified_at, now()), status = CASE WHEN p_activate AND status = 'invited' THEN 'active'::portal.user_status ELSE status END WHERE id = p_user_id $$;
CREATE FUNCTION authn.touch_login(p_user_id text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$ UPDATE portal.users SET last_login_at = now() WHERE id = p_user_id $$;
CREATE FUNCTION authn.user_roles_batch(p_user_id text) RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
  SELECT count(*)::int FROM portal.role_assignments WHERE user_id = p_user_id AND revoked_at IS NULL $$;

-- ops: notification outbox (to_role fans out to every active holder of the role) and query budget log
CREATE TABLE ops.notification_outbox (
  id text PRIMARY KEY, template text NOT NULL, to_user_id text, to_email text, locale text NOT NULL DEFAULT 'he', params jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')), attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz);
CREATE INDEX ON ops.notification_outbox (status, created_at);
CREATE FUNCTION ops.outbox_enqueue(p_id text, p_template text, p_to_role text, p_to_user text, p_to_email text, p_locale text, p_params jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, portal, ops, pg_temp AS $$
DECLARE r record; n int := 0;
BEGIN
  IF p_to_role IS NOT NULL THEN
    FOR r IN SELECT u.id, u.email, u.locale FROM portal.users u JOIN portal.role_assignments ra ON ra.user_id = u.id
             WHERE ra.role = p_to_role::portal.role_name AND ra.revoked_at IS NULL AND u.status = 'active' LOOP
      n := n + 1;
      INSERT INTO ops.notification_outbox (id, template, to_user_id, to_email, locale, params) VALUES (p_id || '_' || n, p_template, r.id, r.email, r.locale, p_params);
    END LOOP;
  ELSIF p_to_user IS NOT NULL THEN
    INSERT INTO ops.notification_outbox (id, template, to_user_id, to_email, locale, params)
      SELECT p_id, p_template, u.id, coalesce(p_to_email, u.email), coalesce(p_locale, u.locale), p_params FROM portal.users u WHERE u.id = p_to_user;
  ELSE
    INSERT INTO ops.notification_outbox (id, template, to_email, locale, params) VALUES (p_id, p_template, p_to_email, coalesce(p_locale,'he'), p_params);
  END IF;
END $$;
CREATE FUNCTION ops.outbox_claim(p_limit int) RETURNS TABLE (id text, template text, to_email text, locale text, params jsonb, attempts int)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, ops, pg_temp AS $$
  UPDATE ops.notification_outbox o SET attempts = o.attempts + 1 WHERE o.id IN (
    SELECT x.id FROM ops.notification_outbox x WHERE x.status = 'pending' ORDER BY x.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
  RETURNING o.id, o.template, o.to_email, o.locale, o.params, o.attempts - 1 $$;
CREATE FUNCTION ops.outbox_mark(p_id text, p_ok boolean, p_give_up boolean) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, ops, pg_temp AS $$
  UPDATE ops.notification_outbox SET status = CASE WHEN p_ok THEN 'sent' WHEN p_give_up THEN 'failed' ELSE 'pending' END,
    sent_at = CASE WHEN p_ok THEN now() END, params = CASE WHEN p_ok OR p_give_up THEN '{}'::jsonb ELSE params END WHERE id = p_id $$;
CREATE FUNCTION ops.outbox_list(p_limit int) RETURNS TABLE (id text, template text, status text, attempts int, created_at timestamptz, sent_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, ops, portal, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('system_admin');
  RETURN QUERY SELECT o.id, o.template, o.status, o.attempts, o.created_at, o.sent_at FROM ops.notification_outbox o ORDER BY o.created_at DESC LIMIT least(p_limit, 500);
END $$;
CREATE TABLE ops.query_log (user_id text NOT NULL, institution text, query_key text NOT NULL, cost int NOT NULL, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON ops.query_log (user_id, at DESC);
CREATE INDEX ON ops.query_log (institution, at DESC);
GRANT SELECT, INSERT ON ops.query_log TO app_runtime;
CREATE FUNCTION ops.metrics() RETURNS TABLE (samples_total int, centers_feeding int, registered_researchers int, searches_30d int, entered_share numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, ops, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('national_coordinator','committee_member','system_admin');
  RETURN QUERY SELECT (SELECT count(*)::int FROM portal.samples WHERE deleted_at IS NULL), (SELECT count(*)::int FROM portal.centers WHERE feeds_regularly),
    (SELECT count(DISTINCT user_id)::int FROM portal.role_assignments WHERE role IN ('researcher_il','researcher_intl') AND revoked_at IS NULL),
    (SELECT count(*)::int FROM ops.query_log WHERE at > now() - interval '30 days'),
    (SELECT coalesce(avg((source_system IN ('portal_entry','csv_import'))::int), 0) FROM portal.samples WHERE deleted_at IS NULL);
END $$;
-- clinician or coordinator confirms a record (own center for clinicians)
CREATE FUNCTION portal.sample_verify(p_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE r text := portal._require_role('center_clinician','national_coordinator');
BEGIN
  UPDATE portal.samples SET last_verified_at = now() WHERE id = p_id AND deleted_at IS NULL AND (r = 'national_coordinator' OR source_center_id = portal.cur_center_id());
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM audit.record('sample.update', 'sample', p_id, 'allow', '{"fields":["last_verified_at"]}');
END $$;
GRANT EXECUTE ON FUNCTION authn.find_login(text), authn.user_roles(text), authn.profile(text), authn.set_verified(text,boolean), authn.touch_login(text),
  ops.outbox_enqueue(text,text,text,text,text,text,jsonb), ops.outbox_claim(int), ops.outbox_mark(text,boolean,boolean), ops.outbox_list(int), ops.metrics(),
  portal.sample_verify(text) TO app_runtime;
