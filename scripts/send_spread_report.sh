#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1090
  source ./.env
  set +a
fi

MAIN_SNIPPET=$(npx tsx scripts/gen_spread_snippet.ts)
MINI_TABLE=$(npx tsx scripts/gen_spread_minitable.ts)

# Determine webhook priority: dedicated spread → override → global
WEBHOOK="${SLACK_SPREAD_WEBHOOK:-${SLACK_SPREAD_OVERRIDE_WEBHOOK:-${SLACK_WEBHOOK_URL:-}}}"

if [ -z "${WEBHOOK:-}" ]; then
  echo "No Slack webhook configured (SLACK_SPREAD_WEBHOOK / SLACK_SPREAD_OVERRIDE_WEBHOOK / SLACK_WEBHOOK_URL)."
  echo "Printing report only:"
  echo
  printf '%s\n\n%s\n' "$MAIN_SNIPPET" "$MINI_TABLE"
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq not available, cannot JSON-encode payload for Slack."
  exit 1
fi

# Validate snippet generation
if [ -z "$MAIN_SNIPPET" ] || [ -z "$MINI_TABLE" ]; then
  echo "❌ Failed to generate spread snippets (MAIN_SNIPPET or MINI_TABLE empty)."
  exit 1
fi

PAYLOAD=$(jq -n --arg main "$MAIN_SNIPPET" --arg mini "$MINI_TABLE" '{text: ($main + "\n\n" + $mini)}')

curl -sS -X POST -H "Content-type: application/json" \
  --data "$PAYLOAD" \
  "$WEBHOOK" >/dev/null

echo "Spread report sent to Slack."
