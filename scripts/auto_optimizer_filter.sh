#!/usr/bin/env bash
# Auto-Optimizer: Filter out trash tokens that generate sub-$10 notional orders

ROTATION_DENYLIST="${ROTATION_DENYLIST:-BOME,HMSTR}"
BASE_ORDER_USD="${BASE_ORDER_USD:-80}"
MIN_NOTIONAL_USD="${MIN_NOTIONAL_USD:-10}"
ROTATION_MIN_NOTIONAL_FACTOR="${ROTATION_MIN_NOTIONAL_FACTOR:-1.2}"

MIN_REQUIRED_NOTIONAL=$(echo "$MIN_NOTIONAL_USD * $ROTATION_MIN_NOTIONAL_FACTOR" | bc -l)

# Convert denylist to bash array
IFS="," read -ra DENY_ARRAY <<< "$ROTATION_DENYLIST"

while read -r PAIR; do
  [ -z "$PAIR" ] && continue
  
  # Check denylist
  IS_DENIED=0
  for DENIED_PAIR in "${DENY_ARRAY[@]}"; do
    if [ "$PAIR" = "$DENIED_PAIR" ]; then
      echo "[AUTO-OPT] Filtered $PAIR: on denylist" >&2
      IS_DENIED=1
      break
    fi
  done
  [ $IS_DENIED -eq 1 ] && continue
  
  # Get current price from Hyperliquid API
  PRICE=$(curl -s -X POST https://api.hyperliquid.xyz/info \
    -H "Content-Type: application/json" \
    -d "{\"type\": \"allMids\"}" \
    | jq -r ".[\"$PAIR\"] // 0" 2>/dev/null)
  
  # Fallback if API fails
  if [ -z "$PRICE" ] || [ "$PRICE" = "null" ] || [ "$PRICE" = "0" ]; then
    echo "[AUTO-OPT] Warning: Could not get price for $PAIR, ALLOWING it" >&2
    echo "$PAIR"
    continue
  fi
  
  # Calculate notional: BASE_ORDER_USD * price
  EST_NOTIONAL=$(echo "$BASE_ORDER_USD * $PRICE" | bc -l)
  
  # Check if notional meets minimum
  PASSES=$(echo "$EST_NOTIONAL >= $MIN_REQUIRED_NOTIONAL" | bc -l)
  
  if [ "$PASSES" -eq 1 ]; then
    echo "$PAIR"
  else
    echo "[AUTO-OPT] Filtered $PAIR: notional=$EST_NOTIONAL < required=$MIN_REQUIRED_NOTIONAL (price=$PRICE)" >&2
  fi
done
