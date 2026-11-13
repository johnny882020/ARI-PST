-- 0010 API support (adopted from apps/api/db-support/0010_api_support.sql, reviewed by B1). kind: expand
-- Schemas: authn (credentials, sessions: the auth adapter's own data) and ops (outbox, query budget).
-- Review changes vs the B2 proposal:
--  * set_verified never activates a pending researcher registration (coordinator approval stays mandatory, ASSUMPTION-03)
--  * outbox_claim / outbox_mark only work WITHOUT a user session (worker), outbox_enqueue validates template and size
--  * ops.query_log has no table grant: writes through ops.log_query (actor from the signed session), budget via ops.budget_spent
--  * registration vetting data (institution) is readable by coordinators through portal.registrations_pending()
--  * every new function: no PUBLIC execute (default privileges), definer owners app_core, no SET ROLE reach for app_runtime
CREATE SCHEMA authn;
CREATE SCHEMA ops;
GRANT USAGE ON SCHEMA authn, ops TO app_runtime, app_core, app_readonly_bg;

CREATE TABLE authn.credentials (
  user_id text PRIMARY KEY REFERENCES portal.users(id) ON DELETE CASCADE,
  password_hash text NOT NULL, password_changed_at timestamptz NOT NULL DEFAULT now(),
  failed_count int NOT NULL DEFAULT 0, locked_until timestamptz,
  totp_secret_enc text, totp_confirmed_at timestamptz, totp_pending_enc text, totp_last_step bigint NOT NULL DEFAULT -1);
CREATE TABLE authn.webauthn_credentials (
  credential_id text PRIMARY KEY, user_id text NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Passkey', public_key bytea NOT NULL, counter bigint NOT NULL DEFAULT 0, transports text[],
  created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz);
CREATE TABLE authn.registration_meta (user_id text PRIMARY KEY REFERENCES portal.users(id) ON DELETE CASCADE, institution text NOT NULL CHECK (char_length(institution) BETWEEN 1 AND 200),
  terms_version text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE authn.recovery_codes (id bigserial PRIMARY KEY, user_id text NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE, code_hash bytea NOT NULL, used_at timestamptz);
CREATE INDEX ix_recovery_user ON authn.recovery_codes (user_id);
CREATE TABLE authn.sessions (
  id_hash bytea PRIMARY KEY, user_id text NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), mfa_at timestamptz,
  ip_hash text, csrf_token text NOT NULL, roles jsonb NOT NULL, display_name text NOT NULL, locale text NOT NULL, revoked_at timestamptz);
CREATE INDEX ix_sessions_user ON authn.sessions (user_id);
CREATE TABLE authn.challenges (
  token_hash bytea PRIMARY KEY, user_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('login','webauthn_reg','webauthn_auth','invite')),
  webauthn_challenge text, attempts int NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL);
-- credentials are the auth adapter's data: the runtime login owns the DML (no user context exists before login)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA authn TO app_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA authn TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA authn TO app_core;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA authn TO app_core;
-- retention of expired sessions and challenges (bg job)
GRANT DELETE ON authn.sessions, authn.challenges TO app_readonly_bg;
GRANT SELECT ON authn.sessions, authn.challenges TO app_readonly_bg;

