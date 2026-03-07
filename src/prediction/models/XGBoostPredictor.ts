/**
 * XGBoost Inference Engine (TypeScript)
 *
 * Loads XGBoost model JSON exported by Python training script.
 * Traverses decision trees directly — zero npm dependencies.
 *
 * Model format: XGBoost save_model() JSON with tree structure:
 *   { learner: { gradient_booster: { model: { trees: [...] } } } }
 *
 * For multi-class (3 classes: SHORT=0, NEUTRAL=1, LONG=2),
 * XGBoost stores trees in groups of num_class.
 * Tree i belongs to class (i % num_class).
 * Sum leaf values per class across all tree groups → softmax → probabilities.
 */

import { promises as fsp } from 'fs';

// --- Types ---

export interface XGBPrediction {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;        // 0-100, from max probability
  probabilities: { long: number; short: number; neutral: number };
  horizon: string;           // 'h1', 'h4', 'h12'
}

export interface XGBMeta {
  token: string;
  trained_at: string;
  trained_ts: number;
  total_rows: number;
  horizons: Record<string, {
    horizon: string;
    train_accuracy: number;
    test_accuracy: number;
    n_train: number;
    n_test: number;
    n_total: number;
    top_features: [string, number][];
    class_distribution: {
      train: Record<string, number>;
      test: Record<string, number>;
    };
  }>;
}

interface XGBTreeNested {
  nodeid?: number;
  split?: number;          // feature index
  split_condition?: number;
  yes?: number;            // child node id for yes (left)
  no?: number;             // child node id for no (right)
  missing?: number;
  leaf?: number;           // leaf value (only on leaf nodes)
  children?: XGBTreeNested[];
}

interface XGBTreeFlat {
  split_indices: number[];
  split_conditions: number[];
  left_children: number[];
  right_children: number[];
  default_left: number[];
  base_weights: number[];
  tree_param: { num_nodes: string };
}

type XGBTree = XGBTreeNested | XGBTreeFlat;

interface XGBModel {
  trees: XGBTree[];
  numClass: number;
  baseScore: number;
}

// --- Feature names (must match Python collector) ---

export const FEATURE_NAMES = [
  // Technical (11)
  'rsi', 'macd_line', 'macd_signal', 'macd_hist',
  'change_1h', 'change_4h', 'change_24h',
  'volume_ratio', 'volatility', 'bb_width', 'atr_pct',
  // Nansen (11)
  'sm_ratio', 'sm_conviction', 'sm_long_usd', 'sm_short_usd',
  'nansen_bias', 'bias_confidence',
  'signal_green', 'signal_yellow', 'signal_red',
  'dominant_long', 'dominant_short',
  // Extra (8)
  'funding_rate', 'oi_change_1h', 'oi_change_4h',
  'hour_sin', 'hour_cos', 'day_sin', 'day_cos',
  'volatility_24h',
  // Multi-day trend (4)
  'change_7d', 'change_10d', 'dist_from_7d_high', 'trend_slope_7d',
  // BTC cross-market (4)
  'btc_change_1h', 'btc_change_4h', 'btc_rsi', 'btc_token_corr_24h',
  // Orderbook (3)
  'bid_ask_imbalance', 'spread_bps', 'book_depth_ratio',
  // MetaCtx (3)
  'mark_oracle_spread', 'oi_normalized', 'predicted_funding',
  // Derived (3)
  'volume_momentum', 'price_acceleration', 'volume_price_divergence',
  // BTC prediction proxy (3)
  'btc_pred_direction', 'btc_pred_change', 'btc_pred_confidence',
  // 15m candle features (8)
  'rsi_15m', 'change_15m', 'change_1h_15m', 'ema9_ema21_cross_15m',
  'momentum_15m', 'volatility_15m', 'body_ratio_15m', 'consecutive_dir_15m',
  // Tier-2 features (3)
  'gap_detection', 'range_expansion', 'rsi_4h',
];

const NUM_FEATURES = 61;  // 11 tech + 11 nansen + 8 extra + 4 multiday + 4 btc_cross + 3 orderbook + 3 meta + 3 derived + 3 btc_pred + 8 15m + 3 tier2
const NUM_CLASSES = 3;  // SHORT=0, NEUTRAL=1, LONG=2
const HORIZONS = ['h1', 'h4', 'h12'] as const;
const MODEL_DIR = '/tmp';
const RELOAD_INTERVAL = 5 * 60 * 1000; // 5 minutes

// --- Tree traversal ---

/**
 * Check if tree uses flat array format (XGBoost 3.x).
 */
function isFlatTree(tree: XGBTree): tree is XGBTreeFlat {
  return 'split_indices' in tree && 'left_children' in tree;
}

/**
 * Traverse a flat-format tree (XGBoost 3.x: split_indices[], left_children[], etc.)
 */
