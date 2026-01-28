/**
 * SmartMoneyAnalyzer.ts - TypeScript port of whale_tracker.py analytical logic
 *
 * Provides trading mode determination, divergence detection, and squeeze timeout
 * calculations based on Smart Money positioning and PnL data.
 *
 * Compatible with NansenBiasEntry from src/mm/nansen_bias_cache.ts
 */

import type {
  NansenTrend,
  NansenTrendStrength,
  NansenTradingMode,
  NansenBiasEntry,
} from '../../mm/nansen_bias_cache'

// ============================================================
// TYPES & INTERFACES
// ============================================================

/** Input data for trading mode analysis */
export interface TradingModeInput {
  /** Total weighted long position value (USD) */
  weightedLongs: number
  /** Total weighted short position value (USD) */
  weightedShorts: number
  /** Total unrealized PnL for longs (USD) */
  longsUpnl: number
  /** Total unrealized PnL for shorts (USD) */
  shortsUpnl: number
  /** 24h change in shorts uPnL (for momentum detection) */
  shortsUpnlChange24h?: number
  /** 24h change in longs uPnL (for momentum detection) */
  longsUpnlChange24h?: number
  /** Flow velocity (positive = buying, negative = selling) */
  velocity?: number
  /** How long token has been in CONTRARIAN mode (hours) */
  squeezeDurationHours?: number
  /** Current trend direction */
  trend?: NansenTrend
}

/** Result from trading mode determination */
export interface TradingModeResult {
  mode: NansenTradingMode
  confidence: number
  reason: string
  maxPositionMultiplier: number
  positionRatio: number
  pnlRatio: number
  longValueUsd: number
  shortValueUsd: number
  longPnlUsd: number
  shortPnlUsd: number
  momentumWarning?: string
  divergenceWarning?: string
  squeezeDurationHours?: number
  squeezeFailed?: boolean
}

/** Result from divergence detection */
export interface DivergenceResult {
  hasDivergence: boolean
  penalty: number
  warning: string | null
}

/** Result from squeeze timeout calculation */
export interface SqueezeTimeoutResult {
  penalty: number
  warning: string | null
  shouldExit: boolean
}

/** SM direction based on position ratio */
export type SmDirection = 'long' | 'short' | 'neutral'

/** PnL direction - which side is winning */
export type PnlDirection = 'longs_winning' | 'shorts_winning'

// ============================================================
// CONSTANTS - Exact 1:1 port from whale_tracker.py
// ============================================================

/**
 * MODE_THRESHOLDS - Thresholds for trading mode determination
 * Ported 1:1 from whale_tracker.py
 */
export const MODE_THRESHOLDS = {
  /** shorts/longs > 2.0 = SHORT dominant */
  SHORT_DOMINANT_RATIO: 2.0,
  /** shorts/longs < 0.5 = LONG dominant */
  LONG_DOMINANT_RATIO: 0.5,
  /** Minimum $50k total exposure for signal */
  MIN_TOTAL_USD: 50000,
  /** uPnL < 0 = underwater */
  UNDERWATER_THRESHOLD: 0,
  /** If PnL ratio > 3.0x, treat as dominant even in NEUTRAL zone */
  PNL_DOMINANT_RATIO: 3.0,
} as const

/**
 * SQUEEZE_TIMEOUT_THRESHOLDS - Protection for CONTRARIAN modes
 * Track how long we've been in CONTRARIAN mode without squeeze
 * Ported 1:1 from whale_tracker.py
 */
export const SQUEEZE_TIMEOUT_THRESHOLDS = {
  /** After 4h, start reducing confidence */
  WARNING_HOURS: 4.0,
  /** After 8h, heavily reduce confidence */
  CRITICAL_HOURS: 8.0,
  /** After 12h, switch to NEUTRAL (squeeze failed) */
  MAX_HOURS: 12.0,
  /** Lose 5% confidence per hour after WARNING */
  CONFIDENCE_DECAY_PER_HOUR: 5,
} as const

/**
 * DIVERGENCE_THRESHOLDS - Perps vs Spot divergence detection
 * Compares perps flow with price momentum to detect potential traps
 * Ported 1:1 from whale_tracker.py
 */
export const DIVERGENCE_THRESHOLDS = {
  /** If flow and momentum disagree by >30%, flag divergence */
  FLOW_VS_MOMENTUM_THRESHOLD: 0.3,
  /** Reduce confidence by 15% on divergence */
  DIVERGENCE_CONFIDENCE_PENALTY: 15,
  /** Minimum velocity ($) to consider for divergence */
  MIN_VELOCITY_FOR_SIGNAL: 100000,
} as const

