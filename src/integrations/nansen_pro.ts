/**
 * NANSEN PRO SUITE - Complete Integration for Hyperliquid
 *
 * Features:
 * 1. Copy-Trading Top Performers (Perp Leaderboard + Positions)
 * 2. Smart Money Netflow Tracking (5000 top wallets)
 * 3. Token Risk Analysis (Holder concentration)
 * 4. Flow Intelligence (Multi-source aggregation)
 */

import axios, { AxiosInstance } from 'axios'

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export interface NansenPerpTrader {
  wallet_address: string
  total_pnl_usd: number
  win_rate: number
  total_trades: number
  volume_usd: number
  avg_position_size_usd: number
  rank: number
}

export interface NansenPerpPosition {
  wallet_address: string
  token_symbol: string
  side: 'LONG' | 'SHORT'
  size: number
  entry_price: number
  current_price: number
  unrealized_pnl_usd: number
  leverage: number
  timestamp: number
}

export interface NansenSmartMoneyNetflow {
  token_symbol: string
  chain: string
  netflow_usd: number
  inflow_usd: number
  outflow_usd: number
  wallet_count: number
  avg_netflow_per_wallet: number
}

export interface NansenTokenHolder {
  address: string
  category: 'fund' | 'whale' | 'smart_lp' | 'retail'
  balance: number
  percentage: number
  value_usd: number
}

export interface NansenFlowIntelligence {
  token_symbol: string
  exchange_flow_usd: number
  whale_flow_usd: number
  smart_money_flow_usd: number
  total_flow_usd: number
  flow_direction: 'IN' | 'OUT' | 'NEUTRAL'
  confidence: number
}

export interface CopyTradingSignal {
  token_symbol: string
  side: 'LONG' | 'SHORT'
  confidence: number  // 0-100
  trader_count: number
  avg_entry_price: number
  total_position_usd: number
  reason: string
}

// ═══════════════════════════════════════════════════════════════
// NANSEN PRO API CLIENT
// ═══════════════════════════════════════════════════════════════

export class NansenProAPI {
  private client: AxiosInstance
  private apiKey: string
  private cache: Map<string, { data: any; timestamp: number }> = new Map()
  private cacheTtlMs = 300000 // 5 minutes for most endpoints

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.NANSEN_API_KEY || ''

    this.client = axios.create({
      baseURL: 'https://api.nansen.ai/api/v1',
      timeout: 15000,
      headers: {
        'apiKey': this.apiKey,
        'Content-Type': 'application/json'
      }
    })

