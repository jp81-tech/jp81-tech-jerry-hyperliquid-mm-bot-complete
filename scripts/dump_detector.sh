#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete
LOCK="runtime/locks/mode.lock"
[ -f "$LOCK" ] && exit 0
trap "rm -f $LOCK" EXIT
: > "$LOCK"
HOOK=""
[ -n "${SLACK_WEBHOOK_URL:-}" ] && HOOK="$SLACK_WEBHOOK_URL"
[ -z "$HOOK" ] && [ -n "${DISCORD_WEBHOOK_URL:-}" ] && HOOK="$DISCORD_WEBHOOK_URL"
DSTATE="runtime/dump_state.json"
[ -f "$DSTATE" ] || echo "{\"mode\":\"STABLE\",\"since\":\"$(date -u +%FT%TZ)\"}" > "$DSTATE"
valid_num(){ awk "BEGIN{exit(!(\$1+0==\$1))}" <<< "$1" >/dev/null 2>&1; }
btc_change=$(curl -s --max-time 6 -H "Content-Type: application/json" \
  -d "{\"type\":\"candleSnapshot\",\"req\":{\"coin\":\"BTC\",\"interval\":\"1h\",\"startTime\":0,\"endTime\":9999999999999}}" \
  https://api.hyperliquid.xyz/info \
  | jq -r ".[-2:] | select(length==2) | if ((.[0].c|type)==\"number\" and (.[1].c|type)==\"number\" and (.[0].c>0)) then ((.[1].c-.[0].c)/.[0].c*100) else \"invalid\" end" 2>/dev/null || echo invalid)
stats="reports/rotator_stats.json"
[ -f "$stats" ] || echo "[]" > "$stats"
vol_surge=$(jq -r ". as \$s | ( [ \$s[] | select(.vol_24h>0) | (.vol_1h / (.vol_24h/24)) ] | if length>0 then (add/length) else 0 end )" "$stats" 2>/dev/null || echo 0)
red_ratio=$(jq -r ". as \$s | ( [ \$s[] | select(has(\"price_change_1h\")) | select(.price_change_1h<0) ] | length ) as \$r | ( (length) as \$t | if \$t>0 then (\$r*100/\$t) else 0 end )" "$stats" 2>/dev/null || echo 0)
alo=$(pm2 logs hyperliquid-mm --lines 200 --nostream 2>/dev/null | grep -Ei "post only|would have immediately" | wc -l | tr -d " ")
valid=1
valid_num "$alo" || valid=0
valid_num "$vol_surge" || valid=0
valid_num "$red_ratio" || valid=0
valid_num "$btc_change" || valid=0
[ "$valid" -eq 1 ] || exit 0
awk "BEGIN{exit(!($btc_change==0))}" && exit 0
curr=$(jq -r .mode "$DSTATE" 2>/dev/null || echo "STABLE")
to_def=0; to_shel=0
awk "BEGIN{exit(!($btc_change < -4.0))}" && awk "BEGIN{exit(!($vol_surge > 2.5))}" && awk "BEGIN{exit(!($red_ratio >= 75))}" && to_shel=1
if [ "$to_shel" -ne 1 ]; then
  awk "BEGIN{exit(!($btc_change < -2.5))}" && awk "BEGIN{exit(!($vol_surge > 1.8))}" && awk "BEGIN{exit(!($red_ratio >= 60))}" && to_def=1
fi
next="$curr"
if [ "$to_shel" -eq 1 ]; then
  next="SHELTER"
elif [ "$to_def" -eq 1 ]; then
  next="DEFENSIVE"
else
  if [ "$curr" = "SHELTER" ]; then
    awk "BEGIN{exit(!($btc_change > -3.0 && $vol_surge < 2.0 && $red_ratio < 70))}" && next="DEFENSIVE"
  elif [ "$curr" = "DEFENSIVE" ]; then
    awk "BEGIN{exit(!($btc_change > -1.0 && $vol_surge < 1.4 && $red_ratio < 55))}" && next="STABLE"
  fi