function traverseFlatTree(tree: XGBTreeFlat, features: number[]): number {
  let nodeIdx = 0;

  while (tree.left_children[nodeIdx] !== -1) {
    const splitFeature = tree.split_indices[nodeIdx];
    const splitCondition = tree.split_conditions[nodeIdx];
    const val = features[splitFeature] ?? 0;
    const valIsNaN = val !== val;

    if (valIsNaN) {
      // Go to default direction
      nodeIdx = tree.default_left[nodeIdx]
        ? tree.left_children[nodeIdx]
        : tree.right_children[nodeIdx];
    } else if (val < splitCondition) {
      nodeIdx = tree.left_children[nodeIdx];
    } else {
      nodeIdx = tree.right_children[nodeIdx];
    }

    if (nodeIdx < 0 || nodeIdx >= tree.left_children.length) {
      return 0; // safety
    }
  }

  return tree.base_weights[nodeIdx];
}

/**
 * Traverse a nested-format tree (XGBoost 1.x: nodeid, children[], etc.)
 */
function traverseNestedTree(tree: XGBTreeNested, features: number[]): number {
  const map = new Map<number, XGBTreeNested>();
  function walk(node: XGBTreeNested): void {
    if (node.nodeid !== undefined) map.set(node.nodeid, node);
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  }
  walk(tree);

  let current = tree;
  while (current.leaf === undefined) {
    const splitFeature = current.split;
    if (splitFeature === undefined || current.split_condition === undefined) return 0;

    const val = features[splitFeature] ?? 0;
    const valIsNaN = val !== val;

    let nextId: number;
    if (valIsNaN) {
      nextId = current.missing ?? current.yes ?? 0;
    } else if (val < current.split_condition) {
      nextId = current.yes ?? 0;
    } else {
      nextId = current.no ?? 0;
    }

    const next = map.get(nextId);
    if (!next) return 0;
    current = next;
  }

  return current.leaf;
}

/**
 * Traverse a single decision tree and return the leaf value.
 * Supports both flat (XGBoost 3.x) and nested (XGBoost 1.x) formats.
 */
function traverseTree(tree: XGBTree, features: number[]): number {
  if (isFlatTree(tree)) {
    return traverseFlatTree(tree, features);
  }
  return traverseNestedTree(tree as XGBTreeNested, features);
}

/**
 * Softmax: convert raw scores to probabilities.
 */
