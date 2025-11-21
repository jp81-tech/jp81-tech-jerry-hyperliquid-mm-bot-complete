#\!/usr/bin/env bash
#
# check_bot_alive.sh - Check if bot is alive and submitting orders
# Returns: 0 if OK, 1 if dead/hung
#

set -euo pipefail

BOT_LOG="/root/hyperliquid-hyperliquid-mm-complete/bot.log"
MAX_AGE_SECONDS=300  # 5 minutes

# 1. Check if process exists
if \! pgrep -f "mm_hl.ts" > /dev/null; then
    echo "DEAD: No mm_hl.ts process found"
    exit 1
fi

# 2. Check last submit timestamp
if [ \! -f "$BOT_LOG" ]; then
    echo "ERROR: bot.log not found"
    exit 1
fi

LAST_SUBMIT_LINE=$(grep "quant_evt=submit" "$BOT_LOG" | tail -1 || echo "")
if [ -z "$LAST_SUBMIT_LINE" ]; then
    echo "HUNG: No quant_evt=submit found in log"
    exit 1
fi

# Extract timestamp (format: 2025-11-11T09:36:13.123Z)
LAST_TS=$(echo "$LAST_SUBMIT_LINE" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' || echo "")
if [ -z "$LAST_TS" ]; then
    echo "ERROR: Could not parse timestamp from last submit"
    exit 1
fi

# Convert to epoch (remove timezone for simplicity - assumes UTC)
LAST_EPOCH=$(date -u -d "$LAST_TS" +%s 2>/dev/null || echo "0")
NOW_EPOCH=$(date -u +%s)
AGE_SECONDS=$((NOW_EPOCH - LAST_EPOCH))

if [ "$AGE_SECONDS" -gt "$MAX_AGE_SECONDS" ]; then
    echo "HUNG: Last submit was $AGE_SECONDS seconds ago (max: $MAX_AGE_SECONDS)"
    echo "      Last submit: $LAST_TS"
    exit 1
fi

echo "OK: Last submit $AGE_SECONDS seconds ago ($LAST_TS)"
exit 0
