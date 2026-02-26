#!/usr/bin/env python3
"""
XGBoost Data Collector for MM Bot Prediction API

Runs every 15 min via cron. Computes 30 features from:
  - Hyperliquid API (candles, funding, OI, allMids)
  - SM data files (/tmp/smart_money_data.json, nansen_bias.json, nansen_mm_signal_state.json)

Outputs JSONL to /tmp/xgboost_dataset_{TOKEN}.jsonl
Backfills labels (1h, 4h, 12h price change) for older rows.

Feature vector (30 features):
  [0-10]  Technical: RSI/100, tanh(MACD/100), tanh(MACD_signal/100), tanh(MACD_hist/100),
          tanh(change1h/10), tanh(change4h/20), tanh(change24h/50),
          volumeRatio/5, volatility/10, bbWidth/20, ATR_%
  [11-21] Nansen: tanh(log(ratio)), conviction/100, tanh(longUsd/10M), tanh(shortUsd/10M),
          bias, biasConfidence/100, signal_green, signal_yellow, signal_red,
          dominant_long, dominant_short
  [22-29] Extra: funding_rate, oi_change_1h, oi_change_4h,
          hour_sin, hour_cos, day_sin, day_cos, volatility_24h
"""

import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip3 install requests")
    sys.exit(1)

# --- Configuration ---
TOKENS = ["BTC", "ETH", "SOL", "HYPE", "ZEC", "XRP", "LIT", "FARTCOIN", "kPEPE"]
HL_API = "https://api.hyperliquid.xyz/info"
DATASET_DIR = "/tmp"
SM_DATA_FILE = "/tmp/smart_money_data.json"
BIAS_FILE = "/tmp/nansen_bias.json"
SIGNAL_STATE_FILE = "/tmp/nansen_mm_signal_state.json"
OI_SNAPSHOT_FILE = "/tmp/xgboost_oi_snapshots.json"

LABEL_BACKFILL_ROWS = 0  # 0 = scan all rows (needed for m1 labels — 30 days lookback)
CANDLE_COUNT = 100  # 100 hourly candles


def hl_post(payload: dict, timeout: int = 15) -> dict | list | None:
    """POST to Hyperliquid info API."""
    try:
        resp = requests.post(HL_API, json=payload, timeout=timeout)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"  [ERROR] HL API: {e}")
        return None


# --- Hyperliquid data fetchers ---

def fetch_candles(coin: str, interval: str = "1h", count: int = CANDLE_COUNT) -> list[dict]:
    """Fetch OHLCV candles from Hyperliquid."""
    interval_seconds = {"1h": 3600, "4h": 14400, "1d": 86400}.get(interval, 3600)
    end_time = int(time.time() * 1000)
    start_time = end_time - (interval_seconds * count * 1000)

    data = hl_post({
        "type": "candleSnapshot",
        "req": {"coin": coin, "interval": interval, "startTime": start_time, "endTime": end_time}
    })
    if not data or not isinstance(data, list):
        return []

    candles = []
    for c in data:
        candles.append({
            "t": int(c["t"]),
            "o": float(c["o"]),
            "h": float(c["h"]),
            "l": float(c["l"]),
            "c": float(c["c"]),
            "v": float(c["v"]),
        })
    candles.sort(key=lambda x: x["t"])
    return candles


def fetch_all_mids() -> dict[str, float]:
    """Fetch all mid prices."""
    data = hl_post({"type": "allMids"})
    if not data or not isinstance(data, dict):
        return {}
    return {k: float(v) for k, v in data.items()}


def fetch_meta() -> dict | None:
    """Fetch exchange meta (for funding rates)."""
    return hl_post({"type": "meta"})


def fetch_clearinghouse_meta_and_ctx() -> list[dict] | None:
    """Fetch metaAndAssetCtxs for OI and funding."""
    data = hl_post({"type": "metaAndAssetCtxs"})
    if not data or not isinstance(data, list) or len(data) < 2:
        return None
    return data


# --- Technical indicator calculations (replicate TypeScript) ---

