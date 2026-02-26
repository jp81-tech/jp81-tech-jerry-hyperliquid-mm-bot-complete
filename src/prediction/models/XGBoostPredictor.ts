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
  horizon: string;           // 'h1', 'h4', 'h12', 'w1', 'm1'
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

interface XGBTree {
  nodeid?: number;
  split?: number;          // feature index
  split_condition?: number;
  yes?: number;            // child node id for yes (left)
  no?: number;             // child node id for no (right)
  missing?: number;
  leaf?: number;           // leaf value (only on leaf nodes)
  children?: XGBTree[];
}

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
];

const NUM_FEATURES = 30;
const NUM_CLASSES = 3;  // SHORT=0, NEUTRAL=1, LONG=2
const HORIZONS = ['h1', 'h4', 'h12', 'w1', 'm1'] as const;
const MODEL_DIR = '/tmp';
const RELOAD_INTERVAL = 5 * 60 * 1000; // 5 minutes

// --- Tree traversal ---

/**
 * Build a node lookup map from XGBoost tree structure.
 * XGBoost JSON uses nodeid for referencing yes/no/missing children.
 */
function buildNodeMap(tree: XGBTree): Map<number, XGBTree> {
  const map = new Map<number, XGBTree>();

  function walk(node: XGBTree): void {
    if (node.nodeid !== undefined) {
      map.set(node.nodeid, node);
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(tree);
  return map;
}

/**
 * Traverse a single decision tree and return the leaf value.
 */
function traverseTree(tree: XGBTree, features: number[]): number {
  const nodeMap = buildNodeMap(tree);

  let current = tree;
  while (current.leaf === undefined) {
    const splitFeature = current.split;
    if (splitFeature === undefined || current.split_condition === undefined) {
      return 0; // malformed node
    }

    const val = features[splitFeature] ?? 0;
    const isNaN = val !== val; // NaN check

    let nextId: number;
    if (isNaN) {
      nextId = current.missing ?? current.yes ?? 0;
    } else if (val < current.split_condition) {
      nextId = current.yes ?? 0;
    } else {
      nextId = current.no ?? 0;
    }

    const next = nodeMap.get(nextId);
    if (!next) {
      return 0; // missing node
    }
    current = next;
  }

  return current.leaf;
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

    if (features.length !== NUM_FEATURES) {
      console.warn(`[XGBoost] Expected ${NUM_FEATURES} features, got ${features.length}`);
      return null;
    }

    const predictions: XGBPrediction[] = [];

    for (const horizon of HORIZONS) {
      const model = tokenModels[horizon];
      if (!model) continue;

      const probs = predictModel(model, features);
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

    // Prefer h4, then h1, h12, w1, m1
    const preference = ['h4', 'h1', 'h12', 'w1', 'm1'];
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
