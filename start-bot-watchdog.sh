#!/bin/bash
set -euo pipefail

cd /root/hyperliquid-mm-bot-complete

echo "🛑 Stopping existing bots..."
pkill -9 -f 'mm_hl.ts' 2>/dev/null || true
sleep 2

echo "🐕 Starting bot with watchdog (auto-restart)..."

while true; do
  echo "[Tue Nov 11 15:07:11 CET 2025] 🚀 Starting bot..."
  
  # Run bot and capture exit code
  TS_NODE_TRANSPILE_ONLY=1   node --trace-uncaught -r dotenv/config --loader ts-node/esm src/mm_hl.ts >> bot.log 2>&1
  
  EXIT_CODE=$?
  echo "[Tue Nov 11 15:07:11 CET 2025] ❌ Bot exited with code $EXIT_CODE. Restarting in 5s..." | tee -a bot.log
  
  # Save crash log
  tail -200 bot.log > crash_$(date +%Y%m%d_%H%M%S).log
  
  sleep 5
done
