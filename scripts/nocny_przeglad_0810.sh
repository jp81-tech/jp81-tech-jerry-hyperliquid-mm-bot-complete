#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete
OUT="$(/root/hyperliquid-mm-bot-complete/scripts/nocny_przeglad.sh 2>&1 || true)"
printf "%s\n" "$OUT" >> runtime/daily_review_0810.log

if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
  curl -s -X POST -H "Content-type: application/json" \
    --data "{\"text\":\"$(printf "%s" "$OUT" | sed -e "s/\\\\/\\\\\\\\/g" -e "s/\"/\\\\\"/g" | head -n 60)\"}" \
    "$SLACK_WEBHOOK_URL" >/dev/null || true
fi

if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
  curl -s -H "Content-Type: application/json" \
    -d "{\"content\":\"$(printf "%s" "$OUT" | sed -e "s/\\\\/\\\\\\\\/g" -e "s/\"/\\\\\"/g" | head -n 20)\"}" \
    "$DISCORD_WEBHOOK_URL" >/dev/null || true
fi

crontab -l 2>/dev/null | grep -v nocny_przeglad_0810.sh | crontab - || true
