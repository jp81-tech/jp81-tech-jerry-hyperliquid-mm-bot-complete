/**
 * Smart Money Auto-Detector for Hyperliquid MM Bot
 *
 * Automatically detects SM direction from whale_tracker.py data
 * and determines optimal trading mode (FOLLOW_SM_LONG, FOLLOW_SM_SHORT, PURE_MM)
 *
 * Created: 2026-01-19
 */

import { promises as fsp } from 'fs'
import { SmartMoneyEntry, SmartMoneyFile } from '../types/smart_money.js'
import { StrategyPriority } from './dynamic_config.js'

// ============================================================
// ENUMS & TYPES
// ============================================================

export enum MmMode {
  FOLLOW_SM_LONG = 'FOLLOW_SM_LONG',
  FOLLOW_SM_SHORT = 'FOLLOW_SM_SHORT',
  PURE_MM = 'PURE_MM',
  FLAT = 'FLAT'
}

export enum TraderTier {
  CONVICTION = 'CONVICTION',     // Top traders, never flip, high signal weight (0.9-1.0)
  FUND = 'FUND',                 // Institutional funds (0.7-0.85)
  ACTIVE = 'ACTIVE',             // Active traders with edge (0.5-0.7)
  MARKET_MAKER = 'MARKET_MAKER', // MMs - IGNORE their positions (0.0)
  UNKNOWN = 'UNKNOWN'            // Unknown traders (0.3)
}

export interface KnownTrader {
  label: string
  tier: TraderTier
  flipRate: number      // How often they flip positions (0 = never, 1 = always)
  signalWeight: number  // How much to weight their signal (0-1)
  notes?: string
}

export interface MultiplierConfig {
  bid: number
  ask: number
  bidLocked: boolean
  askLocked: boolean
  maxInventoryUsd: number
  priority: StrategyPriority
  source: string
  reason: string
}

export interface TokenSmAnalysis {
  token: string
  longExposure: number           // Weighted long exposure in USD
  shortExposure: number          // Weighted short exposure in USD
  ratio: number                  // short/long ratio
  dominantSide: 'LONG' | 'SHORT' | 'NEUTRAL'
  convictionScore: number        // 0-1
  mode: MmMode
  multipliers: MultiplierConfig
  rawLongsUsd: number            // Raw (unweighted) longs
  rawShortsUsd: number           // Raw (unweighted) shorts
  longsCount: number
  shortsCount: number
  longsUpnl: number
  shortsUpnl: number
  trend: string
  trendStrength: string
}

// ============================================================
// KNOWN TRADERS DATABASE
// Copied from whale_tracker.py WHALES dictionary
// ============================================================

