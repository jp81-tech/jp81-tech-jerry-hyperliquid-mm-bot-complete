#\!/usr/bin/env bash
set -euo pipefail

SLACK_WEBHOOK="${SLACK_WEBHOOK_STATUS_DASHBOARD:-${SLACK_WEBHOOK_ALERTS:-${SLACK_WEBHOOK_URL:-}}}"
if [[ -z "$SLACK_WEBHOOK" ]]; then
  echo "[slack-status-dashboard] Missing Slack webhook env (SLACK_WEBHOOK_STATUS_DASHBOARD / SLACK_WEBHOOK_ALERTS / SLACK_WEBHOOK_URL)" >&2
  exit 0
fi
WD="/root/hyperliquid-mm-bot-complete"
MAX=3500

cd "$WD"

ORDERS="$(npx tsx scripts/check-all-orders.ts 2>&1 || true)"
PNL="$(npx tsx scripts/check_position_pnl.ts 2>&1 || true)"
POS="$(npx tsx check-positions.ts 2>&1 || true)"

TS="$(date -u +"%Y-%m-%d %H:%M:%S UTC")"

PAYLOAD="*MM Status @ ${TS}*\n\n*Open Orders:*\n\`\`\`\n${ORDERS}\n\`\`\`\n*Positions & PnL:*\n\`\`\`\n${PNL}\n\`\`\`\n*Positions Detail:*\n\`\`\`\n${POS}\n\`\`\`"

TEXT="$(printf "%s" "$PAYLOAD" | head -c $MAX | sed 's/\\/\\\\/g; s/"/\\"/g')"

curl -s -X POST -H 'Content-type: application/json' --data "{\"text\":\"${TEXT}\"}" "$SLACK_WEBHOOK" >/dev/null 2>&1 || true
