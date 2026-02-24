#!/usr/bin/env python3
"""
SHORT EXIT DAILY REPORT
Reads /tmp/short_exit_log.json (populated by whale_tracker.py)
and sends a summary to Discord + Telegram.

Cron: 0 8 * * * cd ~/hyperliquid-mm-bot-complete && python3 scripts/short_exit_report.py >> ~/logs/short_exit_report.log 2>&1

Usage:
  python3 scripts/short_exit_report.py            # Send to Discord + Telegram
  python3 scripts/short_exit_report.py --dry-run   # Print only, no send
"""

import json
import os
import sys
import requests
from datetime import datetime, timedelta
from collections import defaultdict
from pathlib import Path

SHORT_EXIT_LOG_FILE = Path("/tmp/short_exit_log.json")
TELEGRAM_BOT_TOKEN = "8598008562:AAHqc4JCfo1LniklePaDr17Ws3tmjaZv108"
TELEGRAM_CHAT_ID = "645284026"


def load_log() -> list:
    try:
        with open(SHORT_EXIT_LOG_FILE, 'r') as f:
            return json.load(f)
    except:
        return []


def filter_last_24h(log: list) -> list:
    cutoff = datetime.utcnow() - timedelta(hours=24)
    cutoff_str = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")
    return [e for e in log if e.get('timestamp', '') >= cutoff_str]


def filter_last_7d(log: list) -> list:
    cutoff = datetime.utcnow() - timedelta(days=7)
    cutoff_str = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")
    return [e for e in log if e.get('timestamp', '') >= cutoff_str]


def build_report(log_24h: list, log_7d: list) -> str:
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

    if not log_24h and not log_7d:
        return f"📊 **SHORT EXIT REPORT** ({now})\n\nBrak zamkniętych shortów w ostatnich 7 dniach. SM trzymają pozycje."

    # --- 24H ANALYSIS ---
    total_closed_24h = 0
    by_whale_24h = defaultdict(lambda: {'closed_usd': 0, 'events': 0, 'coins': set()})
    by_coin_24h = defaultdict(lambda: {'closed_usd': 0, 'events': 0, 'whales': set()})
    flips_24h = []

    for entry in log_24h:
        for ex in entry.get('exits', []):
            whale = ex['whale']
            coin = ex['coin']
            closed = ex.get('closed_usd', 0)
            total_closed_24h += closed

            by_whale_24h[whale]['closed_usd'] += closed
            by_whale_24h[whale]['events'] += 1
            by_whale_24h[whale]['coins'].add(coin)

            by_coin_24h[coin]['closed_usd'] += closed
            by_coin_24h[coin]['events'] += 1
            by_coin_24h[coin]['whales'].add(whale)

            if 'FLIP' in ex.get('action', ''):
                flips_24h.append(ex)

    # --- 7D ANALYSIS ---
    total_closed_7d = 0
    by_whale_7d = defaultdict(lambda: {'closed_usd': 0, 'events': 0})

    for entry in log_7d:
        for ex in entry.get('exits', []):
            total_closed_7d += ex.get('closed_usd', 0)
            by_whale_7d[ex['whale']]['closed_usd'] += ex.get('closed_usd', 0)
            by_whale_7d[ex['whale']]['events'] += 1

    # --- SM SHORTS REMAINING (from latest snapshot) ---
    sm_snapshot = {}
    if log_24h:
        latest = log_24h[-1]
        sm_snapshot = latest.get('sm_shorts_snapshot', {})
    elif log_7d:
        latest = log_7d[-1]
        sm_snapshot = latest.get('sm_shorts_snapshot', {})

    # --- BUILD REPORT ---
    lines = []
    lines.append(f"📊 **SHORT EXIT REPORT** ({now})")
    lines.append("")

    # 24h summary
    if log_24h:
        lines.append(f"**🔴 Ostatnie 24h: ${total_closed_24h:,.0f} zamkniętych shortów** ({len(log_24h)} alertów)")
        lines.append("")

        # By whale (sorted by $ closed)
        lines.append("**Kto zamykał:**")
        sorted_whales = sorted(by_whale_24h.items(), key=lambda x: x[1]['closed_usd'], reverse=True)
        for whale, data in sorted_whales[:10]:
            coins_str = ", ".join(sorted(data['coins']))
            lines.append(f"  • {whale}: **${data['closed_usd']:,.0f}** ({data['events']}x) — {coins_str}")

        lines.append("")

        # By coin
        lines.append("**Które coiny:**")
        sorted_coins = sorted(by_coin_24h.items(), key=lambda x: x[1]['closed_usd'], reverse=True)
        for coin, data in sorted_coins:
            whales_str = ", ".join(sorted(data['whales']))
            remaining = sm_snapshot.get(coin, {})
            rem_count = remaining.get('count', '?')
            rem_value = remaining.get('value_usd', 0)
            lines.append(f"  • {coin}: **${data['closed_usd']:,.0f}** zamknięte | SM SHORT nadal: {rem_count} traderów, ${rem_value:,.0f}")

        if flips_24h:
            lines.append("")
            lines.append("**⚠️ FLIPY (SHORT → LONG):**")
            for f in flips_24h:
                lines.append(f"  • {f['whale']}: {f['coin']} — {f['action']}")
    else:
        lines.append("**Ostatnie 24h:** Brak zamkniętych shortów. SM trzymają.")

    lines.append("")

    # 7d trend
    if log_7d:
        lines.append(f"**📈 Trend 7d: ${total_closed_7d:,.0f} zamkniętych shortów** ({len(log_7d)} alertów)")
        sorted_7d = sorted(by_whale_7d.items(), key=lambda x: x[1]['closed_usd'], reverse=True)
        top3 = sorted_7d[:3]
        if top3:
            names = ", ".join(f"{w} (${d['closed_usd']:,.0f})" for w, d in top3)
            lines.append(f"  Top zamykający: {names}")

        # Trend assessment
        if total_closed_7d > 10_000_000:
            lines.append("  ⚠️ **MASS EXIT** — SM masowo wychodzą z shortów!")
        elif total_closed_7d > 5_000_000:
            lines.append("  ⚠️ **Duże wyjścia** — obserwuj czy trend przyspiesza")
        elif total_closed_7d > 1_000_000:
            lines.append("  🟡 Umiarkowane wyjścia — SM nadal trzymają gros pozycji")
        else:
            lines.append("  🟢 Minimalne wyjścia — SM conviction nadal wysoki")

    lines.append("")

    # SM shorts remaining
    if sm_snapshot:
        lines.append("**🐋 SM SHORT pozycje (aktualnie):**")
        sorted_sm = sorted(sm_snapshot.items(), key=lambda x: x[1].get('value_usd', 0), reverse=True)
        for coin, data in sorted_sm:
            if data.get('value_usd', 0) > 50000:
                lines.append(f"  • {coin}: {data['count']} traderów, **${data['value_usd']:,.0f}**")

    return "\n".join(lines)


