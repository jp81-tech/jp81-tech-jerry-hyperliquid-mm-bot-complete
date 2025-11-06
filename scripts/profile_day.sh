#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete
sed -i 's/^MAKER_SPREAD_BPS_MIN=.*/MAKER_SPREAD_BPS_MIN=3/' .env
sed -i 's/^MAKER_SPREAD_BPS_MAX=.*/MAKER_SPREAD_BPS_MAX=12/' .env
sed -i 's/^BASE_INTERVAL_SEC=.*/BASE_INTERVAL_SEC=45/' .env
cp .env src/.env
pm2 restart hyperliquid-mm
echo "[Tue Nov  4 22:21:55 CET 2025] Switched to DAY profile (spread 3-12 bps, interval 45s)" >> /root/hyperliquid-mm-bot-complete/runtime/watchdog.log
