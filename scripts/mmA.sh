#!/usr/bin/env bash
set -e
cd /root/hyperliquid-mm-bot-complete
sed -i "s/^MIN_L1_SPREAD_BPS=.*/MIN_L1_SPREAD_BPS=6/" .env || true
sed -i "s/^LAYER_OFFSETS_BPS=.*/LAYER_OFFSETS_BPS=40,65,100,140,190/" .env || true
sed -i "s/^CLIP_USD=.*/CLIP_USD=30/" .env || true
sed -i "s/^INV_SKEW_K=.*/INV_SKEW_K=1.1/" .env || true
cp .env src/.env
pm2 restart hyperliquid-mm --update-env
echo "$(date -u +%F\ %T)Z manual_change STABLE->MODERATE_BOUNCE" >> runtime/manual_mode_changes.log
