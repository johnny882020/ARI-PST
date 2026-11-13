#!/usr/bin/env bash
# Manual / drill logical backup: pg_dump (custom format) -> age encryption -> SHA-256 manifest.
# Needs: pg_dump, age, sha256sum. DATABASE_URL must be reachable (the DB is private: run this from a
# Render shell on a service in the same private network, or from a trusted host with a temporary allow-listed IP).
# The age PRIVATE key is never on this machine. Only the public key is used.
# Usage: DATABASE_URL=... BACKUP_AGE_PUBLIC_KEY=age1... bash scripts/backup-export.sh [outdir]
# Synthetic data only until GATE-PROD-DATA closes.
set -euo pipefail
: "${DATABASE_URL:?}"; : "${BACKUP_AGE_PUBLIC_KEY:?}"
OUT="${1:-./backups}"; mkdir -p "$OUT"
for t in pg_dump age sha256sum; do command -v "$t" >/dev/null || { echo "missing tool: $t" >&2; exit 2; }; done
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$OUT/ari-db-$STAMP.dump.age"
umask 077
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" | age -r "$BACKUP_AGE_PUBLIC_KEY" -o "$FILE"
sha256sum "$FILE" | tee "$FILE.sha256"
echo "{\"file\":\"$(basename "$FILE")\",\"created\":\"$STAMP\"}" > "$FILE.manifest.json"
echo "OK: $FILE (upload to the EU offsite bucket; record the SHA-256 in the drill report)"
