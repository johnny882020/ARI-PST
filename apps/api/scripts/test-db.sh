#!/usr/bin/env bash
# Throwaway PostgreSQL 16 for API integration tests: port 55433, trust auth, data under /tmp.
# Bootstraps the C-06 roles, runs db/migrate.mjs as app_migrator, seeds the vocabulary. The schema comes from db/migrations only.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}; PGDATA=${PGDATA:-/tmp/ari-pst-b2-pg}; PGPORT=${PGPORT:-55433}; DBNAME=${DBNAME:-ari_pst_api}; SOCK=/tmp/ari-pst-b2-sock
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
if [ ! -f "$PGDATA/PG_VERSION" ]; then mkdir -p "$PGDATA" "$SOCK"; chown postgres "$PGDATA" "$SOCK" 2>/dev/null || true; as_pg "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null; fi
mkdir -p "$SOCK"; chown postgres "$SOCK" 2>/dev/null || true
if ! as_pg "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PGPORT -k $SOCK -c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=100" -l "$PGDATA/log.txt" -w start >/dev/null
fi
export PGHOST=127.0.0.1 PGPORT
PSQL="$PGBIN/psql -X -q -v ON_ERROR_STOP=1 -U postgres"
$PSQL -d postgres -c "DROP DATABASE IF EXISTS $DBNAME WITH (FORCE)" >/dev/null 2>&1 || true
$PSQL -d postgres -c "CREATE DATABASE $DBNAME" >/dev/null
$PSQL -d $DBNAME -f "$ROOT/db/bootstrap.sql"
DATABASE_URL_MIGRATOR="postgres://app_migrator@127.0.0.1:$PGPORT/$DBNAME" node "$ROOT/db/migrate.mjs" >/dev/null
$PSQL -d $DBNAME -f "$ROOT/db/seeds/010_diagnosis_vocabulary.sql"
echo "postgres://app_runtime@127.0.0.1:$PGPORT/$DBNAME"