def calculate_ema(data: list[float], period: int) -> list[float]:
    if len(data) < period:
        return []
    mult = 2.0 / (period + 1)
    ema = [sum(data[:period]) / period]
    for i in range(period, len(data)):
        ema.append((data[i] - ema[-1]) * mult + ema[-1])
    return ema


def calculate_rsi(closes: list[float], period: int = 14) -> list[float]:
    if len(closes) < period + 1:
        return []
    rsi_vals = []
    gains = 0.0
    losses = 0.0
    for i in range(1, period + 1):
        change = closes[i] - closes[i - 1]
        if change > 0:
            gains += change
        else:
            losses -= change
    avg_gain = gains / period
    avg_loss = losses / period
    rsi_vals.append(100 - (100 / (1 + avg_gain / max(avg_loss, 0.0001))))

    for i in range(period + 1, len(closes)):
        change = closes[i] - closes[i - 1]
        gain = change if change > 0 else 0
        loss = -change if change < 0 else 0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        rsi_vals.append(100 - (100 / (1 + avg_gain / max(avg_loss, 0.0001))))
    return rsi_vals


def calculate_macd(closes: list[float]) -> dict:
    ema12 = calculate_ema(closes, 12)
    ema26 = calculate_ema(closes, 26)
    offset = len(ema12) - len(ema26)
    macd_line = [ema12[i + offset] - ema26[i] for i in range(len(ema26))]
    signal = calculate_ema(macd_line, 9)
    sig_offset = len(macd_line) - len(signal)
    histogram = [macd_line[i + sig_offset] - signal[i] for i in range(len(signal))]
    return {"line": macd_line, "signal": signal, "histogram": histogram}


def calculate_bollinger(closes: list[float], period: int = 20, std_mult: float = 2.0) -> dict:
    upper, middle, lower = [], [], []
    for i in range(period - 1, len(closes)):
        s = closes[i - period + 1: i + 1]
        sma = sum(s) / period
        variance = sum((x - sma) ** 2 for x in s) / period
        std = variance ** 0.5
        middle.append(sma)
        upper.append(sma + std_mult * std)
        lower.append(sma - std_mult * std)
    return {"upper": upper, "middle": middle, "lower": lower}


def calculate_atr(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> list[float]:
    tr = []
    for i in range(1, len(closes)):
        tr.append(max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1])))
    return calculate_ema(tr, period)


def calculate_volatility(closes: list[float], period: int = 24) -> list[float]:
    returns = [(closes[i] - closes[i - 1]) / closes[i - 1] for i in range(1, len(closes)) if closes[i - 1] != 0]
    vols = []
    for i in range(period - 1, len(returns)):
        s = returns[i - period + 1: i + 1]
        mean = sum(s) / period
        variance = sum((x - mean) ** 2 for x in s) / period
        vols.append((variance ** 0.5) * 100)
    return vols


