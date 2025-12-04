import json
import os
import csv
import time
from datetime import datetime
from rich.console import Console
from rich.layout import Layout
from rich.panel import Panel
from rich.table import Table
from rich.live import Live
from rich.text import Text
from rich import box

# KONFIGURACJA ŚCIEŻEK
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# liquidity_monitor is a subdirectory of scripts
LIQ_MONITOR_DIR = os.path.join(BASE_DIR, "liquidity_monitor")
FLAGS_FILE = os.path.join(LIQ_MONITOR_DIR, "liquidity_flags.json")
ALERTS_CSV = os.path.join(LIQ_MONITOR_DIR, "alerts_liquidity.csv")
BOT_LOG = os.path.join(BASE_DIR, "../bot.log") # Assuming scripts/mm_dashboard.py -> ../bot.log

console = Console()

def load_liquidity_flags():
    if not os.path.exists(FLAGS_FILE):
        return {}
    try:
        with open(FLAGS_FILE, "r") as f:
            return json.load(f)
    except:
        return {}

def get_recent_alerts(limit=5):
    if not os.path.exists(ALERTS_CSV):
        return []
    try:
        with open(ALERTS_CSV, "r") as f:
            rows = list(csv.reader(f))
            return rows[-limit:][::-1]
    except:
        return []

def parse_bot_log():
    """Parses bot.log for PnL sync lines"""
    pnl_info = {"daily": "N/A", "fills": "0", "last_sync": "Waiting..."}
    if not os.path.exists(BOT_LOG):
        return pnl_info

    try:
        # Read last 200 lines roughly
        with open(BOT_LOG, "rb") as f:
            try:
                f.seek(-20000, os.SEEK_END)
            except OSError:
                pass # File smaller than 20kb

            lines = f.readlines()
            for line in reversed(lines):
                decoded = line.decode('utf-8', errors='ignore')
                if "rawDaily=$" in decoded and "effectiveDaily=$" in decoded:
                    # Log Format: [INFO] 2025-XX-XX ... ✅ Synced X new fills | rawDaily=$...
                    parts = decoded.split("|")
                    if len(parts) >= 3:
                        try:
                            # Extract fills
                            sync_part = parts[0]
                            if "Synced" in sync_part:
                                pnl_info["fills"] = sync_part.split("Synced")[1].split("new")[0].strip()

                            # Extract Daily PnL
                            daily_part = parts[2] # effectiveDaily=$...
                            if "=" in daily_part:
                                pnl_info["daily"] = daily_part.split("=")[1].strip()

                            # Extract Timestamp (start of line)
                            # Assuming standard log format "[LEVEL] ISO-DATE msg"
                            # We just take first 25 chars or so
                            pnl_info["last_sync"] = decoded[:19]
                        except:
                            pass
                    break
    except Exception:
        pass
    return pnl_info

def generate_layout():
    layout = Layout()
    layout.split_column(
        Layout(name="header", size=3),
        Layout(name="main", ratio=1),
        Layout(name="footer", size=3)
    )
    layout["main"].split_row(
        Layout(name="left", ratio=1),
        Layout(name="right", ratio=1),
    )
    return layout

def make_header():
    grid = Table.grid(expand=True)
    grid.add_column(justify="center", ratio=1)
    grid.add_column(justify="right")
    grid.add_row(
        "[b white]HYPERLIQUID MM COMMAND CENTER[/]",
        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    )
    return Panel(grid, style="white on blue")

def make_liquidity_panel():
    flags = load_liquidity_flags()
    table = Table(box=box.SIMPLE_HEAD, expand=True)
    table.add_column("Pair", style="cyan")
    table.add_column("Risk", style="magenta")
    table.add_column("Updated", style="dim")

    if not flags:
        table.add_row("-", "No flags active", "-")
    else:
        for pair, data in flags.items():
            risk = str(data.get("risk", "UNKNOWN")).upper()
            style = "green"
            if "RUG" in risk or "CRITICAL" in risk:
                style = "bold red blink"
            elif "RISKY" in risk:
                style = "yellow"
            elif "SAFE" in risk:
                style = "green"

            ts = data.get("updated_at", "").split("T")[-1][:8]
            table.add_row(pair, f"[{style}]{risk}[/]", ts)

    return Panel(table, title="🛡️ Liquidity Guard", border_style="cyan")

def make_alerts_panel():
    alerts = get_recent_alerts(10)
    table = Table(box=box.SIMPLE_HEAD, expand=True)
    table.add_column("Time", style="dim")
    table.add_column("Sym", style="white")
    table.add_column("Event", style="red")

    if not alerts:
        table.add_row("-", "-", "No recent alerts")

    for row in alerts:
        if len(row) < 6: continue
        # row structure: ts, kind, symbol, dex, chain, risk...
        ts = row[0].split("T")[-1][:8]
        kind = row[1]
        sym = row[2]
        risk = row[5]

        msg = risk
        if kind == "unlock": msg = "🔓 UNLOCK"

        color = "white"
        if "RUG" in str(risk): color = "bold red"
        elif "CRITICAL" in str(risk): color = "red"

        table.add_row(ts, sym, f"[{color}]{msg}[/]")

    return Panel(table, title="🚨 Recent Alerts Log", border_style="red")

def make_pnl_panel():
    data = parse_bot_log()

    text = Text()
    text.append(f"\n💰 Daily PnL: ", style="bold white")

    pnl_val = data['daily']
    if "-" in pnl_val and "$" in pnl_val: # Negative
        text.append(pnl_val, style="bold red")
    elif pnl_val == "N/A":
        text.append(pnl_val, style="dim")
    else:
        text.append(pnl_val, style="bold green")

    text.append(f"\n\n⚡ Recent Fills: {data['fills']}")
    text.append(f"\n🕒 Last Sync: {data['last_sync']}", style="dim")

    return Panel(text, title="💸 Bot Performance (from Logs)", border_style="green")

def run_dashboard():
    layout = generate_layout()

    with Live(layout, refresh_per_second=1, screen=True):
        while True:
            layout["header"].update(make_header())

            # Left column: Liquidity Flags + PnL
            layout["left"].split_column(
                Layout(make_liquidity_panel(), ratio=2),
                Layout(make_pnl_panel(), ratio=1)
            )

            # Right column: Alerts Log
            layout["right"].update(make_alerts_panel())

            time.sleep(1)

if __name__ == "__main__":
    try:
        run_dashboard()
    except KeyboardInterrupt:
        pass