fi
apply_mode(){
  m="$1"
  case "$m" in
    SHELTER)
      sed -i "s/^MIN_L1_SPREAD_BPS=.*/MIN_L1_SPREAD_BPS=12/" .env || true
      sed -i "s/^LAYER_OFFSETS_BPS=.*/LAYER_OFFSETS_BPS=70,110,160,220,290/" .env || true
      sed -i "s/^CLIP_USD=.*/CLIP_USD=15/" .env || true
      sed -i "s/^INV_SKEW_K=.*/INV_SKEW_K=0.5/" .env || true
      sed -i "s/^DRIFT_SKEW_BPS=.*/DRIFT_SKEW_BPS=2/" .env || grep -q "^DRIFT_SKEW_BPS=" .env || echo "DRIFT_SKEW_BPS=2" >> .env
      cp .env src/.env
      pm2 restart hyperliquid-mm --update-env
      npx tsx scripts/cancel_all_orders.ts 2>/dev/null || true
      ;;
    DEFENSIVE)
      sed -i "s/^MIN_L1_SPREAD_BPS=.*/MIN_L1_SPREAD_BPS=10/" .env || true
      sed -i "s/^LAYER_OFFSETS_BPS=.*/LAYER_OFFSETS_BPS=60,95,140,195,260/" .env || true
      sed -i "s/^CLIP_USD=.*/CLIP_USD=20/" .env || true
      sed -i "s/^INV_SKEW_K=.*/INV_SKEW_K=0.7/" .env || true
      sed -i "s/^DRIFT_SKEW_BPS=.*/DRIFT_SKEW_BPS=3/" .env || grep -q "^DRIFT_SKEW_BPS=" .env || echo "DRIFT_SKEW_BPS=3" >> .env
      cp .env src/.env
      pm2 restart hyperliquid-mm --update-env
      ;;
    STABLE)
      sed -i "s/^MIN_L1_SPREAD_BPS=.*/MIN_L1_SPREAD_BPS=8/" .env || true
      sed -i "s/^LAYER_OFFSETS_BPS=.*/LAYER_OFFSETS_BPS=50,80,120,165,220/" .env || true
      sed -i "s/^CLIP_USD=.*/CLIP_USD=25/" .env || true
      sed -i "s/^INV_SKEW_K=.*/INV_SKEW_K=0.9/" .env || true
      sed -i "s/^DRIFT_SKEW_BPS=.*/DRIFT_SKEW_BPS=7/" .env || grep -q "^DRIFT_SKEW_BPS=" .env || echo "DRIFT_SKEW_BPS=7" >> .env
      grep -q "^ACTIVE_LAYERS=" .env && sed -i "s/^ACTIVE_LAYERS=.*/ACTIVE_LAYERS=4/" .env || echo "ACTIVE_LAYERS=4" >> .env
      cp .env src/.env
      pm2 restart hyperliquid-mm --update-env
      ;;
  esac
}
changed=0
if [ "$next" != "$curr" ]; then
  apply_mode "$next"
  echo "{\"mode\":\"$next\",\"since\":\"$(date -u +%FT%TZ)\",\"btc_1h\":$btc_change,\"vol_surge\":$vol_surge,\"red_ratio\":$red_ratio,\"alo\":$alo}" > "$DSTATE"
  echo "$(date -u +%F\ %T)Z dump_change $curr->$next btc=$btc_change vol=$vol_surge red=$red_ratio alo=$alo" >> runtime/mode_changes.log
  changed=1
fi
if [ "$changed" -eq 1 ] && [ -n "$HOOK" ]; then
  emoji="🛡️"; [ "$next" = "DEFENSIVE" ] && emoji="🔰"
  msg="$emoji DUMP MODE: $curr → $next\nBTC 1h: ${btc_change}%\nVol surge: ${vol_surge}x\nRed ratio: ${red_ratio}%\nALO: ${alo}/200"
  if [[ "$HOOK" == *"discord"* ]]; then
    curl -s -X POST -H "Content-Type: application/json" -d "{\"content\":\"$msg\"}" "$HOOK" >/dev/null
  else
    curl -s -X POST -H "Content-Type: application/json" -d "{\"text\":\"$msg\"}" "$HOOK" >/dev/null
  fi
fi
