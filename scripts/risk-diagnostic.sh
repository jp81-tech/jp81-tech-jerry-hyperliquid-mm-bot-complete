#!/usr/bin/env bash
# Risk Management Diagnostic Script
# Automatycznie sprawdza wszystkie warstwy risk management dla danej pary
# Użycie: ./risk-diagnostic.sh ZEC

set -euo pipefail

PAIR="${1:-}"
BOT_LOG="${BOT_LOG:-/root/hyperliquid-mm-bot-complete/bot.log}"

if [ -z "$PAIR" ]; then
  echo "❌ Użycie: ./risk-diagnostic.sh ZEC|UNI|VIRTUAL"
  exit 1
fi

PAIR_UPPER=$(echo "$PAIR" | tr '[:lower:]' '[:upper:]')

echo "🔍 Risk Management Diagnostic Report"
echo "===================================="
echo "Para: $PAIR_UPPER"
echo "Log: $BOT_LOG"
echo ""

# KROK 1: Ogólne logi dla pary
echo "📊 KROK 1: Ogólne logi dla $PAIR_UPPER"
echo "----------------------------------------"
if [ -f "$BOT_LOG" ]; then
  grep -i "$PAIR_UPPER" "$BOT_LOG" | tail -n 20 | grep -E "SOFT SL|CONFLICT|knife|fomo|cap|rotation|cooldown" || echo "   (brak kluczowych słów)"
else
  journalctl -u mm-bot.service --since "today" --no-pager | grep -i "$PAIR_UPPER" | tail -n 20 | grep -E "SOFT SL|CONFLICT|knife|fomo|cap|rotation|cooldown" || echo "   (brak kluczowych słów)"
fi
echo ""

# KROK 2: Soft SL
echo "📊 KROK 2: Soft Stop Loss"
echo "-------------------------"
if [ -f "$BOT_LOG" ]; then
  grep -i "SOFT SL.*$PAIR_UPPER" "$BOT_LOG" | tail -n 20 || echo "   ❌ Brak logów Soft SL dla $PAIR_UPPER"
else
  journalctl -u mm-bot.service --since "today" --no-pager | grep -i "SOFT SL.*$PAIR_UPPER" | tail -n 20 || echo "   ❌ Brak logów Soft SL dla $PAIR_UPPER"
fi
echo ""

# KROK 3: Nansen Conflict SL
echo "📊 KROK 3: Nansen Conflict Stop Loss"
echo "-------------------------------------"
if [ -f "$BOT_LOG" ]; then
  grep -i "NANSEN.*$PAIR_UPPER" "$BOT_LOG" | tail -n 30 || echo "   ❌ Brak logów Nansen Conflict dla $PAIR_UPPER"
else
  journalctl -u mm-bot.service --since "today" --no-pager | grep -i "NANSEN.*$PAIR_UPPER" | tail -n 30 || echo "   ❌ Brak logów Nansen Conflict dla $PAIR_UPPER"
fi
echo ""

# KROK 4: Anti-FOMO
echo "📊 KROK 4: Anti-FOMO (Behavioural Risk)"
echo "----------------------------------------"
if [ -f "$BOT_LOG" ]; then
  grep -i "fomo.*$PAIR_UPPER\|$PAIR_UPPER.*fomo" "$BOT_LOG" | tail -n 20 || echo "   ❌ Brak logów FOMO guard dla $PAIR_UPPER"
else
  journalctl -u mm-bot.service --since "today" --no-pager | grep -i "fomo.*$PAIR_UPPER\|$PAIR_UPPER.*fomo" | tail -n 20 || echo "   ❌ Brak logów FOMO guard dla $PAIR_UPPER"
fi
echo ""

# KROK 5: Anti-Knife
echo "📊 KROK 5: Anti-Knife (Behavioural Risk)"
echo "----------------------------------------"
if [ -f "$BOT_LOG" ]; then
  grep -i "knife.*$PAIR_UPPER\|$PAIR_UPPER.*knife\|suspending BUY.*$PAIR_UPPER" "$BOT_LOG" | tail -n 20 || echo "   ❌ Brak logów knife guard dla $PAIR_UPPER"
else
  journalctl -u mm-bot.service --since "today" --no-pager | grep -i "knife.*$PAIR_UPPER\|$PAIR_UPPER.*knife\|suspending BUY.*$PAIR_UPPER" | tail -n 20 || echo "   ❌ Brak logów knife guard dla $PAIR_UPPER"
fi
echo ""

# KROK 6: Notional Cap
echo "📊 KROK 6: Notional Cap"
echo "-----------------------"
if [ -f "$BOT_LOG" ]; then
  grep -i "notional.*$PAIR_UPPER\|$PAIR_UPPER.*notional" "$BOT_LOG" | tail -n 30 || echo "   ❌ Brak logów notional cap dla $PAIR_UPPER"
else
  journalctl -u mm-bot.service --since "today" --no-pager | grep -i "notional.*$PAIR_UPPER\|$PAIR_UPPER.*notional" | tail -n 30 || echo "   ❌ Brak logów notional cap dla $PAIR_UPPER"
fi
echo ""

# KROK 7: Rotation Filtering
echo "📊 KROK 7: Rotation Filtering"
echo "------------------------------"
if [ -f "$BOT_LOG" ]; then
  grep -i "Rotation.*$PAIR_UPPER\|$PAIR_UPPER.*Rotation" "$BOT_LOG" | tail -n 40 || echo "   ❌ Brak logów rotation dla $PAIR_UPPER"
else
  journalctl -u mm-bot.service --since "today" --no-pager | grep -i "Rotation.*$PAIR_UPPER\|$PAIR_UPPER.*Rotation" | tail -n 40 || echo "   ❌ Brak logów rotation dla $PAIR_UPPER"
fi
echo ""

# KROK 8: Daily Loss Limit
echo "📊 KROK 8: Daily Loss Limit"
echo "---------------------------"
if [ -f "$BOT_LOG" ]; then
  grep -i "DAILY LOSS LIMIT" "$BOT_LOG" | tail -n 10 || echo "   ✅ Brak daily loss limit (OK, jeśli nie było dużych strat)"
else
  journalctl -u mm-bot.service --since "today" --no-pager | grep -i "DAILY LOSS LIMIT" | tail -n 10 || echo "   ✅ Brak daily loss limit (OK, jeśli nie było dużych strat)"
fi
echo ""

# KROK 9: Szybka identyfikacja "winnego"
echo "🎯 KROK 9: Szybka identyfikacja ostatniego wyzwalacza"
echo "------------------------------------------------------"
if [ -f "$BOT_LOG" ]; then
  grep -E "SOFT SL|NANSEN|fomo|knife|notional|DAILY LOSS" "$BOT_LOG" | grep -i "$PAIR_UPPER" | tail -n 20 || echo "   ⚠️ Brak ostatnich wyzwalaczy dla $PAIR_UPPER"
else
  journalctl -u mm-bot.service --since "today" --no-pager | grep -E "SOFT SL|NANSEN|fomo|knife|notional|DAILY LOSS" | grep -i "$PAIR_UPPER" | tail -n 20 || echo "   ⚠️ Brak ostatnich wyzwalaczy dla $PAIR_UPPER"
fi
echo ""

echo "✅ Diagnostic complete!"
echo ""
echo "💡 Interpretacja:"
echo "   - Jeśli widzisz logi → mechanizm działał"
echo "   - Jeśli brak logów mimo problemów → mechanizm nie zadziałał"
echo "   - Ostatni log w KROK 9 → prawdopodobny 'winny'"

