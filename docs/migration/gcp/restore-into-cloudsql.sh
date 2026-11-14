#!/usr/bin/env bash
# Restore a full ARI-PST pg_dump (directory or custom format) into an EMPTY, pre-initialised Cloud SQL database.
# Used by docs/migration/google-cloud.md section 5 and by rehearse-cloudsql-restore.sh. Synthetic data only until GATE-PROD-DATA.
#
# Preconditions (section 4.2): docs/migration/gcp/sql/cloudsql-preinit.sql ran as the Cloud SQL "postgres" user.
# Login: app_migrator. Never the runtime role. Nothing here needs a superuser.
#
# Why not a plain "pg_restore": the dump holds objects owned by app_migrator AND by the internal definer roles
# (app_core, app_agg, app_audit_writer). A plain restore as app_migrator
#   1. fails at "ALTER FUNCTION ... OWNER TO app_agg" (the new owner needs CREATE on the schema), and
#   2. silently skips the GRANT/REVOKE lines on functions owned by those roles ("no privileges were granted" is only
#      a WARNING), which leaves EXECUTE open to PUBLIC and removes app_runtime's grants. That breaks the privacy model.
# So: restore-pre.sql opens a CREATE window, pass 1 restores everything except privileges, restore-post.sql closes the
# window, and pass 2 replays every privilege entry under SET ROLE <owner of that object>.
#
# Usage: MIGRATOR_URL='postgres://app_migrator:...@HOST:5432/ari_portal?sslmode=...' \
#        bash docs/migration/gcp/restore-into-cloudsql.sh DUMP_PATH [WORK_DIR]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
DUMP=${1:?dump directory or file}; WORK=${2:-$(mktemp -d)}
: "${MIGRATOR_URL:?set MIGRATOR_URL (login app_migrator)}"
PGBIN=${PGBIN:-$(dirname "$(command -v pg_restore)")}
for t in pg_restore psql; do command -v "$PGBIN/$t" >/dev/null || { echo "missing tool: $PGBIN/$t" >&2; exit 2; }; done
mkdir -p "$WORK"; umask 077
PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 "$MIGRATOR_URL")

who=$("${PSQL[@]}" -At -c 'SELECT current_user')
[ "$who" = "app_migrator" ] || { echo "MIGRATOR_URL must log in as app_migrator (got $who)" >&2; exit 2; }

echo "[1/5] restore-pre.sql (target must be empty)"
"${PSQL[@]}" -f "$HERE/sql/restore-pre.sql"

echo "[2/5] build the table of contents"
"$PGBIN/pg_restore" -l "$DUMP" > "$WORK/toc.full"
# Entries the target already has: schemas (preinit / restore-pre) and extensions (preinit). Also the public schema ACL,
# which db/bootstrap.sql owns. Everything else stays.
grep -v -E '; [0-9]+ [0-9]+ (SCHEMA - |EXTENSION - |COMMENT - EXTENSION |ACL - SCHEMA public )' "$WORK/toc.full" > "$WORK/toc.kept"
grep -E '; [0-9]+ [0-9]+ (ACL|DEFAULT ACL) ' "$WORK/toc.kept" > "$WORK/toc.acl" || true
grep -v -E '; [0-9]+ [0-9]+ (ACL|DEFAULT ACL) ' "$WORK/toc.kept" > "$WORK/toc.data"
echo "      entries: $(grep -cv '^;' "$WORK/toc.full") in dump, $(grep -cv '^;' "$WORK/toc.data") objects+data, $(grep -cv '^;' "$WORK/toc.acl") privilege entries"

echo "[3/5] pass 1: objects and data as app_migrator (one transaction)"
"$PGBIN/pg_restore" -L "$WORK/toc.data" --exit-on-error --single-transaction -d "$MIGRATOR_URL" "$DUMP"

echo "[4/5] restore-post.sql"
"${PSQL[@]}" -f "$HERE/sql/restore-post.sql"

echo "[5/5] pass 2: privileges, each under SET ROLE <object owner>"
"$PGBIN/pg_restore" -L "$WORK/toc.acl" -f "$WORK/acl.raw.sql" "$DUMP"
# pg_restore writes a header comment per entry: "-- Name: ...; Type: ACL; Schema: s; Owner: r". Switch to that owner first.
awk '
  /^-- Name: .*; Type: (ACL|DEFAULT ACL); .*Owner: / {
    o = $0; sub(/.*Owner: /, "", o); gsub(/[^a-z0-9_]/, "", o)
    if (o == "" || o == "app_migrator") print "RESET ROLE;"; else print "SET ROLE " o ";"
  }
  { print }
  END { print "RESET ROLE;" }' "$WORK/acl.raw.sql" > "$WORK/acl.sql"
# Any "no privileges were granted/revoked" warning means a line ran as the wrong role: treat it as an error.
"$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 --single-transaction "$MIGRATOR_URL" -f "$WORK/acl.sql" 2> "$WORK/acl.err" || { cat "$WORK/acl.err" >&2; exit 1; }
if grep -q -i 'no privileges' "$WORK/acl.err"; then cat "$WORK/acl.err" >&2; echo "FAIL: some privileges were not applied" >&2; exit 1; fi
echo "OK: restore finished. Next: run the predeploy job (expects 'up to date'), then the checks in section 5."
