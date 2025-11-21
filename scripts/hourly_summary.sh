#\!/usr/bin/env bash
set -uo pipefail

SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
SINCE_UTC="$(date -u -d "60 minutes ago" "+%Y-%m-%d %H:%M:%S")"
NOW_UTC="$(date -u "+%Y-%m-%d %H:%M:%S")"

EFFECTIVE=$(jq -r ".pairs[]" /root/hyperliquid-mm-bot-complete/runtime/effective_active_pairs.json 2>/dev/null | xargs || echo "none")
ROT_COUNT=$(journalctl -u mm-policy-reconcile.service --since "${SINCE_UTC} UTC" --until "${NOW_UTC} UTC" --no-pager 2>/dev/null | grep -c "Effective_pairs:" || echo 0)

# Extract last 3 rotations
ROTATIONS=$(journalctl -u mm-policy-reconcile.service --since "${SINCE_UTC} UTC" --until "${NOW_UTC} UTC" --no-pager 2>/dev/null | awk '/Effective_pairs:/{flag=1; next} /Kept pairs:/{flag=0} flag && /^[A-Z]{2,6}$/{print}' || true)
RS_RAW=$(echo "$ROTATIONS" | tail -18)
RS1=$(echo "$RS_RAW" | head -6 | xargs || echo "")
RS2=$(echo "$RS_RAW" | head -12 | tail -6 | xargs || echo "")
RS3=$(echo "$RS_RAW" | tail -6 | xargs || echo "")
RST="changed"
[ -n "$RS1" ] && [ "$RS1" = "$RS2" ] && [ "$RS2" = "$RS3" ] && RST="stable"

# Get submit data
SUBMIT_RAW=$(journalctl -u mm-bot.service --since "${SINCE_UTC} UTC" --until "${NOW_UTC} UTC" --no-pager 2>/dev/null | grep "submit: pair" || true)

# FIX: Get fills from "Synced X new fills" format, sum total fills
FILLS_TOTAL=$(journalctl -u mm-bot.service --since "${SINCE_UTC} UTC" --until "${NOW_UTC} UTC" --no-pager 2>/dev/null | grep -oE "Synced [0-9]+ new fills" | awk '{sum+=$2} END{print sum+0}')

# Parse submits
awk -v OFS="\t" '
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
      printf("%s\t%d\t%.0f\n", pair, subm[pair], avgN)
    }
  }
' <<< "$SUBMIT_RAW" | sort > /tmp/mm_submits_1h.tsv

# Build report
REPORT_HEADER="🕒 Hourly MM Summary (last 60m)
UTC: ${SINCE_UTC} → ${NOW_UTC}
Effective pairs: ${EFFECTIVE}
Rotations_60m: ${ROT_COUNT}
Rotation_Stability: ${RST}
Last3:
- ${RS1:-none}
- ${RS2:-none}
- ${RS3:-none}"

# Format: pair, submits, avg notional
REPORT_TABLE=$(awk -F'\t' -v fills="$FILLS_TOTAL" 'BEGIN{print "• ALL — total_fills:" fills} {printf "• %s — submits:%s, avg~$%s\n",$1,$2,$3}' /tmp/mm_submits_1h.tsv 2>/dev/null | grep -v "^$" || echo "(no activity)")

REPORT="${REPORT_HEADER}

${REPORT_TABLE}"

# Send to Slack
if [ -n "$SLACK_WEBHOOK_URL" ]; then
  curl -s -X POST -H "Content-type: application/json" \
    --data "$(jq -Rn --arg t "$REPORT" '{text:$t}')" \
    "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || true
fi

echo "$REPORT"
