#!/usr/bin/env bash
set -euo pipefail
base="/root/hyperliquid-mm-bot-complete"
grep -q '^LEVERAGE=' "$base/.env" || exit 0
exit 0
