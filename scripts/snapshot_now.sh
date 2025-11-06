#!/usr/bin/env bash
set -e
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="runtime/snapshot_${TS}"
mkdir -p runtime
echo "snapshot_ts=${TS}" > "${OUT}.meta"
npx tsx scripts/alerts.ts > "${OUT}.alerts.txt" 2>&1 || true
npx tsx scripts/pair_config_snapshot.ts > "${OUT}.pairs.txt" 2>&1 || true
npx tsx scripts/check-all-orders.ts > "${OUT}.orders.txt" 2>&1 || true
echo "${OUT}"
