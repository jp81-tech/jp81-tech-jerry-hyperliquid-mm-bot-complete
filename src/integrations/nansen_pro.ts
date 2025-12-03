/**
 * NANSEN PRO SUITE - Complete Integration for Hyperliquid
 *
 * Features:
 * 1. Copy-Trading Top Performers (Perp Leaderboard + Positions)
 * 2. Smart Money Netflow Tracking (5000 top wallets)
 * 3. Token Risk Analysis (Holder concentration)
 * 4. Flow Intelligence (Multi-source aggregation)
 * 5. Token God Mode (DEX Trades, Transfers, Holders)
 * 6. Smart Money Activities (DEX Trades, Holdings)
 * 7. Hyperliquid Specific (Perp Positions, SM Perp Trades)
 * 8. Whale & Entity Tracking (Wintermute, Jump, etc.)
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
  balance_change_usd_24h?: number
  label?: string
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

export interface NansenDexTrade {
  tx_hash: string
  block_time: string
  side: 'buy' | 'sell'
  value_usd: number
  amount_token: number
  price_usd: number
  address: string
  label?: string
  token_symbol: string
}

export interface NansenPerpPositionTgm {
  address: string
  token_symbol: string
  side: 'long' | 'short'
  position_value_usd: number
  leverage: number
  entry_price: number
  liquidation_price: number
  unrealized_pnl: number
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

      return traders
    } catch (error: any) {
      console.error(`[Nansen Pro] Perp leaderboard failed:`, error.message)
      return []
    }
  }

  /**
   * Get top traders for specific token using PnL leaderboard
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

      return response.data.data || []
    } catch (error: any) {
      console.error(`[Nansen Pro] PnL leaderboard for ${tokenSymbol} failed:`, error.message)
      return []
    }
  }

  /**
   * Get actual positions for a specific wallet address
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
   */
  async getTopTraderPositions(walletAddresses: string[]): Promise<NansenPerpPosition[]> {
    if (!this.isEnabled() || walletAddresses.length === 0) return []

    try {
      const allPositions: NansenPerpPosition[] = []

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
                current_price: parseFloat(pos.entry_price_usd),
                unrealized_pnl_usd: 0,
                leverage: pos.leverage_value || 1,
                timestamp: Date.now()
              })
            }
          }

          if (i < walletAddresses.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200))
          }
        } catch (error) {
          console.error(`[Nansen Pro] Failed to get positions for ${wallet}`)
        }
      }

      return allPositions
    } catch (error: any) {
      console.error(`[Nansen Pro] Positions fetch failed:`, error.message)
      return []
    }
  }

  /**
   * Generate copy-trading signals from top trader positions
   */
  async getCopyTradingSignals(minConfidence: number = 60, minTraders: number = 3): Promise<CopyTradingSignal[]> {
    if (!this.isEnabled()) return []

    try {
      const topTokens = await this.getPerpLeaderboard(10)
      if (topTokens.length === 0) return []

      const signals: CopyTradingSignal[] = []

      for (const token of topTokens.slice(0, 5)) {
        const tokenSymbol = (token as any).token_symbol
        if (!tokenSymbol) continue

        try {
          const traders = await this.getTopTradersForToken(tokenSymbol, 10)
          if (traders.length < minTraders) continue

          const topWallets = traders.slice(0, 10).map((t: any) => t.trader_address).filter(Boolean)
          if (topWallets.length === 0) continue

          const positions = await this.getTopTraderPositions(topWallets)
          const tokenPositions = positions.filter(p => p.token_symbol === tokenSymbol)

          if (tokenPositions.length < minTraders) continue

          const longs = tokenPositions.filter(p => p.side === 'LONG')
          const shorts = tokenPositions.filter(p => p.side === 'SHORT')

          const totalTraders = tokenPositions.length
          const longCount = longs.length
          const shortCount = shorts.length

          const consensus = longCount > shortCount ? 'LONG' : 'SHORT'
          const majorityCount = Math.max(longCount, shortCount)
          const confidence = (majorityCount / totalTraders) * 100

          if (confidence < minConfidence) continue

          const relevantPositions = consensus === 'LONG' ? longs : shorts
          const avgEntry = relevantPositions.reduce((sum, p) => sum + p.entry_price, 0) / relevantPositions.length
          const totalSize = relevantPositions.reduce((sum, p) => sum + p.size, 0)

          signals.push({
            token_symbol: tokenSymbol,
            side: consensus,
            confidence: Math.round(confidence),
            trader_count: majorityCount,
            avg_entry_price: avgEntry,
            total_position_usd: totalSize * avgEntry,
            reason: `${majorityCount}/${totalTraders} top traders ${consensus}`
          })

          await new Promise(resolve => setTimeout(resolve, 300))

        } catch (tokenError: any) {
          console.warn(`[Nansen Pro] Failed to process ${tokenSymbol}:`, tokenError.message)
          continue
        }
      }

      signals.sort((a, b) => b.confidence - a.confidence)
      return signals
    } catch (error: any) {
      console.error(`[Nansen Pro] Copy-trading signals failed:`, error.message)
      return []
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. SMART MONEY NETFLOW TRACKING
  // ═══════════════════════════════════════════════════════════════

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
        wallet_category: 'smart_money'
      })

      const netflows: NansenSmartMoneyNetflow[] = response.data.netflows || []
      this.setCache(cacheKey, netflows)
      return netflows
    } catch (error: any) {
      console.error(`[Nansen Pro] Smart money netflows failed:`, error.message)
      return []
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. TOKEN RISK & HOLDERS
  // ═══════════════════════════════════════════════════════════════

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
      const holders = await this.getHolders(token, chain)
      if (!holders || holders.length === 0) throw new Error("No holders data")

      const top10 = holders.slice(0, 10)
      const top10Concentration = top10.reduce((sum, h) => sum + h.percentage, 0)

      const smartMoneyHolders = holders.filter(h =>
        h.category === 'fund' || h.category === 'smart_lp'
      ).length

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

      return response.data.flows || []
    } catch (error: any) {
      console.error(`[Nansen Pro] Flow intelligence failed:`, error.message)
      return []
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. TOKEN GOD MODE & SPECIFIC ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get DEX trades for a token
   */
  async getDexTrades(tokenAddress: string, chain: string, minUsd: number = 10000, mode: string = 'spot'): Promise<NansenDexTrade[]> {
    if (!this.isEnabled()) return []

    try {
      const now = new Date()
      const hourAgo = new Date(now.getTime() - 3600 * 1000)

      let payload: any;

      if (mode === 'perps') {
         // Structure for Perps TGM
         payload = {
            parameters: {
                mode: "perps",
                tokenAddress: tokenAddress,
                dateRange: { from: hourAgo.toISOString(), to: now.toISOString() }
            },
            filters: {
                valueUsd: { min: minUsd }
            },
            order_by: "block_timestamp",
            order_by_direction: "desc",
            page: 1
         };
      } else {
         // Standard Spot TGM
         payload = {
            chain,
            token_address: tokenAddress,
            date_range: { from: hourAgo.toISOString(), to: now.toISOString() },
            filters: { value_usd: { min: minUsd } },
            order_by: [{ field: 'block_time', direction: 'DESC' }],
            pagination: { page: 1, per_page: 20 }
         };
      }

      const response = await this.client.post('/tgm/dex-trades', payload)
      return response.data.data || []
    } catch (error: any) {
      console.error(`[Nansen Pro] DEX Trades (${mode}) failed for ${tokenAddress}:`, error.message)
      return []
    }
  }

  /**
   * Get Holders
   */
  async getHolders(tokenAddress: string, chain: string): Promise<NansenTokenHolder[]> {
    if (!this.isEnabled()) return []

    try {
      const response = await this.client.post('/tgm/holders', {
        chain,
        token_address: tokenAddress,
        label_type: 'smart_money',
        filters: { value_usd: { min: 50000 } },
        order_by: [{ field: 'balance_change_usd_24h', direction: 'DESC' }],
        pagination: { page: 1, per_page: 25 }
      })

      return response.data.holders || []
    } catch (error: any) {
      console.error(`[Nansen Pro] Holders failed for ${tokenAddress}:`, error.message)
      return []
    }
  }

  /**
   * Get Who Bought/Sold
   */
  async getWhoBoughtSold(tokenAddress: string, chain: string): Promise<any[]> {
    if (!this.isEnabled()) return []

    try {
      const now = new Date()
      const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000)

      const response = await this.client.post('/tgm/who-bought-sold', {
        chain,
        token_address: tokenAddress,
        date_range: { from: dayAgo.toISOString(), to: now.toISOString() },
        filters: {
          include_smart_money_labels: ["Fund", "30D Smart Trader"],
          value_usd: { min: 50000 }
        },
        order_by: [{ field: 'value_usd', direction: 'DESC' }]
      })

      return response.data.data || []
    } catch (error: any) {
      console.error(`[Nansen Pro] Who Bought/Sold failed:`, error.message)
      return []
    }
  }

  /**
   * Get Perp Positions (TGM) - specific for Hyperliquid Perps
   */
  async getTgmPerpPositions(token: string, chain: string = 'hyperliquid', minUsd: number = 100000): Promise<NansenPerpPositionTgm[]> {
    if (!this.isEnabled()) return []

    try {
      // Structure based on provided Python script for Perps mode
      const payload = {
        parameters: {
          mode: "perps",
          tokenAddress: token,
          labelType: "smart_money"
        },
        filters: {
           positionValueUsd: { from: minUsd }
        },
        order_by: "position_value_usd",
        order_by_direction: "desc",
        page: 1
      };

      const response = await this.client.post('/tgm/perp-positions', payload)
      return response.data.data || []
    } catch (error: any) {
      console.error(`[Nansen Pro] TGM Perp Positions failed for ${token}:`, error.message)
      return []
    }
  }

  /**
   * Get Smart Money Perp Trades
   */
  async getSmartMoneyPerpTrades(symbol: string, chain: string = 'hyperliquid'): Promise<any[]> {
    if (!this.isEnabled()) return []

    try {
      const now = new Date()
      const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000)

      const response = await this.client.post('/smart-money/perp-trades', {
        chain,
        symbol,
        date_range: { from: dayAgo.toISOString(), to: now.toISOString() },
        filters: { value_usd: { min: 50000 } },
        order_by: [{ field: 'block_time', direction: 'DESC' }]
      })

      return response.data.data || []
    } catch (error: any) {
      console.error(`[Nansen Pro] SM Perp Trades failed for ${symbol}:`, error.message)
      return []
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. WHALE & ENTITY TRACKING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get entity activity (counterparties)
   */
  async getEntityCounterparties(entityId: string, chain: string = 'all'): Promise<any[]> {
    if (!this.isEnabled()) return []

    try {
      const response = await this.client.post('/profiler/entity/counterparties', {
        entity_id: entityId,
        chain: chain,
        date_range: { from: '1D_AGO', to: 'NOW' },
        order_by: [{ field: 'volume_out_usd', direction: 'DESC' }],
        pagination: { page: 1, per_page: 50 }
      })

      return response.data.data || []
    } catch (error: any) {
      console.error(`[Nansen Pro] Entity counterparties failed for ${entityId}:`, error.message)
      return []
    }
  }

  /**
   * Get address transactions
   */
  async getAddressTransactions(address: string, chain: string = 'ethereum'): Promise<any[]> {
    if (!this.isEnabled()) return []

    try {
      const response = await this.client.post('/profiler/address/transactions', {
        address: address,
        chain: chain,
        date_range: { from: '1H_AGO', to: 'NOW' },
        pagination: { page: 1, per_page: 20 }
      })

      return response.data.data || []
    } catch (error: any) {
      console.error(`[Nansen Pro] Address txs failed for ${address}:`, error.message)
      return []
    }
  }

  /**
   * Get large token transfers
   */
  async getTokenTransfers(tokenAddress: string, chain: string, minUsd: number = 50000): Promise<any[]> {
    if (!this.isEnabled()) return []

    try {
      const response = await this.client.post('/tgm/transfers', {
        chain: chain,
        token_address: tokenAddress,
        date_range: { from: '1H_AGO', to: 'NOW' },
        filters: { value_usd: { min: minUsd } },
        order_by: [{ field: 'block_timestamp', direction: 'DESC' }],
        pagination: { page: 1, per_page: 50 }
      })

      return response.data.data || []
    } catch (error: any) {
      console.error(`[Nansen Pro] Token transfers failed for ${tokenAddress}:`, error.message)
      return []
    }
  }

  /**
   * Get Token Overview (Liquidity, FDV, Price)
   */
  async getTokenOverview(tokenAddress: string, chain: string): Promise<any> {
    if (!this.isEnabled()) return null

    try {
      const response = await this.client.post('/tgm/token-overview', {
        chain,
        token_address: tokenAddress
      })

      return response.data.data || null
    } catch (error: any) {
      console.error(`[Nansen Pro] Token Overview failed for ${tokenAddress}:`, error.message)
      return null
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
