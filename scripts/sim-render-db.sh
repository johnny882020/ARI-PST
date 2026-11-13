#!/usr/bin/env bash
# Simulates a fresh Render Postgres for local verification of scripts/render-predeploy.mjs.
# Throwaway PostgreSQL 16 on port 55435 (data under /tmp), password auth (scram) on TCP like a managed service.
# ASSUMPTION (UNVERIFIED against render.com): Render gives ONE database user that owns the database and is
# NOSUPERUSER with CREATEROLE and CREATEDB. This script creates exactly that: user "ari_owner", database "ari_portal".
# Usage: bash scripts/sim-render-db.sh [--reset]    -> prints the owner connection string on the last line
#        bash scripts/sim-render-db.sh --stop
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}; PGDATA=${SIM_PGDATA:-/tmp/ari-render-sim-pg}; PGPORT=${SIM_PGPORT:-55435}
SOCK=/tmp/ari-render-sim-sock; DBNAME=ari_portal; OWNER=ari_owner; OWNER_PW=${SIM_OWNER_PASSWORD:-sim-owner-local-only}
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
if [ "${1:-}" = "--stop" ]; then as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true; exit 0; fi
if [ "${1:-}" = "--reset" ]; then as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true; rm -rf "$PGDATA"; fi
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA" "$SOCK"; chown postgres "$PGDATA" "$SOCK" 2>/dev/null || true
  as_pg "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth-local=trust --auth-host=scram-sha-256 >/dev/null
fi
mkdir -p "$SOCK"; chown postgres "$SOCK" 2>/dev/null || true
if ! as_pg "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PGPORT -k $SOCK -c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=100" -l "$PGDATA/log.txt" -w start >/dev/null
fi
PSQL=(as_pg "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$SOCK" -p "$PGPORT" -U postgres -d postgres)
if [ "$("${PSQL[@]}" -At -c "SELECT count(*) FROM pg_roles WHERE rolname='$OWNER'")" = "0" ]; then
  "${PSQL[@]}" -c "CREATE ROLE $OWNER LOGIN NOSUPERUSER CREATEDB CREATEROLE PASSWORD '$OWNER_PW'"
  "${PSQL[@]}" -c "CREATE DATABASE $DBNAME OWNER $OWNER"
fi
echo "postgres://$OWNER:$OWNER_PW@127.0.0.1:$PGPORT/$DBNAME"
