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
}

# Classification thresholds (price change %)
# Threshold = "how big a move counts as directional" — must match token volatility
# w1/m1 removed — MM bot profits from micro-moves, weekly/monthly = noise (temporal shift)
THRESHOLDS = {
    "h1":  0.005,   # 0.5%
    "h4":  0.015,   # 1.5%
    "h12": 0.030,   # 3.0%
}

# Per-token threshold overrides — each token's volatility determines optimal thresholds
# Rule: threshold ≈ p30-p35 of abs price changes → ~35-40% NEUTRAL labels
# Without this, low-vol tokens (BTC h4: 88% NEUTRAL) learn "always say NEUTRAL"
TOKEN_THRESHOLDS: dict[str, dict[str, float]] = {
    "BTC": {
        "h1":  0.0015,  # 0.15% (BTC median h1 ~0.21%, very low vol)
        "h4":  0.003,   # 0.3%  (BTC median h4 ~0.44%, default ±1.5% → 88% NEUTRAL!)
        "h12": 0.006,   # 0.6%  (BTC median h12 ~0.89%)
    },
    "ETH": {
        "h1":  0.002,   # 0.2%  (ETH median h1 ~0.29%)
        "h4":  0.004,   # 0.4%  (ETH median h4 ~0.60%, default ±1.5% → 79% NEUTRAL!)
        "h12": 0.009,   # 0.9%  (ETH median h12 ~1.23%)
    },
    "SOL": {
        "h1":  0.003,   # 0.3%  (SOL median h1 ~0.39%)
        "h4":  0.006,   # 0.6%  (SOL median h4 ~0.79%, default ±1.5% → 74% NEUTRAL!)
        "h12": 0.012,   # 1.2%  (SOL median h12 ~1.61%)
    },
    "XRP": {
        "h1":  0.003,   # 0.3%  (XRP median h1 ~0.35%)
        "h4":  0.005,   # 0.5%  (XRP median h4 ~0.68%, default ±1.5% → 77% NEUTRAL!)
        "h12": 0.010,   # 1.0%  (XRP median h12 ~1.37%)
    },
    "ZEC": {
        "h1":  0.006,   # 0.6%  (ZEC median h1 ~0.78%)
        "h4":  0.012,   # 1.2%  (ZEC median h4 ~1.62%)
        "h12": 0.022,   # 2.2%  (ZEC median h12 ~2.99%)
    },
    "HYPE": {
        "h1":  0.004,
        "h4":  0.012,
        "h12": 0.025,
    },
    "kPEPE": {
        "h1":  0.0025,  # 0.25% (tighter — 15m features give granular signal)
        "h4":  0.008,   # 0.8% (kPEPE median h4 move ~1.0%)
        "h12": 0.020,   # 2.0% (kPEPE std h12 ~3.5%)
    },
    "LIT": {
        "h1":  0.004,
        "h4":  0.010,
        "h12": 0.025,
    },
    "FARTCOIN": {
        "h1":  0.004,   # 0.4%
        "h4":  0.010,   # 1.0%
        "h12": 0.025,   # 2.5%
    },
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

# Per-token XGBoost params
# BTC/ETH/SOL/XRP: large datasets (4600+ rows) → can use more trees with early stopping
# kPEPE/FARTCOIN/LIT/HYPE: volatile memecoins → aggressive regularization (30/62 features dead for some)
_REGULARIZED_PARAMS = {
    "max_depth": 3,             # shallow trees — prevent memorization
    "n_estimators": 300,        # many trees BUT early stopping will trim
    "learning_rate": 0.03,      # slow learning → early stopping picks optimal count
    "colsample_bytree": 0.5,    # aggressive feature dropout
    "min_child_weight": 10,     # require more samples per leaf → smoother predictions
    "subsample": 0.7,           # row subsampling → reduces overfitting
    "reg_alpha": 0.1,           # L1 regularization
    "reg_lambda": 2.0,          # L2 regularization (default 1.0)
}

TOKEN_XGB_PARAMS: dict[str, dict] = {
    # Majors — large datasets, moderate regularization
    "BTC": {
        "max_depth": 4,             # slightly deeper OK with 4600+ rows
        "n_estimators": 300,
        "learning_rate": 0.03,
        "colsample_bytree": 0.7,    # less aggressive — more features are alive
        "min_child_weight": 10,
        "subsample": 0.8,
        "reg_alpha": 0.05,
        "reg_lambda": 1.5,
    },
    "ETH": {
        "max_depth": 4,
        "n_estimators": 300,
        "learning_rate": 0.03,
        "colsample_bytree": 0.7,
        "min_child_weight": 10,
        "subsample": 0.8,
        "reg_alpha": 0.05,
        "reg_lambda": 1.5,
    },
    "SOL": {
        "max_depth": 4,
        "n_estimators": 300,
        "learning_rate": 0.03,
        "colsample_bytree": 0.7,
        "min_child_weight": 10,
        "subsample": 0.8,
        "reg_alpha": 0.05,
        "reg_lambda": 1.5,
    },
    "XRP": {
        "max_depth": 4,
        "n_estimators": 300,
        "learning_rate": 0.03,
        "colsample_bytree": 0.7,
        "min_child_weight": 10,
        "subsample": 0.8,
        "reg_alpha": 0.05,
        "reg_lambda": 1.5,
    },
    "ZEC": {
        "max_depth": 4,
        "n_estimators": 300,
        "learning_rate": 0.03,
        "colsample_bytree": 0.7,
        "min_child_weight": 10,
        "subsample": 0.8,
        "reg_alpha": 0.05,
        "reg_lambda": 1.5,
    },
    # Volatile tokens — aggressive regularization
    "kPEPE": dict(_REGULARIZED_PARAMS),
    "FARTCOIN": dict(_REGULARIZED_PARAMS),
    "LIT": dict(_REGULARIZED_PARAMS),
    "HYPE": dict(_REGULARIZED_PARAMS),
}

# Per-token dead feature masking — drop features that are structurally always zero
# These features are informative when available (live data) but always zero in backfill/history
# kPEPE: no SM tracking, no funding/OI in backfill, no orderbook/meta in backfill
TOKEN_DEAD_FEATURES: dict[str, list[int]] = {
    "kPEPE": [
        11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,  # SM/Nansen [11-21] — no SM tracking for kPEPE
        22, 23, 24,                                      # funding, OI [22-24] — zero in backfill
        53, 54, 55,                                      # orderbook [53-55] — zero in backfill
        56, 57, 58,                                      # meta ctx [56-58] — zero in backfill
    ],
    "FARTCOIN": [
        11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,  # SM/Nansen — limited SM data
        22, 23, 24,                                      # funding, OI
        53, 54, 55,                                      # orderbook
        56, 57, 58,                                      # meta ctx
    ],
    "LIT": [
        11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,  # SM/Nansen — limited SM data
        22, 23, 24,                                      # funding, OI
        53, 54, 55,                                      # orderbook
        56, 57, 58,                                      # meta ctx
    ],
}

# Early stopping rounds — stops training when test accuracy stops improving
EARLY_STOPPING_ROUNDS = 30

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
    # Multi-day trend (4)
    "change_7d", "change_10d", "dist_from_7d_high", "trend_slope_7d",
    # BTC cross-market (4)
    "btc_change_1h", "btc_change_4h", "btc_rsi", "btc_token_corr_24h",
    # Orderbook (3)
    "bid_ask_imbalance", "spread_bps", "book_depth_ratio",
    # MetaCtx (3)
    "mark_oracle_spread", "oi_normalized", "predicted_funding",
    # Derived (3)
    "volume_momentum", "price_acceleration", "volume_price_divergence",
    # BTC prediction proxy (3)
    "btc_pred_direction", "btc_pred_change", "btc_pred_confidence",
    # 15m candle features (8)
    "rsi_15m", "change_15m", "change_1h_15m", "ema9_ema21_cross_15m",
    "momentum_15m", "volatility_15m", "body_ratio_15m", "consecutive_dir_15m",
]

