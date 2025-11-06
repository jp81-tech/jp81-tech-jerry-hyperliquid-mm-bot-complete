/**
 * Nansen Smart Money Integration for Hyperliquid - UPDATED WITH CORRECT ENDPOINTS
 */

import axios from 'axios'

export interface NansenHyperliquidToken {
  token_symbol: string
  volume: number
  buy_volume: number
  sell_volume: number
  buy_sell_pressure: number
  trader_count: number
  mark_price: number
  funding: number | null
  open_interest: number | null
  previous_price_usd: number
}

export interface NansenPerpScreenerResponse {
  data: NansenHyperliquidToken[]
  pagination: {
    page: number
    per_page: number
    is_last_page: boolean
  }
}

export class NansenHyperliquidAPI {
  private apiKey: string
  private baseUrl = 'https://api.nansen.ai/api/v1'
  private cache: Map<string, { data: NansenPerpScreenerResponse; timestamp: number }> = new Map()
  private cacheTtlMs = 3600000 // 1 hour

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.NANSEN_API_KEY || ''
    if (!this.apiKey) {
      console.warn('[Nansen] No API key found - Nansen scoring disabled')
    }
  }

  isEnabled(): boolean {
    return this.apiKey.length > 0
  }

  /**
   * Fetch top Hyperliquid perpetuals by buy/sell pressure
   */
  async getPerpScreener(options: {
    fromDate?: string
    toDate?: string
    limit?: number
    sortBy?: 'volume' | 'buy_sell_pressure' | 'trader_count'
  } = {}): Promise<NansenHyperliquidToken[]> {
    if (!this.isEnabled()) {
      return []
    }

    const cacheKey = `perp_screener_${options.limit || 50}`
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.data.data
    }

    try {
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 3600 * 1000)

      const requestBody = {
        date: {
          from: options.fromDate || yesterday.toISOString(),
          to: options.toDate || now.toISOString()
        },
        pagination: {
          page: 1,
          per_page: options.limit || 50
        }
      }

      const response = await axios.post<NansenPerpScreenerResponse>(
        `${this.baseUrl}/perp-screener`,
        requestBody,
        {
          headers: {
            'apiKey': this.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      )

      const data = response.data
      this.cache.set(cacheKey, { data, timestamp: Date.now() })

      // Sort based on preference
      const sorted = data.data.sort((a, b) => {
        switch (options.sortBy) {
          case 'volume':
            return b.volume - a.volume
          case 'trader_count':
            return b.trader_count - a.trader_count
          case 'buy_sell_pressure':
          default:
            return b.buy_sell_pressure - a.buy_sell_pressure
        }
      })

      return sorted
    } catch (error: any) {
      console.error(`[Nansen] Failed to fetch perp screener:`, error.message)
      return []
    }
  }

  /**
   * Get Smart Money score for a specific token based on buy/sell pressure
   */
  getTokenScore(token: NansenHyperliquidToken): number {
    const volumeScore = Math.log10(1 + token.volume) * 0.3
    const pressureScore = Math.log10(1 + Math.abs(token.buy_sell_pressure)) *
                         (token.buy_sell_pressure > 0 ? 0.4 : -0.2)
    const traderScore = Math.log10(1 + token.trader_count) * 0.3

    return volumeScore + pressureScore + traderScore
  }

  /**
   * Boost volatility score with Nansen Smart Money data
   */
  async boostPairScores(pairs: { pair: string; score: number }[]): Promise<{ pair: string; baseScore: number; nansenBoost: number; totalScore: number }[]> {
    if (!this.isEnabled()) {
      return pairs.map(p => ({ pair: p.pair, baseScore: p.score, nansenBoost: 0, totalScore: p.score }))
    }

    const tokens = await this.getPerpScreener({ limit: 100, sortBy: 'buy_sell_pressure' })
    const tokenMap = new Map<string, NansenHyperliquidToken>()

    for (const token of tokens) {
      tokenMap.set(token.token_symbol, token)
    }

    const weight = parseFloat(process.env.NANSEN_WEIGHT || '0.35')
    const results = []

    for (const pair of pairs) {
      const token = tokenMap.get(pair.pair)
      const nansenBoost = token ? this.getTokenScore(token) * weight : 0
      const totalScore = pair.score + nansenBoost

      results.push({
        pair: pair.pair,
        baseScore: pair.score,
        nansenBoost,
        totalScore
      })

      if (token) {
        const pressure = token.buy_sell_pressure > 0 ? '🟢 BUYING' : '🔴 SELLING'
        console.log(`[Nansen] ${pair.pair}: base=${pair.score.toFixed(2)}, nansen=+${nansenBoost.toFixed(2)}, total=${totalScore.toFixed(2)} | ${pressure} $${(token.buy_sell_pressure / 1000000).toFixed(2)}M | ${token.trader_count} traders`)
      }
    }

    return results
  }

  clearCache(): void {
    this.cache.clear()
  }
}

let nansenInstance: NansenHyperliquidAPI | null = null

export function getNansenHyperliquidAPI(): NansenHyperliquidAPI {
  if (!nansenInstance) {
    nansenInstance = new NansenHyperliquidAPI()
  }
  return nansenInstance
}
