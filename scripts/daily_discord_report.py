#!/usr/bin/env python3
"""Daily 24h Performance Report → Discord Webhook.

Run via cron every day at 00:00 UTC:
  0 0 * * * cd ~/hyperliquid-mm-bot-complete && python3 scripts/daily_discord_report.py

Or manually: python3 scripts/daily_discord_report.py
"""

import json
import subprocess
import time
import os
from datetime import datetime, timezone, timedelta

# ── Config ──
HL_API = "https://api.hyperliquid.xyz/info"
ACCOUNT = "0xf4620f6fb51fa2fdf3464e0b5b8186d14bc902fe"
DISCORD_WEBHOOK = os.environ.get(
    "DISCORD_REPORT_WEBHOOK",
    "https://discord.com/api/webhooks/1480457123182678087/"
    "Vk1gKhcASJANvBK1z-5qarDxBgDwD1xprpliYOqz0L1n8-Rxl-AuvOL2YEXZOLu8mDle"
)
TRACKED_PAIRS = {"kPEPE": "mm-pure", "VIRTUAL": "mm-virtual"}
PM2 = os.path.expanduser("~/.npm/_npx/5f7878ce38f1eb13/node_modules/pm2/bin/pm2")


def hl_post(payload: dict) -> dict:
    r = subprocess.run(
        ["curl", "-s", "--max-time", "15", "-X", "POST", HL_API,
         "-H", "Content-Type: application/json", "-d", json.dumps(payload)],
        capture_output=True, text=True
    )
    return json.loads(r.stdout) if r.stdout else {}


def get_account_state() -> dict:
    return hl_post({"type": "clearinghouseState", "user": ACCOUNT})


def get_fills_24h() -> list:
    """Fetch fills from the last 24 hours (paginated)."""
    cutoff_ms = int((time.time() - 86400) * 1000)
    all_fills = []
    start_time = int(time.time() * 1000)

    # First request
    fills = hl_post({"type": "userFills", "user": ACCOUNT})
    if not fills:
        return []
    all_fills.extend(fills)

    # Paginate if oldest fill is still within 24h
    while fills and fills[-1]["time"] > cutoff_ms:
        end_time = fills[-1]["time"] - 1
        fills = hl_post({
            "type": "userFillsByTime",
            "user": ACCOUNT,
            "startTime": cutoff_ms,
            "endTime": end_time
        })
        if fills:
            all_fills.extend(fills)
        else:
            break

    # Filter to 24h window
    return [f for f in all_fills if f["time"] >= cutoff_ms]


def get_pm2_logs(process_name: str, lines: int = 5000) -> str:
    try:
        r = subprocess.run(
            [PM2, "logs", process_name, f"--lines={lines}", "--nostream"],
            capture_output=True, text=True, timeout=15
        )
        return r.stdout + r.stderr
    except Exception:
        return ""


def parse_guard_blocks(logs: str) -> dict:
    guard_count = logs.count("[GUARD]")
    breakeven_count = logs.count("[BREAKEVEN_BLOCK]")
    return {"guard": guard_count, "breakeven": breakeven_count, "total": guard_count + breakeven_count}


def parse_exec_stats(logs: str) -> dict:
    """Extract latest Exec: line."""
    for line in reversed(logs.split("\n")):
        if "Exec:" in line:
            # Exec: 96.0% success (9123/9504) | Avg latency: 33098ms
            try:
                pct = line.split("Exec:")[1].split("%")[0].strip()
                counts = line.split("(")[1].split(")")[0]
                ok, total = counts.split("/")
                latency = line.split("latency:")[1].strip().replace("ms", "")
                return {
                    "success_pct": float(pct),
                    "ok": int(ok),
                    "total": int(total),
                    "latency_ms": int(latency)
                }
            except (IndexError, ValueError):
                pass
    return {"success_pct": 0, "ok": 0, "total": 0, "latency_ms": 0}


def parse_vpin(logs: str, pair: str) -> str:
    for line in reversed(logs.split("\n")):
        if f"VPIN: {pair}:" in line:
            try:
                return line.split(f"VPIN: {pair}:")[1].split("|")[0].strip().split()[0]
            except IndexError:
                pass
    return "N/A"


def analyze_fills(fills: list) -> dict:
    """Compute per-pair metrics from fill data."""
    pairs = {}
    for f in fills:
        coin = f["coin"]
        if coin not in TRACKED_PAIRS:
            continue
        if coin not in pairs:
            pairs[coin] = {
                "buys": 0, "sells": 0, "buy_vol": 0.0, "sell_vol": 0.0,
                "total_fee": 0.0, "realized_pnl": 0.0,
                "close_count": 0, "open_count": 0,
                "first_fill_ts": None, "last_fill_ts": None,
                "underwater_fills": [],
            }
        p = pairs[coin]
        notional = float(f["px"]) * float(f["sz"])
        fee = float(f["fee"])
        pnl = float(f["closedPnl"])

        if f["side"] == "B":
            p["buys"] += 1
            p["buy_vol"] += notional
        else:
            p["sells"] += 1
            p["sell_vol"] += notional

        p["total_fee"] += fee
        p["realized_pnl"] += pnl

        if "Close" in f.get("dir", ""):
            p["close_count"] += 1
        else:
            p["open_count"] += 1

        ts = f["time"]
        if p["first_fill_ts"] is None or ts < p["first_fill_ts"]:
            p["first_fill_ts"] = ts
        if p["last_fill_ts"] is None or ts > p["last_fill_ts"]:
            p["last_fill_ts"] = ts

    return pairs


