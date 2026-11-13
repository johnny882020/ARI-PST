-- 0003 signed session context (C-06: no SET ROLE; center from role assignments) + audit chain. kind: expand
-- ---------- session context ----------
CREATE FUNCTION portal._ctx_sig(p_payload text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, ext, portal, pg_temp AS $$
  SELECT encode(ext.hmac(convert_to(p_payload,'UTF8'), (SELECT key FROM portal.ctx_secret WHERE id = 1), 'sha256'), 'hex') $$;

-- returns (user_id, role, center_id) only when the signature verifies; otherwise all NULL (fail closed)
CREATE FUNCTION portal._ctx(OUT user_id text, OUT role text, OUT center_id text) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE raw text := nullif(current_setting('app.ctx', true), ''); parts text[];
BEGIN
  IF raw IS NULL THEN RETURN; END IF;
  parts := string_to_array(raw, '|');
  IF array_length(parts, 1) <> 4 THEN RETURN; END IF;
  IF portal._ctx_sig(parts[1] || '|' || parts[2] || '|' || parts[3]) <> parts[4] THEN RETURN; END IF;
  user_id := nullif(parts[1], ''); role := parts[2]; center_id := nullif(parts[3], '');
END $$;
CREATE FUNCTION portal.cur_user_id() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$ SELECT user_id FROM portal._ctx() $$;
CREATE FUNCTION portal.cur_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$ SELECT role FROM portal._ctx() $$;
CREATE FUNCTION portal.cur_center_id() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, portal, pg_temp AS $$ SELECT center_id FROM portal._ctx() $$;

-- The API calls this once per transaction, after authenticating the user (AuthPort). It verifies the role
-- against role_assignments and derives the center. Transaction-local. Cannot be switched inside one transaction.
CREATE FUNCTION portal.begin_session(p_user_id text, p_role text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, portal, pg_temp AS $$
DECLARE v_center text := ''; v_user text := coalesce(p_user_id, ''); payload text;
BEGIN
  IF portal.cur_role() IS NOT NULL THEN RAISE EXCEPTION 'session_already_started' USING ERRCODE = '42501'; END IF;
  IF p_role IS NULL OR p_role NOT IN (SELECT e::text FROM unnest(enum_range(NULL::portal.role_name)) e) THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023'; END IF;
  IF p_role = 'anonymous' THEN
    v_user := '';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM portal.users WHERE id = p_user_id AND status = 'active') THEN
      RAISE EXCEPTION 'session_denied' USING ERRCODE = '28000'; END IF;
    SELECT coalesce(ra.center_id, '') INTO v_center FROM portal.role_assignments ra
     WHERE ra.user_id = p_user_id AND ra.role = p_role::portal.role_name AND ra.revoked_at IS NULL LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'session_denied' USING ERRCODE = '28000'; END IF;
  END IF;
  payload := v_user || '|' || p_role || '|' || v_center;
  PERFORM set_config('app.ctx', payload || '|' || portal._ctx_sig(payload), true);
END $$;

-- ---------- audit ----------
CREATE TABLE audit.chain_key (version int PRIMARY KEY, key bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO audit.chain_key VALUES (1, ext.gen_random_bytes(32));
CREATE TABLE audit.chain_head (
  lane smallint PRIMARY KEY CHECK (lane BETWEEN 0 AND 7),
  last_seq bigint NOT NULL DEFAULT 0,
  last_hash bytea NOT NULL DEFAULT sha256(convert_to('ARI-PST-audit-genesis-v1','UTF8')));
INSERT INTO audit.chain_head (lane) SELECT g FROM generate_series(0,7) g;
CREATE TABLE audit.chain_truncation (
  lane smallint PRIMARY KEY, last_purged_seq bigint NOT NULL, last_purged_hash bytea NOT NULL,
  purged_count bigint NOT NULL, purged_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit.audit_events (
  lane smallint NOT NULL, lane_seq bigint NOT NULL, PRIMARY KEY (lane, lane_seq),
  id portal.ulid_text NOT NULL UNIQUE CHECK (id LIKE 'aud\_%'),
  occurred_at timestamptz NOT NULL,
  actor_user_id text, actor_role text, actor_center_id text,
  action text NOT NULL CHECK (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  object_type text, object_id text,
  outcome text NOT NULL CHECK (outcome IN ('allow','deny','error')),
  trace_id text, details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object' AND pg_column_size(details) < 4096),
  key_version int NOT NULL, prev_hash bytea NOT NULL, entry_hash bytea NOT NULL);
CREATE INDEX ix_aud_time ON audit.audit_events (occurred_at DESC);
CREATE INDEX ix_aud_actor ON audit.audit_events (actor_user_id, occurred_at DESC);
CREATE INDEX ix_aud_object ON audit.audit_events (object_type, object_id, occurred_at DESC);
CREATE INDEX ix_aud_action ON audit.audit_events (action, occurred_at DESC);

CREATE FUNCTION audit.block_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user = 'app_audit_writer' AND current_setting('audit.purging', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION audit.block_mutation();
CREATE TRIGGER trg_audit_no_truncate BEFORE TRUNCATE ON audit.audit_events FOR EACH STATEMENT EXECUTE FUNCTION audit.block_mutation();

CREATE FUNCTION audit._payload(p_lane smallint, p_seq bigint, p_id text, p_ts timestamptz, p_actor text, p_role text, p_center text,
  p_action text, p_ot text, p_oid text, p_outcome text, p_trace text, p_details jsonb) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
  SELECT convert_to(concat_ws('|', p_lane, p_seq, p_id, to_char(p_ts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    coalesce(p_actor,''), coalesce(p_role,''), coalesce(p_center,''), p_action, coalesce(p_ot,''), coalesce(p_oid,''),
    p_outcome, coalesce(p_trace,''), coalesce(p_details::text,'{}')), 'UTF8') $$;

-- Internal writer. Sharded lanes: a writer takes any unlocked lane (SKIP LOCKED), so there is no global lock.
CREATE FUNCTION audit.record_internal(p_actor text, p_role text, p_center text, p_action text, p_object_type text,
  p_object_id text, p_outcome text, p_trace text, p_details jsonb) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, ext, audit, portal, pg_temp AS $$
DECLARE h audit.chain_head%ROWTYPE; k audit.chain_key%ROWTYPE; v_id text := portal.new_id('aud'); v_ts timestamptz := clock_timestamp(); v_hash bytea;
BEGIN
  SELECT * INTO h FROM audit.chain_head ORDER BY random() LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN SELECT * INTO h FROM audit.chain_head ORDER BY random() LIMIT 1 FOR UPDATE; END IF;
  SELECT * INTO k FROM audit.chain_key ORDER BY version DESC LIMIT 1;
  h.last_seq := h.last_seq + 1;
  v_hash := ext.hmac(h.last_hash || audit._payload(h.lane, h.last_seq, v_id, v_ts, p_actor, p_role, p_center, p_action,
                     p_object_type, p_object_id, p_outcome, p_trace, coalesce(p_details,'{}'::jsonb)), k.key, 'sha256');
  INSERT INTO audit.audit_events (lane, lane_seq, id, occurred_at, actor_user_id, actor_role, actor_center_id, action, object_type,
     object_id, outcome, trace_id, details, key_version, prev_hash, entry_hash)
  VALUES (h.lane, h.last_seq, v_id, v_ts, p_actor, p_role, p_center, p_action, p_object_type, p_object_id, p_outcome, p_trace,
     coalesce(p_details,'{}'::jsonb), k.version, h.last_hash, v_hash);
  UPDATE audit.chain_head SET last_seq = h.last_seq, last_hash = v_hash WHERE lane = h.lane;
  RETURN h.last_seq;
END $$;

-- Public writer: the actor and role come from the signed session context, never from the caller (RT-09).
CREATE FUNCTION audit.record(p_action text, p_object_type text DEFAULT NULL, p_object_id text DEFAULT NULL,
  p_outcome text DEFAULT 'allow', p_details jsonb DEFAULT '{}', p_trace text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, audit, portal, pg_temp AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM portal._ctx();
  PERFORM audit.record_internal(CASE WHEN c.role IS NULL AND session_user = 'app_readonly_bg' THEN 'system:bg' ELSE c.user_id END,
    coalesce(c.role, CASE WHEN session_user = 'app_readonly_bg' THEN 'system' ELSE 'anonymous' END), c.center_id, p_action, p_object_type, p_object_id, p_outcome, p_trace, p_details);
END $$;
-- Denials are written by the API in a NEW transaction after the failed one rolled back (so they survive rollback).
CREATE FUNCTION audit.record_denial(p_action text, p_object_type text DEFAULT NULL, p_object_id text DEFAULT NULL,
  p_reason_code text DEFAULT 'denied', p_trace text DEFAULT NULL) RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, audit, portal, pg_temp AS $$
  SELECT audit.record(p_action, p_object_type, p_object_id, 'deny', jsonb_build_object('reason', left(p_reason_code, 40)), p_trace) $$;
-- Trusted path for the auth adapter (login events have no session yet). Only the app_audit_writer login can run it.
CREATE FUNCTION audit.record_trusted(p_actor text, p_role text, p_center text, p_action text, p_object_type text DEFAULT NULL,
  p_object_id text DEFAULT NULL, p_outcome text DEFAULT 'allow', p_details jsonb DEFAULT '{}', p_trace text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, audit, pg_temp AS $$
  SELECT audit.record_internal(p_actor, p_role, p_center, p_action, p_object_type, p_object_id, p_outcome, p_trace, p_details) $$;

-- Verification. Returns one row per broken lane (empty = intact). Logs audit.verify.ok / audit.verify.fail.
CREATE FUNCTION audit.verify_chain() RETURNS TABLE (lane smallint, broken_seq bigint, reason text) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, ext, audit, portal, pg_temp AS $$
DECLARE l smallint; r audit.audit_events%ROWTYPE; prev bytea; expect_seq bigint; k bytea; calc bytea; t audit.chain_truncation%ROWTYPE;
        h audit.chain_head%ROWTYPE; bad boolean := false; done boolean;
BEGIN
  IF NOT (session_user = 'app_readonly_bg' OR portal.cur_role() = 'system_admin' OR session_user = 'app_audit_writer') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  FOR l IN SELECT c.lane FROM audit.chain_head c ORDER BY c.lane LOOP
    prev := sha256(convert_to('ARI-PST-audit-genesis-v1','UTF8')); expect_seq := 1; done := false;
    SELECT * INTO t FROM audit.chain_truncation ct WHERE ct.lane = l;
    IF FOUND THEN prev := t.last_purged_hash; expect_seq := t.last_purged_seq + 1; END IF;
    FOR r IN SELECT * FROM audit.audit_events e WHERE e.lane = l ORDER BY e.lane_seq LOOP
      SELECT ck.key INTO k FROM audit.chain_key ck WHERE ck.version = r.key_version;
      calc := ext.hmac(prev || audit._payload(r.lane, r.lane_seq, r.id, r.occurred_at, r.actor_user_id, r.actor_role, r.actor_center_id,
               r.action, r.object_type, r.object_id, r.outcome, r.trace_id, r.details), k, 'sha256');
      IF r.lane_seq <> expect_seq THEN lane := l; broken_seq := r.lane_seq; reason := 'gap'; RETURN NEXT; bad := true; done := true; EXIT; END IF;
      IF r.prev_hash <> prev OR r.entry_hash <> calc THEN lane := l; broken_seq := r.lane_seq; reason := 'hash_mismatch'; RETURN NEXT; bad := true; done := true; EXIT; END IF;
      prev := r.entry_hash; expect_seq := expect_seq + 1;
    END LOOP;
    IF NOT done THEN
      SELECT * INTO h FROM audit.chain_head ch WHERE ch.lane = l;
      IF h.last_hash <> prev OR h.last_seq <> expect_seq - 1 THEN lane := l; broken_seq := h.last_seq; reason := 'head_mismatch'; RETURN NEXT; bad := true; END IF;
    END IF;
  END LOOP;
  PERFORM audit.record_internal(coalesce(portal.cur_user_id(), 'system:audit-verify'), coalesce(portal.cur_role(), 'system'), NULL,
     CASE WHEN bad THEN 'audit.verify.fail' ELSE 'audit.verify.ok' END, 'audit_chain', NULL, CASE WHEN bad THEN 'error' ELSE 'allow' END, NULL, '{}');
END $$;

-- Anchor material for the daily external anchor: per-lane head, keyed with the chain key.
CREATE FUNCTION audit.anchor() RETURNS TABLE (lane smallint, last_seq bigint, last_hash text, anchor_hmac text) LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, ext, audit, portal, pg_temp AS $$
  SELECT h.lane, h.last_seq, encode(h.last_hash,'hex'),
         encode(ext.hmac(h.last_hash || convert_to(h.lane::text || ':' || h.last_seq::text || ':' || current_date::text,'UTF8'),
                (SELECT key FROM audit.chain_key ORDER BY version DESC LIMIT 1), 'sha256'),'hex')
  FROM audit.chain_head h WHERE session_user IN ('app_readonly_bg','app_audit_writer') OR portal.cur_role() = 'system_admin' ORDER BY h.lane $$;

-- Reading the log is itself audited (audit.read). Scope by role (A2 file 07 section 4).
CREATE FUNCTION audit.read_events(p_since timestamptz DEFAULT now() - interval '7 days', p_until timestamptz DEFAULT now(),
  p_action_prefix text DEFAULT NULL, p_limit int DEFAULT 200)
RETURNS TABLE (id text, occurred_at timestamptz, actor_user_id text, actor_role text, action text, object_type text, object_id text,
               outcome text, details jsonb, lane smallint, lane_seq bigint, entry_hash text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, audit, portal, pg_temp AS $$
DECLARE v_role text := portal.cur_role(); v_user text := portal.cur_user_id();
BEGIN
  IF v_role IS NULL OR v_role = 'anonymous' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  PERFORM audit.record('audit.read', 'audit_log', NULL, 'allow', jsonb_build_object('prefix', left(coalesce(p_action_prefix,''),30)));
  RETURN QUERY SELECT e.id::text, e.occurred_at, e.actor_user_id, e.actor_role, e.action, e.object_type, e.object_id, e.outcome, e.details,
         e.lane, e.lane_seq, encode(e.entry_hash, 'hex')
    FROM audit.audit_events e
   WHERE e.occurred_at >= p_since AND e.occurred_at <= p_until
     AND (p_action_prefix IS NULL OR e.action LIKE left(p_action_prefix, 40) || '%')
     AND (v_role = 'system_admin'
          OR (v_role = 'national_coordinator' AND e.action ~ '^(sample|import|export|request|search|linkout)\.')
          OR (v_role = 'committee_member' AND e.action ~ '^request\.')
          OR (e.actor_user_id = v_user AND e.action ~ '^(auth|request)\.'))
   ORDER BY e.occurred_at DESC LIMIT least(greatest(p_limit,1), 1000);
END $$;

-- Retention: whole prefixes of each lane, with a truncation record so verification continues (A2 07 section 3).
CREATE FUNCTION audit.purge_before(p_before timestamptz) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, audit, pg_temp AS $$
DECLARE l smallint; cut bigint; hsh bytea; n bigint; total bigint := 0;
BEGIN
  PERFORM set_config('audit.purging', 'on', true);
  FOR l IN SELECT lane FROM audit.chain_head LOOP
    SELECT min(lane_seq) - 1 INTO cut FROM audit.audit_events WHERE lane = l AND occurred_at >= p_before;
    IF cut IS NULL THEN SELECT max(lane_seq) INTO cut FROM audit.audit_events WHERE lane = l; END IF;
    CONTINUE WHEN cut IS NULL OR NOT EXISTS (SELECT 1 FROM audit.audit_events WHERE lane = l AND lane_seq <= cut);
    SELECT entry_hash INTO hsh FROM audit.audit_events WHERE lane = l AND lane_seq = cut;
    DELETE FROM audit.audit_events WHERE lane = l AND lane_seq <= cut;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
    INSERT INTO audit.chain_truncation (lane, last_purged_seq, last_purged_hash, purged_count) VALUES (l, cut, hsh, n)
      ON CONFLICT (lane) DO UPDATE SET last_purged_seq = EXCLUDED.last_purged_seq, last_purged_hash = EXCLUDED.last_purged_hash,
        purged_count = audit.chain_truncation.purged_count + EXCLUDED.purged_count, purged_at = now();
  END LOOP;
  PERFORM set_config('audit.purging', 'off', true);
  RETURN total;
END $$;

-- ---------- grants (before ownership hand-over) ----------
REVOKE ALL ON ALL TABLES IN SCHEMA audit FROM PUBLIC;
REVOKE ALL ON audit.audit_events FROM app_migrator;                      -- the owner holds no privilege on the log either
GRANT SELECT, INSERT ON audit.audit_events TO app_audit_writer;       -- the ONLY role with INSERT
GRANT DELETE ON audit.audit_events TO app_audit_writer;                -- retention purge only (trigger-gated)
GRANT SELECT, UPDATE ON audit.chain_head TO app_audit_writer;
GRANT SELECT ON audit.chain_key TO app_audit_writer;
GRANT SELECT, INSERT, UPDATE ON audit.chain_truncation TO app_audit_writer;
ALTER TABLE audit.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_writer_all ON audit.audit_events FOR ALL TO app_audit_writer USING (true) WITH CHECK (true);
GRANT SELECT ON portal.ctx_secret TO app_core;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA audit, portal FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal.cur_user_id(), portal.cur_role(), portal.cur_center_id(), portal._ctx(),
  portal.begin_session(text,text), portal.new_id(text), portal.touch_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION portal._ctx_sig(text) TO app_core;
GRANT EXECUTE ON FUNCTION portal.cur_user_id(), portal.cur_role(), portal.cur_center_id(), portal._ctx(), portal._ctx_sig(text) TO app_audit_writer, app_agg;
GRANT EXECUTE ON FUNCTION audit._payload(smallint,bigint,text,timestamptz,text,text,text,text,text,text,text,text,jsonb) TO app_audit_writer;
GRANT EXECUTE ON FUNCTION audit.record(text,text,text,text,jsonb,text), audit.record_denial(text,text,text,text,text),
  audit.read_events(timestamptz,timestamptz,text,int), audit.verify_chain(), audit.anchor() TO app_runtime, app_core;
GRANT EXECUTE ON FUNCTION audit.record_internal(text,text,text,text,text,text,text,text,jsonb) TO app_core, app_agg;
GRANT EXECUTE ON FUNCTION audit.verify_chain(), audit.anchor() TO app_readonly_bg;
GRANT EXECUTE ON FUNCTION audit.purge_before(timestamptz) TO app_core;
GRANT EXECUTE ON FUNCTION audit.block_mutation() TO PUBLIC;
GRANT EXECUTE ON FUNCTION portal.check_sample_ethics_center(), portal.check_donor_consistency(), portal.limit_request_items(), portal.fill_ris_snapshot(), portal.check_k_policy(), portal.enforce_separation_of_duties(), portal.sync_attached_data() TO PUBLIC;
SELECT portal._assign_owners();
