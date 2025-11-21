#!/bin/bash
# Monitor bot logs for critical events

echo "📊 Monitoring bot logs for critical events..."
echo "Press Ctrl+C to stop"
echo ""

cd "$(dirname "$0")/.." || exit 1

LOG_FILE="${1:-bot.log}"

if [ ! -f "$LOG_FILE" ]; then
  echo "❌ Log file not found: $LOG_FILE"
  exit 1
fi

tail -f "$LOG_FILE" | grep --line-buffered -E "SNAPSHOT|RISK|NANSEN|BehaviouralRisk|SOFT SL|DAILY LOSS|🎚️|🏛️|ERROR|WARN" | while read -r line; do
  # Color coding
  if echo "$line" | grep -q "ERROR\|SOFT SL\|DAILY LOSS"; then
    echo -e "\033[31m$line\033[0m"  # Red
  elif echo "$line" | grep -q "WARN\|BehaviouralRisk"; then
    echo -e "\033[33m$line\033[0m"  # Yellow
  elif echo "$line" | grep -q "SNAPSHOT"; then
    echo -e "\033[32m$line\033[0m"  # Green
  else
    echo "$line"
  fi
done

