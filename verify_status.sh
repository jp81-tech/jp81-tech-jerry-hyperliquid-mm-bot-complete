#!/bin/bash

echo "═══════════════════════════════════════════════════════"
echo "🔥 Hyperliquid MM Bot - Status Verification"
echo "═══════════════════════════════════════════════════════"
echo ""

echo "📊 Bot Status:"
pm2 status hyperliquid-mm | tail -4

echo ""
echo "⚙️  Current Profile:"
grep -E '^BASE_ORDER_USD|^CLIP_USD|^BASE_INTERVAL_SEC|^ACTIVE_LAYERS|^MAKER_SPREAD_BPS_MIN|^MAKER_SPREAD_BPS_MAX|^ENABLE_QUOTE_CHASE|^MAX_OPEN_NOTIONAL_USD' /root/hyperliquid-mm-bot-complete/.env

echo ""
echo "🏛️  Layer Deployment:"
pm2 logs hyperliquid-mm --lines 100 --nostream 2>&1 | grep 'Multi-Layer.*orders' | tail -4

echo ""
echo "📈 Active Orders:"
cd /root/hyperliquid-mm-bot-complete && npx tsx scripts/check-all-orders.ts 2>&1 | tail -15

echo ""
echo "⚡ Last Hour Performance:"
cd /root/hyperliquid-mm-bot-complete && npx tsx scripts/alerts.ts 2>&1 | tail -10

echo ""
echo "═══════════════════════════════════════════════════════"
