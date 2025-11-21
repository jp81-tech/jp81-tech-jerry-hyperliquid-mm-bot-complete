#!/usr/bin/env bash
set -euo pipefail

SLACK_WEBHOOK="${SLACK_WEBHOOK_MONTHLY_SUMMARY:-${SLACK_WEBHOOK_ALERTS:-${SLACK_WEBHOOK_URL:-}}}"
if [[ -z "$SLACK_WEBHOOK" ]]; then
  echo "[monthly-pnl-summary] Missing Slack webhook env (SLACK_WEBHOOK_MONTHLY_SUMMARY / SLACK_WEBHOOK_ALERTS / SLACK_WEBHOOK_URL)" >&2
  exit 0
fi
WD="/root/hyperliquid-mm-bot-complete"

cd "$WD"

# Generuj świeże CSV z PnL per pair
npx tsx scripts/perfill_bypair.ts >/dev/null 2>&1 || true

# Obecne dane
PNL_NOW=$(npx tsx scripts/check_position_pnl.ts 2>&1 | head -50 || echo "No PnL data")
ORDERS=$(npx tsx scripts/check-all-orders.ts 2>&1 | head -20 || echo "No orders")

# Agreguj CSV - Top 5 i Worst 5 z runtime/
CSV_FILES=$(ls -1 runtime/perfill_*.csv 2>/dev/null || true)

if [[ -n "$CSV_FILES" ]]; then
  # Agreguj PnL per pair z wszystkich CSV
  PAIR_TOTALS=$(awk -F, '
    NR>1 && NF>=2 {
      pair=$1
      pnl=$2
      gsub(/^[ \t]+|[ \t]+$/, "", pair)
      gsub(/^[ \t]+|[ \t]+$/, "", pnl)
      if (pnl ~ /^[-+]?[0-9]*\.?[0-9]+$/) {
        total[pair] += pnl
      }
    }
    END {
      for (p in total) {
        printf "%s %.2f\n", p, total[p]
      }
    }
  ' $CSV_FILES | sort -k2 -rn)
  
  CSV_COUNT=$(echo "$CSV_FILES" | wc -l)
  
  TOP5=$(echo "$PAIR_TOTALS" | head -5 | awk 'BEGIN{print "🏆 TOP 5 Pairs:"} {printf "  %d. %-12s %+.2f USD\n", NR, $1, $2}')
  WORST5=$(echo "$PAIR_TOTALS" | tail -5 | tac | awk 'BEGIN{print "📉 WORST 5 Pairs:"} {printf "  %d. %-12s %+.2f USD\n", NR, $1, $2}')
  
  RANKING="📊 *Pair Performance (from ${CSV_COUNT} CSV files)*\n\n${TOP5}\n\n${WORST5}"
else
  RANKING="No CSV data available for ranking"
fi

# Stats z daily health logs
LOGS=$(ls -1 logs/daily-health.*.log 2>/dev/null | tail -90 || true)
LOGS_COUNT=$(echo "$LOGS" | wc -l)

if [[ -n "$LOGS" && "$LOGS_COUNT" -gt 0 ]]; then
  MONTHLY_STATS=$(awk '
    /Total Unrealized PnL:/ {
      gsub(/[^0-9\.\-+]/,"",$0);
      v=$0+0;
      n++; sum+=v;
      if(n==1){min=v;max=v}else{if(v<min)min=v; if(v>max)max=v}
    }
    END{
      if(n>0){
        avg=sum/n;
        printf "Snapshots: %d\nAverage PnL: $%.2f\nMin PnL: $%.2f\nMax PnL: $%.2f\nCumulative: $%.2f\n", n, avg, min, max, sum
      } else {
        print "No historical data available."
      }
    }
  ' $LOGS 2>/dev/null || echo "Parse error")
else
  MONTHLY_STATS="No historical logs found."
fi

# Parsuj obecne główne metryki
ACCOUNT_VALUE=$(echo "$PNL_NOW" | grep -i "Account Value" | grep -oE "[0-9,]+" | head -1 | tr -d "," || echo "N/A")
CURRENT_PNL=$(echo "$PNL_NOW" | grep -i "Total Unrealized PnL" | grep -oE "[+-]?[0-9]+\.[0-9]+" | head -1 || echo "0")
NUM_POS=$(echo "$PNL_NOW" | grep -i "Number of Positions" | grep -oE "[0-9]+" | head -1 || echo "0")
CAPITAL_DEPLOYED=$(echo "$PNL_NOW" | grep -i "Total Capital Deployed" | grep -oE "[0-9,]+\.[0-9]+" | head -1 | tr -d "," || echo "0")

# Zakres dat
MONTH_START=$(date -u +"%Y-%m-01")
MONTH_END=$(date -u +"%Y-%m-%d")
TS=$(date -u +"%Y-%m-%d %H:%M UTC")

# Twórz JSON payload
cat << EOF_JSON > /tmp/monthly_report.json
{
  "text": "📆 *MONTHLY MM SUMMARY*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📅 Period: ${MONTH_START} → ${MONTH_END}\n⏰ Generated: ${TS}\n\n💰 *Current Financials*\nAccount Value: \$${ACCOUNT_VALUE}\nCurrent Unrealized PnL: \$${CURRENT_PNL}\nActive Positions: ${NUM_POS}\nCapital Deployed: \$${CAPITAL_DEPLOYED}\n\n📊 *Monthly Stats (from ${LOGS_COUNT} logs)*\n\`\`\`\n${MONTHLY_STATS}\n\`\`\`\n\n${RANKING}\n\n📋 *Current Positions & PnL*\n\`\`\`\n$(echo "$PNL_NOW" | head -25)\n\`\`\`\n\n📝 *Open Orders*\n\`\`\`\n$(echo "$ORDERS" | head -15)\n\`\`\`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}
EOF_JSON

curl -s -X POST -H "Content-type: application/json" \
  -d @/tmp/monthly_report.json \
  "$SLACK_WEBHOOK" >/dev/null 2>&1 || true

rm -f /tmp/monthly_report.json
