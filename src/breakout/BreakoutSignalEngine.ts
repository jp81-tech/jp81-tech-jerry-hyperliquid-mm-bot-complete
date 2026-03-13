import type { BreakoutCandle, BreakoutSignal, DonchianChannel } from './types.js'
import type { BreakoutConfig } from './config.js'

export class BreakoutSignalEngine {
  private config: BreakoutConfig
  // Track last signal per token to avoid repeat signals on same breakout
  private lastSignalTime: Map<string, number> = new Map()
  private readonly SIGNAL_COOLDOWN_MS = 5 * 60 * 1000  // 5 min between signals per token

  constructor(config: BreakoutConfig) {
    this.config = config
  }

  /**
   * Check if the last closed 1m candle broke above/below the Donchian channel.
   * EMA200 on 5m acts as trend filter.
   */
  checkBreakout(
    token: string,
    candles1m: BreakoutCandle[],
    donchian: DonchianChannel,
    ema200: number,
    midPrice: number,
  ): BreakoutSignal | null {

    // Cooldown check
    const lastTime = this.lastSignalTime.get(token) || 0
    if (Date.now() - lastTime < this.SIGNAL_COOLDOWN_MS) return null

    const lastClosed = candles1m.length > 1 ? candles1m[candles1m.length - 2] : null
    const prevClosed = candles1m.length > 2 ? candles1m[candles1m.length - 3] : null
    if (!lastClosed || !prevClosed) return null

    // Volume confirmation
    const avgVol = this.avgVolume(candles1m, this.config.donchianPeriod)
    const volRatio = avgVol > 0 ? lastClosed.v / avgVol : 0
    if (volRatio < this.config.volumeConfirmMult) return null

    // ── LONG breakout ──
    // Last closed candle's close broke above Donchian upper
    // Previous candle was still inside channel
    if (
      lastClosed.c > donchian.upper &&
      prevClosed.c <= donchian.upper &&
      midPrice > ema200  // trend filter: price above EMA200
    ) {
      const entry = midPrice
      const sl = donchian.lower
      const riskR = entry - sl
      if (riskR <= 0) return null

      const tp = entry + riskR * this.config.tpRMultiplier

      this.lastSignalTime.set(token, Date.now())
      return {
        token,
        side: 'LONG',
        entryPrice: entry,
        slPrice: sl,
        tpPrice: tp,
        riskR,
        donchian,
        ema200,
        volumeRatio: volRatio,
        timestamp: Date.now(),
      }
    }

    // ── SHORT breakout ──
    if (
      lastClosed.c < donchian.lower &&
      prevClosed.c >= donchian.lower &&
      midPrice < ema200  // trend filter: price below EMA200
    ) {
      const entry = midPrice
      const sl = donchian.upper
      const riskR = sl - entry
      if (riskR <= 0) return null

      const tp = entry - riskR * this.config.tpRMultiplier

      this.lastSignalTime.set(token, Date.now())
      return {
        token,
        side: 'SHORT',
        entryPrice: entry,
        slPrice: sl,
        tpPrice: tp,
        riskR,
        donchian,
        ema200,
        volumeRatio: volRatio,
        timestamp: Date.now(),
      }
    }

    return null
  }

  private avgVolume(candles: BreakoutCandle[], period: number): number {
    if (candles.length < period + 1) return 0
    const lookback = candles.slice(-(period + 1), -1)
    return lookback.reduce((s, c) => s + c.v, 0) / lookback.length
  }
}
