#\!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

TS=$(date "+%Y-%m-%d %H:%M:%S %Z")
echo "═══════════════════════════════════════════════════════════════"
echo "🌙 NOCNY PRZEGLĄD MM BOT — ${TS}"
echo "═══════════════════════════════════════════════════════════════"
echo

echo "━━━ 1️⃣  EKSPOZYCJA vs LIMITY (ostatnie 20 wpisów) ━━━"
tail -n 20 runtime/guardrails.log 2>/dev/null | grep "guardrails_evt=check" | while IFS= read -r line; do
  pair=$(echo "$line" | grep -oP "pair=\K[A-Z0-9_]+")
  notional=$(echo "$line" | grep -oP "notional=\K[0-9]+")
  posCap=$(echo "$line" | grep -oP "posCap=\K[0-9]+")
  invCap=$(echo "$line" | grep -oP "invCap=\K[0-9]+")
  unrealPnl=$(echo "$line" | grep -oP "unrealPnl=\K[-0-9.]+")
  breach=$(echo "$line" | grep -oP "breach=\K[a-z]+")
  
  status="✅"
  [ "$breach" = "true" ] && status="🚨"
  
  printf "%-10s  notional=%5s  caps=%4s/%4s  unreal=%+7s  %s\n" \
    "$pair" "$notional" "$invCap" "$posCap" "$unrealPnl" "$status"
done || echo "Brak danych w guardrails.log"
echo

echo "━━━ 2️⃣  PERFORMANCE (ostatnia godzina) ━━━"
npx tsx scripts/alerts.ts 2>/dev/null | grep -E "Turnover:|Fills:|Pairs:|Est fees|Status:" || echo "Alerts nie działają"
echo

echo "━━━ 3️⃣  WARSTWY i ORDERY (aktualny stan) ━━━"
npx tsx scripts/pair_config_snapshot.ts 2>/dev/null | while IFS= read -r line; do
  pair=$(echo "$line" | grep -oP "pair=\K[A-Z0-9_]+")
  layers=$(echo "$line" | grep -oP "layers=\K[0-9]+")
  buys=$(echo "$line" | grep -oP "buys=\K[0-9]+")
  sells=$(echo "$line" | grep -oP "sells=\K[0-9]+")
  target=$(echo "$line" | grep -oP "activeLayersTarget=\K[0-9]+")
  
  status="✅"
  [ "$layers" -lt "$target" ] && status="⚠️"
  [ "$layers" -lt 3 ] && status="🔴"
  
  printf "%-10s  layers=%d/%d  buys=%d  sells=%d  %s\n" \
    "$pair" "$layers" "$target" "$buys" "$sells" "$status"
done || echo "Brak danych config"
echo

echo "━━━ 4️⃣  AKTYWNE ZLECENIA (z order book) ━━━"
npx tsx scripts/check-all-orders.ts 2>/dev/null | head -n 30 || echo "Check orders nie działa"
echo

echo "━━━ 5️⃣  PANIC WATCH (ostatnie 10 sprawdzeń) ━━━"
grep "Panic Watch" runtime/guardrails.log 2>/dev/null | tail -n 10 || echo "Brak panic events"
echo

echo "━━━ 5️⃣ a  WEAK PAIRS (losing fill% check) ━━━"
npx tsx scripts/losing_fill_watch.ts 2 2>/dev/null || echo "Check failed"
echo

echo "━━━ 5️⃣ b  ALO REJECT RATE ━━━"
./scripts/alo_reject_watch.sh 2>/dev/null || echo "Check failed"
echo
echo "━━━ 6️⃣  ALO REJECTIONS (ostatnie 30 linii PM2) ━━━"
pm2 logs hyperliquid-mm --lines 100 --nostream 2>/dev/null | grep -i "post only\|immediately matched" | tail -n 30 || echo "Brak ALO rejects"
echo

echo "═══════════════════════════════════════════════════════════════"
echo "✅ Przegląd zakończony — $(date "+%H:%M:%S")"
echo "═══════════════════════════════════════════════════════════════"
