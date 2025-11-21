#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

LOG_FILE="${LOG_FILE:-bot.log}"
ENV_FILE=".env"
HISTORY_WINDOW_DEFAULT=400
THRESHOLD_DEFAULT=20

if [ ! -f "$LOG_FILE" ]; then
  echo "log file not found: $LOG_FILE" >&2
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

WINDOW="${INVENTORY_ALERT_WINDOW:-$HISTORY_WINDOW_DEFAULT}"
THRESHOLD="${INVENTORY_ALERT_THRESHOLD:-$THRESHOLD_DEFAULT}"

RAW_LINES=$(tail -n "$WINDOW" "$LOG_FILE" | grep "\[INVENTORY_GUARD\]" || true)

if [ -z "$RAW_LINES" ]; then
  echo "No inventory guard entries in last $WINDOW lines."
  exit 0
fi

PY_OUTPUT=$(HITS_THRESHOLD="$THRESHOLD" python3 - <<'PY'
import os, sys, re, collections
threshold = int(os.environ.get("HITS_THRESHOLD", "20"))
lines = [line.strip() for line in sys.stdin if line.strip()]
pattern = re.compile(r'\[INVENTORY_GUARD\]\s+(\w+)\s+skip order\. side=(\w+).*?curPos=([-\d\.]+).*?max=([-\d\.]+)', re.IGNORECASE)
counts = collections.Counter()
last = {}
for line in lines:
    match = pattern.search(line)
    if not match:
        continue
    pair, side, cur_pos, max_cap = match.groups()
    counts[pair] += 1
    last[pair] = {
        "side": side.lower(),
        "cur": float(cur_pos),
        "max": float(max_cap),
        "line": line,
    }

alerts = []
for pair, count in counts.most_common():
    if count < threshold:
        continue
    info = last.get(pair, {})
    alerts.append(
        f"{pair}: {count} blocks (last side={info.get('side','?')}, cur={info.get('cur','?')}, cap={info.get('max','?')})"
    )

if alerts:
    print("\n".join(alerts))
PY
<<< "$RAW_LINES")

if [ -z "$PY_OUTPUT" ]; then
  echo "Inventory guard events below threshold (threshold=$THRESHOLD)."
  exit 0
fi

TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
MESSAGE="⚠️ Inventory guard alert ($TIMESTAMP UTC)
Threshold: $THRESHOLD hits within last $WINDOW log lines

$PY_OUTPUT

Hint: increase *_INVENTORY_CAP_USD or MAX_POSITION_USD, or manually flatten the position."

echo "$MESSAGE"

WEBHOOK="${SLACK_INVENTORY_GUARD_WEBHOOK:-${SLACK_WEBHOOK_WATCHDOG:-${SLACK_WEBHOOK_URL:-}}}"

if [ -z "$WEBHOOK" ]; then
  echo "No Slack webhook configured (SLACK_INVENTORY_GUARD_WEBHOOK / SLACK_WEBHOOK_WATCHDOG / SLACK_WEBHOOK_URL)."
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to send Slack payload. Install jq or skip Slack alerts." >&2
  exit 1
fi

PAYLOAD=$(printf '%s\n' "$MESSAGE" | jq -Rs '{text:.}')

curl -sS -X POST -H "Content-type: application/json" --data "$PAYLOAD" "$WEBHOOK" >/dev/null 2>&1 || {
  echo "Failed to send inventory guard alert to Slack."
  exit 1
}




