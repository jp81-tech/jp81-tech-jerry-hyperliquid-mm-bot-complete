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

// Candle data structure
export type Candle = {
  t: number // open time (ms)
  T: number // close time (ms)
  s: string // symbol
  i: string // interval
  o: number // open
  c: number // close
  h: number // high
  l: number // low
  v: number // volume
  n: number // number of trades
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

  /**
   * Get candles for a symbol
   * @param coin Coin symbol (e.g., "BTC", "ETH")
   * @param interval Interval string (e.g., "1h", "4h", "1d")
   * @param startTime Optional start time (ms)
   * @param endTime Optional end time (ms)
   */
  async getCandles(coin: string, interval: string, startTime?: number, endTime?: number): Promise<Candle[]> {
    const body: any = {
      type: 'candleSnapshot',
      req: {
        coin,
        interval,
        startTime: startTime || (Date.now() - 24 * 60 * 60 * 1000), // Default last 24h
        endTime: endTime || Date.now()
      }
    }

    const res = await fetch(`${this.baseUrl}/info`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!res.ok) throw new Error(`Failed to fetch candles: ${res.statusText}`)
    const rawCandles = await res.json() as any[]

    // Map raw response to Candle type
    return rawCandles.map(c => ({
      t: c.t,
      T: c.T,
      s: c.s,
      i: c.i,
      o: parseFloat(c.o),
      c: parseFloat(c.c),
      h: parseFloat(c.h),
      l: parseFloat(c.l),
      v: parseFloat(c.v),
      n: c.n
    }))
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
