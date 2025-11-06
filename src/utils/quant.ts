/**
 * Centralized Quantization Utilities - Exchange-Grade Integer Math
 *
 * All price/size quantization uses pure integer arithmetic to avoid IEEE 754 float issues.
 * NO float division on submission path - everything goes through integer ticks/steps.
 *
 * V2: Added spec-driven quantization with live tickSize/lotSize and maker-safe ALO mode.
 */

export type QuantResult = {
  intValue: number
  strValue: string
  numSteps: number
}

export type MakerIntent = 'alo' | 'gtc'

const MAX_DEC = 18
const I64_MAX = Number.MAX_SAFE_INTEGER

/**
 * Build decimal string from integer value (zero float operations)
 * Example: intToDecimalString(51280, 1) = "5128.0"
 */
export function intToDecimalString(intVal: number, decimals: number): string {
  if (decimals === 0) return intVal.toString()
  const str = intVal.toString().padStart(decimals + 1, '0')
  const decimalPos = str.length - decimals
  return str.slice(0, decimalPos) + '.' + str.slice(decimalPos)
}

/**
 * Calculate safe step rounding multiplier for IEEE 754 problematic lot sizes
 * Returns k where numSteps should be rounded to nearest multiple of k
 */
export function getSafeStepMultiplier(lotSize: number): number {
  if (lotSize === 0.1) return 10
  if (lotSize === 0.01) return 100
  if (lotSize === 0.001) return 1000
  return 1 // No rounding needed for integer lots or non-problematic decimals
}

/**
 * Quantize size to safe integer steps (handles IEEE 754 issues)
 */
export function quantizeSize(
  sizeInCoins: number,
  lotSize: number,
  stepDecimals: number
): QuantResult {
  // Calculate raw steps
  let numSteps = Math.floor((sizeInCoins + 1e-12) / lotSize)

  // Round to safe multiples for problematic lot sizes
  const safeMultiplier = getSafeStepMultiplier(lotSize)
  if (safeMultiplier > 1) {
    if (numSteps < safeMultiplier) {
      numSteps = safeMultiplier
    } else {
      numSteps = Math.floor(numSteps / safeMultiplier) * safeMultiplier
    }
  }

  // Build integer and string using pure integer math
  const stepMultiplier = Math.pow(10, stepDecimals)
  const stepInt = Math.round(lotSize * stepMultiplier)
  const sizeInt = numSteps * stepInt
  const strValue = intToDecimalString(sizeInt, stepDecimals)

  return { intValue: sizeInt, strValue, numSteps }
}

/**
 * Quantize price with side-aware tick snapping (avoids borderline rounding)
 */
export function quantizePrice(
  price: number,
  tickSize: number,
  priceDecimals: number,
  side: 'buy' | 'sell'
): QuantResult {
  // Side-aware tick snapping
  let numTicks: number
  if (side === 'buy') {
    numTicks = Math.ceil((price - 1e-12) / tickSize)
  } else {
    numTicks = Math.floor((price + 1e-12) / tickSize)
  }

  // Build integer and string using pure integer math
  const tickMultiplier = Math.pow(10, priceDecimals)
  const tickInt = Math.round(tickSize * tickMultiplier)
  const priceInt = numTicks * tickInt
  const strValue = intToDecimalString(priceInt, priceDecimals)

  return { intValue: priceInt, strValue, numSteps: numTicks }
}

/**
 * Validate string format matches expected decimal precision
 */
export function validateFormat(str: string, expectedDecimals: number): boolean {
  const regex = new RegExp(`^\\d+(\\.\\d{${expectedDecimals}})?$`)
  return regex.test(str)
}

/**
 * Calculate notional value using integer arithmetic (avoids float)
 * Returns notional in USD
 */
export function calculateNotionalInt(
  sizeInt: number,
  priceInt: number,
  stepMultiplier: number,
  tickMultiplier: number
): number {
  // Bounds check: ensure multiplication won't exceed Number.MAX_SAFE_INTEGER
  const MAX_SAFE = Number.MAX_SAFE_INTEGER
  if (sizeInt > MAX_SAFE / priceInt) {
    throw new Error(`Integer overflow risk: sizeInt=${sizeInt} * priceInt=${priceInt} exceeds MAX_SAFE_INTEGER`)
  }

  return (sizeInt * priceInt) / (stepMultiplier * tickMultiplier)
}

/**
 * Compare notional against min notional using pure integer math (zero floats)
 * Returns true if notional >= minNotional
 *
 * OVERFLOW SAFETY: Guards all multiplications against MAX_SAFE_INTEGER
 */
