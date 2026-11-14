-- ARI-PST: run as app_migrator on the NEW database, after cloudsql-preinit.sql and BEFORE pg_restore.
-- pg_restore hands definer functions to app_core / app_agg / app_audit_writer with ALTER FUNCTION ... OWNER TO.
-- PostgreSQL allows that only when the new owner has CREATE on the schema. The migrations solve this inside
-- portal._assign_owners() (grant CREATE, hand over, revoke). A restore needs the same window, so we create the
-- schemas here (owned by app_migrator, as the migrations do) and grant CREATE for the duration of the restore.
-- The matching "SCHEMA - <name>" entries are removed from the pg_restore TOC. restore-post.sql revokes the grants.
\set ON_ERROR_STOP 1
DO $$
BEGIN
  IF current_user <> 'app_migrator' THEN RAISE EXCEPTION 'run as app_migrator (got %)', current_user; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname IN ('public','portal','audit','search','agg','authn','ops') AND c.relkind IN ('r','p')) THEN
    RAISE EXCEPTION 'target is not empty: restore only into a database that has no tables yet';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS portal;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS search;
CREATE SCHEMA IF NOT EXISTS agg;
CREATE SCHEMA IF NOT EXISTS authn;
CREATE SCHEMA IF NOT EXISTS ops;
GRANT CREATE ON SCHEMA portal, audit, search, agg, authn, ops TO app_core, app_agg, app_audit_writer;
