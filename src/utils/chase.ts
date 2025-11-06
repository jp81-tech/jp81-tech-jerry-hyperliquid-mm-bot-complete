/**
 * Institutional Chase Mode - Tick-aware Market Making
 *
 * Features:
 * - Tick/lot rounding to prevent rejections
 * - Auto-shade on postOnly reject
 * - Volatility-adaptive spreads
 * - Queue position tracking
 * - Inventory skewing
 * - Multi-level ladder
 */

export type ChaseConfig = {
  enabled: boolean
  peg: 'touch' | 'mid'
  offsetTicks: number
  offsetTicksWhenVolatile: number
  minRequoteDelayMs: number
  batchIntervalMs: number
  retryOnPostOnlyReject: number
  autoShadeOnRejectTicks: number
  tifSeconds: number
  staleQuoteKillMs: number
  priceBandTicks: number
  minEdgeTicks: number

  queue: {
    enabled: boolean
    qAheadMaxUsd: number
    tFillMaxMs: number
  }

  volatility: {
    rvWindowMs: number
    sigmaFastThreshold: number
    spreadWidenTicks: number
  }

  throttle: {
    maxCancelsPerMin: number
    globalMaxCancelsPerMin: number
  }

  inventory: {
    invSoftUsd: number
    invHardUsd: number
    skewTicksAtSoft: number
    skewTicksAtHard: number
  }

  ladder: Array<{
    depthTicks: number
    sizeMult: number
  }>
}

export type InstrumentSpecs = {
  tickSize: number
  lotSize: number
  minNotional: number
  maxLeverage: number
}

// Default institutional preset
export const INSTITUTIONAL_PRESET: ChaseConfig = {
  enabled: true,
  peg: 'touch',
  offsetTicks: 1,
  offsetTicksWhenVolatile: 2,
  minRequoteDelayMs: 200,
  batchIntervalMs: 150,
  retryOnPostOnlyReject: 1,
  autoShadeOnRejectTicks: 1,
  tifSeconds: 3,
  staleQuoteKillMs: 4000,
  priceBandTicks: 10,
  minEdgeTicks: 2,

  queue: {
    enabled: true,
    qAheadMaxUsd: 20000,
    tFillMaxMs: 2500
  },

  volatility: {
    rvWindowMs: 400,
    sigmaFastThreshold: 0.35,
    spreadWidenTicks: 1
  },

  throttle: {
    maxCancelsPerMin: 200,
    globalMaxCancelsPerMin: 1000
  },

  inventory: {
    invSoftUsd: 5000,
    invHardUsd: 10000,
    skewTicksAtSoft: 1,
    skewTicksAtHard: 2
  },

  ladder: [
    { depthTicks: 0, sizeMult: 0.5 },
    { depthTicks: 2, sizeMult: 1.0 },
    { depthTicks: 5, sizeMult: 1.5 },
    { depthTicks: 9, sizeMult: 2.0 }
  ]
}

// Conservative preset (current approach)
export const CONSERVATIVE_PRESET: ChaseConfig = {
  enabled: true,
  peg: 'touch',
  offsetTicks: 1,
  offsetTicksWhenVolatile: 2,
  minRequoteDelayMs: 180000, // 180s
  batchIntervalMs: 180000,
  retryOnPostOnlyReject: 1,
  autoShadeOnRejectTicks: 1,
  tifSeconds: 0, // GTC
  staleQuoteKillMs: 300000, // 5min
  priceBandTicks: 500, // 5% with 0.01% ticks
  minEdgeTicks: 2,

  queue: {
    enabled: false,
    qAheadMaxUsd: 50000,
    tFillMaxMs: 10000
  },

  volatility: {
    rvWindowMs: 1000,
    sigmaFastThreshold: 0.5,
    spreadWidenTicks: 2
  },

  throttle: {
    maxCancelsPerMin: 50,
    globalMaxCancelsPerMin: 200
  },

  inventory: {
    invSoftUsd: 10000,
    invHardUsd: 20000,
    skewTicksAtSoft: 2,
    skewTicksAtHard: 5
  },

  ladder: [
    { depthTicks: 0, sizeMult: 1.0 }
  ]
}

/**
 * Hyperliquid instrument specifications
 * Source: https://api.hyperliquid.xyz/info
 */
export const HYPERLIQUID_SPECS: Record<string, InstrumentSpecs> = {
  // Major pairs - different tick sizes
  'BTC': { tickSize: 1, lotSize: 0.001, minNotional: 10, maxLeverage: 50 },
  'ETH': { tickSize: 0.1, lotSize: 0.01, minNotional: 10, maxLeverage: 50 },
  'SOL': { tickSize: 0.001, lotSize: 0.1, minNotional: 10, maxLeverage: 20 },

  // Alt pairs - smaller tick sizes
  'HYPE': { tickSize: 0.001, lotSize: 0.1, minNotional: 10, maxLeverage: 20 },
  'VIRTUAL': { tickSize: 0.0001, lotSize: 1, minNotional: 10, maxLeverage: 20 },
  'ZK': { tickSize: 0.000001, lotSize: 1, minNotional: 10, maxLeverage: 10 },
  'ZEC': { tickSize: 0.01, lotSize: 0.01, minNotional: 10, maxLeverage: 20 },
  'TRUMP': { tickSize: 0.001, lotSize: 0.1, minNotional: 10, maxLeverage: 10 },
  'ASTER': { tickSize: 0.0001, lotSize: 1, minNotional: 10, maxLeverage: 10 },
  'WLD': { tickSize: 0.001, lotSize: 0.1, minNotional: 10, maxLeverage: 20 },

  // Default for unknown symbols
  'DEFAULT': { tickSize: 0.0001, lotSize: 0.1, minNotional: 10, maxLeverage: 10 }
}