/**
 * MOMENTUM_THRESHOLDS - "Stale PnL" protection
 * Detect when PnL is high but momentum is reversing
 */
export const MOMENTUM_THRESHOLDS = {
  /** Minimum uPnL to trigger momentum check */
  MIN_UPNL_FOR_CHECK: 100000,
  /** Minimum 24h change to trigger warning */
  MIN_CHANGE_FOR_WARNING: -50000,
  /** Maximum penalty from momentum reversal */
  MAX_MOMENTUM_PENALTY: 30,
  /** Velocity threshold for squeeze warning */
  SQUEEZE_WARNING_VELOCITY: 500000,
} as const

/**
 * CONFIDENCE_TO_POSITION_MULT - Granular position sizing based on confidence
 * Higher confidence = larger position allowed
 * Format: [minConf, maxConf, multiplier]
 */
export const CONFIDENCE_TO_POSITION_MULT: ReadonlyArray<readonly [number, number, number]> = [
  [90, 100, 1.0],    // 90-100% confidence → full position
  [75, 90, 0.75],    // 75-90% confidence → 75% position
  [60, 75, 0.5],     // 60-75% confidence → 50% position
  [40, 60, 0.25],    // 40-60% confidence → 25% position
  [0, 40, 0.1],      // <40% confidence → 10% position (basically skip)
] as const

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get maxPositionMultiplier based on confidence level.
 * Higher confidence = larger allowed position.
 */
export function getPositionMultFromConfidence(confidence: number): number {
  for (const [minC, maxC, mult] of CONFIDENCE_TO_POSITION_MULT) {
    if (confidence >= minC && confidence < maxC) {
      return mult
    }
  }
  return 0.5 // Default
}

/**
 * Calculate position ratio (shorts/longs)
 * Handles division by zero safely
 */
export function calculatePositionRatio(longs: number, shorts: number): number {
  if (longs === 0) {
    return shorts > 0 ? 999.0 : 1.0
  }
  return shorts / longs
}

/**
 * Calculate PnL ratio between winning and losing side
 */
export function calculatePnlRatio(longsUpnl: number, shortsUpnl: number): number {
  if (shortsUpnl > 0 && longsUpnl > 0) {
    return Math.max(shortsUpnl, longsUpnl) / Math.min(shortsUpnl, longsUpnl)
  } else if (shortsUpnl > 0 || longsUpnl > 0) {
    return 999.0
  }
  return 0.0
}

/**
 * Determine SM direction from position ratio
 */
export function getSmDirection(weightedLongs: number, weightedShorts: number): SmDirection {
  if (weightedShorts > weightedLongs * 2) {
    return 'short'
  } else if (weightedLongs > weightedShorts * 2) {
    return 'long'
  }
  return 'neutral'
}

/**
 * Determine which side is winning based on uPnL
 */
export function getPnlDirection(longsUpnl: number, shortsUpnl: number): PnlDirection {
  return shortsUpnl > longsUpnl ? 'shorts_winning' : 'longs_winning'
}

// ============================================================
// CORE ANALYTICAL FUNCTIONS
// ============================================================

/**
 * Detect divergence between perps positioning and spot/flow momentum.
 *
 * DIVERGENCE SCENARIOS:
 * 1. SM is SHORT + profitable, but flow is strongly POSITIVE → buyers absorbing shorts
 * 2. SM is LONG + profitable, but flow is strongly NEGATIVE → sellers liquidating
 * 3. Trend opposes dominant position → potential reversal signal
 *
 * Ported 1:1 from whale_tracker.py detect_perps_spot_divergence()
 *
 * @param smDirection - 'long', 'short', or 'neutral' from perps
 * @param smPnlDirection - 'longs_winning' or 'shorts_winning'
 * @param velocity - Flow velocity (positive = buying, negative = selling)
 * @param trend - 'increasing_longs', 'increasing_shorts', 'stable', 'unknown'
 * @param longsUpnl - Current long uPnL
 * @param shortsUpnl - Current short uPnL
 * @returns DivergenceResult with hasDivergence, penalty, and warning
 */
