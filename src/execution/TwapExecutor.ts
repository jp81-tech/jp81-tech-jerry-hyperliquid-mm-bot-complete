/**
 * TwapExecutor — Time-Weighted Average Price execution engine
 *
 * Closes positions in small slices over time (like the Generał does),
 * instead of a single IOC market order with 5% slippage.
 *
 * Benefits: lower slippage, maker fees (1.5bps vs 4.5bps taker), less market impact.
 *
 * Standalone module with its own timer loop — mainLoop tick (60s) is too slow for TWAP.
 */

import type * as hl from '@nktkas/hyperliquid'
import {
  getInstrumentSpecs,
} from '../utils/chase.js'
import {
  getPriceDecimals,
  getSizeDecimals,
  quantizePrice,
  quantizeSize,
} from '../utils/quant.js'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface TwapConfig {
  numSlices: number        // 5-20 (how many child orders)
  durationSec: number      // 30-300 (total execution window)
  priceOffsetBps: number   // 0-5 (maker incentive — how many bps better than mid)
  maxSlippageBps: number   // 50 (abort if price escapes >50bps from start mid)
  escalateAfterSec: number // 10 (seconds without fill before escalating to IOC)
  reduceOnly: boolean      // true (always reduce-only for closing)
}

export interface TwapState {
  status: 'pending' | 'running' | 'done' | 'aborted'
  pair: string
  side: 'buy' | 'sell'
  totalSizeCoins: number
  filledSizeCoins: number
  filledValueUsd: number
  slicesDone: number
  avgFillPrice: number
  startTime: number
  startMidPrice: number
  lastSliceOid: number | null
  lastSliceTime: number
  escalationLevel: number  // 0=ALO, 1=GTC@mid, 2=IOC taker
  abortReason: string | null
}

interface TwapSliceResult {
  filled: boolean
  oid: number | null
  price: number
  sizeCoins: number
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-TOKEN DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

const TWAP_DEFAULTS: Record<string, Partial<TwapConfig>> = {
  // Liquid coins — faster TWAP, more slices
  BTC:  { numSlices: 10, durationSec: 60,  escalateAfterSec: 8 },
  ETH:  { numSlices: 10, durationSec: 60,  escalateAfterSec: 8 },
  SOL:  { numSlices: 8,  durationSec: 45,  escalateAfterSec: 8 },
  // Mid-cap
  HYPE: { numSlices: 5,  durationSec: 30,  escalateAfterSec: 10 },
  // Illiquid — like Generał, patient maker-first
  LIT:       { numSlices: 5, durationSec: 60, escalateAfterSec: 15 },
  FARTCOIN:  { numSlices: 5, durationSec: 45, escalateAfterSec: 12 },
  ASTER:     { numSlices: 5, durationSec: 30, escalateAfterSec: 10 },
}

const DEFAULT_CONFIG: TwapConfig = {
  numSlices: 5,
  durationSec: 30,
  priceOffsetBps: 0,
  maxSlippageBps: 50,
  escalateAfterSec: 10,
  reduceOnly: true,
}

// ─────────────────────────────────────────────────────────────────────────────
// TWAP EXECUTOR
// ─────────────────────────────────────────────────────────────────────────────

export class TwapExecutor {
  private activeTwaps: Map<string, TwapState> = new Map()  // pair -> state
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map()

  constructor(
    private exchClient: hl.ExchangeClient,
    private infoClient: hl.InfoClient,
    private assetMap: Map<string, number>,
    private walletAddress: string,
  ) {}

  // ─── PUBLIC API ──────────────────────────────────────────────────────────

