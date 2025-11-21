#!/usr/bin/env bash
set -euo pipefail

cd /root/hyperliquid-hyperliquid-mm-complete

echo "════════════════════════════════════════════════════════"
echo "🌅 MORNING HEALTH CHECK - $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════════════════════"
echo

echo "📊 POSITIONS:"
npx tsx scripts/check_positions.ts
echo

echo "📋 OPEN ORDERS:"
npx tsx scripts/check-all-orders.ts | head -30
echo

echo "🔄 RECENT ROTATIONS:"
tail -200 bot.log | grep '🧭 Rotation' | tail -3
echo

echo "✅ RECENT FILLS:"
tail -200 bot.log | grep 'quant_evt=submit' | tail -20
echo

echo "⚙️  BOT PROCESS:"
pgrep -f 'mm_hl.ts' && echo "✅ Process running" || echo "❌ Process NOT running"
echo

echo "════════════════════════════════════════════════════════"
echo "Health check complete at $(date '+%H:%M:%S')"
echo "════════════════════════════════════════════════════════"