export function detectPerpsSpotDivergence(
  smDirection: SmDirection,
  smPnlDirection: PnlDirection,
  velocity: number,
  trend: NansenTrend,
  longsUpnl: number,
  shortsUpnl: number,
): DivergenceResult {
  const minVelocity = DIVERGENCE_THRESHOLDS.MIN_VELOCITY_FOR_SIGNAL
  let penalty = 0
  const warnings: string[] = []

  // Skip if not enough velocity to matter
  if (Math.abs(velocity) < minVelocity) {
    return { hasDivergence: false, penalty: 0, warning: null }
  }

  // Scenario 1: SM SHORT + winning, but positive flow (buyers absorbing)
  if (smDirection === 'short' && shortsUpnl > longsUpnl && velocity > minVelocity) {
    // Shorts are winning but money is flowing IN (buying pressure)
    // This could mean shorts will get squeezed
    penalty = DIVERGENCE_THRESHOLDS.DIVERGENCE_CONFIDENCE_PENALTY
    warnings.push(`⚠️ DIVERGENCE: SM SHORT winning but +$${Math.round(velocity / 1000)}k inflow (squeeze risk)`)
  }

  // Scenario 2: SM LONG + winning, but negative flow (sellers liquidating)
  else if (smDirection === 'long' && longsUpnl > shortsUpnl && velocity < -minVelocity) {
    // Longs are winning but money is flowing OUT (selling pressure)
    // This could mean longs will get liquidated
    penalty = DIVERGENCE_THRESHOLDS.DIVERGENCE_CONFIDENCE_PENALTY
    warnings.push(`⚠️ DIVERGENCE: SM LONG winning but -$${Math.round(Math.abs(velocity) / 1000)}k outflow (dump risk)`)
  }

  // Scenario 3: Trend opposes dominant position
  if (smDirection === 'short' && trend === 'increasing_longs') {
    penalty = Math.max(penalty, 10) // Additional 10% penalty
    warnings.push(`⚠️ TREND DIVERGENCE: SM SHORT but trend=increasing_longs`)
  } else if (smDirection === 'long' && trend === 'increasing_shorts') {
    penalty = Math.max(penalty, 10)
    warnings.push(`⚠️ TREND DIVERGENCE: SM LONG but trend=increasing_shorts`)
  }

  if (warnings.length > 0) {
    return {
      hasDivergence: true,
      penalty,
      warning: warnings.join(' | '),
    }
  }

  return { hasDivergence: false, penalty: 0, warning: null }
}

/**
 * Calculate confidence penalty and warning based on squeeze duration.
 *
 * SQUEEZE TIMEOUT PROTECTION:
 * - After WARNING_HOURS (4h): Start reducing confidence
 * - After CRITICAL_HOURS (8h): Heavily reduce confidence
 * - After MAX_HOURS (12h): Exit CONTRARIAN mode (squeeze failed)
 *
 * Ported 1:1 from whale_tracker.py calculate_squeeze_timeout_penalty()
 *
 * @param durationHours - How long token has been in CONTRARIAN mode
 * @returns SqueezeTimeoutResult with penalty, warning, and shouldExit flag
 */
export function calculateSqueezeTimeoutPenalty(durationHours: number): SqueezeTimeoutResult {
  const { WARNING_HOURS, CRITICAL_HOURS, MAX_HOURS, CONFIDENCE_DECAY_PER_HOUR } = SQUEEZE_TIMEOUT_THRESHOLDS

  if (durationHours < WARNING_HOURS) {
    return { penalty: 0, warning: null, shouldExit: false }
  }

  if (durationHours >= MAX_HOURS) {
    return {
      penalty: 50,
      warning: `⏰ SQUEEZE TIMEOUT: ${durationHours.toFixed(1)}h > ${MAX_HOURS}h - EXITING`,
      shouldExit: true,
    }
  }

  if (durationHours >= CRITICAL_HOURS) {
    const hoursOver = durationHours - WARNING_HOURS
    const penalty = Math.min(40, Math.floor(hoursOver * CONFIDENCE_DECAY_PER_HOUR))
    return {
      penalty,
      warning: `⏰ SQUEEZE CRITICAL: ${durationHours.toFixed(1)}h in CONTRARIAN - reduce size!`,
      shouldExit: false,
    }
  }

  // WARNING zone
  const hoursOver = durationHours - WARNING_HOURS
  const penalty = Math.min(20, Math.floor(hoursOver * CONFIDENCE_DECAY_PER_HOUR))
  return {
    penalty,
    warning: `⏰ Squeeze taking long (${durationHours.toFixed(1)}h)`,
    shouldExit: false,
  }
}

