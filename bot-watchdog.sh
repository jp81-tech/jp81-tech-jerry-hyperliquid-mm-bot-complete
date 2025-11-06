#!/bin/bash

# Bot Watchdog - Auto-restart if bot crashes
# Checks every 60 seconds if bot is running

BOT_DIR="/root/hyperliquid-mm-bot-complete"
LOG_FILE="$BOT_DIR/watchdog.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "Watchdog started"

while true; do
    # Check if bot process is running (fixed to detect actual process)
    if ! pgrep -f "src/mm_hl.ts" > /dev/null; then
        log "⚠️  Bot is not running! Auto-restarting..."

        cd "$BOT_DIR"
        ./stop-bot.sh 2>&1 | tee -a "$LOG_FILE"
        sleep 3
        ./start-bot.sh 2>&1 | tee -a "$LOG_FILE"

        log "✅ Bot restarted"
    fi

    # Check every 60 seconds
    sleep 60
done
