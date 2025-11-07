#!/usr/bin/env bash
set -euo pipefail

ALLOW="${*:-}"
cd /root/hyperliquid-mm-bot-complete

ACTIVE=""
if [ -f runtime/active_pairs.json ]; then
  ACTIVE=$(jq -r '.pairs[]?' runtime/active_pairs.json 2>/dev/null | tr '\n' ' ')
fi
if [ -n "$ALLOW" ]; then
  ACTIVE="$ALLOW"
fi

MIN_PROFIT="${LEGACY_MIN_PROFIT_USD:-3}"
FUND_MIN="${FUNDING_CLOSE_IF_AGAINST_MIN:-10}"
FUND_BUF="${FUNDING_BUFFER_BPS:-0}"
STATE="runtime/funding_against_state.json"
TMP=$(mktemp)

JSON=$(npx tsx scripts/check_positions.ts 2>&1 | grep -E '^  [A-Z]' | awk '{gsub(/:/,"",$1); print $1,$2,$3}')
if [ -z "$JSON" ]; then
  echo "No positions found"
  exit 0
fi

if [ ! -f "$STATE" ]; then echo '{}' > "$STATE"; fi

TO_CLOSE=""
NOW=$(date -u +%s)

while read -r s side sz; do
  [ -z "$s" ] && continue
  if [ -n "$ACTIVE" ] && echo "$ACTIVE" | tr ' ' '\n' | grep -Fxq "$s"; then
    continue
  fi
  
  fundJson=$(npx tsx scripts/get_funding.ts "$s" 2>/dev/null || echo '{"fundingBps":0}')
  fbps=$(echo "$fundJson" | jq -r '.fundingBps // 0' | awk '{print $1+0}')
  against=0
  if [ "$side" = "LONG" ] && awk "BEGIN{exit !($fbps - $FUND_BUF > 0)}"; then against=1; fi
  if [ "$side" = "SHORT" ] && awk "BEGIN{exit !($fbps + $FUND_BUF < 0)}"; then against=1; fi

  prev=$(jq -r --arg S "$s" '.[$S].t // 0' "$STATE")
  accm=$(jq -r --arg S "$s" '.[$S].m // 0' "$STATE")

  if [ "$against" = "1" ]; then
    inc=2
    if [ "$prev" -gt 0 ]; then
      dt=$(( NOW - prev ))
      inc=$(( dt / 60 ))
      if [ "$inc" -lt 1 ]; then inc=1; fi
    fi
    newm=$(( accm + inc ))
    jq --arg S "$s" --argjson T "$NOW" --argjson M "$newm" '.[$S]={t:$T,m:$M}' "$STATE" > "$TMP" && mv "$TMP" "$STATE"
  else
    jq --arg S "$s" 'del(.[$S])' "$STATE" > "$TMP" && mv "$TMP" "$STATE"
  fi

  curm=$(jq -r --arg S "$s" '.[$S].m // 0' "$STATE")
  
  if [ "$against" = "1" ] && awk "BEGIN{exit !($curm >= $FUND_MIN)}"; then
    echo "Closing legacy (funding against for ${curm}min): $s"
    TO_CLOSE="$TO_CLOSE $s"
    continue
  fi
done <<< "$JSON"

if [ -z "$TO_CLOSE" ]; then
  echo "No legacy positions to close."
  exit 0
fi

for s in $TO_CLOSE; do
  npx tsx scripts/close_position.ts "$s" 2>&1 || echo "Failed to close $s"
  jq --arg S "$s" 'del(.[$S])' "$STATE" > "$TMP" && mv "$TMP" "$STATE"
done
