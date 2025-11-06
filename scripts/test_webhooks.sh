#!/usr/bin/env bash
# Safe webhook tester - masks URLs in output
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete

echo "🧪 Testing Webhooks (URLs masked for security)"
echo ""

DISCORD_URL=$(grep '^DISCORD_WEBHOOK_URL=' .env | cut -d'=' -f2-)
SLACK_URL=$(grep '^SLACK_WEBHOOK_URL=' .env | cut -d'=' -f2-)

if [[ -n "$DISCORD_URL" ]]; then
  MASKED_DC=$(echo "$DISCORD_URL" | sed 's|/[^/]*$|/***MASKED***|')
  echo "📢 Discord: $MASKED_DC"
else
  echo "⚠️  Discord: Not configured"
fi

if [[ -n "$SLACK_URL" ]]; then
  MASKED_SLACK=$(echo "$SLACK_URL" | sed 's|/[^/]*$|/***MASKED***|')
  echo "💬 Slack: $MASKED_SLACK"
else
  echo "⚠️  Slack: Not configured"
fi

echo ""
echo "📤 Sending test alerts..."
npx tsx scripts/alerts.ts 2>&1 | tail -10

echo ""
echo "✅ Check your channels for messages!"
