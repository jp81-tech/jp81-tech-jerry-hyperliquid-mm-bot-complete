/**
 * Technical Indicators for Price Prediction
 * Calculates RSI, MACD, EMA, Bollinger Bands, ATR
 */

export interface OHLCVData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalFeatures {
  rsi: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  ema9: number;
  ema21: number;
  ema50: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbWidth: number;
  atr: number;
  priceChange1h: number;
  priceChange4h: number;
  priceChange24h: number;
  volumeRatio: number;
  volatility: number;
}

export class TechnicalIndicators {

  /**
   * Calculate RSI (Relative Strength Index)
   */
  private calculateRSI(closes: number[], period: number = 14): number[] {
    const rsi: number[] = [];
    let gains = 0;
    let losses = 0;

    // First RSI value
    for (let i = 1; i <= period; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;
    rsi.push(100 - (100 / (1 + avgGain / (avgLoss || 0.0001))));

    // Subsequent RSI values
    for (let i = period + 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? -change : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      rsi.push(100 - (100 / (1 + avgGain / (avgLoss || 0.0001))));
    }

    return rsi;
  }

  /**
   * Calculate EMA (Exponential Moving Average)
   */
  private calculateEMA(data: number[], period: number): number[] {
    const ema: number[] = [];
    const multiplier = 2 / (period + 1);

    // First EMA is SMA
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += data[i];
    }
    ema.push(sum / period);

    // Subsequent EMAs
    for (let i = period; i < data.length; i++) {
      ema.push((data[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1]);
    }

    return ema;
  }

  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   */
  private calculateMACD(closes: number[]): { line: number[]; signal: number[]; histogram: number[] } {
    const ema12 = this.calculateEMA(closes, 12);
    const ema26 = this.calculateEMA(closes, 26);

    // MACD Line = EMA12 - EMA26
    const macdLine: number[] = [];
    const offset = ema12.length - ema26.length;
    for (let i = 0; i < ema26.length; i++) {
      macdLine.push(ema12[i + offset] - ema26[i]);
    }

    // Signal Line = 9-period EMA of MACD Line
    const signal = this.calculateEMA(macdLine, 9);

    // Histogram = MACD Line - Signal Line
    const histogram: number[] = [];
    const sigOffset = macdLine.length - signal.length;
    for (let i = 0; i < signal.length; i++) {
      histogram.push(macdLine[i + sigOffset] - signal[i]);
    }

    return { line: macdLine, signal, histogram };
  }

  /**
   * Calculate Bollinger Bands
   */
  private calculateBollingerBands(closes: number[], period: number = 20, stdDev: number = 2): { upper: number[]; middle: number[]; lower: number[] } {
    const upper: number[] = [];
    const middle: number[] = [];
    const lower: number[] = [];

    for (let i = period - 1; i < closes.length; i++) {
      const slice = closes.slice(i - period + 1, i + 1);
      const sma = slice.reduce((a, b) => a + b, 0) / period;
      const variance = slice.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
      const std = Math.sqrt(variance);

      middle.push(sma);
      upper.push(sma + stdDev * std);
      lower.push(sma - stdDev * std);
    }

    return { upper, middle, lower };
  }

  /**
   * Calculate ATR (Average True Range)
   */
  private calculateATR(highs: number[], lows: number[], closes: number[], period: number = 14): number[] {
    const trueRanges: number[] = [];

    for (let i = 1; i < closes.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trueRanges.push(tr);
    }

    // ATR is EMA of True Range
    return this.calculateEMA(trueRanges, period);
  }

  /**
   * Calculate rolling volatility (standard deviation of returns)
   */
  private calculateVolatility(closes: number[], period: number = 24): number[] {
    const volatility: number[] = [];
    const returns: number[] = [];

    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }

    for (let i = period - 1; i < returns.length; i++) {
      const slice = returns.slice(i - period + 1, i + 1);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
      volatility.push(Math.sqrt(variance) * 100); // As percentage
    }

    return volatility;
  }

