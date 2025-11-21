#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

LOG_FILE="bot.log"
STATE_FILE="data/bot_state.json"
STATE_DIR="runtime/watchdog"
mkdir -p "$STATE_DIR"
if ! command -v jq >/dev/null 2>&1; then
  echo "$(date -u +"%Y-%m-%d %H:%M:%S UTC") ❌ jq not found, aborting mm-bot health check"
  exit 1
fi
MAX_LOG_AGE="${MM_HEALTH_LOG_MAX_AGE:-120}"
MAX_SUBMIT_AGE="${MM_HEALTH_SUBMIT_MAX_AGE:-600}"
MAX_FILL_AGE="${MM_HEALTH_FILL_MAX_AGE:-900}"
SUBMIT_ALERT_COOLDOWN="${MM_HEALTH_SUBMIT_ALERT_COOLDOWN:-900}"
SLACK_WEBHOOK="${SLACK_MM_BOT_HEALTH_WEBHOOK:-${SLACK_WEBHOOK_WATCHDOG:-${SLACK_WEBHOOK_URL:-}}}"
NO_SUBMIT_ALERT_FILE="$STATE_DIR/last_submit_alert"

timestamp() {
  date -u +"%Y-%m-%d %H:%M:%S UTC"
}

send_slack() {
  local text="$1"
  [ -z "$SLACK_WEBHOOK" ] && return 0
  local payload
  payload=$(printf '%s\n' "$text" | jq -Rs '{text:.}')
  curl -sS -X POST -H "Content-type: application/json" --data "$payload" "$SLACK_WEBHOOK" >/dev/null 2>&1 || true
}

restart_bot() {
  echo "$(timestamp) 🔁 restarting mm-bot.service due to health issues" >&2
  systemctl restart mm-bot.service
}

issues=()
now=$(date +%s)
no_submit_issue=false
no_fill_issue=false

if ! systemctl is-active --quiet mm-bot.service; then
  issues+=("mm-bot.service inactive")
  restart_bot
fi

if [ ! -f "$LOG_FILE" ]; then
  issues+=("bot.log missing")
else
  last_mod=$(stat -c %Y "$LOG_FILE")
  if (( now - last_mod > MAX_LOG_AGE )); then
    issues+=("log heartbeat older than ${MAX_LOG_AGE}s")
    restart_bot
  fi

  last_submit_line="$(grep -a 'quant_evt=submit' "$LOG_FILE" | tail -n 1 || true)"
  if [[ -z "$last_submit_line" ]]; then
    issues+=("no quant_evt=submit entries found in bot.log")
    no_submit_issue=true
  else
    last_submit_epoch=0
    last_submit_ts=""
    if [[ $last_submit_line =~ ts=([0-9T:\.\-]+Z) ]]; then
      last_submit_ts="${BASH_REMATCH[1]}"
      if parsed_epoch=$(date -u -d "$last_submit_ts" +%s 2>/dev/null); then
        last_submit_epoch=$parsed_epoch
      fi
    elif [[ $last_submit_line =~ tms=([0-9]+) ]]; then
      last_submit_epoch=$(( BASH_REMATCH[1] / 1000 ))
    fi

    if (( last_submit_epoch == 0 )); then
      issues+=("unable to parse last quant_evt=submit timestamp")
      no_submit_issue=true
    else
      submit_age=$(( now - last_submit_epoch ))
      if (( submit_age > MAX_SUBMIT_AGE )); then
        desc="no quant_evt=submit for ${submit_age}s (threshold ${MAX_SUBMIT_AGE}s)"
        if [[ -n "$last_submit_ts" ]]; then
          desc="$desc, last ts=$last_submit_ts"
        fi
        issues+=("$desc")
        no_submit_issue=true
      fi
    fi
  fi

  last_fill_line="$(grep -a 'quant_evt=fill' "$LOG_FILE" | tail -n 1 || true)"
  if [[ -z "$last_fill_line" ]]; then
    issues+=("no quant_evt=fill entries found in bot.log")
    no_fill_issue=true
  else
    last_fill_epoch=0
    last_fill_ts=""
    if [[ $last_fill_line =~ ts=([0-9T:\.\-]+Z) ]]; then
      last_fill_ts="${BASH_REMATCH[1]}"
      if parsed_epoch=$(date -u -d "$last_fill_ts" +%s 2>/dev/null); then
        last_fill_epoch=$parsed_epoch
      fi
    elif [[ $last_fill_line =~ tms=([0-9]+) ]]; then
      last_fill_epoch=$(( BASH_REMATCH[1] / 1000 ))
    fi

    if (( last_fill_epoch == 0 )); then
      issues+=("unable to parse last quant_evt=fill timestamp")
      no_fill_issue=true
    else
      fill_age=$(( now - last_fill_epoch ))
      if (( fill_age > MAX_FILL_AGE )); then
        desc="no quant_evt=fill for ${fill_age}s (threshold ${MAX_FILL_AGE}s)"
        if [[ -n "$last_fill_ts" ]]; then
          desc="$desc, last ts=$last_fill_ts"
        fi
        issues+=("$desc")
        no_fill_issue=true
      fi
    fi
  fi
fi

if ! curl -sS --max-time 5 -o /dev/null https://api.hyperliquid.xyz/info; then
  issues+=("Hyperliquid API unreachable")
fi

if (( ${#issues[@]} == 0 )); then
  echo "$(timestamp) ✅ mm-bot health OK"
  exit 0
fi

summary="$(timestamp) ⚠️ mm-bot health check detected issues:"
for issue in "${issues[@]}"; do
  summary="$summary"$'\n'"- $issue"
done

if [ -n "$STATE_FILE" ] && [ -f "$STATE_FILE" ]; then
  last_pnl=$(jq -r '.dailyPnl // "unknown"' "$STATE_FILE" 2>/dev/null || echo "unknown")
  summary="$summary"$'\n'"Last known dailyPnL: $last_pnl"
fi

echo "$summary"

should_send=true
if $no_submit_issue && ! $no_fill_issue && (( ${#issues[@]} == 1 )); then
  last_alert_ts=$(cat "$NO_SUBMIT_ALERT_FILE" 2>/dev/null || echo 0)
  if (( now - last_alert_ts < SUBMIT_ALERT_COOLDOWN )); then
    should_send=false
  fi
fi

if $should_send; then
  send_slack "$summary"
  if $no_submit_issue; then
    echo "$now" > "$NO_SUBMIT_ALERT_FILE"
  fi
else
  echo "$(timestamp) ⚠️ no-submit alert suppressed (cooldown active)"
fi

exit 0
