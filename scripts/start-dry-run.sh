#!/bin/bash
# Start bot in DRY_RUN mode with verification

set -e

echo "🚀 Starting bot in DRY_RUN mode..."
echo ""

cd "$(dirname "$0")/.." || exit 1

# 1. Check if .env exists
if [ ! -f .env ]; then
  echo "❌ .env file not found!"
  exit 1
fi

# 2. Ensure DRY_RUN=true in .env
if ! grep -q "^DRY_RUN=true" .env; then
  echo "⚠️  DRY_RUN not set to 'true' in .env"
  echo "   Setting DRY_RUN=true..."
  
  # Remove any existing DRY_RUN line
  sed -i.bak '/^DRY_RUN=/d' .env
  
  # Add DRY_RUN=true at the beginning
  echo "DRY_RUN=true" | cat - .env > .env.tmp && mv .env.tmp .env
  
  echo "✅ DRY_RUN=true added to .env"
else
  echo "✅ DRY_RUN=true already set in .env"
fi

# 3. Ensure other critical settings
echo ""
echo "📋 Verifying critical settings..."

REQUIRED_SETTINGS=(
  "ENABLE_MULTI_LAYER=true"
  "SPREAD_PROFILE=conservative"
  "BEHAVIOURAL_RISK_MODE=normal"
  "ROTATION_ENABLED=false"
  "CHASE_MODE_ENABLED=false"
)

for setting in "${REQUIRED_SETTINGS[@]}"; do
  key=$(echo "$setting" | cut -d'=' -f1)
  value=$(echo "$setting" | cut -d'=' -f2)
  
  if ! grep -q "^${key}=${value}" .env; then
    echo "⚠️  Setting ${key}=${value}..."
    sed -i.bak "/^${key}=/d" .env
    echo "${key}=${value}" >> .env
  else
    echo "✅ ${key}=${value}"
  fi
done

echo ""
echo "📊 Current .env settings:"
echo "  DRY_RUN=$(grep "^DRY_RUN=" .env | cut -d'=' -f2)"
echo "  ENABLE_MULTI_LAYER=$(grep "^ENABLE_MULTI_LAYER=" .env | cut -d'=' -f2)"
echo "  SPREAD_PROFILE=$(grep "^SPREAD_PROFILE=" .env | cut -d'=' -f2)"
echo "  BEHAVIOURAL_RISK_MODE=$(grep "^BEHAVIOURAL_RISK_MODE=" .env | cut -d'=' -f2)"
echo "  ROTATION_ENABLED=$(grep "^ROTATION_ENABLED=" .env | cut -d'=' -f2)"
echo "  CHASE_MODE_ENABLED=$(grep "^CHASE_MODE_ENABLED=" .env | cut -d'=' -f2)"
echo ""

# 4. Check if systemd service exists
if systemctl list-units --type=service | grep -q "mm-bot.service"; then
  echo "🔄 Restarting systemd service..."
  systemctl restart mm-bot.service
  sleep 2
  systemctl status mm-bot.service --no-pager | head -15
else
  echo "⚠️  systemd service not found, starting manually..."
  echo "   Run: npm start"
fi

echo ""
echo "⏳ Waiting 5 seconds for bot to start..."
sleep 5

# 5. Verify DRY_RUN mode
echo ""
echo "🔍 Verifying DRY_RUN mode..."

if [ -f bot.log ]; then
  if grep -q "PAPER TRADING MODE" bot.log | tail -1; then
    echo "✅ DRY_RUN mode confirmed:"
    grep "PAPER TRADING MODE" bot.log | tail -1
  else
    echo "⚠️  Could not find 'PAPER TRADING MODE' in logs"
    echo "   Checking last 20 lines of bot.log:"
    tail -20 bot.log
  fi
  
  if grep -q "LIVE TRADING MODE" bot.log | tail -1; then
    echo "❌ WARNING: Found 'LIVE TRADING MODE' - bot is NOT in DRY_RUN!"
    exit 1
  fi
else
  echo "⚠️  bot.log not found yet, bot may still be starting..."
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📊 Monitor logs with:"
echo "   ./scripts/monitor-logs.sh bot.log"
echo ""
echo "📋 Or check recent logs:"
echo "   tail -f bot.log | grep -E 'SNAPSHOT|RISK|NANSEN|BehaviouralRisk'"

