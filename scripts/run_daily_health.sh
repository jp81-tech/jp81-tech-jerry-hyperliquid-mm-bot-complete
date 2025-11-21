#!/usr/bin/env bash
set -Eeuo pipefail

LOG_DIR="/root/hyperliquid-mm-bot-complete/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/daily-health.$(date -u +%F_%H%M%S).log"

{
  echo "=== Daily Health Wrapper @ $(date -u) (UTC) ==="
  # Załaduj env jeżeli jest (nie przerywaj, gdy brak):
  source /root/hyperliquid-mm-bot-complete/.env 2>/dev/null || true

  # Odpal właściwy raport (niech zwróci błąd jeśli coś nie wyjdzie — my to przechwycimy):
  bash /root/hyperliquid-mm-bot-complete/scripts/daily-health.sh
} &> "$LOG_FILE" || {
  echo "WARN: daily-health.sh exited non-zero. See $LOG_FILE" >> "$LOG_FILE"
}

SLACK_WEBHOOK="${SLACK_WEBHOOK_DAILY_HEALTH:-${SLACK_WEBHOOK_ALERTS:-${SLACK_WEBHOOK_URL:-}}}"
SEND_ONLY_ON_WARN=0
MAX_CHARS=3500

if [ -n "$SLACK_WEBHOOK" ] && [ -f "$LOG_FILE" ]; then
  SHOULD_SEND=0
  if [ "$SEND_ONLY_ON_WARN" -eq 1 ]; then
    if grep -qiE "WARN|Failed|Failure|error|E_TICK|Deactivated.*failure" "$LOG_FILE"; then
      SHOULD_SEND=1
    fi
  else
    SHOULD_SEND=1
  fi

  if [ "$SHOULD_SEND" -eq 1 ]; then
    PAYLOAD=$(awk -v m="$MAX_CHARS" '{s=s $0 ORS; if (length(s)>=m){print s; exit}} END{if(length(s)<m) print s}' "$LOG_FILE" | sed 's/\\/\\\\/g; s/"/\\"/g')
    curl -s -X POST -H "Content-type: application/json" \
      --data "{\"text\":\"\`\`\`\n${PAYLOAD}\n\`\`\`\"}" \
      "$SLACK_WEBHOOK" >/dev/null 2>&1 || true
  fi
else
  if [ -z "$SLACK_WEBHOOK" ]; then
    echo "[run-daily-health] Missing Slack webhook env (SLACK_WEBHOOK_DAILY_HEALTH / SLACK_WEBHOOK_ALERTS / SLACK_WEBHOOK_URL)" >&2
  fi
fi

# ZAWSZE zakończ sukcesem, żeby systemd nie raportował failure
exit 0
