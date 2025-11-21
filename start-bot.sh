#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
"$SCRIPT_DIR/scripts/guard_integrity.sh" || { echo "❌ Guard failed"; exit 1; }

cd "$SCRIPT_DIR"
set -a
. ./.env
set +a
export TS_NODE_CACHE=false

echo "=== Running preflight checks ==="
npx tsx scripts/preflight_overrides.ts || {
  echo "❌ Override preflight FAILED - bot will not start"
  exit 1
}
echo "✅ All preflight checks passed"

echo "ENV BASE_ORDER_USD=$BASE_ORDER_USD CLIP_USD=${CLIP_USD:-} MAKER_SPREAD_BPS=$MAKER_SPREAD_BPS ACTIVE_LAYERS=$ACTIVE_LAYERS MIN_NOTIONAL_USD=$MIN_NOTIONAL_USD"
./stop-bot.sh || true
npm start >> bot.log 2>&1 &
echo "Bot started with PID $!"