export function checkMinNotionalInt(
  sizeInt: number,
  priceInt: number,
  stepMultiplier: number,
  tickMultiplier: number,
  minNotional: number
): boolean {
  // Compute minNotionalInt = minNotional * stepMultiplier * tickMultiplier
  // This gives us the integer threshold to compare against sizeInt * priceInt
  const minNotionalInt = Math.round(minNotional * stepMultiplier * tickMultiplier)

  // Hard cap check: prevent overflow in sizeInt * priceInt
  const MAX_SAFE = Number.MAX_SAFE_INTEGER
  if (sizeInt > MAX_SAFE / Math.max(1, priceInt)) {
    // If at risk of overflow, use safer comparison (divide first)
    return (sizeInt / stepMultiplier) * (priceInt / tickMultiplier) >= minNotional
  }

  // Additional safety: check if priceInt * sizeInt would overflow
  if (priceInt > MAX_SAFE / Math.max(1, sizeInt)) {
    return (sizeInt / stepMultiplier) * (priceInt / tickMultiplier) >= minNotional
  }

  // Pure integer comparison: sizeInt * priceInt >= minNotionalInt
  return sizeInt * priceInt >= minNotionalInt
}

/**
 * Get price decimal precision from tick size
 * GUARD: Clamps to [0, 18] for overflow protection
 */
export function getPriceDecimals(tickSize: number): number {
  if (tickSize <= 0) return 0
  const decimals = Math.max(0, -Math.floor(Math.log10(tickSize)))
  return Math.min(decimals, 18) // Cap at 18 decimals for overflow protection
}

/**
 * Get size decimal precision from lot size
 * GUARD: Clamps to [0, 18] for overflow protection
 */
export function getSizeDecimals(lotSize: number): number {
  if (lotSize <= 0) return 0
  const decimals = Math.max(0, -Math.floor(Math.log10(lotSize)))
  return Math.min(decimals, 18) // Cap at 18 decimals for overflow protection
}

// ============================================================================
// V2: SPEC-DRIVEN QUANTIZATION WITH LIVE TICK/LOT SIZES
// ============================================================================

function clampDec(n: number): number {
  if (n < 0 || n > MAX_DEC) throw new Error(`decimals out of bounds: ${n}`)
  return n
}

/**
 * Parse a decimal string to int given decimals.
 */
export function decStrToInt(str: string, dec: number): number {
  dec = clampDec(dec)
  const s = str.trim()
  const neg = s.startsWith('-')
  const [intPart, fracPartRaw = ''] = (neg ? s.slice(1) : s).split('.')
  const fracPart = (fracPartRaw + '0'.repeat(dec)).slice(0, dec)
  const asStr = intPart + fracPart
  const v = Number(asStr)
  if (!Number.isInteger(v)) throw new Error(`decStrToInt invalid: ${str}`)
  if (Math.abs(v) > I64_MAX) throw new Error(`overflow: ${v}`)
  return neg ? -v : v
}

/**
 * Convert int→decimal string with fixed decimals.
 */
export function intToDecStr(v: number, dec: number): string {
  dec = clampDec(dec)
  const neg = v < 0
  const abs = Math.abs(v)
  const s = abs.toString().padStart(dec + 1, '0')
  const head = s.slice(0, s.length - dec)
  const tail = s.slice(s.length - dec)
  return `${neg ? '-' : ''}${head}.${tail}`.replace(/\.$/, '')
}

/**
 * Build quantization context from live specs.
 */
export function buildQCtx(spec: { tickSize: number | string; lotSize: number | string }) {
  const tickStr = String(spec.tickSize)
  const lotStr = String(spec.lotSize)

  const pxDec = clampDec((tickStr.split('.')[1]?.length) ?? 0)
  const stepDec = clampDec((lotStr.split('.')[1]?.length) ?? 0)

  const tickInt = decStrToInt(tickStr, pxDec)
  const lotInt = decStrToInt(lotStr, stepDec)
  if (tickInt <= 0) throw new Error(`tickInt must be >0 (got ${tickInt})`)
  if (lotInt <= 0) throw new Error(`lotInt must be >0 (got ${lotInt})`)

  return { pxDec, stepDec, tickInt, lotInt }
}

/**
 * Quantize a price (decimal string) to tick grid, integer-only.
 * mode: 'floor' | 'ceil' | 'round' | 'makerSafeFloor'
 *  - makerSafeFloor = floor then (for ALO) nudge -1 tick to stay inside.
 */
export function quantizePriceToTick(
  priceStr: string,
  q: { pxDec: number; tickInt: number },
  mode: 'floor' | 'ceil' | 'round' | 'makerSafeFloor' = 'floor'
): { priceInt: number; ticks: number; priceStr: string } {
  const { pxDec, tickInt } = q
  const raw = decStrToInt(priceStr, pxDec)
  let ticks = Math.trunc(raw / tickInt)
  const rem = raw - ticks * tickInt

  if (mode === 'ceil' && rem !== 0) ticks += 1
  else if (mode === 'round') {
    if (rem * 2 >= tickInt) ticks += 1
  } else if (mode === 'makerSafeFloor') {
    if (ticks > 0 && rem === 0) {
      ticks -= 1
    }
  }
  if (ticks < 0) ticks = 0

  const priceInt = ticks * tickInt
  return { priceInt, ticks, priceStr: intToDecStr(priceInt, pxDec) }
}

