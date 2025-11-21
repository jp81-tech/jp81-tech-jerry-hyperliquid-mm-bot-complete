#!/bin/bash
#
# Nansen Signal Tracking Daemon
#
# Runs continuously to track Nansen signal accuracy:
# - Every 1h: Update price tracking for existing snapshots
# - Every 4h: Capture new signal snapshots
# - Every 24h: Calculate stats and send Slack report
#

set -euo pipefail

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BOT_DIR"

# Load environment variables
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

LAST_SNAPSHOT_TIME=0
LAST_REPORT_TIME=0

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"
}

# Initial snapshot on startup
log "🚀 Starting Nansen tracking daemon"
log "📸 Capturing initial signal snapshots..."
npx tsx scripts/nansen_signal_tracker.ts snapshot 2>&1 | tee -a logs/nansen_tracking.log

LAST_SNAPSHOT_TIME=$(date +%s)

while true; do
  NOW=$(date +%s)

  # Every 1 hour: Update price tracking
  log "🔄 Updating price tracking..."
  npx tsx scripts/nansen_signal_tracker.ts track 2>&1 | tee -a logs/nansen_tracking.log

  # Every 4 hours: Capture new snapshots
  HOURS_SINCE_SNAPSHOT=$(( (NOW - LAST_SNAPSHOT_TIME) / 3600 ))
  if [ "$HOURS_SINCE_SNAPSHOT" -ge 4 ]; then
    log "📸 Capturing new signal snapshots (4h interval)"
    npx tsx scripts/nansen_signal_tracker.ts snapshot 2>&1 | tee -a logs/nansen_tracking.log
    LAST_SNAPSHOT_TIME=$NOW
  fi

  # Every 24 hours: Calculate stats and send Slack report
  HOURS_SINCE_REPORT=$(( (NOW - LAST_REPORT_TIME) / 3600 ))
  if [ "$HOURS_SINCE_REPORT" -ge 24 ] || [ "$LAST_REPORT_TIME" -eq 0 ]; then
    log "📊 Calculating stats and sending Slack report (24h interval)"
    npx tsx scripts/nansen_signal_tracker.ts stats 2>&1 | tee -a logs/nansen_tracking.log
    npx tsx scripts/send_nansen_stats_slack.ts 2>&1 | tee -a logs/nansen_tracking.log
    LAST_REPORT_TIME=$NOW
  fi

  # Sleep for 1 hour
  log "💤 Sleeping for 1 hour..."
  sleep 3600
done
