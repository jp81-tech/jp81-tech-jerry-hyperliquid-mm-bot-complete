#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
out=$(npx tsx scripts/check-all-orders.ts 2>/dev/null | sed -n "s/^  \\([A-Z0-9_-]\\+\\) .*/\\1/p" | sort | uniq -c)
need_touch=0
for p in HYPE ZK ZEC FARTCOIN; do
  have=$(echo "$out" | awk -v P="$p" "\$2==P{print \$1}" || echo "0")
  test -z "$have" && have=0
  if [ "$have" -lt 4 ]; then
    need_touch=1
  fi
done
if [ "$need_touch" -eq 1 ]; then
  tmp=$(mktemp)
  jq ".ts = (now|todate)" runtime/active_pairs.json > "$tmp" && mv "$tmp" runtime/active_pairs.json
fi
