#!/usr/bin/env bash
set -eo pipefail
cd /root/hyperliquid-mm-bot-complete

 
[ -f .env ] && source <(grep -E "^(SLACK|DISCORD)_WEBHOOK" .env | sed "s/^/export /")
HOOK="${SLACK_WEBHOOK_URL:-${DISCORD_WEBHOOK_URL}}"
STAMP="runtime/roe_ping.stamp"
ALERT_ROE=-3.0

send_alert() {
  local msg="$1"
  [ -z "$HOOK" ] && return
  if [[ "$HOOK" == *"discord"* ]]; then
    curl -s -X POST -H "Content-Type: application/json" -d "{\"content\":\"$msg\"}" "$HOOK" >/dev/null
  else
    curl -s -X POST -H "Content-Type: application/json" -d "{\"text\":\"$msg\"}" "$HOOK" >/dev/null
  fi
}

positions=$(curl -s -H "Content-Type: application/json" \
  -d "{\"type\":\"clearinghouseState\",\"user\":\"0xF4620F6fb51FA2fdF3464e0b5b8186D14bC902fe\"}" \
  https://api.hyperliquid.xyz/info | jq -r '
  .assetPositions[] | select(.position.szi != "0") | 
  "\(.position.coin)|\(.position.returnOnEquity)|\(.position.unrealizedPnl)|\(.position.positionValue)"
')

current_hash=$(echo "$positions" | sha256sum | awk '{print $1}')
[ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$current_hash" ] && exit 0

alerts=""
while IFS='|' read -r coin roe upnl notional; do
  [ -z "$coin" ] && continue
  roe_pct=$(awk "BEGIN{print $roe * 100}")
  
  if awk "BEGIN{exit(!($roe_pct < $ALERT_ROE))}"; then
    alerts="${alerts}$coin: ${roe_pct}% (${upnl} USD)\n"
  fi
done <<< "$positions"

if [ -n "$alerts" ]; then
  msg="⚠️ ROE Alert\n${alerts}"
  send_alert "$msg"
  echo "$current_hash" > "$STAMP"
fi