const KNOWN_TRADERS: Record<string, KnownTrader> = {
  // TIER 1: CONVICTION - Top traders with massive edge
  '0xb317d2bc2d3d2df5fa441b5bae0ab9d8b07283ae': {
    label: 'Bitcoin OG',
    tier: TraderTier.CONVICTION,
    flipRate: 0.05,
    signalWeight: 1.0,
    notes: '$717M ETH LONG, $92M BTC LONG'
  },
  '0x35d1151ef1aab579cbb3109e69fa82f94ff5acb1': {
    label: 'SM Conviction 35d115',
    tier: TraderTier.CONVICTION,
    flipRate: 0.0,
    signalWeight: 0.95,
    notes: '$64.5M SOL SHORT'
  },
  '0xa312114b5795dff9b8db50474dd57701aa78ad1e': {
    label: 'SM Conviction a31211',
    tier: TraderTier.CONVICTION,
    flipRate: 0.0,
    signalWeight: 0.95,
    notes: 'LIT short specialist'
  },
  '0x45d26f28196d226497130c4bac709d808fed4029': {
    label: 'SM Conviction 45d26f',
    tier: TraderTier.CONVICTION,
    flipRate: 0.1,
    signalWeight: 0.90,
    notes: 'BTC short specialist'
  },
  '0x06cecf0ec7c16ffff8a78c7b9b262c4619ef3ad5': {
    label: 'SM Conviction 06cecf',
    tier: TraderTier.CONVICTION,
    flipRate: 0.05,
    signalWeight: 0.90,
    notes: '$11.8M SOL SHORT'
  },
  '0x6bea818ff7d502c96b9d44f81de4fc7bb5a26c57': {
    label: 'SM Conviction 6bea81',
    tier: TraderTier.CONVICTION,
    flipRate: 0.05,
    signalWeight: 0.88,
    notes: '$8.1M SOL SHORT'
  },
  '0x3f45c0fa21f2e7b5d30f73e27a1b2fffcd6dc5c2': {
    label: 'SM Conviction 3f45c0',
    tier: TraderTier.CONVICTION,
    flipRate: 0.08,
    signalWeight: 0.88,
    notes: 'BTC/ETH SHORT'
  },
  '0x94e77c08be0edfc0bf9dc01b9c822fb0c1deab5d': {
    label: 'SM Conviction 94e77c',
    tier: TraderTier.CONVICTION,
    flipRate: 0.05,
    signalWeight: 0.85,
    notes: 'BTC SHORT specialist'
  },
  '0xfe25a86e5f2d765ee698b4091d7ac6df2aafd15e': {
    label: 'SM Conviction fe25a8',
    tier: TraderTier.CONVICTION,
    flipRate: 0.1,
    signalWeight: 0.85,
    notes: 'BTC SHORT'
  },

  // TIER 2: FUND - Institutional funds
  '0x6ee7df0bc1eea6e027dd9e39dc45ae1ad7b3cbb5': {
    label: 'Fund 6ee7df',
    tier: TraderTier.FUND,
    flipRate: 0.15,
    signalWeight: 0.80,
    notes: 'Large positions'
  },
  '0xe22c9464b5b7bb33d6a0f05fafe7a46ed599ea4f': {
    label: 'Fund e22c94',
    tier: TraderTier.FUND,
    flipRate: 0.12,
    signalWeight: 0.78,
    notes: 'SOL SHORT'
  },
  '0x2cedf49e5fc7f7b3d9f39c9d64e1f54b0a0c3e22': {
    label: 'Fund 2cedf4',
    tier: TraderTier.FUND,
    flipRate: 0.20,
    signalWeight: 0.75,
    notes: 'ETH SHORT'
  },
  '0x8d0da12d7d7e3d4c0a3d3a2c7c9f9d8b7e1e5a00': {
    label: 'Fund 8d0da1',
    tier: TraderTier.FUND,
    flipRate: 0.18,
    signalWeight: 0.72,
    notes: 'Multi-asset'
  },

  // TIER 4: MARKET MAKERS - IGNORE
  '0x091144e651b334341eabdbbbfed644ad0100023e': {
    label: 'Manifold Trading',
    tier: TraderTier.MARKET_MAKER,
    flipRate: 0.8,
    signalWeight: 0.0,
    notes: 'MM - ignore'
  },
  '0x34fb5ec7d4e939161946340ea2a1f29254b893de': {
    label: 'Selini Capital',
    tier: TraderTier.MARKET_MAKER,
    flipRate: 1.0,
    signalWeight: 0.0,
    notes: 'MM - ignore'
  },
  '0x621c5551678189b9a6c94d929924c225ff1d63ab': {
    label: 'Selini Capital 2',
    tier: TraderTier.MARKET_MAKER,
    flipRate: 1.0,
    signalWeight: 0.0,
    notes: 'MM - ignore'
  },
  '0x39475d17bcd20adc540e647dae6781b153fbf3b1': {
    label: 'Selini Capital 3',
    tier: TraderTier.MARKET_MAKER,
    flipRate: 1.0,
    signalWeight: 0.0,
    notes: 'MM - ignore'
  },
  '0x34d3c2c9fe93dd63bee3b26b0a47ab97a9cd3424': {
    label: 'Wintermute',
    tier: TraderTier.MARKET_MAKER,
    flipRate: 1.0,
    signalWeight: 0.0,
    notes: 'MM - ignore'
  },
  '0xd6f85d5f2c08ff67eb0f50ee9a47eaeaef39c13a': {
    label: 'Jump Trading',
    tier: TraderTier.MARKET_MAKER,
    flipRate: 1.0,
    signalWeight: 0.0,
    notes: 'MM - ignore'
  }
}

