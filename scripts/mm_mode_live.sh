#\!/usr/bin/env bash
set -euo pipefail
ROOT="/root/hyperliquid-hyperliquid-mm-complete"
cd "$ROOT"

echo "════════ MM MODE: LIVE ════════"
date
echo

BACKUP_DIR="./backups"
mkdir -p "$BACKUP_DIR"

# PRE-CHANGE SNAPSHOT (before overwriting .env)
if [ -f .env ]; then
  TS_PRE="$(date +%Y-%m-%d_%H-%M-%S)"
  SNAP_PRE="$BACKUP_DIR/env_PRE_MODECHANGE_${TS_PRE}.env"
  cp .env "$SNAP_PRE"
  echo "📦 PRE-change .env snapshot created: $SNAP_PRE"
else
  echo "⚠️ No existing .env found before mode switch, skipping pre-change snapshot."
fi

if [ \! -f .env.live ]; then
  echo "❌ Missing .env.live\!"
  exit 1
fi

cp .env.live .env
echo "✅ Environment switched to LIVE TRADING (.env.live)"
grep "^DRY_RUN" .env || echo "⚠️ No DRY_RUN line found in .env"

# Slack notification
if [ -f .env ]; then
  SLACK_WEBHOOK_URL="$(grep -E "^SLACK_WEBHOOK_URL=" .env | cut -d= -f2- || true)"
  if [ -n "$SLACK_WEBHOOK_URL" ]; then
    curl -s -X POST -H "Content-type: application/json" \
      --data "{\"text\": \"💰 MM Bot switched to *LIVE TRADING MODE* (DRY_RUN=0). Restarting bot & forcing fresh rotation.\"}" \
      "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
fi

"$ROOT/scripts/mm_restart_safe.sh"

echo
echo "════════ DONE ════════"
