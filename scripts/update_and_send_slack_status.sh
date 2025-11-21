#!/bin/bash
set -euo pipefail

BOT_DIR="/root/hyperliquid-hyperliquid-mm-complete"
cd "$BOT_DIR"

echo "📊 Updating account snapshot..."
npx tsx scripts/dump_account_snapshot.ts

echo "📤 Sending Slack status dashboard..."
npx tsx scripts/slack_status_dashboard.ts

echo "✅ Slack status update complete"
