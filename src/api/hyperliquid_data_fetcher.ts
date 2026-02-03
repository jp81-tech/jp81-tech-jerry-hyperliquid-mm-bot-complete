/**
 * HyperliquidDataFetcher - Fetches and tracks OI + Price momentum for squeeze detection
 *
 * Provides:
 * - Price momentum (1h, 4h, 24h) from candle data
 * - OI history tracking and change calculation
 * - Divergence detection (OI vs Price)
 */

import { HyperliquidAPI, HLAssetCtx } from './hyperliquid.js'

export interface PriceMomentum {
  price: number
  change1h: number      // % change in last 1h
  change4h: number      // % change in last 4h
  change24h: number     // % change in last 24h
  high24h: number
  low24h: number
  volume24h: number
}

export interface OIData {
  current: number
  change1h: number      // % change in last 1h
  change4h: number      // % change in last 4h
  change24h: number     // % change in last 24h
}

export interface MarketSnapshot {
  coin: string
  timestamp: number
  price: number
  openInterest: number
  fundingRate: number
  volume24h: number
  momentum: PriceMomentum
  oi: OIData
  divergence: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  divergenceStrength: number  // 0-100
}

interface OIHistoryEntry {
  timestamp: number
  oi: number
  price: number
}

export class HyperliquidDataFetcher {
  private api: HyperliquidAPI
  private oiHistory: Map<string, OIHistoryEntry[]> = new Map()
  private lastFetch: number = 0
  private cache: Map<string, MarketSnapshot> = new Map()
  private refreshInProgress = false

  // How long to keep OI history (25 hours to safely calculate 24h change)
  private readonly OI_HISTORY_RETENTION_MS = 25 * 60 * 60 * 1000
  // Minimum time between full refreshes
  private readonly CACHE_TTL_MS = 30_000  // 30 seconds

  // Priority coins - fetched FIRST to ensure data for active trading pairs
  private static readonly PRIORITY_COINS: Set<string> = new Set([
    'HYPE', 'LIT', 'FARTCOIN', 'ENA', 'SUI', 'PUMP'
  ])

  // Coins that get candle data fetched (expensive: 1 API call each).
  // All other coins still get OI/price/funding from the single meta call.
  private static readonly CANDLE_COINS: Set<string> = new Set([
    // Majors (actively traded)
    'BTC', 'ETH', 'SOL',
    // SM-tracked alts
    'HYPE', 'LIT', 'FARTCOIN', 'VIRTUAL', 'SUI', 'DOGE',
    // Rotation candidates
    'ENA', 'PUMP', 'ZEC', 'TRUMP', 'ASTER', 'WLD', 'ZK',
  ])

  constructor(api?: HyperliquidAPI) {
    this.api = api || new HyperliquidAPI()
  }

  /**
   * Get market snapshot for a coin with momentum and OI data (async with guaranteed fresh data)
   */
  async getMarketSnapshot(coin: string): Promise<MarketSnapshot | null> {
    await this.ensureDataFresh()
    return this.cache.get(coin.toUpperCase()) ?? null
  }

  /**
   * Get market snapshot synchronously from cache (may be slightly stale)
   * Triggers background refresh if data is old. Use this when you can't await.
   */
  getMarketSnapshotSync(coin: string): MarketSnapshot | null {
    // Trigger background refresh if needed (fire and forget)
    const now = Date.now()
    if (now - this.lastFetch >= this.CACHE_TTL_MS && !this.refreshInProgress) {
      this.refreshInProgress = true
      this.lastFetch = now  // Update immediately to prevent concurrent refresh storms
      this.refreshAllData()
        .catch(err =>
          console.warn('[HyperliquidDataFetcher] Background refresh failed:', err)
        )
        .finally(() => { this.refreshInProgress = false })
    }
    return this.cache.get(coin.toUpperCase()) ?? null
  }

