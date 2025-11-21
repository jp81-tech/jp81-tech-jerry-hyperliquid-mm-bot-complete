#!/usr/bin/env bash
set -euo pipefail

# Dynamic Spread Generator - generates .env snippets with per-token spreads
# Based on real-time metrics: Volume, Traders, Base Score, Nansen Boost

BOT_DIR="/root/hyperliquid-hyperliquid-mm-complete"
RUNTIME_DIR="$BOT_DIR/runtime"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
OUTPUT_FILE="$RUNTIME_DIR/spread_snippet_$TIMESTAMP.env"
LATEST_LINK="$RUNTIME_DIR/spread_snippet_latest.env"

cd "$BOT_DIR"

echo "🔧 Generating dynamic spread snippets..."
echo "Timestamp: $TIMESTAMP"

# Run TypeScript helper that calculates spreads
node -r dotenv/config --loader ts-node/esm scripts/gen_spread_overrides.ts > "$OUTPUT_FILE"

# Create symlink to latest
ln -sf "$(basename "$OUTPUT_FILE")" "$LATEST_LINK"

echo "✅ Generated: $OUTPUT_FILE"
echo "📋 Latest: $LATEST_LINK"
echo ""
echo "To apply spreads, add this to .env and restart bot:"
echo "----------------------------------------"
cat "$OUTPUT_FILE"
echo "----------------------------------------"

# --- AUTO-APPLY TO .env + RESTART BOT ---

ENV_FILE="$BOT_DIR/.env"
SNIPPET="$LATEST_LINK"
PM2_NAME="hyperliquid-mm"

if [ -f "$SNIPPET" ] && [ -f "$ENV_FILE" ]; then
  TS="$(date -u +%Y%m%dT%H%M%SZ)"

  echo ""
  echo "🔁 Applying spread overrides to .env and restarting bot..."

  # 1) backup .env
  cp "$ENV_FILE" "$ENV_FILE.before_spread_$TS.bak" || true

  # 2) usuń stare SPREAD_OVERRIDE_* z .env
  sed -i '/^SPREAD_OVERRIDE_[A-Z0-9]\+=/d' "$ENV_FILE"

  # 3) dopisz nowe override'y z najnowszego snippetu
  #    (bierzemy tylko linie zaczynające się od SPREAD_OVERRIDE_)
  grep '^SPREAD_OVERRIDE_' "$SNIPPET" >> "$ENV_FILE"

  echo "✅ Spread overrides updated in .env"
  echo "📦 Backup saved: $ENV_FILE.before_spread_$TS.bak"

  # 4) restart bota z nowym ENV
  if command -v pm2 >/dev/null 2>&1; then
    pm2 restart "$PM2_NAME" --update-env >/dev/null 2>&1 || true
    echo "🔄 Bot restarted with new spreads"
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "✅ AUTO-APPLY COMPLETED"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
  echo ""
  echo "⚠️ Cannot apply spread overrides automatically"
  echo "   Missing: $SNIPPET or $ENV_FILE"
fi

# --- SEND SLACK REPORT ---
if [ -x "$BOT_DIR/scripts/send_spread_report.sh" ]; then
  "$BOT_DIR/scripts/send_spread_report.sh" || true
fi
