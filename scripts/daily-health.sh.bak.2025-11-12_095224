#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Daily Health Check - $(date) ==="
echo ""

echo "1. E_TICK Error Count:"
TOTAL_ETICK=$(grep -c 'err_code=E_TICK' bot.log || echo 0)
echo "   Total (historical): $TOTAL_ETICK"

# Find most recent restart
RESTART_LINE=$(grep -n '🛑 Stopping all bot processes' bot.log | tail -1 | cut -d: -f1 || echo 0)
if [ "$RESTART_LINE" -gt 0 ]; then
  SINCE_RESTART=$(tail -n +$RESTART_LINE bot.log | grep -c 'err_code=E_TICK' || echo 0)
  echo "   Since last restart: $SINCE_RESTART"
else
  echo "   Since last restart: Unable to determine"
fi

echo ""
echo "2. Spec Override Status:"
npx tsx scripts/preflight_overrides.ts 2>&1 | grep -E '(override_check|override_check_result)'

echo ""
echo "3. Bot Process:"
if ps aux | grep 'node.*mm_hl' | grep -v grep > /dev/null; then
  ps aux | grep 'node.*mm_hl' | grep -v grep | awk '{print "   PID: " $2 " | Memory: " $6/1024 " MB | CPU: " $3 "%"}'
else
  echo "   ❌ Bot not running"
fi

echo ""
echo "4. Recent Quantization (last 10 attempts):"
tail -100 bot.log | grep 'quant_evt=attempt' | tail -10 | awk -F'pair=' '{print "   " $0}'

echo ""
echo "5. Active Pairs:"
tail -50 bot.log | grep 'quant_evt=attempt' | awk -F'pair=' '{print $2}' | awk '{print $1}' | sort -u | awk '{print "   " $0}'

echo ""
echo "=== Health Check Complete ==="