def compute_technical_features(candles: list[dict]) -> list[float] | None:
    """Compute 11 normalized technical features from candles (same as TechnicalIndicators.normalize)."""
    if len(candles) < 60:
        return None

    closes = [c["c"] for c in candles]
    highs = [c["h"] for c in candles]
    lows = [c["l"] for c in candles]
    volumes = [c["v"] for c in candles]

    rsi = calculate_rsi(closes)
    macd = calculate_macd(closes)
    ema21 = calculate_ema(closes, 21)
    bb = calculate_bollinger(closes)
    atr = calculate_atr(highs, lows, closes)
    vol = calculate_volatility(closes)

    if not rsi or not macd["histogram"] or not ema21 or not bb["middle"] or not atr:
        return None

    # Latest values
    rsi_val = rsi[-1] if rsi else 50
    macd_line = macd["line"][-1] if macd["line"] else 0
    macd_signal = macd["signal"][-1] if macd["signal"] else 0
    macd_hist = macd["histogram"][-1] if macd["histogram"] else 0

    n = len(closes)
    change_1h = ((closes[-1] - closes[-2]) / closes[-2] * 100) if n >= 2 and closes[-2] != 0 else 0
    change_4h = ((closes[-1] - closes[-5]) / closes[-5] * 100) if n >= 5 and closes[-5] != 0 else 0
    change_24h = ((closes[-1] - closes[-25]) / closes[-25] * 100) if n >= 25 and closes[-25] != 0 else 0

    avg_vol = sum(volumes[-24:]) / min(len(volumes), 24) if volumes else 1
    vol_ratio = volumes[-1] / avg_vol if avg_vol > 0 else 1

    volatility = vol[-1] if vol else 2
    bb_width = ((bb["upper"][-1] - bb["lower"][-1]) / bb["middle"][-1] * 100) if bb["middle"] and bb["middle"][-1] != 0 else 4
    ema21_val = ema21[-1] if ema21 else closes[-1]
    atr_pct = (atr[-1] / ema21_val * 100) if atr and ema21_val != 0 else 0

    return [
        rsi_val / 100,                             # [0] RSI [0-1]
        math.tanh(macd_line / 100),                # [1] MACD line [-1, 1]
        math.tanh(macd_signal / 100),              # [2] MACD signal [-1, 1]
        math.tanh(macd_hist / 100),                # [3] MACD histogram [-1, 1]
        math.tanh(change_1h / 10),                 # [4] 1h change [-1, 1]
        math.tanh(change_4h / 20),                 # [5] 4h change [-1, 1]
        math.tanh(change_24h / 50),                # [6] 24h change [-1, 1]
        min(vol_ratio / 5, 1.0),                   # [7] Volume ratio [0-1]
        min(volatility / 10, 1.0),                 # [8] Volatility [0-1]
        min(bb_width / 20, 1.0),                   # [9] BB width [0-1]
        min(atr_pct, 1.0),                         # [10] ATR % [0-1]
    ]


def compute_nansen_features(token: str) -> list[float]:
    """Compute 11 normalized Nansen features (same as NansenFeatures.normalize)."""
    # SM data
    sm_ratio = 0.0
    sm_conviction = 0.0
    sm_long_usd = 0.0
    sm_short_usd = 0.0
    dominant_long = 0
    dominant_short = 0

    try:
        with open(SM_DATA_FILE) as f:
            sm = json.load(f)
        td = sm.get("data", {}).get(token)
        if td:
            total_long = td.get("current_longs_usd", 0) or 0
            total_short = td.get("current_shorts_usd", 0) or 0
            ratio = total_long / total_short if total_short > 0 else (10 if total_long > 0 else 1)
            sm_ratio = math.tanh(math.log(max(ratio, 0.001)))
            sm_conviction = (td.get("trading_mode_confidence", 0) or 0) / 100
            sm_long_usd = math.tanh(total_long / 10_000_000)
            sm_short_usd = math.tanh(total_short / 10_000_000)
            if ratio > 1.5:
                dominant_long = 1
            elif ratio < 0.67:
                dominant_short = 1
    except Exception:
        pass

    # Bias
    bias_value = 0.0
    bias_confidence = 0.0
    try:
        with open(BIAS_FILE) as f:
            bias_data = json.load(f)
        tb = bias_data.get(token)
        if tb:
            boost = min(tb.get("boost", 0) or 0, 1.0)
            direction = tb.get("direction", "neutral")
            if direction == "short":
                bias_value = -boost
            elif direction == "long":
                bias_value = boost
            bias_confidence = (tb.get("tradingModeConfidence", 0) or 0) / 100
    except Exception:
        pass

    # Signal state
    sig_green = 0
    sig_yellow = 0
    sig_red = 0
    try:
        with open(SIGNAL_STATE_FILE) as f:
            sig_data = json.load(f)
        signal = (sig_data.get(token, {}).get("combinedSignal") or "NONE").upper()
        if signal == "GREEN":
            sig_green = 1
        elif signal == "YELLOW":
            sig_yellow = 1
        elif signal == "RED":
            sig_red = 1
    except Exception:
        pass

    return [
        sm_ratio,          # [11] tanh(log(ratio))
        sm_conviction,     # [12] conviction/100
        sm_long_usd,       # [13] tanh(longUsd/10M)
        sm_short_usd,      # [14] tanh(shortUsd/10M)
        bias_value,        # [15] bias [-1, 1]
        bias_confidence,   # [16] bias confidence [0-1]
        sig_green,         # [17] signal GREEN
        sig_yellow,        # [18] signal YELLOW
        sig_red,           # [19] signal RED
        dominant_long,     # [20] dominant LONG
        dominant_short,    # [21] dominant SHORT
    ]


