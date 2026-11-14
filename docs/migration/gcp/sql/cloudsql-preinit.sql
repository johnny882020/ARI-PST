-- ARI-PST: one-time pre-init for a NEW Cloud SQL for PostgreSQL 16 database.
-- Run ONCE, as the Cloud SQL "postgres" user (member of cloudsqlsuperuser; CREATEROLE, CREATEDB; NOT a superuser),
-- inside the target database, BEFORE the first predeploy job and BEFORE any pg_restore:
--   psql "host=... dbname=ari_portal user=postgres sslmode=..." \
--        -v pw_migrator="$DB_PASSWORD_MIGRATOR" -v pw_runtime="$DB_PASSWORD_RUNTIME" -v pw_bg="$DB_PASSWORD_BG" \
--        -v ON_ERROR_STOP=1 -f docs/migration/gcp/sql/cloudsql-preinit.sql
-- Why it exists:
--   1. Cloud SQL lets only cloudsqlsuperuser members run CREATE EXTENSION (UNVERIFIED for trusted extensions; harmless if not needed).
--      Migration 0001 runs as app_migrator and does CREATE EXTENSION IF NOT EXISTS ... SCHEMA ext. We create the three
--      extensions here first, in schema ext owned by app_migrator, so 0001 finds them and does nothing.
--   2. It runs db/bootstrap.sql exactly as scripts/render-predeploy.mjs does (temporary membership in app_migrator),
--      so an EMPTY, bootstrapped database exists for pg_restore (section 5 of docs/migration/google-cloud.md).
-- Idempotent. Synthetic data only until GATE-PROD-DATA closes. Passwords come from psql variables, never from this file.
\set ON_ERROR_STOP 1
SELECT set_config('ari.pw_migrator', :'pw_migrator', false),
       set_config('ari.pw_runtime',  :'pw_runtime',  false),
       set_config('ari.pw_bg',       :'pw_bg',       false) \gset
DO $$
DECLARE r record;
BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE NOTICE 'running as a true superuser: this is not Cloud SQL, but the script still works';
  END IF;
  FOR r IN SELECT * FROM (VALUES ('app_migrator','ari.pw_migrator'), ('app_runtime','ari.pw_runtime'), ('app_readonly_bg','ari.pw_bg')) v(role, setting) LOOP
    IF length(current_setting(r.setting)) < 16 THEN RAISE EXCEPTION 'password for % is too short (min 16)', r.role; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.role) THEN
      EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT PASSWORD %L', r.role, current_setting(r.setting));
    ELSE
      EXECUTE format('ALTER ROLE %I PASSWORD %L', r.role, current_setting(r.setting));
    END IF;
  END LOOP;
END $$;
-- Forget the passwords in this session.
SELECT set_config('ari.pw_migrator', '', false), set_config('ari.pw_runtime', '', false), set_config('ari.pw_bg', '', false) \gset
-- Temporary membership, as in scripts/render-predeploy.mjs step 1b. Revoked at the end of this file.
GRANT app_migrator TO CURRENT_USER WITH INHERIT TRUE, SET TRUE;
\ir ../../../../db/bootstrap.sql
-- bootstrap.sql revoked CONNECT from PUBLIC. The admin user must still connect for later predeploy runs.
SELECT format('GRANT CONNECT ON DATABASE %I TO CURRENT_USER', current_database()) AS g \gset
:g;
CREATE SCHEMA IF NOT EXISTS ext AUTHORIZATION app_migrator;
CREATE EXTENSION IF NOT EXISTS pg_trgm  SCHEMA ext;
CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA ext;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA ext;
REVOKE app_migrator FROM CURRENT_USER;
-- Checks (same as render-predeploy.mjs step 1c). Each must return zero rows / false.
SELECT rolname AS elevated_app_role FROM pg_roles WHERE rolname LIKE 'app\_%' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb);
SELECT pg_get_userbyid(datdba) AS db_owner, has_database_privilege('public', datname, 'CONNECT') AS public_connect
  FROM pg_database WHERE datname = current_database();
