/**
 * Behavioural Risk Management (Anti-FOMO / Anti-Knife)
 * 
 * Prevents the bot from:
 * - Buying into FOMO pumps (fear of missing out)
 * - Catching falling knives (buying during sharp drops)
 * 
 * Two modes: normal (conservative) and aggressive (more sensitive)
 * Per-token configuration for ZEC, UNI, VIRTUAL
 */

export type BehaviouralRiskMode = 'normal' | 'aggressive'

export interface GridOrder {
  layer: number
  side: 'bid' | 'ask'
  price: number
  sizeUsd: number
  units: number
}

interface BehaviouralConfig {
  fomoRet1m: number      // FOMO threshold 1m (% as decimal, e.g. 1.2% = 0.012)
  fomoRet5m: number      // FOMO threshold 5m (% as decimal)
  knifeRet1m: number     // Knife threshold 1m (% as decimal, negative)
  knifeRet5m: number     // Knife threshold 5m (% as decimal, negative)
  minDepthRatio: number  // Min orderbook depth ratio
  fomoSpreadBoost: number // Spread multiplier for FOMO (e.g. 1.3 = 30% wider)
  knifeSuspendMs: number  // Knife suspension duration (milliseconds)
}

interface BehaviouralContext {
  mode: BehaviouralRiskMode
  pair: string
  midPrice: number
  buyLayers: GridOrder[]
  sellLayers: GridOrder[]
  recentReturns?: {
    ret1m?: number  // 1-minute return (as decimal, e.g. 1.2% = 0.012)
    ret5m?: number  // 5-minute return (as decimal)
    ret15m?: number // 15-minute return (as decimal)
  }
  orderbookStats?: {
    bidDepthNow?: number      // Current bid depth (USD)
    bidDepthMedian?: number   // Median bid depth (USD)
  }
}

interface BehaviouralResult {
  buyLayers: GridOrder[]
  sellLayers: GridOrder[]
  suspendBuys: boolean
  reason?: string
}

/**
 * Per-token behavioural risk profiles
 * Values from table: FOMO/KNIFE thresholds in % (converted to decimals)
 */
const BEHAVIOURAL_PROFILES: Record<string, Record<BehaviouralRiskMode, BehaviouralConfig>> = {
  ZEC: {
    normal: {
      fomoRet1m: 0.012,      // 1.2%
      fomoRet5m: 0.030,      // 3.0%
      knifeRet1m: -0.010,   // -1.0%
      knifeRet5m: -0.030,    // -3.0%
      minDepthRatio: 0.30,
      fomoSpreadBoost: 1.3,
      knifeSuspendMs: 2 * 60_000,  // 2 min
    },
    aggressive: {
      fomoRet1m: 0.008,      // 0.8%
      fomoRet5m: 0.020,      // 2.0%
      knifeRet1m: -0.008,    // -0.8%
      knifeRet5m: -0.023,    // -2.3%
      minDepthRatio: 0.35,
      fomoSpreadBoost: 1.7,
      knifeSuspendMs: 4 * 60_000,  // 4 min
    },
  },
  UNI: {
    normal: {
      fomoRet1m: 0.010,      // 1.0%
      fomoRet5m: 0.025,      // 2.5%
      knifeRet1m: -0.008,    // -0.8%
      knifeRet5m: -0.025,    // -2.5%
      minDepthRatio: 0.25,
      fomoSpreadBoost: 1.4,
      knifeSuspendMs: 3 * 60_000,  // 3 min
    },
    aggressive: {
      fomoRet1m: 0.007,      // 0.7%
      fomoRet5m: 0.018,      // 1.8%
      knifeRet1m: -0.007,    // -0.7%
      knifeRet5m: -0.020,    // -2.0%
      minDepthRatio: 0.30,
      fomoSpreadBoost: 1.8,
      knifeSuspendMs: 5 * 60_000,  // 5 min
    },
  },
  VIRTUAL: {
    normal: {
      fomoRet1m: 0.009,      // 0.9%
      fomoRet5m: 0.022,      // 2.2%
      knifeRet1m: -0.009,    // -0.9%
      knifeRet5m: -0.027,    // -2.7%
      minDepthRatio: 0.25,
      fomoSpreadBoost: 1.5,
      knifeSuspendMs: 3 * 60_000,  // 3 min
    },
    aggressive: {
      fomoRet1m: 0.007,      // 0.7%
      fomoRet5m: 0.016,      // 1.6%
      knifeRet1m: -0.007,    // -0.7%
      knifeRet5m: -0.018,    // -1.8%
      minDepthRatio: 0.35,
      fomoSpreadBoost: 1.9,
      knifeSuspendMs: 5 * 60_000,  // 5 min
    },
  },
}