// ============================================================
// THRESHOLDS
// ============================================================

const THRESHOLDS = {
  // Minimum SM exposure to trust signal
  minSmExposureUsd: 100_000,        // $100k min total exposure

  // Ratio thresholds for dominance
  strongDominanceRatio: 3.0,        // 3:1 = STRONG (e.g., $3M short vs $1M long)
  moderateDominanceRatio: 1.5,      // 1.5:1 = MODERATE

  // Conviction score thresholds
  highConviction: 0.7,              // HIGH conviction → aggressive follow
  moderateConviction: 0.4,          // MODERATE conviction → cautious follow

  // Multiplier limits
  maxMultiplier: 2.5,
  minMultiplier: 0.0,

  // PnL thresholds
  minProfitablePnl: 50_000,         // $50k min profit to boost signal

  // Max inventory for directional trades
  defaultMaxInventoryUsd: 5000  // Increased from 1500 for better capital utilization
}

// ============================================================
// MAIN AUTO-DETECTION FUNCTION
// ============================================================

/**
 * Analyzes SM data for a token and determines optimal trading mode.
 *
 * @param token - Token symbol (e.g., 'SOL', 'BTC')
 * @param smData - Smart money data from whale_tracker.py
 * @returns TokenSmAnalysis with mode and multipliers
 */
