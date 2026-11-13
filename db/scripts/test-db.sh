#!/usr/bin/env bash
# Starts a throwaway PostgreSQL 16 (port 55432, trust auth, data in /tmp), bootstraps roles, migrates, seeds nothing, runs tests.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${PGDATA:-/tmp/ari-pst-pg}
PGPORT=${PGPORT:-55432}
DBNAME=${DBNAME:-ari_pst_test}
SOCK=/tmp/ari-pst-pg-sock
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA" "$SOCK"; chown postgres "$PGDATA" "$SOCK" 2>/dev/null || true
  as_pg "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
fi
mkdir -p "$SOCK"; chown postgres "$SOCK" 2>/dev/null || true
if ! as_pg "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PGPORT -k $SOCK -c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=100" -l "$PGDATA/log.txt" -w start >/dev/null
fi
export PGHOST=127.0.0.1 PGPORT
PSQL="$PGBIN/psql -X -q -v ON_ERROR_STOP=1 -U postgres"
$PSQL -d postgres -c "DROP DATABASE IF EXISTS $DBNAME WITH (FORCE)" >/dev/null 2>&1 || true
$PSQL -d postgres -c "CREATE DATABASE $DBNAME" >/dev/null
$PSQL -d $DBNAME -f "$HERE/bootstrap.sql"
export TEST_DB_NAME=$DBNAME TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=$PGPORT
export DATABASE_URL_MIGRATOR="postgres://app_migrator@127.0.0.1:$PGPORT/$DBNAME"
node "$HERE/migrate.mjs"
cd "$HERE" && exec npx vitest run --passWithNoTests "$@"
