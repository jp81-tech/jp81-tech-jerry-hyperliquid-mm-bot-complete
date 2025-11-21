#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete
[ -f .env ] && set -a && . ./.env && set +a

SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_WATCHDOG:-${SLACK_WEBHOOK_URL:-}}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
RATE_LIMIT_FILE="/tmp/mm_watchdog_last_alert"
RATE_LIMIT_MINUTES=10

restarted=()

# Get all mm-*.timer units and check their trigger status
while read -r unit; do
  if [[ "$unit" == mm-*.timer ]]; then
    # Get trigger from systemctl status (more reliable than list-timers)
    trigger=$(systemctl status "$unit" 2>/dev/null | grep "Trigger:" | awk "{print \$2}" || echo "")
    if [ "$trigger" = "n/a" ] || [ -z "$trigger" ]; then
      echo "[$(date -u "+%Y-%m-%dT%H:%M:%S%z")] Detected $unit with NEXT=n/a - restarting..."
      systemctl restart "$unit" || true
      restarted+=("$unit")
    fi
  fi
done < <(systemctl list-unit-files "mm-*.timer" --no-pager | awk "NR>1 && /\.timer/{print \$1}")

if [ "${#restarted[@]}" -gt 0 ]; then
  # Check rate limit (suppress alerts if less than 10 min since last)
  send_alert=true
  if [ -f "$RATE_LIMIT_FILE" ]; then
    last_ts=$(stat -c %Y "$RATE_LIMIT_FILE" 2>/dev/null || echo 0)
    now_ts=$(date +%s)
    diff=$(( (now_ts - last_ts) / 60 ))
    if [ "$diff" -lt "$RATE_LIMIT_MINUTES" ]; then
      echo "⏱️ Watchdog: suppressing alert (last sent $diff min ago, limit: ${RATE_LIMIT_MINUTES}min)"
      send_alert=false
    fi
  fi

  if [ "$send_alert" = true ]; then
    ts="$(date -u "+%Y-%m-%d %H:%M:%S UTC")"
    summary="$(printf "%s\n" "${restarted[@]}" | sed "s/^/• /")"
    msg="🛡️ *MM Watchdog Alert*
Time: ${ts}
Action: restarted timers with NEXT=n/a
Restarted:
${summary}"

    if [ -n "$SLACK_WEBHOOK_URL" ]; then
      curl -s -X POST -H "Content-type: application/json" \
           --data "$(jq -Rn --arg t "$msg" "{text:\$t}")" \
           "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || true
    fi

    if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
      TG_API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage"
      curl -s -X POST "$TG_API" -d "chat_id=${TELEGRAM_CHAT_ID}" \
           --data-urlencode "text=${msg}" >/dev/null 2>&1 || true
    fi
    
    # Update rate limit timestamp
    touch "$RATE_LIMIT_FILE"
  fi
  
  exit 1
fi

exit 0
