#!/usr/bin/env bash
# Manual watchdog restore trigger
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete

echo "🆘 MANUAL WATCHDOG RESTORE"
echo "=========================="

if [ ! -d backups/env ] || [ -z "$(ls -A backups/env/.env.* 2>/dev/null)" ]; then
  echo "❌ No backup files found in backups/env/"
  exit 1
fi

prev=$(ls -1t backups/env/.env.* 2>/dev/null | head -1)
echo "📂 Latest backup: $(basename "$prev")"
echo "📅 Modified: $(date -r "$prev" '+%Y-%m-%d %H:%M:%S %Z')"

# Load webhook from current .env
set +e
set -a
[ -f .env ] && . ./.env
set +a
set -e

# Restore backup
cp "$prev" .env
cp .env src/.env 2>/dev/null || true
echo "✅ Restored: .env"

# Send alert
HOOK=""
[ -n "${SLACK_WEBHOOK_URL:-}" ] && HOOK="$SLACK_WEBHOOK_URL"
[ -z "$HOOK" ] && [ -n "${DISCORD_WEBHOOK_URL:-}" ] && HOOK="$DISCORD_WEBHOOK_URL"

if [ -n "$HOOK" ]; then
  MSG="🆘 MANUAL WATCHDOG RESTORE\nTrigger: Manual execution\nRestored: $(basename "$prev")\nOperator: ${USER:-root}"
  if [[ "$HOOK" == *"discord"* ]]; then
    curl -s -X POST -H "Content-Type: application/json" -d "{\"content\":\"$MSG\"}" "$HOOK" >/dev/null || true
  else
    curl -s -X POST -H "Content-Type: application/json" -d "{\"text\":\"$MSG\"}" "$HOOK" >/dev/null || true
  fi
  echo "📤 Alert sent to webhook"
fi

# Restart PM2
pm2 restart hyperliquid-mm --update-env || true
echo "🔄 PM2 restarted with new config"

# Reset watchdog baseline
mkdir -p runtime/watchdog
CUR=$(pm2 jlist | jq -r '.[] | select(.name=="hyperliquid-mm") | .pm2_env.restart_time' 2>/dev/null || echo 0)
NOW=$(date -u +%s)
echo "$NOW $CUR" > runtime/watchdog/baseline.txt
echo "📝 Watchdog baseline reset"

echo ""
echo "✅ Manual restore complete!"