  /**
   * Calculate all technical features for a dataset
   */
  calculate(data: OHLCVData[]): TechnicalFeatures[] {
    if (data.length < 60) {
      console.warn('[TechnicalIndicators] Need at least 60 data points');
      return [];
    }

    const closes = data.map(d => d.close);
    const highs = data.map(d => d.high);
    const lows = data.map(d => d.low);
    const volumes = data.map(d => d.volume);

    // Calculate indicators
    const rsi = this.calculateRSI(closes, 14);
    const macd = this.calculateMACD(closes);
    const ema9 = this.calculateEMA(closes, 9);
    const ema21 = this.calculateEMA(closes, 21);
    const ema50 = this.calculateEMA(closes, 50);
    const bb = this.calculateBollingerBands(closes, 20, 2);
    const atr = this.calculateATR(highs, lows, closes, 14);
    const volatility = this.calculateVolatility(closes, 24);

    // Average volume for ratio calculation
    const avgVolume = volumes.slice(-24).reduce((a, b) => a + b, 0) / 24;

    // Build features array (aligned to the end)
    const features: TechnicalFeatures[] = [];
    const startIndex = 50; // Need 50 points for EMA50

    for (let i = startIndex; i < data.length; i++) {
      // Index offsets for different indicator arrays
      const rsiIdx = i - (closes.length - rsi.length);
      const macdLineIdx = i - (closes.length - macd.line.length);
      const macdSigIdx = i - (closes.length - macd.signal.length);
      const macdHistIdx = i - (closes.length - macd.histogram.length);
      const ema9Idx = i - (closes.length - ema9.length);
      const ema21Idx = i - (closes.length - ema21.length);
      const ema50Idx = i - (closes.length - ema50.length);
      const bbIdx = i - (closes.length - bb.middle.length);
      const atrIdx = i - (closes.length - atr.length);
      const volIdx = i - (closes.length - volatility.length);

      // Price changes
      const priceChange1h = i >= 1 ? (closes[i] - closes[i - 1]) / closes[i - 1] * 100 : 0;
      const priceChange4h = i >= 4 ? (closes[i] - closes[i - 4]) / closes[i - 4] * 100 : 0;
      const priceChange24h = i >= 24 ? (closes[i] - closes[i - 24]) / closes[i - 24] * 100 : 0;

      features.push({
        rsi: rsiIdx >= 0 ? rsi[rsiIdx] : 50,
        macdLine: macdLineIdx >= 0 ? macd.line[macdLineIdx] : 0,
        macdSignal: macdSigIdx >= 0 ? macd.signal[macdSigIdx] : 0,
        macdHistogram: macdHistIdx >= 0 ? macd.histogram[macdHistIdx] : 0,
        ema9: ema9Idx >= 0 ? ema9[ema9Idx] : closes[i],
        ema21: ema21Idx >= 0 ? ema21[ema21Idx] : closes[i],
        ema50: ema50Idx >= 0 ? ema50[ema50Idx] : closes[i],
        bbUpper: bbIdx >= 0 ? bb.upper[bbIdx] : closes[i] * 1.02,
        bbMiddle: bbIdx >= 0 ? bb.middle[bbIdx] : closes[i],
        bbLower: bbIdx >= 0 ? bb.lower[bbIdx] : closes[i] * 0.98,
        bbWidth: bbIdx >= 0 ? (bb.upper[bbIdx] - bb.lower[bbIdx]) / bb.middle[bbIdx] * 100 : 4,
        atr: atrIdx >= 0 ? atr[atrIdx] : 0,
        priceChange1h,
        priceChange4h,
        priceChange24h,
        volumeRatio: avgVolume > 0 ? volumes[i] / avgVolume : 1,
        volatility: volIdx >= 0 ? volatility[volIdx] : 2,
      });
    }

    return features;
  }

  /**
   * Normalize features to [0, 1] range for ML model
   */
  normalize(features: TechnicalFeatures): number[] {
    return [
      features.rsi / 100,                                    // RSI [0-100] -> [0-1]
      Math.tanh(features.macdLine / 100),                   // MACD -> [-1, 1] -> sigmoid
      Math.tanh(features.macdSignal / 100),
      Math.tanh(features.macdHistogram / 100),
      Math.tanh(features.priceChange1h / 10),               // % change -> sigmoid
      Math.tanh(features.priceChange4h / 20),
      Math.tanh(features.priceChange24h / 50),
      Math.min(features.volumeRatio / 5, 1),                // Volume ratio capped at 5x
      Math.min(features.volatility / 10, 1),                // Volatility capped at 10%
      Math.min(features.bbWidth / 20, 1),                   // BB width capped at 20%
      features.atr > 0 ? Math.min(features.atr / features.ema21 * 100, 1) : 0, // ATR as % of price
    ];
  }
}
