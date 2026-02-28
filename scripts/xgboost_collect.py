#!/usr/bin/env python3
"""
XGBoost Data Collector for MM Bot Prediction API

Runs every 15 min via cron. Computes 45 features from:
  - Hyperliquid API (candles, funding, OI, allMids)
  - SM data files (/tmp/smart_money_data.json, nansen_bias.json, nansen_mm_signal_state.json)

Outputs JSONL to /tmp/xgboost_dataset_{TOKEN}.jsonl
Backfills labels (1h, 4h, 12h price change) for older rows.

Feature vector (49 features):
  [0-10]  Technical: RSI/100, tanh(MACD/100), tanh(MACD_signal/100), tanh(MACD_hist/100),
          tanh(change1h/10), tanh(change4h/20), tanh(change24h/50),
          volumeRatio/5, volatility/10, bbWidth/20, ATR_%
  [11-21] Nansen: tanh(log(ratio)), conviction/100, tanh(longUsd/10M), tanh(shortUsd/10M),
          bias, biasConfidence/100, signal_green, signal_yellow, signal_red,
          dominant_long, dominant_short
  [22-29] Extra: funding_rate, oi_change_1h, oi_change_4h,
          hour_sin, hour_cos, day_sin, day_cos, volatility_24h
  [30-44] Candle patterns: hammer, shooting_star, engulfing_bull, engulfing_bear,
          doji, pin_bar_bull, pin_bar_bear, marubozu_bull, marubozu_bear,
          inside_bar, three_crows, three_soldiers, spinning_top, body_ratio, wick_skew
  [45-48] Multi-day trend: change_7d, change_10d, distance_from_7d_high, trend_slope_7d
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


def compute_candle_features(candles: list[dict]) -> list[float]:
    """Compute 15 candlestick pattern features from OHLC candles.

    Features [30-44]:
      [30] hammer          — long lower shadow, small upper (reversal bullish)
      [31] shooting_star   — long upper shadow, small lower (reversal bearish)
      [32] engulfing_bull  — green candle engulfs previous red candle
      [33] engulfing_bear  — red candle engulfs previous green candle
      [34] doji            — tiny body vs range (indecision)
      [35] pin_bar_bull    — lower shadow > 60% of range (demand rejection)
      [36] pin_bar_bear    — upper shadow > 60% of range (supply rejection)
      [37] marubozu_bull   — green candle, body > 90% of range (strong buying)
      [38] marubozu_bear   — red candle, body > 90% of range (strong selling)
      [39] inside_bar      — current H/L within previous H/L (consolidation)
      [40] three_crows     — 3 consecutive red candles with large bodies
      [41] three_soldiers  — 3 consecutive green candles with large bodies
      [42] spinning_top    — both shadows > body (uncertainty)
      [43] body_ratio      — body / range [0-1] (1=marubozu, 0=doji)
      [44] wick_skew       — (upper - lower shadow) / range [-1, 1]
    """
    zeros = [0.0] * 15
    if len(candles) < 3:
        return zeros

    # Current and previous candles
    c0 = candles[-1]  # current
    c1 = candles[-2]  # previous
    c2 = candles[-3]  # 2 candles ago

    o0, h0, l0, cl0 = c0["o"], c0["h"], c0["l"], c0["c"]
    o1, h1, l1, cl1 = c1["o"], c1["h"], c1["l"], c1["c"]
    o2, h2, l2, cl2 = c2["o"], c2["h"], c2["l"], c2["c"]

    # Derived values for current candle
    rng0 = h0 - l0
    if rng0 <= 0:
        return zeros
    body0 = abs(cl0 - o0)
    upper0 = h0 - max(o0, cl0)
    lower0 = min(o0, cl0) - l0
    is_green0 = cl0 > o0

    # Previous candle
    rng1 = h1 - l1
    body1 = abs(cl1 - o1) if rng1 > 0 else 0
    is_green1 = cl1 > o1

    # 2 candles ago
    body2 = abs(cl2 - o2)
    is_green2 = cl2 > o2

    # [30] Hammer: long lower shadow (>2x body), small upper shadow (<20% body)
    hammer = 1.0 if (lower0 > 2 * body0 and upper0 < 0.3 * body0 and body0 > 0) else 0.0

    # [31] Shooting Star: long upper shadow (>2x body), small lower shadow
    shooting_star = 1.0 if (upper0 > 2 * body0 and lower0 < 0.3 * body0 and body0 > 0) else 0.0

    # [32] Bullish Engulfing: green candle fully engulfs previous red candle
    engulfing_bull = 1.0 if (is_green0 and not is_green1 and cl0 > o1 and o0 < cl1 and body0 > body1) else 0.0

    # [33] Bearish Engulfing: red candle fully engulfs previous green candle
    engulfing_bear = 1.0 if (not is_green0 and is_green1 and cl0 < o1 and o0 > cl1 and body0 > body1) else 0.0

    # [34] Doji: body <= 10% of range
    doji = 1.0 if (body0 <= rng0 * 0.1) else 0.0

    # [35] Pin Bar Bullish: lower shadow > 60% of range
    pin_bar_bull = 1.0 if (lower0 > rng0 * 0.6) else 0.0

    # [36] Pin Bar Bearish: upper shadow > 60% of range
    pin_bar_bear = 1.0 if (upper0 > rng0 * 0.6) else 0.0

    # [37] Marubozu Bullish: green, body > 90% of range
    marubozu_bull = 1.0 if (is_green0 and body0 > rng0 * 0.9) else 0.0

    # [38] Marubozu Bearish: red, body > 90% of range
    marubozu_bear = 1.0 if (not is_green0 and body0 > rng0 * 0.9) else 0.0

    # [39] Inside Bar: current H/L within previous H/L
    inside_bar = 1.0 if (h0 < h1 and l0 > l1 and rng1 > 0) else 0.0

    # [40] Three Black Crows: 3 consecutive red candles with decent body size
    three_crows = 1.0 if (
        not is_green0 and not is_green1 and not is_green2
        and cl0 < cl1 < cl2
        and body0 > rng0 * 0.5 and body1 > rng1 * 0.5 if rng1 > 0 else False
    ) else 0.0

    # [41] Three White Soldiers: 3 consecutive green candles
    three_soldiers = 1.0 if (
        is_green0 and is_green1 and is_green2
        and cl0 > cl1 > cl2
        and body0 > rng0 * 0.5 and body1 > rng1 * 0.5 if rng1 > 0 else False
    ) else 0.0

    # [42] Spinning Top: both shadows > body
    spinning_top = 1.0 if (upper0 > body0 and lower0 > body0 and body0 > 0) else 0.0

    # [43] Body Ratio: body / range [0-1] — 1=marubozu, 0=doji
    body_ratio = min(body0 / rng0, 1.0)

    # [44] Wick Skew: (upper - lower) / range [-1, 1] — positive = bearish pressure
    wick_skew = (upper0 - lower0) / rng0

    return [
        hammer,          # [30]
        shooting_star,   # [31]
        engulfing_bull,  # [32]
        engulfing_bear,  # [33]
        doji,            # [34]
        pin_bar_bull,    # [35]
        pin_bar_bear,    # [36]
        marubozu_bull,   # [37]
        marubozu_bear,   # [38]
        inside_bar,      # [39]
        three_crows,     # [40]
        three_soldiers,  # [41]
        spinning_top,    # [42]
        body_ratio,      # [43]
        wick_skew,       # [44]
    ]


def compute_multiday_features(token: str, current_price: float) -> list[float]:
    """Compute 4 multi-day trend features from daily candles.

    Features [45-48]:
      [45] change_7d       — 7-day price change, tanh(change/30) [-1, 1]
      [46] change_10d      — 10-day price change, tanh(change/50) [-1, 1]
      [47] dist_from_7d_high — distance from 7d high [0, -1] (0=at high, -1=10%+ below)
      [48] trend_slope_7d  — 7d linear regression slope, tanh(slope×100) [-1, 1]
    """
    zeros = [0.0] * 4

    # Fetch 14 daily candles (need 10d lookback + margin)
    daily_candles = fetch_candles(token, "1d", 14)
    if len(daily_candles) < 7:
        return zeros

    daily_closes = [c["c"] for c in daily_candles]
    daily_highs = [c["h"] for c in daily_candles]
    n = len(daily_closes)

    # [45] change_7d: price change over 7 days
    change_7d = 0.0
    if n >= 7 and daily_closes[-7] > 0:
        change_7d = (current_price / daily_closes[-7] - 1) * 100  # in %
    change_7d_norm = math.tanh(change_7d / 30)  # ±30% maps to ±0.76

    # [46] change_10d: price change over 10 days
    change_10d = 0.0
    if n >= 10 and daily_closes[-10] > 0:
        change_10d = (current_price / daily_closes[-10] - 1) * 100
    elif n >= 7 and daily_closes[-7] > 0:
        # Fallback to 7d if not enough data for 10d
        change_10d = change_7d
    change_10d_norm = math.tanh(change_10d / 50)  # ±50% maps to ±0.76

    # [47] distance from 7d high: how far below the 7-day high
    high_7d = max(daily_highs[-7:]) if len(daily_highs) >= 7 else max(daily_highs)
    dist_from_high = 0.0
    if high_7d > 0:
        dist_from_high = (current_price / high_7d - 1)  # negative = below high
    # Clamp to [-1, 0]: 0 = at high, -1 = 10%+ below
    dist_from_high_norm = max(dist_from_high * 10, -1.0)

    # [48] trend_slope_7d: linear regression slope of last 7 daily closes
    slope_7d = 0.0
    lookback = min(n, 7)
    if lookback >= 3:
        segment = daily_closes[-lookback:]
        # Normalize to % change from first point
        base = segment[0]
        if base > 0:
            norm_seg = [(p / base - 1) * 100 for p in segment]
            # Simple linear regression: y = mx + b
            x_mean = (lookback - 1) / 2.0
            y_mean = sum(norm_seg) / lookback
            num = sum((i - x_mean) * (norm_seg[i] - y_mean) for i in range(lookback))
            den = sum((i - x_mean) ** 2 for i in range(lookback))
            if den > 0:
                slope_7d = num / den  # % per day
    slope_7d_norm = math.tanh(slope_7d * 100 / 30)  # ±0.3%/day maps to ±0.76

    return [
        change_7d_norm,       # [45] 7d change
        change_10d_norm,      # [46] 10d change
        dist_from_high_norm,  # [47] distance from 7d high
        slope_7d_norm,        # [48] trend slope 7d
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

    candle = compute_candle_features(candles)
    multiday = compute_multiday_features(token, price)

    features = tech + nansen + extra + candle + multiday
    assert len(features) == 49, f"Expected 49 features, got {len(features)}"

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