export function analyzeTokenSm(
  token: string,
  smData: SmartMoneyEntry
): TokenSmAnalysis {
  const rawLongsUsd = smData.current_longs_usd ?? 0
  const rawShortsUsd = smData.current_shorts_usd ?? 0
  const longsUpnl = smData.longs_upnl ?? 0
  const shortsUpnl = smData.shorts_upnl ?? 0
  const longsCount = smData.longs_count ?? 0
  const shortsCount = smData.shorts_count ?? 0
  const trend = smData.trend ?? 'stable'
  const trendStrength = smData.trend_strength ?? 'weak'
  const bias = smData.bias ?? 0.5

  // Calculate weighted exposure using bias as proxy
  // (Full position-level weighting would require individual position data)
  // For now, use raw values since whale_tracker.py already filters MMs
  const longExposure = rawLongsUsd
  const shortExposure = rawShortsUsd
  const totalExposure = longExposure + shortExposure

  // Calculate ratio and dominance
  let ratio = 1
  let dominantSide: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL'

  if (longExposure > 0 && shortExposure > 0) {
    ratio = shortExposure / longExposure

    if (ratio >= THRESHOLDS.strongDominanceRatio) {
      dominantSide = 'SHORT'
    } else if (ratio <= 1 / THRESHOLDS.strongDominanceRatio) {
      dominantSide = 'LONG'
    } else if (ratio >= THRESHOLDS.moderateDominanceRatio) {
      dominantSide = 'SHORT'
    } else if (ratio <= 1 / THRESHOLDS.moderateDominanceRatio) {
      dominantSide = 'LONG'
    }
  } else if (shortExposure > 0) {
    dominantSide = 'SHORT'
    ratio = Infinity
  } else if (longExposure > 0) {
    dominantSide = 'LONG'
    ratio = 0
  }

  // ============================================================
  // CONVICTION SCORE
  // Prefer trading_mode_confidence from whale_tracker.py (has "Stale PnL" protection!)
  // Fall back to calculated score only if not available
  // ============================================================
  let convictionScore = 0

  // Check if whale_tracker.py provided confidence (includes momentum penalty)
  const whaleTrackerConfidence = smData.trading_mode_confidence
  const whaleTrackerMode = smData.trading_mode

  if (whaleTrackerConfidence !== undefined && whaleTrackerMode) {
    // USE WHALE TRACKER CONFIDENCE DIRECTLY (already has momentum protection!)
    convictionScore = whaleTrackerConfidence / 100  // Convert 0-100 to 0-1

    // Also override dominantSide based on whale_tracker mode
    if (whaleTrackerMode.includes('SHORT')) {
      dominantSide = 'SHORT'
    } else if (whaleTrackerMode.includes('LONG')) {
      dominantSide = 'LONG'
    } else {
      dominantSide = 'NEUTRAL'
    }

    console.log(`🎯 [${token}] Using whale_tracker confidence: ${whaleTrackerConfidence}% (${whaleTrackerMode})`)
  } else if (totalExposure >= THRESHOLDS.minSmExposureUsd) {
    // FALLBACK: Calculate own conviction score (no momentum protection)
    console.log(`⚠️ [${token}] No whale_tracker confidence, using calculated score`)

    // Base score from ratio (how lopsided is the positioning)
    const ratioScore = Math.min(Math.abs(Math.log(ratio + 0.01)) / 3, 1)

    // Bonus from profitable PnL (shorts winning or longs winning)
    const profitableUpnl = dominantSide === 'SHORT' ? shortsUpnl : longsUpnl
    const pnlBonus = profitableUpnl > THRESHOLDS.minProfitablePnl ? 0.2 : 0

    // Bonus from trend alignment
    const trendBonus =
      (dominantSide === 'SHORT' && trend === 'increasing_shorts') ? 0.15 :
      (dominantSide === 'LONG' && trend === 'increasing_longs') ? 0.15 : 0

    // Bonus from strong trend
    const strengthBonus = trendStrength === 'strong' ? 0.1 : 0

    convictionScore = Math.min(
      (ratioScore * 0.55) + pnlBonus + trendBonus + strengthBonus,
      1.0
    )
  }

  // Determine mode and multipliers
  const { mode, multipliers } = determineMode(
    token,
    dominantSide,
    convictionScore,
    totalExposure,
    longsUpnl,
    shortsUpnl,
    trend,
    trendStrength
  )

  console.log(`🤖 [SmAutoDetector] ${token}:`, {
    rawLongs: `$${(rawLongsUsd / 1e6).toFixed(2)}M`,
    rawShorts: `$${(rawShortsUsd / 1e6).toFixed(2)}M`,
    ratio: ratio === Infinity ? '∞' : ratio.toFixed(2),
    dominantSide,
    conviction: convictionScore.toFixed(2),
    trend: `${trend} (${trendStrength})`,
    mode,
    bidMult: multipliers.bid.toFixed(2),
    askMult: multipliers.ask.toFixed(2)
  })

  return {
    token,
    longExposure,
    shortExposure,
    ratio,
    dominantSide,
    convictionScore,
    mode,
    multipliers,
    rawLongsUsd,
    rawShortsUsd,
    longsCount,
    shortsCount,
    longsUpnl,
    shortsUpnl,
    trend,
    trendStrength
  }
}

// ============================================================
// DETERMINE MODE HELPER
// ============================================================

