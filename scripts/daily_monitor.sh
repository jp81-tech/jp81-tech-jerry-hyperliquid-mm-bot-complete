#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

STATE_FILE="data/bot_state.json"

# Check for jq binary
if ! command -v jq >/dev/null 2>&1; then
  echo "$(date -Is) ❌ jq not found, aborting daily_monitor"
  exit 1
fi
ENV_FILE=".env"

# Load environment variables (for Slack webhook, etc.)
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [ ! -f "$STATE_FILE" ]; then
  echo "state file not found: $STATE_FILE"
  exit 1
fi

SLACK_WEBHOOK="${SLACK_DAILY_MONITOR_WEBHOOK:-${SLACK_MONITOR_OVERRIDE_WEBHOOK:-${SLACK_WEBHOOK_URL:-${HEALTH_SLACK_WEBHOOK:-}}}}"

DAILY=$(jq -r '.dailyPnl // 0' "$STATE_FILE" 2>/dev/null || echo 0)
TOTAL=$(jq -r '.totalPnlUsd // .totalPnl // .pnlUsd // 0' "$STATE_FILE" 2>/dev/null || echo 0)

# Validate that PnL values are numbers
is_number() {
  [[ "$1" =~ ^-?[0-9]+([.][0-9]+)?$ ]]
}

if ! is_number "$DAILY"; then DAILY=0; fi
if ! is_number "$TOTAL"; then TOTAL=0; fi
MAX=${MAX_DAILY_LOSS_USD:-6000}
MARGIN=500

NEAR_LIMIT=$(python3 - "$DAILY" "$MAX" "$MARGIN" <<'EOF'
import sys
try:
    daily = float(sys.argv[1])
    maxloss = float(sys.argv[2])
    margin = float(sys.argv[3])
    print(1 if abs(daily) >= maxloss - margin else 0)
except ValueError:
    print(0)
EOF
)

MSG="DailyPnL=${DAILY} USD | TotalPnL=${TOTAL} USD | MaxDailyLoss=${MAX} USD"
echo "$(date -Is) [DAILY_MONITOR] ${MSG}"

if [ "$NEAR_LIMIT" = "1" ] && [ -n "$SLACK_WEBHOOK" ]; then
  payload=$(jq -Rn --arg t "[DAILY_MONITOR] $MSG" '{text: $t}')
  curl -s -X POST -H "Content-type: application/json" \
    --data "$payload" \
    "$SLACK_WEBHOOK" >/dev/null 2>&1 || true
fi