  /**
   * Start a TWAP execution for a pair.
   * Returns immediately — slices execute in background via setInterval.
   */
  async start(
    pair: string,
    totalSizeCoins: number,
    side: 'buy' | 'sell',
    configOverride?: Partial<TwapConfig>,
  ): Promise<boolean> {
    // Prevent duplicate TWAP on same pair
    if (this.activeTwaps.has(pair)) {
      console.log(`⏳ [TWAP] ${pair}: already running, skipping duplicate start`)
      return false
    }

    const config = this.resolveConfig(pair, configOverride)

    // Fetch initial mid price
    const midPrice = await this.getMidPrice(pair)
    if (!midPrice) {
      console.error(`❌ [TWAP] ${pair}: no L2 data, cannot start`)
      return false
    }

    const state: TwapState = {
      status: 'running',
      pair,
      side,
      totalSizeCoins,
      filledSizeCoins: 0,
      filledValueUsd: 0,
      slicesDone: 0,
      avgFillPrice: 0,
      startTime: Date.now(),
      startMidPrice: midPrice,
      lastSliceOid: null,
      lastSliceTime: 0,
      escalationLevel: 0,
      abortReason: null,
    }

    this.activeTwaps.set(pair, state)

    const sliceIntervalMs = Math.floor((config.durationSec * 1000) / config.numSlices)
    const sliceSizeCoins = totalSizeCoins / config.numSlices

    console.log(
      `🔄 [TWAP] ${pair}: STARTED | ${side.toUpperCase()} ${totalSizeCoins.toFixed(6)} coins ` +
      `| ${config.numSlices} slices × ${sliceSizeCoins.toFixed(6)} every ${(sliceIntervalMs / 1000).toFixed(1)}s ` +
      `| mid=${midPrice.toFixed(4)} | maxSlippage=${config.maxSlippageBps}bps`
    )

    // Start slice loop
    let sliceIdx = 0
    const timer = setInterval(async () => {
      try {
        const currentState = this.activeTwaps.get(pair)
        if (!currentState || currentState.status !== 'running') {
          this.clearTimer(pair)
          return
        }

        // Check timeout (total duration exceeded)
        const elapsed = Date.now() - currentState.startTime
        if (elapsed > config.durationSec * 1000 * 1.5) {
          // 1.5x duration as hard timeout
          await this.abort(pair, 'timeout')
          return
        }

        // Check max slippage
        const currentMid = await this.getMidPrice(pair)
        if (currentMid) {
          const slippageBps = Math.abs(currentMid - currentState.startMidPrice) / currentState.startMidPrice * 10000
          if (slippageBps > config.maxSlippageBps) {
            // Price moved too much — escalate to IOC to finish remaining
            console.log(
              `⚠️ [TWAP] ${pair}: price moved ${slippageBps.toFixed(1)}bps > max ${config.maxSlippageBps}bps — escalating to IOC`
            )
            await this.finishWithIoc(pair, config)
            return
          }
        }

        // Check if previous slice filled (if any pending)
        if (currentState.lastSliceOid !== null) {
          await this.checkAndHandlePendingSlice(pair, config)
        }

        // All slices done or filled enough?
        const remaining = currentState.totalSizeCoins - currentState.filledSizeCoins
        if (remaining < 1e-8) {
          this.complete(pair)
          return
        }

        if (sliceIdx >= config.numSlices) {
          // All slices sent — check remaining
          if (remaining > currentState.totalSizeCoins * 0.02) {
            // >2% remaining — do a final IOC sweep
            await this.finishWithIoc(pair, config)
          } else {
            this.complete(pair)
          }
          return
        }

        // Execute next slice
        const thisSliceSize = Math.min(sliceSizeCoins, remaining)
        await this.executeSlice(pair, thisSliceSize, config)
        sliceIdx++
      } catch (err) {
        console.error(`❌ [TWAP] ${pair}: slice error: ${err}`)
      }
    }, sliceIntervalMs)

    this.timers.set(pair, timer)

    // Also execute first slice immediately (don't wait for first interval)
    try {
      const firstSliceSize = Math.min(sliceSizeCoins, totalSizeCoins)
      await this.executeSlice(pair, firstSliceSize, config)
      sliceIdx++
    } catch (err) {
      console.error(`❌ [TWAP] ${pair}: first slice error: ${err}`)
    }

    return true
  }

  /**
   * Abort a running TWAP — cancel pending orders, log stats.
   */
  async abort(pair: string, reason: string): Promise<void> {
    const state = this.activeTwaps.get(pair)
    if (!state) return

    state.status = 'aborted'
    state.abortReason = reason
    this.clearTimer(pair)

    // Cancel any pending order
    if (state.lastSliceOid !== null) {
      await this.cancelSliceOrder(pair, state.lastSliceOid)
      state.lastSliceOid = null
    }

    this.logStats(pair, 'ABORTED')
    this.activeTwaps.delete(pair)
  }

  /**
   * Get stats for a running or completed TWAP.
   */
  getStats(pair: string): TwapState | null {
    return this.activeTwaps.get(pair) ?? null
  }

  /**
   * Check if a TWAP is active for a given pair.
   */
  isActive(pair: string): boolean {
    const state = this.activeTwaps.get(pair)
    return state?.status === 'running'
  }

  /**
   * Tick — called from mainLoop to monitor active TWAPs (logging only).
   * Actual slice execution is handled by setInterval timers.
   */
  tick(): void {
    for (const [pair, state] of this.activeTwaps) {
      if (state.status === 'running') {
        const elapsed = ((Date.now() - state.startTime) / 1000).toFixed(1)
        const pct = ((state.filledSizeCoins / state.totalSizeCoins) * 100).toFixed(1)
        console.log(
          `🔄 [TWAP] ${pair}: ${pct}% filled (${state.slicesDone} slices, ${elapsed}s elapsed)`
        )
      }
    }
  }