function determineMode(
  token: string,
  dominantSide: 'LONG' | 'SHORT' | 'NEUTRAL',
  convictionScore: number,
  totalExposure: number,
  longsUpnl: number,
  shortsUpnl: number,
  trend: string,
  trendStrength: string
): { mode: MmMode; multipliers: MultiplierConfig } {

  // Low SM exposure → Pure MM
  if (totalExposure < THRESHOLDS.minSmExposureUsd) {
    console.log(`⚪ [${token}] Low SM exposure ($${(totalExposure/1000).toFixed(0)}k) → PURE_MM`)
    return {
      mode: MmMode.PURE_MM,
      multipliers: {
        bid: 1.0,
        ask: 1.0,
        bidLocked: false,
        askLocked: false,
        maxInventoryUsd: THRESHOLDS.defaultMaxInventoryUsd,
        priority: StrategyPriority.DEFAULT,
        source: 'AUTO_PURE_MM_LOW_SM',
        reason: `Low SM exposure ($${(totalExposure/1000).toFixed(0)}k < $100k threshold)`
      }
    }
  }

  // Neutral → Pure MM
  if (dominantSide === 'NEUTRAL') {
    console.log(`⚪ [${token}] Neutral SM → PURE_MM`)
    return {
      mode: MmMode.PURE_MM,
      multipliers: {
        bid: 1.0,
        ask: 1.0,
        bidLocked: false,
        askLocked: false,
        maxInventoryUsd: THRESHOLDS.defaultMaxInventoryUsd,
        priority: StrategyPriority.DEFAULT,
        source: 'AUTO_PURE_MM_NEUTRAL',
        reason: 'SM positioning is neutral - no clear direction'
      }
    }
  }

  // HIGH CONVICTION SHORT
  if (dominantSide === 'SHORT' && convictionScore >= THRESHOLDS.highConviction) {
    const askMult = Math.min(2.0 + (convictionScore * 0.5), THRESHOLDS.maxMultiplier)
    console.log(`🔴 [${token}] HIGH conviction SHORT (${convictionScore.toFixed(2)}) → FOLLOW_SM_SHORT`)
    return {
      mode: MmMode.FOLLOW_SM_SHORT,
      multipliers: {
        bid: 0.0,                    // BLOCK BUYS
        ask: askMult,
        bidLocked: true,             // Emergency lock - cannot increase bids
        askLocked: false,
        maxInventoryUsd: THRESHOLDS.defaultMaxInventoryUsd,
        priority: StrategyPriority.EMERGENCY,
        source: 'AUTO_FOLLOW_SM_SHORT_HIGH',
        reason: `HIGH conviction SHORT (${(convictionScore*100).toFixed(0)}%) - shorts uPnL: $${(shortsUpnl/1000).toFixed(0)}k`
      }
    }
  }

  // MODERATE CONVICTION SHORT
  if (dominantSide === 'SHORT' && convictionScore >= THRESHOLDS.moderateConviction) {
    const askMult = 1.5 + (convictionScore * 0.5)
    console.log(`🟠 [${token}] MODERATE conviction SHORT (${convictionScore.toFixed(2)}) → FOLLOW_SM_SHORT`)
    return {
      mode: MmMode.FOLLOW_SM_SHORT,
      multipliers: {
        bid: 0.3,                    // Limited buying
        ask: askMult,
        bidLocked: false,
        askLocked: false,
        maxInventoryUsd: THRESHOLDS.defaultMaxInventoryUsd,
        priority: StrategyPriority.FOLLOW_SM,
        source: 'AUTO_FOLLOW_SM_SHORT_MODERATE',
        reason: `MODERATE conviction SHORT (${(convictionScore*100).toFixed(0)}%)`
      }
    }
  }

  // LOW CONVICTION SHORT (still lean short but more balanced)
  if (dominantSide === 'SHORT') {
    console.log(`🟡 [${token}] LOW conviction SHORT (${convictionScore.toFixed(2)}) → FOLLOW_SM_SHORT (soft)`)
    return {
      mode: MmMode.FOLLOW_SM_SHORT,
      multipliers: {
        bid: 0.6,                    // Reduced but not blocked
        ask: 1.3,
        bidLocked: false,
        askLocked: false,
        maxInventoryUsd: THRESHOLDS.defaultMaxInventoryUsd,
        priority: StrategyPriority.SM_SIGNAL,
        source: 'AUTO_FOLLOW_SM_SHORT_LOW',
        reason: `LOW conviction SHORT (${(convictionScore*100).toFixed(0)}%)`
      }
    }
  }

  // HIGH CONVICTION LONG
  if (dominantSide === 'LONG' && convictionScore >= THRESHOLDS.highConviction) {
    const bidMult = Math.min(2.0 + (convictionScore * 0.5), THRESHOLDS.maxMultiplier)
    console.log(`🟢 [${token}] HIGH conviction LONG (${convictionScore.toFixed(2)}) → FOLLOW_SM_LONG`)
    return {
      mode: MmMode.FOLLOW_SM_LONG,
      multipliers: {
        bid: bidMult,
        ask: 0.0,                    // BLOCK SELLS
        bidLocked: false,
        askLocked: true,             // Emergency lock - cannot increase asks
        maxInventoryUsd: THRESHOLDS.defaultMaxInventoryUsd,
        priority: StrategyPriority.EMERGENCY,
        source: 'AUTO_FOLLOW_SM_LONG_HIGH',
        reason: `HIGH conviction LONG (${(convictionScore*100).toFixed(0)}%) - longs uPnL: $${(longsUpnl/1000).toFixed(0)}k`
      }
    }
  }

  // MODERATE CONVICTION LONG
  if (dominantSide === 'LONG' && convictionScore >= THRESHOLDS.moderateConviction) {
    const bidMult = 1.5 + (convictionScore * 0.5)
    console.log(`🟢 [${token}] MODERATE conviction LONG (${convictionScore.toFixed(2)}) → FOLLOW_SM_LONG`)
    return {
      mode: MmMode.FOLLOW_SM_LONG,
      multipliers: {
        bid: bidMult,
        ask: 0.3,                    // Limited selling
        bidLocked: false,
        askLocked: false,
        maxInventoryUsd: THRESHOLDS.defaultMaxInventoryUsd,
        priority: StrategyPriority.FOLLOW_SM,
        source: 'AUTO_FOLLOW_SM_LONG_MODERATE',
        reason: `MODERATE conviction LONG (${(convictionScore*100).toFixed(0)}%)`
      }
    }
  }

  // LOW CONVICTION LONG
  console.log(`🟡 [${token}] LOW conviction LONG (${convictionScore.toFixed(2)}) → FOLLOW_SM_LONG (soft)`)
  return {
    mode: MmMode.FOLLOW_SM_LONG,
    multipliers: {
      bid: 1.3,
      ask: 0.6,                    // Reduced but not blocked
      bidLocked: false,
      askLocked: false,
      maxInventoryUsd: THRESHOLDS.defaultMaxInventoryUsd,
      priority: StrategyPriority.SM_SIGNAL,
      source: 'AUTO_FOLLOW_SM_LONG_LOW',
      reason: `LOW conviction LONG (${(convictionScore*100).toFixed(0)}%)`
    }
  }
}

