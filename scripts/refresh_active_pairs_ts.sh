#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test -f runtime/active_pairs.json || exit 0
tmp=$(mktemp)
jq ".ts = (now|todate)" runtime/active_pairs.json > "$tmp" && mv "$tmp" runtime/active_pairs.json
