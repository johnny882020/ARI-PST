-- 0005 governance: users, roles, two-person changes (role grants, k, committee config), config, break-glass. kind: expand
CREATE FUNCTION portal._require_role(VARIADIC p_roles text[]) RETURNS text LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE r text := portal.cur_role();
BEGIN
  IF r IS NULL OR NOT (r = ANY (p_roles)) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN r;
END $$;
CREATE FUNCTION portal._require_stepup(p_age_s int) RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_age_s IS NULL OR p_age_s < 0 OR p_age_s > 300 THEN RAISE EXCEPTION 'stepup_required' USING ERRCODE = '42501'; END IF;
END $$;

CREATE FUNCTION portal.user_invite(p_email text, p_display_name text, p_locale text DEFAULT 'he') RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE v_id text := portal.new_id('usr');
BEGIN
  PERFORM portal._require_role('system_admin','national_coordinator');
  INSERT INTO portal.users (id, email, display_name, locale, status) VALUES (v_id, lower(p_email), p_display_name, p_locale, 'invited');
  PERFORM audit.record('user.invite', 'user', v_id);
  RETURN v_id;
END $$;

-- Self registration (anonymous context). The raw token is returned once for the e-mail; only its hash is stored.
CREATE FUNCTION portal.user_register(p_email text, p_display_name text, p_locale text, p_requested_role text,
  OUT user_id text, OUT verification_token text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, ext, portal, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('anonymous');
  IF p_requested_role NOT IN ('researcher_il','researcher_intl') THEN RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023'; END IF;
  user_id := portal.new_id('usr');
  verification_token := encode(ext.gen_random_bytes(24), 'hex');
  INSERT INTO portal.users (id, email, display_name, locale, status) VALUES (user_id, lower(p_email), p_display_name, coalesce(p_locale,'he'), 'invited');
  INSERT INTO portal.researcher_registrations (user_id, requested_role) VALUES (user_id, p_requested_role::portal.role_name);
  INSERT INTO portal.email_verifications (user_id, token_hash, expires_at) VALUES (user_id, sha256(convert_to(verification_token,'UTF8')), now() + interval '24 hours');
  PERFORM audit.record('user.register', 'user', user_id);
END $$;
CREATE FUNCTION portal.user_verify_email(p_user_id text, p_token text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE v portal.email_verifications%ROWTYPE;
BEGIN
  PERFORM portal._require_role('anonymous');
  SELECT * INTO v FROM portal.email_verifications WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v.used_at IS NOT NULL OR v.expires_at < now() OR v.attempts >= 5 THEN RETURN false; END IF;
  IF v.token_hash <> sha256(convert_to(coalesce(p_token,''),'UTF8')) THEN
    UPDATE portal.email_verifications SET attempts = attempts + 1 WHERE user_id = p_user_id; RETURN false; END IF;
  UPDATE portal.email_verifications SET used_at = now() WHERE user_id = p_user_id;
  UPDATE portal.users SET email_verified_at = now() WHERE id = p_user_id;
  RETURN true;
END $$;

-- Researcher approval (ASSUMPTION-03): coordinator may grant ONLY researcher roles, only to invited users with verified e-mail.
CREATE FUNCTION portal.researcher_approve(p_user_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE reg portal.researcher_registrations%ROWTYPE; me text := portal.cur_user_id();
BEGIN
  PERFORM portal._require_role('national_coordinator');
  SELECT * INTO reg FROM portal.researcher_registrations WHERE user_id = p_user_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM portal.users WHERE id = p_user_id AND status = 'invited' AND email_verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'email_not_verified' USING ERRCODE = '22023'; END IF;
  INSERT INTO portal.role_assignments (id, user_id, role, granted_by) VALUES (portal.new_id('rol'), p_user_id, reg.requested_role, me);
  UPDATE portal.users SET status = 'active' WHERE id = p_user_id;
  UPDATE portal.researcher_registrations SET status = 'approved' WHERE user_id = p_user_id;
  PERFORM audit.record('role.grant', 'user', p_user_id, 'allow', jsonb_build_object('role', reg.requested_role));
END $$;
CREATE FUNCTION portal.researcher_reject(p_user_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('national_coordinator');
  UPDATE portal.researcher_registrations SET status = 'rejected' WHERE user_id = p_user_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  UPDATE portal.users SET status = 'closed', closed_at = now() WHERE id = p_user_id;
  PERFORM audit.record('user.disable', 'user', p_user_id, 'allow', '{"reason":"registration_rejected"}');
END $$;

-- Admin status changes. No self changes. Activation needs a verified e-mail.
CREATE FUNCTION portal.user_set_status(p_user_id text, p_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE u portal.users%ROWTYPE;
BEGIN
  PERFORM portal._require_role('system_admin');
  IF p_user_id = portal.cur_user_id() THEN RAISE EXCEPTION 'self_change_denied' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('active','suspended','closed') THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023'; END IF;
  SELECT * INTO u FROM portal.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF u.status = 'closed' THEN RAISE EXCEPTION 'user_closed' USING ERRCODE = '22023'; END IF;
  IF p_status = 'active' AND u.email_verified_at IS NULL THEN RAISE EXCEPTION 'email_not_verified' USING ERRCODE = '22023'; END IF;
  UPDATE portal.users SET status = p_status::portal.user_status, closed_at = CASE WHEN p_status = 'closed' THEN now() END WHERE id = p_user_id;
  PERFORM audit.record(CASE WHEN p_status = 'active' THEN 'user.enable' ELSE 'user.disable' END, 'user', p_user_id);
END $$;
-- e-mail verification attested by the auth adapter's own flow is the normal path. Admin cannot bypass it.

CREATE FUNCTION portal.role_revoke(p_assignment_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('system_admin');
  UPDATE portal.role_assignments SET revoked_at = now() WHERE id = p_assignment_id AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM audit.record('role.revoke', 'role_assignment', p_assignment_id);
END $$;

-- Two-person changes (RT-06). The proposer can never approve. Approver role depends on the change.
CREATE FUNCTION portal.change_propose(p_kind text, p_payload jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE me_role text; v_id text := portal.new_id('chg'); tr text;
BEGIN
  IF p_kind = 'role_grant' THEN
    tr := p_payload ->> 'role';
    IF tr NOT IN ('center_clinician','national_coordinator','committee_member','system_admin') THEN RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023'; END IF;
    IF tr = 'center_clinician' THEN me_role := portal._require_role('system_admin','national_coordinator');
    ELSE me_role := portal._require_role('system_admin'); END IF;
    IF NOT EXISTS (SELECT 1 FROM portal.users WHERE id = p_payload ->> 'user_id' AND status IN ('active','invited')) THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
    IF (tr = 'center_clinician') <> (p_payload ? 'center_id') THEN RAISE EXCEPTION 'invalid_center' USING ERRCODE = '22023'; END IF;
  ELSIF p_kind = 'k_policy' THEN
    me_role := portal._require_role('system_admin');
    IF (p_payload ->> 'k')::int < 5 THEN RAISE EXCEPTION 'k_floor' USING ERRCODE = '23514'; END IF;
  ELSIF p_kind = 'committee_config' THEN
    me_role := portal._require_role('system_admin');
  ELSE RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023'; END IF;
  INSERT INTO portal.change_requests (id, kind, payload, proposed_by, proposed_role) VALUES (v_id, p_kind, p_payload, portal.cur_user_id(), me_role);
  PERFORM audit.record('config.change', 'change_request', v_id, 'allow', jsonb_build_object('kind', p_kind, 'step', 'propose'));
  RETURN v_id;
END $$;

CREATE FUNCTION portal.change_approve(p_change_id text, p_stepup_age_s int) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE c portal.change_requests%ROWTYPE; me text := portal.cur_user_id(); r text := portal.cur_role(); need text[]; v_role text; v_k int;
BEGIN
  PERFORM portal._require_stepup(p_stepup_age_s);
  SELECT * INTO c FROM portal.change_requests WHERE id = p_change_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF c.proposed_by = me THEN RAISE EXCEPTION 'second_approver_required' USING ERRCODE = '42501'; END IF;
  IF c.kind = 'role_grant' THEN
    v_role := c.payload ->> 'role';
    need := CASE v_role WHEN 'center_clinician' THEN ARRAY['system_admin','national_coordinator']
                        WHEN 'national_coordinator' THEN ARRAY['committee_member']
                        WHEN 'committee_member' THEN ARRAY['national_coordinator']
                        ELSE ARRAY['system_admin'] END;
  ELSE need := ARRAY['committee_member']; END IF;
  IF r IS NULL OR NOT (r = ANY (need)) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF c.kind = 'role_grant' THEN
    INSERT INTO portal.role_assignments (id, user_id, role, center_id, granted_by, approved_by)
      VALUES (portal.new_id('rol'), c.payload ->> 'user_id', v_role::portal.role_name, c.payload ->> 'center_id', c.proposed_by, me);
    PERFORM audit.record('role.grant', 'user', c.payload ->> 'user_id', 'allow', jsonb_build_object('role', v_role));
  ELSIF c.kind = 'k_policy' THEN
    v_k := (c.payload ->> 'k')::int;
    INSERT INTO portal.k_policies (field_set, k, updated_by) VALUES (c.payload ->> 'field_set', v_k, me)
      ON CONFLICT (field_set) DO UPDATE SET k = EXCLUDED.k, updated_by = me, updated_at = now();
    PERFORM audit.record('k.change', 'k_policy', c.payload ->> 'field_set', 'allow', jsonb_build_object('new_k', v_k));
  ELSE
    UPDATE portal.committee_config SET votes_needed = (c.payload ->> 'votes_needed')::int, members_total = (c.payload ->> 'members_total')::int, updated_at = now() WHERE id = 1;
    PERFORM audit.record('config.change', 'committee_config', '1', 'allow', c.payload);
  END IF;
  UPDATE portal.change_requests SET status = 'approved', decided_by = me, decided_at = now() WHERE id = p_change_id;
END $$;
CREATE FUNCTION portal.change_reject(p_change_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
BEGIN
  PERFORM portal._require_role('system_admin','committee_member','national_coordinator');
  UPDATE portal.change_requests SET status = 'rejected', decided_by = portal.cur_user_id(), decided_at = now()
   WHERE id = p_change_id AND status = 'pending' AND proposed_by <> portal.cur_user_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
END $$;

CREATE FUNCTION portal.config_set(p_key text, p_scope text, p_value jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE r text := portal._require_role('national_coordinator','system_admin');
BEGIN
  IF p_key LIKE 'staleness.%' THEN NULL;
  ELSIF p_key LIKE 'request.%' OR p_key LIKE 'retention.%' THEN PERFORM portal._require_role('system_admin');
  ELSE RAISE EXCEPTION 'unknown_key' USING ERRCODE = '22023'; END IF;
  IF p_key LIKE 'retention.%' AND jsonb_typeof(p_value) <> 'number' THEN RAISE EXCEPTION 'invalid_value' USING ERRCODE = '22023'; END IF;
  INSERT INTO portal.workflow_config (key, scope, value, updated_by) VALUES (p_key, coalesce(p_scope,'global'), p_value, portal.cur_user_id())
    ON CONFLICT (key, scope) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM audit.record('config.change', 'config', p_key, 'allow', jsonb_build_object('scope', coalesce(p_scope,'global')));
END $$;

-- First admin, run once by ops as app_migrator. Not callable by the runtime.
CREATE FUNCTION portal.bootstrap_first_admin(p_email text, p_display_name text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE v_id text := portal.new_id('usr');
BEGIN
  IF EXISTS (SELECT 1 FROM portal.role_assignments WHERE role = 'system_admin' AND revoked_at IS NULL) THEN RAISE EXCEPTION 'admin_exists' USING ERRCODE = '42501'; END IF;
  INSERT INTO portal.users (id, email, display_name, status, email_verified_at) VALUES (v_id, lower(p_email), p_display_name, 'active', now());
  INSERT INTO portal.role_assignments (id, user_id, role) VALUES (portal.new_id('rol'), v_id, 'system_admin');
  PERFORM audit.record_internal('system:bootstrap', 'system', NULL, 'role.grant', 'user', v_id, 'allow', NULL, '{"role":"system_admin"}');
  RETURN v_id;
END $$;

-- Donor helpers (donor_ref is never readable by a column grant).
CREATE FUNCTION portal.sample_donor_ref(p_sample_id text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE r text := portal._require_role('national_coordinator','center_clinician'); v text;
BEGIN
  SELECT donor_ref INTO v FROM portal.samples WHERE id = p_sample_id AND deleted_at IS NULL
     AND (r = 'national_coordinator' OR source_center_id = portal.cur_center_id());
  IF v IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN v;
END $$;
CREATE FUNCTION portal.donor_correct(p_sample_id text, p_diagnosis_code text, p_sex text, p_age_band text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE v_donor text; n int;
BEGIN
  PERFORM portal._require_role('national_coordinator');
  SELECT donor_ref INTO v_donor FROM portal.samples WHERE id = p_sample_id;
  IF v_donor IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  UPDATE portal.samples SET diagnosis_code = coalesce(p_diagnosis_code, diagnosis_code), sex = coalesce(p_sex::portal.sex, sex),
    age_band_at_diagnosis = coalesce(p_age_band::portal.age_band, age_band_at_diagnosis) WHERE donor_ref = v_donor;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM audit.record('sample.update', 'donor_group', NULL, 'allow', jsonb_build_object('rows', n));
  RETURN n;
END $$;

-- Break glass: request by system_admin, TWO distinct approvers (committee_member or national_coordinator), 1 hour window.
CREATE FUNCTION portal.breakglass_request(p_purpose_code text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE v_id text := portal.new_id('bgl');
BEGIN
  PERFORM portal._require_role('system_admin');
  INSERT INTO portal.breakglass_grants (id, requested_by, purpose_code) VALUES (v_id, portal.cur_user_id(), p_purpose_code);
  PERFORM audit.record('breakglass.request', 'breakglass', v_id);
  RETURN v_id;
END $$;
CREATE FUNCTION portal.breakglass_approve(p_id text, p_stepup_age_s int) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE g portal.breakglass_grants%ROWTYPE; me text := portal.cur_user_id();
BEGIN
  PERFORM portal._require_role('committee_member','national_coordinator');
  PERFORM portal._require_stepup(p_stepup_age_s);
  SELECT * INTO g FROM portal.breakglass_grants WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR g.approved_at IS NOT NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF g.requested_by = me OR g.approver_1 = me THEN RAISE EXCEPTION 'second_approver_required' USING ERRCODE = '42501'; END IF;
  IF g.approver_1 IS NULL THEN UPDATE portal.breakglass_grants SET approver_1 = me WHERE id = p_id;
  ELSE UPDATE portal.breakglass_grants SET approver_2 = me, approved_at = now(), expires_at = now() + interval '1 hour' WHERE id = p_id; END IF;
  PERFORM audit.record('breakglass.approve', 'breakglass', p_id);
  RETURN g.approver_1 IS NOT NULL;
END $$;
CREATE FUNCTION portal.breakglass_active() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM portal.breakglass_grants WHERE approved_at IS NOT NULL AND expires_at > now()) $$;

-- ---------- grants ----------
GRANT EXECUTE ON FUNCTION portal._require_role(text[]), portal._require_stepup(int) TO PUBLIC;
GRANT EXECUTE ON FUNCTION portal.user_invite(text,text,text), portal.user_set_status(text,text), portal.role_revoke(text),
  portal.change_propose(text,jsonb), portal.change_approve(text,int), portal.change_reject(text), portal.config_set(text,text,jsonb),
  portal.researcher_approve(text), portal.researcher_reject(text), portal.sample_donor_ref(text), portal.donor_correct(text,text,text,text),
  portal.breakglass_request(text), portal.breakglass_approve(text,int), portal.user_register(text,text,text,text),
  portal.user_verify_email(text,text) TO app_runtime;
GRANT EXECUTE ON FUNCTION portal.bootstrap_first_admin(text,text) TO app_migrator;
GRANT EXECUTE ON FUNCTION portal.breakglass_active() TO app_break_glass, app_core;
SELECT portal._assign_owners();
