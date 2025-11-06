#!/usr/bin/env bash
set -e
cd /root/hyperliquid-mm-bot-complete
sed -i "s/^MIN_L1_SPREAD_BPS=.*/MIN_L1_SPREAD_BPS=5/" .env || true
sed -i "s/^LAYER_OFFSETS_BPS=.*/LAYER_OFFSETS_BPS=30,50,75,105,145/" .env || true
sed -i "s/^CLIP_USD=.*/CLIP_USD=40/" .env || true
sed -i "s/^INV_SKEW_K=.*/INV_SKEW_K=1.4/" .env || true
sed -i "s/^ACTIVE_LAYERS=.*/ACTIVE_LAYERS=5/" .env || true
cp .env src/.env
pm2 restart hyperliquid-mm --update-env
echo "$(date -u +%F\ %T)Z manual_change MODERATE_BOUNCE->AGGRESSIVE_BOUNCE" >> runtime/manual_mode_changes.log