  /**
   * Get snapshots for multiple coins
   */
  async getMarketSnapshots(coins: string[]): Promise<Map<string, MarketSnapshot>> {
    await this.ensureDataFresh()
    const result = new Map<string, MarketSnapshot>()
    for (const coin of coins) {
      const snapshot = this.cache.get(coin.toUpperCase())
      if (snapshot) {
        result.set(coin.toUpperCase(), snapshot)
      }
    }
    return result
  }

  /**
   * Ensure data is fresh, refresh if needed
   */
  private async ensureDataFresh(): Promise<void> {
    const now = Date.now()
    if (now - this.lastFetch < this.CACHE_TTL_MS) {
      return
    }

    try {
      await this.refreshAllData()
      this.lastFetch = now
    } catch (error) {
      console.error('[HyperliquidDataFetcher] Error refreshing data:', error)
      // Keep stale data if refresh fails
    }
  }

  /**
   * Refresh all market data
   */
  private async refreshAllData(): Promise<void> {
    const now = Date.now()

    // 1. Get current market data (OI, price, funding)
    const [, assetCtxs] = await this.api.getMetaAndAssetCtxs()

    // 2. Sort: priority coins FIRST so they get candles before rate limits hit
    const sorted = [...assetCtxs].sort((a, b) => {
      const ap = HyperliquidDataFetcher.PRIORITY_COINS.has(a.coin.toUpperCase()) ? 0 : 1
      const bp = HyperliquidDataFetcher.PRIORITY_COINS.has(b.coin.toUpperCase()) ? 0 : 1
      return ap - bp
    })

    // 3. For each asset, update OI history and calculate momentum
    //    Only fetch candles (expensive) for CANDLE_COINS; others get default momentum
    let candleFetchCount = 0
    for (const ctx of sorted) {
      const coin = ctx.coin.toUpperCase()
      const currentPrice = parseFloat(ctx.midPx || '0')
      const currentOI = parseFloat(ctx.openInterest || '0')
      const fundingRate = parseFloat(ctx.funding || '0')
      const volume24h = parseFloat(ctx.dayNtlVlm || '0')

      if (currentPrice <= 0) continue

      // Update OI history
      this.updateOIHistory(coin, currentOI, currentPrice, now)

      // Calculate OI changes
      const oiData = this.calculateOIChanges(coin, currentOI)

      // Get price momentum — only fetch candles for coins we actually trade
      let momentum: PriceMomentum
      if (HyperliquidDataFetcher.CANDLE_COINS.has(coin)) {
        // Small delay between candle fetches to avoid 429s
        if (candleFetchCount > 0 && candleFetchCount % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 200))
        }
        momentum = await this.calculatePriceMomentum(coin, currentPrice)
        candleFetchCount++
      } else {
        momentum = this.getDefaultMomentum(currentPrice)
      }

      // Detect divergence
      const { divergence, strength } = this.detectDivergence(momentum, oiData)

      // Create snapshot
      const snapshot: MarketSnapshot = {
        coin,
        timestamp: now,
        price: currentPrice,
        openInterest: currentOI,
        fundingRate,
        volume24h,
        momentum,
        oi: oiData,
        divergence,
        divergenceStrength: strength
      }

