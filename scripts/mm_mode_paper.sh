#\!/usr/bin/env bash
set -euo pipefail
ROOT="/root/hyperliquid-hyperliquid-mm-complete"
cd "$ROOT"

echo "════════ MM MODE: PAPER ════════"
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

if [ \! -f .env.paper ]; then
  echo "❌ Missing .env.paper\!"
  exit 1
fi

cp .env.paper .env
echo "✅ Environment switched to PAPER TRADING (.env.paper)"
grep "^DRY_RUN" .env || echo "⚠️ No DRY_RUN line found in .env"

# Slack notification (optional but useful)
if [ -f .env ]; then
  SLACK_WEBHOOK_URL="$(grep -E "^SLACK_WEBHOOK_URL=" .env | cut -d= -f2- || true)"
  if [ -n "$SLACK_WEBHOOK_URL" ]; then
    curl -s -X POST -H "Content-type: application/json" \
      --data "{\"text\": \"🧪 MM Bot switched to *PAPER TRADING MODE* (DRY_RUN=1). Restarting bot & forcing fresh rotation.\"}" \
      "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
fi

# This will:
#  - zrobić POST-change snapshot .env
#  - zrestartować bota
#  - wymusić na nim świeżą rotację (jak przy każdym starcie)
"$ROOT/scripts/mm_restart_safe.sh"

echo
echo "════════ DONE ════════"
