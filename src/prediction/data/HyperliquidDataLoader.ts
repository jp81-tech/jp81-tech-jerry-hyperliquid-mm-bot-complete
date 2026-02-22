/**
 * Hyperliquid OHLCV Data Loader
 * Fetches candlestick data from Hyperliquid API
 */

import { OHLCVData } from '../features/TechnicalIndicators.js';

export interface CandleInterval {
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  seconds: number;
}

export const INTERVALS: Record<string, CandleInterval> = {
  '1m': { interval: '1m', seconds: 60 },
  '5m': { interval: '5m', seconds: 300 },
  '15m': { interval: '15m', seconds: 900 },
  '1h': { interval: '1h', seconds: 3600 },
  '4h': { interval: '4h', seconds: 14400 },
  '1d': { interval: '1d', seconds: 86400 },
};

export class HyperliquidDataLoader {
  private baseUrl = 'https://api.hyperliquid.xyz/info';
  private cache: Map<string, { data: OHLCVData[]; timestamp: number }> = new Map();
  private cacheDuration = 60 * 1000; // 1 minute cache

  /**
   * Fetch OHLCV candles from Hyperliquid
   */
  async fetchCandles(
    coin: string,
    interval: string = '1h',
    count: number = 100
  ): Promise<OHLCVData[]> {
    const cacheKey = `${coin}-${interval}-${count}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data;
    }

    try {
      const intervalConfig = INTERVALS[interval] || INTERVALS['1h'];
      const endTime = Date.now();
      const startTime = endTime - (intervalConfig.seconds * count * 1000);

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'candleSnapshot',
          req: {
            coin,
            interval: intervalConfig.interval,
            startTime,
            endTime,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const rawCandles = await response.json() as any[];

      const candles: OHLCVData[] = rawCandles.map((c: any) => ({
        timestamp: c.t,
        open: parseFloat(c.o),
        high: parseFloat(c.h),
        low: parseFloat(c.l),
        close: parseFloat(c.c),
        volume: parseFloat(c.v),
      }));

      // Sort by timestamp ascending
      candles.sort((a, b) => a.timestamp - b.timestamp);

      this.cache.set(cacheKey, { data: candles, timestamp: Date.now() });

      console.log(`[DataLoader] Fetched ${candles.length} candles for ${coin} (${interval})`);
      return candles;
    } catch (error) {
      console.error(`[DataLoader] Error fetching candles for ${coin}:`, error);
      return [];
    }
  }

  /**
   * Fetch current mid price
   */
  async fetchMidPrice(coin: string): Promise<number> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'allMids' }),
      });

      const mids: any = await response.json();
      return parseFloat(mids[coin] || '0');
    } catch (error) {
      console.error(`[DataLoader] Error fetching mid price for ${coin}:`, error);
      return 0;
    }
  }

  /**
   * Fetch order book for spread/liquidity analysis
   */
  async fetchOrderBook(coin: string): Promise<{
    bids: { price: number; size: number }[];
    asks: { price: number; size: number }[];
    spread: number;
    midPrice: number;
  } | null> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'l2Book',
          coin,
        }),
      });

      const book: any = await response.json();

      const bids = book.levels[0].map((l: any) => ({
        price: parseFloat(l.px),
        size: parseFloat(l.sz),
      }));

      const asks = book.levels[1].map((l: any) => ({
        price: parseFloat(l.px),
        size: parseFloat(l.sz),
      }));

      const bestBid = bids[0]?.price || 0;
      const bestAsk = asks[0]?.price || 0;
      const midPrice = (bestBid + bestAsk) / 2;
      const spread = bestAsk > 0 ? ((bestAsk - bestBid) / midPrice) * 100 : 0;

      return { bids, asks, spread, midPrice };
    } catch (error) {
      console.error(`[DataLoader] Error fetching order book for ${coin}:`, error);
      return null;
    }
  }

  /**
   * Get multiple timeframe data for multi-horizon prediction
   */
  async fetchMultiTimeframe(coin: string): Promise<{
    candles1h: OHLCVData[];
    candles4h: OHLCVData[];
    candles1d: OHLCVData[];
  }> {
    const [candles1h, candles4h, candles1d] = await Promise.all([
      this.fetchCandles(coin, '1h', 100),
      this.fetchCandles(coin, '4h', 50),
      this.fetchCandles(coin, '1d', 30),
    ]);

    return { candles1h, candles4h, candles1d };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
