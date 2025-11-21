#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

LOG_FILE="bot.log"

if [ ! -f "$LOG_FILE" ]; then
  echo "bot.log not found in $(pwd)"
  exit 1
fi

echo "Watching fills in $LOG_FILE"
echo "Press Ctrl+C to stop"

tail -F "$LOG_FILE" | grep -i --line-buffered "exec_evt=fill"

