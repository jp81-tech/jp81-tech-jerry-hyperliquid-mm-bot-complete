#!/usr/bin/env bash
set -e

APP_NAME="hyperliquid-mm"

echo "════════ MM BOT LOGS (FOCUS) ════════"
date
echo "Patterns: quant_evt=submit | [CAP] | invalid_size | below min notional | Status | Health | PnL"
echo "Press Ctrl+C to exit."
echo "═════════════════════════════════════"
echo

pm2 logs "$APP_NAME" --timestamp \
  | grep -E 'quant_evt=submit|\[CAP\]|invalid_size|below min notional|Status \||Health:|PnL:'
