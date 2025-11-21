#!/usr/bin/env bash
set -euo pipefail

SINCE_UTC="${1:-24 hours ago}"

TOTAL_RUNS=$(journalctl -u mm-policy-reconcile.service --since "$SINCE_UTC" --no-pager | grep -c "Effective_pairs:" || echo 0)

# Extract all pair sets, hash each 6-line block, count unique
journalctl -u mm-policy-reconcile.service --since "$SINCE_UTC" --no-pager | \
  grep "Effective_pairs:" -A6 | \
  awk "/Effective_pairs:/{if(set)print set; set=\"\"; next} /[A-Z]/{set=set\" \"\$NF} END{if(set)print set}" | \
  sort > /tmp/rotation_sets.txt

UNIQUE_SETS=$(cat /tmp/rotation_sets.txt | uniq | wc -l)
CHANGES=$(($UNIQUE_SETS > 1 ? $UNIQUE_SETS - 1 : 0))

echo "📊 Rotation Stats"
echo "Period: since $SINCE_UTC"
echo "Total reconcile runs: $TOTAL_RUNS"
echo "Unique pair configurations: $UNIQUE_SETS"
echo "Pair changes detected: $CHANGES"
if [ "$TOTAL_RUNS" -gt 0 ]; then
  STABILITY=$(echo "scale=1; 100 * (($TOTAL_RUNS - $CHANGES) / $TOTAL_RUNS)" | bc)
  echo "Stability: ${STABILITY}%"
fi
