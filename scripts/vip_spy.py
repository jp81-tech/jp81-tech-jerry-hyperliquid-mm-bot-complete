#!/usr/bin/env python3
"""
vip_spy.py - Operacja "Cień Generała" v2
Monitoruje pozycje VIP SM traderów w czasie rzeczywistym.
Tier-based polling: tier1 (30s), tier2 (2min), fund (5min)

Uruchomienie:
  python3 scripts/vip_spy.py
  pm2 start scripts/vip_spy.py --name vip-spy --interpreter python3
"""

import requests
import json
import time
import os
from datetime import datetime
from pathlib import Path

# ============================================================
# DEFAULTS (fallback gdy brak vip_config.json)
# ============================================================

VIP_TARGETS_DEFAULT = {
    "0xa312114b5795dff9b8db50474dd57701aa78ad1e": {
        "name": "Generał", "emoji": "🎖️", "tier": "tier1",
        "notes": "PnL +$15M, HYPE/LIT/FARTCOIN shorter"
    },
    "0x45d26f28196d226497130c4bac709d808fed4029": {
        "name": "Wice-Generał", "emoji": "🎖️", "tier": "tier1",
        "notes": "PnL +$30.6M, BTC/HYPE mega shorter"
    },
    "0x5d2f4460ac3514ada79f5d9838916e508ab39bb7": {
        "name": "Pułkownik", "emoji": "🎖️", "tier": "tier1",
        "notes": "PnL +$21.1M, MEGA SHORT BTC $44.6M"
    },
    "0x35d1151ef1aab579cbb3109e69fa82f94ff5acb1": {
        "name": "Major", "emoji": "🎖️", "tier": "tier1",
        "notes": "PnL +$12.8M, MEGA SHORT SOL $65M"
    }
}

WATCHED_COINS_DEFAULT = ["LIT", "FARTCOIN", "HYPE", "BTC", "SOL", "ETH", "DOGE", "SUI", "ZEC", "VIRTUAL", "XRP", "BNB", "LTC", "ENA", "S", "PUMP", "ASTER", "UNI", "XPL", "xyz:GOLD"]

POLL_INTERVALS_DEFAULT = {
    "tier1": 30,
    "tier2": 120,
    "fund": 300
}

# ============================================================
# CONFIG LOADING
# ============================================================

CONFIG_PATH = Path(__file__).parent / "vip_config.json"

def load_config() -> dict:
    """Załaduj konfigurację z vip_config.json, fallback do defaults"""
    try:
        if CONFIG_PATH.exists():
            with open(CONFIG_PATH) as f:
                config = json.load(f)
            # Walidacja minimalnych pól
            if "vips" in config and "watched_coins" in config:
                return config
            log("vip_config.json niekompletny - używam defaults", "WARN")
    except json.JSONDecodeError as e:
        log(f"Błąd parsowania vip_config.json: {e}", "ERROR")
    except Exception as e:
        log(f"Błąd ładowania vip_config.json: {e}", "ERROR")

    return {
        "vips": VIP_TARGETS_DEFAULT,
        "watched_coins": WATCHED_COINS_DEFAULT,
        "poll_intervals": POLL_INTERVALS_DEFAULT
    }

# ============================================================
# KONFIGURACJA STAŁA
# ============================================================

# Hyperliquid API
HL_API_URL = "https://api.hyperliquid.xyz/info"

# Telegram
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "8598008562:AAHqc4JCfo1LniklePaDr17Ws3tmjaZv108")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "645284026")

# Thresholds
POSITION_CHANGE_THRESHOLD_USD = 10000  # Alert gdy zmiana > $10K
SIZE_CHANGE_THRESHOLD_PCT = 5  # Alert gdy size zmieni się o >5%
DUST_THRESHOLD_USD = 10  # Ignoruj pozycje < $10
BASE_POLL_INTERVAL_SEC = 30

# State file
STATE_FILE = Path("/tmp/vip_spy_state.json")
GENERAL_CHANGES_FILE = Path("/tmp/general_changes.json")  # For copy-trading bot

# Generał — track ALL positions (not just watched_coins)
GENERAL_ADDRESS = "0xa312114b5795dff9b8db50474dd57701aa78ad1e"

# ============================================================
# FUNKCJE POMOCNICZE
# ============================================================

