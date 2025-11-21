#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f ".env" ]; then
  set -a
  . ./.env
  set +a
fi

AUDIT_OUTPUT=$(npx tsx scripts/safety_audit.ts)

# Determine best available webhook: dedicated → override → global
WEBHOOK="${SLACK_SAFETY_AUDIT_WEBHOOK:-${SLACK_SAFETY_OVERRIDE_WEBHOOK:-${SLACK_WEBHOOK_URL:-}}}"

if [ -z "${WEBHOOK:-}" ]; then
  echo "No Slack webhook configured (SLACK_SAFETY_AUDIT_WEBHOOK / SLACK_SAFETY_OVERRIDE_WEBHOOK / SLACK_WEBHOOK_URL)."
  echo "Printing audit only:"
  echo
  printf '%s\n' "$AUDIT_OUTPUT"
  exit 0
fi

# Validate audit output
if [ -z "$AUDIT_OUTPUT" ]; then
  echo "❌ safety_audit.ts returned empty output — aborting."
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq not available, cannot JSON-encode payload for Slack."
  echo
  printf '%s\n' "$AUDIT_OUTPUT"
  exit 1
fi

PAYLOAD=$(printf '%s\n' "$AUDIT_OUTPUT" | jq -Rs '{text:.}')

curl -sS -X POST \
  -H "Content-type: application/json" \
  --data "$PAYLOAD" \
  "$WEBHOOK" >/dev/null

echo "Safety audit sent to Slack."