/**
 * Calculate momentum penalty for "Stale PnL" protection.
 * Detects when PnL is high but momentum is reversing.
 *
 * @param shortsUpnl - Current shorts unrealized PnL
 * @param longsUpnl - Current longs unrealized PnL
 * @param shortsUpnlChange24h - 24h change in shorts uPnL
 * @param longsUpnlChange24h - 24h change in longs uPnL
 * @param velocity - Flow velocity
 * @returns Object with penalty and optional warning
 */
export function calculateMomentumPenalty(
  shortsUpnl: number,
  longsUpnl: number,
  shortsUpnlChange24h: number,
  longsUpnlChange24h: number,
  velocity: number,
): { penalty: number; warning: string | null } {
  let momentumPenalty = 0
  let momentumWarning: string | null = null

  const { MIN_UPNL_FOR_CHECK, MIN_CHANGE_FOR_WARNING, MAX_MOMENTUM_PENALTY, SQUEEZE_WARNING_VELOCITY } = MOMENTUM_THRESHOLDS

  // Check for SHORT signal reversal warning
  if (shortsUpnl > MIN_UPNL_FOR_CHECK && shortsUpnlChange24h < MIN_CHANGE_FOR_WARNING) {
    // Shorts profitable but LOSING money recently = potential reversal
    momentumPenalty = Math.min(MAX_MOMENTUM_PENALTY, Math.abs(shortsUpnlChange24h) / 100000 * 10)
    momentumWarning = `⚠️ Shorts losing momentum (-$${Math.round(Math.abs(shortsUpnlChange24h) / 1000)}k 24h)`
  }

  // Check for LONG signal reversal warning
  if (longsUpnl > MIN_UPNL_FOR_CHECK && longsUpnlChange24h < MIN_CHANGE_FOR_WARNING) {
    // Longs profitable but LOSING money recently = potential reversal
    momentumPenalty = Math.min(MAX_MOMENTUM_PENALTY, Math.abs(longsUpnlChange24h) / 100000 * 10)
    momentumWarning = `⚠️ Longs losing momentum (-$${Math.round(Math.abs(longsUpnlChange24h) / 1000)}k 24h)`
  }

  // Velocity check: if flow is reversing, add warning
  if (velocity > SQUEEZE_WARNING_VELOCITY && shortsUpnl > longsUpnl) {
    // Positive flow (buying) but shorts winning = potential squeeze
    momentumWarning = `⚠️ SQUEEZE WARNING: +$${Math.round(velocity / 1000)}k inflow vs bearish PnL`
    momentumPenalty = Math.max(momentumPenalty, 15)
  }

  return { penalty: momentumPenalty, warning: momentumWarning }
}

/**
 * 🎯 KLUCZOWA FUNKCJA: Determine trading mode based on SM positioning and uPnL.
 *
 * LOGIKA:
 * 1. If SM SHORT dominant AND SM shorts profitable → FOLLOW_SM_SHORT
 * 2. If SM SHORT dominant AND SM shorts underwater → CONTRARIAN_LONG (squeeze)
 * 3. If SM LONG dominant AND SM longs profitable → FOLLOW_SM_LONG
 * 4. If SM LONG dominant AND SM longs underwater → CONTRARIAN_SHORT
 * 5. If mixed/neutral → check PnL dominance → NEUTRAL or follow PnL winner
 *
 * Ported 1:1 from whale_tracker.py determine_trading_mode()
 *
 * @param input - TradingModeInput with position and PnL data
 * @returns TradingModeResult with mode, confidence, reason, and diagnostics
 */
