#!/usr/bin/env bash
#
# slack_alert.sh - Send Slack alert when bot is dead/hung
# Usage: ./slack_alert.sh
# Requires: SLACK_WEBHOOK_URL environment variable
#

set -euo pipefail

CHECK_SCRIPT="/root/hyperliquid-hyperliquid-mm-complete/scripts/check_bot_alive.sh"
LAST_ALERT_FILE="/tmp/mm_bot_last_alert.txt"
ALERT_COOLDOWN=600  # 10 minutes between alerts

# Check if SLACK_WEBHOOK_URL is set
if [ -z "${SLACK_WEBHOOK_URL:-}" ]; then
    echo "⚠️  SLACK_WEBHOOK_URL not set - skipping alert"
    exit 0
fi

# Run health check
CHECK_OUTPUT=$("$CHECK_SCRIPT" 2>&1 || true)
CHECK_EXIT_CODE=$?

if [ "$CHECK_EXIT_CODE" -eq 0 ]; then
    # Bot is OK - clear last alert file
    rm -f "$LAST_ALERT_FILE"
    echo "✅ Bot is alive - no alert needed"
    exit 0
fi

# Bot is dead/hung - check cooldown
NOW=$(date +%s)
if [ -f "$LAST_ALERT_FILE" ]; then
    LAST_ALERT=$(cat "$LAST_ALERT_FILE")
    TIME_SINCE_LAST=$((NOW - LAST_ALERT))
    if [ "$TIME_SINCE_LAST" -lt "$ALERT_COOLDOWN" ]; then
        echo "🔇 Alert cooldown active ($TIME_SINCE_LAST / $ALERT_COOLDOWN seconds)"
        exit 0
    fi
fi

# Send Slack alert
STATUS=$(echo "$CHECK_OUTPUT" | head -1)
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")

MESSAGE=$(cat << EOFMSG
{
  "text": "⚠️ *MM Bot Alert*",
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "⚠️ MM Bot Alert"
      }
    },
    {
      "type": "section",
      "fields": [
        {
          "type": "mrkdwn",
          "text": "*Status:*\n\`$STATUS\`"
        },
        {
          "type": "mrkdwn",
          "text": "*Time:*\n$TIMESTAMP"
        }
      ]
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "\`\`\`$CHECK_OUTPUT\`\`\`"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Actions:*\n• SSH to server: \`ssh root@207.246.92.212\`\n• Check status: \`cd /root/hyperliquid-hyperliquid-mm-complete && ./collect_crash.sh\`\n• Restart: \`./start-bot.sh\`"
      }
    }
  ]
}
EOFMSG
)

# Send to Slack
RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
    --data "$MESSAGE" \
    "$SLACK_WEBHOOK_URL" || echo "ERROR")

if [ "$RESPONSE" = "ok" ]; then
    echo "✅ Slack alert sent successfully"
    echo "$NOW" > "$LAST_ALERT_FILE"
else
    echo "❌ Failed to send Slack alert: $RESPONSE"
fi
