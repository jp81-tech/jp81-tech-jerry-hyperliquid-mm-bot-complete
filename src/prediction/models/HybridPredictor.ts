/**
 * Hybrid Price Predictor
 * Combines temporal pattern analysis with on-chain signals
 *
 * Architecture:
 * 1. LSTM-like temporal feature extraction (simplified)
 * 2. Gradient Boosting-style ensemble of weak predictors
 * 3. Nansen on-chain signal integration
 */

import { TechnicalIndicators, OHLCVData, TechnicalFeatures } from '../features/TechnicalIndicators.js';
import { NansenFeatures, SmartMoneyPosition } from '../features/NansenFeatures.js';
import { XGBoostPredictor, XGBPrediction } from './XGBoostPredictor.js';
import { promises as fsp } from 'fs';

export interface PredictionResult {
  token: string;
  currentPrice: number;
  predictions: Record<string, { price: number; change: number; confidence: number }>;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  signals: {
    technical: number;      // -1 to 1
    momentum: number;       // -1 to 1
    smartMoney: number;     // -1 to 1
    volume: number;         // -1 to 1
  };
  keyFactors: string[];
  timestamp: number;
}

export interface ModelWeights {
  technical: number;
  momentum: number;
  smartMoney: number;
  volume: number;
  trend: number;
}

export const PREDICTION_HORIZONS = [
  { key: 'h1',  hours: 1,   multiplier: 0.5, confMax: 80, confBase: 50, confScale: 30 },
  { key: 'h4',  hours: 4,   multiplier: 1.0, confMax: 70, confBase: 45, confScale: 25 },
  { key: 'h12', hours: 12,  multiplier: 1.5, confMax: 60, confBase: 40, confScale: 20 },
  { key: 'w1',  hours: 168, multiplier: 3.0, confMax: 45, confBase: 30, confScale: 15 },
  { key: 'm1',  hours: 720, multiplier: 5.0, confMax: 30, confBase: 20, confScale: 10 },
];

// Per-horizon weight overrides: short horizons = technical/momentum dominant, long = SM dominant
const HORIZON_WEIGHTS: Record<string, { technical: number; momentum: number; smartMoney: number; volume: number; trend: number }> = {
  h1:  { technical: 0.35, momentum: 0.30, smartMoney: 0.10, volume: 0.15, trend: 0.10 },
  h4:  { technical: 0.25, momentum: 0.20, smartMoney: 0.30, volume: 0.10, trend: 0.15 },
  h12: { technical: 0.20, momentum: 0.15, smartMoney: 0.40, volume: 0.10, trend: 0.15 },
  w1:  { technical: 0.10, momentum: 0.10, smartMoney: 0.55, volume: 0.05, trend: 0.20 },
  m1:  { technical: 0.05, momentum: 0.05, smartMoney: 0.65, volume: 0.05, trend: 0.20 },
};

// Per-token weight overrides — tokens where SM signal is dead/unreliable
// kPEPE: zero SM spot activity, only 1 real SM trader on perps (Silk Capital)
// → redistribute SM weight to technical + momentum + trend
const TOKEN_WEIGHT_OVERRIDES: Record<string, typeof HORIZON_WEIGHTS> = {
  kPEPE: {
    h1:  { technical: 0.40, momentum: 0.30, smartMoney: 0.00, volume: 0.15, trend: 0.15 },
    h4:  { technical: 0.35, momentum: 0.30, smartMoney: 0.00, volume: 0.15, trend: 0.20 },
    h12: { technical: 0.30, momentum: 0.25, smartMoney: 0.00, volume: 0.15, trend: 0.30 },
    w1:  { technical: 0.25, momentum: 0.20, smartMoney: 0.00, volume: 0.15, trend: 0.40 },
    m1:  { technical: 0.20, momentum: 0.15, smartMoney: 0.00, volume: 0.15, trend: 0.50 },
  },
};

export class HybridPredictor {
  private technicalIndicators: TechnicalIndicators;
  private nansenFeatures: NansenFeatures;
  private xgboost: XGBoostPredictor;
  private modelPath = '/tmp/hybrid_model_state.json';

