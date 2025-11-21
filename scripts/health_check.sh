#!/bin/bash
set -euo pipefail

BOT_DIR="/root/hyperliquid-hyperliquid-mm-complete"
BIAS_FILE="$BOT_DIR/runtime/nansen_bias.json"

echo "════════════════════════════════════════════════════"
echo "  HYPERLIQUID MM BOT - HEALTH CHECK"
echo "════════════════════════════════════════════════════"
echo ""

# 1. Bot status
echo "🤖 Bot Status:"
systemctl status mm-bot.service --no-pager | sed -n '1,8p'
echo ""

# 2. Nansen bias freshness
echo "🧭 Nansen Bias File:"
if [ -f "$BIAS_FILE" ]; then
  MTIME=$(stat -c %Y "$BIAS_FILE" 2>/dev/null || stat -f %m "$BIAS_FILE")
  AGE=$(( $(date +%s) - MTIME ))
  echo "   Age: $((AGE / 60)) minutes"
  if command -v jq >/dev/null 2>&1; then
    echo "   Signals: $(jq 'length' "$BIAS_FILE" 2>/dev/null || echo "N/A")"
  else
    echo "   (jq not installed, cannot count signals)"
  fi

  if [ $AGE -gt 7200 ]; then
    echo "   ⚠️  WARNING: Bias data older than 2h!"
  else
    echo "   ✅ Fresh data"
  fi
else
  echo "   ⚠️  Nansen bias file not found!"
fi
echo ""

# 3. Active positions
echo "📊 Active Positions:"
cd "$BOT_DIR"
if command -v npx >/dev/null 2>&1; then
  npx tsx scripts/check_positions.ts 2>/dev/null | head -20 || echo "Could not fetch positions"
else
  echo "npx not available"
fi
echo ""

# 4. Recent errors
echo "❌ Recent Errors (last 10):"
journalctl -u mm-bot.service --no-pager -p err -n 10 | tail -10 || echo "No recent errors"
echo ""

# 5. Key metrics from logs
echo "📈 Key Metrics (last 50 lines):"
journalctl -u mm-bot.service --no-pager -n 50 | grep -E "PNL|Active pairs|Rotation|🧹|🧭" | tail -10 || echo "No key metrics found"
echo ""

echo "════════════════════════════════════════════════════"
echo "Health check complete! $(date)"
echo "════════════════════════════════════════════════════"
