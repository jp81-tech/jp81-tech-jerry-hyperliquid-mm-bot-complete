#!/bin/bash
set -e

PROFILE=
ROOT=/root/hyperliquid-mm-bot-complete

if [[ -z "$PROFILE" ]]; then
  echo "Usage: ./switch_profile.sh [balanced|aggressive]"
  echo ""
  echo "Current profile settings:"
  grep -E '^BASE_ORDER_USD|^CLIP_USD|^BASE_INTERVAL_SEC|^MAKER_SPREAD_BPS_MIN|^ACTIVE_LAYERS' $ROOT/.env | head -10
  exit 1
fi

if [[ "$PROFILE" == "balanced" ]]; then
  echo "🔄 Switching to BALANCED profile..."
  PROFILE_FILE="$ROOT/.env.balanced"
elif [[ "$PROFILE" == "aggressive" ]]; then
  echo "🔄 Switching to AGGRESSIVE profile..."
  PROFILE_FILE="$ROOT/.env.aggressive"
else
  echo "❌ Invalid profile: $PROFILE"
  echo "Valid options: balanced, aggressive"
  exit 1
fi

if [[ ! -f "$PROFILE_FILE" ]]; then
  echo "❌ Profile file not found: $PROFILE_FILE"
  exit 1
fi

# Backup current .env
cp $ROOT/.env $ROOT/.env.backup.$(date +%Y%m%d_%H%M%S)

# Read current .env and preserve essential keys
PRIVATE_KEY=$(grep '^PRIVATE_KEY=' $ROOT/.env | cut -d'=' -f2-)
SLACK_WEBHOOK=$(grep '^SLACK_WEBHOOK_URL=' $ROOT/.env | cut -d'=' -f2- || echo "")
DISCORD_WEBHOOK=$(grep '^DISCORD_WEBHOOK_URL=' $ROOT/.env | cut -d'=' -f2- || echo "")
MAKER_REBATE=$(grep '^MAKER_REBATE_BPS=' $ROOT/.env | cut -d'=' -f2- || echo "2.0")
TAKER_FEE=$(grep '^TAKER_FEE_BPS=' $ROOT/.env | cut -d'=' -f2- || echo "5.0")

# Apply profile settings to main .env
while IFS= read -r line; do
  if [[ $line =~ ^[A-Z_]+=.* ]]; then
    KEY=$(echo "$line" | cut -d'=' -f1)
    VALUE=$(echo "$line" | cut -d'=' -f2-)
    
    # Update or add line in .env
    if grep -q "^$KEY=" $ROOT/.env; then
      sed -i "s|^$KEY=.*|$KEY=$VALUE|" $ROOT/.env
    else
      echo "$line" >> $ROOT/.env
    fi
  fi
done < "$PROFILE_FILE"

# Ensure critical keys are preserved
sed -i "s|^PRIVATE_KEY=.*|PRIVATE_KEY=$PRIVATE_KEY|" $ROOT/.env
sed -i "s|^SLACK_WEBHOOK_URL=.*|SLACK_WEBHOOK_URL=$SLACK_WEBHOOK|" $ROOT/.env
sed -i "s|^DISCORD_WEBHOOK_URL=.*|DISCORD_WEBHOOK_URL=$DISCORD_WEBHOOK|" $ROOT/.env

echo "✅ Profile switched to: $PROFILE"
echo ""
echo "New settings:"
grep -E '^BASE_ORDER_USD|^CLIP_USD|^BASE_INTERVAL_SEC|^MAKER_SPREAD_BPS_MIN|^ACTIVE_LAYERS|^ENABLE_QUOTE_CHASE' $ROOT/.env

echo ""
echo "🔄 Restarting bot..."
pm2 restart hyperliquid-mm

echo ""
echo "✅ Done! Bot restarted with $PROFILE profile."
