#!/bin/bash
# Quick verification that bot is in DRY_RUN mode

cd "$(dirname "$0")/.." || exit 1

echo "🔍 Verifying DRY_RUN mode..."
echo ""

# 1. Check .env
if [ -f .env ]; then
  DRY_RUN_ENV=$(grep "^DRY_RUN=" .env | cut -d'=' -f2)
  echo "📝 .env DRY_RUN=$DRY_RUN_ENV"
else
  echo "❌ .env file not found!"
  exit 1
fi

# 2. Check logs
if [ -f bot.log ]; then
  echo ""
  echo "📋 Last DRY_RUN/LIVE mode indicator in logs:"
  
  if grep -q "PAPER TRADING MODE" bot.log; then
    echo "✅ Found PAPER TRADING MODE:"
    grep "PAPER TRADING MODE" bot.log | tail -1
  fi
  
  if grep -q "LIVE TRADING MODE" bot.log; then
    echo "❌ WARNING: Found LIVE TRADING MODE:"
    grep "LIVE TRADING MODE" bot.log | tail -1
    echo ""
    echo "⚠️  Bot appears to be in LIVE mode, not DRY_RUN!"
    exit 1
  fi
else
  echo "⚠️  bot.log not found"
fi

# 3. Check systemd service
if systemctl list-units --type=service | grep -q "mm-bot.service"; then
  echo ""
  echo "📋 Systemd service status:"
  systemctl status mm-bot.service --no-pager | head -10
fi

# 4. Check recent activity
if [ -f bot.log ]; then
  echo ""
  echo "📊 Recent activity (last 5 lines):"
  tail -5 bot.log
fi

echo ""
if [ "$DRY_RUN_ENV" = "true" ] && grep -q "PAPER TRADING MODE" bot.log 2>/dev/null; then
  echo "✅ DRY_RUN mode confirmed!"
else
  echo "⚠️  Could not fully verify DRY_RUN mode"
fi

