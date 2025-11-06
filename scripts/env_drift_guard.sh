#!/usr/bin/env bash
set -e
diff -q .env src/.env >/dev/null 2>&1 || { cp .env src/.env; pm2 restart hyperliquid-mm --update-env; echo "env-synced"; }