  /**
   * Get list of pairs with active TWAPs.
   */
  getActivePairs(): string[] {
    return Array.from(this.activeTwaps.entries())
      .filter(([, s]) => s.status === 'running')
      .map(([pair]) => pair)
  }

  // ─── PRIVATE METHODS ────────────────────────────────────────────────────

  /**
   * Execute a single TWAP slice — place a limit order at competitive price.
   */
  private async executeSlice(
    pair: string,
    sliceSizeCoins: number,
    config: TwapConfig,
  ): Promise<void> {
    const state = this.activeTwaps.get(pair)
    if (!state || state.status !== 'running') return

    const assetIndex = this.assetMap.get(pair)
    if (assetIndex === undefined) {
      console.error(`❌ [TWAP] ${pair}: asset index not found`)
      return
    }

    const specs = getInstrumentSpecs(pair)
    const pxDec = getPriceDecimals(specs.tickSize)
    const szDec = getSizeDecimals(specs.lotSize)

    // Get L2 book for pricing
    const l2 = await this.infoClient.l2Book({ coin: pair })
    if (!l2 || !l2.levels) {
      console.warn(`⚠️ [TWAP] ${pair}: no L2 data for slice`)
      return
    }

    const bestAsk = parseFloat(l2.levels[0]?.[0]?.px || '0')
    const bestBid = parseFloat(l2.levels[1]?.[0]?.px || '0')

    if (bestAsk === 0 || bestBid === 0) {
      console.warn(`⚠️ [TWAP] ${pair}: invalid L2 book (ask=${bestAsk}, bid=${bestBid})`)
      return
    }

    // Calculate slice price based on escalation level
    let slicePrice: number
    let tif: 'Alo' | 'Gtc' | 'Ioc'

    if (state.escalationLevel === 0) {
      // Level 0: Maker-first — 1 tick inside spread
      if (state.side === 'buy') {
        slicePrice = bestBid + specs.tickSize  // 1 tick above best bid
      } else {
        slicePrice = bestAsk - specs.tickSize  // 1 tick below best ask
      }
      tif = 'Alo'  // Add Liquidity Only — guaranteed maker
    } else if (state.escalationLevel === 1) {
      // Level 1: Mid price — GTC, will cross if needed
      slicePrice = (bestAsk + bestBid) / 2
      tif = 'Gtc'
    } else {
      // Level 2: IOC taker — guaranteed fill
      if (state.side === 'buy') {
        slicePrice = bestAsk * 1.002  // 20bps above ask
      } else {
        slicePrice = bestBid * 0.998  // 20bps below bid
      }
      tif = 'Ioc'
    }

    // Quantize
    const priceQuant = quantizePrice(slicePrice, specs.tickSize, pxDec, state.side)
    const sizeQuant = quantizeSize(sliceSizeCoins, specs.lotSize, szDec)

    if (parseFloat(sizeQuant.strValue) < specs.lotSize) {
      // Slice too small after quantization
      return
    }

    const tifLabel = tif === 'Alo' ? 'ALO(maker)' : tif === 'Gtc' ? 'GTC(mid)' : 'IOC(taker)'

    try {
      const result = await this.exchClient.order({
        orders: [{
          a: assetIndex,
          b: state.side === 'buy',
          p: priceQuant.strValue,
          s: sizeQuant.strValue,
          r: config.reduceOnly,
          t: { limit: { tif } },
        }],
        grouping: 'na',
      })

      state.slicesDone++
      state.lastSliceTime = Date.now()

      // Extract OID from response
      if (result?.response?.data?.statuses?.[0]) {
        const status = result.response.data.statuses[0] as any
        if (status.resting) {
          state.lastSliceOid = status.resting.oid
          console.log(
            `📤 [TWAP] ${pair}: slice #${state.slicesDone} ${tifLabel} ` +
            `${state.side} ${sizeQuant.strValue} @${priceQuant.strValue} | oid=${state.lastSliceOid}`
          )
        } else if (status.filled) {
          // Immediately filled (IOC or crossed)
          const filledSize = parseFloat(sizeQuant.strValue)
          const filledPrice = parseFloat(priceQuant.strValue)
          state.filledSizeCoins += filledSize
          state.filledValueUsd += filledSize * filledPrice
          state.avgFillPrice = state.filledSizeCoins > 0
            ? state.filledValueUsd / state.filledSizeCoins
            : 0
          state.lastSliceOid = null
          state.escalationLevel = 0  // Reset escalation on fill

          console.log(
            `✅ [TWAP] ${pair}: slice #${state.slicesDone} FILLED ${tifLabel} ` +
            `${state.side} ${filledSize.toFixed(6)} @${filledPrice.toFixed(4)} ` +
            `| total=${((state.filledSizeCoins / state.totalSizeCoins) * 100).toFixed(1)}%`
          )
        } else if (status.error) {
          console.warn(
            `⚠️ [TWAP] ${pair}: slice #${state.slicesDone} rejected: ${status.error}`
          )
          state.lastSliceOid = null

          // ALO rejection = would cross → escalate
          const errMsg = String(status.error || '')
          if (errMsg.includes('Alo') || errMsg.includes('would cross')) {
            state.escalationLevel = Math.min(state.escalationLevel + 1, 2)
            console.log(`📈 [TWAP] ${pair}: escalation → level ${state.escalationLevel}`)
          }
        }
      }
    } catch (err) {
      console.error(`❌ [TWAP] ${pair}: slice order failed: ${err}`)
    }
  }

