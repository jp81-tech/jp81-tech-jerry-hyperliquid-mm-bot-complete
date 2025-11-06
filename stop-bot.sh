#!/bin/bash

echo "🛑 Stopping all bot processes..."

# Kill all bot-related processes
ps aux | grep -E "(npx tsx|npm start|node.*mm|node.*bot|tail -f /tmp/mm_bot.log)" | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null

# Wait a moment
sleep 1

# Check if any processes are still running
REMAINING=$(ps aux | grep -E "(npx tsx src/mm_hl|npm start|node.*bot)" | grep -v grep | wc -l)

if [ "$REMAINING" -eq 0 ]; then
    echo "✅ All bot processes stopped successfully"
else
    echo "⚠️  Warning: $REMAINING processes may still be running"
    ps aux | grep -E "(npx tsx|npm start|node.*bot)" | grep -v grep
fi
