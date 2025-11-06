#!/usr/bin/env bash
set -euo pipefail
LINES="${ALO_REJECT_LOG_WINDOW_LINES:-600}"          # okno analizy logów PM2
THRESH="${ALO_REJECT_ALERT_THRESHOLD:-80}"           # próg alertu
COOLDOWN="${ALO_REJECT_ALERT_COOLDOWN_SEC:-1800}"    # 30 min
STAMP=/root/hyperliquid-mm-bot-complete/runtime/.alo_last_ts

LOG="$(pm2 logs hyperliquid-mm --lines "$LINES" --nostream 2>&1 | grep -Ei "post only|would have immediately")"
CNT=$(printf "%s" "$LOG" | wc -l | tr -d " ")
NOW=$(date +%s); LAST=0; [ -f "$STAMP" ] && LAST=$(cat "$STAMP" 2>/dev/null || echo 0)

if [ "${CNT:-0}" -ge "$THRESH" ] && [ $((NOW-LAST)) -ge "$COOLDOWN" ]; then
  MSG="🚩 ALO rejects high: ${CNT} in last ${LINES} lines (threshold=${THRESH})."
  [ -n "${SLACK_WEBHOOK_URL:-}" ]   && curl -s -X POST -H "Content-type: application/json" --data "{\"text\":\"$MSG\"}" "$SLACK_WEBHOOK_URL" >/dev/null || true
  [ -n "${DISCORD_WEBHOOK_URL:-}" ] && curl -s -H "Content-Type: application/json" -d "{\"content\":\"$MSG\"}" "$DISCORD_WEBHOOK_URL" >/dev/null || true
  echo "$NOW" > "$STAMP"
else
  echo "alo_ok cnt=${CNT} (threshold=${THRESH}) cooldown_left=$((COOLDOWN-(NOW-LAST)))s" || true
fi