export function determineTradingMode(input: TradingModeInput): TradingModeResult {
  const {
    weightedLongs,
    weightedShorts,
    longsUpnl,
    shortsUpnl,
    shortsUpnlChange24h = 0,
    longsUpnlChange24h = 0,
    velocity = 0,
    squeezeDurationHours = 0,
    trend = 'unknown',
  } = input

  const total = weightedLongs + weightedShorts

  // Base diagnostic data (always included)
  const baseData = {
    longValueUsd: Math.round(weightedLongs),
    shortValueUsd: Math.round(weightedShorts),
    longPnlUsd: Math.round(longsUpnl),
    shortPnlUsd: Math.round(shortsUpnl),
  }

  // ============================================================
  // "STALE PNL" PROTECTION
  // ============================================================
  const momentumResult = calculateMomentumPenalty(
    shortsUpnl,
    longsUpnl,
    shortsUpnlChange24h,
    longsUpnlChange24h,
    velocity
  )
  let momentumPenalty = momentumResult.penalty
  const momentumWarning = momentumResult.warning

  // ============================================================
  // PERPS VS SPOT DIVERGENCE DETECTION
  // ============================================================
  const smDirection = getSmDirection(weightedLongs, weightedShorts)
  const smPnlDirection = getPnlDirection(longsUpnl, shortsUpnl)

  const divergenceResult = detectPerpsSpotDivergence(
    smDirection,
    smPnlDirection,
    velocity,
    trend,
    longsUpnl,
    shortsUpnl
  )

  const divergenceWarning = divergenceResult.warning
  // Combine divergence penalty with momentum penalty
  momentumPenalty = Math.max(momentumPenalty, divergenceResult.penalty)

  // ============================================================
  // INSUFFICIENT DATA CHECK
  // ============================================================
  if (total < MODE_THRESHOLDS.MIN_TOTAL_USD) {
    return {
      mode: 'NEUTRAL',
      confidence: 0,
      reason: `Insufficient SM exposure ($${Math.round(total / 1000)}k < $50k min)`,
      maxPositionMultiplier: 0.1,
      positionRatio: 0,
      pnlRatio: 0,
      ...baseData,
      momentumWarning: momentumWarning ?? undefined,
      divergenceWarning: divergenceWarning ?? undefined,
    }
  }

  // Calculate ratios
  const ratio = calculatePositionRatio(weightedLongs, weightedShorts)
  const pnlRatio = calculatePnlRatio(longsUpnl, shortsUpnl)

  // ============================================================
  // CASE 1: SM SHORT DOMINANT (ratio > 2)
  // ============================================================
  if (ratio > MODE_THRESHOLDS.SHORT_DOMINANT_RATIO) {
    if (shortsUpnl > MODE_THRESHOLDS.UNDERWATER_THRESHOLD) {
      // SM shorts are profitable → FOLLOW THEM (go SHORT)
      let confidence = Math.min(95, 50 + (shortsUpnl / 100000) * 10) // +10 per $100k profit
      // Apply momentum penalty for "Stale PnL" protection
      confidence = Math.max(30, confidence - momentumPenalty)
      // Use confidence-based position sizing for FOLLOW modes
      const posMult = getPositionMultFromConfidence(confidence)
      let reason = `SM SHORT dominant (ratio ${ratio.toFixed(1)}x) and winning (+$${Math.round(shortsUpnl / 1000)}k uPnL)`
      if (momentumWarning) reason += ` | ${momentumWarning}`

      return {
        mode: 'FOLLOW_SM_SHORT',
        confidence: Math.round(confidence),
        reason,
        maxPositionMultiplier: posMult,
        positionRatio: Math.round(ratio * 100) / 100,
        pnlRatio: Math.round(pnlRatio * 100) / 100,
        ...baseData,
        momentumWarning: momentumWarning ?? undefined,
        divergenceWarning: divergenceWarning ?? undefined,
      }
    } else {
      // SM shorts are underwater → CONTRARIAN (potential squeeze, go LONG)
      let confidence = Math.min(70, 30 + Math.abs(shortsUpnl) / 500000 * 20) // +20 per $500k underwater

      // SQUEEZE TIMEOUT PROTECTION
      const timeoutResult = calculateSqueezeTimeoutPenalty(squeezeDurationHours)

      if (timeoutResult.shouldExit) {
        // Squeeze failed - exit CONTRARIAN mode
        return {
          mode: 'NEUTRAL',
          confidence: 0,
          reason: `SQUEEZE TIMEOUT: ${squeezeDurationHours.toFixed(1)}h in CONTRARIAN_LONG - no squeeze, exiting!`,
          maxPositionMultiplier: 0.0, // No new positions
          positionRatio: Math.round(ratio * 100) / 100,
          pnlRatio: Math.round(pnlRatio * 100) / 100,
          squeezeFailed: true, // Flag for bot to exit existing position
          ...baseData,
          momentumWarning: momentumWarning ?? undefined,
          divergenceWarning: divergenceWarning ?? undefined,
        }
      }

      // Apply timeout penalty to confidence
      confidence = Math.max(10, confidence - timeoutResult.penalty)
      let reason = `SM SHORT underwater (-$${Math.round(Math.abs(shortsUpnl) / 1000)}k uPnL) - squeeze potential!`
      if (timeoutResult.warning) reason += ` | ${timeoutResult.warning}`

      return {
        mode: 'CONTRARIAN_LONG',
        confidence: Math.round(confidence),
        reason,
        maxPositionMultiplier: 0.25, // TINY size for contrarian (fixed!)
        positionRatio: Math.round(ratio * 100) / 100,
        pnlRatio: Math.round(pnlRatio * 100) / 100,
        squeezeDurationHours: Math.round(squeezeDurationHours * 10) / 10,
        ...baseData,
        momentumWarning: momentumWarning ?? undefined,
        divergenceWarning: divergenceWarning ?? undefined,
      }
    }
  }

  // ============================================================
  // CASE 2: SM LONG DOMINANT (ratio < 0.5)
  // ============================================================
  if (ratio < MODE_THRESHOLDS.LONG_DOMINANT_RATIO) {
    if (longsUpnl > MODE_THRESHOLDS.UNDERWATER_THRESHOLD) {
      // SM longs are profitable → FOLLOW THEM (go LONG)
      let confidence = Math.min(95, 50 + (longsUpnl / 100000) * 10)
      // Apply momentum penalty for "Stale PnL" protection
      confidence = Math.max(30, confidence - momentumPenalty)
      const posMult = getPositionMultFromConfidence(confidence)
      let reason = `SM LONG dominant (ratio ${ratio.toFixed(2)}x) and winning (+$${Math.round(longsUpnl / 1000)}k uPnL)`
      if (momentumWarning) reason += ` | ${momentumWarning}`

      return {
        mode: 'FOLLOW_SM_LONG',
        confidence: Math.round(confidence),
        reason,
        maxPositionMultiplier: posMult,
        positionRatio: Math.round(ratio * 100) / 100,
        pnlRatio: Math.round(pnlRatio * 100) / 100,
        ...baseData,
        momentumWarning: momentumWarning ?? undefined,
        divergenceWarning: divergenceWarning ?? undefined,
      }
    } else {
      // SM longs are underwater → CONTRARIAN (go SHORT)
      let confidence = Math.min(70, 30 + Math.abs(longsUpnl) / 500000 * 20)

      // SQUEEZE TIMEOUT PROTECTION
      const timeoutResult = calculateSqueezeTimeoutPenalty(squeezeDurationHours)

      if (timeoutResult.shouldExit) {
        // Squeeze failed - exit CONTRARIAN mode
        return {
          mode: 'NEUTRAL',
          confidence: 0,
          reason: `SQUEEZE TIMEOUT: ${squeezeDurationHours.toFixed(1)}h in CONTRARIAN_SHORT - no squeeze, exiting!`,
          maxPositionMultiplier: 0.0, // No new positions
          positionRatio: Math.round(ratio * 100) / 100,
          pnlRatio: Math.round(pnlRatio * 100) / 100,
          squeezeFailed: true, // Flag for bot to exit existing position
          ...baseData,
          momentumWarning: momentumWarning ?? undefined,
          divergenceWarning: divergenceWarning ?? undefined,
        }
      }

      // Apply timeout penalty to confidence
      confidence = Math.max(10, confidence - timeoutResult.penalty)
      let reason = `SM LONG underwater (-$${Math.round(Math.abs(longsUpnl) / 1000)}k uPnL) - reversal potential`
      if (timeoutResult.warning) reason += ` | ${timeoutResult.warning}`

      return {
        mode: 'CONTRARIAN_SHORT',
        confidence: Math.round(confidence),
        reason,
        maxPositionMultiplier: 0.25, // TINY size for contrarian (fixed!)
        positionRatio: Math.round(ratio * 100) / 100,
        pnlRatio: Math.round(pnlRatio * 100) / 100,
        squeezeDurationHours: Math.round(squeezeDurationHours * 10) / 10,
        ...baseData,
        momentumWarning: momentumWarning ?? undefined,
        divergenceWarning: divergenceWarning ?? undefined,
      }
    }
  }

  // ============================================================
  // CASE 3: NEUTRAL (ratio 0.5 - 2.0) - BUT check PnL dominance!
  // ============================================================

  // Check if shorts are winning BIG (even in neutral position ratio)
  if (shortsUpnl > 0 && longsUpnl > 0) {
    const currentPnlRatio = shortsUpnl / longsUpnl
    if (currentPnlRatio > MODE_THRESHOLDS.PNL_DOMINANT_RATIO) {
      // Shorts winning BIG despite neutral position ratio → FOLLOW_SM_SHORT
      let confidence = Math.min(86, 50 + (currentPnlRatio / 10) * 10) // +10 per 10x PnL ratio
      // Apply momentum penalty for "Stale PnL" protection
      confidence = Math.max(30, confidence - momentumPenalty)
      const posMult = getPositionMultFromConfidence(confidence)
      let reason = `SM SHORT winning BIG (${currentPnlRatio.toFixed(1)}x PnL ratio) despite neutral positions`
      if (momentumWarning) reason += ` | ${momentumWarning}`

      return {
        mode: 'FOLLOW_SM_SHORT',
        confidence: Math.round(confidence),
        reason,
        maxPositionMultiplier: posMult,
        positionRatio: Math.round(ratio * 100) / 100,
        pnlRatio: Math.round(currentPnlRatio * 100) / 100,
        ...baseData,
        momentumWarning: momentumWarning ?? undefined,
        divergenceWarning: divergenceWarning ?? undefined,
      }
    }
  }

  // Check if shorts are winning and longs are underwater
  if (shortsUpnl > 0 && longsUpnl <= 0) {
    // Shorts profitable, longs underwater = clear short signal
    const pnlDiff = shortsUpnl - longsUpnl // longsUpnl is negative, so this adds
    if (pnlDiff > 500000) { // Significant PnL difference ($500k+)
      let confidence = Math.min(86, 50 + (pnlDiff / 1000000) * 15)
      // Apply momentum penalty for "Stale PnL" protection
      confidence = Math.max(30, confidence - momentumPenalty)
      const posMult = getPositionMultFromConfidence(confidence)
      let reason = `SM SHORT profitable (+$${Math.round(shortsUpnl / 1000)}k) while LONG underwater (-$${Math.round(Math.abs(longsUpnl) / 1000)}k)`
      if (momentumWarning) reason += ` | ${momentumWarning}`

      return {
        mode: 'FOLLOW_SM_SHORT',
        confidence: Math.round(confidence),
        reason,
        maxPositionMultiplier: posMult,
        positionRatio: Math.round(ratio * 100) / 100,
        pnlRatio: 999.0, // Infinite (shorts winning, longs negative)
        ...baseData,
        momentumWarning: momentumWarning ?? undefined,
        divergenceWarning: divergenceWarning ?? undefined,
      }
    }
  }

  // Check if longs are winning BIG (even in neutral position ratio)
  if (longsUpnl > 0 && shortsUpnl > 0) {
    const currentPnlRatio = longsUpnl / shortsUpnl
    if (currentPnlRatio > MODE_THRESHOLDS.PNL_DOMINANT_RATIO) {
      // Longs winning BIG despite neutral position ratio → FOLLOW_SM_LONG
      let confidence = Math.min(86, 50 + (currentPnlRatio / 10) * 10)
      // Apply momentum penalty for "Stale PnL" protection
      confidence = Math.max(30, confidence - momentumPenalty)
      const posMult = getPositionMultFromConfidence(confidence)
      let reason = `SM LONG winning BIG (${currentPnlRatio.toFixed(1)}x PnL ratio) despite neutral positions`
      if (momentumWarning) reason += ` | ${momentumWarning}`

      return {
        mode: 'FOLLOW_SM_LONG',
        confidence: Math.round(confidence),
        reason,
        maxPositionMultiplier: posMult,
        positionRatio: Math.round(ratio * 100) / 100,
        pnlRatio: Math.round(currentPnlRatio * 100) / 100,
        ...baseData,
        momentumWarning: momentumWarning ?? undefined,
        divergenceWarning: divergenceWarning ?? undefined,
      }
    }
  }

  // Check if longs are winning and shorts are underwater
  if (longsUpnl > 0 && shortsUpnl <= 0) {
    // Longs profitable, shorts underwater = clear long signal
    const pnlDiff = longsUpnl - shortsUpnl // shortsUpnl is negative, so this adds
    if (pnlDiff > 500000) { // Significant PnL difference ($500k+)
      let confidence = Math.min(86, 50 + (pnlDiff / 1000000) * 15)
      // Apply momentum penalty for "Stale PnL" protection
      confidence = Math.max(30, confidence - momentumPenalty)
      const posMult = getPositionMultFromConfidence(confidence)
      let reason = `SM LONG profitable (+$${Math.round(longsUpnl / 1000)}k) while SHORT underwater (-$${Math.round(Math.abs(shortsUpnl) / 1000)}k)`
      if (momentumWarning) reason += ` | ${momentumWarning}`

      return {
        mode: 'FOLLOW_SM_LONG',
        confidence: Math.round(confidence),
        reason,
        maxPositionMultiplier: posMult,
        positionRatio: Math.round(ratio * 100) / 100,
        pnlRatio: 999.0, // Infinite (longs winning, shorts negative)
        ...baseData,
        momentumWarning: momentumWarning ?? undefined,
        divergenceWarning: divergenceWarning ?? undefined,
      }
    }
  }

  // ============================================================
  // FALLBACK: Still neutral - no clear PnL dominance
  // ============================================================
  return {
    mode: 'NEUTRAL',
    confidence: 30,
    reason: `Mixed SM signals (ratio ${ratio.toFixed(2)}x) - no clear direction`,
    maxPositionMultiplier: 0.25, // Reduced for unclear signals
    positionRatio: Math.round(ratio * 100) / 100,
    pnlRatio: Math.round(pnlRatio * 100) / 100,
    ...baseData,
    momentumWarning: momentumWarning ?? undefined,
    divergenceWarning: divergenceWarning ?? undefined,
  }
}

