#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete
tmpf=$(mktemp)
awk -F= -v OFS="=" '
  BEGIN{
    want["ROTATION_MODE"]="hybrid";
    want["CORE_PAIRS"]="HYPE,FARTCOIN";
    want["CORE_ALLOCATION"]="0.35";
    want["ROTATION_ALLOCATION"]="0.65";
    want["ROTATION_INTERVAL_SEC"]="14400";
    want["ROTATION_VOL_WEIGHT"]="0.6";
    want["ROTATION_SPREAD_WEIGHT"]="0.25";
    want["ROTATION_DEPTH_WEIGHT"]="0.15";
    want["MIN_L1_SPREAD_BPS"]="9"
  }
  {
    k=$1
    if(k in want){ $2=want[k]; seen[k]=1; print k,$2; next }
    print $0
  }
  END{
    for(k in want){ if(!(k in seen)) print k,want[k] }
  }
' .env > "$tmpf"
mv "$tmpf" .env
cp .env src/.env
npx tsx scripts/fetch_market_stats.ts >/dev/null 2>&1 || true
ROTATE_TOP_N=6 npx tsx scripts/rotation_daemon.ts >/dev/null 2>&1 || true
pm2 restart hyperliquid-mm --update-env >/dev/null 2>&1 || true
npx tsx scripts/check-all-orders.ts >> runtime/watchdog.log 2>&1 || true
echo "shift_to_volatile_0800: done $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> runtime/watchdog.log
crontab -l 2>/dev/null | grep -v shift_to_volatile_0800.sh | crontab - || true
