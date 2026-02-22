/**
 * Price Prediction Module
 * Hybrid LSTM/XGBoost-inspired model for crypto price prediction
 *
 * Architecture:
 * ┌──────────────────────────────────────────────────────────────┐
 * │  INPUT FEATURES (Price + On-Chain + Sentiment)              │
 * │  ├── Technical: RSI, MACD, EMA, BB, ATR, Volatility        │
 * │  ├── Nansen: SM Positions, Bias, Signal State              │
 * │  └── Market: Volume ratio, Price momentum                   │
 * └──────────────────────────────────────────────────────────────┘
 *                           │
 *                           ▼
 * ┌──────────────────────────────────────────────────────────────┐
 * │  HYBRID MODEL                                                │
 * │  ├── Technical Signal (RSI, MACD momentum)                  │
 * │  ├── Trend Signal (EMA crossovers)                          │
 * │  ├── Smart Money Signal (Nansen data, highest weight)       │
 * │  └── Volatility/Volume adjustment                           │
 * └──────────────────────────────────────────────────────────────┘
 *                           │
 *                           ▼
 * ┌──────────────────────────────────────────────────────────────┐
 * │  OUTPUT                                                      │
 * │  ├── direction: UP | DOWN | NEUTRAL                         │
 * │  ├── priceChange: predicted % change                        │
 * │  ├── confidence: 0-100                                      │
 * │  └── horizon: 1h | 4h | 12h                                 │
 * └──────────────────────────────────────────────────────────────┘
 */

export { TechnicalIndicators, TechnicalFeatures, OHLCVData } from './features/TechnicalIndicators.js';
export { NansenFeatures, NansenFlowData, SmartMoneyPosition } from './features/NansenFeatures.js';
export { HyperliquidDataLoader, INTERVALS } from './data/HyperliquidDataLoader.js';
export { HybridPredictor, PredictionResult, ModelWeights } from './models/HybridPredictor.js';
export { XGBoostPredictor, XGBPrediction, FEATURE_NAMES } from './models/XGBoostPredictor.js';

import { HyperliquidDataLoader } from './data/HyperliquidDataLoader.js';
import { TechnicalIndicators } from './features/TechnicalIndicators.js';
import { NansenFeatures } from './features/NansenFeatures.js';
import { HybridPredictor, PredictionResult } from './models/HybridPredictor.js';

/**
 * PricePredictionService - Main service class
 * Orchestrates data loading, feature extraction, and prediction
 */
export class PricePredictionService {
  private dataLoader: HyperliquidDataLoader;
  private technicalIndicators: TechnicalIndicators;
  private nansenFeatures: NansenFeatures;
  private predictor: HybridPredictor;

  constructor() {
    this.dataLoader = new HyperliquidDataLoader();
    this.technicalIndicators = new TechnicalIndicators();
    this.nansenFeatures = new NansenFeatures();
    this.predictor = new HybridPredictor();
  }

  /**
   * Get full prediction for a token
   */
  async getPrediction(token: string): Promise<{
    prediction: PredictionResult;
    features: {
      technical: number[];
      nansen: number[];
    };
    meta: {
      currentPrice: number;
      timestamp: number;
      dataPoints: number;
    };
  }> {
    console.log(`[PredictionService] Getting prediction for ${token}...`);

    // Fetch data in parallel
    const [candles, midPrice, nansenData] = await Promise.all([
      this.dataLoader.fetchCandles(token, '1h', 100),
      this.dataLoader.fetchMidPrice(token),
      this.nansenFeatures.getAllFeatures(token),
    ]);

    if (candles.length < 60) {
      throw new Error(`Insufficient data for ${token}: ${candles.length} candles`);
    }

    // Calculate technical features
    const technicalFeatures = this.technicalIndicators.calculate(candles);
    const latestTechnical = technicalFeatures[technicalFeatures.length - 1];
    const normalizedTechnical = this.technicalIndicators.normalize(latestTechnical);

    // Get unified prediction (includes all horizons)
    const prediction = await this.predictor.predict(token, candles);

    return {
      prediction,
      features: {
        technical: normalizedTechnical,
        nansen: nansenData.normalized,
      },
      meta: {
        currentPrice: midPrice,
        timestamp: Date.now(),
        dataPoints: candles.length,
      },
    };
  }

  /**
   * Get quick prediction
   */
  async getQuickPrediction(token: string): Promise<PredictionResult> {
    const candles = await this.dataLoader.fetchCandles(token, '1h', 100);
    return this.predictor.predict(token, candles);
  }

  /**
   * Verify past predictions
   */
  async verifyPredictions(token: string): Promise<{
    h1: { accuracy: number; total: number };
    h4: { accuracy: number; total: number };
    h12: { accuracy: number; total: number };
    direction: { accuracy: number; total: number };
  }> {
    const candles = await this.dataLoader.fetchCandles(token, '1h', 24);
    const currentPrice = candles[candles.length - 1]?.close || 0;

    if (currentPrice > 0) {
      return this.predictor.verifyPredictions(token, currentPrice);
    }
    return {
      h1: { accuracy: 0, total: 0 },
      h4: { accuracy: 0, total: 0 },
      h12: { accuracy: 0, total: 0 },
      direction: { accuracy: 0, total: 0 },
    };
  }

  /**
   * Get model weights
   */
  getWeights(): { technical: number; momentum: number; smartMoney: number; volume: number; trend: number } {
    return this.predictor.getWeights();
  }

  /**
   * Update model weights based on accuracy
   */
  async updateWeights(token: string): Promise<void> {
    await this.predictor.updateWeights(token);
  }

