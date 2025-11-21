#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete

# Create rotation_candidates.json from active_pairs source with ranking
# Priority: active_pairs_with_ranking.json > active_pairs.json.backup > fallback
ROTATION_SRC=""
if [ -s runtime/active_pairs_with_ranking.json ]; then
  ROTATION_SRC="runtime/active_pairs_with_ranking.json"
elif [ -s runtime/active_pairs.json.backup ]; then
  ROTATION_SRC="runtime/active_pairs.json.backup"
fi

if [ -n "$ROTATION_SRC" ]; then
  # Check if it has .ranked field
  if jq -e ".ranked" "$ROTATION_SRC" >/dev/null 2>&1; then
    jq "{pairs: [.ranked[].pair]}" "$ROTATION_SRC" > runtime/rotation_candidates.json
  elif jq -e ".pairs" "$ROTATION_SRC" >/dev/null 2>&1; then
    cp "$ROTATION_SRC" runtime/rotation_candidates.json
  else
    echo "{\"pairs\":[]}" > runtime/rotation_candidates.json
  fi
else
  echo "{\"pairs\":[]}" > runtime/rotation_candidates.json
fi

# NOTE: nansen_signals.json is now maintained by nansen_capture.ts timer
# Do not overwrite it here

echo "rotation_candidates.json (top 10):"
jq -c ".pairs[0:10]" runtime/rotation_candidates.json
echo
echo "nansen_signals.json (top 5):"
jq -c ".signals[0:5]" runtime/nansen_signals.json 2>/dev/null || echo "[]"
