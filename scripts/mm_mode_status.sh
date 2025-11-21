#!/usr/bin/env bash
set -e

ROOT="/root/hyperliquid-hyperliquid-mm-complete"
cd "$ROOT" || exit 1

echo "════════ MM BOT MODE STATUS ════════"
date
echo

if [ ! -f .env ]; then
  echo "❌ .env not found!"
  exit 1
fi

# Check current mode
DRY_RUN=$(grep -E '^DRY_RUN=' .env | cut -d= -f2 || echo "unknown")

echo "▶ Current configuration:"
echo "   DRY_RUN: $DRY_RUN"

if [ "$DRY_RUN" = "1" ]; then
  echo "   Mode: 📄 PAPER TRADING (Safe)"
elif [ "$DRY_RUN" = "0" ]; then
  echo "   Mode: 💰 LIVE TRADING (Real money at risk!)"
else
  echo "   Mode: ⚠️  UNKNOWN"
fi

echo
echo "▶ Available configs:"
[ -f .env.paper ] && echo "   ✅ .env.paper exists" || echo "   ❌ .env.paper missing"
[ -f .env.live ] && echo "   ✅ .env.live exists" || echo "   ❌ .env.live missing"

echo
echo "▶ Recent backups:"
ls -lht .env.backup_* 2>/dev/null | head -5 | awk '{print "   " $9 " (" $6 " " $7 " " $8 ")"}' || echo "   (no backups found)"

echo
echo "▶ PM2 bot status:"
pm2 status hyperliquid-mm | sed -n '3,7p'

echo "════════ DONE ════════"
