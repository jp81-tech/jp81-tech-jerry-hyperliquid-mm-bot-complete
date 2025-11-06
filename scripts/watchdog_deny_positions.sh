#\!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DENY=$(grep -E "^ACTIVE_PAIRS_DENYLIST=" .env | cut -d= -f2 | tr "," "\n" | sed "s/ //g")
PRIV=$(grep -E "^PRIVATE_KEY=" .env | cut -d= -f2-)
test -z "$PRIV" && exit 0
OUT=$(PRIVATE_KEY="$PRIV" npx tsx check-positions.ts 2>/dev/null || true)
for p in $DENY; do
  if echo "$OUT" | grep -qi " ${p}:"; then
    echo "$(date -Is) ALERT denylisted position open: $p"
  fi
done
