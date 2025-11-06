/**
 * E_TICK retry guard with spec refresh
 *
 * One-retry mechanism for E_TICK errors that refreshes specs before retrying.
 */

import { applySpecOverrides } from './spec_overrides.js'

export type AssetSpec = {
  tickSize: string | number
  lotSize: string | number
}

export type SpecProvider = (pair: string) => Promise<AssetSpec>

export type RetryGuardConfig = {
  enabled: boolean
  maxRetries: number
  specTTLMs: number
}

const DEFAULT_CONFIG: RetryGuardConfig = {
  enabled: true,
  maxRetries: 1,
  specTTLMs: 60000
}

type SpecCacheEntry = {
  spec: AssetSpec
  timestamp: number
}

const specCache = new Map<string, SpecCacheEntry>()

/**
 * Get spec with caching and TTL
 *
 * @param pair - Trading pair
 * @param provider - Async spec provider function
 * @param ttlMs - Cache TTL in milliseconds
 * @returns Spec with overrides applied
 */
export async function getSpecWithCache(
  pair: string,
  provider: SpecProvider,
  ttlMs: number
): Promise<AssetSpec> {
  const cached = specCache.get(pair)
  const now = Date.now()

  if (cached && now - cached.timestamp < ttlMs) {
    return applySpecOverrides(pair, cached.spec)
  }

  const freshSpec = await provider(pair)
  specCache.set(pair, { spec: freshSpec, timestamp: now })

  return applySpecOverrides(pair, freshSpec)
}

/**
 * Force refresh spec (used after E_TICK error)
 */
export async function refreshSpec(
  pair: string,
  provider: SpecProvider
): Promise<AssetSpec> {
  const freshSpec = await provider(pair)
  specCache.set(pair, { spec: freshSpec, timestamp: Date.now() })

  return applySpecOverrides(pair, freshSpec)
}

/**
 * Clear spec cache for a pair (for testing or manual refresh)
 */
export function clearSpecCache(pair?: string): void {
  if (pair) {
    specCache.delete(pair)
  } else {
    specCache.clear()
  }
}

/**
 * Get retry guard config from environment
 */
export function getRetryGuardConfigFromEnv(): RetryGuardConfig {
  return {
    enabled: process.env.RETRY_GUARD_ENABLED !== 'false',
    maxRetries: Number(process.env.RETRY_GUARD_MAX_RETRIES ?? DEFAULT_CONFIG.maxRetries),
    specTTLMs: Number(process.env.RETRY_GUARD_SPEC_TTL_MS ?? DEFAULT_CONFIG.specTTLMs)
  }
}

/**
 * Check if error is E_TICK
 */
export function isETICKError(error: any): boolean {
  if (!error) return false

  const errStr = String(error).toLowerCase()
  return (
    errStr.includes('e_tick') ||
    errStr.includes('tick_size') ||
    errStr.includes('invalid tick')
  )
}

/**
 * Log retry attempt
 */
export function logRetryAttempt(
  pair: string,
  attempt: number,
  maxRetries: number,
  reason: string
): void {
  console.log(
    `retry_guard pair=${pair} attempt=${attempt}/${maxRetries} reason="${reason}"`
  )
}

/**
 * Log retry success
 */
export function logRetrySuccess(
  pair: string,
  attempt: number
): void {
  console.log(
    `retry_guard_success pair=${pair} attempt=${attempt} result=success`
  )
}

/**
 * Log retry exhausted
 */
export function logRetryExhausted(
  pair: string,
  attempts: number
): void {
  console.log(
    `retry_guard_exhausted pair=${pair} attempts=${attempts} result=failed`
  )
}