  // Default weights (can be tuned)
  private weights: ModelWeights = {
    technical: 0.20,
    momentum: 0.15,
    smartMoney: 0.40,  // Highest weight - our edge
    volume: 0.10,
    trend: 0.15,
  };

  // XGBoost blending weight (conservative start)
  private xgbWeight = 0.30;

  // Historical accuracy tracking
  private accuracyHistory: Map<string, { hits: number; total: number }> = new Map();

  constructor() {
    this.technicalIndicators = new TechnicalIndicators();
    this.nansenFeatures = new NansenFeatures();
    this.xgboost = new XGBoostPredictor();
    // Load model state asynchronously (fire and forget)
    this.loadModelState().catch(() => {});
  }

  /**
   * Main prediction method
   */
  async predict(token: string, ohlcvData: OHLCVData[]): Promise<PredictionResult> {
    const currentPrice = ohlcvData[ohlcvData.length - 1].close;

    // 1. Calculate technical features
    const techFeatures = this.technicalIndicators.calculate(ohlcvData);
    const latestTech = techFeatures[techFeatures.length - 1];

    // 2. Get Nansen on-chain features
    const nansenData = await this.nansenFeatures.getAllFeatures(token);

    // 3. Calculate individual signals
    const signals = this.calculateSignals(latestTech, nansenData.smPosition, ohlcvData);

    // 4. Combine signals with weights
    let combinedSignal = this.combineSignals(signals);

    // 4.5 XGBoost blending
    // Build feature vector: 11 technical + 11 nansen + 8 extra
    const normalizedTech = this.technicalIndicators.normalize(latestTech);
    const featureVector = [
      ...normalizedTech,           // 11 features
      ...nansenData.normalized,    // 11 features
      ...this.getExtraFeatures(),  // 8 features (funding, OI, time, vol)
    ];

    // Try to reload XGBoost models periodically
    await this.xgboost.reload();

    const xgbPred = this.xgboost.getBestPrediction(token, featureVector);
    let xgbBlendInfo: { direction: string; confidence: number; horizon: string } | null = null;

    if (xgbPred) {
      const xgbSignal = xgbPred.direction === 'LONG' ? 0.8
                       : xgbPred.direction === 'SHORT' ? -0.8
                       : 0;
      const prevSignal = combinedSignal;
      combinedSignal = combinedSignal * (1 - this.xgbWeight) + xgbSignal * this.xgbWeight * (xgbPred.confidence / 100);
      xgbBlendInfo = { direction: xgbPred.direction, confidence: xgbPred.confidence, horizon: xgbPred.horizon };
      console.log(`[HybridPredictor] ${token} XGBoost blend: ${xgbPred.direction} (${xgbPred.confidence.toFixed(1)}%, ${xgbPred.horizon}) | signal: ${prevSignal.toFixed(3)} → ${combinedSignal.toFixed(3)}`);
    }

    // 5. Calculate predictions for different timeframes (pass raw signals for per-horizon weighting)
    const predictions = this.calculatePredictions(currentPrice, combinedSignal, latestTech, ohlcvData, signals, token);

    // 6. Determine overall direction and confidence
    const direction = this.getDirection(combinedSignal);
    const confidence = Math.abs(combinedSignal) * 100;

    // 7. Identify key factors
    const keyFactors = this.identifyKeyFactors(signals, nansenData.smPosition);

    const result: PredictionResult = {
      token,
      currentPrice,
      predictions,
      direction,
      confidence: Math.min(confidence, 95),
      signals,
      keyFactors,
      timestamp: Date.now(),
    };

    // Save prediction for later verification
    await this.savePrediction(result);

    return result;
  }

