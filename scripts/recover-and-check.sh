#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete
systemctl restart mm-rotation-daemon || true
systemctl restart mm-panic-watchdog || true
./stop-bot.sh || true
./start-bot.sh
./scripts/check-health.sh
