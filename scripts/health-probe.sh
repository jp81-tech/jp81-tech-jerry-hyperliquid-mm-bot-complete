#!/usr/bin/env bash
# Quick health probe for ad-hoc checks
cd /root/hyperliquid-mm-bot-complete
echo "=== $(date -u) ==="
echo -n "E_TICK total: "; grep -c 'err_code=E_TICK' bot.log || true
echo -n "E_TICK last 1000 lines: "; tail -1000 bot.log | grep -c 'err_code=E_TICK' || true
echo -n "Bot PID: "; pgrep -f 'node --loader ts-node/esm src/mm_hl.ts' || echo "NOT RUNNING"
echo "Active pairs (last 20):"
tail -200 bot.log | grep 'rotation_evt=apply\|quant_evt=attempt' | tail -20
if [ -f runtime/active_pairs.json ]; then
  echo "Selected pairs (from daemon):"
  jq -r '.pairs|join(",")' runtime/active_pairs.json
else
  echo "No rotation file (using static pairs)"
fi
