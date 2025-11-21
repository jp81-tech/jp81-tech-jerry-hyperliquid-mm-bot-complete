#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

LOG_FILE="${BOT_LOG_MONITOR_FILE:-bot.log}"
PATTERN_CSV="${BOT_LOG_MONITOR_PATTERNS:-[FATAL],[PANIC],[CB],[PUMP_WARN],[SMART_MONEY_COOLDOWN],[DEFENSIVE],SOL suppression active}"
THROTTLE="${BOT_LOG_MONITOR_THROTTLE_SEC:-60}"
MAX_LEN="${BOT_LOG_MONITOR_MAX_LEN:-600}"
WEBHOOK="${SLACK_LOG_MONITOR_WEBHOOK:-${SLACK_WEBHOOK_WATCHDOG:-${SLACK_WEBHOOK_RISK:-}}}"
TAG="${BOT_LOG_MONITOR_TAG:-bot.log monitor}"

if [[ -z "$WEBHOOK" ]]; then
  echo "[bot-log-monitor] No Slack webhook configured; exiting"
  exit 0
fi

IFS=',' read -r -a raw_patterns <<< "$PATTERN_CSV"
patterns=()
for entry in "${raw_patterns[@]}"; do
  trimmed="$(echo "$entry" | xargs || true)"
  [[ -z "$trimmed" ]] && continue
  patterns+=("$trimmed")
done

if (( ${#patterns[@]} == 0 )); then
  echo "[bot-log-monitor] No valid patterns configured; exiting"
  exit 0
fi

if [[ ! -f "$LOG_FILE" ]]; then
  echo "[bot-log-monitor] Waiting for $LOG_FILE to be created..."
  touch "$LOG_FILE"
fi

send_slack() {
  local pattern="$1"
  local line="$2"
  local trimmed="$line"
  if (( ${#trimmed} > MAX_LEN )); then
    trimmed="${trimmed:0:MAX_LEN}…"
  fi
  local payload
  payload=$(printf '*%s*\npattern `%s`\n```%s```' "$TAG" "$pattern" "$trimmed" | jq -Rs '{text:.}')
  curl -sS -X POST -H "Content-type: application/json" --data "$payload" "$WEBHOOK" >/dev/null 2>&1 || true
}

declare -A last_sent=()

monitor() {
  while IFS= read -r line; do
    for pattern in "${patterns[@]}"; do
      if [[ "$line" == *"$pattern"* ]]; then
        now=$(date +%s)
        last="${last_sent[$pattern]:-0}"
        if (( now - last < THROTTLE )); then
          continue
        fi
        last_sent[$pattern]=$now
        send_slack "$pattern" "$line"
        break
      fi
    done
  done < <(stdbuf -oL -eL tail -Fn0 "$LOG_FILE")
}

monitor

