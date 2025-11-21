#!/bin/bash
# Quick .env verification script

echo "🔍 Verifying .env configuration..."
echo ""

cd "$(dirname "$0")/.." || exit 1

if [ ! -f .env ]; then
  echo "❌ .env file not found!"
  exit 1
fi

# Load .env
set -a
source .env
set +a

echo "✅ Critical Settings:"
echo "  DRY_RUN=${DRY_RUN:-NOT SET}"
echo "  ENABLE_MULTI_LAYER=${ENABLE_MULTI_LAYER:-NOT SET}"
echo "  SPREAD_PROFILE=${SPREAD_PROFILE:-NOT SET}"
echo "  BEHAVIOURAL_RISK_MODE=${BEHAVIOURAL_RISK_MODE:-NOT SET}"
echo "  CHASE_MODE_ENABLED=${CHASE_MODE_ENABLED:-NOT SET}"
echo ""

echo "✅ Risk Limits:"
echo "  TOTAL_CAPITAL_USD=${TOTAL_CAPITAL_USD:-NOT SET}"
echo "  ROTATION_TARGET_PER_PAIR_USD=${ROTATION_TARGET_PER_PAIR_USD:-NOT SET}"
echo "  ROTATION_MAX_PER_PAIR_USD=${ROTATION_MAX_PER_PAIR_USD:-NOT SET}"
echo "  MAX_DAILY_LOSS_USD=${MAX_DAILY_LOSS_USD:-NOT SET}"
echo ""

echo "✅ Spread Settings:"
echo "  MAKER_SPREAD_BPS=${MAKER_SPREAD_BPS:-NOT SET}"
echo "  MIN_FINAL_SPREAD_BPS=${MIN_FINAL_SPREAD_BPS:-NOT SET}"
echo "  MAX_FINAL_SPREAD_BPS=${MAX_FINAL_SPREAD_BPS:-NOT SET}"
echo ""

echo "✅ Per-Pair Limits:"
echo "  ZEC_MAX_LOSS_PER_SIDE_USD=${ZEC_MAX_LOSS_PER_SIDE_USD:-NOT SET}"
echo "  UNI_MAX_LOSS_PER_SIDE_USD=${UNI_MAX_LOSS_PER_SIDE_USD:-NOT SET}"
echo "  VIRTUAL_MAX_LOSS_PER_SIDE_USD=${VIRTUAL_MAX_LOSS_PER_SIDE_USD:-NOT SET}"
echo ""

# Validation
ERRORS=0

if [ "${DRY_RUN}" != "true" ]; then
  echo "⚠️  WARNING: DRY_RUN is not 'true' - are you sure?"
  ERRORS=$((ERRORS + 1))
fi

if [ "${ENABLE_MULTI_LAYER}" != "true" ]; then
  echo "⚠️  WARNING: ENABLE_MULTI_LAYER is not 'true'"
  ERRORS=$((ERRORS + 1))
fi

if [ "${SPREAD_PROFILE}" != "conservative" ]; then
  echo "⚠️  WARNING: SPREAD_PROFILE is not 'conservative' (current: ${SPREAD_PROFILE})"
  ERRORS=$((ERRORS + 1))
fi

if [ "${CHASE_MODE_ENABLED}" = "true" ]; then
  echo "⚠️  WARNING: CHASE_MODE_ENABLED is 'true' - should be 'false' for first run"
  ERRORS=$((ERRORS + 1))
fi

if [ $ERRORS -eq 0 ]; then
  echo "✅ All critical settings look good!"
  exit 0
else
  echo ""
  echo "❌ Found $ERRORS warning(s) - please review .env"
  exit 1
fi

