#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete
[ -f .env ] && set -a && source .env && set +a

SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
ALERT_FILE="/tmp/zero_fill_alert_last_ts"
ALERT_COOLDOWN_MIN=30

echo "[$(date -u "+%Y-%m-%d %H:%M:%S UTC")] Zero-Fill Sentry Check..."

if [ -f "$ALERT_FILE" ]; then
  last_ts=$(stat -c %Y "$ALERT_FILE" 2>/dev/null || echo 0)
  now_ts=$(date +%s)
  diff=$(( (now_ts - last_ts) / 60 ))
  if [ "$diff" -lt "$ALERT_COOLDOWN_MIN" ]; then
    echo "⏱️ Alert cooldown active (last alert $diff min ago) - skipping"
    exit 0
  fi
fi

PAIRS="$(jq -r ".pairs[]" runtime/effective_active_pairs.json 2>/dev/null | xargs echo)"

if [ -z "$PAIRS" ]; then
  echo "No effective pairs - skipping"
  exit 0
fi

ZERO_FILL_PAIRS=()
for pair in $PAIRS; do
  SUBMITS=$(journalctl -u mm-bot.service --since "15 min ago" --no-pager | grep -c "submit: pair=${pair}" || echo 0)
  FILLS=$(journalctl -u mm-bot.service --since "15 min ago" --no-pager | grep -Eic "${pair}.*(filled|FILLED)" || echo 0)
  
  echo "  ${pair}: Submits=$SUBMITS, Fills=$FILLS"
  
  if [ "$SUBMITS" -ge 100 ] && [ "$FILLS" -eq 0 ]; then
    ZERO_FILL_PAIRS+=("$pair (${SUBMITS} submits)")
  fi
done

if [ "${#ZERO_FILL_PAIRS[@]}" -eq 0 ]; then
  echo "✅ No zero-fill issues detected"
  exit 0
fi

echo
echo "🚨 ZERO-FILL ALERT: ${#ZERO_FILL_PAIRS[@]} pairs with no fills"

PAIRS_LIST=$(printf "%s\n" "${ZERO_FILL_PAIRS[@]}" | sed "s/^/• /")
TS_UTC="$(date -u "+%Y-%m-%d %H:%M:%S UTC")"

MSG="🚨 *Zero-Fill Sentry Alert*
Time: ${TS_UTC}
Period: last 15 minutes

Pairs with high submits but ZERO fills:
${PAIRS_LIST}

Note: Bot may be getting fills (check position changes), but logs show 0 fills per-coin.
Action required: Check spreads, sizes, liquidity"

if [ -n "$SLACK_WEBHOOK_URL" ]; then
  curl -s -X POST -H "Content-type: application/json" --data "$(jq -Rn --arg t "$MSG" "{text:\$t}")" "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || true
fi

if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
  TG_API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage"
  curl -s -X POST "$TG_API" -d "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=${MSG}" >/dev/null 2>&1 || true
fi

touch "$ALERT_FILE"
echo "✅ Zero-fill alert sent"