def log(msg: str, level: str = "INFO"):
    """Logowanie z timestampem"""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    prefix = {
        "INFO": "ℹ️",
        "ALERT": "🚨",
        "CHANGE": "📊",
        "ERROR": "❌",
        "SPY": "🕵️",
        "WARN": "⚠️",
        "DUST": "🧹"
    }.get(level, "•")
    print(f"[{ts}] {prefix} [{level}] {msg}", flush=True)

def send_telegram(message: str):
    """Wyślij alert na Telegram"""
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
            "parse_mode": "Markdown"
        }
        requests.post(url, json=payload, timeout=10)
    except Exception as e:
        log(f"Telegram error: {e}", "ERROR")

def get_positions(address: str, watched_coins: list, vip_name: str = "", track_all: bool = False) -> dict:
    """Pobierz pozycje z Hyperliquid API z dust filter.
    track_all=True → trackuj WSZYSTKIE coiny (dla Generała + copy-trading)
    Fetches both standard perps AND xyz dex positions.
    """
    positions = {}

    # Fetch from both standard perps and xyz dex
    dex_configs = [
        (None, "perps"),    # standard perps (no dex param)
        ("xyz", "xyz dex"), # xyz builder-deployed dex (GOLD, TSLA, etc.)
    ]

    for dex_param, dex_label in dex_configs:
        try:
            payload = {"type": "clearinghouseState", "user": address}
            if dex_param:
                payload["dex"] = dex_param

            response = requests.post(HL_API_URL, json=payload, timeout=10)
            if response.status_code == 429:
                log(f"Rate limited for {address[:10]} ({dex_label}), retry in 5s", "ERROR")
                time.sleep(5)
                continue
            data = response.json()
            if data is None:
                continue

            for p in data.get("assetPositions", []):
                pos = p.get("position", {})
                coin = pos.get("coin")
                szi = float(pos.get("szi", 0))
                position_value = abs(float(pos.get("positionValue", 0)))

                # Dust/spam filter:
                # 1. Size > 0.001 (mikro-pozycje)
                # 2. Position value > $10 (tokeny za $0 = spam/dust)
                # 3. Coin on whitelist OR track_all=True (Generał)
                if abs(szi) > 0.001 and position_value > DUST_THRESHOLD_USD:
                    if track_all or coin in watched_coins:
                        positions[coin] = {
                            "size": szi,
                            "side": "SHORT" if szi < 0 else "LONG",
                            "entry_px": float(pos.get("entryPx", 0)),
                            "position_value": position_value,
                            "unrealized_pnl": float(pos.get("unrealizedPnl", 0)),
                            "leverage": pos.get("leverage", {}).get("value", "cross")
                        }
                    elif position_value > 1000:
                        log(f"UNKNOWN COIN: {vip_name} has {coin} worth ${position_value:.0f} - not in WATCHED_COINS", "WARN")

        except Exception as e:
            log(f"API error for {address[:10]} ({dex_label}): {e}", "ERROR")

    return positions

def load_state() -> dict:
    """Załaduj poprzedni stan"""
    try:
        if STATE_FILE.exists():
            with open(STATE_FILE) as f:
                return json.load(f)
    except:
        pass
    return {}

def save_state(state: dict):
    """Zapisz aktualny stan"""
    try:
        with open(STATE_FILE, 'w') as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        log(f"Save state error: {e}", "ERROR")

