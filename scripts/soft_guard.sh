#!/usr/bin/env bash
set -eo pipefail
cd /root/hyperliquid-mm-bot-complete

PCT(){ awk -v v="$1" 'BEGIN{printf "%.2f", v*100}' ; }
NUM(){ awk "BEGIN{exit(!(\$1+0==\$1))}" <<< "$1" >/dev/null 2>&1 ; }

HOOK=$(grep -E "^(SLACK|DISCORD)_WEBHOOK_URL=" .env 2>/dev/null | head -1 | cut -d= -f2- || echo "")

STATE="runtime/soft_guard_state.json"
[ -f "$STATE" ] || echo '{"pairs":{}}' > "$STATE"

BEGIN_MARK="# SOFT_GUARD_BEGIN"
END_MARK="# SOFT_GUARD_END"

WARN_ROE="-3"
PANIC_ROE="-7"
MIN_NOTIONAL="100"
COOLDOWN_MIN="20"
RECOVERY_MIN="30"

json=$(curl -s -H "Content-Type: application/json" -d '{"type":"clearinghouseState","user":"0xF4620F6fb51FA2fdF3464e0b5b8186D14bC902fe"}' https://api.hyperliquid.xyz/info || true)
if [ -z "$json" ] || ! jq -e . >/dev/null 2>&1 <<< "$json"; then exit 0; fi

positions=$(jq -r '.assetPositions[] | select(.position.szi != "0") | [.position.coin, (.position.positionValue|tonumber), (.position.returnOnEquity|tonumber)] | @tsv' <<< "$json" || true)

now_ts=$(date -u +%s)
changed=0
affected=()

while IFS=$'\t' read -r coin notional roe; do
  [ -z "${coin:-}" ] && continue
  NUM "$notional" || continue
  NUM "$roe" || continue
  n_int=$(awk -v n="$notional" 'BEGIN{printf "%.0f", n}')
  [ "$n_int" -lt "$MIN_NOTIONAL" ] && continue

  roe_pct=$(PCT "$roe")
  is_panic=$(awk -v r="$roe_pct" -v p="$PANIC_ROE" 'BEGIN{print (r+0<p+0)?1:0}')
  is_warn=$(awk -v r="$roe_pct" -v w="$WARN_ROE" 'BEGIN{print (r+0<w+0)?1:0}')

  last_ts=$(jq -r --arg c "$coin" '.pairs[$c].ts // 0' "$STATE")
  stage=$(jq -r --arg c "$coin" '.pairs[$c].stage // "CLEAR"' "$STATE")
  cooldown_ok=1
  [ "$last_ts" -gt 0 ] && diff=$((now_ts - last_ts)) || diff=999999
  [ "$diff" -ge $((COOLDOWN_MIN*60)) ] || cooldown_ok=0

  target_stage="CLEAR"
  if [ "$is_panic" -eq 1 ]; then target_stage="PANIC"
  elif [ "$is_warn" -eq 1 ]; then target_stage="WARN"
  else target_stage="CLEAR"
  fi

  if [ "$target_stage" != "$stage" ] && [ "$cooldown_ok" -eq 1 ]; then
    pairs_json=$(jq --arg c "$coin" --arg s "$target_stage" --arg ts "$now_ts" '.pairs[$c]={stage:$s|tostring,ts:($ts|tonumber)}' "$STATE")
    echo "$pairs_json" > "$STATE"
    changed=1
    affected+=("$coin:$stage->$target_stage:$roe_pct%:$n_int USD")
  fi
done <<< "$positions"

# Auto-recovery: remove block if all pairs CLEAR for RECOVERY_MIN
active_pairs=$(jq -r '.pairs | to_entries[] | select(.value.stage!="CLEAR") | .key' "$STATE" || echo "")
oldest_clear=$(jq -r '[.pairs | to_entries[] | select(.value.stage=="CLEAR") | .value.ts] | min // 0' "$STATE")
all_clear=0
if [ -z "$active_pairs" ] && [ "$oldest_clear" -gt 0 ]; then
  clear_age=$((now_ts - oldest_clear))
  if [ "$clear_age" -ge $((RECOVERY_MIN*60)) ]; then
    all_clear=1
  fi
fi

if [ "$all_clear" -eq 1 ]; then
  # Remove SOFT_GUARD block from .env
  tmp_env="$(mktemp)"
  if grep -q "$BEGIN_MARK" .env 2>/dev/null; then
    awk -v b="$BEGIN_MARK" -v e="$END_MARK" '
      BEGIN{skip=0}
      $0~b{skip=1; next}
      $0~e{skip=0; next}
      skip==0{print}
    ' .env > "$tmp_env"
    mv "$tmp_env" .env
    cp .env src/.env
    pm2 reload hyperliquid-mm >/dev/null 2>&1 || true
    
    [ -n "$HOOK" ] && {
      msg="✅ SOFT GUARD AUTO-RECOVERY - All pairs clear for ${RECOVERY_MIN}min, removing restrictions"
      if [[ "$HOOK" == *"discord"* ]]; then
        curl -s -X POST -H "Content-Type: application/json" -d "{\"content\":\"${msg}\"}" "$HOOK" >/dev/null
      else
        curl -s -X POST -H "Content-Type: application/json" -d "{\"text\":\"${msg}\"}" "$HOOK" >/dev/null
      fi
    }
    echo "soft_guard ts=$(date -u +%FT%TZ) auto_recovery=1"
    exit 0
  fi
fi

if [ "$changed" -eq 0 ]; then
  exit 0
fi

# Apply restrictions
tmp_env="$(mktemp)"
has_block=0
if grep -q "$BEGIN_MARK" .env 2>/dev/null; then has_block=1; fi
if [ "$has_block" -eq 1 ]; then
  awk -v b="$BEGIN_MARK" -v e="$END_MARK" '
    BEGIN{skip=0}
    $0~b{skip=1; next}
    $0~e{skip=0; next}
    skip==0{print}
  ' .env > "$tmp_env"
else
  cp .env "$tmp_env"
fi

{
  echo "$BEGIN_MARK"
  echo "INV_SKEW_K=0.7"
  echo "CLIP_USD=20"
  echo "MIN_L1_SPREAD_BPS=9"
  pairs_list=$(jq -r '.pairs | to_entries[] | select(.value.stage!="CLEAR") | .key' "$STATE")
  while read -r p; do
    [ -z "$p" ] && continue
    line="PAIR_MAX_NOTIONAL_USD_${p}=200"
    echo "$line"
  done <<< "$pairs_list"
  echo "$END_MARK"
} >> "$tmp_env"

mv "$tmp_env" .env
cp .env src/.env
pm2 reload hyperliquid-mm >/dev/null 2>&1 || true

if [ -n "$HOOK" ] && [ "${#affected[@]}" -gt 0 ]; then
  msg="🧯 SOFT GUARD
"
  for a in "${affected[@]}"; do msg="$msg• $a
"; done
  if [[ "$HOOK" == *"discord"* ]]; then
    curl -s -X POST -H "Content-Type: application/json" -d "{\"content\":\"${msg}\"}" "$HOOK" >/dev/null
  else
    curl -s -X POST -H "Content-Type: application/json" -d "{\"text\":\"${msg}\"}" "$HOOK" >/dev/null
  fi
fi

echo "soft_guard ts=$(date -u +%FT%TZ) changed=$changed affected=${#affected[@]}"