      this.cache.set(coin, snapshot)
    }

    // Clean up old OI history
    this.cleanupOldHistory(now)
  }

  /**
   * Update OI history for a coin
   */
  private updateOIHistory(coin: string, oi: number, price: number, timestamp: number): void {
    if (!this.oiHistory.has(coin)) {
      this.oiHistory.set(coin, [])
    }

    const history = this.oiHistory.get(coin)!

    // Only add if significantly different from last entry (avoid duplicates)
    const lastEntry = history[history.length - 1]
    if (!lastEntry || timestamp - lastEntry.timestamp >= 60_000) {  // At least 1 min apart
      history.push({ timestamp, oi, price })
    }
  }

  /**
   * Calculate OI changes over different timeframes
   */
  private calculateOIChanges(coin: string, currentOI: number): OIData {
    const history = this.oiHistory.get(coin) || []
    const now = Date.now()

    const findOI = (hoursAgo: number): number | null => {
      const targetTime = now - hoursAgo * 60 * 60 * 1000
      // Find closest entry to target time
      let closest: OIHistoryEntry | null = null
      let minDiff = Infinity

      for (const entry of history) {
        const diff = Math.abs(entry.timestamp - targetTime)
        if (diff < minDiff && entry.timestamp <= targetTime + 5 * 60 * 1000) {  // Allow 5 min tolerance
          minDiff = diff
          closest = entry
        }
      }

      return closest?.oi ?? null
    }

    const oi1hAgo = findOI(1)
    const oi4hAgo = findOI(4)
    const oi24hAgo = findOI(24)

    return {
      current: currentOI,
      change1h: oi1hAgo ? ((currentOI - oi1hAgo) / oi1hAgo) * 100 : 0,
      change4h: oi4hAgo ? ((currentOI - oi4hAgo) / oi4hAgo) * 100 : 0,
      change24h: oi24hAgo ? ((currentOI - oi24hAgo) / oi24hAgo) * 100 : 0
    }
  }

  /**
   * Calculate price momentum from candles
   */
  private async calculatePriceMomentum(coin: string, currentPrice: number): Promise<PriceMomentum> {
    try {
      const now = Date.now()

      // Fetch 1h candles for the last 25 hours
      const candles = await this.api.getCandles(coin, '1h', now - 25 * 60 * 60 * 1000, now)

      if (!candles || candles.length === 0) {
        return this.getDefaultMomentum(currentPrice)
      }

      // Sort by time descending
      candles.sort((a, b) => b.t - a.t)

      // Find prices at different intervals
      const price1hAgo = this.findPriceAtTime(candles, now - 1 * 60 * 60 * 1000)
      const price4hAgo = this.findPriceAtTime(candles, now - 4 * 60 * 60 * 1000)
      const price24hAgo = this.findPriceAtTime(candles, now - 24 * 60 * 60 * 1000)

      // Calculate high/low/volume from candles
      let high24h = currentPrice
      let low24h = currentPrice
      let volume24h = 0

      for (const candle of candles) {
        if (candle.t >= now - 24 * 60 * 60 * 1000) {
          high24h = Math.max(high24h, candle.h)
          low24h = Math.min(low24h, candle.l)
          volume24h += candle.v
        }
      }

      return {
        price: currentPrice,
        change1h: price1hAgo ? ((currentPrice - price1hAgo) / price1hAgo) * 100 : 0,
        change4h: price4hAgo ? ((currentPrice - price4hAgo) / price4hAgo) * 100 : 0,
        change24h: price24hAgo ? ((currentPrice - price24hAgo) / price24hAgo) * 100 : 0,
        high24h,
        low24h,
        volume24h
      }
    } catch (error) {
      console.warn(`[HyperliquidDataFetcher] Failed to get candles for ${coin}:`, error)
      return this.getDefaultMomentum(currentPrice)
    }
  }

  /**
   * Find price closest to target time from candles
   */
  private findPriceAtTime(candles: any[], targetTime: number): number | null {
    let closest: any = null
    let minDiff = Infinity

    for (const candle of candles) {
      const diff = Math.abs(candle.t - targetTime)
      if (diff < minDiff) {
        minDiff = diff
        closest = candle
      }
    }

    // Only use if within 30 min tolerance
    if (closest && minDiff < 30 * 60 * 1000) {
      return closest.c  // Close price
    }

    return null
  }

  /**
   * Default momentum when candles unavailable
   */
  private getDefaultMomentum(price: number): PriceMomentum {
    return {
      price,
      change1h: 0,
      change4h: 0,
      change24h: 0,
      high24h: price,
      low24h: price,
      volume24h: 0
    }
  }

  /**
   * Detect divergence between OI and price movements
   *
   * BULLISH DIVERGENCE: OI falling + Price rising = shorts closing = squeeze UP
   * BEARISH DIVERGENCE: OI falling + Price falling = longs closing = squeeze DOWN
   */
  private detectDivergence(
    momentum: PriceMomentum,
    oi: OIData
  ): { divergence: 'BULLISH' | 'BEARISH' | 'NEUTRAL', strength: number } {

    // Use 1h data for more responsive signals
    const priceChange = momentum.change1h
    const oiChange = oi.change1h

    // Thresholds
    const OI_DROP_THRESHOLD = -1.0     // OI dropping by at least 1%
    const PRICE_MOVE_THRESHOLD = 0.3   // Price moving by at least 0.3%

    let divergence: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
    let strength = 0

    // BULLISH: OI dropping + price rising
    if (oiChange < OI_DROP_THRESHOLD && priceChange > PRICE_MOVE_THRESHOLD) {
      divergence = 'BULLISH'
      // Strength based on magnitude
      const oiStrength = Math.min(Math.abs(oiChange) / 5, 50)  // Max 50 from OI
      const priceStrength = Math.min(priceChange / 2, 50)       // Max 50 from price
      strength = oiStrength + priceStrength
    }

    // BEARISH: OI dropping + price falling
    else if (oiChange < OI_DROP_THRESHOLD && priceChange < -PRICE_MOVE_THRESHOLD) {
      divergence = 'BEARISH'
      const oiStrength = Math.min(Math.abs(oiChange) / 5, 50)
      const priceStrength = Math.min(Math.abs(priceChange) / 2, 50)
      strength = oiStrength + priceStrength
    }

    // Also check 4h data for stronger confirmation
    const priceChange4h = momentum.change4h
    const oiChange4h = oi.change4h

    // Boost strength if 4h confirms
    if (divergence === 'BULLISH' && oiChange4h < -2 && priceChange4h > 0.5) {
      strength = Math.min(strength * 1.5, 100)
    } else if (divergence === 'BEARISH' && oiChange4h < -2 && priceChange4h < -0.5) {
      strength = Math.min(strength * 1.5, 100)
    }

    return { divergence, strength: Math.round(strength) }
  }

  /**
   * Cleanup old OI history entries
   */
  private cleanupOldHistory(now: number): void {
    const cutoff = now - this.OI_HISTORY_RETENTION_MS

    for (const [coin, history] of this.oiHistory) {
      const filtered = history.filter(entry => entry.timestamp >= cutoff)
      if (filtered.length < history.length) {
        this.oiHistory.set(coin, filtered)
      }
    }
  }

  /**
   * Get formatted status for debugging
   */
  getStatus(): string {
    let status = '\n' + '='.repeat(60) + '\n'
    status += 'HYPERLIQUID DATA FETCHER STATUS\n'
    status += '='.repeat(60) + '\n\n'

    status += `Cache entries: ${this.cache.size}\n`
    status += `OI history tracked: ${this.oiHistory.size} coins\n`
    status += `Last fetch: ${this.lastFetch ? new Date(this.lastFetch).toISOString() : 'never'}\n\n`

    // Show top divergences
    const snapshots = Array.from(this.cache.values())
      .filter(s => s.divergence !== 'NEUTRAL')
      .sort((a, b) => b.divergenceStrength - a.divergenceStrength)
      .slice(0, 5)

    if (snapshots.length > 0) {
      status += 'TOP DIVERGENCES:\n'
      status += '-'.repeat(50) + '\n'
      for (const s of snapshots) {
        const emoji = s.divergence === 'BULLISH' ? '🟢' : '🔴'
        status += `  ${emoji} ${s.coin}: ${s.divergence} (${s.divergenceStrength}%) `
        status += `| Price 1h: ${s.momentum.change1h >= 0 ? '+' : ''}${s.momentum.change1h.toFixed(2)}% `
        status += `| OI 1h: ${s.oi.change1h >= 0 ? '+' : ''}${s.oi.change1h.toFixed(2)}%\n`
      }
    }

    status += '\n' + '='.repeat(60) + '\n'
    return status
  }
}

// ============================================
// SINGLETON
// ============================================

let dataFetcherInstance: HyperliquidDataFetcher | null = null

export function getHyperliquidDataFetcher(): HyperliquidDataFetcher {
  if (!dataFetcherInstance) {
    dataFetcherInstance = new HyperliquidDataFetcher()
  }
  return dataFetcherInstance
}
