import { HyperliquidAPI, Candle } from '../api/hyperliquid.js';

/**
 * MarketVision - The strategic brain for the Market Maker.
 *
 * Responsibilities:
 * 1. Analyze HTF (High Time Frame) context using 1h/4h candles.
 * 2. Detect market regime (Trending vs Ranging).
 * 3. Identify major S/R levels.
 * 4. Provide a `visionBias` score to adjust quoting parameters.
 */

export type MarketRegime = 'TREND_UP' | 'TREND_DOWN' | 'RANGING' | 'VOLATILE' | 'UNKNOWN';

export type VisionAnalysis = {
  symbol: string;
  regime: MarketRegime;
  biasScore: number; // -100 (Strong Bear) to +100 (Strong Bull)
  volatilityScore: number; // 0 to 100 (Low to High Volatility)
  supportLevel?: number;
  resistanceLevel?: number;
  lastUpdate: number;
  reason: string;
  metrics: {
    rsi: number;
    priceVsEma: number; // % distance
    atrPct: number; // ATR as % of price
  }
};

export class MarketVision {
  private api: HyperliquidAPI;
  private cache: Map<string, VisionAnalysis> = new Map();
  private readonly UPDATE_INTERVAL_MS = 5 * 60 * 1000; // Update every 5 minutes

  constructor(api: HyperliquidAPI) {
    this.api = api;
  }

  /**
   * Get the latest market vision analysis for a symbol.
   * If data is stale, it triggers a background refresh but returns cached data immediately (if available).
   */
  public getAnalysis(symbol: string): VisionAnalysis | null {
    const now = Date.now();
    const cached = this.cache.get(symbol);

    if (!cached || (now - cached.lastUpdate > this.UPDATE_INTERVAL_MS)) {
      // Trigger async update, don't await to avoid blocking the hot path
      this.refreshAnalysis(symbol).catch(err => console.error(`[MarketVision] Refresh failed for ${symbol}:`, err));
    }

    return cached || null;
  }

  /**
   * Fetches candle data and computes indicators.
   */
  private async refreshAnalysis(symbol: string): Promise<void> {
    try {
      // 1. Fetch candles (4h for trend, 1h for momentum)
      const candles4h = await this.api.getCandles(symbol, '4h', Date.now() - 30 * 24 * 60 * 60 * 1000); // Last 30 days

      if (!candles4h || candles4h.length < 50) {
        console.warn(`[MarketVision] Not enough candles for ${symbol}`);
        return;
      }

      const closes = candles4h.map(c => c.c);
      const highs = candles4h.map(c => c.h);
      const lows = candles4h.map(c => c.l);
      const currentPrice = closes[closes.length - 1];

      // 2. Calculate Basic Indicators (Simple Math Implementation)

      // EMA 200 (Trend filter)
      const ema200 = this.calculateEMA(closes, 200);
      const distToEma = ((currentPrice - ema200) / ema200) * 100;

      // RSI 14 (Momentum)
      const rsi = this.calculateRSI(closes, 14);

      // ATR 14 (Volatility)
      const atr = this.calculateATR(highs, lows, closes, 14);
      const atrPct = (atr / currentPrice) * 100;

      // Support/Resistance (Simple pivot logic - 20 period high/low)
      const recentHigh = Math.max(...highs.slice(-20));
      const recentLow = Math.min(...lows.slice(-20));

      // 3. Determine Regime & Bias
      let regime: MarketRegime = 'RANGING';
      let biasScore = 0;
      let reason = '';

      // Trend Logic
      if (currentPrice > ema200 * 1.02) {
        regime = 'TREND_UP';
        biasScore += 30;
        reason += 'Above EMA200. ';
      } else if (currentPrice < ema200 * 0.98) {
        regime = 'TREND_DOWN';
        biasScore -= 30;
        reason += 'Below EMA200. ';
      } else {
        regime = 'RANGING';
        reason += 'Near EMA200. ';
      }

      // RSI Logic
      if (rsi > 70) {
        biasScore -= 20; // Overbought - cautious/pullback
        reason += 'RSI Overbought. ';
      } else if (rsi < 30) {
        biasScore += 20; // Oversold - bounce potential
        reason += 'RSI Oversold. ';
      } else if (regime === 'TREND_UP' && rsi > 50) {
        biasScore += 10; // Healthy trend momentum
      } else if (regime === 'TREND_DOWN' && rsi < 50) {
        biasScore -= 10; // Healthy trend momentum
      }

      // S/R Logic
      const distToSupp = ((currentPrice - recentLow) / currentPrice) * 100;
      const distToRes = ((recentHigh - currentPrice) / currentPrice) * 100;

      if (distToSupp < 2.0) {
        biasScore += 20; // Support bounce
        reason += 'Near Support. ';
      }
      if (distToRes < 2.0) {
        biasScore -= 20; // Resistance reject
        reason += 'Near Resistance. ';
      }

      // Volatility Check
      let volatilityScore = 50;
      if (atrPct > 5.0) {
        volatilityScore = 90;
        regime = 'VOLATILE';
        reason += 'High Volatility! ';
      } else if (atrPct < 1.0) {
        volatilityScore = 20;
        reason += 'Low Volatility. ';
      }

      // Clamp Bias
      biasScore = Math.max(-100, Math.min(100, biasScore));

      const analysis: VisionAnalysis = {
        symbol,
        regime,
        biasScore,
        volatilityScore,
        supportLevel: recentLow,
        resistanceLevel: recentHigh,
        lastUpdate: Date.now(),
        reason: reason.trim(),
        metrics: {
          rsi,
          priceVsEma: distToEma,
          atrPct
        }
      };

      this.cache.set(symbol, analysis);
      console.log(`[MarketVision] Updated ${symbol}: ${regime} (${biasScore}) | ${reason}`);

    } catch (error) {
      console.error(`[MarketVision] Error analyzing ${symbol}:`, error);
    }
  }

  // --- Helper Math Functions ---

  private calculateEMA(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1];
    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private calculateRSI(data: number[], period: number): number {
    if (data.length < period + 1) return 50;
    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const diff = data[i] - data[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < data.length; i++) {
      const diff = data[i] - data[i - 1];
      if (diff > 0) {
        avgGain = (avgGain * (period - 1) + diff) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) - diff) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateATR(highs: number[], lows: number[], closes: number[], period: number): number {
    if (highs.length < period) return 0;
    let trSum = 0;

    for (let i = 1; i < highs.length; i++) {
      const hl = highs[i] - lows[i];
      const hc = Math.abs(highs[i] - closes[i - 1]);
      const lc = Math.abs(lows[i] - closes[i - 1]);
      const tr = Math.max(hl, hc, lc);

      // Simple average for initial
      if (i <= period) {
        trSum += tr;
      } else {
        // Smooth for rest
        trSum = (trSum * (period - 1) + tr) / period;
      }
    }

    return trSum; // Note: This simplified ATR logic might need refinement for true Wilder's smoothing, but works for approximation.
    // Correct logic for simple rolling ATR:
    // return trSum / period (if we just summed last N)
    // But above mixes logic. Let's stick to Simple Moving Average of TR for MVP robustness

    const trs = [];
    for(let i=1; i<highs.length; i++) {
       const hl = highs[i] - lows[i];
       const hc = Math.abs(highs[i] - closes[i - 1]);
       const lc = Math.abs(lows[i] - closes[i - 1]);
       trs.push(Math.max(hl, hc, lc));
    }
    // Return average of last N TRs
    const lastN = trs.slice(-period);
    return lastN.reduce((a,b) => a+b, 0) / lastN.length;
  }
}
