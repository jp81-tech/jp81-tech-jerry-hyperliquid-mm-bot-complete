/**
 * NANSEN HYPERLIQUID INTEGRATION
 *
 * Correct endpoints for Hyperliquid Perpetual Futures
 * Based on official Nansen API documentation (2025)
 *
 * Key differences from ERC-20 endpoints:
 * - Uses token_symbol (e.g., "BTC", "ETH") instead of contract addresses
 * - Perp-specific endpoints for positions, trades, and leaderboards
 * - No chain parameter needed (Hyperliquid is the exchange)
 */

import axios, { AxiosInstance } from 'axios'
import { RateLimiter } from '../utils/rate_limiter.js'

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export interface HyperliquidLeaderboardEntry {
  wallet_address: string
  total_pnl_usd: number
  win_rate: number
  total_trades: number
  volume_usd: number
  avg_position_size_usd: number
  rank: number
  label?: string // Nansen wallet label if available
}

export interface TokenPerpPosition {
  address: string
  token_symbol: string
  side: 'LONG' | 'SHORT'
  position_size: number
  entry_price: number
  current_price: number
  leverage: number
  unrealized_pnl_usd: number
  liquidation_price?: number
  timestamp: number
}

export interface SmartMoneyPerpTrade {
  tx_hash: string
  timestamp: number
  wallet_address: string
  token_symbol: string
  side: 'buy' | 'sell'
  size: number
  price: number
  value_usd: number
  label?: string // Nansen wallet label
}

export interface PerpPnLLeaderboard {
  token_symbol: string
  leaderboard: Array<{
    wallet_address: string
    total_pnl_usd: number
    realized_pnl_usd: number
    unrealized_pnl_usd: number
    total_volume_usd: number
    win_rate: number
    label?: string
  }>
}

export interface PerpScreenerResult {
  token_symbol: string
  volume_24h_usd: number
  smart_money_volume_usd: number
  smart_money_percentage: number
  net_smart_money_flow_usd: number // positive = accumulation, negative = distribution
  price_change_24h: number
  open_interest_usd: number
  top_trader_sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
}

export interface VisionAdjustment {
  shouldAdjustVision: boolean
  adjustment: 'SOFTEN_BEARISH' | 'SOFTEN_BULLISH' | 'NONE'
  reason: string
  smart_money_bias: number // -1 to 1 (bearish to bullish)
}

export interface RiskAdjustment {
  token_symbol: string
  shouldReduceSize: boolean
  suggested_size_multiplier: number // 0.5 to 1.5
  suggested_spread_multiplier: number // 1.0 to 2.0
  reason: string
  crowding_risk: 'LOW' | 'MEDIUM' | 'HIGH'
}

export interface ExecutionSignal {
  token_symbol: string
  smart_money_bias: number // -1 to 1
  suggested_skew: number // -0.5 to 0.5
  suggested_size_mult: number // 0.8 to 1.5
  confidence: number // 0 to 100
  reason: string
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE CLASS
// ═══════════════════════════════════════════════════════════════

export interface ProxyHealth {
  isHealthy: boolean;
  lastSuccess: number;
  consecutiveFailures: number;
  lastError?: string;
}

export class NansenHyperliquidService {
  private client: AxiosInstance
  private rateLimiter: RateLimiter
  private cache: Map<string, { data: any; timestamp: number }> = new Map()
  private cacheLifetimeMs = 300_000 // 5 minute hard limit for stale data
  private health: ProxyHealth = { isHealthy: true, lastSuccess: Date.now(), consecutiveFailures: 0 }

  constructor(apiKey: string, baseURL: string = 'http://localhost:8080') {
    this.client = axios.create({
      baseURL,
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000
    })
    this.rateLimiter = new RateLimiter(10)
  }

  public getHealth(): ProxyHealth {
    return { ...this.health };
  }

  private updateHealth(success: boolean, error?: string) {
    if (success) {
      this.health.isHealthy = true;
      this.health.lastSuccess = Date.now();
      this.health.consecutiveFailures = 0;
      this.health.lastError = undefined;
    } else {
      this.health.consecutiveFailures++;
      this.health.lastError = error;
      if (this.health.consecutiveFailures >= 3) {
        this.health.isHealthy = false;
      }
    }
  }

