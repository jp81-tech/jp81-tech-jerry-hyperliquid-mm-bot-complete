#!/usr/bin/env python3
"""
XGBoost Historical Backfiller for MM Bot

Fetches historical hourly candles from Hyperliquid API,
computes features at each timestamp with look-ahead labels,
generates JSONL dataset, and optionally retrains XGBoost.

Computable features (38/62 with real data):
  [0-10]  Technical (RSI, MACD, BB, ATR, volatility)         11/11
  [25-29] Time cyclical + volatility_24h                       5/8
  [30-44] Candle patterns                                     15/15
  [45-48] Multi-day trends                                     4/4
  [49-52] BTC cross-market                                     4/4 (non-BTC only)
  [59-61] Derived (vol momentum, acceleration, divergence)     3/3

Non-computable (24/62 = zeros):
  [11-21] Nansen SM data           — no historical snapshots
  [22-24] Funding, OI changes      — not in candle data
  [53-55] Orderbook L2             — no historical snapshots
  [56-58] MetaCtx (mark/oracle)    — no historical snapshots

Usage:
  python3 scripts/xgboost_backfill.py              # backfill all tokens, 180 days
  python3 scripts/xgboost_backfill.py --train      # backfill + retrain immediately
  python3 scripts/xgboost_backfill.py --token BTC  # single token
  python3 scripts/xgboost_backfill.py --days 90    # last 90 days
"""

import argparse
import json
import math
import os
import sys
import time
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip3 install requests")
    sys.exit(1)

# Import compute functions from collector (same directory)
script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, script_dir)

from xgboost_collect import (
    hl_post,
    compute_technical_features,
    compute_candle_features,
    compute_derived_features,
    compute_btc_cross_features,
)

# --- Configuration ---
TOKENS = ["BTC", "ETH", "SOL", "HYPE", "ZEC", "XRP", "LIT", "FARTCOIN", "kPEPE"]
DATASET_DIR = "/tmp"
NUM_FEATURES = 65
MIN_CANDLES = 60  # Need 60+ hourly candles for RSI/MACD/BB
API_CHUNK_DAYS = 180  # HL API returns max ~5000 hourly candles (~208 days)


# --- Candle fetching with pagination ---

def fetch_candles_range(coin: str, interval: str, start_ms: int, end_ms: int) -> list[dict]:
    """Fetch candles in a time range from HL API."""
    data = hl_post({
        "type": "candleSnapshot",
        "req": {"coin": coin, "interval": interval, "startTime": start_ms, "endTime": end_ms}
    }, timeout=30)

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


def fetch_all_candles(coin: str, interval: str, days: int) -> list[dict]:
    """Fetch all candles for the last N days, paginating in chunks."""
    end_ms = int(time.time() * 1000)
    target_start_ms = end_ms - (days * 86400 * 1000)
    interval_ms = {"1h": 3600_000, "1d": 86_400_000}.get(interval, 3600_000)

    all_candles = []
    current_start = target_start_ms

    while current_start < end_ms:
        chunk_end = min(current_start + (API_CHUNK_DAYS * 86400 * 1000), end_ms)
        candles = fetch_candles_range(coin, interval, current_start, chunk_end)

        if not candles:
            current_start = chunk_end
            continue

        all_candles.extend(candles)
        # Move past last candle to avoid overlap
        current_start = candles[-1]["t"] + interval_ms
        time.sleep(0.15)  # Rate limit

    # Deduplicate by timestamp
    seen = set()
    unique = []
    for c in all_candles:
        if c["t"] not in seen:
            seen.add(c["t"])
            unique.append(c)
    unique.sort(key=lambda x: x["t"])
    return unique


# --- Backfill-specific compute functions ---

