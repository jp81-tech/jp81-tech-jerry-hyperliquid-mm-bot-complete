#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete

# ═══════════════════════════════════════════════════════════
# PRESET ORCHESTRATOR - Automatically switches trading modes
# ═══════════════════════════════════════════════════════════

LOCK="/var/run/mm-orchestrator.lock"
exec 9>"$LOCK"
flock -n 9 || { echo "Orchestrator already running"; exit 0; }

LOG="runtime/preset_changes.log"
CURRENT_PRESET_FILE="runtime/current_preset.txt"

# Load current states
BOUNCE_MODE=$(jq -r '.mode' runtime/bounce_state.json 2>/dev/null || echo "STABLE")
DUMP_MODE=$(jq -r '.mode' runtime/dump_state.json 2>/dev/null || echo "STABLE")
CURRENT_PRESET=$(cat "$CURRENT_PRESET_FILE" 2>/dev/null || echo "04_baseline_hv")

log() {
  echo "$(date -u +%FT%TZ) [$1] $2" | tee -a "$LOG"
}

slack() {
  local msg="$1"
  if [ -f .env ]; then
    WEBHOOK=$(grep -E '^SLACK_WEBHOOK_URL=' .env | cut -d= -f2- || true)
    if [ -n "$WEBHOOK" ]; then
      curl -s -X POST -H 'Content-type: application/json'         --data "$(jq -n --arg t "$msg" '{text:$t}')" "$WEBHOOK" >/dev/null 2>&1 || true
    fi
  fi
}

determine_preset() {
  # Priority: DUMP > BOUNCE > STABLE
  
  # DUMP conditions (highest priority)
  if [ "$DUMP_MODE" = "SHELTER" ]; then
    echo "03_dump_defense"
    return
  elif [ "$DUMP_MODE" = "DEFENSIVE" ]; then
    echo "02_bounce_play"  # Use bounce play as intermediate defense
    return
  fi
  
  # BOUNCE conditions
  if [ "$BOUNCE_MODE" = "BOUNCE" ]; then
    echo "02_bounce_play"
    return
  elif [ "$BOUNCE_MODE" = "RALLY" ]; then
    echo "02_bounce_play"
    return
  fi
  
  # Check current margin usage for auto-conservative
  MARGIN_PCT=$(npx tsx scripts/check_account.ts 2>/dev/null | grep 'Total Margin Used' | awk '{print $NF}' | tr -d ',' || echo 0)
  MARGIN_NUM=$(echo "$MARGIN_PCT" | awk '{print $1+0}')
  
  if awk "BEGIN{exit(!($MARGIN_NUM > 7000))}"; then
    # High margin usage > $7k = be conservative
    echo "01_conservative_safe"
    return
  fi
  
  # Check daily PnL for aggressive mode
  DAILY_PNL=$(pm2 logs hyperliquid-mm --lines 50 --nostream 2>/dev/null | grep 'Daily PnL' | tail -1 | awk -F'PnL: \$' '{print $2}' | awk '{print $1}' || echo 0)
  
  if [ -n "$DAILY_PNL" ]; then
    if awk "BEGIN{exit(!($DAILY_PNL > 100))}"; then
      # Profitable day > $100 = can be more aggressive
      echo "05_aggressive_maker"
      return
    fi
  fi
  
  # Default: baseline
  echo "04_baseline_hv"
}

apply_preset() {
  local preset="$1"
  local preset_file="presets/${preset}.env"
  
  if [ ! -f "$preset_file" ]; then
    log "ERROR" "Preset file not found: $preset_file"
    return 1
  fi
  
  log "INFO" "Applying preset: $preset"
  
  # Backup current .env
  cp .env ".env.bak.$(date +%s)"
  
  # Merge preset into .env (preset values override)
  while IFS='=' read -r key value; do
    # Skip comments and empty lines
    [[ "$key" =~ ^#.*$ ]] && continue
    [[ -z "$key" ]] && continue
    
    # Update or append to .env
    if grep -q "^$key=" .env; then
      sed -i "s|^$key=.*|$key=$value|" .env
    else
      echo "$key=$value" >> .env
    fi
  done < <(grep -E '^[A-Z_]+=' "$preset_file")
  
  # Save current preset
  echo "$preset" > "$CURRENT_PRESET_FILE"
  
  log "SUCCESS" "Preset applied: $preset"
  return 0
}

restart_bot() {
  log "INFO" "Restarting bot..."
  pm2 restart hyperliquid-mm --update-env
  sleep 3
  local status=$(pm2 jlist 2>/dev/null | jq -r '.[] | select(.name=="hyperliquid-mm") | .pm2_env.status' || echo "unknown")
  log "INFO" "Bot status: $status"
}

# Main logic
NEW_PRESET=$(determine_preset)

log "INFO" "States: BOUNCE=$BOUNCE_MODE DUMP=$DUMP_MODE"
log "INFO" "Current: $CURRENT_PRESET → Target: $NEW_PRESET"

if [ "$NEW_PRESET" != "$CURRENT_PRESET" ]; then
  log "CHANGE" "Switching from $CURRENT_PRESET to $NEW_PRESET"
  slack "🔄 MM Preset Change: $CURRENT_PRESET → $NEW_PRESET (BOUNCE=$BOUNCE_MODE, DUMP=$DUMP_MODE)"
  
  if apply_preset "$NEW_PRESET"; then
    restart_bot
    slack "✅ Preset applied successfully: $NEW_PRESET"
  else
    log "ERROR" "Failed to apply preset: $NEW_PRESET"
    slack "❌ Failed to apply preset: $NEW_PRESET"
  fi
else
  log "INFO" "No change needed (current: $CURRENT_PRESET)"
fi

flock -u 9