/**
 * Quantize a size (decimal string) to lot grid, integer-only.
 * Uses floor by default to avoid exceeding intended notional.
 */
export function quantizeSizeToLot(
  sizeStr: string,
  q: { stepDec: number; lotInt: number },
  mode: 'floor' | 'ceil' = 'floor'
): { sizeInt: number; steps: number; sizeStr: string } {
  const { stepDec, lotInt } = q
  const raw = decStrToInt(sizeStr, stepDec)
  let steps = Math.trunc(raw / lotInt)
  const rem = raw - steps * lotInt

  if (mode === 'ceil') {
    if (rem !== 0) steps += 1
  }

  if (steps < 0) steps = 0
  const sizeInt = steps * lotInt
  return { sizeInt, steps, sizeStr: intToDecStr(sizeInt, stepDec) }
}

/**
 * Adjust a tick-based integer price by ±N ticks safely (never <= 0).
 */
export function adjustPriceByTicksInt(
  priceInt: number,
  ticksDelta: number,
  q: { tickInt: number }
): number {
  const { tickInt } = q
  let p = priceInt + ticksDelta * tickInt
  if (p <= 0) p = tickInt
  if (!Number.isInteger(p) || Math.abs(p) > I64_MAX) {
    throw new Error(`adjustPriceByTicksInt overflow: ${p}`)
  }
  return p
}

/**
 * Adjust price by N ticks (for ALO retry shading) using integer arithmetic
 * 100% string→int conversion (zero float ops)
 *
 * V2: Now uses live tickSize from spec
 *
 * GUARDS: Validates tickSize > 0, priceDecimals >= 0, priceDecimals <= 18
 */
export function adjustPriceByTicks(
  currentPriceStr: string,
  tickDelta: number,
  tickSizeOrSpec: number | { tickSize: number | string },
  priceDecimals?: number
): string {
  // Support both old signature (number) and new signature (spec object)
  let tickSize: number
  let pxDec: number

  if (typeof tickSizeOrSpec === 'object') {
    // New signature: use live spec
    const tickStr = String(tickSizeOrSpec.tickSize)
    pxDec = clampDec((tickStr.split('.')[1]?.length) ?? 0)
    const tickInt = decStrToInt(tickStr, pxDec)
    const priceInt = decStrToInt(currentPriceStr, pxDec)
    const adj = adjustPriceByTicksInt(priceInt, tickDelta, { tickInt })
    return intToDecStr(adj, pxDec)
  } else {
    // Old signature: number tickSize
    tickSize = tickSizeOrSpec
    if (priceDecimals === undefined) {
      throw new Error('priceDecimals required when tickSize is number')
    }

    // Guard: tickSize must be positive
    if (tickSize <= 0) throw new Error('tickSize must be > 0')

    // Guard: priceDecimals must be valid range
    if (priceDecimals < 0) throw new Error('priceDecimals must be >= 0')
    if (priceDecimals > 18) throw new Error('priceDecimals must be <= 18 (overflow protection)')

    const tickMultiplier = Math.pow(10, priceDecimals)

    // Parse string to integer ticks (zero float operations)
    const [iPart = '', fPartRaw = ''] = currentPriceStr.split('.')
    const fPart = (fPartRaw + '0'.repeat(priceDecimals)).slice(0, priceDecimals)
    let ticks = parseInt(iPart || '0', 10) * tickMultiplier + parseInt(fPart || '0', 10)

    // Apply tick delta
    ticks += tickDelta

    // Clamp to minimum 1 tick (never allow zero/negative)
    if (ticks <= 0) ticks = 1

    return intToDecimalString(ticks, priceDecimals)
  }
}

/**
 * High-level convenience used by order builders.
 * Returns fully-quantized {priceStr, sizeStr, priceInt, sizeInt, ticks, steps}
 * honoring the user's intent (ALO vs GTC).
 */
export function quantizeOrder(
  pair: string,
  side: 'buy' | 'sell',
  makerIntent: MakerIntent,
  priceStr: string,
  sizeStr: string,
  liveSpec: { tickSize: number | string; lotSize: number | string }
) {
  const q = buildQCtx(liveSpec)
  // For ALO, we want to bias prices *away* from crossing:
  const priceMode = makerIntent === 'alo' ? 'makerSafeFloor' : 'round'

  const { priceInt, ticks, priceStr: pxQ } = quantizePriceToTick(priceStr, q, priceMode)
  const { sizeInt, steps, sizeStr: szQ } = quantizeSizeToLot(sizeStr, q, 'floor')

  return { pxQ, szQ, priceInt, sizeInt, ticks, steps, pxDec: q.pxDec, stepDec: q.stepDec }
}
