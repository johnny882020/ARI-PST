-- ARI-PST: run as app_migrator right after pg_restore. Closes the window that restore-pre.sql opened.
\set ON_ERROR_STOP 1
REVOKE CREATE ON SCHEMA portal, audit, search, agg, authn, ops FROM app_core, app_agg, app_audit_writer;
-- Must return zero rows: no internal role may still create objects in an application schema.
SELECT n.nspname, r.rolname
  FROM pg_namespace n CROSS JOIN pg_roles r
 WHERE n.nspname IN ('portal','audit','search','agg','authn','ops')
   AND r.rolname IN ('app_core','app_agg','app_audit_writer','app_runtime','app_readonly_bg','app_break_glass')
   AND has_schema_privilege(r.oid, n.oid, 'CREATE');