def compare_positions(old: dict, new: dict, vip_name: str, vip_emoji: str) -> list:
    """Porównaj pozycje i wykryj zmiany"""
    changes = []

    all_coins = set(old.keys()) | set(new.keys())

    for coin in all_coins:
        old_pos = old.get(coin, {})
        new_pos = new.get(coin, {})

        old_size = old_pos.get("size", 0)
        new_size = new_pos.get("size", 0)
        old_value = old_pos.get("position_value", 0)
        new_value = new_pos.get("position_value", 0)

        # Nowa pozycja
        if not old_pos and new_pos:
            changes.append({
                "type": "NEW_POSITION",
                "coin": coin,
                "vip": vip_name,
                "emoji": vip_emoji,
                "side": new_pos["side"],
                "size": new_size,
                "value": new_value,
                "entry": new_pos.get("entry_px", 0)
            })
            continue

        # Zamknięta pozycja
        if old_pos and not new_pos:
            changes.append({
                "type": "CLOSED_POSITION",
                "coin": coin,
                "vip": vip_name,
                "emoji": vip_emoji,
                "old_side": old_pos["side"],
                "old_size": old_size,
                "old_value": old_value,
                "pnl": old_pos.get("unrealized_pnl", 0)
            })
            continue

        # Zmiana rozmiaru
        if old_pos and new_pos:
            size_change = new_size - old_size
            value_change = new_value - old_value

            # Zmiana strony (flip)
            if old_pos["side"] != new_pos["side"]:
                changes.append({
                    "type": "FLIP_POSITION",
                    "coin": coin,
                    "vip": vip_name,
                    "emoji": vip_emoji,
                    "old_side": old_pos["side"],
                    "new_side": new_pos["side"],
                    "new_size": new_size,
                    "new_value": new_value
                })
                continue

            # Znacząca zmiana rozmiaru
            size_pct_change = abs(size_change / old_size * 100) if old_size != 0 else 100

            # Skip jeśli size praktycznie się nie zmienił (< 0.1%)
            if size_pct_change < 0.1:
                continue

            if size_pct_change >= SIZE_CHANGE_THRESHOLD_PCT:
                action = "INCREASED" if abs(new_size) > abs(old_size) else "REDUCED"
                changes.append({
                    "type": f"SIZE_{action}",
                    "coin": coin,
                    "vip": vip_name,
                    "emoji": vip_emoji,
                    "side": new_pos["side"],
                    "old_size": old_size,
                    "new_size": new_size,
                    "size_change": size_change,
                    "size_pct_change": size_pct_change,
                    "old_value": old_value,
                    "new_value": new_value,
                    "value_change": value_change
                })

    return changes

def format_alert(change: dict) -> str:
    """Formatuj alert do wysłania"""
    emoji = change["emoji"]
    vip = change["vip"]
    coin = change["coin"]
    change_type = change["type"]

    if change_type == "NEW_POSITION":
        return (
            f"🚨 *VIP ALERT - NOWA POZYCJA*\n\n"
            f"{emoji} *{vip}* otworzył:\n"
            f"📍 *{coin}* {change['side']}\n"
            f"📊 Size: {change['size']:,.2f}\n"
            f"💰 Value: ${change['value']:,.0f}\n"
            f"🎯 Entry: ${change['entry']:.4f}"
        )

    elif change_type == "CLOSED_POSITION":
        return (
            f"🚨 *VIP ALERT - ZAMKNIĘTA POZYCJA*\n\n"
            f"{emoji} *{vip}* zamknął:\n"
            f"📍 *{coin}* {change['old_side']}\n"
            f"📊 Size: {change['old_size']:,.2f}\n"
            f"💰 Value: ${change['old_value']:,.0f}\n"
            f"📈 Realized PnL: ${change['pnl']:,.0f}"
        )

    elif change_type == "FLIP_POSITION":
        return (
            f"🚨🚨 *VIP ALERT - FLIP POZYCJI!*\n\n"
            f"{emoji} *{vip}* ZMIENIŁ STRONĘ:\n"
            f"📍 *{coin}*\n"
            f"🔄 {change['old_side']} → {change['new_side']}\n"
            f"📊 New Size: {change['new_size']:,.2f}\n"
            f"💰 New Value: ${change['new_value']:,.0f}"
        )

    elif "SIZE_" in change_type:
        action_emoji = "📈" if "INCREASED" in change_type else "📉"
        action_word = "ZWIĘKSZYŁ" if "INCREASED" in change_type else "ZMNIEJSZYŁ"
        return (
            f"🚨 *VIP ALERT - ZMIANA POZYCJI*\n\n"
            f"{emoji} *{vip}* {action_word}:\n"
            f"📍 *{coin}* {change['side']}\n"
            f"{action_emoji} Size: {change['old_size']:,.2f} → {change['new_size']:,.2f}\n"
            f"📊 Change: {change['size_change']:+,.2f} ({change['size_pct_change']:+.1f}%)\n"
            f"💰 Value: ${change['old_value']:,.0f} → ${change['new_value']:,.0f}\n"
            f"💵 Δ Value: ${change['value_change']:+,.0f}"
        )

    return f"🚨 VIP ALERT: {vip} - {coin} - {change_type}"