// ============================================================
// LOAD AND ANALYZE ALL TOKENS
// ============================================================

let cachedAnalysis: Map<string, TokenSmAnalysis> = new Map()
let lastLoadTime = 0
const CACHE_TTL_MS = 30_000  // 30 seconds cache

/**
 * Loads SM data and analyzes all tokens.
 * Results are cached for 30 seconds.
 */
export async function loadAndAnalyzeAllTokens(): Promise<Map<string, TokenSmAnalysis>> {
  const now = Date.now()

  // Return cached if fresh
  if (now - lastLoadTime < CACHE_TTL_MS && cachedAnalysis.size > 0) {
    return cachedAnalysis
  }

  try {
    const smDataPath = '/tmp/smart_money_data.json'
    const content = await fsp.readFile(smDataPath, 'utf-8')
    const smFile: SmartMoneyFile = JSON.parse(content)

    const newAnalysis = new Map<string, TokenSmAnalysis>()

    for (const [token, smData] of Object.entries(smFile.data)) {
      const analysis = analyzeTokenSm(token, smData)
      newAnalysis.set(token, analysis)
    }

    cachedAnalysis = newAnalysis
    lastLoadTime = now

    console.log(`✅ [SmAutoDetector] Analyzed ${newAnalysis.size} tokens from ${smFile.timestamp}`)

    return newAnalysis

  } catch (err) {
    console.error(`❌ [SmAutoDetector] Failed to load SM data:`, err)
    return cachedAnalysis  // Return stale cache on error
  }
}