def compute_extra_features(token: str, candles: list[dict], meta_ctx: list[dict] | None) -> list[float]:
    """Compute 8 extra features: funding, OI changes, time cyclical, volatility_24h."""
    # Funding rate
    funding_rate = 0.0
    if meta_ctx and len(meta_ctx) >= 2:
        universe = meta_ctx[0].get("universe", [])
        ctx_list = meta_ctx[1]
        for i, asset in enumerate(universe):
            if asset.get("name") == token and i < len(ctx_list):
                funding_rate = float(ctx_list[i].get("funding", 0) or 0)
                break

    # OI change (from saved snapshots)
    oi_change_1h = 0.0
    oi_change_4h = 0.0
    current_oi = 0.0

    if meta_ctx and len(meta_ctx) >= 2:
        universe = meta_ctx[0].get("universe", [])
        ctx_list = meta_ctx[1]
        for i, asset in enumerate(universe):
            if asset.get("name") == token and i < len(ctx_list):
                current_oi = float(ctx_list[i].get("openInterest", 0) or 0)
                break

    # Load OI snapshots and compute changes
    oi_snapshots = {}
    try:
        with open(OI_SNAPSHOT_FILE) as f:
            oi_snapshots = json.load(f)
    except Exception:
        pass

    now_ts = int(time.time())
    token_snaps = oi_snapshots.get(token, [])

    # Find closest snapshot to 1h ago and 4h ago
    for snap in reversed(token_snaps):
        age = now_ts - snap["ts"]
        if 2700 < age < 7200 and oi_change_1h == 0.0 and snap["oi"] > 0:  # 45min - 2h
            oi_change_1h = (current_oi - snap["oi"]) / snap["oi"]
        if 10800 < age < 21600 and oi_change_4h == 0.0 and snap["oi"] > 0:  # 3h - 6h
            oi_change_4h = (current_oi - snap["oi"]) / snap["oi"]

    # Save current OI snapshot
    token_snaps.append({"ts": now_ts, "oi": current_oi})
    # Keep only last 48 snapshots (12h at 15min intervals)
    oi_snapshots[token] = token_snaps[-48:]

    try:
        with open(OI_SNAPSHOT_FILE, "w") as f:
            json.dump(oi_snapshots, f)
    except Exception:
        pass

    # Time cyclical features
    now = datetime.now(timezone.utc)
    hour = now.hour + now.minute / 60.0
    dow = now.weekday()
    hour_sin = math.sin(2 * math.pi * hour / 24)
    hour_cos = math.cos(2 * math.pi * hour / 24)
    day_sin = math.sin(2 * math.pi * dow / 7)
    day_cos = math.cos(2 * math.pi * dow / 7)

    # Volatility 24h (std dev of 24 hourly returns)
    volatility_24h = 0.0
    closes = [c["c"] for c in candles]
    if len(closes) >= 25:
        returns = [(closes[i] - closes[i - 1]) / closes[i - 1]
                   for i in range(len(closes) - 24, len(closes))
                   if closes[i - 1] != 0]
        if returns:
            mean = sum(returns) / len(returns)
            variance = sum((r - mean) ** 2 for r in returns) / len(returns)
            volatility_24h = variance ** 0.5

    return [
        funding_rate,      # [22] funding rate
        oi_change_1h,      # [23] OI change 1h (ratio)
        oi_change_4h,      # [24] OI change 4h (ratio)
        hour_sin,          # [25] hour sin
        hour_cos,          # [26] hour cos
        day_sin,           # [27] day sin
        day_cos,           # [28] day cos
        volatility_24h,    # [29] volatility 24h (raw std dev)
    ]


