#!/usr/bin/env bash
set -e
cd /root/hyperliquid-mm-bot-complete
sed -i "s/^MIN_L1_SPREAD_BPS=.*/MIN_L1_SPREAD_BPS=10/" .env || true
sed -i "s/^LAYER_OFFSETS_BPS=.*/LAYER_OFFSETS_BPS=60,95,140,195,260/" .env || true
sed -i "s/^CLIP_USD=.*/CLIP_USD=20/" .env || true
sed -i "s/^INV_SKEW_K=.*/INV_SKEW_K=0.7/" .env || true
sed -i "s/^DRIFT_SKEW_BPS=.*/DRIFT_SKEW_BPS=3/" .env || grep -q "^DRIFT_SKEW_BPS=" .env || echo "DRIFT_SKEW_BPS=3" >> .env
cp .env src/.env
pm2 restart hyperliquid-mm --update-env
echo "$(date -u +%F\ %T)Z manual_change ANY->DEFENSIVE" >> runtime/manual_mode_changes.log