def compute_inventory_aging(fills: list, current_positions: dict) -> dict:
    """Estimate how long underwater positions were held before closing."""
    aging = {}
    for coin in TRACKED_PAIRS:
        closes = [f for f in fills if f["coin"] == coin and "Close" in f.get("dir", "")]
        opens = [f for f in fills if f["coin"] == coin and "Open" in f.get("dir", "")]

        if not closes:
            aging[coin] = "No closes"
            continue

        # Simple heuristic: time between first open and last close
        if opens:
            first_open = min(o["time"] for o in opens)
            last_close = max(c["time"] for c in closes)
            hold_hours = (last_close - first_open) / 3600000
            aging[coin] = f"{hold_hours:.1f}h"
        else:
            aging[coin] = "N/A (no opens in window)"

    return aging


def build_report() -> dict:
    """Build the full Discord embed payload."""
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")

    # ── Gather data ──
    state = get_account_state()
    fills_24h = get_fills_24h()
    fill_stats = analyze_fills(fills_24h)

    # Account-level
    margin = state.get("marginSummary", {})
    equity = float(margin.get("accountValue", 0))
    margin_used = float(margin.get("totalMarginUsed", 0))
    ntl_pos = float(margin.get("totalNtlPos", 0))
    acct_leverage = ntl_pos / equity if equity > 0 else 0
    free_margin = equity - margin_used

    # Positions
    positions = {}
    for p in state.get("assetPositions", []):
        pos = p["position"]
        sz = float(pos["szi"])
        if sz == 0:
            continue
        coin = pos["coin"]
        positions[coin] = {
            "size": abs(sz),
            "side": "LONG" if sz > 0 else "SHORT",
            "entry": float(pos["entryPx"]),
            "upnl": float(pos.get("unrealizedPnl", 0)),
            "leverage": pos.get("leverage", {}).get("value", "?"),
            "liq_px": pos.get("liquidationPx", "N/A"),
            "raw_size": sz,
        }

    # PM2 logs
    logs = {}
    for pair, pm2_name in TRACKED_PAIRS.items():
        logs[pair] = get_pm2_logs(pm2_name)

    # Guard blocks
    guard_stats = {}
    for pair, log_text in logs.items():
        guard_stats[pair] = parse_guard_blocks(log_text)

    # Exec stats
    exec_stats = {}
    for pair, log_text in logs.items():
        exec_stats[pair] = parse_exec_stats(log_text)

    # VPIN
    vpin = {}
    for pair, log_text in logs.items():
        vpin[pair] = parse_vpin(log_text, pair)

    # Inventory aging
    aging = compute_inventory_aging(fills_24h, positions)

    # ── Total PnL ──
    total_realized = sum(fs.get("realized_pnl", 0) for fs in fill_stats.values())
    total_fees = sum(fs.get("total_fee", 0) for fs in fill_stats.values())
    total_fills = sum(fs.get("buys", 0) + fs.get("sells", 0) for fs in fill_stats.values())
    total_upnl = sum(pos.get("upnl", 0) for pos in positions.values())
    net_pnl = total_realized - total_fees

    # Fee efficiency
    fee_efficiency = (total_fees / total_realized * 100) if total_realized > 0 else 0

    # ── Format position blocks ──
    def fmt_pair(coin: str) -> str:
        pos = positions.get(coin, {})
        fs = fill_stats.get(coin, {})
        gs = guard_stats.get(coin, {})
        es = exec_stats.get(coin, {})

        if not pos:
            side_str = "FLAT"
            entry_str = "N/A"
            upnl_str = "$0.00"
            lev_str = "-"
            liq_str = "N/A"
            skew_str = "0%"
        else:
            side_str = f"{pos['side']} {pos['size']:,.1f}"
            entry_str = f"${pos['entry']:.6f}"
            upnl_str = f"${pos['upnl']:+,.2f}"
            lev_str = f"{pos['leverage']}x"
            liq_str = f"${float(pos['liq_px']):.6f}" if pos['liq_px'] not in ("N/A", "None", None) else "N/A"
            # Skew = position notional / equity
            pos_ntl = pos["size"] * pos["entry"]
            skew_pct = pos_ntl / equity * 100 if equity > 0 else 0
            skew_sign = "-" if pos["side"] == "SHORT" else "+"
            skew_str = f"{skew_sign}{skew_pct:.1f}%"

        rpnl = fs.get("realized_pnl", 0)
        fee = fs.get("total_fee", 0)
        buys = fs.get("buys", 0)
        sells = fs.get("sells", 0)
        buy_vol = fs.get("buy_vol", 0)
        sell_vol = fs.get("sell_vol", 0)
        ag = aging.get(coin, "N/A")

        return (
            f"Position:     {side_str}\n"
            f"Entry:        {entry_str}\n"
            f"Unrealized:   {upnl_str}\n"
            f"Realized PnL: ${rpnl:+,.2f}\n"
            f"Fees Paid:    ${fee:.2f}\n"
            f"Net PnL:      ${rpnl - fee:+,.2f}\n"
            f"Leverage:     {lev_str}\n"
            f"Liq. Price:   {liq_str}\n"
            f"Skew:         {skew_str}\n"
            f"Fills:        {buys}B / {sells}S (${buy_vol + sell_vol:,.0f} vol)\n"
            f"Inv. Aging:   {ag}\n"
            f"Guard Blocks: {gs.get('total', 0)} ({gs.get('breakeven', 0)} BE + {gs.get('guard', 0)} HBG)\n"
            f"VPIN:         {vpin.get(coin, 'N/A')}\n"
            f"Exec:         {es.get('success_pct', 0):.1f}% ({es.get('ok', 0)}/{es.get('total', 0)})"
        )

    # ── Risk level ──
    if acct_leverage < 0.5:
        risk_emoji = "🟢"
        risk_label = "LOW"
    elif acct_leverage < 1.5:
        risk_emoji = "🟡"
        risk_label = "MEDIUM"
    else:
        risk_emoji = "🔴"
        risk_label = "HIGH"

    # ── Build embed ──
    pnl_emoji = "🟢" if net_pnl >= 0 else "🔴"
    pnl_pct = net_pnl / equity * 100 if equity > 0 else 0

    embed = {
        "title": f"📊 24h Performance Report — {date_str}",
        "color": 3066993 if net_pnl >= 0 else 15158332,
        "fields": [
            {
                "name": "━━━ EXECUTIVE SUMMARY ━━━",
                "value": (
                    f"```\n"
                    f"{pnl_emoji} Net PnL (24h):   ${net_pnl:+,.2f} ({pnl_pct:+.2f}%)\n"
                    f"   Realized:       ${total_realized:+,.2f}\n"
                    f"   Fees:           -${total_fees:.2f}\n"
                    f"   Unrealized:     ${total_upnl:+,.2f}\n"
                    f"   Equity:         ${equity:,.2f}\n"
                    f"   Total Fills:    {total_fills}\n"
                    f"```"
                ),
                "inline": False
            },
            {
                "name": "🐸 mm-pure (kPEPE)",
                "value": f"```\n{fmt_pair('kPEPE')}\n```",
                "inline": True
            },
            {
                "name": "🟣 mm-virtual (VIRTUAL)",
                "value": f"```\n{fmt_pair('VIRTUAL')}\n```",
                "inline": True
            },
            {
                "name": "━━━ FEE EFFICIENCY ━━━",
                "value": (
                    f"```\n"
                    f"Total Fees:      ${total_fees:.2f}\n"
                    f"Total Realized:  ${total_realized:+,.2f}\n"
                    f"Fee/Profit:      {fee_efficiency:.1f}%"
                    f"{'  ✅ Healthy' if fee_efficiency < 15 else '  ⚠️ High' if fee_efficiency < 30 else '  🔴 Churning'}\n"
                    f"```"
                ),
                "inline": False
            },
            {
                "name": "━━━ RISK ASSESSMENT ━━━",
                "value": (
                    f"```\n"
                    f"Account Leverage: {acct_leverage:.2f}x\n"
                    f"Margin Used:      ${margin_used:.2f} ({margin_used / equity * 100:.1f}%)\n"
                    f"Free Margin:      ${free_margin:,.2f}\n"
                    f"Risk Level:       {risk_emoji} {risk_label}\n"
                    f"```"
                ),
                "inline": False
            },
        ],
        "footer": {
            "text": f"Generated {now.strftime('%H:%M UTC')} | HARD BREAKEVEN GUARD active"
        },
        "timestamp": now.isoformat()
    }

    return {"embeds": [embed]}


def send_to_discord(payload: dict):
    data = json.dumps(payload)
    r = subprocess.run(
        ["curl", "-s", "-X", "POST", DISCORD_WEBHOOK,
         "-H", "Content-Type: application/json", "-d", data],
        capture_output=True, text=True, timeout=15
    )
    if r.returncode != 0:
        print(f"Discord send failed: {r.stderr}")
    else:
        print(f"Report sent to Discord ({len(data)} bytes)")


if __name__ == "__main__":
    report = build_report()
    # Debug: print locally
    print(json.dumps(report, indent=2)[:2000])
    print("...")
    # Send
    send_to_discord(report)
