#!/usr/bin/env bash
set -e
cd /root/hyperliquid-mm-bot-complete
echo "=== OPEN ORDERS ==="
npx tsx scripts/check-all-orders.ts 2>&1 | head -30
echo
echo "=== POSITIONS ==="
npx tsx scripts/check_positions.ts 2>&1
echo
echo "=== ALO REJECTS (last 200 lines) ==="
pm2 logs hyperliquid-mm --lines 200 --nostream 2>&1 | grep -Ei "post only|would have immediately" | wc -l
echo
echo "=== KEY PARAMS ==="
grep -E "^(MIN_L1_SPREAD_BPS|LAYER_OFFSETS_BPS|CLIP_USD|INV_SKEW_K|ACTIVE_LAYERS|DRIFT_SKEW_BPS)=" .env
