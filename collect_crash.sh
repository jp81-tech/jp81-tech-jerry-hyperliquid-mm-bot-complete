#!/usr/bin/env bash
#
# collect_crash.sh - Manual crash data collection script
# Usage: ./collect_crash.sh ["optional description"]
#

set -euo pipefail

CRASH_TS=$(date +%Y%m%d_%H%M%S)
CRASH_LOG="crash_${CRASH_TS}.log"
BOT_LOG="bot.log"
TIMELINE="crash_timeline.txt"
DESCRIPTION="${1:-Manual crash collection}"

echo "═══════════════════════════════════════════════════════════════════"
echo "🔍 Collecting crash data at $(date)"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

# 1. Check process status
echo "1️⃣ Checking process status..."
PS_OUTPUT=$(ps aux | grep -E 'mm_hl.ts|npm start' | grep -v grep || echo "NO_PROCESS")
if [ "$PS_OUTPUT" = "NO_PROCESS" ]; then
    PROCESS_STATUS="❌ DEAD (no process found)"
    PROCESS_PID="none"
else
    PROCESS_STATUS="✅ ALIVE"
    PROCESS_PID=$(echo "$PS_OUTPUT" | awk '{print $2}' | head -1)
fi
echo "   Status: $PROCESS_STATUS"
echo "   PID: $PROCESS_PID"
echo ""

# 2. Save last 200 lines of bot.log
echo "2️⃣ Saving last 200 lines of bot.log..."
if [ -f "$BOT_LOG" ]; then
    tail -200 "$BOT_LOG" > "$CRASH_LOG"
    echo "   Saved to: $CRASH_LOG"
else
    echo "   ⚠️  bot.log not found!"
    CRASH_LOG="none"
fi
echo ""

# 3. Extract key information from logs
echo "3️⃣ Analyzing log data..."
if [ -f "$BOT_LOG" ]; then
    LAST_TS=$(tail -100 "$BOT_LOG" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' | tail -1 || echo "unknown")
    LAST_ATTEMPT=$(tail -100 "$BOT_LOG" | grep 'quant_evt=attempt' | tail -5 | awk -F'seq=' '{print $2}' | awk '{print $1}' | xargs || echo "none")
    LAST_SUBMIT=$(tail -100 "$BOT_LOG" | grep 'quant_evt=submit' | tail -5 | awk -F'seq=' '{print $2}' | awk '{print $1}' | xargs || echo "none")
    ERROR_COUNT=$(tail -200 "$BOT_LOG" | grep -i 'error\|exception\|uncaught\|unhandled' | wc -l | awk '{print $1}')
else
    LAST_TS="unknown"
    LAST_ATTEMPT="unknown"
    LAST_SUBMIT="unknown"
    ERROR_COUNT="0"
fi

echo "   Last timestamp: $LAST_TS"
echo "   Last attempt seq: $LAST_ATTEMPT"
echo "   Last submit seq: $LAST_SUBMIT"
echo "   Error messages: $ERROR_COUNT"
echo ""

# 4. Count open orders (if possible)
echo "4️⃣ Checking open orders..."
OPEN_ORDERS=$(npx tsx scripts/check-all-orders.ts 2>/dev/null | grep -E '^[A-Z]+' | wc -l | awk '{print $1}' || echo "unknown")
echo "   Open orders count: $OPEN_ORDERS"
echo ""

# 5. Generate diagnosis
echo "5️⃣ Generating diagnosis..."
if [ "$PROCESS_STATUS" = "❌ DEAD (no process found)" ]; then
    if [ "$ERROR_COUNT" -gt 0 ]; then
        DIAGNOSIS="Process died with errors in log (count: $ERROR_COUNT)"
    else
        DIAGNOSIS="Silent crash - process died without error logs"
    fi
else
    if [ "$LAST_ATTEMPT" != "none" ] && [ "$LAST_SUBMIT" = "none" ]; then
        DIAGNOSIS="Process alive but hung - attempt without submit"
    else
        DIAGNOSIS="Process alive and apparently working (manual check requested)"
    fi
fi
echo "   Diagnosis: $DIAGNOSIS"
echo ""

# 6. Append to crash_timeline.txt
echo "6️⃣ Appending to crash timeline..."
cat >> "$TIMELINE" << EOFTIMELINE

────────────────────────────────────────────────────────────────────
Crash data collected: $(date)
────────────────────────────────────────────────────────────────────

1. Process status
   $PROCESS_STATUS
   PID: $PROCESS_PID

2. Last log timestamp
   $LAST_TS

3. Last quant_evt=attempt
   seq=$LAST_ATTEMPT

4. Last quant_evt=submit
   seq=$LAST_SUBMIT

5. Open orders at check time
   $OPEN_ORDERS orders

6. Error messages in log
   Count: $ERROR_COUNT

7. Diagnosis
   $DIAGNOSIS

8. User description
   $DESCRIPTION

9. Crash log saved
   $CRASH_LOG

EOFTIMELINE

echo "   Added entry to: $TIMELINE"
echo ""

echo "═══════════════════════════════════════════════════════════════════"
echo "✅ Crash data collection complete!"
echo "═══════════════════════════════════════════════════════════════════"
echo ""
echo "📄 Files created:"
echo "   - $CRASH_LOG"
echo "   - Updated: $TIMELINE"
echo ""
echo "📋 Next steps:"
echo "   1. Review crash log: tail -50 $CRASH_LOG"
echo "   2. Review timeline: tail -80 $TIMELINE"
if [ "$PROCESS_STATUS" = "❌ DEAD (no process found)" ]; then
    echo "   3. Restart bot: ./start-bot.sh"
fi
echo ""
