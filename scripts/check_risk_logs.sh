#!/usr/bin/env bash
# Quick Risk Management Log Checker
# Sprawdza czy wszystkie warstwy risk management działają poprawnie

set -euo pipefail

BOT_LOG="${BOT_LOG:-/root/hyperliquid-mm-bot-complete/bot.log}"
SINCE="${SINCE:-today}"

echo "🔍 Risk Management Log Checker"
echo "================================"
echo ""

# A. Soft SL
echo "📊 A. Soft SL / Per-Pair Max Loss:"
echo "-----------------------------------"
if [ -f "$BOT_LOG" ]; then
  grep -i "SOFT SL HIT" "$BOT_LOG" | tail -n 10 || echo "   (brak logów)"
else
  journalctl -u mm-bot.service --since "$SINCE" --no-pager | grep -i "SOFT SL" | tail -n 10 || echo "   (brak logów)"
fi
echo ""

# B. Nansen Conflict SL
echo "📊 B. Nansen Conflict Stop Loss:"
echo "--------------------------------"
if [ -f "$BOT_LOG" ]; then
  grep "NANSEN CONFLICT SL" "$BOT_LOG" | tail -n 10 || echo "   (brak logów)"
  echo "   Cost-benefit:"
  grep "NANSEN-SL" "$BOT_LOG" | tail -n 5 || echo "   (brak logów)"
else
  journalctl -u mm-bot.service --since "$SINCE" --no-pager | grep "NANSEN CONFLICT SL" | tail -n 10 || echo "   (brak logów)"
fi
echo ""

# C. Behavioural Risk
echo "📊 C. Behavioural Risk (Anti-FOMO / Anti-Knife):"
echo "-------------------------------------------------"
if [ -f "$BOT_LOG" ]; then
  grep -E "BehaviouralRisk|BehaviouralGuard" "$BOT_LOG" | tail -n 15 || echo "   (brak logów)"
else
  journalctl -u mm-bot.service --since "$SINCE" --no-pager | grep -E "BehaviouralRisk|BehaviouralGuard" | tail -n 15 || echo "   (brak logów)"
fi
echo ""

# D. Notional Caps
echo "📊 D. Notional Caps:"
echo "--------------------"
if [ -f "$BOT_LOG" ]; then
  grep -i "notional.*cap\|position notional" "$BOT_LOG" | tail -n 10 || echo "   (brak logów)"
else
  journalctl -u mm-bot.service --since "$SINCE" --no-pager | grep -i "notional.*cap\|position notional" | tail -n 10 || echo "   (brak logów)"
fi
echo ""

# E. Daily Loss Limit
echo "📊 E. Daily Loss Limit:"
echo "-----------------------"
if [ -f "$BOT_LOG" ]; then
  grep -i "DAILY LOSS LIMIT\|daily.*loss" "$BOT_LOG" | tail -n 5 || echo "   (brak logów)"
else
  journalctl -u mm-bot.service --since "$SINCE" --no-pager | grep -i "DAILY LOSS LIMIT\|daily.*loss" | tail -n 5 || echo "   (brak logów)"
fi
echo ""

# F. Rotation Filtering
echo "📊 F. Rotation Filtering:"
echo "-------------------------"
if [ -f "$BOT_LOG" ]; then
  grep "Rotation:" "$BOT_LOG" | tail -n 15 || echo "   (brak logów)"
else
  journalctl -u mm-bot.service --since "$SINCE" --no-pager | grep "Rotation:" | tail -n 15 || echo "   (brak logów)"
fi
echo ""

echo "✅ Check complete!"
echo ""
echo "💡 Tip: Użyj SINCE='2 hours ago' aby sprawdzić ostatnie 2h:"
echo "   SINCE='2 hours ago' $0"

