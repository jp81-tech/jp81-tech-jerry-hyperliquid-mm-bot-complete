#!/usr/bin/env bash
set -eo pipefail
cd /root/hyperliquid-mm-bot-complete

LOCK="runtime/locks/pain_guard.lock"
[ -f "$LOCK" ] && exit 0
trap "rm -f $LOCK" EXIT
: > "$LOCK"

HOOK=$(grep -E "^(SLACK|DISCORD)_WEBHOOK_URL=" .env 2>/dev/null | head -1 | cut -d= -f2- || echo "")

HARD_CLOSE_ROE=-6.0
SOFT_GUARD_ROE=-4.0
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

positions=$(curl -s -H "Content-Type: application/json" -d "{\"type\":\"clearinghouseState\",\"user\":\"0xF4620F6fb51FA2fdF3464e0b5b8186D14bC902fe\"}" https://api.hyperliquid.xyz/info | jq -r ".assetPositions[] | select(.position.szi != \"0\") | \"\(.position.coin)|\(.position.szi)|\(.position.returnOnEquity)|\(.position.unrealizedPnl)|\(.position.positionValue)\"")

while IFS="|" read -r coin szi roe upnl notional; do
  [ -z "$coin" ] && continue
  roe_num=$(awk "BEGIN{print $roe * 100}")
  
  if awk "BEGIN{exit(!($roe_num < $HARD_CLOSE_ROE))}"; then
    echo "$(date -u +%FT%TZ) pain_guard HARD_CLOSE $coin ROE=${roe_num}% upnl=$upnl" >> runtime/pain_guard.log
    send_alert "🚨 HARD CLOSE $coin | ROE: ${roe_num}% | uPnL: $upnl"
  elif awk "BEGIN{exit(!($roe_num < $SOFT_GUARD_ROE))}"; then
    echo "$(date -u +%FT%TZ) pain_guard SOFT_GUARD $coin ROE=${roe_num}% upnl=$upnl" >> runtime/pain_guard.log
    send_alert "⚠️ SOFT GUARD $coin | ROE: ${roe_num}% | uPnL: $upnl"
  elif awk "BEGIN{exit(!($roe_num < $ALERT_ROE))}"; then
    echo "$(date -u +%FT%TZ) pain_guard ALERT $coin ROE=${roe_num}% upnl=$upnl" >> runtime/pain_guard.log
  fi
done <<< "$positions"