NUM_FEATURES = 73  # 65 base + 8 15m features


def load_dataset(token: str) -> tuple[list[list[float]], dict[str, list[float]]]:
    """Load JSONL dataset. Returns (features, {horizon: labels})."""
    filepath = os.path.join(DATASET_DIR, f"xgboost_dataset_{token}.jsonl")
    if not os.path.exists(filepath):
        return [], {}

    features = []
    labels = {"h1": [], "h4": [], "h12": []}
    skipped = {"h1": 0, "h4": 0, "h12": 0}

    # Collector uses "label_1h" format, but horizon keys are "h1" — map both
    LABEL_KEY_MAP = {
        "h1": ["label_h1", "label_1h"],
        "h4": ["label_h4", "label_4h"],
        "h12": ["label_h12", "label_12h"],
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
            if not feat or len(feat) not in (30, 45, 49, 53, 62, 65, NUM_FEATURES):
                continue

            # Backward compat: pad old rows with zeros
            if len(feat) == 30:
                feat = feat + [0.0] * 43  # 15 candle + 4 multi-day + 4 btc_cross + 3 orderbook + 3 meta + 3 derived + 3 btc_pred + 8 15m
            elif len(feat) == 45:
                feat = feat + [0.0] * 28  # 4 multi-day + 4 btc_cross + 3 orderbook + 3 meta + 3 derived + 3 btc_pred + 8 15m
            elif len(feat) == 49:
                feat = feat + [0.0] * 24  # 4 btc_cross + 3 orderbook + 3 meta + 3 derived + 3 btc_pred + 8 15m
            elif len(feat) == 53:
                feat = feat + [0.0] * 20  # 3 orderbook + 3 meta + 3 derived + 3 btc_pred + 8 15m
            elif len(feat) == 62:
                feat = feat + [0.0] * 11  # 3 btc_pred + 8 15m
            elif len(feat) == 65:
                feat = feat + [0.0] * 8   # 8 15m features

            features.append(feat)

            for horizon in ["h1", "h4", "h12"]:
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
    for h in ["h1", "h4", "h12"]:
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


def get_threshold(token: str, horizon: str) -> float:
    """Get classification threshold for token/horizon (per-token override or global default)."""
    if token in TOKEN_THRESHOLDS and horizon in TOKEN_THRESHOLDS[token]:
        return TOKEN_THRESHOLDS[token][horizon]
    return THRESHOLDS[horizon]


def get_xgb_params(token: str) -> dict:
    """Get XGBoost params for token (per-token override merged with defaults)."""
    params = dict(XGB_PARAMS)
    if token in TOKEN_XGB_PARAMS:
        params.update(TOKEN_XGB_PARAMS[token])
    return params


def compute_sample_weights(y: np.ndarray) -> np.ndarray:
    """Compute inverse-frequency sample weights to balance classes."""
    classes, counts = np.unique(y, return_counts=True)
    total = len(y)
    weights = np.ones(total, dtype=np.float32)
    for cls, cnt in zip(classes, counts):
        # Inverse frequency: rare class gets higher weight
        weights[y == cls] = total / (len(classes) * cnt)
    return weights


def train_model(
    X_all: list[list[float]],
    y_raw: list[float | None],
    horizon: str,
    token: str,
) -> dict | None:
    """Train XGBoost model for one horizon. Returns metadata dict or None."""
    threshold = get_threshold(token, horizon)

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

    # Dead feature masking — drop structurally zero columns for this token
    dead_features = TOKEN_DEAD_FEATURES.get(token, [])
    live_mask = [i for i in range(X.shape[1]) if i not in dead_features]
    if dead_features:
        X = X[:, live_mask]
        print(f"    {horizon}: Masked {len(dead_features)} dead features → {X.shape[1]} live features")

    # Chronological train/test split (80/20)
    split_idx = int(len(X) * 0.8)
    X_train, X_test = X[:split_idx], X[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]

    # Class distribution
    for cls, name in [(0, "SHORT"), (1, "NEUTRAL"), (2, "LONG")]:
        train_count = int(np.sum(y_train == cls))
        test_count = int(np.sum(y_test == cls))
        print(f"    {horizon} class {name}: train={train_count}, test={test_count}")

    print(f"    {horizon} threshold: ±{threshold*100:.1f}%")

    # Skip if any class missing from train — XGBoost predict() breaks with < num_class classes
    train_classes = set(int(c) for c in np.unique(y_train))
    if len(train_classes) < 3:
        missing = {0, 1, 2} - train_classes
        names = {0: "SHORT", 1: "NEUTRAL", 2: "LONG"}
        missing_names = ", ".join(names[c] for c in missing)
        print(f"    {horizon}: Missing class(es) {missing_names} in train set, skipping")
        return None

    # Class-balanced sample weights (inverse frequency)
    sample_weights = compute_sample_weights(y_train)

    # Get per-token XGBoost params
    params = get_xgb_params(token)

    # Train with early stopping to prevent overfitting
    model = xgb.XGBClassifier(
        early_stopping_rounds=EARLY_STOPPING_ROUNDS,
        **params,
    )
    model.fit(
        X_train, y_train,
        sample_weight=sample_weights,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )

    # Report how many trees were actually used (early stopping)
    best_iter = getattr(model, 'best_iteration', None)
    if best_iter is not None:
        print(f"    {horizon}: early stopping at {best_iter}/{params.get('n_estimators', 100)} trees")

    # Evaluate
    train_acc = float(np.mean(model.predict(X_train) == y_train))
    test_acc = float(np.mean(model.predict(X_test) == y_test))

    # Test predictions distribution
    test_preds = model.predict(X_test)
    for cls, name in [(0, "SHORT"), (1, "NEUTRAL"), (2, "LONG")]:
        pred_count = int(np.sum(test_preds == cls))
        print(f"    {horizon} predicted {name}: {pred_count}")

    print(f"    {horizon}: train_acc={train_acc:.3f}, test_acc={test_acc:.3f} (n_train={len(X_train)}, n_test={len(X_test)})")

    # Feature importance (map back to original feature names when masked)
    importance = model.feature_importances_
    if dead_features:
        top_features = sorted(
            [(FEATURE_NAMES[live_mask[i]], float(importance[i])) for i in range(len(importance))],
            key=lambda x: x[1],
            reverse=True,
        )[:10]
    else:
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

    for horizon in ["h1", "h4", "h12"]:
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
