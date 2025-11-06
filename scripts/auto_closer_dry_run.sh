#!/usr/bin/env bash
# Quick DRY_RUN test helper for auto_closer
set -euo pipefail
cd "$(dirname "$0")/.."

echo "🧪 Running auto_closer in DRY_RUN mode..."
echo ""

DRY_RUN=1 VERBOSE=1 npx tsx scripts/auto_closer.ts

echo ""
echo "📋 Last 10 log entries:"
tail -10 runtime/auto_closer.log | grep --color=auto -E "DRY_RUN|DENY POSITION|would send|OK|fatal|$"
