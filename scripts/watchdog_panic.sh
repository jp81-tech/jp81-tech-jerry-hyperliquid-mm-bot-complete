#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete

LOG="runtime/watchdog.log"
touch "$LOG"

# Load PRIVATE_KEY from .env (if present)
if [ -f .env ]; then
  # shellcheck disable=SC2046
  export $(grep -E '^(PRIVATE_KEY|ACTIVE_PAIRS_DENYLIST)=' .env | xargs -d '\n' -I {} echo {})
fi

DENY_RAW="${ACTIVE_PAIRS_DENYLIST:-XPL,ASTER}"
DENY=$(echo "$DENY_RAW" | tr ',' '\n' | sed 's/[[:space:]]//g' | sort -u)

# Fetch positions via existing script (tolerate errors)
OUT=""
if command -v npx >/dev/null 2>&1; then
  OUT=$(PRIVATE_KEY="${PRIVATE_KEY:-}" npx tsx check-positions.ts 2>/dev/null || true)
fi

TS=$(date -Is)
TRIPPED=0

# Robust token boundary regex: start/end/space/pipe/colon/comma/semicolon
for p in $DENY; do
  if echo "$OUT" | grep -Eiq "(^|[[:space:]\|,:;])${p}([[:space:]\|,:;]|$)"; then
    echo "$TS  PANIC: Denylisted position open: $p" | tee -a "$LOG"
    TRIPPED=1
  fi
done

# If we couldn't read positions for some reason, also check quick runtime hints
# (optional; comment out if too noisy)
if [ $TRIPPED -eq 0 ] && [ -f bot.log ]; then
  if tail -200 bot.log | grep -Eiq "(XPL|ASTER)"; then
    echo "$TS  WARN: Deny token seen in bot.log (heuristic)" | tee -a "$LOG"
  fi
fi

if [ $TRIPPED -eq 1 ]; then
  echo "$TS  ACTION: Stopping bot (panic brake)" | tee -a "$LOG"
  ./stop-bot.sh || true
  exit 2
fi

echo "$TS  OK: No denylisted positions detected" >> "$LOG"
