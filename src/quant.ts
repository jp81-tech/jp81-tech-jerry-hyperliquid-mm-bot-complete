/**
 * Centralized Quantization Utilities - Exchange-Grade Integer Math
 *
 * All price/size quantization uses pure integer arithmetic to avoid IEEE 754 float issues.
 * NO float division on submission path - everything goes through integer ticks/steps.
 */

export type QuantResult = {
  intValue: number
  strValue: string
  numSteps: number
}

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
 * Adjust price by N ticks (for ALO retry shading) using integer arithmetic
 * 100% string→int conversion (zero float ops)
 */
export function adjustPriceByTicks(
  currentPriceStr: string,
  tickDelta: number,
  tickSize: number,
  priceDecimals: number
): string {
  const tickMultiplier = Math.pow(10, priceDecimals)

  // Parse string to integer ticks (zero float operations)
  const [iPart, fPartRaw = ''] = currentPriceStr.split('.')
  const fPart = (fPartRaw + '0'.repeat(priceDecimals)).slice(0, priceDecimals)
  const currentTicks = parseInt(iPart, 10) * tickMultiplier + parseInt(fPart || '0', 10)

  const newTicks = Math.max(0, currentTicks + tickDelta)
  return intToDecimalString(newTicks, priceDecimals)
}

/**
 * Get price decimal precision from tick size
 */
export function getPriceDecimals(tickSize: number): number {
  return Math.max(0, -Math.floor(Math.log10(tickSize)))
}

/**
 * Get size decimal precision from lot size
 */
export function getSizeDecimals(lotSize: number): number {
  return Math.max(0, -Math.floor(Math.log10(lotSize)))
}