    if (!this.apiKey) {
      console.warn('[Nansen Pro] No API key - features disabled')
    }
  }

  isEnabled(): boolean {
    return this.apiKey.length > 0 && process.env.NANSEN_ENABLED === 'true'
  }

  private getCached<T>(key: string, ttlMs?: number): T | null {
    const cached = this.cache.get(key)
    const maxAge = ttlMs || this.cacheTtlMs

    if (cached && Date.now() - cached.timestamp < maxAge) {
      return cached.data as T
    }
    return null
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() })
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. COPY-TRADING: TOP PERFORMERS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get top profitable Hyperliquid traders (leaderboard)
   * Uses /perp-screener for market data
   */
  async getPerpLeaderboard(limit: number = 100): Promise<NansenPerpTrader[]> {
    if (!this.isEnabled()) return []

    const cacheKey = `perp_leaderboard_${limit}`
    const cached = this.getCached<NansenPerpTrader[]>(cacheKey, 3600000) // 1h cache
    if (cached) return cached

    try {
      // Using perp-screener to get active tokens
      const now = new Date()
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000)

      const response = await this.client.post('/perp-screener', {
        date: {
          from: sevenDaysAgo.toISOString(),
          to: now.toISOString()
        },
        pagination: {
          page: 1,
          per_page: limit
        }
      })

      const traders: NansenPerpTrader[] = response.data.data || []
      this.setCache(cacheKey, traders)

      console.log(`[Nansen Pro] Loaded ${traders.length} top traders`)
      return traders
    } catch (error: any) {
      console.error(`[Nansen Pro] Perp leaderboard failed:`, error.message)
      return []
    }
  }

  /**
   * Get top traders for specific token using PnL leaderboard
   * Endpoint: /tgm/perp-pnl-leaderboard
   */
  async getTopTradersForToken(tokenSymbol: string, limit: number = 20): Promise<any[]> {
    if (!this.isEnabled()) return []

    try {
      const now = new Date()
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000)

      const response = await this.client.post('/tgm/perp-pnl-leaderboard', {
        token_symbol: tokenSymbol,
        date: {
          from: sevenDaysAgo.toISOString(),
          to: now.toISOString()
        },
        pagination: { page: 1, per_page: limit }
      })

      const traders = response.data.data || []
      console.log(`[Nansen Pro] Found ${traders.length} top traders for ${tokenSymbol}`)
      return traders
    } catch (error: any) {
      console.error(`[Nansen Pro] PnL leaderboard for ${tokenSymbol} failed:`, error.message)
      return []
    }
  }

  /**
   * Get actual positions for a specific wallet address
   * Endpoint: /profiler/perp-positions (WORKING!)
   */
  async getWalletPositions(walletAddress: string): Promise<any> {
    if (!this.isEnabled()) return null

    try {
      const response = await this.client.post('/profiler/perp-positions', {
        address: walletAddress
      })

      return response.data.data || null
    } catch (error: any) {
      console.error(`[Nansen Pro] Wallet positions for ${walletAddress} failed:`, error.message)
      return null
    }
  }

  /**
   * Get current positions of top traders
   * Uses real wallet positions via /profiler/perp-positions
   */
  async getTopTraderPositions(walletAddresses: string[]): Promise<NansenPerpPosition[]> {
    if (!this.isEnabled() || walletAddresses.length === 0) return []

    try {
      const allPositions: NansenPerpPosition[] = []

      // Fetch positions for each wallet (with rate limiting)
      for (let i = 0; i < Math.min(walletAddresses.length, 10); i++) {
        const wallet = walletAddresses[i]

        try {
          const walletData = await this.getWalletPositions(wallet)

          if (walletData?.asset_positions) {
            for (const assetPos of walletData.asset_positions) {
              const pos = assetPos.position
              if (!pos) continue

              const size = Math.abs(parseFloat(pos.size))
              if (size === 0) continue

              allPositions.push({
                wallet_address: wallet,
                token_symbol: pos.token_symbol,
                side: parseFloat(pos.size) > 0 ? 'LONG' : 'SHORT',
                size: size,
                entry_price: parseFloat(pos.entry_price_usd),
                current_price: parseFloat(pos.entry_price_usd), // Approximate
                unrealized_pnl_usd: 0,
                leverage: pos.leverage_value || 1,
                timestamp: Date.now()
              })
            }
          }

          // Rate limit: 200ms between requests
          if (i < walletAddresses.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200))
          }
        } catch (error) {
          console.error(`[Nansen Pro] Failed to get positions for ${wallet}`)
        }
      }

      console.log(`[Nansen Pro] Loaded ${allPositions.length} real positions from ${Math.min(walletAddresses.length, 10)} traders`)
      return allPositions
    } catch (error: any) {
      console.error(`[Nansen Pro] Positions fetch failed:`, error.message)
      return []
    }
  }

  /**
   * Generate copy-trading signals from top trader positions
   * Uses real PnL leaderboard data from top tokens
   */
  async getCopyTradingSignals(minConfidence: number = 60, minTraders: number = 3): Promise<CopyTradingSignal[]> {
    if (!this.isEnabled()) return []

    try {
      // Get top tokens from perp screener
      const topTokens = await this.getPerpLeaderboard(10)
      if (topTokens.length === 0) return []

      const signals: CopyTradingSignal[] = []

      // For each top token, get the top traders
      for (const token of topTokens.slice(0, 5)) {  // Limit to top 5 tokens to avoid rate limits
        const tokenSymbol = (token as any).token_symbol
        if (!tokenSymbol) continue

        try {
          // Get top traders for this specific token using PnL leaderboard
          const traders = await this.getTopTradersForToken(tokenSymbol, 10)
          if (traders.length < minTraders) continue

          // Get their wallet addresses
          const topWallets = traders.slice(0, 10).map((t: any) => t.trader_address).filter(Boolean)
          if (topWallets.length === 0) continue

          // Get their current positions using profiler endpoint
          const positions = await this.getTopTraderPositions(topWallets)

          // Filter positions for this specific token
          const tokenPositions = positions.filter(p => p.token_symbol === tokenSymbol)

          if (tokenPositions.length < minTraders) continue

          // Separate into longs and shorts
          const longs = tokenPositions.filter(p => p.side === 'LONG')
          const shorts = tokenPositions.filter(p => p.side === 'SHORT')

          const totalTraders = tokenPositions.length
          const longCount = longs.length
          const shortCount = shorts.length

          // Determine consensus
          const consensus = longCount > shortCount ? 'LONG' : 'SHORT'
          const majorityCount = Math.max(longCount, shortCount)

          // Calculate confidence (% of traders on same side)
          const confidence = (majorityCount / totalTraders) * 100

          if (confidence < minConfidence) continue

          // Calculate average entry and total size
          const relevantPositions = consensus === 'LONG' ? longs : shorts
          const avgEntry = relevantPositions.reduce((sum, p) => sum + p.entry_price, 0) / relevantPositions.length
          const totalSize = relevantPositions.reduce((sum, p) => sum + p.size, 0)

          signals.push({
            token_symbol: tokenSymbol,
            side: consensus,
            confidence: Math.round(confidence),
            trader_count: majorityCount,
            avg_entry_price: avgEntry,
            total_position_usd: totalSize * avgEntry,  // Size * price for USD value
            reason: `${majorityCount}/${totalTraders} top traders ${consensus}`
          })

          // Rate limit between tokens
          await new Promise(resolve => setTimeout(resolve, 300))

        } catch (tokenError: any) {
          console.warn(`[Nansen Pro] Failed to process ${tokenSymbol}:`, tokenError.message)
          continue
        }
      }

      // Sort by confidence
      signals.sort((a, b) => b.confidence - a.confidence)

      console.log(`[Nansen Pro] Generated ${signals.length} copy-trading signals`)
      for (const sig of signals.slice(0, 5)) {
        console.log(`  ${sig.token_symbol}: ${sig.side} @ $${sig.avg_entry_price.toFixed(2)} | ${sig.confidence}% confidence (${sig.trader_count} traders)`)
      }

      return signals
    } catch (error: any) {
      console.error(`[Nansen Pro] Copy-trading signals failed:`, error.message)
      return []
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. SMART MONEY NETFLOW TRACKING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get smart money netflows (top 5000 wallets)
   */
  async getSmartMoneyNetflows(tokens: string[], chain: string = 'ethereum'): Promise<NansenSmartMoneyNetflow[]> {
    if (!this.isEnabled() || tokens.length === 0) return []

    const cacheKey = `sm_netflow_${tokens.join(',')}_${chain}`
    const cached = this.getCached<NansenSmartMoneyNetflow[]>(cacheKey)
    if (cached) return cached

    try {
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      const now = new Date().toISOString()

      const response = await this.client.post('/smart-money/netflows', {
        tokens: tokens,
        chain: chain,
        date: { from: yesterday, to: now },
        wallet_category: 'smart_money' // top 5000 performers
      })

      const netflows: NansenSmartMoneyNetflow[] = response.data.netflows || []
      this.setCache(cacheKey, netflows)

      console.log(`[Nansen Pro] Smart Money netflows for ${tokens.length} tokens:`)
      for (const nf of netflows.slice(0, 5)) {
        const flow = nf.netflow_usd > 0 ? '🟢 IN' : '🔴 OUT'
        console.log(`  ${nf.token_symbol}: ${flow} $${(Math.abs(nf.netflow_usd) / 1000000).toFixed(2)}M | ${nf.wallet_count} wallets`)
      }

      return netflows
    } catch (error: any) {
      console.error(`[Nansen Pro] Smart money netflows failed:`, error.message)
      return []
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. TOKEN RISK ANALYSIS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Analyze token holder concentration (manipulation risk)
   */
  async analyzeTokenRisk(token: string, chain: string = 'ethereum'): Promise<{
    top10Concentration: number
    smartMoneyHolders: number
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
    reason: string
  }> {
    if (!this.isEnabled()) {
      return { top10Concentration: 0, smartMoneyHolders: 0, riskLevel: 'MEDIUM', reason: 'Nansen disabled' }
    }

    try {
      const response = await this.client.post('/tgm/holders', {
        token: token,
        chain: chain,
        limit: 100
      })

      const holders: NansenTokenHolder[] = response.data.holders || []

      // Calculate top 10 concentration
      const top10 = holders.slice(0, 10)
      const top10Concentration = top10.reduce((sum, h) => sum + h.percentage, 0)

      // Count smart money holders
      const smartMoneyHolders = holders.filter(h =>
        h.category === 'fund' || h.category === 'smart_lp'
      ).length

      // Determine risk
      const maxTop10 = parseFloat(process.env.MAX_TOP10_CONCENTRATION || '50')
      const minSmartMoney = parseInt(process.env.MIN_SMART_MONEY_HOLDERS || '10')

      let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM'
      let reason = ''

      if (top10Concentration > maxTop10) {
        riskLevel = 'HIGH'
        reason = `Top 10 hold ${top10Concentration.toFixed(1)}% (max ${maxTop10}%)`
      } else if (smartMoneyHolders < minSmartMoney) {
        riskLevel = 'HIGH'
        reason = `Only ${smartMoneyHolders} smart money holders (min ${minSmartMoney})`
      } else {
        riskLevel = 'LOW'
        reason = `Healthy distribution: ${top10Concentration.toFixed(1)}% top10, ${smartMoneyHolders} smart holders`
      }

      return { top10Concentration, smartMoneyHolders, riskLevel, reason }
    } catch (error: any) {
      console.error(`[Nansen Pro] Token risk analysis failed:`, error.message)
      return { top10Concentration: 0, smartMoneyHolders: 0, riskLevel: 'MEDIUM', reason: 'Analysis failed' }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. FLOW INTELLIGENCE (Multi-source)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get comprehensive flow intelligence (exchanges + whales + smart money)
   */
  async getFlowIntelligence(tokens: string[], chain: string = 'ethereum'): Promise<NansenFlowIntelligence[]> {
    if (!this.isEnabled() || tokens.length === 0) return []

    try {
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      const now = new Date().toISOString()

      const response = await this.client.post('/tgm/flow-intelligence', {
        tokens: tokens,
        chain: chain,
        date: { from: yesterday, to: now }
      })

      const flows: NansenFlowIntelligence[] = response.data.flows || []

      console.log(`[Nansen Pro] Flow Intelligence for ${tokens.length} tokens:`)
      for (const flow of flows.slice(0, 5)) {
        const direction = flow.flow_direction === 'IN' ? '📈 INFLOW' : flow.flow_direction === 'OUT' ? '📉 OUTFLOW' : '➡️ NEUTRAL'
        console.log(`  ${flow.token_symbol}: ${direction} | Exchange: $${(flow.exchange_flow_usd / 1000000).toFixed(2)}M | Confidence: ${flow.confidence}%`)
      }

      return flows
    } catch (error: any) {
      console.error(`[Nansen Pro] Flow intelligence failed:`, error.message)
      return []
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════

  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Health check - verify API key is working
   */
  async healthCheck(): Promise<boolean> {
    if (!this.isEnabled()) return false

    try {
      const traders = await this.getPerpLeaderboard(5)
      return traders.length > 0
    } catch {
      return false
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

let nansenProInstance: NansenProAPI | null = null

export function getNansenProAPI(): NansenProAPI {
  if (!nansenProInstance) {
    nansenProInstance = new NansenProAPI()
  }
  return nansenProInstance
}
