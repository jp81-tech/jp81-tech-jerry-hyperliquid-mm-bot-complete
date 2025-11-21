#!/usr/bin/env bash
set -e

APP_NAME="hyperliquid-mm"

echo "════════ MM BOT PAUSE ════════"
date
echo

echo "▶ Stopping PM2 app: $APP_NAME ..."
pm2 stop "$APP_NAME" >/dev/null 2>&1 || true

echo
echo "▶ Current PM2 status (filtered):"
pm2 status "$APP_NAME" | sed -n '3,7p' || true
echo
echo "⏸ Bot is now PAUSED (PM2 stopped)."
echo "════════ DONE ════════"
