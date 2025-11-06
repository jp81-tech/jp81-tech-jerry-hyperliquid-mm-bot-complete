#!/usr/bin/env bash
set -euo pipefail
cd /root/hyperliquid-mm-bot-complete

LOG="runtime/mode_changes.log"
[ -f "$LOG" ] || { echo "No mode_changes.log found"; exit 0; }

# GNU date (serwer) – 24h wstecz
SINCE="$(date -u -d "24 hours ago" "+%Y-%m-%d %H:%M:%SZ")"

# ANSI kolory
RED="\033[31m"; GREEN="\033[32m"; YELLOW="\033[33m"; CYAN="\033[36m"; RESET="\033[0m"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "📡  ${CYAN}Mode Changes (last 24h since $SINCE)${RESET}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

# Linia formatu (przykład):
# 2025-11-05 09:57:40Z bounce_change STABLE->MODERATE_BOUNCE btc=... vol=... ...
awk -v SINCE="$SINCE" -v RED="$RED" -v GREEN="$GREEN" -v YELLOW="$YELLOW" -v RESET="$RESET" '
  BEGIN { cnt=0 }
  {
    ts = $1 " " $2
    # Z logów: drugi token ma sufiks Z, np. "09:57:40Z" – usuń Z żeby porównania leksykalne działały równo
    gsub("Z","",ts)
    gsub("Z","",$2)
  }
  # Zamieniamy SINCE tak samo (usuwamy Z jeżeli by było)
  function stripZ(s){ gsub("Z","",s); return s }
  BEGIN2 {}
  {
    # porównanie leksykalne działa dla formatu YYYY-MM-DD HH:MM:SS
    if (stripZ(SINCE) <= ts) {
      kind=$3
      line=$0
      if (kind=="dump_change") {
        print "• " RED line RESET
      } else if (kind=="bounce_change") {
        print "• " GREEN line RESET
      } else if (kind=="manual_change") {
        print "• " YELLOW line RESET
      } else {
        print "• " line
      }
      cnt++
    }
  }
  END {
    if (cnt==0) {
      print "No changes in the last 24h."
    }
  }
' "$LOG"
echo