  /**
   * Calculate individual signal components
   */
  private calculateSignals(
    tech: TechnicalFeatures,
    sm: SmartMoneyPosition | null,
    ohlcv: OHLCVData[]
  ): { technical: number; momentum: number; smartMoney: number; volume: number } {

    // Technical Signal: RSI + MACD + BB position
    let technical = 0;
    // RSI
    if (tech.rsi < 30) technical += 0.3;  // Oversold = bullish
    else if (tech.rsi > 70) technical -= 0.3;  // Overbought = bearish
    else technical += (50 - tech.rsi) / 100;  // Neutral zone

    // MACD
    if (tech.macdHistogram > 0) technical += 0.2;
    else technical -= 0.2;
    if (tech.macdLine > tech.macdSignal) technical += 0.1;
    else technical -= 0.1;

    // Bollinger Bands
    const currentPrice = ohlcv[ohlcv.length - 1].close;
    const bbPosition = (currentPrice - tech.bbLower) / (tech.bbUpper - tech.bbLower);
    if (bbPosition < 0.2) technical += 0.2;  // Near lower band = bullish
    else if (bbPosition > 0.8) technical -= 0.2;  // Near upper band = bearish

    technical = Math.max(-1, Math.min(1, technical));

    // Momentum Signal: Price changes + trend
    let momentum = 0;
    momentum += tech.priceChange1h > 0 ? 0.2 : -0.2;
    momentum += tech.priceChange4h > 0 ? 0.3 : -0.3;
    momentum += tech.priceChange24h > 0 ? 0.2 : -0.2;

    // EMA alignment (trend strength)
    if (currentPrice > tech.ema9 && tech.ema9 > tech.ema21 && tech.ema21 > tech.ema50) {
      momentum += 0.3;  // Strong uptrend
    } else if (currentPrice < tech.ema9 && tech.ema9 < tech.ema21 && tech.ema21 < tech.ema50) {
      momentum -= 0.3;  // Strong downtrend
    }

    momentum = Math.max(-1, Math.min(1, momentum));

    // Smart Money Signal (THE EDGE)
    let smartMoney = 0;
    if (sm) {
      // Primary signal: Long/Short ratio
      if (sm.ratio > 2) smartMoney += 0.5;         // SM heavily long
      else if (sm.ratio > 1.2) smartMoney += 0.25;
      else if (sm.ratio < 0.5) smartMoney -= 0.5;  // SM heavily short
      else if (sm.ratio < 0.83) smartMoney -= 0.25;

      // Conviction amplifier
      const convictionMult = sm.conviction / 100;
      smartMoney *= (0.5 + convictionMult * 0.5);

      // Total position size (confidence in signal)
      const totalPosition = sm.totalLong + sm.totalShort;
      if (totalPosition > 10_000_000) smartMoney *= 1.2;  // High conviction from SM
      else if (totalPosition < 1_000_000) smartMoney *= 0.7;  // Low SM interest
    }

    smartMoney = Math.max(-1, Math.min(1, smartMoney));

    // Volume Signal
    let volume = 0;
    if (tech.volumeRatio > 2) {
      // High volume - trend continuation or reversal
      volume = momentum > 0 ? 0.3 : -0.3;
    } else if (tech.volumeRatio < 0.5) {
      // Low volume - weak move
      volume = 0;
    } else {
      volume = (tech.volumeRatio - 1) * 0.2;
    }

    volume = Math.max(-1, Math.min(1, volume));

    return { technical, momentum, smartMoney, volume };
  }

  /**
   * Combine signals using weighted average
   */
  private combineSignals(signals: { technical: number; momentum: number; smartMoney: number; volume: number }): number {
    const combined =
      signals.technical * this.weights.technical +
      signals.momentum * this.weights.momentum +
      signals.smartMoney * this.weights.smartMoney +
      signals.volume * this.weights.volume;

    // Trend component (based on momentum direction)
    const trendBoost = signals.momentum * this.weights.trend;

    return Math.max(-1, Math.min(1, combined + trendBoost));
  }