// ============================================================
// CONVERSION HELPERS - For NansenBiasEntry compatibility
// ============================================================

/**
 * Convert TradingModeResult to partial NansenBiasEntry fields.
 * Use this when generating nansen_bias.json compatible output.
 */
export function toNansenBiasFields(result: TradingModeResult): Partial<NansenBiasEntry> {
  return {
    tradingMode: result.mode,
    tradingModeConfidence: result.confidence,
    tradingModeReason: result.reason,
    maxPositionMultiplier: result.maxPositionMultiplier,
    positionRatio: result.positionRatio,
    pnlRatio: result.pnlRatio,
    longValueUsd: result.longValueUsd,
    shortValueUsd: result.shortValueUsd,
    longPnlUsd: result.longPnlUsd,
    shortPnlUsd: result.shortPnlUsd,
    momentumWarning: result.momentumWarning,
    divergenceWarning: result.divergenceWarning,
    squeezeDurationHours: result.squeezeDurationHours,
    squeezeFailed: result.squeezeFailed,
  }
}

/**
 * Calculate boost value from bias (0-1)
 * Maps bias to boost range 0.05-2.0
 */
export function calculateBoostFromBias(bias: number): number {
  if (bias > 0.65) {
    // Long bias: boost 1.0 to 2.0
    return Math.round((1.0 + (bias - 0.5) * 2) * 100) / 100
  } else if (bias < 0.35) {
    // Short bias: boost 0.05 to 1.0
    return Math.round((1.0 - (0.5 - bias) * 1.9) * 100) / 100
  }
  // Neutral
  return 1.0
}

