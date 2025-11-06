#!/usr/bin/env bash
set -e
cd /root/hyperliquid-mm-bot-complete

HOOK=""
[ -n "${SLACK_WEBHOOK_URL:-}" ] && HOOK="$SLACK_WEBHOOK_URL"
[ -z "$HOOK" ] && [ -n "${DISCORD_WEBHOOK_URL:-}" ] && HOOK="$DISCORD_WEBHOOK_URL"

MODE_LOG="runtime/mode_changes.log"
[ -f "$MODE_LOG" ] || touch "$MODE_LOG"

since_ts=$(date -u -d '24 hours ago' +%s 2>/dev/null || echo $(($(date +%s) - 86400)))
LAST24=$(
  awk -v since="$since_ts" '{
    cmd="date -u -d \""$1" "$2"\" +%s 2>/dev/null"
    if ((cmd | getline ts) > 0) {
      close(cmd)
      if (ts > since) print
    }
  }' "$MODE_LOG"
)

ORDERS=$(npx tsx scripts/check-all-orders.ts 2>&1 | grep "Found" | awk '{print $3}' || echo 0)
PAIRS=$(cat runtime/active_pairs.json 2>/dev/null | jq -r ".pairs | join(\",\")" || echo "unknown")
ALO=$(pm2 logs hyperliquid-mm --lines 200 --nostream 2>/dev/null | grep -Ei "post only|would have immediately" | wc -l | tr -d " ")
SPREAD=$(grep -E "^MIN_L1_SPREAD_BPS=" .env | cut -d= -f2 | tr -d " " || echo "")
OFFSETS=$(grep -E "^LAYER_OFFSETS_BPS=" .env | cut -d= -f2 | tr -d " " || echo "")
CLIP=$(grep -E "^CLIP_USD=" .env | cut -d= -f2 | tr -d " " || echo "")
SKEW=$(grep -E "^INV_SKEW_K=" .env | cut -d= -f2 | tr -d " " || echo "")
LAYERS=$(grep -E "^ACTIVE_LAYERS=" .env | cut -d= -f2 | tr -d " " || echo "")
DUMP_MODE=$(jq -r .mode runtime/dump_state.json 2>/dev/null || echo "STABLE")
BOUNCE_MODE=$(jq -r .mode runtime/bounce_state.json 2>/dev/null || echo "STABLE")
POS=$(npx tsx scripts/check_positions.ts 2>&1 || echo "")

ROT=$(pm2 logs hyperliquid-mm --lines 200 --nostream 2>/dev/null | grep -E "rotation_evt=apply|rotation_evt=selected" | tail -10 || echo "")

SUMMARY_HEADER="📊 Mode Summary (last 24h)"
if [ -z "$LAST24" ]; then
  SUMMARY_BODY="$SUMMARY_HEADER: no changes detected."
else
  COUNT=$(printf "%s\n" "$LAST24" | wc -l | tr -d " ")
  SUMMARY_BODY="$SUMMARY_HEADER — ${COUNT} changes
\`\`\`
$LAST24
\`\`\`"
fi

REPORT="🕗 Daily Report $(date -u +%Y-%m-%d) 08:00Z
$SUMMARY_BODY

🔧 Params
Spreads: ${SPREAD} bps
Offsets: ${OFFSETS}
Clip: ${CLIP} USD
Skew: ${SKEW}
Layers: ${LAYERS}

🎛️ Modes
Dump: ${DUMP_MODE}
Bounce: ${BOUNCE_MODE}

📦 Runtime
Orders: ${ORDERS}
Active pairs: ${PAIRS}
ALO rejects/200: ${ALO}

💰 Positions
${POS}

🔄 Rotation (last 10)
${ROT}
"

if [ -n "$HOOK" ]; then
  if [[ "$HOOK" == *"discord"* ]]; then
    PAYLOAD=$(printf '%s' "$REPORT" | python3 -c 'import sys,json;print(json.dumps({"content":sys.stdin.read()}))' )
    curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$HOOK" >/dev/null
  else
    PAYLOAD=$(printf '%s' "$REPORT" | python3 -c 'import sys,json;print(json.dumps({"text":sys.stdin.read()}))' )
    curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$HOOK" >/dev/null
  fi
fi
