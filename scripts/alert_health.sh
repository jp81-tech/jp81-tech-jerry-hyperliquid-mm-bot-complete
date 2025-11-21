#!/usr/bin/env bash
set -euo pipefail
SLACK="${SLACK_WEBHOOK_URL:-}"
since="10 min ago"
errs=0

# 1) czy są submity w logach bota
subs=$(journalctl -u mm-bot.service --since "$since" --no-pager 2>/dev/null | grep -E "quant_evt=submit|submit: pair" | wc -l || echo 0)

# 2) czy mamy choć 1 ASK na efektywnych parach
cd /root/hyperliquid-mm-bot-complete
asks=$(npx tsx scripts/check-all-orders.ts 2>/dev/null | grep -iE "sell|ask" | wc -l || echo 0)

if [ "${subs:-0}" -eq 0 ] || [ "${asks:-0}" -eq 0 ]; then
  msg="⚠️ MM Health: submits=${subs}, asks=${asks} (since $since)."
  echo "$msg"
  if [ -n "$SLACK" ]; then 
    curl -s -X POST -H "Content-type: application/json" --data "{\"text\":\"$msg\"}" "$SLACK" >/dev/null 2>&1 || true
  fi
else
  echo "✅ MM Health OK: submits=${subs}, asks=${asks}"
fi
