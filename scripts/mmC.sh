#!/usr/bin/env bash
set -e
cd /root/hyperliquid-mm-bot-complete
sed -i "s/^MIN_L1_SPREAD_BPS=.*/MIN_L1_SPREAD_BPS=8/" .env || true
sed -i "s/^LAYER_OFFSETS_BPS=.*/LAYER_OFFSETS_BPS=50,80,120,165,220/" .env || true
sed -i "s/^CLIP_USD=.*/CLIP_USD=25/" .env || true
sed -i "s/^INV_SKEW_K=.*/INV_SKEW_K=0.9/" .env || true
sed -i "s/^ACTIVE_LAYERS=.*/ACTIVE_LAYERS=4/" .env || true
cp .env src/.env
pm2 restart hyperliquid-mm --update-env
echo "$(date -u +%F\ %T)Z manual_change ANY->STABLE" >> runtime/manual_mode_changes.log
