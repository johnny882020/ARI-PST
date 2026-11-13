#!/usr/bin/env bash
# Smoke test: /livez and /readyz must return 200 JSON with a version. No data is read.
# Usage: BASE_URL=https://host bash scripts/smoke.sh [--wait SECONDS] [--expect-sha SHA]
set -euo pipefail
BASE_URL="${BASE_URL:?set BASE_URL, e.g. https://ari-api.onrender.com}"
BASE_URL="${BASE_URL%/}"
WAIT=0; EXPECT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --wait) WAIT="$2"; shift 2 ;;
    --expect-sha) EXPECT="$2"; shift 2 ;;
    *) echo "unknown arg $1" >&2; exit 2 ;;
  esac
done

probe() { # path -> prints body on 200
  local code body
  body=$(curl -sS -m 10 -o /tmp/smoke.$$ -w '%{http_code}' "$BASE_URL$1" 2>/dev/null) || return 1
  code="$body"; [ "$code" = "200" ] || return 1
  cat /tmp/smoke.$$; rm -f /tmp/smoke.$$
}
try() { # first path that answers 200 (root path, then /api prefix)
  for p in "$1" "/api$1"; do probe "$p" && return 0; done; return 1
}
deadline=$(( $(date +%s) + WAIT ))
while :; do
  if live=$(try /livez) && ready=$(try /readyz); then break; fi
  [ "$(date +%s)" -lt "$deadline" ] || { echo "FAIL: /livez or /readyz not 200 at $BASE_URL" >&2; exit 1; }
  sleep 3
done
for b in "$live" "$ready"; do
  echo "$b" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d.get('version'), 'no version'" \
    || { echo "FAIL: response has no version: $b" >&2; exit 1; }
done
if [ -n "$EXPECT" ]; then
  v=$(echo "$ready" | python3 -c "import json,sys;print(json.load(sys.stdin)['version'])")
  [ "$v" = "$EXPECT" ] || { echo "FAIL: version $v != $EXPECT" >&2; exit 1; }
fi
echo "OK: livez + readyz at $BASE_URL"
