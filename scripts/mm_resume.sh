#!/usr/bin/env bash
set -e

APP_NAME="hyperliquid-mm"
ROOT="/root/hyperliquid-hyperliquid-mm-complete"

cd "$ROOT" || {
  echo "❌ Cannot cd to $ROOT"
  exit 1
}

echo "════════ MM BOT RESUME ════════"
date
echo

echo "▶ Starting PM2 app: $APP_NAME ..."
pm2 start "$APP_NAME" --update-env >/dev/null 2>&1 || pm2 restart "$APP_NAME" --update-env

echo
echo "⏳ Waiting 6 seconds for bot to initialize..."
sleep 6
echo

if [ -x ./scripts/mm_healthcheck.sh ]; then
  echo "▶ Running mm_healthcheck.sh ..."
  ./scripts/mm_healthcheck.sh || echo "⚠️ Healthcheck script returned non-zero exit code."
else
  echo "⚠️ mm_healthcheck.sh not found or not executable, showing basic PM2 status:"
  pm2 status "$APP_NAME" | sed -n '3,7p'
fi

echo
echo "════════ DONE ════════"