function softmax(scores: number[]): number[] {
  const max = Math.max(...scores);
  const exps = scores.map(s => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

// --- XGBoost model loading ---

function parseModelJson(data: any): XGBModel | null {
  try {
    const learner = data.learner;
    if (!learner) return null;

    const gbm = learner.gradient_booster?.model;
    if (!gbm) return null;

    const trees: XGBTree[] = gbm.trees || [];
    const numClass = parseInt(learner.learner_model_param?.num_class || '3', 10);

    // Base score (default 0.5 for multi-class softprob)
    const baseScore = parseFloat(learner.learner_model_param?.base_score || '0.5');

    return { trees, numClass, baseScore };
  } catch {
    return null;
  }
}

/**
 * Run inference on a single model (one horizon).
 * Returns class probabilities [SHORT, NEUTRAL, LONG].
 */
function predictModel(model: XGBModel, features: number[]): number[] {
  const numTrees = model.trees.length;
  const numClass = model.numClass;

  // Sum leaf values per class
  const classScores = new Array(numClass).fill(0);

  for (let i = 0; i < numTrees; i++) {
    const classIdx = i % numClass;
    const leafValue = traverseTree(model.trees[i], features);
    classScores[classIdx] += leafValue;
  }

  return softmax(classScores);
}

// --- Main class ---

export class XGBoostPredictor {
  private models: Map<string, Record<string, XGBModel>> = new Map();  // token -> {h1, h4, h12}
  private meta: Map<string, XGBMeta> = new Map();
  private lastReload: number = 0;
  private tokens = ['BTC', 'ETH', 'SOL', 'HYPE', 'ZEC', 'XRP', 'LIT', 'FARTCOIN', 'kPEPE'];

  constructor() {
    // Initial load (fire and forget)
    this.reload().catch(() => {});
  }

  /**
   * Load/reload models from /tmp. Called every 5 min.
   */
  async reload(): Promise<void> {
    const now = Date.now();
    if (now - this.lastReload < RELOAD_INTERVAL && this.lastReload > 0) {
      return;
    }

    for (const token of this.tokens) {
      const horizonModels: Record<string, XGBModel> = {};
      let loaded = 0;

      for (const horizon of HORIZONS) {
        const modelPath = `${MODEL_DIR}/xgboost_model_${token}_${horizon}.json`;
        try {
          const raw = await fsp.readFile(modelPath, 'utf-8');
          const data = JSON.parse(raw);
          const model = parseModelJson(data);
          if (model && model.trees.length > 0) {
            horizonModels[horizon] = model;
            loaded++;
          }
        } catch {
          // Model file doesn't exist yet — expected before first training
        }
      }

      if (loaded > 0) {
        this.models.set(token, horizonModels);
        console.log(`[XGBoost] Loaded ${loaded} models for ${token}`);
      }

      // Load meta
      const metaPath = `${MODEL_DIR}/xgboost_meta_${token}.json`;
      try {
        const raw = await fsp.readFile(metaPath, 'utf-8');
        this.meta.set(token, JSON.parse(raw));
      } catch {
        // Meta doesn't exist yet
      }
    }

    this.lastReload = now;
  }

  /**
   * Predict for a token using all available horizon models.
   * Returns null if no model loaded for this token.
   */
  predict(token: string, features: number[]): XGBPrediction[] | null {
    const tokenModels = this.models.get(token);
    if (!tokenModels || Object.keys(tokenModels).length === 0) {
      return null;
    }

    // Accept any known feature vector size, pad to NUM_FEATURES with zeros
    const ACCEPTED_SIZES = [30, 45, 49, 53, 62, 65, 73, 76, NUM_FEATURES];
    let paddedFeatures = features;
    if (features.length < NUM_FEATURES && ACCEPTED_SIZES.includes(features.length)) {
      paddedFeatures = [...features, ...new Array(NUM_FEATURES - features.length).fill(0)];
    } else if (features.length !== NUM_FEATURES) {
      console.warn(`[XGBoost] Expected ${NUM_FEATURES} features, got ${features.length}`);
      return null;
    }

    const predictions: XGBPrediction[] = [];

    for (const horizon of HORIZONS) {
      const model = tokenModels[horizon];
      if (!model) continue;

      const probs = predictModel(model, paddedFeatures);
      // probs = [SHORT, NEUTRAL, LONG] (classes 0, 1, 2)

      const shortProb = probs[0] || 0;
      const neutralProb = probs[1] || 0;
      const longProb = probs[2] || 0;

      let direction: 'LONG' | 'SHORT' | 'NEUTRAL';
      let confidence: number;

      if (longProb > shortProb && longProb > neutralProb) {
        direction = 'LONG';
        confidence = longProb * 100;
      } else if (shortProb > longProb && shortProb > neutralProb) {
        direction = 'SHORT';
        confidence = shortProb * 100;
      } else {
        direction = 'NEUTRAL';
        confidence = neutralProb * 100;
      }

      predictions.push({
        direction,
        confidence: Math.round(confidence * 10) / 10,
        probabilities: {
          long: Math.round(longProb * 1000) / 1000,
          short: Math.round(shortProb * 1000) / 1000,
          neutral: Math.round(neutralProb * 1000) / 1000,
        },
        horizon,
      });
    }

    return predictions.length > 0 ? predictions : null;
  }

  /**
   * Get the best (highest confidence) prediction for blending.
   * Prefers h4 for swing trading alignment.
   */
  getBestPrediction(token: string, features: number[]): XGBPrediction | null {
    const preds = this.predict(token, features);
    if (!preds || preds.length === 0) return null;

    // Prefer h4, then h1, h12
    const preference = ['h4', 'h1', 'h12'];
    for (const hz of preference) {
      const found = preds.find(p => p.horizon === hz);
      if (found) return found;
    }
    return preds[0];
  }

  /**
   * Get feature importance from training metadata.
   */
  getFeatureImportance(token: string, horizon: string): Record<string, number> | null {
    const m = this.meta.get(token);
    if (!m) return null;

    const hMeta = m.horizons[horizon];
    if (!hMeta) return null;

    const result: Record<string, number> = {};
    for (const [name, value] of hMeta.top_features) {
      result[name] = value;
    }
    return result;
  }

  /**
   * Get status of all loaded models.
   */
  getStatus(): {
    tokens: string[];
    models: Record<string, { horizons: string[]; age_hours: number }>;
    sampleCount: Record<string, number>;
    accuracy: Record<string, Record<string, number>>;
  } {
    const models: Record<string, { horizons: string[]; age_hours: number }> = {};
    const sampleCount: Record<string, number> = {};
    const accuracy: Record<string, Record<string, number>> = {};

    for (const token of this.tokens) {
      const tokenModels = this.models.get(token);
      const m = this.meta.get(token);

      if (tokenModels) {
        const horizons = Object.keys(tokenModels);
        const ageMs = m ? Date.now() - m.trained_ts * 1000 : 0;
        models[token] = {
          horizons,
          age_hours: Math.round(ageMs / 3600000 * 10) / 10,
        };
      }

      if (m) {
        sampleCount[token] = m.total_rows;
        accuracy[token] = {};
        for (const [h, info] of Object.entries(m.horizons)) {
          accuracy[token][h] = info.test_accuracy;
        }
      }
    }

    return {
      tokens: this.tokens.filter(t => this.models.has(t)),
      models,
      sampleCount,
      accuracy,
    };
  }

  /**
   * Check if any models are loaded.
   */
  hasModels(): boolean {
    return this.models.size > 0;
  }

  /**
   * Check if models exist for a specific token.
   */
  hasModelsForToken(token: string): boolean {
    const m = this.models.get(token);
    return !!m && Object.keys(m).length > 0;
  }
}
