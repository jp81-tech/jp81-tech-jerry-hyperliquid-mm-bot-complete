#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
base="$(cd "$SCRIPT_DIR/.." && pwd)"

# Check LEVERAGE setting
if ! grep -q '^LEVERAGE=' "$base/.env"; then
  echo "❌ LEVERAGE not found in .env"
  exit 1
fi

LEV=$(grep '^LEVERAGE=' "$base/.env" | cut -d= -f2)
if [ "$LEV" != "1" ]; then
  echo "⚠️  WARNING: LEVERAGE=$LEV (expected: 1)"
fi

# Check KILL_SWITCH
if [ -f "$base/runtime/KILL_SWITCH" ]; then
  KS=$(cat "$base/runtime/KILL_SWITCH" 2>/dev/null || echo "0")
  if [ "$KS" = "1" ]; then
    echo "🛑 KILL_SWITCH=1 - bot will not start"
    exit 1
  fi
fi

echo "✅ Integrity check passed"
exit 0