/**
 * Get direction string from bias
 */
export function getDirectionFromBias(bias: number): 'long' | 'short' | 'neutral' {
  if (bias > 0.6) return 'long'
  if (bias < 0.4) return 'short'
  return 'neutral'
}

/**
 * Get bias strength from bias value
 */
export function getBiasStrength(bias: number): 'strong' | 'moderate' | 'soft' {
  if (bias > 0.75 || bias < 0.25) return 'strong'
  if (bias > 0.6 || bias < 0.4) return 'moderate'
  return 'soft'
}

// ============================================================
// SINGLETON ANALYZER CLASS
// ============================================================

/**
 * SmartMoneyAnalyzer class - Provides analytical methods as instance
 */
export class SmartMoneyAnalyzer {
  determineTradingMode = determineTradingMode
  detectPerpsSpotDivergence = detectPerpsSpotDivergence
  calculateSqueezeTimeoutPenalty = calculateSqueezeTimeoutPenalty
  calculateMomentumPenalty = calculateMomentumPenalty
  getPositionMultFromConfidence = getPositionMultFromConfidence
  calculatePositionRatio = calculatePositionRatio
  calculatePnlRatio = calculatePnlRatio
  toNansenBiasFields = toNansenBiasFields
  calculateBoostFromBias = calculateBoostFromBias
  getDirectionFromBias = getDirectionFromBias
  getBiasStrength = getBiasStrength

  // Expose thresholds for external use
  readonly MODE_THRESHOLDS = MODE_THRESHOLDS
  readonly SQUEEZE_TIMEOUT_THRESHOLDS = SQUEEZE_TIMEOUT_THRESHOLDS
  readonly DIVERGENCE_THRESHOLDS = DIVERGENCE_THRESHOLDS
  readonly MOMENTUM_THRESHOLDS = MOMENTUM_THRESHOLDS
  readonly CONFIDENCE_TO_POSITION_MULT = CONFIDENCE_TO_POSITION_MULT
}

// Export singleton instance
export const smartMoneyAnalyzer = new SmartMoneyAnalyzer()