def backfill_labels(filepath: str, current_price: float) -> int:
    """Backfill labels for older rows. Returns number of rows updated."""
    if not os.path.exists(filepath):
        return 0

    now_ts = int(time.time())
    updated = 0

    # Read all lines
    lines = []
    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if line:
                lines.append(line)

    # Process rows for backfill (0 = scan all, needed for m1 30-day lookback)
    start_idx = max(0, len(lines) - LABEL_BACKFILL_ROWS) if LABEL_BACKFILL_ROWS > 0 else 0
    modified = False

    for i in range(start_idx, len(lines)):
        try:
            row = json.loads(lines[i])
        except json.JSONDecodeError:
            continue

        row_ts = row.get("ts", 0)
        row_price = row.get("price", 0)
        if row_price <= 0:
            continue

        age = now_ts - row_ts
        change = (current_price / row_price - 1)

        if age >= 3600 and row.get("label_1h") is None:
            row["label_1h"] = round(change, 6)
            lines[i] = json.dumps(row)
            modified = True
            updated += 1

        if age >= 14400 and row.get("label_4h") is None:
            row["label_4h"] = round(change, 6)
            lines[i] = json.dumps(row)
            modified = True
            updated += 1

        if age >= 43200 and row.get("label_12h") is None:
            row["label_12h"] = round(change, 6)
            lines[i] = json.dumps(row)
            modified = True
            updated += 1

        if age >= 604800 and row.get("label_w1") is None:   # 7 days
            row["label_w1"] = round(change, 6)
            lines[i] = json.dumps(row)
            modified = True
            updated += 1

        if age >= 2592000 and row.get("label_m1") is None:  # 30 days
            row["label_m1"] = round(change, 6)
            lines[i] = json.dumps(row)
            modified = True
            updated += 1

    if modified:
        with open(filepath, "w") as f:
            for line in lines:
                f.write(line + "\n")

    return updated


def collect_token(token: str, mids: dict[str, float], meta_ctx: list[dict] | None) -> None:
    """Collect features for a single token and append to dataset."""
    print(f"\n  [{token}] Collecting features...")

    price = mids.get(token, 0)
    if price <= 0:
        print(f"  [{token}] No mid price, skipping")
        return

    # Fetch candles
    candles = fetch_candles(token, "1h", CANDLE_COUNT)
    if len(candles) < 60:
        print(f"  [{token}] Only {len(candles)} candles (need 60+), skipping")
        return

    # Compute features
    tech = compute_technical_features(candles)
    if tech is None:
        print(f"  [{token}] Failed to compute technical features, skipping")
        return

    nansen = compute_nansen_features(token)
    extra = compute_extra_features(token, candles, meta_ctx)

    features = tech + nansen + extra
    assert len(features) == 30, f"Expected 30 features, got {len(features)}"

    # Build row
    row = {
        "ts": int(time.time()),
        "price": round(price, 6),
        "features": [round(f, 6) for f in features],
        "label_1h": None,
        "label_4h": None,
        "label_12h": None,
        "label_w1": None,
        "label_m1": None,
    }

    # Append to JSONL file
    filepath = os.path.join(DATASET_DIR, f"xgboost_dataset_{token}.jsonl")
    with open(filepath, "a") as f:
        f.write(json.dumps(row) + "\n")

    # Count rows
    with open(filepath) as f:
        row_count = sum(1 for _ in f)

    print(f"  [{token}] Appended row (price=${price:.4f}, {len(features)} features, total={row_count} rows)")

    # Backfill labels
    updated = backfill_labels(filepath, price)
    if updated > 0:
        print(f"  [{token}] Backfilled {updated} labels")


def main():
    print(f"=== XGBoost Data Collector === {datetime.now(timezone.utc).isoformat()}")

    # Fetch shared data once
    print("  Fetching allMids...")
    mids = fetch_all_mids()
    if not mids:
        print("  ERROR: Could not fetch allMids, aborting")
        sys.exit(1)

    print("  Fetching metaAndAssetCtxs...")
    meta_ctx = fetch_clearinghouse_meta_and_ctx()

    # Collect per token
    for token in TOKENS:
        try:
            collect_token(token, mids, meta_ctx)
        except Exception as e:
            print(f"  [{token}] ERROR: {e}")

    print(f"\n=== Done === {datetime.now(timezone.utc).isoformat()}")


if __name__ == "__main__":
    main()
