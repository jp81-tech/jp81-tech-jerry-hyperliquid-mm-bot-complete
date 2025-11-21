#!/bin/bash
set -euo pipefail

echo "🛑 Stopping any existing bot instances..."
./stop-bot.sh 2>/dev/null || true
sleep 2

echo "🚀 Starting MM bot with trace flags (background)..."
cd /root/hyperliquid-mm-bot-complete

# Run bot in background with trace + transpile-only
nohup bash -c '
  export TS_NODE_TRANSPILE_ONLY=1
  node --trace-uncaught -r dotenv/config --loader ts-node/esm src/mm_hl.ts 2>&1
' >> bot.log 2>&1 &

BOT_PID=$!
echo $BOT_PID > .bot.pid

sleep 3

if ps -p $BOT_PID > /dev/null 2>&1; then
  echo "✅ Bot started successfully (PID: $BOT_PID)"
  echo "📊 Monitor: tail -f bot.log"
else
  echo "❌ Bot failed to start"
  exit 1
fi