/**
 * Round price to valid tick size
 */
export function roundToTick(price: number, tickSize: number): number {
  return Math.round(price / tickSize) * tickSize
}

/**
 * Round size to valid lot size
 */
export function roundToLot(size: number, lotSize: number): number {
  return Math.floor(size / lotSize) * lotSize
}

/**
 * Get instrument specs with fallback to default
 */
export function getInstrumentSpecs(symbol: string): InstrumentSpecs {
  return HYPERLIQUID_SPECS[symbol] || HYPERLIQUID_SPECS['DEFAULT']
}

/**
 * Calculate inventory skew in ticks
 */
export function calculateInventorySkew(
  inventoryUsd: number,
  config: ChaseConfig
): number {
  const { invSoftUsd, invHardUsd, skewTicksAtSoft, skewTicksAtHard } = config.inventory

  const absInv = Math.abs(inventoryUsd)

  if (absInv <= invSoftUsd) {
    return 0
  }

  if (absInv >= invHardUsd) {
    return Math.sign(inventoryUsd) * skewTicksAtHard
  }

  // Linear interpolation between soft and hard
  const progress = (absInv - invSoftUsd) / (invHardUsd - invSoftUsd)
  const skew = skewTicksAtSoft + (skewTicksAtHard - skewTicksAtSoft) * progress

  return Math.sign(inventoryUsd) * Math.round(skew)
}

/**
 * Calculate realized volatility over window
 */
export class VolatilityTracker {
  private priceHistory: Array<{ price: number; timestamp: number }> = []

  addPrice(price: number, timestamp: number = Date.now()) {
    this.priceHistory.push({ price, timestamp })

    // Keep only recent data
    const cutoff = timestamp - 10000 // 10s window max
    this.priceHistory = this.priceHistory.filter(p => p.timestamp > cutoff)
  }

  getRealizedVolatility(windowMs: number): number {
    const now = Date.now()
    const cutoff = now - windowMs

    const recentPrices = this.priceHistory
      .filter(p => p.timestamp > cutoff)
      .map(p => p.price)

    if (recentPrices.length < 2) return 0

    // Calculate returns
    const returns: number[] = []
    for (let i = 1; i < recentPrices.length; i++) {
      const ret = (recentPrices[i] - recentPrices[i - 1]) / recentPrices[i - 1]
      returns.push(ret)
    }

    // Standard deviation of returns
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length

    return Math.sqrt(variance)
  }
}

/**
 * Queue position estimator
 * Note: Hyperliquid doesn't expose queue depth, so we estimate based on:
 * - Order book depth at our price level
 * - Time since our order was placed
 * - Recent fill velocity
 */
export class QueueEstimator {
  private fillHistory: Array<{ timestamp: number; volumeUsd: number }> = []

  addFill(volumeUsd: number, timestamp: number = Date.now()) {
    this.fillHistory.push({ timestamp, volumeUsd })

    // Keep last 60s of fills
    const cutoff = timestamp - 60000
    this.fillHistory = this.fillHistory.filter(f => f.timestamp > cutoff)
  }

  estimateQueueAhead(
    orderPrice: number,
    orderSide: 'buy' | 'sell',
    bookDepthAtLevel: number,
    orderTimestamp: number
  ): { queueAheadUsd: number; etaFillMs: number } {
    const now = Date.now()
    const orderAge = now - orderTimestamp

    // Estimate: newer orders are behind us in queue
    // Assume we're in front 50% of existing depth (conservative)
    const estimatedQueueAhead = bookDepthAtLevel * 0.5

    // Calculate recent fill velocity (USD/s)
    const recentFills = this.fillHistory.filter(f => f.timestamp > now - 10000)
    const totalVolume = recentFills.reduce((sum, f) => sum + f.volumeUsd, 0)
    const fillVelocity = totalVolume / 10 // USD per second

    // Estimate time to fill
    const etaFillMs = fillVelocity > 0
      ? (estimatedQueueAhead / fillVelocity) * 1000
      : Infinity

    return {
      queueAheadUsd: estimatedQueueAhead,
      etaFillMs
    }
  }
}

/**
 * Throttle tracker for rate limiting
 */
export class ThrottleTracker {
  private cancelHistory: Map<string, number[]> = new Map()
  private globalCancelHistory: number[] = []

  recordCancel(symbol: string, timestamp: number = Date.now()) {
    // Per-symbol tracking
    if (!this.cancelHistory.has(symbol)) {
      this.cancelHistory.set(symbol, [])
    }
    this.cancelHistory.get(symbol)!.push(timestamp)

    // Global tracking
    this.globalCancelHistory.push(timestamp)

    // Cleanup old entries (>1 minute)
    const cutoff = timestamp - 60000
    for (const [sym, history] of this.cancelHistory.entries()) {
      this.cancelHistory.set(sym, history.filter(t => t > cutoff))
    }
    this.globalCancelHistory = this.globalCancelHistory.filter(t => t > cutoff)
  }

  canCancel(symbol: string, config: ChaseConfig): boolean {
    const now = Date.now()
    const cutoff = now - 60000

    // Check per-symbol limit
    const symbolCancels = this.cancelHistory.get(symbol) || []
    const recentSymbolCancels = symbolCancels.filter(t => t > cutoff).length

    if (recentSymbolCancels >= config.throttle.maxCancelsPerMin) {
      return false
    }

    // Check global limit
    const recentGlobalCancels = this.globalCancelHistory.filter(t => t > cutoff).length
    if (recentGlobalCancels >= config.throttle.globalMaxCancelsPerMin) {
      return false
    }

    return true
  }
}
