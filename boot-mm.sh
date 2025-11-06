#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Single-instance lock
exec 9>/var/run/hyperliquid-mm.lock
if ! flock -n 9; then
  echo "Another hyperliquid-mm instance is running. Abort."
  exit 1
fi

# Kill rogue procs BEFORE start (nie zabijaj siebie)
pgrep -af 'tsx .*mm_hl\.ts|node .*mm_hl\.ts|boot-mm\.sh' | grep -v $$ | awk '{print $1}' | xargs -r kill -9 || true

# Honor KILL_SWITCH
if [ -f runtime/KILL_SWITCH ] && grep -qx '1' runtime/KILL_SWITCH; then
  echo "KILL_SWITCH=1 — refusing to start."
  exit 1
fi

# Opcjonalne: dźwignia na starcie (nie blokuje)
if command -v npx >/dev/null 2>&1; then
  npx tsx scripts/apply_leverage_on_boot.ts || true
fi

# Start bota
exec npx tsx src/mm_hl.ts
