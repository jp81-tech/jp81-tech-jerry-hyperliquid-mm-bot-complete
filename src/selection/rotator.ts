/**
 * Auto-rotation module for dynamic pair selection
 *
 * Scores pairs by realized vol, spread cost, depth, fees, and optional Nansen signals.
 * Rebalances capital to top N pairs every rotation window.
 */

export type MarketStats = {
  pair: string
  realizedVol5m: number
  spreadBps: number
  topOfBookUsd: number
  feesBps: number
}

export type NansenSignalFn = (pair: string) => number

export type RotatorConfig = {
  wVol: number
  wSpread: number
  wDepth: number
  wFees: number
  wNansen: number
  minDepthUsd: number
  maxSpreadBps: number
}

const DEFAULT_CONFIG: RotatorConfig = {
  wVol: 1.0,
  wSpread: -0.6,
  wDepth: 0.4,
  wFees: -0.4,
  wNansen: 0.5,
  minDepthUsd: 2000,
  maxSpreadBps: 40
}

/**
 * Score a single pair for selection priority
 *
 * Returns -Infinity if pair fails filters (depth, spread)
 */
export function scorePair(
  s: MarketStats,
  getNansen: NansenSignalFn | null,
  cfg: RotatorConfig = DEFAULT_CONFIG
): number {
  if (s.topOfBookUsd < cfg.minDepthUsd) return -1e9
  if (s.spreadBps > cfg.maxSpreadBps) return -1e9

  const zVol = Math.log(1 + s.realizedVol5m)
  const zSpr = -Math.log(1 + s.spreadBps / 1e4)
  const zDepth = Math.log(1 + s.topOfBookUsd / 1e3)
  const zFees = -s.feesBps / 10000

  const nansen = getNansen ? getNansen(s.pair) : 0

  return (
    cfg.wVol * zVol +
    cfg.wSpread * zSpr +
    cfg.wDepth * zDepth +
    cfg.wFees * zFees +
    cfg.wNansen * nansen
  )
}

/**
 * Select top N pairs by score
 *
 * @param stats - Market stats for all candidate pairs
 * @param getNansen - Optional Nansen signal function returning [-1..+1]
 * @param topN - Number of pairs to select
 * @param cfg - Scoring weights and filters
 * @returns Array of top N pair symbols
 */
export function pickTopN(
  stats: MarketStats[],
  getNansen: NansenSignalFn | null,
  topN = 3,
  cfg: RotatorConfig = DEFAULT_CONFIG
): string[] {
  return stats
    .map(s => ({ ...s, _score: scorePair(s, getNansen, cfg) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, topN)
    .map(x => x.pair)
}

/**
 * Get rotator config from environment
 */
export function getRotatorConfigFromEnv(): RotatorConfig {
  return {
    wVol: Number(process.env.ROTATE_W_VOL ?? DEFAULT_CONFIG.wVol),
    wSpread: Number(process.env.ROTATE_W_SPREAD ?? DEFAULT_CONFIG.wSpread),
    wDepth: Number(process.env.ROTATE_W_DEPTH ?? DEFAULT_CONFIG.wDepth),
    wFees: Number(process.env.ROTATE_W_FEES ?? DEFAULT_CONFIG.wFees),
    wNansen: Number(process.env.ROTATE_W_NANSEN ?? DEFAULT_CONFIG.wNansen),
    minDepthUsd: Number(process.env.ROTATE_MIN_DEPTH_USD ?? DEFAULT_CONFIG.minDepthUsd),
    maxSpreadBps: Number(process.env.ROTATE_MAX_SPREAD_BPS ?? DEFAULT_CONFIG.maxSpreadBps)
  }
}
