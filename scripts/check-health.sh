#!/usr/bin/env bash
set -euo pipefail

cd /root/hyperliquid-mm-bot-complete

echo "=== 🔍 POST-REBOOT HEALTH CHECK ==="

echo
echo "[1] Bot process:"
ps aux | grep "node.*mm_hl" | grep -v grep || echo "❌ Bot not running"

echo
echo "[2] Systemd services:"
systemctl is-active mm-rotation-daemon >/dev/null && echo "mm-rotation-daemon: active" || echo "mm-rotation-daemon: ❌ inactive"
systemctl is-active mm-panic-watchdog   >/dev/null && echo "mm-panic-watchdog: active"   || echo "mm-panic-watchdog: ❌ inactive"

echo
echo "[3] Active pairs (rotation file):"
if [ -f runtime/active_pairs.json ]; then
  jq -r '.pairs | join(", ")' runtime/active_pairs.json
else
  echo "❌ runtime/active_pairs.json missing"
fi

echo
echo "[4] Denylist and strict mode:"
grep -E '^ACTIVE_PAIRS_DENYLIST=|^ACTIVE_PAIRS_ALLOWLIST=|^ROTATION_STRICT_ONLY=' .env || echo "❌ .env entries missing"

echo
echo "[5] Watchdog log tail:"
test -f runtime/watchdog.log && tail -5 runtime/watchdog.log || echo "No watchdog.log yet"

echo
echo "[6] Recent rotation apply events:"
test -f bot.log && tail -150 bot.log | grep "rotation_evt=apply" | tail -3 || echo "No rotation logs yet"

echo
echo "[7] E_TICK errors (last 1000 lines):"
test -f bot.log && tail -1000 bot.log | grep -c "err_code=E_TICK" || echo "0"

echo
echo "[8] Quick deny-pair scan in logs (informational):"
test -f bot.log && tail -300 bot.log | grep -iE "XPL|ASTER" || echo "✅ No XPL/ASTER mentions in recent logs"

echo
echo "✅ Health check complete."
