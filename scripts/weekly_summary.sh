#\!/usr/bin/env bash
set -euo pipefail

SLACK_WEBHOOK="${SLACK_WEBHOOK_WEEKLY_SUMMARY:-${SLACK_WEBHOOK_ALERTS:-${SLACK_WEBHOOK_URL:-}}}"
if [[ -z "$SLACK_WEBHOOK" ]]; then
  echo "[weekly-summary] Missing Slack webhook env (SLACK_WEBHOOK_WEEKLY_SUMMARY / SLACK_WEBHOOK_ALERTS / SLACK_WEBHOOK_URL)" >&2
  exit 0
fi
WD="/root/hyperliquid-mm-bot-complete"

cd "$WD"

# Pobierz obecny PnL i pozycje
PNL_OUTPUT=$(npx tsx scripts/check_position_pnl.ts 2>/dev/null || echo "No data")
POSITIONS=$(npx tsx scripts/check-positions.ts 2>/dev/null | head -30 || echo "No positions")
ORDERS=$(npx tsx scripts/check-all-orders.ts 2>/dev/null | head -20 || echo "No orders")

# Parsuj główne metryki
TOTAL_PNL=$(echo "$PNL_OUTPUT" | grep -i "Total Unrealized PnL" | grep -oE "[-+]?[0-9]+(\.[0-9]+)?" | head -1 || echo "0")
ACCOUNT_VALUE=$(echo "$PNL_OUTPUT" | grep -i "Account Value" | grep -oE "[0-9,]+(\.[0-9]+)?" | tr -d "," | head -1 || echo "0")
NUM_POSITIONS=$(echo "$PNL_OUTPUT" | grep -i "Number of Positions" | grep -oE "[0-9]+" | head -1 || echo "0")

# Znajdź best/worst pozycje (top 3)
BEST_PAIRS=$(echo "$PNL_OUTPUT" | grep -E "^\w+\s+\|" | grep -v "TOTAL" | grep -v "Coin" | grep -v "^---" | sort -t"|" -k7 -rn | head -3 || echo "")
WORST_PAIRS=$(echo "$PNL_OUTPUT" | grep -E "^\w+\s+\|" | grep -v "TOTAL" | grep -v "Coin" | grep -v "^---" | sort -t"|" -k7 -n | head -3 || echo "")

TS=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
WEEK_START=$(date -u -d "last monday" +"%Y-%m-%d")
WEEK_END=$(date -u +"%Y-%m-%d")

# Buduj raport
REPORT="📅 *WEEKLY SUMMARY* ($WEEK_START → $WEEK_END)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *Account Value:* \$$ACCOUNT_VALUE
📈 *Total Unrealized PnL:* \$$TOTAL_PNL
📊 *Active Positions:* $NUM_POSITIONS

🏆 *Top 3 Performers:*
\`\`\`
$BEST_PAIRS
\`\`\`

📉 *Bottom 3 Performers:*
\`\`\`
$WORST_PAIRS
\`\`\`

📋 *Current Positions (sample):*
\`\`\`
$(echo "$POSITIONS" | head -15)
\`\`\`

📝 *Open Orders (sample):*
\`\`\`
$(echo "$ORDERS" | head -10)
\`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated: $TS"

# Escapuj dla JSON
ESCAPED=$(echo "$REPORT" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk '{printf "%s\\n", $0}')

curl -s -X POST -H 'Content-type: application/json' \
  --data "{\"text\":\"$ESCAPED\"}" \
  "$SLACK_WEBHOOK" >/dev/null 2>&1 || true
