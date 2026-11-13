-- 0001 foundation: schemas, extensions, id helper, owner hand-over helper. kind: expand
DO $$
BEGIN
  IF current_user <> 'app_migrator' THEN
    RAISE EXCEPTION 'migrations must run as app_migrator (got %). See db/bootstrap.sql', current_user;
  END IF;
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'migrations must not run as a superuser (RT-05)';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['app_runtime','app_audit_writer','app_readonly_bg','app_break_glass','app_core','app_agg']) r
             WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)) THEN
    RAISE EXCEPTION 'roles missing: run db/bootstrap.sql first';
  END IF;
END $$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS ext;
CREATE SCHEMA IF NOT EXISTS portal;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS search;
CREATE SCHEMA IF NOT EXISTS agg;
CREATE EXTENSION IF NOT EXISTS pg_trgm  SCHEMA ext;
CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA ext;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA ext;

GRANT USAGE ON SCHEMA ext, portal, search, agg TO app_runtime, app_core, app_agg, app_readonly_bg, app_break_glass;
GRANT USAGE ON SCHEMA audit TO app_runtime, app_core, app_audit_writer, app_readonly_bg, app_break_glass, app_agg;
GRANT USAGE ON SCHEMA ext, portal, search, agg TO app_audit_writer;

CREATE DOMAIN portal.ulid_text AS text CHECK (VALUE ~ '^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$');

-- ULID-like id generator (48-bit ms time + 80-bit random, Crockford base32).
CREATE FUNCTION portal.new_id(p_prefix text) RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, ext, pg_temp AS $$
DECLARE alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
        t bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
        s text := ''; r bytea := ext.gen_random_bytes(16); i int;
BEGIN
  FOR i IN 1..10 LOOP s := substr(alphabet, (t % 32)::int + 1, 1) || s; t := t / 32; END LOOP;
  FOR i IN 0..15 LOOP s := s || substr(alphabet, (get_byte(r, i) % 32) + 1, 1); END LOOP;
  RETURN p_prefix || '_' || s;
END $$;

-- Hands function ownership to the internal definer roles. Called at the end of every migration
-- that creates functions. portal.*, search.* -> app_core / app_agg ; agg.* -> app_agg ; audit.* -> app_audit_writer.
-- Migration pattern for REPLACING a definer function later: SET LOCAL ROLE <owner>; CREATE OR REPLACE ...; RESET ROLE;
CREATE FUNCTION portal._assign_owners() RETURNS void LANGUAGE plpgsql AS $$
DECLARE f record; o text;
BEGIN
  GRANT CREATE ON SCHEMA portal, search, agg, audit TO app_core, app_agg, app_audit_writer;
  FOR f IN SELECT p.oid::regprocedure AS sig, n.nspname AS sch
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname IN ('portal','agg','audit','search') AND p.proowner = 'app_migrator'::regrole
             AND p.proname <> '_assign_owners' AND p.prokind = 'f' LOOP
    o := CASE f.sch WHEN 'portal' THEN 'app_core' WHEN 'audit' THEN 'app_audit_writer' ELSE 'app_agg' END;
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I', f.sig, o);
  END LOOP;
  REVOKE CREATE ON SCHEMA portal, search, agg, audit FROM app_core, app_agg, app_audit_writer;
END $$;
-- trigger helper, invoker
CREATE FUNCTION portal.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
