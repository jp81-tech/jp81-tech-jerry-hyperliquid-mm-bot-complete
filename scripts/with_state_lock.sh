#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $(basename "$0") <command...>"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_FILE="$ROOT_DIR/data/.bot_state.lock"

exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "❌ Nie mogę zablokować $LOCK_FILE (czy inny proces go używa?)."
  exit 1
fi

trap 'flock -u 200' EXIT

cd "$ROOT_DIR"
"$@"

