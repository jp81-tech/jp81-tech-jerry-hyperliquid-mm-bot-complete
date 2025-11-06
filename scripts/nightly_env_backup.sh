#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete
mkdir -p backups/env
ts=$(date -u +%Y%m%dT%H%M%SZ)
cp .env "backups/env/.env.$ts"
ln -sfn ".env.$ts" "backups/env/latest"
find backups/env -maxdepth 1 -type f -name ".env.*" -mtime +14 -delete || true
count=$(ls -1t backups/env/.env.* 2>/dev/null | wc -l | tr -d ' ')
if [ "$count" -gt 30 ]; then
  ls -1t backups/env/.env.* | tail -n $((count-30)) | xargs -r rm -f
fi
HOOK=""
[ -n "${SLACK_WEBHOOK_URL:-}" ] && HOOK="$SLACK_WEBHOOK_URL"
[ -z "$HOOK" ] && [ -n "${DISCORD_WEBHOOK_URL:-}" ] && HOOK="$DISCORD_WEBHOOK_URL"
if [ -n "$HOOK" ]; then
  msg="🌙 NIGHTLY ENV BACKUP\nBackup: .env.$ts\nSource: Automated cron (23:00)"
  if [[ "$HOOK" == *"discord"* ]]; then
    curl -s -X POST -H "Content-Type: application/json" -d "{\"content\":\"$msg\"}" "$HOOK" >/dev/null || true
  else
    curl -s -X POST -H "Content-Type: application/json" -d "{\"text\":\"$msg\"}" "$HOOK" >/dev/null || true
  fi
fi
