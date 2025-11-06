#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete

APP="hyperliquid-mm"
STATE_DIR="runtime/watchdog"
BASELINE="$STATE_DIR/baseline.txt"
WINDOW=3600
THRESHOLD=3

mkdir -p "$STATE_DIR"

CUR=$(pm2 jlist | jq -r ".[] | select(.name==\"$APP\") | .pm2_env.restart_time" 2>/dev/null || echo 0)
NOW=$(date -u +%s)

if [ ! -f "$BASELINE" ]; then
  echo "$NOW $CUR" > "$BASELINE"
  exit 0
fi

read BASE_TS BASE_COUNT < "$BASELINE" || { echo "$NOW $CUR" > "$BASELINE"; exit 0; }
DELTA=$(( CUR - BASE_COUNT ))
ELAPSED=$(( NOW - BASE_TS ))

if [ "$DELTA" -ge "$THRESHOLD" ] && [ "$ELAPSED" -le "$WINDOW" ]; then
  prev=$(ls -1t backups/env/.env.* 2>/dev/null | head -1 || true)
  if [ -n "$prev" ]; then
    set +e
    set -a
    [ -f .env ] && . ./.env
    set +a
    set -e
    cp "$prev" .env
    cp .env src/.env 2>/dev/null || true

    HOOK=""
    [ -n "${SLACK_WEBHOOK_URL:-}" ] && HOOK="$SLACK_WEBHOOK_URL"
    [ -z "$HOOK" ] && [ -n "${DISCORD_WEBHOOK_URL:-}" ] && HOOK="$DISCORD_WEBHOOK_URL"
    if [ -n "$HOOK" ]; then
      MSG="🛟 AUTO-RESTORE TRIGGERED\nReason: ${DELTA} restarts in last ${ELAPSED}s\nRestored: $(basename "$prev")"
      if [[ "$HOOK" == *"discord"* ]]; then
        curl -s -X POST -H "Content-Type: application/json" -d "{\"content\":\"$MSG\"}" "$HOOK" >/dev/null || true
      else
        curl -s -X POST -H "Content-Type: application/json" -d "{\"text\":\"$MSG\"}" "$HOOK" >/dev/null || true
      fi
    fi

    pm2 restart "$APP" --update-env || true
    echo "$NOW $CUR" > "$BASELINE"
    exit 0
  fi
fi

if [ "$ELAPSED" -gt "$WINDOW" ]; then
  echo "$NOW $CUR" > "$BASELINE"
fi
