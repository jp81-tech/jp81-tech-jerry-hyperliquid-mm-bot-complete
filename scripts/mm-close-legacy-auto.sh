#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete

# Get active pairs from confluence
ACTIVE=""
if [ -f runtime/active_pairs.json ]; then
  ACTIVE=$(jq -r '.pairs[]?' runtime/active_pairs.json 2>/dev/null | tr '\n' ',' | sed 's/,$//')
fi

# If no active_pairs.json, use current confluence pairs (hardcoded for now)
if [ -z "$ACTIVE" ]; then
  ACTIVE="ZEC,NEAR,XPL,FIL"
fi

# Build denylist = all positions EXCEPT active
ALL_POSITIONS=$(npx tsx scripts/check_positions.ts 2>&1 | grep ':' | awk '{print $1}' | tr -d ':' | tr '\n' ',' | sed 's/,$//')

# For now, just close known legacy: BOME, TURBO, HMSTR, kSHIB, UMA
DENYLIST="BOME,TURBO,HMSTR,kSHIB,UMA"

echo "$(date '+%Y-%m-%d %H:%M:%S') - Closing legacy positions: $DENYLIST (keeping: $ACTIVE)" >> runtime/legacy_close.log

VERBOSE=1 ACTIVE_PAIRS_DENYLIST="$DENYLIST" npx tsx scripts/auto_closer.ts >> runtime/legacy_close.log 2>&1 || echo "Failed to run auto_closer"
