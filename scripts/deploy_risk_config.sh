#!/bin/bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════
# Risk Runbook Deployment Script v2.0
# ═══════════════════════════════════════════════════════════

BOT_DIR="/root/hyperliquid-hyperliquid-mm-complete"
RISK_CONFIG="$BOT_DIR/.env.risk"
MAIN_ENV="$BOT_DIR/.env"
BACKUP_DIR="$BOT_DIR/backups"

echo "🚀 Starting Risk Runbook Deployment..."
echo ""

# 1. Create backup directory
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 2. Backup current .env
if [ -f "$MAIN_ENV" ]; then
  echo "📦 Backing up current .env to backups/.env.$TIMESTAMP"
  cp "$MAIN_ENV" "$BACKUP_DIR/.env.$TIMESTAMP"
else
  echo "⚠️  No existing .env found, creating new one"
  touch "$MAIN_ENV"
fi

# 3. Merge risk config with main .env (if risk config exists)
if [ -f "$RISK_CONFIG" ]; then
  echo "🔧 Merging .env.risk into .env..."

  # Remove old risk-related variables from main .env
  sed -i.bak '/^MAX_ACTIVE_PAIRS=/d' "$MAIN_ENV" 2>/dev/null || true
  sed -i.bak '/^STICKY_PAIRS=/d' "$MAIN_ENV" 2>/dev/null || true
  sed -i.bak '/^BIAS_.*=/d' "$MAIN_ENV" 2>/dev/null || true
  sed -i.bak '/^MAX_POSITION_USD_PER_PAIR=/d' "$MAIN_ENV" 2>/dev/null || true
  sed -i.bak '/^MAX_TOTAL_EXPOSURE_USD=/d' "$MAIN_ENV" 2>/dev/null || true
  sed -i.bak '/^CORE_LONG_USD=/d' "$MAIN_ENV" 2>/dev/null || true
  sed -i.bak '/^DAILY_PNL_STOP=/d' "$MAIN_ENV" 2>/dev/null || true
  sed -i.bak '/^PANIC_EQUITY_STOP=/d' "$MAIN_ENV" 2>/dev/null || true
  sed -i.bak '/^ENABLE_SLACK_ALERTS=/d' "$MAIN_ENV" 2>/dev/null || true
  sed -i.bak '/^SLACK_WEBHOOK=/d' "$MAIN_ENV" 2>/dev/null || true
  sed -i.bak '/^ALERT_ON_BIAS_CHANGE=/d' "$MAIN_ENV" 2>/dev/null || true
  sed -i.bak '/^ALERT_ON_ROTATION=/d' "$MAIN_ENV" 2>/dev/null || true
  sed -i.bak '/^ALERT_ON_SL_TRIGGER=/d' "$MAIN_ENV" 2>/dev/null || true
  sed -i.bak '/^NANSEN_WEIGHT=/d' "$MAIN_ENV" 2>/dev/null || true
  sed -i.bak '/^NANSEN_UPDATE_INTERVAL=/d' "$MAIN_ENV" 2>/dev/null || true

  # Append risk config
  echo "" >> "$MAIN_ENV"
  cat "$RISK_CONFIG" >> "$MAIN_ENV"

  echo "✅ Config merged successfully"
else
  echo "⚠️  .env.risk not found, skipping merge"
fi

# 4. Verify critical variables
echo ""
echo "🔍 Verifying configuration..."
set -a
source "$MAIN_ENV"
set +a

if [ -z "${MAX_ACTIVE_PAIRS:-}" ]; then
  echo "❌ ERROR: MAX_ACTIVE_PAIRS not set!"
  exit 1
fi

echo "   MAX_ACTIVE_PAIRS: $MAX_ACTIVE_PAIRS"
echo "   STICKY_PAIRS: ${STICKY_PAIRS:-none}"
echo "   DAILY_PNL_STOP: ${DAILY_PNL_STOP:--200}"
echo "   PANIC_EQUITY_STOP: ${PANIC_EQUITY_STOP:-16000}"

# 5. Restart bot
echo ""
echo "🔄 Restarting bot with new configuration..."
cd "$BOT_DIR"
pm2 restart hyperliquid-mm

# 6. Wait and check status
sleep 5
echo ""
echo "📊 Bot status:"
pm2 status hyperliquid-mm

# 7. Show recent logs
echo ""
echo "📋 Recent logs (last 20 lines):"
pm2 logs hyperliquid-mm --lines 20 --nostream | tail -20

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📌 Next steps:"
echo "   1. Monitor logs: pm2 logs hyperliquid-mm"
echo "   2. Check positions: npx tsx scripts/check_positions.ts"
echo "   3. Verify rotation: wait 2-3 cycles and check for 🧹 messages"
