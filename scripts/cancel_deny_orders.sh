#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DENY=$(grep -E '^ACTIVE_PAIRS_DENYLIST=' .env | cut -d= -f2 | tr ',' '\n' | sed 's/ //g')
PRIV=$(grep -E '^PRIVATE_KEY=' .env | cut -d= -f2-)
[ -z "$PRIV" ] && exit 0
for p in $DENY; do
  if [ -f scripts/cancel-open-orders.ts ]; then
    PRIVATE_KEY="$PRIV" npx tsx scripts/cancel-open-orders.ts "$p" >> runtime/watchdog.log 2>&1 || true
  else
    echo "$(date -Is) INFO: cancel-open-orders.ts not found, skipping order cancel for $p" >> runtime/watchdog.log
  fi
done