def compute_backfill_extra(candles: list[dict], candle_ts_sec: int) -> list[float]:
    """Compute extra features [22-29] from historical candles.

    Available: time cyclical (hour_sin/cos, day_sin/cos), volatility_24h.
    Not available: funding_rate, oi_change_1h, oi_change_4h → zeros.
    """
    dt = datetime.fromtimestamp(candle_ts_sec, tz=timezone.utc)
    hour = dt.hour + dt.minute / 60.0
    dow = dt.weekday()
    hour_sin = math.sin(2 * math.pi * hour / 24)
    hour_cos = math.cos(2 * math.pi * hour / 24)
    day_sin = math.sin(2 * math.pi * dow / 7)
    day_cos = math.cos(2 * math.pi * dow / 7)

    # Volatility 24h (std dev of last 24 hourly returns)
    volatility_24h = 0.0
    closes = [c["c"] for c in candles]
    if len(closes) >= 25:
        returns = [
            (closes[i] - closes[i - 1]) / closes[i - 1]
            for i in range(len(closes) - 24, len(closes))
            if closes[i - 1] != 0
        ]
        if returns:
            mean = sum(returns) / len(returns)
            variance = sum((r - mean) ** 2 for r in returns) / len(returns)
            volatility_24h = variance ** 0.5

    return [
        0.0,            # [22] funding_rate
        0.0,            # [23] oi_change_1h
        0.0,            # [24] oi_change_4h
        hour_sin,       # [25]
        hour_cos,       # [26]
        day_sin,        # [27]
        day_cos,        # [28]
        volatility_24h, # [29]
    ]


def compute_backfill_multiday(daily_candles: list[dict], current_price: float) -> list[float]:
    """Compute multi-day trend features [45-48] from pre-fetched daily candles.

    Same logic as compute_multiday_features() but uses pre-fetched data.
    daily_candles: last ~14 daily candles up to (and including) current day.
    """
    zeros = [0.0] * 4
    if len(daily_candles) < 7:
        return zeros

    daily_closes = [c["c"] for c in daily_candles]
    daily_highs = [c["h"] for c in daily_candles]
    n = len(daily_closes)

    # [45] change_7d
    change_7d = 0.0
    if n >= 7 and daily_closes[-7] > 0:
        change_7d = (current_price / daily_closes[-7] - 1) * 100
    change_7d_norm = math.tanh(change_7d / 30)

    # [46] change_10d
    change_10d = 0.0
    if n >= 10 and daily_closes[-10] > 0:
        change_10d = (current_price / daily_closes[-10] - 1) * 100
    elif n >= 7 and daily_closes[-7] > 0:
        change_10d = change_7d
    change_10d_norm = math.tanh(change_10d / 50)

    # [47] distance from 7d high
    high_7d = max(daily_highs[-7:]) if len(daily_highs) >= 7 else max(daily_highs)
    dist_from_high = 0.0
    if high_7d > 0:
        dist_from_high = (current_price / high_7d - 1)
    dist_from_high_norm = max(dist_from_high * 10, -1.0)

    # [48] trend_slope_7d (linear regression)
    slope_7d = 0.0
    lookback = min(n, 7)
    if lookback >= 3:
        segment = daily_closes[-lookback:]
        base = segment[0]
        if base > 0:
            norm_seg = [(p / base - 1) * 100 for p in segment]
            x_mean = (lookback - 1) / 2.0
            y_mean = sum(norm_seg) / lookback
            num = sum((i - x_mean) * (norm_seg[i] - y_mean) for i in range(lookback))
            den = sum((i - x_mean) ** 2 for i in range(lookback))
            if den > 0:
                slope_7d = num / den
    slope_7d_norm = math.tanh(slope_7d * 100 / 30)

    return [change_7d_norm, change_10d_norm, dist_from_high_norm, slope_7d_norm]


def compute_labels(hourly: list[dict], idx: int) -> dict:
    """Compute labels by looking ahead in the candle array.

    Each label = price change ratio: future_price / current_price - 1
    """
    price = hourly[idx]["c"]
    if price <= 0:
        return {"label_1h": None, "label_4h": None, "label_12h": None}

    n = len(hourly)
    labels = {}
    for key, offset in [("label_1h", 1), ("label_4h", 4), ("label_12h", 12)]:
        future = idx + offset
        if future < n and hourly[future]["c"] > 0:
            labels[key] = round(hourly[future]["c"] / price - 1, 6)
        else:
            labels[key] = None
    return labels


