#!/usr/bin/env bash
set -euo pipefail

SLACK_WEBHOOK="${SLACK_WEBHOOK_PNL_ALERT:-${SLACK_WEBHOOK_ALERTS:-${SLACK_WEBHOOK_URL:-}}}"
if [[ -z "$SLACK_WEBHOOK" ]]; then
  echo "[pnl-alert] Missing Slack webhook env (SLACK_WEBHOOK_PNL_ALERT / SLACK_WEBHOOK_ALERTS / SLACK_WEBHOOK_URL)" >&2
  exit 0
fi
WD="/root/hyperliquid-mm-bot-complete"
THRESHOLD_POS=150    # 🟢 alert przy >= +150 USD
THRESHOLD_NEG=-100   # 🔴 alert przy <= -100 USD

cd "$WD"
PNL_OUTPUT=$(npx tsx scripts/check_position_pnl.ts 2>/dev/null || true)

# Parsowanie wartości liczbowej (np. "Total Unrealized PnL: +72.62" -> "72.62")
PNL=$(echo "$PNL_OUTPUT" | grep -i "Total Unrealized PnL" | grep -oE "[-+]?[0-9]+(\.[0-9]+)?" | head -1 || echo "")

# Jeśli nie ma wartości, exit cicho
if [[ -z "$PNL" ]] || [[ "$PNL" == "+" ]] || [[ "$PNL" == "-" ]]; then
  exit 0
fi

# Usuwamy znak + jeśli jest (bc nie lubi +)
PNL_NUM=$(echo "$PNL" | sed 's/^+//'| tr -d ' ')

MSG=""
if (( $(echo "$PNL_NUM >= $THRESHOLD_POS" | bc -l) )); then
  MSG="🟢 *PnL Alert:* +$PNL_NUM USD (daily profit above +$THRESHOLD_POS)"
elif (( $(echo "$PNL_NUM <= $THRESHOLD_NEG" | bc -l) )); then
  MSG="🔴 *PnL Alert:* $PNL_NUM USD (daily loss below $THRESHOLD_NEG)"
fi

if [[ -n "$MSG" ]]; then
  TS=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
  curl -s -X POST -H 'Content-type: application/json' \
    --data "{\"text\":\"${MSG}\nTime: ${TS}\"}" \
    "$SLACK_WEBHOOK" >/dev/null 2>&1 || true
fi
