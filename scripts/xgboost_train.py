#!/usr/bin/env python3
"""
XGBoost Training Script for MM Bot Prediction API

Reads JSONL dataset, trains 3 classification models per token (h1, h4, h12),
exports model JSON for TypeScript inference.

Classification labels:
  h1:  >+0.5% = LONG (2), <-0.5% = SHORT (0), else NEUTRAL (1)
  h4:  >+1.5% = LONG (2), <-1.5% = SHORT (0), else NEUTRAL (1)
  h12: >+3.0% = LONG (2), <-3.0% = SHORT (0), else NEUTRAL (1)

Output:
  /tmp/xgboost_model_{TOKEN}_{horizon}.json  — XGBoost model dump
  /tmp/xgboost_meta_{TOKEN}.json             — accuracy, feature importance, metadata
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

try:
    import numpy as np
except ImportError:
    print("ERROR: numpy not installed. Run: pip3 install numpy")
    sys.exit(1)

try:
    import xgboost as xgb
except ImportError:
    print("ERROR: xgboost not installed. Run: pip3 install xgboost")
    sys.exit(1)

# --- Configuration ---
TOKENS = ["BTC", "ETH", "SOL", "HYPE", "ZEC", "XRP", "LIT", "FARTCOIN", "kPEPE"]
DATASET_DIR = "/tmp"
MODEL_DIR = "/tmp"

# Per-horizon minimum samples (lowered to bootstrap — accuracy improves with more data)
MIN_SAMPLES = {
    "h1":  50,
    "h4":  50,
    "h12": 50,
    "w1":  30,
    "m1":  20,
}

# Classification thresholds (price change %)
THRESHOLDS = {
    "h1":  0.005,   # 0.5%
    "h4":  0.015,   # 1.5%
    "h12": 0.030,   # 3.0%
    "w1":  0.080,   # 8.0%
    "m1":  0.150,   # 15.0%
}

# XGBoost parameters (conservative for small datasets)
XGB_PARAMS = {
    "max_depth": 4,
    "n_estimators": 100,
    "learning_rate": 0.1,
    "objective": "multi:softprob",
    "num_class": 3,
    "eval_metric": "mlogloss",
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 5,
    "tree_method": "hist",
    "verbosity": 0,
}

FEATURE_NAMES = [
    # Technical (11)
    "rsi", "macd_line", "macd_signal", "macd_hist",
    "change_1h", "change_4h", "change_24h",
    "volume_ratio", "volatility", "bb_width", "atr_pct",
    # Nansen (11)
    "sm_ratio", "sm_conviction", "sm_long_usd", "sm_short_usd",
    "nansen_bias", "bias_confidence",
    "signal_green", "signal_yellow", "signal_red",
    "dominant_long", "dominant_short",
    # Extra (8)
    "funding_rate", "oi_change_1h", "oi_change_4h",
    "hour_sin", "hour_cos", "day_sin", "day_cos",
    "volatility_24h",
    # Candle patterns (15)
    "hammer", "shooting_star", "engulfing_bull", "engulfing_bear",
    "doji", "pin_bar_bull", "pin_bar_bear",
    "marubozu_bull", "marubozu_bear", "inside_bar",
    "three_crows", "three_soldiers", "spinning_top",
    "body_ratio", "wick_skew",
]

NUM_FEATURES = 45  # 11 tech + 11 nansen + 8 extra + 15 candle


def load_dataset(token: str) -> tuple[list[list[float]], dict[str, list[float]]]:
    """Load JSONL dataset. Returns (features, {horizon: labels})."""
    filepath = os.path.join(DATASET_DIR, f"xgboost_dataset_{token}.jsonl")
    if not os.path.exists(filepath):
        return [], {}

    features = []
    labels = {"h1": [], "h4": [], "h12": [], "w1": [], "m1": []}
    skipped = {"h1": 0, "h4": 0, "h12": 0, "w1": 0, "m1": 0}

    # Collector uses "label_1h" format, but horizon keys are "h1" — map both
    LABEL_KEY_MAP = {
        "h1": ["label_h1", "label_1h"],
        "h4": ["label_h4", "label_4h"],
        "h12": ["label_h12", "label_12h"],
        "w1": ["label_w1"],
        "m1": ["label_m1"],
    }

    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue

            feat = row.get("features")
            if not feat or len(feat) not in (30, NUM_FEATURES):
                continue

            # Backward compat: pad old 30-feature rows with zeros (candle features = "no pattern")
            if len(feat) == 30:
                feat = feat + [0.0] * 15

            features.append(feat)

            for horizon in ["h1", "h4", "h12", "w1", "m1"]:
                val = None
                for label_key in LABEL_KEY_MAP[horizon]:
                    val = row.get(label_key)
                    if val is not None:
                        break
                if val is not None:
                    labels[horizon].append(val)
                else:
                    labels[horizon].append(None)
                    skipped[horizon] += 1

    print(f"  [{token}] Loaded {len(features)} rows")
    for h in ["h1", "h4", "h12", "w1", "m1"]:
        labeled = sum(1 for v in labels[h] if v is not None)
        print(f"    {h}: {labeled} labeled, {skipped[h]} unlabeled")

    return features, labels


def classify_label(change: float, threshold: float) -> int:
    """Convert continuous change to class: 0=SHORT, 1=NEUTRAL, 2=LONG."""
    if change > threshold:
        return 2   # LONG
    elif change < -threshold:
        return 0   # SHORT
    else:
        return 1   # NEUTRAL


def train_model(
    X_all: list[list[float]],
    y_raw: list[float | None],
    horizon: str,
    token: str,
) -> dict | None:
    """Train XGBoost model for one horizon. Returns metadata dict or None."""
    threshold = THRESHOLDS[horizon]

    # Filter rows with labels
    X = []
    y = []
    for i, label in enumerate(y_raw):
        if label is not None:
            X.append(X_all[i])
            y.append(classify_label(label, threshold))

    min_samples = MIN_SAMPLES[horizon] if isinstance(MIN_SAMPLES, dict) else MIN_SAMPLES
    if len(X) < min_samples:
        print(f"    {horizon}: Only {len(X)} labeled samples (need {min_samples}), skipping")
        return None

    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.int32)

    # Chronological train/test split (80/20)
    split_idx = int(len(X) * 0.8)
    X_train, X_test = X[:split_idx], X[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]

    # Class distribution
    for cls, name in [(0, "SHORT"), (1, "NEUTRAL"), (2, "LONG")]:
        train_count = int(np.sum(y_train == cls))
        test_count = int(np.sum(y_test == cls))
        print(f"    {horizon} class {name}: train={train_count}, test={test_count}")

    # Train
    model = xgb.XGBClassifier(**XGB_PARAMS)
    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )

    # Evaluate
    train_acc = float(np.mean(model.predict(X_train) == y_train))
    test_acc = float(np.mean(model.predict(X_test) == y_test))

    # Test predictions distribution
    test_preds = model.predict(X_test)
    for cls, name in [(0, "SHORT"), (1, "NEUTRAL"), (2, "LONG")]:
        pred_count = int(np.sum(test_preds == cls))
        print(f"    {horizon} predicted {name}: {pred_count}")

    print(f"    {horizon}: train_acc={train_acc:.3f}, test_acc={test_acc:.3f} (n_train={len(X_train)}, n_test={len(X_test)})")

    # Feature importance
    importance = model.feature_importances_
    top_features = sorted(
        [(FEATURE_NAMES[i], float(importance[i])) for i in range(len(importance))],
        key=lambda x: x[1],
        reverse=True,
    )[:10]

    # Save model as JSON
    model_path = os.path.join(MODEL_DIR, f"xgboost_model_{token}_{horizon}.json")
    model.save_model(model_path)
    file_size = os.path.getsize(model_path)
    print(f"    {horizon}: Saved model to {model_path} ({file_size / 1024:.1f} KB)")

    return {
        "horizon": horizon,
        "train_accuracy": round(train_acc, 4),
        "test_accuracy": round(test_acc, 4),
        "n_train": len(X_train),
        "n_test": len(X_test),
        "n_total": len(X),
        "top_features": top_features,
        "class_distribution": {
            "train": {
                "SHORT": int(np.sum(y_train == 0)),
                "NEUTRAL": int(np.sum(y_train == 1)),
                "LONG": int(np.sum(y_train == 2)),
            },
            "test": {
                "SHORT": int(np.sum(y_test == 0)),
                "NEUTRAL": int(np.sum(y_test == 1)),
                "LONG": int(np.sum(y_test == 2)),
            },
        },
    }


def train_token(token: str) -> dict | None:
    """Train all 3 horizon models for a token."""
    print(f"\n{'='*50}")
    print(f"  Training {token}")
    print(f"{'='*50}")

    features, labels = load_dataset(token)
    if not features:
        print(f"  [{token}] No dataset found, skipping")
        return None

    meta = {
        "token": token,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "trained_ts": int(time.time()),
        "total_rows": len(features),
        "horizons": {},
    }

    for horizon in ["h1", "h4", "h12", "w1", "m1"]:
        result = train_model(features, labels[horizon], horizon, token)
        if result:
            meta["horizons"][horizon] = result

    if not meta["horizons"]:
        print(f"  [{token}] No models trained (insufficient data)")
        return None

    # Save meta
    meta_path = os.path.join(MODEL_DIR, f"xgboost_meta_{token}.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"\n  [{token}] Meta saved to {meta_path}")

    return meta


def main():
    print(f"=== XGBoost Training === {datetime.now(timezone.utc).isoformat()}")
    print(f"  Min samples per horizon: {MIN_SAMPLES}")
    print(f"  Tokens: {TOKENS}")
    print(f"  XGBoost version: {xgb.__version__}")

    results = {}
    for token in TOKENS:
        try:
            meta = train_token(token)
            if meta:
                results[token] = meta
        except Exception as e:
            print(f"  [{token}] ERROR: {e}")
            import traceback
            traceback.print_exc()

    # Summary
    print(f"\n{'='*50}")
    print("  TRAINING SUMMARY")
    print(f"{'='*50}")
    for token, meta in results.items():
        print(f"\n  {token}:")
        for h, info in meta.get("horizons", {}).items():
            print(f"    {h}: test_acc={info['test_accuracy']:.1%} (n={info['n_total']})")
            for fname, fval in info["top_features"][:3]:
                print(f"      top: {fname} = {fval:.4f}")

    if not results:
        print("\n  No models trained. Collect more data first.")
        print(f"  Required min samples per horizon: {MIN_SAMPLES}")

    print(f"\n=== Done === {datetime.now(timezone.utc).isoformat()}")


if __name__ == "__main__":
    main()
