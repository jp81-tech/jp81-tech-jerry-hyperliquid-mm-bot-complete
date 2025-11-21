#!/usr/bin/env bash
set -euo pipefail

SLACK_WEBHOOK="${SLACK_WEBHOOK_MIN_NOTIONAL:-${SLACK_WEBHOOK_ALERTS:-${SLACK_WEBHOOK_URL:-}}}"
if [[ -z "$SLACK_WEBHOOK" ]]; then
  echo "[min-notional-alert] Missing Slack webhook env (SLACK_WEBHOOK_MIN_NOTIONAL / SLACK_WEBHOOK_ALERTS / SLACK_WEBHOOK_URL)" >&2
  exit 0
fi
WD="/root/hyperliquid-mm-bot-complete"
cd "$WD"

# CHANGED: Use journalctl for last 30 minutes instead of old log files
# This avoids false alerts from historical data when pairs were different
TIMEFRAME="30 minutes ago"

# Check journalctl for recent min-notional events (quant_evt=below_min)
HIT="$(journalctl -u mm-bot.service --since "$TIMEFRAME" --no-pager 2>/dev/null \
  | grep 'quant_evt=below_min' \
  | tail -1 || true)"

if [ -n "${HIT:-}" ]; then
  # Only alert if there are actual events in the last 30 minutes
  COUNT="$(journalctl -u mm-bot.service --since "$TIMEFRAME" --no-pager 2>/dev/null \
    | grep -c 'quant_evt=below_min' || echo 0)"

  if [ "$COUNT" -gt 0 ]; then
    TS="$(date -u +'%Y-%m-%d %H:%M:%S UTC')"
    MSG="⚠️ Min-Notional alert @ ${TS} (last 30min: ${COUNT} events)\n\`\`\`${HIT}\`\`\`"
    curl -s -X POST -H 'Content-type: application/json' --data "{\"text\":\"${MSG}\"}" "$SLACK_WEBHOOK" >/dev/null
  fi
fi

exit 0