  /**
   * Calculate price predictions for different timeframes
   * Uses per-horizon signal weights + mean-reversion for h12+
   */
  private calculatePredictions(
    currentPrice: number,
    signal: number,
    tech: TechnicalFeatures,
    ohlcv: OHLCVData[],
    signals?: { technical: number; momentum: number; smartMoney: number; volume: number },
    token?: string
  ): PredictionResult['predictions'] {
    // Base volatility for scaling predictions
    const volatility = tech.volatility || 2;

    // Calculate trend slope from recent data
    const recentCloses = ohlcv.slice(-24).map(d => d.close);
    const slope = this.calculateSlope(recentCloses);

    // Mean-reversion: RSI-based pull-back factor for h12+
    // Extreme RSI values suggest price will revert, not continue
    const rsiMeanReversion = tech.rsi > 70 ? -(tech.rsi - 50) / 100  // overbought → pull down
                           : tech.rsi < 30 ? -(tech.rsi - 50) / 100  // oversold → pull up
                           : 0;

    const predictions: Record<string, { price: number; change: number; confidence: number }> = {};

    // Use token-specific weight overrides if available (e.g. kPEPE has SM=0)
    const weightsMap = (token && TOKEN_WEIGHT_OVERRIDES[token]) || HORIZON_WEIGHTS;

    for (const hz of PREDICTION_HORIZONS) {
      // Per-horizon signal: re-combine signals with horizon-specific weights
      let hzSignal = signal;  // fallback to combined
      if (signals && weightsMap[hz.key]) {
        const w = weightsMap[hz.key];
        hzSignal = signals.technical * w.technical +
                   signals.momentum * w.momentum +
                   signals.smartMoney * w.smartMoney +
                   signals.volume * w.volume +
                   signals.momentum * w.trend;
        hzSignal = Math.max(-1, Math.min(1, hzSignal));
      }

      // Dampen slope for long horizons (linear extrapolation meaningless beyond 24h)
      const effectiveSlope = hz.hours <= 24
        ? slope * hz.hours
        : slope * 24 * Math.log2(hz.hours / 24 + 1);

      // Mean-reversion kicks in for h12+ (short-term momentum is valid, long-term reverts)
      const meanRevFactor = hz.hours >= 12
        ? rsiMeanReversion * volatility * Math.min(hz.hours / 12, 3)
        : 0;

      const change = hzSignal * volatility * hz.multiplier + effectiveSlope + meanRevFactor;
      const price = currentPrice * (1 + change / 100);
      const confidence = Math.min(hz.confMax, hz.confBase + Math.abs(hzSignal) * hz.confScale);
      predictions[hz.key] = { price, change, confidence };
    }

    return predictions;
  }

  /**
   * Calculate linear slope of price data
   */
  private calculateSlope(prices: number[]): number {
    const n = prices.length;
    if (n < 2) return 0;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += prices[i];
      sumXY += i * prices[i];
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const avgPrice = sumY / n;

    // Return slope as percentage per period
    return (slope / avgPrice) * 100;
  }

