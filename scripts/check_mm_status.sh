#!/usr/bin/env bash
BOT_NAME="mm_hl.ts"
SLACK_WEBHOOK="https://hooks.slack.com/services/TWOJ/WEBHOOK/TUTAJ"

if ! pgrep -f "$BOT_NAME" > /dev/null; then
  MESSAGE="🚨 *ALERT:* Bot $BOT_NAME nie działa na serwerze $(hostname)."
  curl -X POST -H 'Content-type: application/json' \
    --data "{\"text\":\"$MESSAGE\"}" "$SLACK_WEBHOOK"
else
  echo "✅ Bot działa poprawnie."
fi
