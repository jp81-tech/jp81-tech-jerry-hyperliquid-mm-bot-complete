#\!/usr/bin/env bash
set -euo pipefail
SLACK_WEBHOOK="${SLACK_WEBHOOK_RISK_PULSE:-${SLACK_WEBHOOK_ALERTS:-${SLACK_WEBHOOK_URL:-}}}"
if [[ -z "$SLACK_WEBHOOK" ]]; then
  echo "[risk-pulse] Missing Slack webhook env (SLACK_WEBHOOK_RISK_PULSE / SLACK_WEBHOOK_ALERTS / SLACK_WEBHOOK_URL)" >&2
  exit 0
fi
WD="/root/hyperliquid-mm-bot-complete"
cd "$WD"

ORD=$(npx -y tsx scripts/check-all-orders.ts 2>/dev/null || true)
PNL=$(npx -y tsx scripts/check_position_pnl.ts 2>/dev/null || true)

OO=$(printf "%s\n" "$ORD" | grep -E 'Found [0-9]+ open orders' | sed -E 's/.*Found ([0-9]+) open orders.*/\1/' | head -1)
OO=${OO:-0}

UPNL=$(printf "%s\n" "$PNL" | grep -E 'Total Unrealized PnL' | grep -oE '[-+]?[0-9]+\.[0-9]+' | head -1)
UPNL=${UPNL:-0}

ACCT=$(printf "%s\n" "$PNL" | grep -E 'Account Value' | grep -oE '[0-9,]+\.[0-9]+' | tr -d ',' | head -1)
ACCT=${ACCT:-0}

TOTAL_NOTIONAL=$(printf "%s\n" "$PNL" | grep -E 'Total Capital Deployed' | grep -oE '[0-9,]+\.[0-9]+' | tr -d ',' | head -1)
TOTAL_NOTIONAL=${TOTAL_NOTIONAL:-0}

NUM_POS=$(printf "%s\n" "$PNL" | grep -E 'Number of Positions' | grep -oE '[0-9]+' | head -1)
NUM_POS=${NUM_POS:-0}

LARGEST_NOTIONAL=$(printf "%s\n" "$PNL" | awk '
  /^\w+\s+\|\s+(LONG|SHORT)/ {
    pair=$1
    getline
    if($0 ~ /\|/) {
      split($0, arr, "|")
      notional=arr[6]
      gsub(/[^0-9\.\-]/, "", notional)
      if(notional+0 > max) {
        max=notional+0
        maxpair=pair
      }
    }
  }
  END {
    if(max>0) printf "%s: $%.2f", maxpair, max
    else print "n/a"
  }
' || echo "n/a")

FILLS_1H=$(journalctl -u mm-bot.service --since "1 hour ago" 2>/dev/null | grep -c 'quant_evt=attempt' || echo "0")

TS="$(date -u +'%Y-%m-%d %H:%M UTC')"

MSG="📊 *Risk Pulse* @ ${TS}
━━━━━━━━━━━━━━━━━━━━
• Open orders: ${OO}
• Active positions: ${NUM_POS}
• Largest notional: ${LARGEST_NOTIONAL}
• Total capital deployed: \$${TOTAL_NOTIONAL}
• Unrealized PnL: \$${UPNL}
• Account value: \$${ACCT}
• Fills (last 1h): ${FILLS_1H}
• Mode: LIVE 🔴"

curl -s -X POST -H 'Content-type: application/json' --data "{\"text\":\"${MSG}\"}" "$SLACK_WEBHOOK" >/dev/null
exit 0
