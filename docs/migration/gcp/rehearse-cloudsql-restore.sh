#!/usr/bin/env bash
# LOCAL rehearsal of the Render -> Cloud SQL database move (docs/migration/google-cloud.md, sections 4.2 and 5).
# Synthetic data only. Needs PostgreSQL 16 binaries (PGBIN) and a built API (pnpm --filter @ari/api... build).
#
# It starts TWO throwaway clusters under the scratch dir:
#   SRC  (port 55441) simulates Render: one owner "ari_owner" (NOSUPERUSER, CREATEROLE, CREATEDB) owns the database.
#        scripts/render-predeploy.mjs creates the roles, migrates and seeds synthetic data (SEED_PROFILE=tiny).
#   DST  (port 55442) simulates Cloud SQL: role "cloudsqlsuperuser" (NOLOGIN, CREATEROLE, CREATEDB) and a login
#        "postgres" that is a member of it and NOT a superuser. The database is owned by cloudsqlsuperuser.
# Then:  pg_dump -Fd from SRC as a superuser (simulates the Render "Create export" logical backup)
#        -> cloudsql-preinit.sql on DST as "postgres" -> pg_restore as app_migrator with a filtered TOC
#        -> render-predeploy.mjs on DST (expects "up to date", no seed) -> row counts + sha256 per table on both sides
#        -> audit-verify job as app_readonly_bg on DST -> API on DST in production mode -> scripts/smoke.sh.
# Limits of the simulation: a local cluster cannot reproduce every Cloud SQL rule (for example the CREATE EXTENSION
# restriction or the exact owner of schema public). Re-run the same steps against a real synthetic Cloud SQL instance.
#
# Usage: bash docs/migration/gcp/rehearse-cloudsql-restore.sh [--keep]
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
WORK=${REHEARSE_DIR:-${TMPDIR:-/tmp}/ari-gcp-rehearsal}
KEEP=${1:-}
SRC_PORT=55441; DST_PORT=55442; API_PORT=18091
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
rnd() { node -e 'console.log(require("node:crypto").randomBytes(18).toString("base64url"))'; }
log() { printf '\n=== %s\n' "$*"; }

stop_all() {
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
  for d in src dst; do as_pg "$PGBIN/pg_ctl" -D "$WORK/$d" -m fast stop >/dev/null 2>&1 || true; done
  [ "$KEEP" = "--keep" ] || rm -rf "$WORK"
}
trap stop_all EXIT

rm -rf "$WORK"; mkdir -p "$WORK/sock"; chmod 777 "$WORK" "$WORK/sock"
start_cluster() { # name port
  mkdir -p "$WORK/$1"; chown postgres "$WORK/$1" 2>/dev/null || true
  as_pg "$PGBIN/initdb" -D "$WORK/$1" -U sqlsu --auth-local=trust --auth-host=scram-sha-256 >/dev/null
  as_pg "$PGBIN/pg_ctl" -D "$WORK/$1" -o "-p $2 -k $WORK/sock -c listen_addresses=127.0.0.1 -c fsync=off" -l "$WORK/$1.log" -w start >/dev/null
}
SU() { as_pg "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$WORK/sock" -U sqlsu "$@"; }

OWNER_PW=$(rnd); ADMIN_PW=$(rnd)
export DB_PASSWORD_MIGRATOR=$(rnd) DB_PASSWORD_RUNTIME=$(rnd) DB_PASSWORD_BG=$(rnd) SEED_USER_PASSWORD=$(rnd)

log "SRC: simulated Render database"
start_cluster src $SRC_PORT
SU -p $SRC_PORT -d postgres -c "CREATE ROLE ari_owner LOGIN NOSUPERUSER CREATEDB CREATEROLE PASSWORD '$OWNER_PW'" -c "CREATE DATABASE ari_portal OWNER ari_owner"
SRC_OWNER_URL="postgres://ari_owner:$OWNER_PW@127.0.0.1:$SRC_PORT/ari_portal"
DATABASE_URL_OWNER=$SRC_OWNER_URL DATA_CLASSIFICATION=synthetic SEED_SYNTHETIC=true SEED_PROFILE=tiny \
  node "$ROOT/scripts/render-predeploy.mjs"

log "Dump SRC (superuser, directory format: simulates Render 'Create export')"
as_pg "$PGBIN/pg_dump" -h "$WORK/sock" -p $SRC_PORT -U sqlsu -d ari_portal -Fd -j 2 -f "$WORK/dump"
chmod -R a+rX "$WORK/dump"

log "DST: simulated Cloud SQL instance"
start_cluster dst $DST_PORT
SU -p $DST_PORT -d postgres \
  -c "CREATE ROLE cloudsqlsuperuser NOLOGIN CREATEROLE CREATEDB" \
  -c "CREATE ROLE postgres LOGIN NOSUPERUSER CREATEROLE CREATEDB INHERIT PASSWORD '$ADMIN_PW' IN ROLE cloudsqlsuperuser" \
  -c "CREATE DATABASE ari_portal OWNER cloudsqlsuperuser"
DST_ADMIN_URL="postgres://postgres:$ADMIN_PW@127.0.0.1:$DST_PORT/ari_portal"

log "DST: cloudsql-preinit.sql as postgres (roles, bootstrap.sql, extensions)"
psql -X -q "$DST_ADMIN_URL" -v ON_ERROR_STOP=1 -v pw_migrator="$DB_PASSWORD_MIGRATOR" -v pw_runtime="$DB_PASSWORD_RUNTIME" -v pw_bg="$DB_PASSWORD_BG" \
  -f "$ROOT/docs/migration/gcp/sql/cloudsql-preinit.sql"

