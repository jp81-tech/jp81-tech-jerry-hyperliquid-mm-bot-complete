#!/usr/bin/env bash
set -e
cd /root/hyperliquid-mm-bot-complete

LOCKFILE=runtime/mode_mutex.lock
exec 8>"$LOCKFILE"
flock -n 8 || exit 0

# Check if dump mode is active
DUMP_MODE=$(jq -r ".mode" runtime/dump_state.json 2>/dev/null || echo "STABLE")
if [ "$DUMP_MODE" != "STABLE" ]; then
  # Dump has priority - exit without bounceecho "bounce_skip: dump_mode_active ($DUMP_MODE)"
  flock -u 8
  exit 0
fi

STATE_FILE=runtime/bounce_state.json
if [ ! -f "$STATE_FILE" ]; then
  echo "{\"mode\":\"STABLE\",\"since\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"changes\":[]}" > "$STATE_FILE"
fi

CURRENT_MODE=$(jq -r ".mode" "$STATE_FILE" 2>/dev/null || echo "STABLE")

BTC_CHANGE=$(curl -s "https://api.hyperliquid.xyz/info" -X POST -H "Content-Type: application/json" \
  -d '{"type":"candleSnapshot","req":{"coin":"BTC","interval":"1h","startTime":0,"endTime":9999999999999}}' \
  | jq -r 'if length >= 2 then .[-2].c as $prev | .[-1].c as $curr | (($curr - $prev) / $prev * 100) else 0 end' 2>/dev/null || echo 0)

VOL_SURGE=0
if [ -f "reports/rotator_stats.json" ]; then
  VOL_SURGE=$(jq '[.[] | select(.vol_24h > 0) | (.vol_1h / (.vol_24h / 24))] | add / length' reports/rotator_stats.json 2>/dev/null || echo 0)
fi

GREEN_RATIO=0
if [ -f "reports/rotator_stats.json" ]; then
  GREEN_CNT=$(jq '[.[] | select(.price_change_1h > 0)] | length' reports/rotator_stats.json 2>/dev/null || echo 0)
  TOTAL_CNT=$(jq 'length' reports/rotator_stats.json 2>/dev/null || echo 1)
  GREEN_RATIO=$(echo "scale=2; $GREEN_CNT * 100 / $TOTAL_CNT" | bc 2>/dev/null || echo 0)
fi

ALO_CNT=$(pm2 logs hyperliquid-mm --lines 200 --nostream 2>&1 | grep -Ei "post only|would have immediately" | wc -l | tr -d " ")

NEW_MODE="$CURRENT_MODE"

# Aggressive bounce
if (( $(echo "$BTC_CHANGE > 4.0" | bc -l 2>/dev/null || echo 0) )) && \
   (( $(echo "$VOL_SURGE > 2.5" | bc -l 2>/dev/null || echo 0) )) && \
   (( $(echo "$GREEN_RATIO > 75" | bc -l 2>/dev/null || echo 0) )) && \
   (( ALO_CNT < 10 )); then
  NEW_MODE="AGGRESSIVE_BOUNCE"
# Moderate bounce
elif (( $(echo "$BTC_CHANGE > 2.5" | bc -l 2>/dev/null || echo 0) )) && \
     (( $(echo "$VOL_SURGE > 1.8" | bc -l 2>/dev/null || echo 0) )) && \
     (( $(echo "$GREEN_RATIO > 60" | bc -l 2>/dev/null || echo 0) )) && \
     (( ALO_CNT < 20 )); then
  NEW_MODE="MODERATE_BOUNCE"
# Return to stable
elif [[ "$CURRENT_MODE" =~ BOUNCE ]] && \
     (($(echo "$BTC_CHANGE < 1.0" | bc -l 2>/dev/null || echo 0))) || \
     (($(echo "$VOL_SURGE < 1.2" | bc -l 2>/dev/null || echo 0))) || \
     ((ALO_CNT > 40)); then
  NEW_MODE="STABLE"
fi

