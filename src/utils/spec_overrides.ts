/**
 * Spec Override Utility
 *
 * Allows ENV-based overrides for tickSize/lotSize per asset
 * to hotfix stale spec issues without code changes.
 *
 * Usage:
 *   const spec = applySpecOverrides('SOL', { tickSize: '0.001', lotSize: '0.1' })
 *   // Returns: { tickSize: '0.01', lotSize: '0.1' } if SPEC_OVERRIDE_SOL_TICK=0.01
 */

export type AssetSpec = {
  tickSize: string | number
  lotSize: string | number
}

/**
 * Apply ENV-based overrides for a given asset.
 *
 * ENV variables:
 *   SPEC_OVERRIDE_{SYMBOL}_TICK=0.01
 *   SPEC_OVERRIDE_{SYMBOL}_LOT=0.1
 *
 * @param symbol - Asset symbol (e.g., 'SOL', 'ASTER')
 * @param baseSpec - Base spec from exchange API
 * @returns Spec with overrides applied
 */
export function applySpecOverrides(symbol: string, baseSpec: AssetSpec): AssetSpec {
  const symUpper = symbol.toUpperCase()

  const tickOverride = process.env[`SPEC_OVERRIDE_${symUpper}_TICK`]
  const lotOverride = process.env[`SPEC_OVERRIDE_${symUpper}_LOT`]

  const result: AssetSpec = {
    tickSize: tickOverride ?? baseSpec.tickSize,
    lotSize: lotOverride ?? baseSpec.lotSize
  }

  // Log when override is applied
  if (tickOverride || lotOverride) {
    console.log(
      `🔧 SPEC_OVERRIDE applied for ${symbol}: ` +
      `tick=${String(baseSpec.tickSize)}→${String(result.tickSize)} ` +
      `lot=${String(baseSpec.lotSize)}→${String(result.lotSize)}`
    )
  }

  return result
}

/**
 * Get all active spec overrides (for diagnostics)
 */
export function getActiveOverrides(): Record<string, { tick?: string; lot?: string }> {
  const overrides: Record<string, { tick?: string; lot?: string }> = {}

  for (const [key, value] of Object.entries(process.env)) {
    const tickMatch = key.match(/^SPEC_OVERRIDE_([A-Z]+)_TICK$/)
    const lotMatch = key.match(/^SPEC_OVERRIDE_([A-Z]+)_LOT$/)

    if (tickMatch && value) {
      const sym = tickMatch[1]
      overrides[sym] = overrides[sym] || {}
      overrides[sym].tick = value
    }

    if (lotMatch && value) {
      const sym = lotMatch[1]
      overrides[sym] = overrides[sym] || {}
      overrides[sym].lot = value
    }
  }

  return overrides
}
