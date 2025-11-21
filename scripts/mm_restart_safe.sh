#\!/usr/bin/env bash
set -e

ROOT="/root/hyperliquid-hyperliquid-mm-complete"
cd "$ROOT"

APP_NAME="hyperliquid-mm"
LINES=60

echo "════════ MM BOT RESTART (SAFE) ════════"
date
echo

# Global .env snapshot (unified backup system)
BACKUP_DIR="./backups/env"
mkdir -p "$BACKUP_DIR"

if [ -f .env ]; then
  TS="$(date +%Y%m%d_%H%M%S)"
  SNAP="$BACKUP_DIR/.env.$TS"
  cp .env "$SNAP"
  echo "📦 .env snapshot: $SNAP"
  
  # Create symlink to latest
  ln -sfn ".env.$TS" "$BACKUP_DIR/latest"
else
  echo "⚠️  No .env found, skipping snapshot."
fi

echo

echo "▶ Restarting PM2 app: $APP_NAME ..."
pm2 restart "$APP_NAME" --update-env || {
  echo "❌ pm2 restart failed"
  exit 1
}

echo
echo "⏳ Waiting 6 seconds for bot to initialize..."
sleep 6
echo

echo "▶ Last ${LINES} log lines (filtered):"
pm2 logs "$APP_NAME" --lines $LINES --nostream \
  | grep -E 'initialized|Base order size|LiveTrading initialized|Error placing order|invalid_size|TypeError' \
  || echo "  (no matching lines in last ${LINES} log lines)"

echo
echo "▶ Quick status:"
pm2 status "$APP_NAME" | sed -n '3,7p'
echo
echo "════════ DONE ════════"