def load_existing_hours(token: str) -> set[int]:
    """Load existing row timestamps (rounded to nearest hour) from JSONL."""
    filepath = os.path.join(DATASET_DIR, f"xgboost_dataset_{token}.jsonl")
    hours = set()
    if not os.path.exists(filepath):
        return hours
    try:
        with open(filepath) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                    ts = row.get("ts", 0)
                    hours.add((ts // 3600) * 3600)
                except json.JSONDecodeError:
                    continue
    except FileNotFoundError:
        pass
    return hours


def find_daily_window(daily: list[dict], current_ts_ms: int, window: int = 14) -> list[dict]:
    """Find the last `window` daily candles on or before the given timestamp."""
    result = [dc for dc in daily if dc["t"] <= current_ts_ms]
    return result[-window:] if len(result) > window else result


def sort_dataset(token: str) -> int:
    """Sort JSONL dataset by timestamp. Returns total row count."""
    filepath = os.path.join(DATASET_DIR, f"xgboost_dataset_{token}.jsonl")
    if not os.path.exists(filepath):
        return 0

    rows = []
    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

    rows.sort(key=lambda r: r.get("ts", 0))

    with open(filepath, "w") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")

    return len(rows)


# --- Main backfill logic ---

def backfill_token(token: str, btc_hourly: list[dict], days: int) -> int:
    """Backfill historical data for one token. Returns number of new rows."""
    print(f"\n{'='*50}")
    print(f"  Backfilling {token} ({days} days)")
    print(f"{'='*50}")

    # Fetch hourly candles
    print(f"  Fetching hourly candles...")
    hourly = fetch_all_candles(token, "1h", days)
    print(f"  Got {len(hourly)} hourly candles ({len(hourly)/24:.0f} days)")

    if len(hourly) < MIN_CANDLES + 1:
        print(f"  Not enough candles (need {MIN_CANDLES}+), skipping")
        return 0

    # Fetch daily candles (extra 30d margin for 10d lookback)
    print(f"  Fetching daily candles...")
    daily = fetch_all_candles(token, "1d", days + 30)
    print(f"  Got {len(daily)} daily candles")

    # Load existing timestamps
    existing_hours = load_existing_hours(token)
    print(f"  Existing rows: {len(existing_hours)}")

    # Pre-index BTC candle timestamps for fast lookup (bisect)
    btc_timestamps = [c["t"] for c in btc_hourly]

    # Generate rows
    filepath = os.path.join(DATASET_DIR, f"xgboost_dataset_{token}.jsonl")
    new_rows = 0
    skipped_exist = 0
    skipped_tech = 0

    total_positions = len(hourly) - MIN_CANDLES
    start_time = time.time()

    with open(filepath, "a") as f:
        for i in range(MIN_CANDLES, len(hourly)):
            candle_ts_ms = hourly[i]["t"]
            candle_ts_sec = candle_ts_ms // 1000
            candle_hour = (candle_ts_sec // 3600) * 3600

            # Skip if we already have data for this hour
            if candle_hour in existing_hours:
                skipped_exist += 1
                continue

            price = hourly[i]["c"]
            if price <= 0:
                continue

            # Window of candles (last 100 up to current position)
            window_start = max(0, i - 99)
            candles = hourly[window_start:i + 1]

            # --- Compute features ---

            # [0-10] Technical
            tech = compute_technical_features(candles)
            if tech is None:
                skipped_tech += 1
                continue

            # [11-21] Nansen SM — not available historically
            nansen = [0.0] * 11

            # [22-29] Extra (partial: time cyclical + volatility)
            extra = compute_backfill_extra(candles, candle_ts_sec)

            # [30-44] Candle patterns
            candle_feat = compute_candle_features(candles)

            # [45-48] Multi-day trends
            daily_window = find_daily_window(daily, candle_ts_ms, 14)
            multiday = compute_backfill_multiday(daily_window, price)

            # [49-52] BTC cross-market
            if token != "BTC" and btc_hourly:
                # Binary search for BTC candles up to current timestamp
                import bisect
                btc_end = bisect.bisect_right(btc_timestamps, candle_ts_ms)
                btc_start = max(0, btc_end - 100)
                btc_window = btc_hourly[btc_start:btc_end]
                btc_cross = compute_btc_cross_features(token, btc_window, candles)
            else:
                btc_cross = [0.0] * 4

            # [53-55] Orderbook — not available historically
            orderbook = [0.0] * 3

            # [56-58] MetaCtx — not available historically
            meta_extra = [0.0] * 3

            # [59-61] Derived
            derived = compute_derived_features(candles)

            # [62-64] BTC prediction proxy — not available historically
            btc_pred_feat = [0.0] * 3

            # Assemble
            features = tech + nansen + extra + candle_feat + multiday + btc_cross + orderbook + meta_extra + derived + btc_pred_feat
            assert len(features) == NUM_FEATURES, f"Expected {NUM_FEATURES}, got {len(features)}"

            # Compute labels (look-ahead — we know the future price!)
            labels = compute_labels(hourly, i)

            # Build row
            row = {
                "ts": candle_ts_sec,
                "price": round(price, 6),
                "features": [round(feat, 6) for feat in features],
                **labels,
                "_source": "backfill",
            }

            f.write(json.dumps(row) + "\n")
            new_rows += 1
            existing_hours.add(candle_hour)

            # Progress every 500 rows
            progress = i - MIN_CANDLES + 1
            if progress % 500 == 0:
                elapsed = time.time() - start_time
                rate = progress / elapsed if elapsed > 0 else 0
                eta = (total_positions - progress) / rate if rate > 0 else 0
                print(f"    {progress}/{total_positions} ({new_rows} new, {skipped_exist} skip) "
                      f"[{elapsed:.0f}s, ETA {eta:.0f}s]")

    # Sort dataset chronologically (backfilled rows appended at end)
    total_rows = sort_dataset(token)

    elapsed = time.time() - start_time
    print(f"\n  [{token}] {new_rows} new rows in {elapsed:.1f}s "
          f"({skipped_exist} existing, {skipped_tech} tech-fail)")
    print(f"  [{token}] Total dataset: {total_rows} rows")

    # Label stats
    if total_rows > 0:
        labeled = {"1h": 0, "4h": 0, "12h": 0}
        with open(filepath) as f_read:
            for line in f_read:
                try:
                    r = json.loads(line.strip())
                    if r.get("label_1h") is not None: labeled["1h"] += 1
                    if r.get("label_4h") is not None: labeled["4h"] += 1
                    if r.get("label_12h") is not None: labeled["12h"] += 1
                except:
                    continue
        print(f"  [{token}] Labels: h1={labeled['1h']}, h4={labeled['4h']}, h12={labeled['12h']}")

    return new_rows


def main():
    parser = argparse.ArgumentParser(description="XGBoost Historical Backfiller")
    parser.add_argument("--days", type=int, default=180,
                        help="Days of history to backfill (default: 180)")
    parser.add_argument("--token", type=str,
                        help="Single token to backfill (default: all)")
    parser.add_argument("--train", action="store_true",
                        help="Run xgboost_train.py after backfill")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be fetched, don't write")
    args = parser.parse_args()

    tokens = [args.token] if args.token else TOKENS

    print(f"=== XGBoost Historical Backfiller === {datetime.now(timezone.utc).isoformat()}")
    print(f"  Tokens: {tokens}")
    print(f"  Days: {args.days}")
    print(f"  Dataset dir: {DATASET_DIR}")
    print(f"  Features: {NUM_FEATURES} total, ~38 computable from candles, ~27 zeros")

    if args.dry_run:
        print("\n  DRY RUN — estimating rows:")
        for token in tokens:
            existing = load_existing_hours(token)
            max_rows = args.days * 24 - MIN_CANDLES
            print(f"  {token}: ~{max_rows} potential, {len(existing)} existing "
                  f"→ ~{max(0, max_rows - len(existing))} new")
        return

    # Fetch BTC hourly candles once (shared for cross-features)
    print(f"\n  Fetching BTC hourly candles ({args.days} days)...")
    btc_hourly = fetch_all_candles("BTC", "1h", args.days)
    print(f"  BTC hourly: {len(btc_hourly)} candles ({len(btc_hourly)/24:.0f} days)")

    # Backfill each token
    results = {}
    for token in tokens:
        try:
            new_rows = backfill_token(token, btc_hourly, args.days)
            results[token] = new_rows
        except Exception as e:
            print(f"  [{token}] ERROR: {e}")
            import traceback
            traceback.print_exc()
            results[token] = -1

    # Summary
    print(f"\n{'='*50}")
    print("  BACKFILL SUMMARY")
    print(f"{'='*50}")
    total_new = 0
    for token, count in results.items():
        status = f"{count} new rows" if count >= 0 else "ERROR"
        print(f"  {token:12s}: {status}")
        if count > 0:
            total_new += count
    print(f"\n  Total new rows: {total_new}")

    # Run training
    if args.train and total_new > 0:
        print(f"\n{'='*50}")
        print("  RUNNING XGBOOST TRAINING...")
        print(f"{'='*50}")
        train_script = os.path.join(script_dir, "xgboost_train.py")
        exit_code = os.system(f"python3 {train_script}")
        if exit_code == 0:
            print("\n  Training completed successfully!")
        else:
            print(f"\n  Training exited with code {exit_code}")
    elif args.train and total_new == 0:
        print("\n  No new data, skipping training")

    print(f"\n=== Done === {datetime.now(timezone.utc).isoformat()}")


if __name__ == "__main__":
    main()
