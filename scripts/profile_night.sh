#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete
sed -i 's/^MAKER_SPREAD_BPS_MIN=.*/MAKER_SPREAD_BPS_MIN=2/' .env
sed -i 's/^MAKER_SPREAD_BPS_MAX=.*/MAKER_SPREAD_BPS_MAX=8/' .env
sed -i 's/^BASE_INTERVAL_SEC=.*/BASE_INTERVAL_SEC=30/' .env
cp .env src/.env
pm2 restart hyperliquid-mm
echo "[Tue Nov  4 22:22:06 CET 2025] Switched to NIGHT profile (spread 2-8 bps, interval 30s)" >> /root/hyperliquid-mm-bot-complete/runtime/watchdog.log
