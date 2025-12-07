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
import fs from 'fs'
import path from 'path'

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

export interface TokenFlowSignals {
  tokenAddress: string
  chain: string
  smartMoneyNet: number
  whaleNet: number
  exchangeNet: number
  freshWalletNet: number
  topPnlNet: number
  trades1h: number
  buyCount: number
  sellCount: number
  liquidity: number       // New: from Token Overview
  fdv: number            // New: from Token Overview
  confidence: number      // 0..1
  dataSource: 'full' | 'flows_fallback' | 'partial'
  dataQuality: 'full' | 'partial' | 'minimal' | 'dead'
  warnings: string[]
}

// ═══════════════════════════════════════════════════════════════
// ENDPOINT MANAGER (Circuit Breaker & Fallbacks)
// ═══════════════════════════════════════════════════════════════

interface EndpointState {
  status: 'available' | 'forbidden' | 'rate_limited' | 'error'
  lastFailure: number
  cooldownUntil: number
  failureCount: number
}

class EndpointManager {
  private states: Record<string, EndpointState> = {}
  private readonly FORBIDDEN_COOLDOWN = 24 * 60 * 60 * 1000 // 24h
  private readonly ERROR_COOLDOWN = 60 * 1000 // 1 min

  isAvailable(endpoint: string): boolean {
    const state = this.states[endpoint]
    if (!state) return true

    if (Date.now() < state.cooldownUntil) {
      return false
    }

    return true
  }

  recordSuccess(endpoint: string) {
    if (this.states[endpoint]) {
      delete this.states[endpoint]
    }
  }

  recordFailure(endpoint: string, status: number) {
    const state = this.states[endpoint] || {
      status: 'available',
      lastFailure: 0,
      cooldownUntil: 0,
      failureCount: 0
    }

    state.lastFailure = Date.now()
    state.failureCount++

    if (status === 403) {
      state.status = 'forbidden'
      state.cooldownUntil = Date.now() + this.FORBIDDEN_COOLDOWN
      console.warn(`🔒 Endpoint ${endpoint} FORBIDDEN (403) - disabled for 24h`)
    } else if (status === 429) {
      state.status = 'rate_limited'
      state.cooldownUntil = Date.now() + (5 * 60 * 1000)
      console.warn(`⏳ Endpoint ${endpoint} rate limited - cooldown 5min`)
    } else if (status >= 500) {
      state.status = 'error'
      state.cooldownUntil = Date.now() + this.ERROR_COOLDOWN
    }

    this.states[endpoint] = state
  }
}

// ═══════════════════════════════════════════════════════════════
// NANSEN PRO API CLIENT
// ═══════════════════════════════════════════════════════════════

export class NansenProAPI {
  private client: AxiosInstance
  private apiKey: string
  private cache: Map<string, { data: any; timestamp: number }> = new Map()
  private riskCache: Map<string, { score: number; components: any; timestamp: number }> = new Map()
  private endpointManager = new EndpointManager()
  private cacheTtlMs = 300000 // 5 minutes for most endpoints
  // Simple circuit breaker per endpoint+chain
  private circuit: Map<string, { state: 'CLOSED' | 'OPEN'; failures: number; lastFailure: number }> = new Map()
  private failureThreshold = 3
  private cooldownMs = 60_000
  private cacheFilePath = path.join(process.cwd(), 'data', 'nansen_cache_v2.json')
  private isCacheDirty = false

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.NANSEN_API_KEY || ''

    this.loadDiskCache()

    // Auto-save cache every 60 seconds if dirty
    setInterval(() => {
      if (this.isCacheDirty) {
        this.saveDiskCache()
      }
    }, 60000)

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

