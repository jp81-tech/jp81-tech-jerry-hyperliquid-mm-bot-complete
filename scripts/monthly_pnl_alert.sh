#!/usr/bin/env bash
set -euo pipefail

SLACK_WEBHOOK="${SLACK_WEBHOOK_MONTHLY_ALERT:-${SLACK_WEBHOOK_ALERTS:-${SLACK_WEBHOOK_URL:-}}}"
if [[ -z "$SLACK_WEBHOOK" ]]; then
  echo "[monthly-pnl-alert] Missing Slack webhook env (SLACK_WEBHOOK_MONTHLY_ALERT / SLACK_WEBHOOK_ALERTS / SLACK_WEBHOOK_URL)" >&2
  exit 0
fi
THRESHOLD_NEG=-500   # ⚠️ Alert przy <= -500
THRESHOLD_POS=1000   # 🎉 Alert przy >= +1000
WD="/root/hyperliquid-mm-bot-complete"
cd "$WD"

LOGS=$(ls -1 logs/daily-health.*.log 2>/dev/null | tail -90 || true)

if [[ -z "$LOGS" ]]; then
  echo "No logs found"
  exit 0
fi

TOTAL=$(awk '
  /Total Unrealized PnL:/ {
    gsub(/[^0-9\.\-+]/,"",$0);
    v=$0+0;
    sum+=v;
    n++;
  }
  END {
    if(n>0) printf "%.2f\n", sum; else print "0"
  }
' $LOGS 2>/dev/null || echo "0")

TS="$(date -u +'%Y-%m-%d %H:%M UTC')"

# Sprawdź próg negatywny
if (( $(echo "$TOTAL <= $THRESHOLD_NEG" | bc -l) )); then
  MSG="⚠️ *Monthly PnL Alert - NEGATIVE THRESHOLD*\n━━━━━━━━━━━━━━━━━━━━━━\nTime: ${TS}\nCurrent Monthly Cumulative PnL: *${TOTAL} USD*\nThreshold: ${THRESHOLD_NEG} USD\n\n❗ Action may be required!"
  curl -s -X POST -H 'Content-type: application/json' \
    --data "{\"text\":\"${MSG}\"}" \
    "$SLACK_WEBHOOK" >/dev/null 2>&1 || true
  echo "Alert sent: Monthly PnL ${TOTAL} <= ${THRESHOLD_NEG}"
  exit 0
fi

# Sprawdź próg pozytywny
if (( $(echo "$TOTAL >= $THRESHOLD_POS" | bc -l) )); then
  MSG="🎉 *Monthly PnL Alert - POSITIVE MILESTONE*\n━━━━━━━━━━━━━━━━━━━━━━\nTime: ${TS}\nCurrent Monthly Cumulative PnL: *+${TOTAL} USD*\nThreshold: +${THRESHOLD_POS} USD\n\n🚀 Great performance this month!"
  curl -s -X POST -H 'Content-type: application/json' \
    --data "{\"text\":\"${MSG}\"}" \
    "$SLACK_WEBHOOK" >/dev/null 2>&1 || true
  echo "Alert sent: Monthly PnL ${TOTAL} >= ${THRESHOLD_POS}"
  exit 0
fi

# Jeśli między progami - cichy tryb
echo "Monthly PnL ${TOTAL} OK (between ${THRESHOLD_NEG} and ${THRESHOLD_POS})"
