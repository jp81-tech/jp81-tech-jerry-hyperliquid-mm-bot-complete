/**
 * Nansen Pro signal adapter
 *
 * Maps Nansen smart money signals to normalized [-1..+1] range for rotator.
 */

export type NansenSignal = {
  pair: string
  smart_buy_ratio: number
  smart_money_netflow_24h: number
  whale_accumulation_score: number
  timestamp: number
}

declare global {
  var __nansen: Record<string, NansenSignal> | undefined
}

/**
 * Get normalized Nansen signal for a pair
 *
 * @param pair - Trading pair symbol
 * @returns Signal in [-1..+1] range, 0 if no data
 */
export function getNansenSignal(pair: string): number {
  const s = globalThis.__nansen?.[pair] ?? null
  if (!s) return 0

  const ratio = Math.max(0, Math.min(1, s.smart_buy_ratio))
  return (ratio - 0.5) * 2
}

/**
 * Get composite Nansen score using multiple signals
 *
 * @param pair - Trading pair symbol
 * @returns Composite score in [-1..+1] range
 */
export function getNansenCompositeSignal(pair: string): number {
  const s = globalThis.__nansen?.[pair] ?? null
  if (!s) return 0

  const buyRatio = Math.max(0, Math.min(1, s.smart_buy_ratio))
  const buySignal = (buyRatio - 0.5) * 2

  const netflowSignal = Math.tanh(s.smart_money_netflow_24h / 100000)

  const accumSignal = Math.max(-1, Math.min(1, s.whale_accumulation_score / 100))

  return (buySignal * 0.4 + netflowSignal * 0.3 + accumSignal * 0.3)
}

/**
 * Check if Nansen data is fresh (updated within last 5 minutes)
 */
export function isNansenDataFresh(pair: string, maxAgeMs = 300000): boolean {
  const s = globalThis.__nansen?.[pair] ?? null
  if (!s) return false

  const age = Date.now() - s.timestamp
  return age < maxAgeMs
}

/**
 * Get all pairs with fresh Nansen data
 */
export function getPairsWithFreshNansen(maxAgeMs = 300000): string[] {
  if (!globalThis.__nansen) return []

  return Object.keys(globalThis.__nansen).filter(pair =>
    isNansenDataFresh(pair, maxAgeMs)
  )
}
