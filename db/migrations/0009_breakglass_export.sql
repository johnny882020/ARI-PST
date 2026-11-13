-- 0009 break-glass read access for full export (RT-27; canonical section 5). kind: expand
-- app_break_glass is NOLOGIN until ops enable it. It reads rows ONLY while a grant with two approvers is active (1 hour).
CREATE FUNCTION portal.breakglass_begin() RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, portal, audit, pg_temp AS $$
DECLARE e timestamptz;
BEGIN
  IF session_user <> 'app_break_glass' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT max(expires_at) INTO e FROM portal.breakglass_grants WHERE approved_at IS NOT NULL AND expires_at > now();
  IF e IS NULL THEN RAISE EXCEPTION 'no_active_grant' USING ERRCODE = '42501'; END IF;
  PERFORM audit.record_internal('system:breakglass', 'break_glass', NULL, 'breakglass.use', 'breakglass', NULL, 'allow', NULL, '{}');
  RETURN e;
END $$;
GRANT EXECUTE ON FUNCTION portal.breakglass_begin() TO app_break_glass;
GRANT USAGE ON SCHEMA portal, audit TO app_break_glass;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT n.nspname s, c.relname r FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relkind = 'r' AND n.nspname IN ('portal') AND c.relname NOT IN ('ctx_secret','email_verifications') LOOP
    EXECUTE format('GRANT SELECT ON %I.%I TO app_break_glass', t.s, t.r);
    EXECUTE format('CREATE POLICY breakglass_read ON %I.%I FOR SELECT TO app_break_glass USING (portal.breakglass_active())', t.s, t.r);
  END LOOP;
END $$;
GRANT SELECT ON audit.audit_events, audit.chain_head, audit.chain_truncation TO app_break_glass;
CREATE POLICY breakglass_read ON audit.audit_events FOR SELECT TO app_break_glass USING (portal.breakglass_active());
SELECT portal._assign_owners();

-- GRANTs to the migrator itself are dropped when ownership moves to the definer roles. Re-grant as the owners.
SET LOCAL ROLE app_core;
GRANT EXECUTE ON FUNCTION portal.bootstrap_first_admin(text,text), portal.request_expire_overdue(timestamptz),
  portal.staleness_run(), portal.retention_run(timestamptz) TO app_migrator;
RESET ROLE;
SET LOCAL ROLE app_agg;
GRANT EXECUTE ON FUNCTION agg.refresh_snapshot() TO app_migrator;
RESET ROLE;
