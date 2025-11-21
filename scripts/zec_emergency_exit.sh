#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete

# Load .env explicitly
[ -f .env ] && set -a && source .env && set +a

SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
COOLDOWN_FILE="/tmp/zec_exit_last_ts"
COOLDOWN_MIN=15

echo "[$(date -u "+%Y-%m-%d %H:%M:%S UTC")] ZEC Emergency Exit Check..."

# Check cooldown
if [ -f "$COOLDOWN_FILE" ]; then
  last_ts=$(stat -c %Y "$COOLDOWN_FILE" 2>/dev/null || echo 0)
  now_ts=$(date +%s)
  diff=$(( (now_ts - last_ts) / 60 ))
  if [ "$diff" -lt "$COOLDOWN_MIN" ]; then
    echo "⏱️ Cooldown active (last exit $diff min ago, limit: ${COOLDOWN_MIN}min) - skipping"
    exit 0
  fi
fi

# Get ZEC position data
PNL_LINE="$(timeout 30 npx tsx scripts/check_position_pnl.ts 2>/dev/null | grep -i "^ZEC" | head -1 || echo "ZEC | - | - | - | - | - | -")"

SIDE="$(echo "$PNL_LINE" | awk -F"|" "{print \$2}" | xargs)"
SIZE="$(echo "$PNL_LINE" | awk -F"|" "{print \$3}" | xargs)"
UNREALIZED="$(echo "$PNL_LINE" | awk -F"|" "{print \$7}" | xargs)"

# Get activity (last 15 min)
SUBMITS_CNT="$(journalctl -u mm-bot.service --since "15 min ago" --no-pager | grep -c "submit: pair=ZEC" || echo 0)"
FILLS_CNT="$(journalctl -u mm-bot.service --since "15 min ago" --no-pager | grep -Eic "ZEC.*(filled|FILLED)" || echo 0)"

echo "  Position: $SIDE $SIZE ZEC"
echo "  Unrealized PnL: \$$UNREALIZED"
echo "  Activity (15m): Submits=$SUBMITS_CNT, Fills=$FILLS_CNT"

# Check conditions
TRIGGER=false
REASON=""

# Condition 1: Zero fills with high submit count
if [ "$FILLS_CNT" -eq 0 ] && [ "$SUBMITS_CNT" -ge 100 ]; then
  TRIGGER=true
  REASON="Zero fills (${SUBMITS_CNT} submits)"
fi

# Condition 2: Unrealized loss > $300
if [ "$TRIGGER" = true ]; then
  # Remove any negative sign and compare
  LOSS_ABS=$(echo "$UNREALIZED" | sed "s/-//g")
  if (( $(echo "$LOSS_ABS > 300" | bc -l) )); then
    REASON="$REASON + Loss > \$300 (\$$UNREALIZED)"
  else
    TRIGGER=false
  fi
fi

# Condition 3: Position size > 10 ZEC
if [ "$TRIGGER" = true ]; then
  SIZE_NUM=$(echo "$SIZE" | sed "s/[^0-9.]//g")
  if (( $(echo "$SIZE_NUM > 10" | bc -l) )); then
    REASON="$REASON + Size > 10 ZEC ($SIZE)"
  else
    TRIGGER=false
  fi
fi

if [ "$TRIGGER" = false ]; then
  echo "✅ No emergency exit needed (conditions not met)"
  exit 0
fi

# EMERGENCY EXIT TRIGGERED
echo
echo "🚨 EMERGENCY EXIT TRIGGERED: $REASON"
echo "   Executing taker-exit with 30 bps max slippage..."

# Execute emergency exit (IOC with max 0.3% slippage)
EXIT_OUTPUT="$(MAX_SLIPPAGE_BPS=30 timeout 60 npx tsx scripts/close_zec_short.ts 2>&1 || echo "FAILED")"

echo "$EXIT_OUTPUT"

# Send alert
TS_UTC="$(date -u "+%Y-%m-%d %H:%M:%S UTC")"
MSG="🚨 *ZEC Emergency Exit*
Time: ${TS_UTC}
Reason: ${REASON}

Before:
  Position: $SIDE $SIZE ZEC
  Unrealized PnL: \$$UNREALIZED
  Activity (15m): ${SUBMITS_CNT} submits, ${FILLS_CNT} fills

Action: Taker-exit (IOC, max 30 bps slippage)

Result:
\`\`\`
${EXIT_OUTPUT}
\`\`\`"

if [ -n "$SLACK_WEBHOOK_URL" ]; then
  curl -s -X POST -H "Content-type: application/json" \
       --data "$(jq -Rn --arg t "$MSG" "{text:\$t}")" \
       "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || true
fi

if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
  TG_API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage"
  curl -s -X POST "$TG_API" -d "chat_id=${TELEGRAM_CHAT_ID}" \
       --data-urlencode "text=${MSG}" >/dev/null 2>&1 || true
fi

# Update cooldown timestamp
touch "$COOLDOWN_FILE"

echo "✅ Emergency exit executed + alert sent"