  private isEnabled(): boolean {
    return process.env.NANSEN_ENABLED === 'true'
  }

  private getCached<T>(key: string): T | null {
    const cached = this.cache.get(key)
    if (!cached) return null
    if (Date.now() - cached.timestamp > this.cacheLifetimeMs) {
      this.cache.delete(key)
      return null
    }
    return cached.data as T
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() })
  }

  private async requestWithRetry<T>(
    endpoint: string,
    params: any,
    maxRetries: number = 2
  ): Promise<T | null> {
    if (!this.isEnabled()) return null

    const cacheKey = `${endpoint}_${JSON.stringify(params)}`
    const cached = this.getCached<T>(cacheKey)
    if (cached) return cached

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.rateLimiter.waitForSlot()

        const response = await this.client.post(endpoint, params)

        if (response.status === 200 && response.data) {
          this.setCache(cacheKey, response.data)
          return response.data as T
        }
      } catch (error: any) {
        const status = error.response?.status

        if (status === 404) {
          console.warn(`[Nansen HL] Endpoint not found: ${endpoint}`)
          return null
        }

        if (status === 422) {
          console.warn(`[Nansen HL] Invalid params for ${endpoint}:`, error.response?.data)
          return null
        }

        if (status === 429 && attempt < maxRetries) {
          console.warn(`[Nansen HL] Rate limited, retry ${attempt + 1}/${maxRetries}`)
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
          continue
        }

        if (attempt === maxRetries) {
          console.error(`[Nansen HL] Failed after ${maxRetries} retries:`, error.message)
          return null
        }
      }
    }

    return null
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. HYPERLIQUID LEADERBOARD
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get top performing traders on Hyperliquid
   * Endpoint: /api/hyperliquid-leaderboard (proxy)
   */
  async getHyperliquidLeaderboard(
    period: '24h' | '7d' | '30d' = '24h',
    limit: number = 50
  ): Promise<HyperliquidLeaderboardEntry[]> {
    const data = await this.requestWithRetry<{ success: boolean; data: any }>(
      '/api/hyperliquid-leaderboard',
      {
        period,
        limit
      }
    )

    if (!data?.success || !data?.data) return []

    // Parse MCP response
    const content = data.data?.content?.[0]?.text || ''
    console.log('[Nansen HL] Leaderboard response:', content.substring(0, 200))
    return []
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. TOKEN PERP POSITIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get all open positions for a specific token
   * Endpoint: /api/token-perp-positions (proxy)
   */
  async getTokenPerpPositions(
    tokenSymbol: string,
    minSizeUsd: number = 10000
  ): Promise<TokenPerpPosition[]> {
    const data = await this.requestWithRetry<{ success: boolean; data: any }>(
      '/api/token-perp-positions',
      {
        token_symbol: tokenSymbol,
        min_size_usd: minSizeUsd
      }
    )

    if (!data?.success || !data?.data) return []

    // Parse MCP response - extract content from result
    const content = data.data?.content?.[0]?.text || ''

    // Parse markdown table or JSON from response
    // For now, return empty array - need to see actual response format
    console.log('[Nansen HL] Token perp positions response:', content.substring(0, 200))
    return []
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. SMART MONEY PERP TRADES
  // ═══════════════════════════════════════════════════════════════

  /**
   * Track real-time Smart Money trading activity
   * Endpoint: /api/smart-money-perp-trades (proxy)
   */
  async getSmartMoneyPerpTrades(
    tokenSymbol: string,
    lookbackMinutes: number = 60
  ): Promise<SmartMoneyPerpTrade[]> {
    const data = await this.requestWithRetry<{ success: boolean; data: any }>(
      '/api/smart-money-perp-trades',
      {
        token_symbol: tokenSymbol,
        lookback_minutes: lookbackMinutes
      }
    )

    if (!data?.success || !data?.data) return []

    // Parse MCP response
    const content = data.data?.content?.[0]?.text || ''
    console.log('[Nansen HL] Smart money trades response:', content.substring(0, 200))
    return []
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. PERP PNL LEADERBOARD (TOKEN-SPECIFIC)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get most profitable traders on specific token
   * Endpoint: NOT IMPLEMENTED YET - no proxy endpoint
   */
  async getPerpPnLLeaderboard(
    tokenSymbol: string,
    period: '24h' | '7d' | '30d' = '24h',
    limit: number = 25
  ): Promise<PerpPnLLeaderboard> {
    console.warn('[Nansen HL] getPerpPnLLeaderboard not implemented - proxy endpoint needed')
    return { token_symbol: tokenSymbol, leaderboard: [] }
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. PERP SCREENER
  // ═══════════════════════════════════════════════════════════════

  /**
   * Screen perp markets for Smart Money activity
   * Endpoint: NOT IMPLEMENTED YET - no proxy endpoint
   */
  async screenPerpMarkets(
    minVolume24hUsd: number = 1_000_000,
    minSmartMoneyPct: number = 10
  ): Promise<PerpScreenerResult[]> {
    console.warn('[Nansen HL] screenPerpMarkets not implemented - proxy endpoint needed')
    return []
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. VISION MODULE INTEGRATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Analyze Smart Money positions to adjust Vision bias
   *
   * NEW: Fetches data from Data Provider API instead of direct MCP calls
   *
   * Use case: If BTC Vision is "bear" but top traders are 70% long,
   * soften the bearish bias to avoid fighting Smart Money
   */
  async getVisionAdjustment(tokenSymbol: string = 'BTC'): Promise<VisionAdjustment> {
    if (!this.isEnabled()) {
      return {
        shouldAdjustVision: false,
        adjustment: 'NONE',
        reason: 'Nansen integration disabled',
        smart_money_bias: 0
      }
    }

    // ⚠️ FIX: Add cache to prevent excessive API calls
    const cacheKey = `vision_adj_${tokenSymbol}`
    const cached = this.getCached<VisionAdjustment>(cacheKey)
    if (cached) return cached

    try {
      // ⚠️ FIX: Use rate limiter before API call
      await this.rateLimiter.waitForSlot()

      // Fetch Smart Money bias from Data Provider API
      // FIX: Use correct endpoint /api/hl_bias/ which exists in nansen-bridge.mjs
      const response = await this.client.get(`/api/hl_bias/${tokenSymbol}`)

      if (!response || !response.data?.success || !response.data?.data) {
        throw new Error('Invalid response from Data Provider')
      }

      const biasData = response.data.data
      // FIX: Proxy returns 'bias' not 'positionBias' - use bias as fallback
      const { bias, positionBias: rawPositionBias, whale_activity } = biasData
      const positionBias = rawPositionBias ?? bias ?? 0.5 // Use bias if positionBias undefined
      const longPct = positionBias * 100 // Convert 0..1 to percentage
      const totalPositions = whale_activity?.position_count || biasData.sm_holders || 0
      const numericBias = (positionBias - 0.5) * 2 // Convert 0..1 to -1..1

      // Decision logic
      const STRONG_BIAS_THRESHOLD = 0.4 // 70% long or 30% long

      let result: VisionAdjustment

      if (Math.abs(numericBias) > STRONG_BIAS_THRESHOLD) {
        const adjustment = numericBias > 0 ? 'SOFTEN_BEARISH' : 'SOFTEN_BULLISH'
        result = {
          shouldAdjustVision: true,
          adjustment,
          reason: `Smart Money is ${longPct.toFixed(1)}% long on ${tokenSymbol} (${totalPositions} positions)`,
          smart_money_bias: numericBias
        }
      } else {
        result = {
          shouldAdjustVision: false,
          adjustment: 'NONE',
          reason: `Smart Money balanced at ${longPct.toFixed(1)}% long (bias=${bias})`,
          smart_money_bias: numericBias
        }
      }

      // ⚠️ FIX: Cache result for 2 minutes (same as updateIntervalMs)
      this.setCache(cacheKey, result)
      return result

    } catch (error: any) {
      console.warn(`[Nansen HL] Failed to fetch bias for ${tokenSymbol}:`, error.message)

      // Return safe default (don't cache errors)
      return {
        shouldAdjustVision: false,
        adjustment: 'NONE',
        reason: `Data Provider unavailable: ${error.message}`,
        smart_money_bias: 0
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. RISK MANAGEMENT INTEGRATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Analyze position crowding to adjust risk parameters
   *
   * Use case: If ZEC has extremely high short positions (crowding),
   * increase spread and reduce size to protect against short squeeze
   */
  async getRiskAdjustment(tokenSymbol: string): Promise<RiskAdjustment> {
    const positions = await this.getTokenPerpPositions(tokenSymbol, 10000)

    if (!positions || positions.length === 0) {
      return {
        token_symbol: tokenSymbol,
        shouldReduceSize: false,
        suggested_size_multiplier: 1.0,
        suggested_spread_multiplier: 1.0,
        reason: 'No position data',
        crowding_risk: 'LOW'
      }
    }

    // Calculate position imbalance
    let longCount = 0
    let shortCount = 0
    let longUsd = 0
    let shortUsd = 0

    positions.forEach(pos => {
      const sizeUsd = Math.abs(pos.position_size * pos.current_price)
      if (pos.side === 'LONG') {
        longCount++
        longUsd += sizeUsd
      } else {
        shortCount++
        shortUsd += sizeUsd
      }
    })

    const totalUsd = longUsd + shortUsd
    const imbalance = Math.abs(longUsd - shortUsd) / totalUsd
    const dominantSide = longUsd > shortUsd ? 'LONG' : 'SHORT'

    // Crowding detection
    const HIGH_CROWDING = 0.7 // 85% on one side
    const MEDIUM_CROWDING = 0.4 // 70% on one side

    let crowdingRisk: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW'
    let sizeMult = 1.0
    let spreadMult = 1.0
    let shouldReduce = false

    if (imbalance > HIGH_CROWDING) {
      crowdingRisk = 'HIGH'
      sizeMult = 0.6
      spreadMult = 1.5
      shouldReduce = true
    } else if (imbalance > MEDIUM_CROWDING) {
      crowdingRisk = 'MEDIUM'
      sizeMult = 0.8
      spreadMult = 1.2
      shouldReduce = true
    }

    return {
      token_symbol: tokenSymbol,
      shouldReduceSize: shouldReduce,
      suggested_size_multiplier: sizeMult,
      suggested_spread_multiplier: spreadMult,
      reason: `${dominantSide} crowding: ${(imbalance * 100).toFixed(1)}% imbalance ($${(totalUsd / 1e6).toFixed(1)}M, ${positions.length} positions)`,
      crowding_risk: crowdingRisk
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 8. EXECUTION MODULE INTEGRATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Analyze recent Smart Money trades to adjust order skew and size
   *
   * Use case: If Smart Money is aggressively buying HYPE in last 15 min,
   * skew bids larger and increase bid size multiplier
   */
  async getExecutionSignal(tokenSymbol: string): Promise<ExecutionSignal> {
    const trades = await this.getSmartMoneyPerpTrades(tokenSymbol, 15)

    if (!trades || trades.length === 0) {
      return {
        token_symbol: tokenSymbol,
        smart_money_bias: 0,
        suggested_skew: 0,
        suggested_size_mult: 1.0,
        confidence: 0,
        reason: 'No recent Smart Money activity'
      }
    }

    // Analyze trade direction
    let buyVolumeUsd = 0
    let sellVolumeUsd = 0

    trades.forEach(trade => {
      if (trade.side === 'buy') {
        buyVolumeUsd += trade.value_usd
      } else {
        sellVolumeUsd += trade.value_usd
      }
    })

    const totalVolumeUsd = buyVolumeUsd + sellVolumeUsd
    const netBuyPct = totalVolumeUsd > 0 ? ((buyVolumeUsd - sellVolumeUsd) / totalVolumeUsd) * 100 : 0
    const bias = netBuyPct / 100 // -1 to 1

    // Calculate confidence based on volume and trade count
    const MIN_VOLUME_FOR_SIGNAL = 50000 // $50k minimum
    const confidence = Math.min(100, (totalVolumeUsd / MIN_VOLUME_FOR_SIGNAL) * 50 + trades.length * 2)

    // Generate execution adjustments
    let skew = 0
    let sizeMult = 1.0

    if (confidence > 50 && Math.abs(bias) > 0.3) {
      // Strong signal
      skew = bias * 0.3 // -0.3 to 0.3
      sizeMult = 1.0 + Math.abs(bias) * 0.3 // 1.0 to 1.3
    } else if (confidence > 30 && Math.abs(bias) > 0.2) {
      // Moderate signal
      skew = bias * 0.15
      sizeMult = 1.0 + Math.abs(bias) * 0.15
    }

    return {
      token_symbol: tokenSymbol,
      smart_money_bias: bias,
      suggested_skew: skew,
      suggested_size_mult: sizeMult,
      confidence: Math.round(confidence),
      reason: `${trades.length} SM trades, ${netBuyPct > 0 ? '+' : ''}${netBuyPct.toFixed(1)}% net buy ($${(totalVolumeUsd / 1000).toFixed(0)}k vol)`
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 9. UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get comprehensive Smart Money analysis for a token
   */
  async getSmartMoneyAnalysis(tokenSymbol: string): Promise<{
    vision: VisionAdjustment
    risk: RiskAdjustment
    execution: ExecutionSignal
    timestamp: number
  }> {
    const [vision, risk, execution] = await Promise.all([
      this.getVisionAdjustment(tokenSymbol),
      this.getRiskAdjustment(tokenSymbol),
      this.getExecutionSignal(tokenSymbol)
    ])

    return {
      vision,
      risk,
      execution,
      timestamp: Date.now()
    }
  }

  /**
   * Get Smart Money signal for a token (used by market_vision.ts)
   * ⚠️ FIX: Added missing method to prevent runtime errors
   */
  async getSmartMoneySignal(tokenSymbol: string): Promise<{ long_short_ratio: number } | null> {
    if (!this.isEnabled()) return null

    // ⚠️ FIX: Use cache to prevent excessive API calls
    const cacheKey = `sm_signal_${tokenSymbol}`
    const cached = this.getCached<{ long_short_ratio: number }>(cacheKey)
    if (cached) return cached

    try {
      // ⚠️ FIX: Use rate limiter before API call
      await this.rateLimiter.waitForSlot()

      // Fetch Smart Money bias from Data Provider API
      // FIX: Use correct endpoint /api/hl_bias/
      const response = await this.client.get(`/api/hl_bias/${tokenSymbol}`)

      if (!response || !response.data?.success || !response.data?.data) {
        return null
      }

      const biasData = response.data.data
      const longPct = (biasData.positionBias || 0.5) * 100
      const shortPct = 100 - longPct

      // Calculate long/short ratio
      const longShortRatio = shortPct > 0 ? longPct / shortPct : (longPct > 0 ? 999 : 0)

      const result = { long_short_ratio: longShortRatio }

      // ⚠️ FIX: Cache result for 2 minutes
      this.setCache(cacheKey, result)
      return result

    } catch (error: any) {
      console.warn(`[Nansen HL] Failed to fetch SM signal for ${tokenSymbol}:`, error.message)
      return null
    }
  }

  /**
   * Compatibility method for old NansenProAPI
   */
  async getGenericTokenGuard(address: string, chain: string): Promise<{ spreadMult: number; pause: boolean; reason?: string }> {
    return { spreadMult: 1.0, pause: false, reason: 'Compatibility mode' }
  }

  /**
   * Compatibility method for old NansenProAPI risk scoring
   */
  async getThrottledTokenRiskScore(address: string, chain: string): Promise<any> {
    return {
      score: 5,
      components: {
        holderRiskLevel: 'LOW',
        exchangeFlowUsd: 0,
        whaleFlowUsd: 0,
        smartMoneyFlowUsd: 0
      }
    }
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear()
  }
}

// ═══════════════════════════════════════════════════════════════
// GOLDEN DUO STRATEGY INTEGRATION
// ═══════════════════════════════════════════════════════════════

/**
 * Golden Duo Signal Interface
 *
 * Two-signal approach for predictive market making:
 * - Position Bias (STRATEGIA): Long-term view → inventory limits
 * - Flow Skew (TAKTYKA): Short-term view → price skewing
 */
export interface GoldenDuoSignal {
  symbol: string
  positionBias: number  // -1.0 (Bear) to 1.0 (Bull)
  flowSkew: number      // -1.0 (Sell Flow) to 1.0 (Buy Flow)
}

/**
 * Calculate Position Bias from aggregated Smart Money positions
 *
 * @param data - Response from /api/token-perp-positions
 * @returns Number from -1.0 (strong bearish) to 1.0 (strong bullish)
 */
function calculatePositionBias(data: any): number {
  const positions = data.result || data
  if (!Array.isArray(positions) || positions.length === 0) {
    return 0
  }

  let totalLong = 0
  let totalShort = 0

  positions.forEach((pos: any) => {
    const size = Number(pos.net_position_size || pos.position_size || 0)
    if (size > 0) {
      totalLong += size
    } else {
      totalShort += Math.abs(size)
    }
  })

  const total = totalLong + totalShort
  if (total === 0) return 0

  // Formula: (Long - Short) / (Long + Short)
  // Returns -1.0 (all short) to 1.0 (all long)
  return (totalLong - totalShort) / total
}

/**
 * Calculate Flow Skew from recent Smart Money trades
 *
 * @param data - Response from /api/smart-money-perp-trades
 * @returns Number from -1.0 (strong sell flow) to 1.0 (strong buy flow)
 */
function calculateFlowSkew(data: any): number {
  const trades = data.result || data
  if (!Array.isArray(trades) || trades.length === 0) {
    return 0
  }

  const NOW = Date.now()
  const WINDOW_MS = 15 * 60 * 1000 // 15 minutes

  let buyVol = 0
  let sellVol = 0

  trades.forEach((trade: any) => {
    // Parse timestamp
    const tradeTime = new Date(trade.timestamp || trade.time).getTime()
    if (NOW - tradeTime > WINDOW_MS) return // Skip old trades

    const vol = Number(trade.volume_usd || trade.value_usd || 0)
    const side = (trade.side || '').toLowerCase()

    if (side === 'buy' || side === 'long' || side === 'add') {
      buyVol += vol
    } else if (side === 'sell' || side === 'short' || side === 'reduce') {
      sellVol += vol
    }
  })

  const totalVol = buyVol + sellVol
  if (totalVol === 0) return 0

  // Formula: (Buy - Sell) / Total
  // Returns -1.0 (all sell) to 1.0 (all buy)
  return (buyVol - sellVol) / totalVol
}

/**
 * Get Golden Duo Signal for a token
 *
 * Fetches BOTH signals in parallel from Golden Duo Proxy:
 * 1. Position Bias (STRATEGIA) - aggregated positions
 * 2. Flow Skew (TAKTYKA) - recent 15min trades
 *
 * @param symbol - Token symbol (e.g., "BTC", "ETH", "HYPE")
 * @returns Golden Duo signal with both bias and skew values
 */
export async function getGoldenDuoSignal(symbol: string): Promise<GoldenDuoSignal> {
  const PROXY_URL = process.env.NANSEN_PROXY_URL || 'http://127.0.0.1:3456'

  try {
    // Fetch both signals in parallel
    const [posResponse, flowResponse] = await Promise.all([
      axios.post(`${PROXY_URL}/api/token-perp-positions`, {
        token_symbol: symbol,
        min_size_usd: 10000
      }),
      axios.post(`${PROXY_URL}/api/smart-money-perp-trades`, {
        token_symbol: symbol,
        lookback_minutes: 15
      })
    ])

    // Calculate signals
    const positionBias = calculatePositionBias(posResponse?.data?.data || posResponse?.data || {})
    const flowSkew = calculateFlowSkew(flowResponse?.data?.data || flowResponse?.data || {})

    return {
      symbol,
      positionBias,
      flowSkew
    }

  } catch (error: any) {
    console.warn(`[Golden Duo] Failed to fetch signal for ${symbol}:`, error.message)

    // Return neutral signal on error
    return {
      symbol,
      positionBias: 0,
      flowSkew: 0
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORT SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

let nansenHLInstance: NansenHyperliquidService | null = null

export function getNansenHyperliquidService(): NansenHyperliquidService | null {
  if (process.env.NANSEN_ENABLED !== 'true') {
    return null
  }

  const apiKey = process.env.NANSEN_API_KEY
  if (!apiKey) {
    console.warn('[Nansen HL] No API key found')
    return null
  }

  const baseURL = process.env.NANSEN_PROXY_URL || 'http://localhost:8080'

  if (!nansenHLInstance) {
    nansenHLInstance = new NansenHyperliquidService(apiKey, baseURL)
    console.log(`[Nansen HL] Service initialized at ${baseURL} ✅`)
  }

  return nansenHLInstance
}
