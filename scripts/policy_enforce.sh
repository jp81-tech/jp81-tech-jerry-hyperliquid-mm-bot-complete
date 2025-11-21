#!/usr/bin/env bash
set -euo pipefail

EFFECTIVE_FILE="runtime/effective_active_pairs.json"
CURRENT_FILE="runtime/active_pairs.json"

echo "Effective:"
jq -r ".pairs[]" "$EFFECTIVE_FILE" 2>/dev/null || echo "(none)"

echo
echo "Current:"
jq -r ".[]" "$CURRENT_FILE" 2>/dev/null | sort -u || echo "(none)"

EFFECTIVE_SET=$(jq -r ".pairs[]" "$EFFECTIVE_FILE" 2>/dev/null | xargs echo)
CURRENT_SET=$(jq -r ".[]" "$CURRENT_FILE" 2>/dev/null | xargs echo)

TO_CLOSE=""
for c in $CURRENT_SET; do
  if ! echo "$EFFECTIVE_SET" | grep -qw "$c"; then
    TO_CLOSE="$TO_CLOSE $c"
  fi
done

echo
echo "To close:"
echo "$TO_CLOSE" | xargs -n1 echo 2>/dev/null || echo "(none)"

for coin in $TO_CLOSE; do
  echo "[${coin}] Checking position..."
  npx tsx scripts/force-close.ts "$coin" || true
done

# Clear px0 markers before seeding
SEED_SET=$(jq -r ".pairs[]" "$EFFECTIVE_FILE" | xargs echo)
for c in $SEED_SET; do
  rm -f "runtime/.px0_${c}" 2>/dev/null || true
done

# ═══════════════════════════════════════════════════════════════
# ZEC NIGHT MODE - Asymmetric Sell-Bias Configuration
# ═══════════════════════════════════════════════════════════════
export ZEC_NIGHT_MODE="${ZEC_NIGHT_MODE:-true}"

if [ "$ZEC_NIGHT_MODE" = "true" ] && echo "$SEED_SET" | grep -qw "ZEC"; then
  echo
  echo "🌙 ZEC NIGHT MODE ACTIVE - Asymmetric spreads (sell-bias)"
  
  # Store original .env for restoration
  cp -f .env .env.backup_zec 2>/dev/null || true
  
  # ZEC-specific overrides (append to .env temporarily)
  cat >> .env << "EOFZEC"

# ═══ ZEC NIGHT MODE OVERRIDES (temporary) ═══
BASE_ORDER_USD_ZEC=150
MAX_POSITION_USD_ZEC=1200
MAKER_SPREAD_BPS_ZEC_ASK=10
MAKER_SPREAD_BPS_ZEC_BID=35
ENABLE_POST_ONLY_ZEC_ASK=true
ENABLE_POST_ONLY_ZEC_BID=false
TAKER_REDUCE_ONLY_ZEC=true
MAX_SLIPPAGE_BPS_ZEC=35
BUY_THROTTLE_BPS_ZEC=50
EOFZEC
  
  echo "  ├─ BASE_ORDER: \$150 (larger clips)"
  echo "  ├─ MAX_POSITION: \$1,200 (capped for night)"
  echo "  ├─ ASK spread: 10 bps (tight for exits)"
  echo "  ├─ BID spread: 35 bps (wide, avoid catching pumps)"
  echo "  ├─ POST_ONLY: ASK=yes, BID=no (allow taker reduce)"
  echo "  └─ TAKER_REDUCE_ONLY: enabled (emergency exit)"
fi

echo
echo "Seeding SELL for effective pairs:"
if [ -n "$SEED_SET" ]; then
  npx tsx scripts/seed-sell-safe.ts 2>&1 | tee /tmp/seed.log
  
  # Create px0 markers for failed coins
  grep -E "\[.+\] (skip: no mid after fallback|fail: size<=0)" /tmp/seed.log 2>/dev/null | while read -r line; do
    coin=$(echo "$line" | sed -n "s/^\[\([^]]*\)\].*/\1/p")
    if [ -n "$coin" ]; then
      touch "runtime/.px0_${coin}"
      echo "Created px0 marker for $coin"
    fi
  done || true
else
  echo "No pairs to seed"
fi

# Restore original .env if ZEC mode was active
if [ "$ZEC_NIGHT_MODE" = "true" ] && [ -f .env.backup_zec ]; then
  mv -f .env.backup_zec .env
fi

echo "Done"
