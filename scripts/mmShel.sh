#!/usr/bin/env bash
set -e
cd /root/hyperliquid-mm-bot-complete
sed -i "s/^MIN_L1_SPREAD_BPS=.*/MIN_L1_SPREAD_BPS=12/" .env || true
sed -i "s/^LAYER_OFFSETS_BPS=.*/LAYER_OFFSETS_BPS=70,110,160,220,290/" .env || true
sed -i "s/^CLIP_USD=.*/CLIP_USD=15/" .env || true
sed -i "s/^INV_SKEW_K=.*/INV_SKEW_K=0.5/" .env || true
sed -i "s/^DRIFT_SKEW_BPS=.*/DRIFT_SKEW_BPS=2/" .env || grep -q "^DRIFT_SKEW_BPS=" .env || echo "DRIFT_SKEW_BPS=2" >> .env
cp .env src/.env
pm2 restart hyperliquid-mm --update-env
npx tsx scripts/cancel_all_orders.ts 2>/dev/null || true
echo "$(date -u +%F\ %T)Z manual_change ANY->SHELTER" >> runtime/manual_mode_changes.log