  /**
   * Get XGBoost-only prediction for a token (all horizons)
   */
  async getXGBPrediction(token: string): Promise<{
    token: string;
    predictions: any[] | null;
    hasModel: boolean;
    timestamp: number;
  }> {
    const xgb = this.predictor.getXGBoost();
    await xgb.reload();

    if (!xgb.hasModelsForToken(token)) {
      return { token, predictions: null, hasModel: false, timestamp: Date.now() };
    }

    // Build feature vector
    const [candles, nansenData] = await Promise.all([
      this.dataLoader.fetchCandles(token, '1h', 100),
      this.nansenFeatures.getAllFeatures(token),
    ]);

    if (candles.length < 60) {
      return { token, predictions: null, hasModel: true, timestamp: Date.now() };
    }

    const techFeatures = this.technicalIndicators.calculate(candles);
    const latestTech = techFeatures[techFeatures.length - 1];
    const normalizedTech = this.technicalIndicators.normalize(latestTech);

    const now = new Date();
    const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
    const dow = now.getUTCDay();

    const featureVector = [
      ...normalizedTech,
      ...nansenData.normalized,
      0, 0, 0,  // funding, oi_1h, oi_4h (not available in TS)
      Math.sin(2 * Math.PI * hour / 24),
      Math.cos(2 * Math.PI * hour / 24),
      Math.sin(2 * Math.PI * dow / 7),
      Math.cos(2 * Math.PI * dow / 7),
      0,  // volatility_24h
    ];

    const predictions = xgb.predict(token, featureVector);

    return { token, predictions, hasModel: true, timestamp: Date.now() };
  }

  /**
   * Get XGBoost model status
   */
  getXGBStatus(): any {
    return this.predictor.getXGBoost().getStatus();
  }

  /**
   * Get XGBoost feature importance for a token (all horizons)
   */
  getXGBFeatureImportance(token: string): Record<string, Record<string, number> | null> {
    const xgb = this.predictor.getXGBoost();
    return {
      h1: xgb.getFeatureImportance(token, 'h1'),
      h4: xgb.getFeatureImportance(token, 'h4'),
      h12: xgb.getFeatureImportance(token, 'h12'),
    };
  }

  /**
   * Get feature importance (explainability)
   */
  getFeatureImportance(): { name: string; weight: number }[] {
    const technicalNames = [
      'rsi', 'macd_line', 'macd_signal', 'macd_histogram',
      'price_change_1h', 'price_change_4h', 'price_change_24h',
      'volume_ratio', 'volatility', 'bb_width', 'atr_pct',
    ];

    const nansenNames = this.nansenFeatures.getFeatureNames();

    // Get actual weights from model
    const weights = this.predictor.getWeights();

    return [
      ...technicalNames.map(name => ({
        name: `tech_${name}`,
        weight: weights.technical / technicalNames.length,
      })),
      ...nansenNames.map(name => ({
        name: `nansen_${name}`,
        weight: weights.smartMoney / nansenNames.length,
      })),
      { name: 'momentum', weight: weights.momentum },
      { name: 'volume', weight: weights.volume },
      { name: 'trend', weight: weights.trend },
    ];
  }
}

// Singleton instance
let service: PricePredictionService | null = null;

export function getPredictionService(): PricePredictionService {
  if (!service) {
    service = new PricePredictionService();
  }
  return service;
}

// CLI test
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  (async () => {
    const svc = getPredictionService();
    const tokens = ['HYPE', 'LIT', 'FARTCOIN'];

    console.log('\n🔮 Price Prediction Service - Test Run\n');

    for (const token of tokens) {
      try {
        console.log(`\n━━━━━━━━━━ ${token} ━━━━━━━━━━`);
        const result = await svc.getPrediction(token);
        const pred = result.prediction;

        console.log(`Current Price: $${pred.currentPrice.toFixed(4)}`);
        console.log(`Direction: ${pred.direction} (confidence: ${pred.confidence.toFixed(0)}%)`);
        console.log(`Data Points: ${result.meta.dataPoints}`);
        console.log(`\nPredictions:`);

        const arrow = pred.direction === 'BULLISH' ? '📈' : pred.direction === 'BEARISH' ? '📉' : '➡️';

        console.log(`  1h:  ${arrow} ${pred.predictions.h1.change >= 0 ? '+' : ''}${pred.predictions.h1.change.toFixed(2)}% → $${pred.predictions.h1.price.toFixed(4)} (conf: ${pred.predictions.h1.confidence.toFixed(0)}%)`);
        console.log(`  4h:  ${arrow} ${pred.predictions.h4.change >= 0 ? '+' : ''}${pred.predictions.h4.change.toFixed(2)}% → $${pred.predictions.h4.price.toFixed(4)} (conf: ${pred.predictions.h4.confidence.toFixed(0)}%)`);
        console.log(`  12h: ${arrow} ${pred.predictions.h12.change >= 0 ? '+' : ''}${pred.predictions.h12.change.toFixed(2)}% → $${pred.predictions.h12.price.toFixed(4)} (conf: ${pred.predictions.h12.confidence.toFixed(0)}%)`);

        console.log(`\nSignals:`);
        console.log(`  Technical:   ${(pred.signals.technical * 100).toFixed(0)}%`);
        console.log(`  Momentum:    ${(pred.signals.momentum * 100).toFixed(0)}%`);
        console.log(`  Smart Money: ${(pred.signals.smartMoney * 100).toFixed(0)}%`);
        console.log(`  Volume:      ${(pred.signals.volume * 100).toFixed(0)}%`);

        if (pred.keyFactors.length > 0) {
          console.log(`\nKey Factors:`);
          pred.keyFactors.forEach(f => console.log(`  • ${f}`));
        }
      } catch (error) {
        console.error(`Error for ${token}:`, error);
      }
    }

    console.log('\n✅ Test complete\n');
  })();
}
