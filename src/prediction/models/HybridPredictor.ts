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
  predictions: {
    h1: { price: number; change: number; confidence: number };
    h4: { price: number; change: number; confidence: number };
    h12: { price: number; change: number; confidence: number };
  };
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

    // 5. Calculate predictions for different timeframes
    const predictions = this.calculatePredictions(currentPrice, combinedSignal, latestTech, ohlcvData);

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
   */
  private calculatePredictions(
    currentPrice: number,
    signal: number,
    tech: TechnicalFeatures,
    ohlcv: OHLCVData[]
  ): PredictionResult['predictions'] {
    // Base volatility for scaling predictions
    const volatility = tech.volatility || 2;

    // Calculate trend slope from recent data
    const recentCloses = ohlcv.slice(-24).map(d => d.close);
    const slope = this.calculateSlope(recentCloses);

    // 1h prediction
    const h1Change = signal * volatility * 0.3 + slope * 1;
    const h1Price = currentPrice * (1 + h1Change / 100);
    const h1Confidence = Math.min(80, 50 + Math.abs(signal) * 30);

    // 4h prediction
    const h4Change = signal * volatility * 0.8 + slope * 4;
    const h4Price = currentPrice * (1 + h4Change / 100);
    const h4Confidence = Math.min(70, 45 + Math.abs(signal) * 25);

    // 12h prediction
    const h12Change = signal * volatility * 1.5 + slope * 12;
    const h12Price = currentPrice * (1 + h12Change / 100);
    const h12Confidence = Math.min(60, 40 + Math.abs(signal) * 20);

    return {
      h1: { price: h1Price, change: h1Change, confidence: h1Confidence },
      h4: { price: h4Price, change: h4Change, confidence: h4Confidence },
      h12: { price: h12Price, change: h12Change, confidence: h12Confidence },
    };
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
   * Verify past predictions and update accuracy
   */
  async verifyPredictions(token: string, currentPrice: number): Promise<{
    h1: { accuracy: number; total: number };
    h4: { accuracy: number; total: number };
    h12: { accuracy: number; total: number };
    direction: { accuracy: number; total: number };
  }> {
    const now = Date.now();
    const HOUR = 3600000;

    try {
      const filePath = `/tmp/predictions_${token}.json`;
      const data = await fsp.readFile(filePath, 'utf-8');
      const predictions: (PredictionResult & { verified?: { h1?: boolean; h4?: boolean; h12?: boolean } })[] = JSON.parse(data);

      const results = {
        h1: { hits: 0, total: 0 },
        h4: { hits: 0, total: 0 },
        h12: { hits: 0, total: 0 },
        direction: { hits: 0, total: 0 },
      };

      for (const pred of predictions) {
        if (!pred.verified) pred.verified = {};
        const age = now - pred.timestamp;

        // Verify 1h prediction
        if (age >= 0.9 * HOUR && age <= 1.1 * HOUR && !pred.verified.h1) {
          pred.verified.h1 = true;
          results.h1.total++;
          const error = Math.abs(currentPrice - pred.predictions.h1.price) / pred.predictions.h1.price * 100;
          if (error < 2) results.h1.hits++;

          // Direction accuracy
          results.direction.total++;
          const predictedDir = pred.predictions.h1.change > 0;
          const actualDir = currentPrice > pred.currentPrice;
          if (predictedDir === actualDir) results.direction.hits++;
        }

        // Verify 4h prediction
        if (age >= 3.9 * HOUR && age <= 4.1 * HOUR && !pred.verified.h4) {
          pred.verified.h4 = true;
          results.h4.total++;
          const error = Math.abs(currentPrice - pred.predictions.h4.price) / pred.predictions.h4.price * 100;
          if (error < 4) results.h4.hits++;
        }

        // Verify 12h prediction
        if (age >= 11.9 * HOUR && age <= 12.1 * HOUR && !pred.verified.h12) {
          pred.verified.h12 = true;
          results.h12.total++;
          const error = Math.abs(currentPrice - pred.predictions.h12.price) / pred.predictions.h12.price * 100;
          if (error < 8) results.h12.hits++;
        }
      }

      // Save updated predictions with verification flags
      await fsp.writeFile(filePath, JSON.stringify(predictions, null, 2));

      return {
        h1: { accuracy: results.h1.total > 0 ? results.h1.hits / results.h1.total * 100 : 0, total: results.h1.total },
        h4: { accuracy: results.h4.total > 0 ? results.h4.hits / results.h4.total * 100 : 0, total: results.h4.total },
        h12: { accuracy: results.h12.total > 0 ? results.h12.hits / results.h12.total * 100 : 0, total: results.h12.total },
        direction: { accuracy: results.direction.total > 0 ? results.direction.hits / results.direction.total * 100 : 0, total: results.direction.total },
      };
    } catch (error) {
      return {
        h1: { accuracy: 0, total: 0 },
        h4: { accuracy: 0, total: 0 },
        h12: { accuracy: 0, total: 0 },
        direction: { accuracy: 0, total: 0 },
      };
    }
  }

  /**
   * Update model weights based on accuracy (simple online learning)
   */
  async updateWeights(token: string): Promise<void> {
    const accuracy = await this.verifyPredictions(token, 0);

    // If direction accuracy is high, boost SM weight (our edge)
    if (accuracy.direction.accuracy > 60 && accuracy.direction.total > 10) {
      this.weights.smartMoney = Math.min(0.5, this.weights.smartMoney + 0.02);
    } else if (accuracy.direction.accuracy < 40 && accuracy.direction.total > 10) {
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
