#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete

LOG="runtime/mode_changes.log"
[ -f "$LOG" ] || { echo "No mode_changes.log found"; exit 0; }

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📡 Last 3 Mode Changes"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
tail -n 3 "$LOG" | awk "{print NR \". \" \$0}"
echo