CREATE FUNCTION authn.find_login(p_email text) RETURNS TABLE (user_id text, status text, email_verified boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
  SELECT id::text, status::text, email_verified_at IS NOT NULL FROM portal.users WHERE email = lower(p_email) $$;
CREATE FUNCTION authn.user_roles(p_user_id text) RETURNS TABLE (id text, role text, center_id text, granted_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
  SELECT id::text, role::text, center_id::text, granted_at FROM portal.role_assignments WHERE user_id = p_user_id AND revoked_at IS NULL ORDER BY granted_at $$;
CREATE FUNCTION authn.profile(p_user_id text) RETURNS TABLE (email text, display_name text, locale text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
  SELECT email, display_name, locale, status::text FROM portal.users WHERE id = p_user_id $$;
-- Verified e-mail. Activates only users that already hold an active role (admin-invited). A pending researcher registration
-- stays 'invited' until a coordinator approves (portal.researcher_approve).
CREATE FUNCTION authn.set_verified(p_user_id text, p_activate boolean) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
  UPDATE portal.users u SET email_verified_at = coalesce(email_verified_at, now()),
    status = CASE WHEN p_activate AND u.status = 'invited'
                   AND EXISTS (SELECT 1 FROM portal.role_assignments ra WHERE ra.user_id = u.id AND ra.revoked_at IS NULL)
                   AND NOT EXISTS (SELECT 1 FROM portal.researcher_registrations r WHERE r.user_id = u.id AND r.status = 'pending')
                  THEN 'active'::portal.user_status ELSE u.status END
   WHERE u.id = p_user_id $$;
CREATE FUNCTION authn.touch_login(p_user_id text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$ UPDATE portal.users SET last_login_at = now() WHERE id = p_user_id AND status = 'active' $$;
-- Self registration (anonymous context). Same result whether or not the e-mail exists (returns false when it does).
CREATE FUNCTION authn.register_researcher(p_id text, p_email text, p_display_name text, p_institution text, p_requested_role text, p_locale text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, portal, authn, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('anonymous');
  IF p_requested_role NOT IN ('researcher_il','researcher_intl') THEN RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM portal.users WHERE email = lower(p_email)) THEN RETURN false; END IF;
  INSERT INTO portal.users (id, email, display_name, locale, status) VALUES (p_id, lower(p_email), left(p_display_name, 200), coalesce(p_locale, 'he'), 'invited');
  INSERT INTO portal.researcher_registrations (user_id, requested_role) VALUES (p_id, p_requested_role::portal.role_name);
  INSERT INTO authn.registration_meta (user_id, institution) VALUES (p_id, p_institution);
  PERFORM audit.record('user.register', 'user', p_id);
  RETURN true;
END $$;
CREATE FUNCTION portal.registrations_pending() RETURNS TABLE (user_id text, email text, display_name text, institution text, requested_role text, created_at timestamptz, email_verified boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, authn, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('national_coordinator');
  RETURN QUERY SELECT r.user_id::text, u.email, u.display_name, m.institution, r.requested_role::text, r.created_at, u.email_verified_at IS NOT NULL
    FROM portal.researcher_registrations r JOIN portal.users u ON u.id = r.user_id LEFT JOIN authn.registration_meta m ON m.user_id = r.user_id
   WHERE r.status = 'pending' ORDER BY r.created_at;
END $$;
CREATE FUNCTION portal.approve_registration(p_user_id text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
  SELECT portal.researcher_approve(p_user_id) $$;
CREATE FUNCTION portal.user_update_self(p_display_name text, p_locale text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  IF portal.cur_user_id() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_display_name IS NOT NULL AND char_length(p_display_name) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023'; END IF;
  UPDATE portal.users SET display_name = coalesce(p_display_name, display_name), locale = coalesce(p_locale, locale) WHERE id = portal.cur_user_id();
END $$;
CREATE FUNCTION portal.user_admin_rename(p_user_id text, p_display_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('system_admin');
  IF p_display_name IS NULL OR char_length(p_display_name) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023'; END IF;
  UPDATE portal.users SET display_name = p_display_name WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM audit.record('user.update', 'user', p_user_id);
END $$;
CREATE FUNCTION portal.sample_verify(p_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE r text := portal._require_role('center_clinician','national_coordinator');
BEGIN
  UPDATE portal.samples SET last_verified_at = now() WHERE id = p_id AND deleted_at IS NULL AND (r = 'national_coordinator' OR source_center_id = portal.cur_center_id());
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM audit.record('sample.update', 'sample', p_id, 'allow', '{"fields":["last_verified_at"]}');
END $$;

-- ops: notification outbox. No table grant at all: PII (e-mail) stays behind these functions.
CREATE TABLE ops.notification_outbox (
  id text PRIMARY KEY, template text NOT NULL CHECK (template ~ '^[a-z0-9_.]{1,60}$'), to_user_id text, to_email text, locale text NOT NULL DEFAULT 'he',
  params jsonb NOT NULL DEFAULT '{}' CHECK (pg_column_size(params) < 4096),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')), attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz);
CREATE INDEX ix_outbox_status ON ops.notification_outbox (status, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON ops.notification_outbox TO app_core;
CREATE FUNCTION ops.outbox_enqueue(p_id text, p_template text, p_to_role text, p_to_user text, p_to_email text, p_locale text, p_params jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, portal, ops, pg_temp AS $$
DECLARE r record; n int := 0;
BEGIN
  IF portal.cur_role() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;     -- a session (user or anonymous) is required
  IF p_to_role IS NOT NULL THEN
    FOR r IN SELECT u.id, u.email, u.locale FROM portal.users u JOIN portal.role_assignments ra ON ra.user_id = u.id
             WHERE ra.role = p_to_role::portal.role_name AND ra.revoked_at IS NULL AND u.status = 'active' LOOP
      n := n + 1;
      INSERT INTO ops.notification_outbox (id, template, to_user_id, to_email, locale, params) VALUES (p_id || '_' || n, p_template, r.id, r.email, r.locale, coalesce(p_params,'{}'));
    END LOOP;
  ELSIF p_to_user IS NOT NULL THEN
    INSERT INTO ops.notification_outbox (id, template, to_user_id, to_email, locale, params)
      SELECT p_id, p_template, u.id, coalesce(p_to_email, u.email), coalesce(p_locale, u.locale), coalesce(p_params,'{}') FROM portal.users u WHERE u.id = p_to_user;
  ELSE
    INSERT INTO ops.notification_outbox (id, template, to_email, locale, params) VALUES (p_id, p_template, p_to_email, coalesce(p_locale,'he'), coalesce(p_params,'{}'));
  END IF;
END $$;
-- worker path: only callable when NO user session is active (a request handler holds a session and is refused)
CREATE FUNCTION ops.outbox_claim(p_limit int) RETURNS TABLE (id text, template text, to_email text, locale text, params jsonb, attempts int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, portal, ops, pg_temp AS $$
BEGIN
  IF portal.cur_role() IS NOT NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN QUERY UPDATE ops.notification_outbox o SET attempts = o.attempts + 1 WHERE o.id IN (
    SELECT x.id FROM ops.notification_outbox x WHERE x.status = 'pending' ORDER BY x.created_at LIMIT least(p_limit, 100) FOR UPDATE SKIP LOCKED)
  RETURNING o.id, o.template, o.to_email, o.locale, o.params, o.attempts - 1;
END $$;
CREATE FUNCTION ops.outbox_mark(p_id text, p_ok boolean, p_give_up boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, ops, pg_temp AS $$
BEGIN
  IF portal.cur_role() IS NOT NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE ops.notification_outbox SET status = CASE WHEN p_ok THEN 'sent' WHEN p_give_up THEN 'failed' ELSE 'pending' END,
    sent_at = CASE WHEN p_ok THEN now() END, params = CASE WHEN p_ok OR p_give_up THEN '{}'::jsonb ELSE params END WHERE id = p_id;
END $$;
CREATE FUNCTION ops.outbox_list(p_limit int) RETURNS TABLE (id text, template text, status text, attempts int, created_at timestamptz, sent_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, ops, portal, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('system_admin');
  RETURN QUERY SELECT o.id, o.template, o.status, o.attempts, o.created_at, o.sent_at FROM ops.notification_outbox o ORDER BY o.created_at DESC LIMIT least(p_limit, 500);
END $$;

-- ops: query budget (Q_DAY_COST, Q_30D_COST, INST_30D_COST). The actor is the signed session user, never a parameter.
CREATE TABLE ops.query_log (user_id text NOT NULL, institution text, query_key text NOT NULL, cost int NOT NULL CHECK (cost BETWEEN 0 AND 100), at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ix_qlog_user ON ops.query_log (user_id, at DESC);
CREATE INDEX ix_qlog_inst ON ops.query_log (institution, at DESC);
GRANT SELECT, INSERT, DELETE ON ops.query_log TO app_core;
CREATE FUNCTION ops.log_query(p_query_key text, p_institution text, p_cost int) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, ops, pg_temp AS $$
BEGIN
  IF portal.cur_user_id() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  INSERT INTO ops.query_log (user_id, institution, query_key, cost) VALUES (portal.cur_user_id(), left(p_institution, 200), left(p_query_key, 80), p_cost);
END $$;
CREATE FUNCTION ops.budget_spent(p_institution text) RETURNS TABLE (day_cost int, d30_cost int, inst_30d_cost int) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, portal, ops, pg_temp AS $$
DECLARE me text := portal.cur_user_id();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT coalesce(sum(cost) FILTER (WHERE user_id = me AND at > now() - interval '24 hours'), 0)::int,
                      coalesce(sum(cost) FILTER (WHERE user_id = me), 0)::int,
                      coalesce(sum(cost) FILTER (WHERE institution = p_institution AND p_institution IS NOT NULL), 0)::int
                 FROM ops.query_log WHERE at > now() - interval '30 days';
END $$;
CREATE FUNCTION ops.metrics() RETURNS TABLE (samples_total int, centers_feeding int, registered_researchers int, searches_30d int, entered_share numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, ops, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('national_coordinator','committee_member','system_admin');
  RETURN QUERY SELECT (SELECT count(*)::int FROM portal.samples WHERE deleted_at IS NULL), (SELECT count(*)::int FROM portal.centers WHERE feeds_regularly),
    (SELECT count(DISTINCT user_id)::int FROM portal.role_assignments WHERE role IN ('researcher_il','researcher_intl') AND revoked_at IS NULL),
    (SELECT count(*)::int FROM ops.query_log WHERE at > now() - interval '30 days'),
    (SELECT coalesce(avg((source_system IN ('portal_entry','csv_import'))::int), 0) FROM portal.samples WHERE deleted_at IS NULL);
END $$;

-- /readyz: DB reachable AND migrations at the expected level. The API compares this to its compiled-in expectation.
GRANT USAGE ON SCHEMA public TO app_core;
GRANT SELECT ON public.schema_migrations TO app_core;
CREATE FUNCTION portal.migration_level() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT max(version) FROM public.schema_migrations $$;

GRANT EXECUTE ON FUNCTION authn.find_login(text), authn.user_roles(text), authn.profile(text), authn.set_verified(text,boolean), authn.touch_login(text),
  authn.register_researcher(text,text,text,text,text,text), portal.registrations_pending(), portal.approve_registration(text),
  portal.user_update_self(text,text), portal.user_admin_rename(text,text), portal.sample_verify(text), portal.migration_level(),
  ops.outbox_enqueue(text,text,text,text,text,text,jsonb), ops.outbox_claim(int), ops.outbox_mark(text,boolean,boolean), ops.outbox_list(int),
  ops.log_query(text,text,int), ops.budget_spent(text), ops.metrics() TO app_runtime;
GRANT EXECUTE ON FUNCTION portal.migration_level() TO app_readonly_bg;
SELECT portal._assign_owners();