def send_telegram(message: str):
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    data = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
        "parse_mode": "Markdown",
        "disable_web_page_preview": True
    }
    try:
        response = requests.post(url, data=data, timeout=10)
        return response.json().get('ok', False)
    except Exception as e:
        print(f"[ERROR] Telegram: {e}")
        return False


def send_discord(webhook_url: str, message: str):
    # Discord max 2000 chars per message
    chunks = []
    current = ""
    for line in message.split("\n"):
        if len(current) + len(line) + 1 > 1950:
            chunks.append(current)
            current = line
        else:
            current = current + "\n" + line if current else line
    if current:
        chunks.append(current)

    for i, chunk in enumerate(chunks):
        data = {"content": chunk}
        try:
            resp = requests.post(webhook_url, json=data, timeout=10)
            if not resp.ok:
                print(f"[ERROR] Discord: {resp.status_code} {resp.text}")
        except Exception as e:
            print(f"[ERROR] Discord: {e}")

        if i < len(chunks) - 1:
            import time
            time.sleep(0.5)


def main():
    dry_run = '--dry-run' in sys.argv
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now}] Running short exit report...")

    log = load_log()
    print(f"[INFO] Loaded {len(log)} total entries from log")

    log_24h = filter_last_24h(log)
    log_7d = filter_last_7d(log)
    print(f"[INFO] 24h: {len(log_24h)} entries, 7d: {len(log_7d)} entries")

    report = build_report(log_24h, log_7d)

    print("\n" + report + "\n")

    if dry_run:
        print("[DRY RUN] Skipping send")
        return

    # Send to Telegram
    ok = send_telegram(report)
    print(f"[TELEGRAM] {'OK' if ok else 'FAILED'}")

    # Send to Discord
    webhook_url = os.environ.get('DISCORD_WEBHOOK_URL', '')
    if webhook_url:
        send_discord(webhook_url, report)
        print("[DISCORD] Sent")
    else:
        print("[DISCORD] No DISCORD_WEBHOOK_URL set, skipping")

    print("[DONE]")


if __name__ == "__main__":
    main()
