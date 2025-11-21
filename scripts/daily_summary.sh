#!/usr/bin/env bash
set -euo pipefail

SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

SINCE_UTC="$(date -u -d "24 hours ago" "+%Y-%m-%d %H:%M:%S")"
NOW_UTC="$(date -u "+%Y-%m-%d %H:%M:%S")"

EFFECTIVE=$(jq -r ".pairs[]" /root/hyperliquid-mm-bot-complete/runtime/effective_active_pairs.json 2>/dev/null || true)

SUBMIT_RAW="$(journalctl -u mm-bot.service --since "${SINCE_UTC} UTC" --until "${NOW_UTC} UTC" --no-pager | grep "submit: pair" || true)"

ROT_COUNT=$(journalctl -u mm-policy-reconcile.service --since "${SINCE_UTC} UTC" --until "${NOW_UTC} UTC" --no-pager | grep -c "Effective_pairs:" || echo 0)

awk -v OFS="	" '
  function abs(x){return x<0?-x:x}
  BEGIN{ }
  {
    if (match($0,/pair=([A-Za-z0-9]+)/,p) && match($0,/size=([0-9.]+)/,s) && match($0,/price=([0-9.]+)/,r)) {
      pair=p[1]; sz=s[1]+0; px=r[1]+0; notional=sz*px
      subm[pair]+=1
      sumN[pair]+=notional
    }
  }
  END{
    for (pair in subm){
      avgN = (subm[pair]>0 ? sumN[pair]/subm[pair] : 0)
      printf("%s: %d submits @ ~$%.2f avg\n", pair, subm[pair], avgN)
    }
  }
' <<< "$SUBMIT_RAW" > /tmp/mm_daily.txt

REPORT_HEADER="📊 Daily MM Summary (last 24h)
UTC: ${SINCE_UTC} → ${NOW_UTC}
Effective pairs: $(echo "$EFFECTIVE" | xargs)
Rotations_24h: ${ROT_COUNT}"

REPORT_TABLE="$(cat /tmp/mm_daily.txt 2>/dev/null || echo "(no recent submits)")"

REPORT="${REPORT_HEADER}

${REPORT_TABLE}"

if [ -n "$SLACK_WEBHOOK_URL" ]; then
  curl -s -X POST -H "Content-type: application/json" \
    --data "$(jq -Rn --arg t "$REPORT" '{text:$t}')" \
    "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || true
fi

if [ -n "${TELEGRAM_BOT_TOKEN}" ] && [ -n "${TELEGRAM_CHAT_ID}" ]; then
  TG_API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage"
  curl -s -X POST "$TG_API" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${REPORT}" >/dev/null 2>&1 || true
fi
