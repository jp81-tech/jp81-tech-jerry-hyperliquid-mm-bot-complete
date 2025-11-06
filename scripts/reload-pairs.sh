#!/usr/bin/env bash
# Trigger SIGHUP to reload pairs from active_pairs.json without restart
PID=$(pgrep -f 'node --loader ts-node/esm src/mm_hl.ts')
if [ -z "$PID" ]; then
  echo "❌ Bot not running"
  exit 1
fi
echo "Sending SIGHUP to bot (PID $PID) to reload pairs..."
kill -HUP $PID
sleep 1
echo "Check logs for rotation_evt=apply or rotation_evt=skip:"
tail -10 /root/hyperliquid-mm-bot-complete/bot.log | grep rotation_evt