/**
 * Get behavioural config for a token
 * Falls back to ZEC normal if token not found
 */
function getBehaviouralConfig(token: string, mode: BehaviouralRiskMode): BehaviouralConfig {
  const upper = token.toUpperCase()
  const tokenConfig = BEHAVIOURAL_PROFILES[upper]
  if (tokenConfig && tokenConfig[mode]) {
    return tokenConfig[mode]
  }
  // Fallback to ZEC normal
  return BEHAVIOURAL_PROFILES.ZEC.normal
}

/**
 * Apply behavioural risk filters to grid layers
 */
export function applyBehaviouralRiskToLayers(ctx: BehaviouralContext): BehaviouralResult {
  const { mode, pair, midPrice } = ctx
  let { buyLayers, sellLayers } = ctx

  // Extract token symbol from pair (e.g. "ZEC-PERP" -> "ZEC")
  const token = pair.split(/[-_]/)[0].toUpperCase()
  
  // Get per-token config
  const cfg = getBehaviouralConfig(token, mode)

  const r = ctx.recentReturns || {}
  const ob = ctx.orderbookStats || {}

  // 🧠 Detect FOMO (rapid price increase)
  // ret1m/ret5m are already in decimal format (e.g. 0.012 = 1.2%)
  const isFomo =
    (r.ret1m ?? 0) >= cfg.fomoRet1m ||
    (r.ret5m ?? 0) >= cfg.fomoRet5m

  // 🧠 Detect falling knife (rapid price drop or orderbook collapse)
  const depthRatio =
    ob.bidDepthMedian && ob.bidDepthMedian > 0
      ? (ob.bidDepthNow ?? 0) / ob.bidDepthMedian
      : 1

  const isKnife =
    (r.ret1m ?? 0) <= cfg.knifeRet1m ||
    (r.ret5m ?? 0) <= cfg.knifeRet5m ||
    depthRatio < cfg.minDepthRatio

  // 🧠 2. CASE: spadający nóż → wyłącz BUY warstwy
  if (isKnife) {
    return {
      buyLayers: [],
      sellLayers, // SELL zostawiamy, możesz dodać własny limit
      suspendBuys: true,
      reason: `knife_detected token=${token} ret1m=${((r.ret1m ?? 0) * 100).toFixed(2)}% ret5m=${((r.ret5m ?? 0) * 100).toFixed(2)}% depthRatio=${depthRatio.toFixed(2)} suspend=${(cfg.knifeSuspendMs / 60_000).toFixed(0)}min`,
    }
  }

  // 🧠 3. CASE: FOMO/pump → odsuwamy BUY warstwy od rynku
  if (isFomo && buyLayers.length > 0) {
    const adjustedBuy = buyLayers.map((layer) => {
      // Calculate current distance from mid in bps
      const distBps = ((midPrice - layer.price) / midPrice) * 10_000
      // Increase distance by fomoSpreadBoost
      const newDistBps = distBps * cfg.fomoSpreadBoost
      // Calculate new price further from mid
      const newPrice = midPrice * (1 - newDistBps / 10_000)
      return { ...layer, price: newPrice }
    })

    return {
      buyLayers: adjustedBuy,
      sellLayers,
      suspendBuys: false,
      reason: `fomo_guard token=${token} ret1m=${((r.ret1m ?? 0) * 100).toFixed(2)}% ret5m=${((r.ret5m ?? 0) * 100).toFixed(2)}% spreadBoost=${cfg.fomoSpreadBoost.toFixed(1)}x`,
    }
  }

  // 🧠 4. CASE: brak specjalnych warunków
  return {
    buyLayers,
    sellLayers,
    suspendBuys: false,
  }
}

