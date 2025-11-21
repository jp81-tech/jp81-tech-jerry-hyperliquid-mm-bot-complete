#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v npx >/dev/null 2>&1; then
  echo "❌ Wymagany jest npx (Node.js)."
  exit 1
fi

echo "🔁 Uruchamiam reset_daily_pnl_anchor.ts ..."
npx tsx scripts/reset_daily_pnl_anchor.ts "$@"