  /**
   * Get direction label from combined signal
   */
  private getDirection(signal: number): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
    if (signal > 0.15) return 'BULLISH';
    if (signal < -0.15) return 'BEARISH';
    return 'NEUTRAL';
  }

  /**
   * Identify key factors driving the prediction
   */
  private identifyKeyFactors(
    signals: { technical: number; momentum: number; smartMoney: number; volume: number },
    sm: SmartMoneyPosition | null
  ): string[] {
    const factors: string[] = [];

    // Smart Money
    if (sm) {
      if (sm.ratio > 2) factors.push(`SM ${sm.ratio.toFixed(1)}x LONG ($${(sm.totalLong/1e6).toFixed(1)}M)`);
      else if (sm.ratio < 0.5) factors.push(`SM ${(1/sm.ratio).toFixed(1)}x SHORT ($${(sm.totalShort/1e6).toFixed(1)}M)`);
    }

    // Technical
    if (Math.abs(signals.technical) > 0.3) {
      factors.push(signals.technical > 0 ? 'Technical: BULLISH' : 'Technical: BEARISH');
    }

    // Momentum
    if (Math.abs(signals.momentum) > 0.3) {
      factors.push(signals.momentum > 0 ? 'Strong uptrend' : 'Strong downtrend');
    }

    // Volume
    if (Math.abs(signals.volume) > 0.2) {
      factors.push(signals.volume > 0 ? 'High volume buying' : 'High volume selling');
    }

    return factors.slice(0, 4);  // Max 4 factors
  }

  /**
   * Save prediction for later verification
   */
  private async savePrediction(result: PredictionResult): Promise<void> {
    try {
      const filePath = `/tmp/predictions_${result.token}.json`;
      let predictions: PredictionResult[] = [];

      try {
        const existing = await fsp.readFile(filePath, 'utf-8');
        predictions = JSON.parse(existing);
      } catch {
        // File doesn't exist, start fresh
      }

      predictions.push(result);

      // Keep only last 100 predictions
      if (predictions.length > 100) {
        predictions = predictions.slice(-100);
      }

      await fsp.writeFile(filePath, JSON.stringify(predictions, null, 2));
    } catch (error) {
      console.error('[HybridPredictor] Error saving prediction:', error);
    }
  }

  /**
   * Verify past predictions using retrospective method:
   * For each prediction, find the nearest stored prediction at targetAge to get the actual price.
   * This eliminates the ±10% window problem — ALL old predictions get verified.
   */
  async verifyPredictions(token: string, currentPrice: number): Promise<Record<string, { accuracy: number; total: number }>> {
    const HOUR = 3600000;

    const VERIFY_CONFIG: Record<string, { ageHours: number; errorThreshold: number }> = {
      h1:  { ageHours: 1,   errorThreshold: 2 },
      h4:  { ageHours: 4,   errorThreshold: 4 },
      h12: { ageHours: 12,  errorThreshold: 8 },
      w1:  { ageHours: 168, errorThreshold: 15 },
      m1:  { ageHours: 720, errorThreshold: 25 },
    };

    const emptyResult: Record<string, { accuracy: number; total: number }> = { direction: { accuracy: 0, total: 0 } };
    for (const key of Object.keys(VERIFY_CONFIG)) {
      emptyResult[key] = { accuracy: 0, total: 0 };
    }

    try {
      const filePath = `/tmp/predictions_${token}.json`;
      const data = await fsp.readFile(filePath, 'utf-8');
      const predictions: PredictionResult[] = JSON.parse(data);

      if (predictions.length < 5) return emptyResult;

      // Build time→price map from all stored predictions (each has currentPrice at time of creation)
      const timePrices = predictions.map(p => ({ ts: p.timestamp, price: p.currentPrice }));
      timePrices.sort((a, b) => a.ts - b.ts);

      // Helper: find actual price at a target timestamp (nearest prediction within 2h tolerance)
      const getPriceAt = (targetMs: number): number | null => {
        let best: typeof timePrices[0] | null = null;
        let bestDist = Infinity;
        for (const tp of timePrices) {
          const dist = Math.abs(tp.ts - targetMs);
          if (dist < bestDist) { bestDist = dist; best = tp; }
        }
        // Also consider currentPrice for the most recent check
        const distToNow = Math.abs(targetMs - Date.now());
        if (distToNow < bestDist && currentPrice > 0) {
          return currentPrice;
        }
        if (best && bestDist < 2 * HOUR) return best.price;
        return null;
      };

      const results: Record<string, { hits: number; total: number; dirHits: number; dirTotal: number }> = {};
      for (const key of Object.keys(VERIFY_CONFIG)) {
        results[key] = { hits: 0, total: 0, dirHits: 0, dirTotal: 0 };
      }
      results.direction = { hits: 0, total: 0, dirHits: 0, dirTotal: 0 };

      for (const pred of predictions) {
        for (const [hz, cfg] of Object.entries(VERIFY_CONFIG)) {
          const predData = pred.predictions[hz];
          if (!predData) continue;

          const targetMs = pred.timestamp + cfg.ageHours * HOUR;
          const actualPrice = getPriceAt(targetMs);
          if (actualPrice === null) continue;

          results[hz].total++;
          const error = Math.abs(actualPrice - predData.price) / predData.price * 100;
          if (error < cfg.errorThreshold) results[hz].hits++;

          // Direction accuracy
          const predictedUp = predData.change > 0;
          const actualUp = actualPrice > pred.currentPrice;
          const actualFlat = Math.abs(actualPrice - pred.currentPrice) / pred.currentPrice < 0.001;  // <0.1% = flat
          if (!actualFlat) {
            results[hz].dirHits += (predictedUp === actualUp) ? 1 : 0;
            results[hz].dirTotal++;
          }
        }
      }

      // Aggregate direction accuracy across h1+h4 (most reliable)
      results.direction.total = (results.h1?.dirTotal || 0) + (results.h4?.dirTotal || 0);
      results.direction.hits = (results.h1?.dirHits || 0) + (results.h4?.dirHits || 0);

      const result: Record<string, { accuracy: number; total: number; directionAccuracy?: number; directionTotal?: number }> = {};
      for (const [key, r] of Object.entries(results)) {
        result[key] = {
          accuracy: r.total > 0 ? r.hits / r.total * 100 : 0,
          total: r.total,
          directionAccuracy: r.dirTotal > 0 ? r.dirHits / r.dirTotal * 100 : 0,
          directionTotal: r.dirTotal,
        };
      }
      return result;
    } catch (error) {
      return emptyResult;
    }
  }

  /**
   * Update model weights based on accuracy (simple online learning)
   */
  async updateWeights(token: string, currentPrice?: number): Promise<void> {
    const price = currentPrice || 0;
    const accuracy = await this.verifyPredictions(token, price);

    // Use direction accuracy from combined h1+h4
    const dirEntry = accuracy.direction as any;
    const dirAcc = dirEntry?.directionAccuracy ?? dirEntry?.accuracy ?? 0;
    const dirTotal = dirEntry?.directionTotal ?? dirEntry?.total ?? 0;

    if (dirAcc > 60 && dirTotal > 10) {
      this.weights.smartMoney = Math.min(0.5, this.weights.smartMoney + 0.02);
    } else if (dirAcc < 40 && dirTotal > 10) {
      this.weights.smartMoney = Math.max(0.2, this.weights.smartMoney - 0.02);
    }

    await this.saveModelState();
  }

  /**
   * Save model state to file
   */
  private async saveModelState(): Promise<void> {
    try {
      await fsp.writeFile(this.modelPath, JSON.stringify({
        weights: this.weights,
        timestamp: Date.now(),
      }, null, 2));
    } catch (error) {
      console.error('[HybridPredictor] Error saving model state:', error);
    }
  }

  /**
   * Load model state from file
   */
  private async loadModelState(): Promise<void> {
    try {
      const data = await fsp.readFile(this.modelPath, 'utf-8');
      const state = JSON.parse(data);
      if (state.weights) {
        this.weights = state.weights;
        console.log('[HybridPredictor] Loaded model weights:', this.weights);
      }
    } catch {
      console.log('[HybridPredictor] Using default weights');
    }
  }

  /**
   * Get current model weights
   */
  getWeights(): ModelWeights {
    return { ...this.weights };
  }

  /**
   * Set custom weights
   */
  setWeights(weights: Partial<ModelWeights>): void {
    this.weights = { ...this.weights, ...weights };
  }

  /**
   * Get the XGBoost predictor instance (for direct queries and status)
   */
  getXGBoost(): XGBoostPredictor {
    return this.xgboost;
  }

  /**
   * Compute 8 extra features for XGBoost (funding, OI change, time cyclical, volatility).
   * Returns placeholder values — real values come from the Python collector.
   * For live inference, we use what we can compute in TypeScript.
   */
  private getExtraFeatures(): number[] {
    const now = new Date();
    const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
    const dow = now.getUTCDay();

    return [
      0,                                           // funding_rate (not easily available in TS)
      0,                                           // oi_change_1h (would need snapshots)
      0,                                           // oi_change_4h (would need snapshots)
      Math.sin(2 * Math.PI * hour / 24),           // hour_sin
      Math.cos(2 * Math.PI * hour / 24),           // hour_cos
      Math.sin(2 * Math.PI * dow / 7),             // day_sin
      Math.cos(2 * Math.PI * dow / 7),             // day_cos
      0,                                           // volatility_24h (computed in technical)
    ];
  }
}
