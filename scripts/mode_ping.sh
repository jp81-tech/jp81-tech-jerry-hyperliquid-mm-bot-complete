#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete
HOOK="${SLACK_WEBHOOK_URL:-${DISCORD_WEBHOOK_URL:-}}"
[ -n "${HOOK}" ] || exit 0
LOG="runtime/mode_changes.log"
STAMP="runtime/mode_ping.stamp"
[ -s "$LOG" ] || exit 0
last_line="$(tail -1 "$LOG" || true)"
[ -n "$last_line" ] || exit 0
hash="$(printf "%s" "$last_line" | sha256sum 2>/dev/null | awk "{print \$1}")"
[ -n "$hash" ] || hash="$(printf "%s" "$last_line" | shasum -a 256 2>/dev/null | awk "{print \$1}")"
[ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$hash" ] && exit 0
ts="$(printf "%s" "$last_line" | awk "{print \$1\" \"\$2}")"
kind="$(printf "%s" "$last_line" | awk "{print \$3}")"
fromto="$(printf "%s" "$last_line" | awk "{print \$4}")"
metrics="$(printf "%s" "$last_line" | cut -d" " -f5-)"
short="Mode change: ${kind} ${fromto}  |  ${metrics}  |  ${ts}Z"
if [[ "$HOOK" == *"discord"* ]]; then
  curl -s -X POST -H "Content-Type: application/json" -d "{\"content\":\"$short\"}" "$HOOK" >/dev/null
else
  curl -s -X POST -H "Content-Type: application/json" -d "{\"text\":\"$short\"}" "$HOOK" >/dev/null
fi
printf "%s" "$hash" > "$STAMP"
