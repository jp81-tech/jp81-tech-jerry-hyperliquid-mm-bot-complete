// Use native fetch (Node 18+)

export type HLMarket = {
  name: string
  szDecimals: number
  maxLeverage: number
}

export type HLAssetCtx = {
  coin: string
  dayNtlVlm: string
  midPx: string
  prevDayPx: string
  openInterest: string
  funding: string
}

export type VolatilityScore = {
  pair: string
  volatility24h: number
  volume24h: number
  score: number
  midPx: number
}

export class HyperliquidAPI {
  private baseUrl: string

  constructor(baseUrl = 'https://api.hyperliquid.xyz') {
    this.baseUrl = baseUrl
  }

  async getMetaAndAssetCtxs(): Promise<[{ universe: HLMarket[] }, HLAssetCtx[]]> {
    const res = await fetch(`${this.baseUrl}/info`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' })
    })
    if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`)
    const [meta, rawCtxs] = await res.json() as any

    // Combine coin names with context data
    const assetCtxs: HLAssetCtx[] = rawCtxs.map((ctx: any, i: number) => ({
      coin: meta.universe[i].name,
      ...ctx
    }))

    return [meta, assetCtxs]
  }

  async calculateVolatilityScores(minVolume = 10e6): Promise<VolatilityScore[]> {
    const [meta, assetCtxs] = await this.getMetaAndAssetCtxs()
    const scores: VolatilityScore[] = []

    for (const ctx of assetCtxs) {
      const volume = parseFloat(ctx.dayNtlVlm)
      if (volume < minVolume) continue

      const price = parseFloat(ctx.midPx || '0')
      const prevPrice = parseFloat(ctx.prevDayPx)
      if (price === 0 || prevPrice === 0) continue

      const volatility = Math.abs((price - prevPrice) / prevPrice * 100)

      // Score: volatility × volume factor (cap at 2x for volume)
      const volumeFactor = Math.min(volume / 50e6, 2.0)
      const score = volatility * volumeFactor

      scores.push({
        pair: ctx.coin,
        volatility24h: volatility,
        volume24h: volume,
        score,
        midPx: price
      })
    }

    return scores.sort((a, b) => b.score - a.score)
  }
}