  /**
   * Check if previous slice order was filled; escalate if not.
   */
  private async checkAndHandlePendingSlice(pair: string, config: TwapConfig): Promise<void> {
    const state = this.activeTwaps.get(pair)
    if (!state || state.lastSliceOid === null) return

    // Check if the order is still open
    try {
      const orders = await this.infoClient.openOrders({ user: this.walletAddress })
      const pendingOrder = orders?.find(
        (o: any) => o.oid === state.lastSliceOid && o.coin === pair
      )

      if (!pendingOrder) {
        // Order no longer open — assume it was filled
        // We estimate fill from the order's intended size
        // (precise fill tracking would require fetching fills, but this is good enough)
        const specs = getInstrumentSpecs(pair)
        const szDec = getSizeDecimals(specs.lotSize)
        const sliceSize = state.totalSizeCoins / this.resolveConfig(pair).numSlices
        const quantized = quantizeSize(sliceSize, specs.lotSize, szDec)
        const filledSize = parseFloat(quantized.strValue)

        if (filledSize > 0) {
          const midPrice = await this.getMidPrice(pair) ?? state.startMidPrice
          state.filledSizeCoins += filledSize
          state.filledValueUsd += filledSize * midPrice
          state.avgFillPrice = state.filledSizeCoins > 0
            ? state.filledValueUsd / state.filledSizeCoins
            : 0
          state.escalationLevel = 0  // Reset on fill

          console.log(
            `✅ [TWAP] ${pair}: pending slice FILLED ` +
            `| total=${((state.filledSizeCoins / state.totalSizeCoins) * 100).toFixed(1)}%`
          )
        }

        state.lastSliceOid = null
        return
      }

      // Order still pending — check if we should escalate
      const pendingSec = (Date.now() - state.lastSliceTime) / 1000
      if (pendingSec > config.escalateAfterSec) {
        // Cancel pending and escalate
        await this.cancelSliceOrder(pair, state.lastSliceOid)
        state.lastSliceOid = null
        state.escalationLevel = Math.min(state.escalationLevel + 1, 2)

        console.log(
          `📈 [TWAP] ${pair}: no fill after ${pendingSec.toFixed(1)}s — ` +
          `escalation → level ${state.escalationLevel} ` +
          `(${state.escalationLevel === 1 ? 'GTC@mid' : 'IOC taker'})`
        )
      }
    } catch (err) {
      console.error(`❌ [TWAP] ${pair}: check pending failed: ${err}`)
    }
  }

