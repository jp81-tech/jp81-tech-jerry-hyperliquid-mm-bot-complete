#!/usr/bin/env bash
set -euo pipefail

is_number() {
  local value="${1:-}"
  [[ $value =~ ^-?[0-9]+([.][0-9]+)?$ ]]
}

uppercase_safe() {
  local value="${1:-}"
  value=$(printf '%s' "$value" | tr '[:lower:]' '[:upper:]')
  printf '%s' "$value" | tr -c 'A-Z0-9_' '_'
}

format_money() {
  local value="${1:-}"
  if is_number "$value"; then
    printf '%.2f' "$value"
  else
    printf 'N/A'
  fi
}

cd "$(dirname "$0")/.."

STATE_FILE="data/bot_state.json"
LOG_FILE="bot.log"
HISTORY_FILE="data/daily_pnl_history.txt"
LEVEL_STATE_FILE="data/daily_pnl_level.txt"

if [ -f ".env" ]; then
  set -a
  . ./.env
  set +a
fi

PNL_PROFILE_VAR=""
PROFILE_WEBHOOK=""
if [ -n "${PNL_PROFILE:-}" ]; then
  PROFILE_TAG=$(uppercase_safe "$PNL_PROFILE")
  if [ -n "$PROFILE_TAG" ]; then
    PNL_PROFILE_VAR="SLACK_${PROFILE_TAG}_PNL_WEBHOOK"
    PROFILE_WEBHOOK="${!PNL_PROFILE_VAR:-}"
  fi
fi

if [ ! -f "$STATE_FILE" ]; then
  echo "state file not found: $STATE_FILE" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required but not installed." >&2
  exit 1
fi

DAILY_THRESHOLD_WARN="${DAILY_THRESHOLD_WARN:--300}"
DAILY_THRESHOLD_CRIT="${DAILY_THRESHOLD_CRIT:--700}"
DAILY_THRESHOLD_GOOD="${DAILY_THRESHOLD_GOOD:-150}"
PAIR_MAX_DRAWDOWN_USD="${PAIR_MAX_DRAWDOWN_USD:-800}"

SLACK_PRIMARY="${SLACK_DAILY_PNL_OVERRIDE_WEBHOOK:-${PROFILE_WEBHOOK:-${SLACK_DAILY_PNL_WEBHOOK:-${SLACK_WEBHOOK_URL:-}}}}"
SLACK_CRIT="${SLACK_DAILY_PNL_CRIT_WEBHOOK:-}"

read -r DAILY_PNL DAILY_ANCHOR TOTAL_PNL < <(jq -r '[.dailyPnl, .dailyPnlAnchorUsd, .totalPnl] | @tsv' "$STATE_FILE") || true

DAILY_PNL_VALUE=""
if is_number "$DAILY_PNL"; then
  DAILY_PNL_VALUE="$DAILY_PNL"
fi

LAST_STATUS=""
if [ -f "$LOG_FILE" ]; then
  LAST_STATUS=$(grep "Status | Daily PnL:" "$LOG_FILE" | tail -n 1 || true)
fi

LEVEL="NEUTRAL"
if [ -n "$DAILY_PNL_VALUE" ]; then
  LEVEL=$(awk -v v="$DAILY_PNL_VALUE" -v warn="$DAILY_THRESHOLD_WARN" -v crit="$DAILY_THRESHOLD_CRIT" -v good="$DAILY_THRESHOLD_GOOD" 'BEGIN {
    if (v+0 <= crit+0)      print "CRIT";
    else if (v+0 <= warn+0) print "WARN";
    else if (v+0 >= good+0) print "GOOD";
    else                    print "OK";
  }')
fi

case "$LEVEL" in
  CRIT) EMOJI="🔴"; LABEL="CRITICAL" ;;
  WARN) EMOJI="🟠"; LABEL="WARNING" ;;
  GOOD) EMOJI="🟢"; LABEL="GOOD" ;;
  OK)   EMOJI="🟡"; LABEL="OK" ;;
  *)    EMOJI="⚪"; LABEL="NEUTRAL" ;;
esac

NOW_UTC=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
TODAY_UTC=$(date -u +"%Y-%m-%d")

mkdir -p "$(dirname "$HISTORY_FILE")"
SKIP_HISTORY_FLAG=$(printf '%s' "${PNL_SKIP_HISTORY:-false}" | tr '[:upper:]' '[:lower:]')
if [ "$SKIP_HISTORY_FLAG" != "true" ] && [ -n "$DAILY_PNL_VALUE" ]; then
  TMP_HISTORY=$(mktemp)
  if [ -f "$HISTORY_FILE" ]; then
    grep -v "^$TODAY_UTC\t" "$HISTORY_FILE" > "$TMP_HISTORY" || true
  fi
  printf '%s\t%.2f\n' "$TODAY_UTC" "$DAILY_PNL_VALUE" >> "$TMP_HISTORY"
  mv "$TMP_HISTORY" "$HISTORY_FILE"
fi

SPARKLINE=""
if [ -s "$HISTORY_FILE" ]; then
  SPARKLINE=$(HISTORY_PATH="$HISTORY_FILE" python3 - <<'PY'
import os, math, pathlib, sys
path = pathlib.Path(os.environ["HISTORY_PATH"])
lines = [line.strip() for line in path.read_text().splitlines() if line.strip()]
lines = lines[-7:]
if not lines:
    print("  (history pending)")
    sys.exit()
pairs = [line.split('\t', 1) for line in lines]
vals = [float(p[1]) for p in pairs]
span = max(max(abs(v) for v in vals), 1e-9)
width = 20
for date, value in pairs:
    val = float(value)
    length = 0 if span == 0 else int(round(abs(val) / span * width))
    if length == 0 and abs(val) > 0:
        length = 1
    char = '#' if val >= 0 else '-'
    bar = char * length
    print(f"{date} {val:8.2f} | {bar}")
PY
  )
