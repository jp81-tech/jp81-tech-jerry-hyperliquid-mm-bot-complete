#\!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete
[ -f .env ] && set -a && source .env && set +a

SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

SINCE_TXT="$(date -u -d "15 minutes ago" "+%Y-%m-%d %H:%M:%S")"
NOW_TXT="$(date -u "+%Y-%m-%d %H:%M:%S")"

# Get ZEC PnL data
PNL_LINE="$(timeout 20 npx tsx scripts/check_position_pnl.ts 2>/dev/null | grep -i "^ZEC" | head -1 || echo "ZEC | - | - | - | - | - | -")"

SIDE="$(echo "$PNL_LINE" | awk -F"|" "{print \$2}" | xargs)"
SIZE="$(echo "$PNL_LINE" | awk -F"|" "{print \$3}" | xargs)"
ENTRY="$(echo "$PNL_LINE" | awk -F"|" "{print \$4}" | xargs)"
MARK="$(echo "$PNL_LINE" | awk -F"|" "{print \$5}" | xargs)"
UNREALIZED="$(echo "$PNL_LINE" | awk -F"|" "{print \$7}" | xargs)"

# Get activity from logs
SUBMITS_CNT="$(timeout 5 journalctl -u mm-bot.service --since "15 min ago" --no-pager | grep -c "submit: pair=ZEC" || echo 0)"

# FIX: Count fills from "Synced X new fills" - this is total for all pairs in 15min window
# For ZEC-specific, we would need detailed fill logs which arent available in this format
# So we show total fills as approximation
FILLS_CNT="$(timeout 5 journalctl -u mm-bot.service --since "15 min ago" --no-pager | grep -oE "Synced [0-9]+ new fills" | awk '{sum+=$2} END{print sum+0}')"

TEXT="🦓 ZEC Monitor — last 15m
UTC: ${SINCE_TXT} → ${NOW_TXT}

Position:
  Side: ${SIDE}
  Size: ${SIZE} ZEC
  Entry: ${ENTRY}
  Mark: ${MARK}
  Unrealized PnL: \$${UNREALIZED}

Activity:
  Submits: ${SUBMITS_CNT}
  Fills (all pairs): ${FILLS_CNT}"

# Send to Slack
if [ -n "${SLACK_WEBHOOK_URL}" ]; then
  timeout 15 curl -s -X POST -H "Content-type: application/json" \
       --data "$(jq -Rn --arg t "$TEXT" "{text:\$t}")" \
       "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || echo "Slack send failed/timeout"
fi

# Send to Telegram
if [ -n "${TELEGRAM_BOT_TOKEN}" ] && [ -n "${TELEGRAM_CHAT_ID}" ]; then
  TG_API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage"
  timeout 15 curl -s -X POST "$TG_API" -d "chat_id=${TELEGRAM_CHAT_ID}" \
       --data-urlencode "text=${TEXT}" >/dev/null 2>&1 || echo "Telegram send failed/timeout"
fi

echo "$TEXT"