  /**
   * Finish remaining quantity with a single IOC order (emergency/timeout).
   */
  private async finishWithIoc(pair: string, config: TwapConfig): Promise<void> {
    const state = this.activeTwaps.get(pair)
    if (!state) return

    // Cancel any pending
    if (state.lastSliceOid !== null) {
      await this.cancelSliceOrder(pair, state.lastSliceOid)
      state.lastSliceOid = null
    }

    const remaining = state.totalSizeCoins - state.filledSizeCoins
    if (remaining < 1e-8) {
      this.complete(pair)
      return
    }

    const assetIndex = this.assetMap.get(pair)
    if (assetIndex === undefined) return

    const specs = getInstrumentSpecs(pair)
    const pxDec = getPriceDecimals(specs.tickSize)
    const szDec = getSizeDecimals(specs.lotSize)

    const midPrice = await this.getMidPrice(pair)
    if (!midPrice) {
      this.complete(pair)
      return
    }

    // IOC with 0.5% slippage (much less than the old 5%)
    const iocPrice = state.side === 'buy'
      ? midPrice * 1.005
      : midPrice * 0.995

    const priceQuant = quantizePrice(iocPrice, specs.tickSize, pxDec, state.side)
    const sizeQuant = quantizeSize(remaining, specs.lotSize, szDec)

    if (parseFloat(sizeQuant.strValue) < specs.lotSize) {
      this.complete(pair)
      return
    }

    console.log(
      `⚡ [TWAP] ${pair}: finishing remaining ${remaining.toFixed(6)} with IOC @${priceQuant.strValue}`
    )

    try {
      await this.exchClient.order({
        orders: [{
          a: assetIndex,
          b: state.side === 'buy',
          p: priceQuant.strValue,
          s: sizeQuant.strValue,
          r: config.reduceOnly,
          t: { limit: { tif: 'Ioc' } },
        }],
        grouping: 'na',
      })

      // Assume filled (IOC either fills or cancels)
      state.filledSizeCoins += remaining
      state.filledValueUsd += remaining * parseFloat(priceQuant.strValue)
      state.avgFillPrice = state.filledSizeCoins > 0
        ? state.filledValueUsd / state.filledSizeCoins
        : 0

      this.complete(pair)
    } catch (err) {
      console.error(`❌ [TWAP] ${pair}: IOC finish failed: ${err}`)
      this.complete(pair)
    }
  }

  /**
   * Mark TWAP as done, log final stats.
   */
  private complete(pair: string): void {
    const state = this.activeTwaps.get(pair)
    if (!state) return

    state.status = 'done'
    this.clearTimer(pair)
    this.logStats(pair, 'DONE')
    this.activeTwaps.delete(pair)
  }

  /**
   * Log execution quality stats.
   */
  private logStats(pair: string, outcome: string): void {
    const state = this.activeTwaps.get(pair)
    if (!state) return

    const durationSec = ((Date.now() - state.startTime) / 1000).toFixed(1)
    const fillPct = ((state.filledSizeCoins / state.totalSizeCoins) * 100).toFixed(1)
    const slippageBps = state.avgFillPrice > 0
      ? ((state.avgFillPrice - state.startMidPrice) / state.startMidPrice * 10000 * (state.side === 'buy' ? 1 : -1)).toFixed(2)
      : '0.00'

    console.log(
      `📊 [TWAP] ${pair}: ${outcome} | ${state.side.toUpperCase()} ` +
      `${state.filledSizeCoins.toFixed(6)}/${state.totalSizeCoins.toFixed(6)} (${fillPct}%) ` +
      `| avg=${state.avgFillPrice.toFixed(4)} vs startMid=${state.startMidPrice.toFixed(4)} ` +
      `| slippage=${slippageBps}bps | ${state.slicesDone} slices in ${durationSec}s` +
      (state.abortReason ? ` | reason=${state.abortReason}` : '')
    )
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────────

  private resolveConfig(pair: string, override?: Partial<TwapConfig>): TwapConfig {
    const tokenDefaults = TWAP_DEFAULTS[pair] ?? {}

    // Check env overrides: LIT_TWAP_SLICES=10, LIT_TWAP_DURATION=120
    const envSlices = Number(process.env[`${pair}_TWAP_SLICES`] || 0)
    const envDuration = Number(process.env[`${pair}_TWAP_DURATION`] || 0)

    return {
      ...DEFAULT_CONFIG,
      ...tokenDefaults,
      ...(envSlices > 0 ? { numSlices: envSlices } : {}),
      ...(envDuration > 0 ? { durationSec: envDuration } : {}),
      ...override,
    }
  }

  private async getMidPrice(pair: string): Promise<number | null> {
    try {
      const l2 = await this.infoClient.l2Book({ coin: pair })
      if (!l2 || !l2.levels) return null
      const bestAsk = parseFloat(l2.levels[0]?.[0]?.px || '0')
      const bestBid = parseFloat(l2.levels[1]?.[0]?.px || '0')
      if (bestAsk === 0 || bestBid === 0) return null
      return (bestAsk + bestBid) / 2
    } catch {
      return null
    }
  }

  private async cancelSliceOrder(pair: string, oid: number): Promise<void> {
    const assetIndex = this.assetMap.get(pair)
    if (assetIndex === undefined) return

    try {
      await this.exchClient.cancel({
        cancels: [{ a: assetIndex, o: oid }],
      })
    } catch {
      // Order may have already been filled or cancelled — ignore
    }
  }

  private clearTimer(pair: string): void {
    const timer = this.timers.get(pair)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(pair)
    }
  }
}
