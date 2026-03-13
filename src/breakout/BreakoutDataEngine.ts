import axios from 'axios'
import type { BreakoutCandle, DonchianChannel } from './types.js'
import type { BreakoutConfig } from './config.js'

const HL_API = 'https://api.hyperliquid.xyz/info'
const REQUEST_DELAY_MS = 600  // stay within 2 req/s

export class BreakoutDataEngine {
  private config: BreakoutConfig
  private lastRequestTime = 0

  constructor(config: BreakoutConfig) {
    this.config = config
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now()
    const elapsed = now - this.lastRequestTime
    if (elapsed < REQUEST_DELAY_MS) {
      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS - elapsed))
    }
    this.lastRequestTime = Date.now()
  }

  async fetchCandles(coin: string, interval: string, count: number): Promise<BreakoutCandle[]> {
    await this.rateLimit()

    // Request enough time range for `count` candles
    const intervalMs = interval === '1m' ? 60_000
      : interval === '5m' ? 300_000
      : interval === '15m' ? 900_000
      : interval === '1h' ? 3_600_000
      : 60_000
    const endTime = Date.now()
    const startTime = endTime - count * intervalMs * 1.2  // 20% buffer

    try {
      const resp = await axios.post(HL_API, {
        type: 'candleSnapshot',
        req: { coin, interval, startTime, endTime }
      }, { timeout: 10_000 })

      const raw = resp.data as any[]
      return raw.slice(-count).map(c => ({
        t: c.t,
        o: parseFloat(c.o),
        h: parseFloat(c.h),
        l: parseFloat(c.l),
        c: parseFloat(c.c),
        v: parseFloat(c.v),
      }))
    } catch (e: any) {
      console.error(`[DATA] Failed to fetch ${coin} ${interval}: ${e.message}`)
      return []
    }
  }

  async fetchMidPrices(): Promise<Record<string, number>> {
    await this.rateLimit()
    try {
      const resp = await axios.post(HL_API, { type: 'allMids' }, { timeout: 10_000 })
      const mids: Record<string, number> = {}
      for (const [coin, px] of Object.entries(resp.data as Record<string, string>)) {
        mids[coin] = parseFloat(px)
      }
      return mids
    } catch {
      return {}
    }
  }

  async fetchPositions(walletAddress: string): Promise<any[]> {
    await this.rateLimit()
    try {
      const resp = await axios.post(HL_API, {
        type: 'clearinghouseState',
        user: walletAddress,
      }, { timeout: 10_000 })
      return resp.data?.assetPositions || []
    } catch {
      return []
    }
  }

  async fetchAccountValue(walletAddress: string): Promise<number> {
    await this.rateLimit()
    try {
      const resp = await axios.post(HL_API, {
        type: 'clearinghouseState',
        user: walletAddress,
      }, { timeout: 10_000 })
      return parseFloat(resp.data?.marginSummary?.accountValue || '0')
    } catch {
      return 0
    }
  }

  // ── Indicators ──────────────────────────────────────────────

  computeDonchian(candles: BreakoutCandle[], period: number): DonchianChannel | null {
    if (candles.length < period + 1) return null

    // Use candles [-(period+1) .. -2] for the channel (exclude current forming candle)
    const lookback = candles.slice(-(period + 1), -1)
    const upper = Math.max(...lookback.map(c => c.h))
    const lower = Math.min(...lookback.map(c => c.l))

    return { upper, lower, mid: (upper + lower) / 2 }
  }

  computeEMA(candles: BreakoutCandle[], period: number): number | null {
    if (candles.length < period) return null

    const k = 2 / (period + 1)
    let ema = candles[0].c

    for (let i = 1; i < candles.length; i++) {
      ema = candles[i].c * k + ema * (1 - k)
    }
    return ema
  }

  computeAvgVolume(candles: BreakoutCandle[], period: number): number {
    if (candles.length < period + 1) return 0
    // Exclude current candle
    const lookback = candles.slice(-(period + 1), -1)
    const sum = lookback.reduce((s, c) => s + c.v, 0)
    return sum / lookback.length
  }

  currentCandle(candles: BreakoutCandle[]): BreakoutCandle | null {
    return candles.length > 0 ? candles[candles.length - 1] : null
  }

  lastClosedCandle(candles: BreakoutCandle[]): BreakoutCandle | null {
    return candles.length > 1 ? candles[candles.length - 2] : null
  }
}
