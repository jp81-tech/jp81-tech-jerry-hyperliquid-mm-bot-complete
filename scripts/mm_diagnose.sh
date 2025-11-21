#\!/usr/bin/env bash
set -euo pipefail

SLACK_WEBHOOK="${SLACK_WEBHOOK_MM_DIAGNOSE:-${SLACK_WEBHOOK_ALERTS:-${SLACK_WEBHOOK_URL:-}}}"
if [[ -z "$SLACK_WEBHOOK" ]]; then
  echo "[mm-diagnose] Missing Slack webhook env (SLACK_WEBHOOK_MM_DIAGNOSE / SLACK_WEBHOOK_ALERTS / SLACK_WEBHOOK_URL)" >&2
  exit 0
fi
WD="/root/hyperliquid-mm-bot-complete"
cd "$WD"

ACTIVE_PAIRS=$(cat runtime/active_pairs.json 2>/dev/null | jq -r '.pairs[]' 2>/dev/null || echo "unknown")
ACTIVE_COUNT=$(echo "$ACTIVE_PAIRS" | wc -l)

POSITIONS=$(npx tsx scripts/check_position_pnl.ts 2>&1 | grep -E "^\w+\s+\|" | grep -v "Coin\|TOTAL\|^---" | awk '{print $1}' | tr "\n" ", " | sed 's/,$//')
POS_COUNT=$(npx tsx scripts/check_position_pnl.ts 2>&1 | grep "Number of Positions" | grep -oE "[0-9]+" | head -1 || echo "0")

ORDERS_OUTPUT=$(npx tsx scripts/check-all-orders.ts 2>&1)
ORDER_COUNT=$(echo "$ORDERS_OUTPUT" | grep "Found" | grep -oE "[0-9]+" | head -1 || echo "0")

BUY_ORDERS=$(echo "$ORDERS_OUTPUT" | grep -c "| B " || echo "0")
SELL_ORDERS=$(echo "$ORDERS_OUTPUT" | grep -c "| S " || echo "0")

RECENT_BUYS=$(journalctl -u mm-bot.service --since "15 minutes ago" 2>/dev/null | grep -c "L1 BUY" || echo "0")
RECENT_SELLS=$(journalctl -u mm-bot.service --since "15 minutes ago" 2>/dev/null | grep -c "L1 SELL" || echo "0")

ROTATION_FAILS=$(journalctl -u mm-bot.service --since "15 minutes ago" 2>/dev/null | grep -c "Failed to close.*SchemaError" || echo "0")

TS=$(date -u +'+%Y-%m-%d %H:%M UTC')

if [[ "$SELL_ORDERS" == "0" ]] && [[ "$BUY_ORDERS" -gt "0" ]]; then
  STATUS="🔴 *LONG-BIASED* (no sell orders)"
elif [[ "$ROTATION_FAILS" -gt "5" ]]; then
  STATUS="⚠️ *ROTATION ISSUE* (${ROTATION_FAILS} close failures)"
elif [[ "$RECENT_SELLS" == "0" ]] && [[ "$RECENT_BUYS" -gt "10" ]]; then
  STATUS="⚠️ *ONE-SIDED* (only buy activity)"
else
  STATUS="✅ *MM OK*"
fi

MSG="📊 *MM Diagnostic* @ ${TS}
━━━━━━━━━━━━━━━━━━━━━━
Status: ${STATUS}

📋 *Configuration*
Active pairs (rotation): ${ACTIVE_COUNT}
$(echo "$ACTIVE_PAIRS" | head -5)

📈 *Positions*
Count: ${POS_COUNT}
Pairs: ${POSITIONS}

📝 *Open Orders*
Total: ${ORDER_COUNT}
Buys: ${BUY_ORDERS} | Sells: ${SELL_ORDERS}

⚡ *Recent Activity (15min)*
Buy attempts: ${RECENT_BUYS}
Sell attempts: ${RECENT_SELLS}
Rotation close fails: ${ROTATION_FAILS}"

curl -s -X POST -H 'Content-type: application/json' \
  --data "{\"text\":\"${MSG}\"}" \
  "$SLACK_WEBHOOK" >/dev/null 2>&1 || true
