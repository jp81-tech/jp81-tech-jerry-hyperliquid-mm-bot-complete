#!/usr/bin/env python3
"""
XGBoost SHAP Evaluation — Feature importance "X-ray"

Loads a trained XGBoost model and recent data, computes SHAP values,
and outputs a ranked feature analysis showing:
  - Top 20 most impactful features (positive contributors)
  - Bottom 20 least useful features (candidates for removal)
  - Per-class directional impact (how each feature pushes SHORT/NEUTRAL/LONG)
  - Feature interaction pairs

Usage:
    python3 scripts/xgboost_shap_eval.py                          # kPEPE h4 (default)
    python3 scripts/xgboost_shap_eval.py --token BTC --horizon h1
    python3 scripts/xgboost_shap_eval.py --token kPEPE --horizon h4 --last-n 500
    python3 scripts/xgboost_shap_eval.py --all                    # all tokens, all horizons

Requires: pip install shap xgboost numpy
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np

try:
    import xgboost as xgb
except ImportError:
    print("ERROR: xgboost not installed. Run: pip install xgboost")
    sys.exit(1)

try:
    import shap
except ImportError:
    print("ERROR: shap not installed. Run: pip install shap")
    sys.exit(1)

# Import shared config from training script
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xgboost_train import (
    FEATURE_NAMES, NUM_FEATURES, TOKEN_DEAD_FEATURES,
    get_threshold, classify_label,
)

DATASET_DIR = "/tmp"
MODEL_DIR = "/tmp"
CLASS_NAMES = ["SHORT", "NEUTRAL", "LONG"]


def load_data(token: str, horizon: str, last_n: int = 0):
    """Load dataset, filter to labeled rows, return X, y, feature_names."""
    filepath = os.path.join(DATASET_DIR, f"xgboost_dataset_{token}.jsonl")
    if not os.path.exists(filepath):
        print(f"ERROR: Dataset not found: {filepath}")
        return None, None, None

    LABEL_KEY_MAP = {
        "h1": ["label_h1", "label_1h"],
        "h4": ["label_h4", "label_4h"],
        "h12": ["label_h12", "label_12h"],
    }

    features = []
    labels = []
    threshold = get_threshold(token, horizon)

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
            if not feat or len(feat) not in (30, 45, 49, 53, 62, 65, 73, 76, NUM_FEATURES):
                continue

            # Pad to NUM_FEATURES
            pad_len = NUM_FEATURES - len(feat)
            if pad_len > 0:
                feat = feat + [0.0] * pad_len

            # Get label
            val = None
            for k in LABEL_KEY_MAP.get(horizon, []):
                val = row.get(k)
                if val is not None:
                    break
            if val is None:
                continue

            features.append(feat)
            labels.append(classify_label(val, threshold))

    if not features:
        print(f"  No labeled data for {token} {horizon}")
        return None, None, None

    X = np.array(features, dtype=np.float32)
    y = np.array(labels, dtype=np.int32)

    # Apply dead feature masking
    dead_features = TOKEN_DEAD_FEATURES.get(token, [])
    live_mask = [i for i in range(X.shape[1]) if i not in dead_features]
    live_names = [FEATURE_NAMES[i] for i in live_mask]

    X_live = X[:, live_mask]

    # Take last N rows (most recent data)
    if last_n > 0 and len(X_live) > last_n:
        X_live = X_live[-last_n:]
        y = y[-last_n:]

    return X_live, y, live_names


def run_shap_analysis(token: str, horizon: str, last_n: int = 0):
    """Run SHAP analysis for a token/horizon pair."""
    model_path = os.path.join(MODEL_DIR, f"xgboost_model_{token}_{horizon}.json")
    if not os.path.exists(model_path):
        print(f"  Model not found: {model_path} — skip")
        return None

    print(f"\n{'='*70}")
    print(f"  SHAP Analysis: {token} {horizon}")
    print(f"{'='*70}")

    # Load model as Booster (XGBClassifier + shap crashes on XGBoost 3.x)
    bst = xgb.Booster()
    bst.load_model(model_path)
    model_num_features = bst.num_features()

    # Load data
    X, y, feature_names = load_data(token, horizon, last_n)
    if X is None:
        return None

    # Model may have been trained with fewer features (e.g. 53 live features
    # after dead-feature masking on an older feature set). If current live
    # features exceed model's expected count, trim to model width so DMatrix
    # doesn't fail.
    if X.shape[1] > model_num_features:
        print(f"  NOTE: Model expects {model_num_features} features, data has {X.shape[1]} — trimming to model width")
        X = X[:, :model_num_features]
        feature_names = feature_names[:model_num_features]

    print(f"  Samples: {len(X)} | Features: {len(feature_names)} | Threshold: +/-{get_threshold(token, horizon)*100:.2f}%")

    # Class distribution
    for cls, name in enumerate(CLASS_NAMES):
        cnt = int(np.sum(y == cls))
        pct = cnt / len(y) * 100
        print(f"  {name}: {cnt} ({pct:.1f}%)")

    # Compute SHAP values using Booster + DMatrix (stable with XGBoost 3.x + shap 0.51)
    print(f"\n  Computing SHAP values (TreeExplainer)...")
    explainer = shap.TreeExplainer(bst)
    dmat = xgb.DMatrix(X, feature_names=feature_names)
    shap_values = explainer.shap_values(dmat)

    # shap_values shape: (n_samples, n_features, n_classes) with Booster
    # or list of 3 arrays (one per class) depending on shap version
    if isinstance(shap_values, list):
        shap_short = shap_values[0]   # Class 0 = SHORT
        shap_neutral = shap_values[1] # Class 1 = NEUTRAL
        shap_long = shap_values[2]    # Class 2 = LONG
    else:
        shap_short = shap_values[:, :, 0]
        shap_neutral = shap_values[:, :, 1]
        shap_long = shap_values[:, :, 2]

    # Mean absolute SHAP value per feature (overall importance)
    mean_abs_shap = np.mean(np.abs(shap_short) + np.abs(shap_neutral) + np.abs(shap_long), axis=0) / 3.0

    # Per-class mean SHAP (directional impact)
    mean_shap_short = np.mean(shap_short, axis=0)
    mean_shap_neutral = np.mean(shap_neutral, axis=0)
    mean_shap_long = np.mean(shap_long, axis=0)

    # Build ranked list
    ranked = []
    for i, fname in enumerate(feature_names):
        ranked.append({
            "feature": fname,
            "importance": float(mean_abs_shap[i]),
            "short_impact": float(mean_shap_short[i]),
            "neutral_impact": float(mean_shap_neutral[i]),
            "long_impact": float(mean_shap_long[i]),
            "mean_value": float(np.mean(X[:, i])),
            "std_value": float(np.std(X[:, i])),
            "nonzero_pct": float(np.mean(X[:, i] != 0) * 100),
        })
    ranked.sort(key=lambda r: r["importance"], reverse=True)

    # --- Print Top 20 ---
    print(f"\n  {'='*66}")
    print(f"  TOP 20 FEATURES (highest SHAP impact)")
    print(f"  {'='*66}")
    print(f"  {'Rank':>4} {'Feature':<28} {'Impact':>8} {'SHORT':>8} {'NEUT':>8} {'LONG':>8} {'NZ%':>5}")
    print(f"  {'-'*4} {'-'*28} {'-'*8} {'-'*8} {'-'*8} {'-'*8} {'-'*5}")

    for i, r in enumerate(ranked[:20]):
        # Direction arrow for strongest class
        impacts = [r["short_impact"], r["neutral_impact"], r["long_impact"]]
        strongest = CLASS_NAMES[np.argmax(np.abs(impacts))]
        sign = "+" if impacts[np.argmax(np.abs(impacts))] > 0 else "-"

        print(f"  {i+1:>4} {r['feature']:<28} {r['importance']:>8.4f} "
              f"{r['short_impact']:>+7.4f} {r['neutral_impact']:>+7.4f} {r['long_impact']:>+7.4f} "
              f"{r['nonzero_pct']:>4.0f}%")

    # --- Interpretation for top 5 ---
    print(f"\n  INTERPRETATION (Top 5):")
    for i, r in enumerate(ranked[:5]):
        impacts = {"SHORT": r["short_impact"], "NEUTRAL": r["neutral_impact"], "LONG": r["long_impact"]}
        # Find which class this feature pushes toward most
        push_class = max(impacts, key=lambda k: abs(impacts[k]))
        push_dir = "increases" if impacts[push_class] > 0 else "decreases"
        anti_class = min(impacts, key=lambda k: impacts[k]) if impacts[push_class] > 0 else max(impacts, key=lambda k: impacts[k])

        print(f"  {i+1}. {r['feature']}: High values {push_dir} {push_class} probability "
              f"(avg impact: {impacts[push_class]:+.4f})")

    # --- Bottom 20 (candidates for removal) ---
    print(f"\n  {'='*66}")
    print(f"  BOTTOM 20 FEATURES (lowest impact — removal candidates)")
    print(f"  {'='*66}")
    print(f"  {'Rank':>4} {'Feature':<28} {'Impact':>8} {'NZ%':>5} {'Verdict':<20}")
    print(f"  {'-'*4} {'-'*28} {'-'*8} {'-'*5} {'-'*20}")

    for i, r in enumerate(ranked[-20:]):
        # Verdict
        if r["nonzero_pct"] < 5:
            verdict = "DEAD (always zero)"
        elif r["importance"] < 0.001:
            verdict = "NOISE (no signal)"
        elif r["importance"] < 0.005:
            verdict = "WEAK (marginal)"
        else:
            verdict = "OK (keep)"
        idx = len(ranked) - 20 + i + 1
        print(f"  {idx:>4} {r['feature']:<28} {r['importance']:>8.4f} {r['nonzero_pct']:>4.0f}% {verdict:<20}")

    # --- Feature correlation with accuracy ---
    # For each feature, compute accuracy when feature is above/below median
    print(f"\n  {'='*66}")
    print(f"  FEATURE VALUE vs ACCURACY (top 10)")
    print(f"  {'='*66}")
    print(f"  {'Feature':<28} {'HighAcc':>8} {'LowAcc':>8} {'Diff':>8} {'Signal':<10}")
    print(f"  {'-'*28} {'-'*8} {'-'*8} {'-'*8} {'-'*10}")

    # Get model predictions via Booster
    y_pred_proba = bst.predict(dmat)  # shape (n, 3) softmax probabilities
    y_pred = np.argmax(y_pred_proba, axis=1)
    correct = (y_pred == y)

    accuracy_diffs = []
    for i, fname in enumerate(feature_names):
        col = X[:, i]
        if np.std(col) < 1e-8:
            continue
        median = np.median(col)
        high_mask = col >= median
        low_mask = col < median

        if np.sum(high_mask) < 10 or np.sum(low_mask) < 10:
            continue

        high_acc = float(np.mean(correct[high_mask]))
        low_acc = float(np.mean(correct[low_mask]))
        diff = high_acc - low_acc
        accuracy_diffs.append((fname, high_acc, low_acc, diff))

    accuracy_diffs.sort(key=lambda x: abs(x[3]), reverse=True)
    for fname, high_acc, low_acc, diff in accuracy_diffs[:10]:
        signal = "USEFUL" if abs(diff) > 0.05 else "weak"
        print(f"  {fname:<28} {high_acc:>7.1%} {low_acc:>7.1%} {diff:>+7.1%} {signal:<10}")

    # --- Save JSON results ---
    out_path = f"/tmp/shap_{token}_{horizon}.json"
    with open(out_path, "w") as f:
        json.dump({
            "token": token,
            "horizon": horizon,
            "n_samples": len(X),
            "n_features": len(feature_names),
            "threshold": get_threshold(token, horizon),
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
            "top_20": ranked[:20],
            "bottom_20": ranked[-20:],
            "all_ranked": ranked,
        }, f, indent=2)
    print(f"\n  Results saved to {out_path}")

    # --- Save text summary ---
    txt_path = f"/tmp/shap_summary_{token}_{horizon}.txt"
    with open(txt_path, "w") as f:
        f.write(f"SHAP Summary: {token} {horizon}\n")
        f.write(f"Analyzed: {datetime.now(timezone.utc).isoformat()}\n")
        f.write(f"Samples: {len(X)} | Features: {len(feature_names)} | Threshold: +/-{get_threshold(token, horizon)*100:.2f}%\n\n")
        f.write(f"{'Rank':>4} {'Feature':<28} {'Impact':>8} {'SHORT':>8} {'NEUT':>8} {'LONG':>8} {'NZ%':>5}\n")
        f.write(f"{'-'*4} {'-'*28} {'-'*8} {'-'*8} {'-'*8} {'-'*8} {'-'*5}\n")
        for i, r in enumerate(ranked[:20]):
            f.write(f"{i+1:>4} {r['feature']:<28} {r['importance']:>8.4f} "
                    f"{r['short_impact']:>+7.4f} {r['neutral_impact']:>+7.4f} {r['long_impact']:>+7.4f} "
                    f"{r['nonzero_pct']:>4.0f}%\n")
        f.write(f"\nDIRECTIONALITY (Top 5):\n")
        for i, r in enumerate(ranked[:5]):
            impacts = {"SHORT": r["short_impact"], "NEUTRAL": r["neutral_impact"], "LONG": r["long_impact"]}
            push_class = max(impacts, key=lambda k: abs(impacts[k]))
            push_dir = "increases" if impacts[push_class] > 0 else "decreases"
            f.write(f"  {i+1}. {r['feature']}: High values {push_dir} {push_class} probability ({impacts[push_class]:+.4f})\n")
    print(f"  Text summary saved to {txt_path}")

    return ranked


def main():
    parser = argparse.ArgumentParser(description="XGBoost SHAP Feature Evaluation")
    parser.add_argument("--token", default="kPEPE", help="Token (default: kPEPE)")
    parser.add_argument("--horizon", default="h4", help="Horizon h1/h4/h12 (default: h4)")
    parser.add_argument("--last-n", type=int, default=0, help="Use only last N samples (0=all)")
    parser.add_argument("--all", action="store_true", help="Run for all tokens and horizons")
    args = parser.parse_args()

    if args.all:
        tokens = ["BTC", "ETH", "SOL", "HYPE", "ZEC", "XRP", "LIT", "FARTCOIN", "kPEPE"]
        horizons = ["h1", "h4", "h12"]
        for token in tokens:
            for hz in horizons:
                try:
                    run_shap_analysis(token, hz, args.last_n)
                except Exception as e:
                    print(f"  [{token} {hz}] ERROR: {e}")
    else:
        run_shap_analysis(args.token, args.horizon, args.last_n)


if __name__ == "__main__":
    main()