if [ "$NEW_MODE" != "$CURRENT_MODE" ]; then
  TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  
  case "$NEW_MODE" in
    AGGRESSIVE_BOUNCE)
      sed -i "s/^MIN_L1_SPREAD_BPS=.*/MIN_L1_SPREAD_BPS=5/" .env
      sed -i "s/^LAYER_OFFSETS_BPS=.*/LAYER_OFFSETS_BPS=30,50,75,105,145/" .env
      sed -i "s/^CLIP_USD=.*/CLIP_USD=40/" .env
      sed -i "s/^INV_SKEW_K=.*/INV_SKEW_K=1.4/" .env
      sed -i "s/^DRIFT_SKEW_BPS=.*/DRIFT_SKEW_BPS=15/" .env
      grep -q "^ACTIVE_LAYERS=" .env && sed -i "s/^ACTIVE_LAYERS=.*/ACTIVE_LAYERS=5/" .env || echo "ACTIVE_LAYERS=5" >> .env
      MSG="🚀 BOUNCE MANAGER: ${CURRENT_MODE}→AGGRESSIVE_BOUNCE
BTC: ${BTC_CHANGE}% | Vol: ${VOL_SURGE}x | Green: ${GREEN_RATIO}% | ALO: ${ALO_CNT}
Applied: Tight 5bps, close offsets, clip 40, long bias 1.4, 5 layers"
      ;;
    MODERATE_BOUNCE)
      sed -i "s/^MIN_L1_SPREAD_BPS=.*/MIN_L1_SPREAD_BPS=6/" .env
      sed -i "s/^LAYER_OFFSETS_BPS=.*/LAYER_OFFSETS_BPS=40,65,100,140,190/" .env
      sed -i "s/^CLIP_USD=.*/CLIP_USD=30/" .env
      sed -i "s/^INV_SKEW_K=.*/INV_SKEW_K=1.1/" .env
      sed -i "s/^DRIFT_SKEW_BPS=.*/DRIFT_SKEW_BPS=10/" .env
      MSG="📈 BOUNCE MANAGER: ${CURRENT_MODE}→MODERATE_BOUNCE
BTC: ${BTC_CHANGE}% | Vol: ${VOL_SURGE}x | Green: ${GREEN_RATIO}% | ALO: ${ALO_CNT}
Applied: Spreads 6bps, moderate offsets, clip 30, long bias 1.1"
      ;;
    STABLE)
      sed -i "s/^MIN_L1_SPREAD_BPS=.*/MIN_L1_SPREAD_BPS=8/" .env
      sed -i "s/^LAYER_OFFSETS_BPS=.*/LAYER_OFFSETS_BPS=50,80,120,165,220/" .env
      sed -i "s/^CLIP_USD=.*/CLIP_USD=25/" .env
      sed -i "s/^INV_SKEW_K=.*/INV_SKEW_K=0.9/" .env
      sed -i "s/^DRIFT_SKEW_BPS=.*/DRIFT_SKEW_BPS=7/" .env
      grep -q "^ACTIVE_LAYERS=" .env && sed -i "s/^ACTIVE_LAYERS=.*/ACTIVE_LAYERS=4/" .env || echo "ACTIVE_LAYERS=4" >> .env
      MSG="⚪ BOUNCE MANAGER: ${CURRENT_MODE}→STABLE
Conditions faded - Returned to normal mode
BTC: ${BTC_CHANGE}% | Vol: ${VOL_SURGE}x"
      ;;
  esac
  
  cp .env src/.env
  pm2 restart hyperliquid-mm --update-env >/dev/null 2>&1
  
  jq ".mode = \"$NEW_MODE\" | .since = \"$TIMESTAMP\" | .changes += [{\"from\":\"$CURRENT_MODE\",\"to\":\"$NEW_MODE\",\"ts\":\"$TIMESTAMP\",\"btc\":$BTC_CHANGE,\"vol\":$VOL_SURGE,\"green\":$GREEN_RATIO,\"alo\":$ALO_CNT}]" "$STATE_FILE" > "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"
  
  echo "$TIMESTAMP BOUNCE ${CURRENT_MODE}->${NEW_MODE} btc=${BTC_CHANGE}% vol=${VOL_SURGE}x green=${GREEN_RATIO}% alo=${ALO_CNT}" >> runtime/mode_changes.log
  
  HOOK="${SLACK_WEBHOOK_URL:-${DISCORD_WEBHOOK_URL}}"
  if [ -n "$HOOK" ]; then
    if [[ "$HOOK" == *"discord"* ]]; then
      curl -s -X POST -H "Content-Type: application/json" -d "{\"content\":\"$MSG\"}" "$HOOK" >/dev/null
    else
      curl -s -X POST -H "Content-Type: application/json" -d "{\"text\":\"$MSG\"}" "$HOOK" >/dev/null
    fi
  fi
fi

flock -u 8
echo "bounce_check ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) mode=$NEW_MODE btc=$BTC_CHANGE vol=$VOL_SURGE green=$GREEN_RATIO alo=$ALO_CNT"
