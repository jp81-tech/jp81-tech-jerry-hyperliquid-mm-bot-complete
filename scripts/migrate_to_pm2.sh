#!/usr/bin/env bash
set -euo pipefail

echo "🛑 Stopping current bot process..."
pkill -f 'mm_hl.ts' || echo "No process to kill"
sleep 2

echo ""
echo "🚀 Starting bot via PM2..."
cd /root/hyperliquid-hyperliquid-mm-complete
pm2 delete hyperliquid-mm 2>/dev/null || echo "No existing PM2 process to delete"
pm2 start npm --name hyperliquid-mm --time -- start

sleep 3

echo ""
echo "💾 Saving PM2 config..."
pm2 save

echo ""
echo "✅ Bot is now managed by PM2"
echo ""
pm2 status hyperliquid-mm
echo ""
echo "Available commands:"
echo "  pm2 status hyperliquid-mm      - Check status"
echo "  pm2 logs hyperliquid-mm        - View logs  "
echo "  pm2 restart hyperliquid-mm     - Restart bot"
echo "  pm2 stop hyperliquid-mm        - Stop bot"
echo "  pm2 start hyperliquid-mm       - Start bot"
