#!/usr/bin/env bash
set -e

APP_NAME="hyperliquid-mm"
LINES=400

echo "════════ MM BOT HEALTHCHECK ════════"
date
echo

echo "▶ PM2 status:"
systemctl status mm-bot.service --no-pager | sed -n '3,7p'
echo

echo "▶ Uptime / restarts:"
systemctl status mm-bot.service --no-pager | awk 'NR>2 && $2=="hyperliquid-mm"{print "  Uptime: " $7 ", Restarts: " $8 ", Status: " $10}'
echo

echo "▶ Recent errors (invalid_size / TypeError / below min notional):"
journalctl -u mm-bot.service --no-pager -n $LINES \
  | grep -E 'invalid_size|TypeError|below min notional' \
  | tail -10 || echo "  (brak podejrzanych błędów w ostatnich ${LINES} liniach)"
echo

echo "▶ Capping summary (last ${LINES} lines):"
journalctl -u mm-bot.service --no-pager -n $LINES \
  | grep '\[CAP\]' \
  | sed 's/.*\[CAP\] //' \
  | awk '{print $1}' \
  | sort | uniq -c | sort -rn || echo "  (brak [CAP])"
echo

echo "▶ Submit summary (last ${LINES} lines):"
OK_COUNT=$(journalctl -u mm-bot.service --no-pager -n $LINES | grep 'quant_evt=submit' | grep 'ok=1' | wc -l)
ERR_COUNT=$(journalctl -u mm-bot.service --no-pager -n $LINES | grep 'quant_evt=submit' | grep 'err=' | grep -v 'err=none' | wc -l)
echo "  ok=1      : $OK_COUNT"
echo "  err!=none : $ERR_COUNT"
echo

echo "▶ Current positions:"
npx tsx scripts/check_positions.ts 2>/dev/null | head -20 || echo "  (brak danych z check_positions)"
echo
echo "════════ END ════════"
