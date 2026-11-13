-- ARI-PST bootstrap. Run ONCE per cluster/database by a privileged admin (superuser or managed-DB admin),
-- never by the app. Idempotent. Creates the C-06 role model. Passwords are set out of band.
-- Run inside the target database:  psql -d <db> -f db/bootstrap.sql
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['app_migrator','app_runtime','app_audit_writer','app_readonly_bg'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT', r);
    END IF;
  END LOOP;
  -- break glass: NOLOGIN until ops enable it for an approved window
  FOREACH r IN ARRAY ARRAY['app_break_glass','app_core','app_agg'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT', r);
    END IF;
  END LOOP;
END $$;
-- Internal definer roles (NOLOGIN). The migrator may SET ROLE to them only to hand over function ownership.
-- app_runtime is a member of NOTHING, so it cannot SET ROLE (canonical C-06).
GRANT app_core, app_agg, app_audit_writer TO app_migrator WITH INHERIT FALSE, SET TRUE;
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO app_migrator', current_database());
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_runtime, app_audit_writer, app_readonly_bg, app_break_glass, app_migrator', current_database());
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
END $$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER ROLE app_runtime SET statement_timeout = '15s';
ALTER ROLE app_runtime SET idle_in_transaction_session_timeout = '30s';
