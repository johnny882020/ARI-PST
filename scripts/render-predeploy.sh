#!/usr/bin/env bash
# Thin wrapper so the Blueprint and humans can call one name. Logic: scripts/render-predeploy.mjs
set -euo pipefail
exec node "$(cd "$(dirname "$0")" && pwd)/render-predeploy.mjs" "$@"
