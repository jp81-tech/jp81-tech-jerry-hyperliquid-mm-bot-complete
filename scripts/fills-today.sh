#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

LOG_FILE="bot.log"

if [ ! -f "$LOG_FILE" ]; then
  echo "bot.log not found in $(pwd)"
  exit 1
fi

TODAY_UTC=$(date -u +%Y-%m-%d)

echo "Fills for UTC date: $TODAY_UTC"
echo

MATCHED=$(grep "exec_evt=fill" "$LOG_FILE" | grep "$TODAY_UTC" || true)

if [ -z "$MATCHED" ]; then
  echo "No fills found for $TODAY_UTC"
  exit 0
fi

echo "$MATCHED" | tail -n 50

echo
echo "Stats:"
echo "$MATCHED" | wc -l | awk '{print "  Total fills: "$1}'

echo "$MATCHED" | awk '
{
  pair=""
  for (i = 1; i <= NF; i++) {
    if ($i ~ /^pair=/) {
      split($i, a, "=")
      pair=a[2]
    }
  }
  if (pair != "") c[pair]++
}
END {
  for (p in c) {
    print "  " p ": " c[p] " fills"
  }
}'