fi

PAIR_PNL_TABLE=""
PAIR_SAFETY_TABLE=""
if [ -f "$STATE_FILE" ]; then
  PAIR_PNL_LINES=$(jq -r '
    .perPairDailyPnl // .perPairPnl // {} 
    | to_entries
    | sort_by(.key)
    | map("\(.key)\t\(.value)")
    | .[]
  ' "$STATE_FILE" 2>/dev/null || true)
  if [ -n "${PAIR_PNL_LINES:-}" ] && [ "$PAIR_PNL_LINES" != "null" ]; then
    while IFS=$'\t' read -r pair pnl; do
      [ -z "$pair" ] && continue
      if is_number "$pnl"; then
        formatted=$(format_money "$pnl")
        PAIR_PNL_TABLE="${PAIR_PNL_TABLE}  $(printf '%-6s' "$pair") \$${formatted}"$'\n'

        # Safety level per pair based on PAIR_MAX_DRAWDOWN_USD
        level=$(awk -v v="$pnl" -v dd="$PAIR_MAX_DRAWDOWN_USD" 'BEGIN {
          if (dd <= 0) { print "OK"; exit }
          if (v <= -dd)       print "CRIT";
          else if (v <= -dd/2.0) print "WARN";
          else if (v >= dd/2.0)  print "GOOD";
          else                  print "OK";
        }')
        emoji="✅"
        label="OK"
        case "$level" in
          CRIT) emoji="🟥"; label="CRIT" ;;
          WARN) emoji="🟧"; label="WARN" ;;
          GOOD) emoji="🟩"; label="GOOD" ;;
          *)    emoji="✅"; label="OK" ;;
        esac
        PAIR_SAFETY_TABLE="${PAIR_SAFETY_TABLE}  $(printf '%-6s' "$pair") $emoji $(printf '%8s' "$label") (\$${formatted})"$'\n'
      fi
    done <<< "$PAIR_PNL_LINES"
  fi
fi

REPORT="$EMOJI $LABEL Daily PnL report ($NOW_UTC)
  Daily PnL: \$$(format_money "$DAILY_PNL_VALUE")
  Anchor: \$$(format_money "$DAILY_ANCHOR")
  Total PnL: \$$(format_money "$TOTAL_PNL")"

if [ -n "$LAST_STATUS" ]; then
  REPORT="$REPORT

Last bot status:
  $LAST_STATUS"
fi

if [ -n "$PAIR_PNL_TABLE" ]; then
  REPORT="$REPORT

Per-pair Daily PnL:
$PAIR_PNL_TABLE"
fi

if [ -n "$PAIR_SAFETY_TABLE" ]; then
  REPORT="$REPORT

Safety audit per pair (threshold=\$${PAIR_MAX_DRAWDOWN_USD}):
$PAIR_SAFETY_TABLE"
fi

if [ -n "$SPARKLINE" ]; then
  REPORT="$REPORT

History (last 7 days):
$SPARKLINE"
fi

LAST_DATE=""
LAST_LEVEL=""
if [ -f "$LEVEL_STATE_FILE" ]; then
  read -r LAST_DATE LAST_LEVEL < "$LEVEL_STATE_FILE" || true
fi
printf '%s %s\n' "$TODAY_UTC" "$LEVEL" > "$LEVEL_STATE_FILE"

HARD_ALERT=false
if [ "$LEVEL" = "CRIT" ] && [ "${LAST_LEVEL:-}" = "CRIT" ] && [ "${LAST_DATE:-}" != "$TODAY_UTC" ]; then
  HARD_ALERT=true
fi

echo "$REPORT"

if [ -z "$SLACK_PRIMARY" ] && [ -z "$SLACK_CRIT" ]; then
  echo
  echo "No Slack webhook set (SLACK_DAILY_PNL_WEBHOOK / SLACK_WEBHOOK_URL / SLACK_DAILY_PNL_CRIT_WEBHOOK). Skipping Slack send."
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo
  echo "jq not available, cannot JSON-encode payload for Slack."
  exit 1
fi

send_slack() {
  local webhook="$1"
  local text="$2"
  [ -z "$webhook" ] && return 0
  local payload
  payload=$(printf '%s\n' "$text" | jq -Rs '{text:.}')
  curl -sS -X POST -H "Content-type: application/json" --data "$payload" "$webhook" >/dev/null 2>&1 || true
}

if $HARD_ALERT; then
  REPORT=$'🚨 HARD ALERT: 2 days in a row CRIT\n'"$REPORT"
fi

if [ "$LEVEL" = "CRIT" ] && [ -n "$SLACK_CRIT" ]; then
  send_slack "$SLACK_CRIT" "$REPORT"
  [ -n "$SLACK_PRIMARY" ] && send_slack "$SLACK_PRIMARY" "$REPORT"
else
  [ -n "$SLACK_PRIMARY" ] && send_slack "$SLACK_PRIMARY" "$REPORT"
fi

echo
echo "Daily PnL report sent to Slack."