def format_portfolio_summary(positions: dict) -> str:
    """Generuj podsumowanie portfela (dla Generała)"""
    if not positions:
        return ""
    total_value = sum(p["position_value"] for p in positions.values())
    total_pnl = sum(p["unrealized_pnl"] for p in positions.values())
    shorts = [(c, p) for c, p in positions.items() if p["side"] == "SHORT"]
    longs = [(c, p) for c, p in positions.items() if p["side"] == "LONG"]
    lines = [f"\n📊 *Portfel Generała* ({len(positions)} poz, ${total_value:,.0f}, uPnL ${total_pnl:+,.0f})"]
    for coin, p in sorted(positions.items(), key=lambda x: -x[1]["position_value"]):
        emoji = "🔴" if p["side"] == "SHORT" else "🟢"
        lines.append(f"  {emoji} {coin} {p['side']} ${p['position_value']:,.0f} (${p['unrealized_pnl']:+,.0f})")
    return "\n".join(lines)


def write_general_changes(changes: list, general_positions: dict):
    """Zapisz zmiany Generała do pliku dla copy-trading bota"""
    try:
        entry = {
            "timestamp": datetime.now().isoformat(),
            "changes": changes,
            "positions": general_positions,
            "total_value": sum(p["position_value"] for p in general_positions.values()) if general_positions else 0,
            "total_pnl": sum(p["unrealized_pnl"] for p in general_positions.values()) if general_positions else 0,
        }
        with open(GENERAL_CHANGES_FILE, 'w') as f:
            json.dump(entry, f, indent=2)
    except Exception as e:
        log(f"Write general_changes error: {e}", "ERROR")