  private loadDiskCache() {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = fs.readFileSync(this.cacheFilePath, 'utf-8');
        const data = JSON.parse(raw);

        // Restore main cache
        if (data.cache) {
          this.cache = new Map(data.cache);
        }

        // Restore risk cache
        if (data.riskCache) {
          this.riskCache = new Map(data.riskCache);
        }

        console.log(`[Nansen Pro] Loaded cache from disk (${this.cache.size} entries)`);
      }
    } catch (e) {
      console.warn('[Nansen Pro] Failed to load disk cache:', e);
    }
  }

  private saveDiskCache() {
    try {
      const data = {
        cache: Array.from(this.cache.entries()),
        riskCache: Array.from(this.riskCache.entries())
      };

      const dir = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.cacheFilePath, JSON.stringify(data));
      this.isCacheDirty = false;
      // console.debug('[Nansen Pro] Saved cache to disk');
    } catch (e) {
      console.error('[Nansen Pro] Failed to save disk cache:', e);
    }
  }

  isEnabled(): boolean {
    return this.apiKey.length > 0 && process.env.NANSEN_ENABLED === 'true'
  }

  // ── Helpers: error handling & chain guard ─────────────────────
  private key(endpoint: string, chain: string) {
    return `${endpoint}:${chain}`
  }

  private circuitAvailable(endpoint: string, chain: string): boolean {
    const k = this.key(endpoint, chain)
    const info = this.circuit.get(k)
    if (!info || info.state === 'CLOSED') return true
    const elapsed = Date.now() - info.lastFailure
    if (elapsed > this.cooldownMs) {
      this.circuit.set(k, { state: 'CLOSED', failures: 0, lastFailure: 0 })
      return true
    }
    return false
  }

  private recordFailure(endpoint: string, chain: string) {
    const k = this.key(endpoint, chain)
    const info = this.circuit.get(k) || { state: 'CLOSED', failures: 0, lastFailure: 0 }
    info.failures += 1
    info.lastFailure = Date.now()
    if (info.failures >= this.failureThreshold) {
      info.state = 'OPEN'
      console.debug(`[Nansen Pro] Circuit OPEN for ${k}`)
    }
    this.circuit.set(k, info)
  }

  private recordSuccess(endpoint: string, chain: string) {
    const k = this.key(endpoint, chain)
    this.circuit.set(k, { state: 'CLOSED', failures: 0, lastFailure: 0 })
  }

  // ── Helpers: error handling & chain guard ─────────────────────
  private logError(error: any, context: string) {
    const code = error?.response?.status
    // Cicho dla znanych błędów na nieobsługiwanych tokenach/łańcuchach
    if (code === 404 || code === 422) {
      console.debug(`[Nansen Pro] ${context} skipped (status=${code})`)
      return
    }
    console.error(`[Nansen Pro] ${context}:`, error?.message || error)
  }

  private isChainUnsupported(chain: string): boolean {
    // HL-native / BTC / inne niestandardowe nie mają sensownych danych TGM
    // UWAGA: Hyperliquid jest wspierane dla perps, więc usuwam z blokady
    const unsupported = ['bitcoin']
    return unsupported.includes(chain.toLowerCase())
  }

  private async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Resilient POST with basic retry/fallback and circuit breaker.
   * Returns response.data or null on failure.
   */
  private async postWithResilience(
    endpoint: string,
    payload: any,
    chain: string,
    fallbackEndpoints: string[] = []
  ): Promise<any | null> {
    const targets = [endpoint, ...fallbackEndpoints]

    for (const ep of targets) {
      if (!this.circuitAvailable(ep, chain)) {
        console.debug(`[Nansen Pro] Circuit open, skip ${ep} chain=${chain}`)
        continue
      }

      try {
        const res = await this.client.post(ep, payload)
        this.recordSuccess(ep, chain)
        return res.data
      } catch (error: any) {
        const code = error?.response?.status

        // Retry on 429 / timeout once with backoff
        if (code === 429) {
          this.recordFailure(ep, chain)
          await this.sleep(5000)
          continue
        }
        if (code === 408) {
          this.recordFailure(ep, chain)
          await this.sleep(2000)
          continue
        }

        // 404 / 422: try next fallback quietly
        if (code === 404 || code === 422) {
          this.recordFailure(ep, chain)
          console.debug(`[Nansen Pro] ${ep} skipped (status=${code})`)
          continue
        }

        // Other errors
        this.recordFailure(ep, chain)
        this.logError(error, `POST ${ep}`)
      }
    }

    return null
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
    this.isCacheDirty = true
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
    if (this.isChainUnsupported(chain)) {
      console.debug(`[Nansen Pro] Smart money netflows skipped for unsupported chain=${chain}`)
      return []
    }

    const cacheKey = `sm_netflow_${tokens.join(',')}_${chain}`
    const cached = this.getCached<NansenSmartMoneyNetflow[]>(cacheKey)
    if (cached) return cached

    try {
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      const now = new Date().toISOString()

      const data = await this.postWithResilience(
        '/smart-money/netflows',
        {
          tokens: tokens,
          chain: chain,
          date: { from: yesterday, to: now },
          wallet_category: 'smart_money'
        },
        chain,
        ['/tgm/token_flows', '/tgm/top_holders'] // fallback idea; non-critical
      )

      const netflows: NansenSmartMoneyNetflow[] = data?.netflows || []
      this.setCache(cacheKey, netflows)
      return netflows
    } catch (error: any) {
      this.logError(error, 'Smart money netflows failed')
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

  /**
   * Aggregate Nansen risk into a single score 0–10 for a given token.
   *
   * Components:
   * - Holder concentration / smart money presence  (analyzeTokenRisk)
   * - Flow intelligence (exchange / whale / smart money flows)
   *
   * 0  = ultra low risk (blue chip, healthy flows)
   * 5  = neutral / unknown
   * 10 = very high risk (concentrated, heavy sell / exchange inflows)
   */
  async getTokenRiskScore(tokenAddress: string, chain: string = 'ethereum'): Promise<{
    score: number
    components: {
      top10Concentration: number
      smartMoneyHolders: number
      holderRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
      exchangeFlowUsd: number
      whaleFlowUsd: number
      smartMoneyFlowUsd: number
      flowDirection: 'IN' | 'OUT' | 'NEUTRAL' | 'UNKNOWN'
      reason: string
    }
  }> {
    // Baseline: neutral risk
    let score = 5
    let reasonParts: string[] = []

    if (!this.isEnabled()) {
      return {
        score,
        components: {
          top10Concentration: 0,
          smartMoneyHolders: 0,
          holderRiskLevel: 'MEDIUM',
          exchangeFlowUsd: 0,
          whaleFlowUsd: 0,
          smartMoneyFlowUsd: 0,
          flowDirection: 'UNKNOWN',
          reason: 'Nansen disabled'
        }
      }
    }

    if (this.isChainUnsupported(chain)) {
      return {
        score,
        components: {
          top10Concentration: 0,
          smartMoneyHolders: 0,
          holderRiskLevel: 'MEDIUM',
          exchangeFlowUsd: 0,
          whaleFlowUsd: 0,
          smartMoneyFlowUsd: 0,
          flowDirection: 'UNKNOWN',
          reason: `Unsupported chain=${chain}`
        }
      }
    }

    try {
      // 1) Holder / concentration risk
      const holderRisk = await this.analyzeTokenRisk(tokenAddress, chain)
      const { top10Concentration, smartMoneyHolders, riskLevel, reason: holderReason } = holderRisk

      // Map holder risk level to score adjustment
      if (riskLevel === 'HIGH') {
        score += 2 // concentrated / weak distribution
        reasonParts.push(`Holder risk HIGH: ${holderReason}`)
      } else if (riskLevel === 'LOW') {
        score -= 1 // healthy distribution slightly reduces risk
        reasonParts.push(`Holder risk LOW: ${holderReason}`)
      } else {
        reasonParts.push(`Holder risk MEDIUM: ${holderReason}`)
      }

      // 2) Flow intelligence (exchange / whale / smart money)
      const flowsArr = await this.getFlowIntelligence([tokenAddress], chain)
      let exchangeFlowUsd = 0
      let whaleFlowUsd = 0
      let smartMoneyFlowUsd = 0
      let flowDirection: 'IN' | 'OUT' | 'NEUTRAL' | 'UNKNOWN' = 'UNKNOWN'

      if (flowsArr && flowsArr.length > 0) {
        const f = flowsArr[0]
        exchangeFlowUsd = f.exchange_flow_usd || 0
        whaleFlowUsd = f.whale_flow_usd || 0
        smartMoneyFlowUsd = f.smart_money_flow_usd || 0
        flowDirection = f.flow_direction || 'NEUTRAL'

        // Exchange inflows (tokens moving TO exchanges) -> selling pressure
        if (exchangeFlowUsd > 500_000) {
          score += 2
          reasonParts.push(`High exchange inflows ${exchangeFlowUsd.toFixed(0)} USD`)
        } else if (exchangeFlowUsd > 100_000) {
          score += 1
          reasonParts.push(`Moderate exchange inflows ${exchangeFlowUsd.toFixed(0)} USD`)
        }

        // Smart money exiting
        if (smartMoneyFlowUsd < -100_000) {
          score += 2
          reasonParts.push(`Smart money net outflow ${smartMoneyFlowUsd.toFixed(0)} USD`)
        }

        // Whale dumps
        if (whaleFlowUsd < -250_000) {
          score += 2
          reasonParts.push(`Whale net outflow ${whaleFlowUsd.toFixed(0)} USD`)
        }

        // If flow direction is clearly OUT and total flow is big, add a bit more
        if (flowDirection === 'OUT' && Math.abs(f.total_flow_usd || 0) > 500_000) {
          score += 1
          reasonParts.push(`Overall flow direction OUT with size ${Math.abs((f.total_flow_usd || 0)).toFixed(0)} USD`)
        }
      } else {
        reasonParts.push('No flow intelligence data')
      }

      // Clamp score to [0, 10]
      if (score < 0) score = 0
      if (score > 10) score = 10

      const reasonText = reasonParts.join('; ') || 'Neutral'
      console.info(
        `[Nansen Pro] RISK ${tokenAddress} chain=${chain} score=${score}/10 – ${reasonText}`
      )

      return {
        score,
        components: {
          top10Concentration,
          smartMoneyHolders,
          holderRiskLevel: riskLevel,
          exchangeFlowUsd,
          whaleFlowUsd,
          smartMoneyFlowUsd,
          flowDirection,
          reason: reasonText
        }
      }
    } catch (error: any) {
      this.logError(error, `Token risk score failed for ${tokenAddress}`)
      return {
        score,
        components: {
          top10Concentration: 0,
          smartMoneyHolders: 0,
          holderRiskLevel: 'MEDIUM',
          exchangeFlowUsd: 0,
          whaleFlowUsd: 0,
          smartMoneyFlowUsd: 0,
          flowDirection: 'UNKNOWN',
          reason: 'Risk score calculation failed'
        }
      }
    }
  }

  /**
   * Throttled wrapper around getTokenRiskScore with in-memory cache.
   * - Caches result per (token, chain) for ttlMs (default 15 minutes).
   * - Logs REFRESH on fresh fetch and cache HIT on reuse.
   */
  async getThrottledTokenRiskScore(
    tokenAddress: string,
    chain: string = 'ethereum',
    ttlMs: number = 15 * 60 * 1000
  ): Promise<{
    score: number
    components: {
      top10Concentration: number
      smartMoneyHolders: number
      holderRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
      exchangeFlowUsd: number
      whaleFlowUsd: number
      smartMoneyFlowUsd: number
      flowDirection: 'IN' | 'OUT' | 'NEUTRAL' | 'UNKNOWN'
      reason: string
    }
  }> {
    const key = `${tokenAddress.toLowerCase()}:${chain.toLowerCase()}`
    const cached = this.riskCache.get(key)
    const now = Date.now()

    if (cached && now - cached.timestamp < ttlMs) {
      console.info(
        `[Nansen Pro] RISK cache HIT ${tokenAddress} chain=${chain} score=${cached.score}/10 – ${cached.components.reason}`
      )
      return { score: cached.score, components: cached.components }
    }

    const result = await this.getTokenRiskScore(tokenAddress, chain)

    this.riskCache.set(key, {
      score: result.score,
      components: result.components,
      timestamp: now
    })
    this.isCacheDirty = true

    console.info(
      `[Nansen Pro] RISK REFRESH ${tokenAddress} chain=${chain} score=${result.score}/10 – ${result.components.reason}`
    )

    return result
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. FLOW INTELLIGENCE (Multi-source)
  // ═══════════════════════════════════════════════════════════════

  async getFlowIntelligence(tokens: string[], chain: string = 'ethereum'): Promise<NansenFlowIntelligence[]> {
    if (!this.isEnabled() || tokens.length === 0) return []
    if (this.isChainUnsupported(chain)) {
      console.debug(`[Nansen Pro] Flow intelligence skipped for unsupported chain=${chain}`)
      return []
    }

    const tokenKey = tokens.sort().join(',')
    const cacheKey = `flow_intel_${chain}_${tokenKey}`
    const cached = this.getCached<NansenFlowIntelligence[]>(cacheKey, 15 * 60 * 1000) // 15 min cache
    if (cached) return cached

    try {
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      const now = new Date().toISOString()

      const data = await this.postWithResilience(
        '/tgm/flow-intelligence',
        {
          tokens: tokens,
          chain: chain,
          date: { from: yesterday, to: now }
        },
        chain
      )

      const result = data?.flows || []
      this.setCache(cacheKey, result)
      return result
    } catch (error: any) {
      this.logError(error, 'Flow intelligence failed')
      this.setCache(cacheKey, [])
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
    if (this.isChainUnsupported(chain)) {
      console.debug(`[Nansen Pro] DEX trades skipped for unsupported chain=${chain}`)
      return []
    }

    const cacheKey = `dex_trades_${chain}_${tokenAddress}_${mode}`
    const cached = this.getCached<NansenDexTrade[]>(cacheKey, 10 * 60 * 1000) // 10 min cache
    if (cached) return cached

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

      const data = await this.postWithResilience(
        '/tgm/dex-trades',
        payload,
        chain
      )
      const result = data?.data || []
      this.setCache(cacheKey, result)
      return result
    } catch (error: any) {
      this.logError(error, `DEX Trades (${mode}) failed for ${tokenAddress}`)
      this.setCache(cacheKey, [])
      return []
    }
  }

  /**
   * Get Holders
   */
  async getHolders(tokenAddress: string, chain: string): Promise<NansenTokenHolder[]> {
    if (!this.isEnabled()) return []
    if (this.isChainUnsupported(chain)) {
      console.debug(`[Nansen Pro] Holders skipped for unsupported chain=${chain}`)
      return []
    }

    const cacheKey = `holders_${chain}_${tokenAddress}`
    const cached = this.getCached<NansenTokenHolder[]>(cacheKey, 30 * 60 * 1000) // 30 min cache (holders change slowly)
    if (cached) return cached

    try {
      const data = await this.postWithResilience(
        '/tgm/holders',
        {
          chain,
          token_address: tokenAddress,
          label_type: 'smart_money',
          filters: { value_usd: { min: 50000 } },
          order_by: [{ field: 'balance_change_usd_24h', direction: 'DESC' }],
          pagination: { page: 1, per_page: 25 }
        },
        chain
      )

      const result = data?.holders || []
      this.setCache(cacheKey, result)
      return result
    } catch (error: any) {
      this.logError(error, `Holders failed for ${tokenAddress}`)
      this.setCache(cacheKey, [])
      return []
    }
  }

  /**
   * Get Who Bought/Sold
   */
  async getWhoBoughtSold(tokenAddress: string, chain: string): Promise<any[]> {
    if (!this.isEnabled()) return []
    if (this.isChainUnsupported(chain)) {
      console.debug(`[Nansen Pro] WhoBoughtSold skipped for unsupported chain=${chain}`)
      return []
    }

    try {
      const now = new Date()
      const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000)

      const data = await this.postWithResilience(
        '/tgm/who-bought-sold',
        {
          chain,
          token_address: tokenAddress,
          date_range: { from: dayAgo.toISOString(), to: now.toISOString() },
          filters: {
            include_smart_money_labels: ["Fund", "30D Smart Trader"],
            value_usd: { min: 50000 }
          },
          order_by: [{ field: 'value_usd', direction: 'DESC' }]
        },
        chain
      )

      return data?.data || []
    } catch (error: any) {
      this.logError(error, 'Who Bought/Sold failed')
      return []
    }
  }

  /**
   * Get Perp Positions (TGM) - specific for Hyperliquid Perps
   */
  async getTgmPerpPositions(token: string, chain: string = 'hyperliquid', minUsd: number = 100000): Promise<NansenPerpPositionTgm[]> {
    if (!this.isEnabled()) return []
    if (this.isChainUnsupported(chain)) {
      console.debug(`[Nansen Pro] TGM Perp Positions skipped for unsupported chain=${chain}`)
      return []
    }

    const cacheKey = `tgm_perps_${chain}_${token}_${minUsd}`
    const cached = this.getCached<NansenPerpPositionTgm[]>(cacheKey, 15 * 60 * 1000) // 15 min cache
    if (cached) return cached

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

      const data = await this.postWithResilience(
        '/tgm/perp-positions',
        payload,
        chain
      )
      const result = data?.data || []
      this.setCache(cacheKey, result)
      return result
    } catch (error: any) {
      this.logError(error, `TGM Perp Positions failed for ${token}`)
      // Cache failure as empty to prevent retry loops on 404s
      this.setCache(cacheKey, [])
      return []
    }
  }

  /**
   * Get Smart Money Perp Trades
   */
  async getSmartMoneyPerpTrades(symbol: string, chain: string = 'hyperliquid'): Promise<any[]> {
    if (!this.isEnabled()) return []
    if (this.isChainUnsupported(chain)) {
      console.debug(`[Nansen Pro] SM Perp Trades skipped for unsupported chain=${chain}`)
      return []
    }

    const cacheKey = `sm_perp_trades_${chain}_${symbol}`
    const cached = this.getCached<any[]>(cacheKey, 15 * 60 * 1000) // 15 min cache
    if (cached) return cached

    try {
      const now = new Date()
      const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000)

      const data = await this.postWithResilience(
        '/smart-money/perp-trades',
        {
          chain,
          symbol,
          date_range: { from: dayAgo.toISOString(), to: now.toISOString() },
          filters: { value_usd: { min: 50000 } },
          order_by: [{ field: 'block_time', direction: 'DESC' }]
        },
        chain
      )

      const result = data?.data || []
      this.setCache(cacheKey, result)
      return result
    } catch (error: any) {
      console.error(`[Nansen Pro] SM Perp Trades failed for ${symbol}:`, error.message)
      this.setCache(cacheKey, [])
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
    if (this.isChainUnsupported(chain)) {
      console.debug(`[Nansen Pro] Token overview skipped for unsupported chain=${chain}`)
      return null
    }

    try {
      const data = await this.postWithResilience(
        '/tgm/token-overview',
        {
          chain,
          token_address: tokenAddress
        },
        chain,
        [
          '/tgm/token-recent-flows-summary',
          '/tgm/dex-trades',
          '/tgm/holders'
        ]
      )

      return data?.data || null
    } catch (error: any) {
      this.logError(error, `Token Overview failed for ${tokenAddress}`)
      return null
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. TOKEN SPECIFIC ADAPTERS (ZEC, VIRTUAL, ETC.)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Generic Token Flow Signals (flows + holders + dex-trades) with fallbacks.
   * Designed to mirror the Python-style adapter from Nansen AI.
   */
  async getTokenFlowSignals(tokenAddress: string, chain: string): Promise<TokenFlowSignals | null> {
    if (!this.isEnabled()) return null
    if (this.isChainUnsupported(chain)) {
      console.debug(`[Nansen Pro] TokenFlowSignals skipped for unsupported chain=${chain}`)
      return null
    }

    const signals: TokenFlowSignals = {
      tokenAddress,
      chain,
      smartMoneyNet: 0,
      whaleNet: 0,
      exchangeNet: 0,
      freshWalletNet: 0,
      topPnlNet: 0,
      trades1h: 0,
      buyCount: 0,
      sellCount: 0,
      liquidity: 0,
      fdv: 0,
      confidence: 1.0,
      dataSource: 'full',
      dataQuality: 'full',
      warnings: []
    }

    // ── 0) LIQUIDITY & OVERVIEW (New priority) ──────────────────
    try {
      const overview = await this.getTokenOverview(tokenAddress, chain)
      if (overview) {
        signals.liquidity = overview.liquidity_usd || 0
        signals.fdv = overview.fdv_usd || 0
      }
    } catch (e) {
      // Non-critical
    }

    // ── 1) FLOWS (recent flows summary) ─────────────────────────
    try {
      // Use flow-intelligence as proxy for "flows summary"
      const flowsArr = await this.getFlowIntelligence([tokenAddress], chain)
      const f = flowsArr && flowsArr[0]

      if (f) {
        // Interpretation:
        // exchange_flow_usd ~ exchange_net_flow_usd
        // whale_flow_usd   ~ whale_net_flow_usd
        // smart_money_flow_usd ~ smart_money_net_flow_usd
        signals.whaleNet = f.whale_flow_usd || 0
        signals.exchangeNet = f.exchange_flow_usd || 0
        signals.smartMoneyNet = f.smart_money_flow_usd || 0
        // Use total_flow_usd as proxy for top_pnl_net if needed, or just keep as separate metric
        signals.topPnlNet = f.total_flow_usd || 0
      } else {
        signals.confidence *= 0.7
        signals.dataSource = 'partial'
      }
    } catch (e: any) {
      this.logError(e, `TokenFlowSignals: flows failed for ${tokenAddress}`)
      signals.confidence *= 0.5
      signals.dataSource = 'partial'
      signals.warnings.push('flows failed')
    }

    // ── 2) HOLDERS (smart money) – weak on ZEC/SOL ─────
    try {
      const holders = await this.getHolders(tokenAddress, chain)
      const activeSm = holders.filter(h => (h.balance || 0) > 0)

      if (activeSm.length >= 5) {
        // Future: calculate net change from holders
      } else {
        // Fallback: use topPnlNet/smartMoneyNet from flows if holders are empty/insufficient
        if (signals.smartMoneyNet === 0 && signals.topPnlNet !== 0) {
          signals.smartMoneyNet = signals.topPnlNet
          signals.confidence *= 0.8
          signals.dataSource = 'flows_fallback'
        }
      }
    } catch (e: any) {
      this.logError(e, `TokenFlowSignals: holders failed for ${tokenAddress}`)
      // If holders fail, stick to flows
      if (signals.smartMoneyNet === 0 && signals.topPnlNet !== 0) {
        signals.smartMoneyNet = signals.topPnlNet
      }
      signals.confidence *= 0.8
      signals.warnings.push('holders failed')
    }

    // ── 3) DEX TRADES (Activity) ────────────────────────────────
    try {
      const trades = await this.getDexTrades(tokenAddress, chain, 10_000 /* minUsd */)
      if (trades && trades.length > 0) {
        signals.trades1h = trades.length
        signals.buyCount = trades.filter(t => t.side === 'buy').length
        signals.sellCount = trades.filter(t => t.side === 'sell').length
      }
    } catch (e: any) {
      this.logError(e, `TokenFlowSignals: dex trades failed for ${tokenAddress}`)
      signals.trades1h = 0
      signals.warnings.push('dex trades failed')
    }

    // Derive dataQuality based on available info
    if (
      signals.trades1h === 0 &&
      signals.whaleNet === 0 &&
      signals.exchangeNet === 0 &&
      signals.smartMoneyNet === 0
    ) {
      signals.dataQuality = 'dead'
    } else if (signals.dataSource === 'full') {
      signals.dataQuality = 'full'
    } else if (signals.dataSource === 'flows_fallback') {
      signals.dataQuality = 'partial'
    } else {
      signals.dataQuality = 'minimal'
    }

    return signals
  }

  /**
   * Generic spread multiplier based on TokenFlowSignals.
   * Can be reused for any token, clamped to [min, max].
   */
  private computeSpreadMultiplierForSignals(
    signals: TokenFlowSignals,
    min: number = 0.8,
    max: number = 2.0
  ): number {
    let mult = 1.0

    // ── 1. LIQUIDITY PENALTY (Python Logic Port) ──────────────
    // Low liquidity = higher risk = wider spread
    if (signals.liquidity > 0) {
      if (signals.liquidity < 200_000) {
        mult += 0.3 // +30% spread if < $200k liq
      } else if (signals.liquidity < 500_000) {
        mult += 0.2 // +20% spread if < $500k liq
      }
    }

    // ── 2. WHALE / FLOW IMPACT ────────────────────────────────
    const whale = Math.abs(signals.whaleNet)
    // Mega Whale tiers (for BTC/ETH scale)
    if (whale > 10_000_000) mult += 0.8  // $10M+ -> Massive impact
    else if (whale > 1_000_000) mult += 0.5   // $1M+ -> High impact
    else if (whale > 500_000) mult += 0.3     // $500k+
    else if (whale > 100_000) mult += 0.15    // $100k+

    const exch = signals.exchangeNet
    if (exch > 5_000_000) mult += 0.8
    else if (exch > 1_000_000) mult += 0.5
    else if (exch > 100_000) mult += 0.2

    if (Math.abs(signals.smartMoneyNet) > 500_000) mult += 0.4
    else if (Math.abs(signals.smartMoneyNet) > 50_000) mult += 0.15

    // ── 3. DATA QUALITY & CONFIDENCE ──────────────────────────
    if (signals.dataQuality === 'partial') {
      mult += 0.15
    } else if (signals.dataQuality === 'minimal') {
      mult += 0.3
    } else if (signals.dataQuality === 'dead') {
      mult += 1.0
    }

    if (signals.confidence < 0.7) {
      mult += 0.2
    }

    // ── 4. CLAMP ──────────────────────────────────────────────
    if (mult < min) mult = min
    if (mult > max) mult = max
    return mult
  }

  /**
   * Generic kill-switch based on TokenFlowSignals.
   */
  private computeKillSwitchForSignals(
    signals: TokenFlowSignals,
    label: string
  ): { pause: boolean; reason?: string } {
    if (signals.dataQuality === 'dead') {
      return { pause: true, reason: `💀 ${label}: token appears dead (no flows/activity)` }
    }

    // Minimal data + zero activity -> pause until market wakes up
    if (
      signals.dataQuality === 'minimal' &&
      signals.trades1h === 0 &&
      Math.abs(signals.whaleNet) +
      Math.abs(signals.exchangeNet) +
      Math.abs(signals.smartMoneyNet) <
      10_000
    ) {
      return {
        pause: true,
        reason: `⚠️ ${label}: low data quality & no activity – paused until Nansen signals improve`
      }
    }

    if (signals.whaleNet < -500_000) {
      return { pause: true, reason: `🐳 ${label}: whale dump ${signals.whaleNet.toFixed(0)} USD` }
    }

    if (signals.exchangeNet > 1_000_000) {
      return { pause: true, reason: `📥 ${label}: massive exchange inflow ${signals.exchangeNet.toFixed(0)} USD` }
    }

    if (signals.confidence < 0.5) {
      return {
        pause: true,
        reason: `⚠️ ${label}: low Nansen data confidence (${Math.round(
          signals.confidence * 100
        )}%) – paused until confidence recovers`
      }
    }

    return { pause: false }
  }

  /**
   * Helper for ZEC on Solana
   */
  async getZecSolSignals(): Promise<TokenFlowSignals | null> {
    const ZEC_SOL = 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS'
    return this.getTokenFlowSignals(ZEC_SOL, 'solana')
  }

  /**
   * Spread multiplier specifically tuned for ZEC on Solana.
   */
  async getZecSolSpreadMultiplier(): Promise<number> {
    const s = await this.getZecSolSignals()
    if (!s) return 1.0
    // ZEC: conservative cap
    return this.computeSpreadMultiplierForSignals(s, 0.9, 1.4)
  }

  /**
   * Kill-switch for ZEC on Solana.
   */
  async getZecSolKillSwitch(): Promise<{ pause: boolean; reason?: string }> {
    const s = await this.getZecSolSignals()
    if (!s) return { pause: false }
    return this.computeKillSwitchForSignals(s, 'ZEC/SOL')
  }

  /**
   * Helper for VIRTUAL on Base
   */
  async getVirtualBaseSignals(): Promise<TokenFlowSignals | null> {
    const VIRTUAL_BASE = '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b'
    return this.getTokenFlowSignals(VIRTUAL_BASE, 'base')
  }

  async getVirtualBaseSpreadMultiplier(): Promise<number> {
    const s = await this.getVirtualBaseSignals()
    if (!s) return 1.0
    // VIRTUAL: allow wider spreads
    return this.computeSpreadMultiplierForSignals(s, 0.8, 2.0)
  }

  async getVirtualBaseKillSwitch(): Promise<{ pause: boolean; reason?: string }> {
    const s = await this.getVirtualBaseSignals()
    if (!s) return { pause: false }
    return this.computeKillSwitchForSignals(s, 'VIRTUAL/BASE')
  }

  /**
   * Helper for HYPE/WHYPE on HyperEVM
   * Uses WHYPE address as primary signal source (better DEX coverage).
   */
  async getHypeHyperevmSignals(): Promise<TokenFlowSignals | null> {
    const WHYPE_HYPEREVM = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    return this.getTokenFlowSignals(WHYPE_HYPEREVM, 'hyperevm')
  }

  async getHypeHyperevmSpreadMultiplier(): Promise<number> {
    const s = await this.getHypeHyperevmSignals()
    if (!s) return 1.0
    // HYPE: partially observable chain -> tighter cap
    return this.computeSpreadMultiplierForSignals(s, 0.9, 1.3)
  }

  async getHypeHyperevmKillSwitch(): Promise<{ pause: boolean; reason?: string }> {
    const s = await this.getHypeHyperevmSignals()
    if (!s) return { pause: false }
    return this.computeKillSwitchForSignals(s, 'HYPE/HYPEREVM')
  }

  /**
   * Helper for MONO on BNB
   */
  async getMonoBnbSignals(): Promise<TokenFlowSignals | null> {
    const MONO_BNB = '0xd4099A517f2Fbe8a730d2ECaad1D0824B75e084a'
    return this.getTokenFlowSignals(MONO_BNB, 'bnb')
  }

  async getMonoBnbSpreadMultiplier(): Promise<number> {
    const s = await this.getMonoBnbSignals()
    if (!s) return 1.0
    // MONO: if alive, quote very wide
    return this.computeSpreadMultiplierForSignals(s, 1.0, 3.0)
  }

  async getMonoBnbKillSwitch(): Promise<{ pause: boolean; reason?: string }> {
    const s = await this.getMonoBnbSignals()
    if (!s) return { pause: false }
    return this.computeKillSwitchForSignals(s, 'MONO/BNB')
  }

  /**
   * Generic Guard: Computes Spread Mult + Kill Switch for ANY token config.
   * Replaces the need for hardcoded per-token methods.
   */
  async getGenericTokenGuard(
    label: string,
    chain: string,
    address: string,
    spreadCaps: { min: number; max: number } = { min: 0.9, max: 2.0 }
  ): Promise<{ spreadMult: number; pause: boolean; reason?: string }> {
    const s = await this.getTokenFlowSignals(address, chain)
    if (!s) {
      // If signal fetch completely failed, neutral default
      return { spreadMult: 1.0, pause: false }
    }

    // 1. Kill Switch
    const ks = this.computeKillSwitchForSignals(s, label)
    if (ks.pause) {
      return { spreadMult: 1.0, pause: true, reason: ks.reason }
    }

    // 2. Spread Multiplier
    const spreadMult = this.computeSpreadMultiplierForSignals(s, spreadCaps.min, spreadCaps.max)

    return { spreadMult, pause: false }
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
