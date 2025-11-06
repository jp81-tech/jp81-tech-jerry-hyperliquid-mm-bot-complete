#!/usr/bin/env bash
set -euo pipefail

echo "═══════════════════════════════════════════════════════"
echo "🔔 Webhook Configuration Status"
echo "═══════════════════════════════════════════════════════"
echo ""

cd /root/hyperliquid-mm-bot-complete

# Check webhooks (masked)
DISCORD=$(grep '^DISCORD_WEBHOOK_URL=' .env | cut -d'=' -f2-)
SLACK=$(grep '^SLACK_WEBHOOK_URL=' .env | cut -d'=' -f2-)

if [[ -n "$DISCORD" ]]; then
  echo "✅ Discord: Configured"
  echo "   URL: ${DISCORD:0:40}...***MASKED***"
else
  echo "❌ Discord: NOT configured"
fi

if [[ -n "$SLACK" ]]; then
  echo "✅ Slack: Configured"
  echo "   URL: ${SLACK:0:40}...***MASKED***"
else
  echo "❌ Slack: NOT configured"
fi

echo ""
echo "📅 Cron Jobs:"
crontab -l | grep -E 'alerts\.ts|daily_report\.ts|profile_' | sed 's/^/   /'

echo ""
echo "📊 Recent Alerts (last 5):"
tail -5 runtime/alerts.log 2>/dev/null | sed 's/^/   /' || echo "   (no alerts yet)"

echo ""
echo "═══════════════════════════════════════════════════════"
