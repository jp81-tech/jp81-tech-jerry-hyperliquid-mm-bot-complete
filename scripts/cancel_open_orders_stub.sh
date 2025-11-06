#\!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DENY=$(grep -E '^ACTIVE_PAIRS_DENYLIST=' .env | cut -d= -f2 | tr ',' '\n' | sed 's/ //g')
echo "$(date -Is) Inspecting open orders for deny pairs: $DENY" >> runtime/watchdog.log
for p in $DENY; do
  echo "$(date -Is) [INFO] Would cancel open orders for $p (stub)" >> runtime/watchdog.log
done