/**
 * Gets auto-detected mode for a specific token.
 * Returns undefined if token not found.
 */
export async function getAutoDetectedMode(token: string): Promise<TokenSmAnalysis | undefined> {
  const allAnalysis = await loadAndAnalyzeAllTokens()
  return allAnalysis.get(token)
}

/**
 * Gets emergency override from auto-detection.
 * This replaces the hardcoded EMERGENCY_OVERRIDES.
 */
export async function getAutoEmergencyOverride(token: string): Promise<{
  bidEnabled: boolean
  askEnabled: boolean
  bidMultiplier: number
  askMultiplier: number
  maxInventoryUsd: number
  reason: string
  mode: MmMode
  convictionScore: number
} | undefined> {
  const analysis = await getAutoDetectedMode(token)

  if (!analysis) {
    return undefined
  }

  // Only return override for FOLLOW_SM modes
  if (analysis.mode === MmMode.PURE_MM || analysis.mode === MmMode.FLAT) {
    return undefined
  }

  return {
    bidEnabled: analysis.multipliers.bid > 0,
    askEnabled: analysis.multipliers.ask > 0,
    bidMultiplier: analysis.multipliers.bid,
    askMultiplier: analysis.multipliers.ask,
    maxInventoryUsd: analysis.multipliers.maxInventoryUsd,
    reason: analysis.multipliers.reason,
    mode: analysis.mode,
    convictionScore: analysis.convictionScore
  }
}

/**
 * SYNCHRONOUS version - uses cached data only.
 * Call loadAndAnalyzeAllTokens() first to populate cache!
 * Used by deriveTuning() which is not async.
 */
export function getAutoEmergencyOverrideSync(token: string): {
  bidEnabled: boolean
  askEnabled: boolean
  bidMultiplier: number
  askMultiplier: number
  maxInventoryUsd: number
  reason: string
  mode: MmMode
  convictionScore: number
} | undefined {
  const analysis = cachedAnalysis.get(token)

  if (!analysis) {
    return undefined
  }

  // Only return override for FOLLOW_SM modes
  if (analysis.mode === MmMode.PURE_MM || analysis.mode === MmMode.FLAT) {
    return undefined
  }

  return {
    bidEnabled: analysis.multipliers.bid > 0,
    askEnabled: analysis.multipliers.ask > 0,
    bidMultiplier: analysis.multipliers.bid,
    askMultiplier: analysis.multipliers.ask,
    maxInventoryUsd: analysis.multipliers.maxInventoryUsd,
    reason: analysis.multipliers.reason,
    mode: analysis.mode,
    convictionScore: analysis.convictionScore
  }
}

/**
 * Refreshes the cache synchronously using provided SM data.
 * Call this from applyTuningForToken to update cache before deriveTuning runs.
 */
export function updateCacheFromSmData(smData: Record<string, SmartMoneyEntry>): void {
  const newAnalysis = new Map<string, TokenSmAnalysis>()

  for (const [token, entry] of Object.entries(smData)) {
    const analysis = analyzeTokenSm(token, entry)
    newAnalysis.set(token, analysis)
  }

  cachedAnalysis = newAnalysis
  lastLoadTime = Date.now()
}

// Export known traders for reference
export { KNOWN_TRADERS, THRESHOLDS }
