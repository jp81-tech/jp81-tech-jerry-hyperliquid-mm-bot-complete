/**
 * Nansen On-Chain Features for Price Prediction
 * Integrates with existing Nansen API infrastructure
 */

import { promises as fsp } from 'fs';

export interface NansenFlowData {
  smartMoneyNetflow: number;
  smartMoneyRatio: number;
  exchangeNetflow: number;
  exchangeRatio: number;
  freshWalletNetflow: number;
  freshWalletRatio: number;
  whaleNetflow: number;
  whaleRatio: number;
  topPnlNetflow: number;
  topPnlRatio: number;
  timestamp: number;
}

export interface SmartMoneyPosition {
  totalLong: number;
  totalShort: number;
  ratio: number;         // long/short ratio
  dominantSide: 'LONG' | 'SHORT' | 'NEUTRAL';
  conviction: number;    // 0-100
  topTraders: { address: string; pnl: number; position: number }[];
}

export class NansenFeatures {
  private cacheDir = '/tmp';
  private cacheDuration = 5 * 60 * 1000; // 5 minutes

  /**
   * Load Smart Money data from whale_tracker.py output
   * File: /tmp/smart_money_data.json
   * Structure: { timestamp, source, data: { TOKEN: { current_longs_usd, current_shorts_usd, trading_mode_confidence, ... } } }
   */
  async getSmartMoneyPositions(token: string): Promise<SmartMoneyPosition | null> {
    try {
      const data = await fsp.readFile(`${this.cacheDir}/smart_money_data.json`, 'utf-8');
      const parsed = JSON.parse(data);

      const tokenData = parsed.data?.[token];
      if (!tokenData) {
        console.log(`[NansenFeatures] No SM data for ${token}`);
        return null;
      }

      const totalLong = tokenData.current_longs_usd || 0;
      const totalShort = tokenData.current_shorts_usd || 0;
      const ratio = totalShort > 0 ? totalLong / totalShort : (totalLong > 0 ? 10 : 1);

      let dominantSide: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
      if (ratio > 1.5) dominantSide = 'LONG';
      else if (ratio < 0.67) dominantSide = 'SHORT';

      // Use whale_tracker's own confidence when available, otherwise calculate from ratio
      const conviction = tokenData.trading_mode_confidence != null
        ? tokenData.trading_mode_confidence
        : Math.min(Math.abs(Math.log(ratio)) * 30, 100);

      return {
        totalLong,
        totalShort,
        ratio,
        dominantSide,
        conviction,
        topTraders: [],
      };
    } catch (error) {
      console.error(`[NansenFeatures] Error loading SM data:`, error);
      return null;
    }
  }

  /**
   * Load Nansen bias data
   * File: /tmp/nansen_bias.json
   * Structure: { TOKEN: { boost: 0-2, direction: "short"|"long"|"neutral", tradingModeConfidence: 0-95, ... } }
   */
  async getNansenBias(token: string): Promise<{ bias: number; confidence: number } | null> {
    try {
      const data = await fsp.readFile(`${this.cacheDir}/nansen_bias.json`, 'utf-8');
      const parsed = JSON.parse(data);

      const tokenBias = parsed[token];
      if (!tokenBias) return null;

      // Derive bias (-1 to +1) from direction + boost
      const boost = Math.min(tokenBias.boost || 0, 1); // cap at 1.0
      let bias = 0;
      if (tokenBias.direction === 'short') bias = -boost;
      else if (tokenBias.direction === 'long') bias = boost;

      return {
        bias,
        confidence: tokenBias.tradingModeConfidence || 0,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Load MM Signal State
   * File: /tmp/nansen_mm_signal_state.json
   */
  async getSignalState(token: string): Promise<{ signal: string; timestamp: number } | null> {
    try {
      const data = await fsp.readFile(`${this.cacheDir}/nansen_mm_signal_state.json`, 'utf-8');
      const parsed = JSON.parse(data);

      return {
        signal: parsed[token]?.combinedSignal || 'NONE',
        timestamp: parsed[token]?.timestamp || Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get all Nansen features for a token
   */
  async getAllFeatures(token: string): Promise<{
    smPosition: SmartMoneyPosition | null;
    bias: { bias: number; confidence: number } | null;
    signal: { signal: string; timestamp: number } | null;
    normalized: number[];
  }> {
    const [smPosition, bias, signal] = await Promise.all([
      this.getSmartMoneyPositions(token),
      this.getNansenBias(token),
      this.getSignalState(token),
    ]);

    // Normalize to feature vector
    const normalized = this.normalize(smPosition, bias, signal);

    return {
      smPosition,
      bias,
      signal,
      normalized,
    };
  }

  /**
   * Normalize Nansen features to [0, 1] or [-1, 1] range
   */
  private normalize(
    sm: SmartMoneyPosition | null,
    bias: { bias: number; confidence: number } | null,
    signal: { signal: string; timestamp: number } | null
  ): number[] {
    // SM Position features
    const smRatio = sm ? Math.tanh(Math.log(sm.ratio || 1)) : 0;  // Log ratio, then tanh
    const smConviction = sm ? sm.conviction / 100 : 0;
    const smLongUsd = sm ? Math.tanh(sm.totalLong / 10_000_000) : 0;  // Normalize to ~$10M
    const smShortUsd = sm ? Math.tanh(sm.totalShort / 10_000_000) : 0;

    // Bias features
    const biasValue = bias ? bias.bias : 0;  // Already [-1, 1]
    const biasConfidence = bias ? bias.confidence / 100 : 0;

    // Signal features (one-hot encoding)
    const signalGreen = signal?.signal === 'GREEN' ? 1 : 0;
    const signalYellow = signal?.signal === 'YELLOW' ? 1 : 0;
    const signalRed = signal?.signal === 'RED' ? 1 : 0;

    // SM dominant side (one-hot)
    const smLong = sm?.dominantSide === 'LONG' ? 1 : 0;
    const smShort = sm?.dominantSide === 'SHORT' ? 1 : 0;

    return [
      smRatio,          // SM long/short ratio (normalized)
      smConviction,     // SM conviction score
      smLongUsd,        // Total SM long USD (normalized)
      smShortUsd,       // Total SM short USD (normalized)
      biasValue,        // Nansen bias
      biasConfidence,   // Bias confidence
      signalGreen,      // Signal = GREEN
      signalYellow,     // Signal = YELLOW
      signalRed,        // Signal = RED
      smLong,           // SM dominant = LONG
      smShort,          // SM dominant = SHORT
    ];
  }

  /**
   * Get feature names for explainability
   */
  getFeatureNames(): string[] {
    return [
      'sm_ratio',
      'sm_conviction',
      'sm_long_usd',
      'sm_short_usd',
      'nansen_bias',
      'bias_confidence',
      'signal_green',
      'signal_yellow',
      'signal_red',
      'sm_dominant_long',
      'sm_dominant_short',
    ];
  }
}
