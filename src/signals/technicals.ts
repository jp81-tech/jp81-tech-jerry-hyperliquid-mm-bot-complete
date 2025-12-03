import { EMA, RSI, ATR } from 'technicalindicators';
import { Candle } from '../api/hyperliquid.js';

export class Technicals {
  static calculateEMA(candles: Candle[], period: number): number[] {
    const closePrices = candles.map(c => c.c);
    return EMA.calculate({ period, values: closePrices });
  }

  static calculateRSI(candles: Candle[], period: number): number[] {
    const closePrices = candles.map(c => c.c);
    return RSI.calculate({ period, values: closePrices });
  }

  static calculateATR(candles: Candle[], period: number): number[] {
    const high = candles.map(c => c.h);
    const low = candles.map(c => c.l);
    const close = candles.map(c => c.c);
    return ATR.calculate({ period, high, low, close });
  }

  static getLatest(values: number[]): number | null {
    return values.length > 0 ? values[values.length - 1] : null;
  }
}



