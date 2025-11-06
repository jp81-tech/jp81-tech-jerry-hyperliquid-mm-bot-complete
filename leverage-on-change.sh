#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

echo "⚙️  [$(date -u '+%F %T')] Detected pair change"
echo "💰 Recalculating capital allocation..."
npx tsx scripts/capital_allocator.ts || true

echo "⚡ Applying leverage..."
npx tsx scripts/apply_leverage_on_boot.ts || true

# Find the bot PID - get only the first matching process
BOT_PID=$(pgrep -f 'tsx .*mm_hl.ts' | head -1 || true)
if [ -n "$BOT_PID" ]; then
  echo "🔁 Sending SIGHUP to bot (PID $BOT_PID)..."
  kill -HUP "$BOT_PID" || true
else
  echo "⚠️  Bot process not found (no SIGHUP sent)"
fi
