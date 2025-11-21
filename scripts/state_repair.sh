#!/usr/bin/env bash

set -euo pipefail

STATE_FILE="data/bot_state.json"

if [ ! -f "$STATE_FILE" ]; then
  echo "❌ Nie znaleziono $STATE_FILE"
  exit 1
fi

LOCK_FILE="data/.bot_state.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "❌ Nie mogę uzyskać blokady $LOCK_FILE (inny proces edytuje state)."
  exit 1
fi
trap 'flock -u 200' EXIT

ts() {
  date +"%Y-%m-%d %H:%M:%S"
}

backup_state() {
  local backup="data/bot_state.json.bak_$(date +%F_%H%M%S)"
  cp "$STATE_FILE" "$backup"
  echo "$(ts) 🧷 Backup zapisany: $backup"
}

show_state() {
  echo "────────────────────────────────────────"
  echo "$(ts) 📄 Podgląd kluczowych pól w $STATE_FILE:"
  jq '{
    dailyPnl,
    dailyPnlAnchorUsd,
    lastResetDate,
    maxDailyLossUsd: .maxDailyLossUsd // "n/a"
  }' "$STATE_FILE"
  echo "────────────────────────────────────────"
}

move_daily_to_anchor() {
  backup_state
  echo "$(ts) 🔁 Przenoszę dailyPnl → dailyPnlAnchorUsd i zeruję dailyPnl…"
  jq '
    .dailyPnlAnchorUsd = (.dailyPnlAnchorUsd + (.dailyPnl // 0)) |
    .dailyPnl = 0
  ' "$STATE_FILE" > "${STATE_FILE}.tmp"
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
  show_state
}

set_anchor_manual() {
  read -r -p "Nowa wartość dailyPnlAnchorUsd (np. -5000 lub 0): " val
  backup_state
  echo "$(ts) ✏️ Ustawiam dailyPnlAnchorUsd = $val…"
  jq --argjson v "$val" '.dailyPnlAnchorUsd = $v' "$STATE_FILE" > "${STATE_FILE}.tmp"
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
  show_state
}

set_daily_manual() {
  read -r -p "Nowa wartość dailyPnl (np. 0 lub 50.25): " val
  backup_state
  echo "$(ts) ✏️ Ustawiam dailyPnl = $val…"
  jq --argjson v "$val" '.dailyPnl = $v' "$STATE_FILE" > "${STATE_FILE}.tmp"
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
  show_state
}

set_last_reset_today() {
  local today
  today=$(date +%F)
  backup_state
  echo "$(ts) 📆 Ustawiam lastResetDate = \"$today\"…"
  jq --arg d "$today" '.lastResetDate = $d' "$STATE_FILE" > "${STATE_FILE}.tmp"
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
  show_state
}

main_menu() {
  echo
  echo "🟥 state_repair.sh – naprawa state bez restartu bota"
  echo "Plik: $STATE_FILE"
  show_state
  echo "Wybierz akcję:"
  echo "  1) Przenieś current dailyPnl → dailyPnlAnchorUsd i wyzeruj dailyPnl"
  echo "  2) Ustaw ręcznie dailyPnlAnchorUsd"
  echo "  3) Ustaw ręcznie dailyPnl"
  echo "  4) Ustaw lastResetDate na dzisiaj"
  echo "  5) Tylko pokaż state i wyjdź"
  echo "  0) Wyjście"
  read -r -p "Twój wybór: " choice
  case "$choice" in
    1) move_daily_to_anchor ;;
    2) set_anchor_manual ;;
    3) set_daily_manual ;;
    4) set_last_reset_today ;;
    5) show_state ;;
    0) echo "👋 Koniec."; exit 0 ;;
    *) echo "❌ Nieprawidłowy wybór."; exit 1 ;;
  esac
}

main_menu

