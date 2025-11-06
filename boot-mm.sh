#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
if command -v npx >/dev/null 2>&1; then
  npx tsx scripts/apply_leverage_on_boot.ts || true
fi
exec npx tsx src/mm_hl.ts
