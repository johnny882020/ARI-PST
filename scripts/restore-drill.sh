#!/usr/bin/env bash
# Restore drill DR-2: decrypt a backup, restore into a SCRATCH database, compare counts, verify audit chain.
# NEVER point SCRATCH_DATABASE_URL at production. The script refuses names containing "prod" and requires
# an explicit confirmation env var.
# Usage: AGE_IDENTITY_FILE=key.txt SCRATCH_DATABASE_URL=postgres://.../scratch CONFIRM_SCRATCH=yes \
#        bash scripts/restore-drill.sh backups/ari-db-XXXX.dump.age
# Optional: EXPECTED_COUNTS_FILE (lines "schema.table count") and AUDIT_VERIFY_CMD (e.g. "node apps/api/dist/jobs/audit-verify.js").
set -euo pipefail
FILE="${1:?backup file}"
: "${AGE_IDENTITY_FILE:?}"; : "${SCRATCH_DATABASE_URL:?}"
[ "${CONFIRM_SCRATCH:-}" = "yes" ] || { echo "Set CONFIRM_SCRATCH=yes to confirm this is a scratch database" >&2; exit 2; }
case "$SCRATCH_DATABASE_URL" in *prod*|*ari_portal) echo "Refusing: URL looks like production" >&2; exit 2;; esac
for t in age pg_restore psql sha256sum; do command -v "$t" >/dev/null || { echo "missing tool: $t" >&2; exit 2; }; done
START=$(date +%s)
[ -f "$FILE.sha256" ] && { sha256sum -c "$FILE.sha256" || { echo "checksum mismatch" >&2; exit 1; }; }
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
age -d -i "$AGE_IDENTITY_FILE" -o "$TMP" "$FILE"
pg_restore --clean --if-exists --no-owner --no-privileges -d "$SCRATCH_DATABASE_URL" "$TMP"
echo "--- row counts"
psql "$SCRATCH_DATABASE_URL" -At -c "select schemaname||'.'||relname||' '||(xpath('/row/c/text()', query_to_xml('select count(*) as c from '||schemaname||'.'||quote_ident(relname), false, true, '')))[1]::text::bigint from pg_stat_user_tables order by 1" > restore-counts.txt
cat restore-counts.txt
if [ -n "${EXPECTED_COUNTS_FILE:-}" ]; then
  diff -u "$EXPECTED_COUNTS_FILE" restore-counts.txt && echo "counts match" || { echo "FAIL: counts differ" >&2; exit 1; }
fi
if [ -n "${AUDIT_VERIFY_CMD:-}" ]; then
  DATABASE_URL="$SCRATCH_DATABASE_URL" bash -c "$AUDIT_VERIFY_CMD" && echo "audit chain verifies" || { echo "FAIL: audit chain" >&2; exit 1; }
else
  echo "WARN: AUDIT_VERIFY_CMD not set. The drill is NOT complete without audit-chain verification."
fi
echo "Elapsed: $(( $(date +%s) - START )) s (record in docs/drills/, no data)"