log "DST: restore-into-cloudsql.sh as app_migrator"
DST_MIG_URL="postgres://app_migrator:$DB_PASSWORD_MIGRATOR@127.0.0.1:$DST_PORT/ari_portal"
MIGRATOR_URL=$DST_MIG_URL PGBIN=$PGBIN bash "$ROOT/docs/migration/gcp/restore-into-cloudsql.sh" "$WORK/dump" "$WORK/restore"

log "DST: predeploy (bootstrap again, migrate must be up to date, no seed)"
DATABASE_URL_OWNER=$DST_ADMIN_URL DATA_CLASSIFICATION=synthetic SEED_SYNTHETIC=false \
  node "$ROOT/scripts/render-predeploy.mjs" | tee "$WORK/predeploy.log"
grep -q 'up to date' "$WORK/predeploy.log" || { echo "FAIL: migrate was not up to date after restore"; exit 1; }

log "Compare row counts and content hashes (superuser on both sides)"
Q="SELECT n.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('public','portal','audit','search','agg','authn','ops') ORDER BY 1"
fingerprint() { # port
  for t in $(SU -p "$1" -d ari_portal -At -c "$Q"); do
    SU -p "$1" -d ari_portal -At -c "SET row_security=off; SELECT '$t '||count(*)||' '||coalesce(md5(string_agg(md5(x::text), '' ORDER BY md5(x::text))),'-') FROM $t x"
  done
}
fingerprint $SRC_PORT > "$WORK/src.fp"; fingerprint $DST_PORT > "$WORK/dst.fp"
diff -u "$WORK/src.fp" "$WORK/dst.fp" || { echo "FAIL: row counts or hashes differ"; exit 1; }
echo "OK: $(wc -l < "$WORK/src.fp") tables, counts and hashes match"

log "DST: ownership and privilege checks"
SU -p $DST_PORT -d ari_portal -At -c "SELECT 'owners: '||string_agg(DISTINCT pg_get_userbyid(c.relowner), ',') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('portal','audit','search','agg','authn','ops')"
SU -p $DST_PORT -d ari_portal -At -c "SELECT 'definer functions by owner: '||string_agg(o||'='||k, ', ') FROM (SELECT pg_get_userbyid(p.proowner) o, count(*) k FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema','ext') GROUP BY 1) s"
SU -p $DST_PORT -d ari_portal -At -c "SELECT 'tables with FORCE RLS: '||count(*) FROM pg_class WHERE relforcerowsecurity"
SU -p $SRC_PORT -d ari_portal -At -c "SELECT 'SRC tables with FORCE RLS: '||count(*) FROM pg_class WHERE relforcerowsecurity"
ACLQ="SELECT 'ns '||nspname||' '||pg_get_userbyid(nspowner)||' '||coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(coalesce(nspacl, acldefault('n', nspowner))) a),'-') FROM pg_namespace WHERE nspname IN ('public','portal','audit','search','agg','authn','ops','ext')
 UNION ALL SELECT 'rel '||n.nspname||'.'||c.relname||' '||pg_get_userbyid(c.relowner)||' '||coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(coalesce(c.relacl, CASE WHEN c.relkind='S' THEN acldefault('s', c.relowner) ELSE acldefault('r', c.relowner) END)) a),'-')||' rls='||c.relrowsecurity||'/'||c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','portal','audit','search','agg','authn','ops')
 UNION ALL SELECT 'fn '||p.oid::regprocedure::text||' '||pg_get_userbyid(p.proowner)||' '||coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a),'-')||' definer='||p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','portal','audit','search','agg','authn','ops')
 UNION ALL SELECT 'pol '||schemaname||'.'||tablename||'.'||policyname||' '||array_to_string(roles,',')||' '||cmd FROM pg_policies
 UNION ALL SELECT 'trg '||tgrelid::regclass::text||'.'||tgname||' '||tgenabled::text FROM pg_trigger WHERE NOT tgisinternal
 ORDER BY 1"
SU -p $SRC_PORT -d ari_portal -At -c "$ACLQ" > "$WORK/src.acl"; SU -p $DST_PORT -d ari_portal -At -c "$ACLQ" > "$WORK/dst.acl"
diff -u "$WORK/src.acl" "$WORK/dst.acl" || { echo "FAIL: owners, grants, RLS, policies or triggers differ"; exit 1; }
echo "OK: $(wc -l < "$WORK/src.acl") owners, grants, RLS flags, policies and triggers match"

log "DST: audit-verify job as app_readonly_bg"
DB_HOST=127.0.0.1 DB_PORT=$DST_PORT DB_NAME=ari_portal node "$ROOT/apps/api/dist/jobs/audit-verify.js"

log "DST: API in production mode + smoke"
( env -i PATH="$PATH" NODE_ENV=production PORT=$API_PORT DATA_CLASSIFICATION=synthetic PUBLIC_ORIGIN=http://127.0.0.1:$API_PORT \
    COOKIE_SECURE=false IP_HASH_SALT=$(rnd) SECRETS_KEY=$(rnd) APP_VERSION=rehearsal OUTBOX_INTERVAL_MS=0 \
    DB_HOST=127.0.0.1 DB_PORT=$DST_PORT DB_NAME=ari_portal DB_PASSWORD_RUNTIME="$DB_PASSWORD_RUNTIME" \
    node "$ROOT/apps/api/dist/server.js" > "$WORK/api.log" 2>&1 ) &
API_PID=$!
BASE_URL=http://127.0.0.1:$API_PORT bash "$ROOT/scripts/smoke.sh" --wait 30 --expect-sha rehearsal
echo; echo "REHEARSAL PASSED"