def should_poll_vip(cycle: int, tier: str, poll_intervals: dict) -> bool:
    """Sprawdź czy VIP powinien być pollowany w tym cyklu"""
    interval = poll_intervals.get(tier, 30)
    cycles_needed = max(1, interval // BASE_POLL_INTERVAL_SEC)
    return cycle % cycles_needed == 0

# ============================================================
# GŁÓWNA PĘTLA
# ============================================================

def main():
    # Załaduj config
    config = load_config()
    vips = config["vips"]
    watched_coins = config["watched_coins"]
    poll_intervals = config.get("poll_intervals", POLL_INTERVALS_DEFAULT)

    # Policz tiery
    tier_counts = {}
    for vip in vips.values():
        t = vip.get("tier", "tier1")
        tier_counts[t] = tier_counts.get(t, 0) + 1

    config_source = "vip_config.json" if CONFIG_PATH.exists() else "defaults (hardcoded)"

    log("=" * 60, "SPY")
    log("OPERACJA 'CIEŃ GENERAŁA' v2 ROZPOCZĘTA", "SPY")
    log("=" * 60, "SPY")
    log(f"Config: {config_source}", "SPY")
    log(f"VIPy: {len(vips)} total ({', '.join(f'{k}={v}' for k,v in tier_counts.items())})", "SPY")
    log(f"Monitorowane coiny: {', '.join(watched_coins)}", "SPY")
    log(f"Poll intervals: {', '.join(f'{k}={v}s' for k,v in poll_intervals.items())}", "SPY")
    log(f"Dust filter: > ${DUST_THRESHOLD_USD}", "SPY")
    log(f"Threshold: ${POSITION_CHANGE_THRESHOLD_USD:,} lub {SIZE_CHANGE_THRESHOLD_PCT}%", "SPY")

    # Estimated calls/min
    calls_per_min = 0
    for tier_name, count in tier_counts.items():
        interval = poll_intervals.get(tier_name, 30)
        calls_per_min += count * (60 / interval)
    log(f"Estimated API calls: ~{calls_per_min:.0f}/min", "SPY")
    log("=" * 60, "SPY")

    # Załaduj poprzedni stan
    state = load_state()

    # Pierwszy scan - pokaż aktualny stan (wszystkie VIPy)
    log("Pierwszy skan - zbieranie danych bazowych...", "INFO")
    for address, vip_info in vips.items():
        # Generał: track ALL coins (not just watched_coins) for copy-trading
        is_general = address.lower() == GENERAL_ADDRESS.lower()
        positions = get_positions(address, watched_coins, vip_info["name"], track_all=is_general)
        state[address] = positions

        tier_label = vip_info.get("tier", "?")
        suffix = " [ALL COINS]" if is_general else ""
        if positions:
            log(f"{vip_info['emoji']} {vip_info['name']} [{tier_label}]{suffix}:", "INFO")
            for coin, pos in sorted(positions.items(), key=lambda x: -x[1]["position_value"]):
                log(f"   {coin}: {pos['side']} {pos['size']:,.2f} (${pos['position_value']:,.0f}, uPnL: ${pos['unrealized_pnl']:,.0f})", "INFO")
        else:
            log(f"{vip_info['emoji']} {vip_info['name']} [{tier_label}]: Brak pozycji", "INFO")

        # Write initial Generał state for copy bot
        if is_general:
            write_general_changes([], positions)

        # Rate limit protection during initial scan
        time.sleep(0.5)

    save_state(state)
    log("Dane bazowe zapisane. Rozpoczynam monitoring...", "INFO")

    # Główna pętla monitoringu
    cycle = 0
    while True:
        try:
            time.sleep(BASE_POLL_INTERVAL_SEC)
            cycle += 1

            # Hot-reload config co 10 cykli (~5 min)
            if cycle % 10 == 0:
                new_config = load_config()
                old_count = len(vips)
                vips = new_config["vips"]
                watched_coins = new_config["watched_coins"]
                poll_intervals = new_config.get("poll_intervals", POLL_INTERVALS_DEFAULT)
                if len(vips) != old_count:
                    log(f"Config reloaded: {old_count} → {len(vips)} VIPów", "INFO")

            all_changes = []
            general_changes = []
            new_state = {}
            polled_count = 0

            for address, vip_info in vips.items():
                tier = vip_info.get("tier", "tier1")

                # Tier-based polling - skip VIP jeśli nie jego cykl
                if not should_poll_vip(cycle, tier, poll_intervals):
                    # Zachowaj poprzedni stan dla niepollowanych VIPów
                    new_state[address] = state.get(address, {})
                    continue

                polled_count += 1
                is_general = address.lower() == GENERAL_ADDRESS.lower()
                positions = get_positions(address, watched_coins, vip_info["name"], track_all=is_general)

                # Anti-glitch: Jeśli API zwróciło puste dane, zachowaj poprzedni stan
                old_positions = state.get(address, {})
                if not positions and old_positions:
                    log(f"API glitch dla {vip_info['name']} - zachowuję poprzedni stan", "WARN")
                    new_state[address] = old_positions
                    continue

                new_state[address] = positions

                changes = compare_positions(
                    old_positions,
                    positions,
                    vip_info["name"],
                    vip_info["emoji"]
                )
                all_changes.extend(changes)

                # Track Generał changes separately for copy-trading bot
                if is_general and changes:
                    general_changes = changes

            # Obsłuż zmiany
            if all_changes:
                log(f"WYKRYTO {len(all_changes)} ZMIAN!", "ALERT")

                for change in all_changes:
                    alert_msg = format_alert(change)
                    log(alert_msg.replace("*", "").replace("\n", " | "), "CHANGE")

                    # For Generał: add portfolio summary to alert
                    is_general_change = change.get("vip", "") == "Generał"
                    if is_general_change:
                        general_pos = new_state.get(GENERAL_ADDRESS, {})
                        portfolio_summary = format_portfolio_summary(general_pos)
                        alert_msg += portfolio_summary

                    send_telegram(alert_msg)

            # Write Generał changes file for copy-trading bot (every tick, even if no changes)
            general_pos = new_state.get(GENERAL_ADDRESS, state.get(GENERAL_ADDRESS, {}))
            write_general_changes(general_changes, general_pos)

            # Update state
            state = new_state
            save_state(state)

            # Cichy log co 10 cykli (~5 min)
            if cycle % 10 == 0:
                if not all_changes:
                    log(f"Cykl #{cycle} - brak zmian. Polled {polled_count} VIPów w tym cyklu.", "SPY")

        except KeyboardInterrupt:
            log("Otrzymano SIGINT - zamykam agenta.", "INFO")
            break
        except Exception as e:
            log(f"Błąd w głównej pętli: {e}", "ERROR")
            time.sleep(5)

if __name__ == "__main__":
    main()
