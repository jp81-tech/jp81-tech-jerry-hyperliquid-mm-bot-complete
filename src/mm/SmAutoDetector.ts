/**
 * Smart Money Auto-Detector for Hyperliquid MM Bot
 *
 * Automatically detects SM direction from whale_tracker.py data
 * and determines optimal trading mode (FOLLOW_SM_LONG, FOLLOW_SM_SHORT, PURE_MM)
 *
 * Created: 2026-01-19
 * Updated: 2026-01-21 - Added PERP_TO_ONCHAIN_PROXY for VIRTUAL (Base chain)
 */

import { promises as fsp } from 'fs'
import { SmartMoneyEntry, SmartMoneyFile } from '../types/smart_money.js'
import { StrategyPriority } from './dynamic_config.js'
import { getNansenProAPI } from '../integrations/nansen_pro.js'

// Signal Engine Integration (v3 - Data Fusion Core with MASTER CONTROL)
import { SignalEngine, TOKEN_CONFIGS } from '../core/strategy/SignalEngine.js'

// Dynamic Leverage + Vision SL
import { TokenRiskCalculator } from './TokenRiskCalculator.js'

// Centralized SHORT-ONLY config
import { RATIO_ALERTS, RATIO_ALERT_COOLDOWN_MS } from '../config/short_only_config.js'

// Re-export for backward compatibility
export { TOKEN_CONFIGS }

// ============================================================
// PERP TO ON-CHAIN PROXY MAPPING
// For HL perps without on-chain data, use spot token on other chains
// ============================================================

export interface OnChainProxy {
  chain: string
  tokenAddress: string
  description: string
}

/**
 * Maps Hyperliquid perp symbols to their on-chain token equivalents.
 * Used to fetch SM data from Nansen for perps that don't have HL-native data.
 */
export const PERP_TO_ONCHAIN_PROXY: Record<string, OnChainProxy> = {
  'VIRTUAL': {
    chain: 'base',
    tokenAddress: '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b',
    description: 'Virtual Protocol on Base'
  },
  'ZEC': {
    chain: 'solana',
    tokenAddress: 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS',
    description: 'Zcash on Solana'
  },
  'LIT': {
    chain: 'ethereum',
    tokenAddress: '0xb59490ab09a0f526cc7305822ac65f2ab12f9723',
    description: 'Litentry on Ethereum'
  },
  'SOL': {
    chain: 'solana',
    tokenAddress: 'So11111111111111111111111111111111111111112',
    description: 'Solana native (Wrapped SOL)'
  },
  'WIF': {
    chain: 'solana',
    tokenAddress: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    description: 'dogwifhat on Solana'
  },
  'kPEPE': {
    chain: 'ethereum',
    tokenAddress: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
    description: 'Pepe on Ethereum (1000x = kPEPE on HL)'
  },
  'DOGE': {
    chain: 'bnb',
    tokenAddress: '0xba2ae424d960c26247dd6c32edc70b295c744c43',
    description: 'Dogecoin on BNB Chain'
  },
  'XRP': {
    chain: 'bnb',
    tokenAddress: '0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe',
    description: 'XRP Token on BNB Chain'
  }
}

// ============================================================
// TOKEN-SPECIFIC VOLATILITY THRESHOLDS
// VIRTUAL/memecoins can move 10%+ in 15 minutes - need wider SL
// ============================================================

export interface TokenVolatilityConfig {
  minStopLossPercent: number     // Minimum stop loss (wider for volatile tokens)
  maxLeverage: number            // Max leverage based on volatility
  atrMultiplier: number          // Multiplier for ATR-based SL
  description: string
}

export const TOKEN_VOLATILITY_CONFIG: Record<string, TokenVolatilityConfig> = {
  // High volatility memecoins/AI tokens - need 5%+ SL
  'VIRTUAL': {
    minStopLossPercent: 5.0,
    maxLeverage: 3,
    atrMultiplier: 2.5,
    description: 'AI/meme token - extreme volatility, 10%+ swings in 15min'
  },
  'FARTCOIN': {
    minStopLossPercent: 5.0,
    maxLeverage: 3,
    atrMultiplier: 2.5,
    description: 'Memecoin - high volatility'
  },
  // kPEPE - PURE_MM high volume memecoin
  'kPEPE': {
    minStopLossPercent: 4.0,
    maxLeverage: 5,
    atrMultiplier: 2.0,
    description: 'kPEPE - high volume memecoin, deep book, good for MM'
  },
  'WIF': {
    minStopLossPercent: 4.0,
    maxLeverage: 3,
    atrMultiplier: 2.0,
    description: 'Memecoin - high volatility'
  },
  'PEPE': {
    minStopLossPercent: 4.0,
    maxLeverage: 3,
    atrMultiplier: 2.0,
    description: 'Memecoin - high volatility'
  },
  // Medium volatility altcoins
  'LIT': {
    minStopLossPercent: 4.0,
    maxLeverage: 5,
    atrMultiplier: 1.8,
    description: 'Altcoin - medium-high volatility'
  },
  'HYPE': {
    minStopLossPercent: 4.0,
    maxLeverage: 5,
    atrMultiplier: 1.8,
    description: 'Hyperliquid token - medium volatility'
  },
  // DeFi / L1 tokens - medium volatility
  'ENA': {
    minStopLossPercent: 3.5,
    maxLeverage: 5,
    atrMultiplier: 1.8,
    description: 'DeFi token (Ethena) - medium volatility'
  },
  'SUI': {
    minStopLossPercent: 3.5,
    maxLeverage: 5,
    atrMultiplier: 1.8,
    description: 'L1 blockchain - medium volatility'
  },
  'PUMP': {
    minStopLossPercent: 5.0,
    maxLeverage: 3,
    atrMultiplier: 2.5,
    description: 'Memecoin - high volatility (STICKY position)'
  },
  // Meme coin - high volatility, PURE_MM
  'POPCAT': {
    minStopLossPercent: 1.5,
    maxLeverage: 3,
    atrMultiplier: 2.5,
    description: 'Solana memecoin - high volatility, PURE_MM ultra-aggressive'
  },
  // Default for other tokens
  'DEFAULT': {
    minStopLossPercent: 3.0,
    maxLeverage: 10,
    atrMultiplier: 1.5,
    description: 'Standard volatility'
  }
}

/**
 * Gets volatility config for a token, falling back to DEFAULT
 */
export function getTokenVolatilityConfig(token: string): TokenVolatilityConfig {
  return TOKEN_VOLATILITY_CONFIG[token] || TOKEN_VOLATILITY_CONFIG['DEFAULT']
}

/**
 * Validates and adjusts stop loss for token volatility
 * @param token Token symbol
 * @param proposedSlPercent Proposed stop loss percentage
 * @returns Adjusted stop loss (at least minStopLossPercent)
 */
export function adjustStopLossForVolatility(token: string, proposedSlPercent: number): number {
  const config = getTokenVolatilityConfig(token)
  if (proposedSlPercent < config.minStopLossPercent) {
    console.log(`⚠️ [VOLATILITY] ${token}: SL ${proposedSlPercent}% too tight, adjusting to ${config.minStopLossPercent}%`)
    return config.minStopLossPercent
  }
  return proposedSlPercent
}

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
  // 🧠 SIGNAL ENGINE MASTER CONTROL
  signalEngineAllowLongs: boolean   // SignalEngine says LONGS are OK
  signalEngineAllowShorts: boolean  // SignalEngine says SHORTS are OK
  signalEngineOverride: boolean     // SignalEngine wants to override REGIME
  engineScore: number               // Raw Engine score (-50 to +50)
  // 🎯 DYNAMIC RISK (TokenRiskCalculator)
  recommendedLeverage: number       // Dynamic leverage (1-5x)
  visionSlPct: number               // ATR-based SL as fraction of entry (e.g., 0.125 = 12.5%)
  volatility: number                // Estimated daily volatility (e.g., 0.045 = 4.5%)
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
    label: 'Major',
    tier: TraderTier.CONVICTION,
    flipRate: 0.0,
    signalWeight: 0.95,
    notes: '$64.5M SOL SHORT'
  },
  '0xa312114b5795dff9b8db50474dd57701aa78ad1e': {
    label: 'Generał',
    tier: TraderTier.CONVICTION,
    flipRate: 0.0,
    signalWeight: 0.95,
    notes: 'LIT short specialist'
  },
  '0x45d26f28196d226497130c4bac709d808fed4029': {
    label: 'Wice-Generał',
    tier: TraderTier.CONVICTION,
    flipRate: 0.1,
    signalWeight: 0.90,
    notes: 'BTC short specialist'
  },
  '0x06cecf0ec7c16ffff8a78c7b9b262c4619ef3ad5': {
    label: 'Kraken A',
    tier: TraderTier.CONVICTION,
    flipRate: 0.05,
    signalWeight: 0.90,
    notes: '$11.8M SOL SHORT'
  },
  '0x6bea818ff7d502c96b9d44f81de4fc7bb5a26c57': {
    label: 'Porucznik SOL2',
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
  defaultMaxInventoryUsd: 5000,  // Increased from 1500 for better capital utilization

  // Net Scoring thresholds for signal conflict resolution
  netScoreThreshold: 2,          // Min net score to take directional trade
  netScoreStrongThreshold: 4     // Strong conviction threshold
}

// ============================================================
// NET SCORING SYSTEM FOR SIGNAL CONFLICTS
// Resolves conflicting signals (e.g., CEX deposit SHORT vs ST buy LONG)
// ============================================================

export interface SignalSource {
  name: string
  direction: 'LONG' | 'SHORT' | 'NEUTRAL'
  weight: number  // 1-3 based on signal strength
  confidence: number  // 0-1
  timestamp?: number
}

export interface NetScoreResult {
  netScore: number           // Positive = LONG, Negative = SHORT
  direction: 'LONG' | 'SHORT' | 'NEUTRAL'
  conviction: 'HIGH' | 'MODERATE' | 'LOW' | 'CONFLICT'
  signals: SignalSource[]
  reason: string
}

/**
 * Calculates net score from multiple signal sources.
 * Used to resolve conflicts like "CEX deposit (SHORT) vs All-Time ST Buy (LONG)"
 *
 * @param signals Array of signal sources
 * @returns Net score result with direction and conviction
 */
export function calculateNetScore(signals: SignalSource[]): NetScoreResult {
  let longScore = 0
  let shortScore = 0
  const activeSignals: SignalSource[] = []

  for (const signal of signals) {
    if (signal.direction === 'NEUTRAL') continue

    const weightedScore = signal.weight * signal.confidence
    activeSignals.push(signal)

    if (signal.direction === 'LONG') {
      longScore += weightedScore
    } else {
      shortScore += weightedScore
    }
  }

  const netScore = longScore - shortScore
  const absScore = Math.abs(netScore)

  // Determine direction and conviction
  let direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL'
  let conviction: 'HIGH' | 'MODERATE' | 'LOW' | 'CONFLICT' = 'CONFLICT'

  if (absScore >= THRESHOLDS.netScoreStrongThreshold) {
    direction = netScore > 0 ? 'LONG' : 'SHORT'
    conviction = 'HIGH'
  } else if (absScore >= THRESHOLDS.netScoreThreshold) {
    direction = netScore > 0 ? 'LONG' : 'SHORT'
    conviction = 'MODERATE'
  } else if (absScore > 0.5) {
    direction = netScore > 0 ? 'LONG' : 'SHORT'
    conviction = 'LOW'
  }

  // Build reason string
  const longSignals = activeSignals.filter(s => s.direction === 'LONG').map(s => s.name)
  const shortSignals = activeSignals.filter(s => s.direction === 'SHORT').map(s => s.name)
  const reason = `Net=${netScore.toFixed(1)} | LONG[${longSignals.join(',')}]=${longScore.toFixed(1)} vs SHORT[${shortSignals.join(',')}]=${shortScore.toFixed(1)}`

  return {
    netScore,
    direction,
    conviction,
    signals: activeSignals,
    reason
  }
}

/**
 * Converts SmartMoneyEntry flow data to SignalSource for net scoring
 */
export function smEntryToSignals(token: string, entry: SmartMoneyEntry): SignalSource[] {
  const signals: SignalSource[] = []

  // SM Position signal
  const longs = entry.current_longs_usd || 0
  const shorts = entry.current_shorts_usd || 0
  if (longs > 0 || shorts > 0) {
    const ratio = shorts > 0 ? longs / shorts : (longs > 0 ? Infinity : 1)
    const direction = ratio > 1.5 ? 'LONG' : ratio < 0.67 ? 'SHORT' : 'NEUTRAL'
    signals.push({
      name: 'SM_POSITION',
      direction,
      weight: 2,
      confidence: Math.min(Math.abs(Math.log(ratio + 0.01)) / 3, 1)
    })
  }

  // SM PnL signal (profitable side has stronger signal)
  const longsUpnl = entry.longs_upnl || 0
  const shortsUpnl = entry.shorts_upnl || 0
  if (Math.abs(longsUpnl) > 50000 || Math.abs(shortsUpnl) > 50000) {
    const direction = longsUpnl > shortsUpnl ? 'LONG' : 'SHORT'
    signals.push({
      name: 'SM_PNL',
      direction,
      weight: 1,
      confidence: Math.min(Math.abs(longsUpnl - shortsUpnl) / 500000, 1)
    })
  }

  // Trend signal
  if (entry.trend && entry.trend !== 'stable') {
    const direction = entry.trend.includes('long') ? 'LONG' :
                      entry.trend.includes('short') ? 'SHORT' : 'NEUTRAL'
    const strength = entry.trend_strength === 'strong' ? 0.9 :
                     entry.trend_strength === 'moderate' ? 0.6 : 0.3
    signals.push({
      name: 'SM_TREND',
      direction,
      weight: 1,
      confidence: strength
    })
  }

  return signals
}

// ============================================================
// VOLATILITY ESTIMATION
// Maps existing TOKEN_VOLATILITY_CONFIG to daily vol estimate
// ============================================================

/**
 * Estimates daily volatility for a token using existing volatility config.
 * Formula: minStopLossPercent × atrMultiplier (both are token-specific).
 *
 * Examples:
 *   VIRTUAL: (5/100) × 2.5 = 0.125 (12.5% daily vol)
 *   LIT:     (4/100) × 1.8 = 0.072 (7.2% daily vol)
 *   ENA:     (3.5/100) × 1.8 = 0.063 (6.3% daily vol)
 *   DEFAULT: (3/100) × 1.5 = 0.045 (4.5% daily vol)
 */
function estimateDailyVolatility(token: string): number {
  const config = getTokenVolatilityConfig(token)
  return (config.minStopLossPercent / 100) * config.atrMultiplier
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
  let engineScore = 0  // Raw Engine score (-50 to +50)

  // 🧠 SIGNAL ENGINE MASTER FLAGS (defaults: allow both sides for PURE_MM)
  let signalEngineAllowLongs = true;
  let signalEngineAllowShorts = true;
  let signalEngineOverride = false;

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

    // Capital Dominance v3: Attenuate on-chain flows when perps dominate
    let flowAttenuation = 1.0
    const onchainSmNet = smData.onchain_sm_net ?? 0
    const onchainWhaleNet = smData.onchain_whale_net ?? 0
    const onchainAbsVol = Math.abs(onchainSmNet) + Math.abs(onchainWhaleNet)

    if (totalExposure > 0 && onchainAbsVol > 0) {
      const volumeRatio = totalExposure / onchainAbsVol
      if (volumeRatio > 10) {
        flowAttenuation = 0.1  // Perps 10x+ bigger → on-chain noise
        console.log(`📉 [${token}] Capital Dominance: perps $${(totalExposure/1e6).toFixed(1)}M >> onchain $${(onchainAbsVol/1e6).toFixed(1)}M → attenuation=0.1`)
      } else if (volumeRatio > 3) {
        flowAttenuation = 0.3  // Perps 3-10x → reduce on-chain weight
        console.log(`📉 [${token}] Capital Dominance: perps $${(totalExposure/1e6).toFixed(1)}M > onchain $${(onchainAbsVol/1e6).toFixed(1)}M → attenuation=0.3`)
      }
    }

    // 🧠 SIGNAL ENGINE v3 - Data Fusion Analysis (MASTER CONTROL)
    const engineSignal = SignalEngine.analyze(
      token,
      {
        flow_1h: (smData.flow_1h ?? smData.netflow_1h ?? 0) * flowAttenuation,
        flow_24h: (smData.netflow_24h ?? smData.flow_24h ?? 0) * flowAttenuation,
        flow_7d: (smData.netflow_7d ?? smData.flow_7d ?? 0) * flowAttenuation,
        cex_flow: (smData.cex_netflow_7d ?? 0) * flowAttenuation
      },
      {
        ratio: ratio,
        whaleConviction: whaleTrackerConfidence ? whaleTrackerConfidence / 100 : 0,
        whaleDirection: dominantSide
      }
    );
    engineScore = engineSignal.score;

    // 🎮 MASTER OVERRIDE - SignalEngine controls trading mode AND permissions
    let engineOverrideMode = whaleTrackerMode;
    let engineOverrideConfidence = whaleTrackerConfidence;

    // Capture SignalEngine's MASTER permissions (for REGIME bypass)
    signalEngineAllowLongs = engineSignal.allowLongs;
    signalEngineAllowShorts = engineSignal.allowShorts;
    signalEngineOverride = engineSignal.overrideRegime;

    if (engineSignal.action === 'WAIT') {
      // Engine not confident — but whale_tracker may have PnL-based analysis that Engine doesn't see
      if (whaleTrackerConfidence >= 50 && whaleTrackerMode && !whaleTrackerMode.includes('NEUTRAL')) {
        // whale_tracker has high conviction from PnL analysis (shorts winning, longs underwater etc.)
        // SignalEngine only sees ratio which may look "not extreme enough" — trust whale_tracker
        engineOverrideMode = whaleTrackerMode;
        engineOverrideConfidence = whaleTrackerConfidence;
        // Keep dominantSide from whale_tracker (already set at line 649-655)
        console.log(`🧠 [${token}] Engine WAIT but whale_tracker confident (${whaleTrackerConfidence}%) → KEEP ${whaleTrackerMode} (allowLongs=${signalEngineAllowLongs}, allowShorts=${signalEngineAllowShorts})`);
      } else {
        // Low whale_tracker confidence or NEUTRAL — fall back to PURE_MM
        engineOverrideMode = 'PURE_MM';
        engineOverrideConfidence = Math.abs(engineSignal.score);
        dominantSide = 'NEUTRAL';  // 🔑 KEY: Force NEUTRAL to trigger PURE_MM path
        console.log(`🧠 [${token}] Engine OVERRIDE: ${engineSignal.score.toFixed(0)} -> PURE_MM (allowLongs=${signalEngineAllowLongs}, allowShorts=${signalEngineAllowShorts})`);
      }
    } else if (engineSignal.action === 'SHORT') {
      engineOverrideMode = 'FOLLOW_SM_SHORT';
      engineOverrideConfidence = Math.abs(engineSignal.score);
      dominantSide = 'SHORT';
      console.log(`🧠 [${token}] Engine CONFIRMS: ${engineSignal.score.toFixed(0)} -> FOLLOW_SM_SHORT`);
    } else if (engineSignal.action === 'LONG') {
      engineOverrideMode = 'FOLLOW_SM_LONG';
      engineOverrideConfidence = Math.abs(engineSignal.score);
      dominantSide = 'LONG';
      console.log(`🧠 [${token}] Engine CONFIRMS: ${engineSignal.score.toFixed(0)} -> FOLLOW_SM_LONG`);
    }

    // Apply override to conviction score
    convictionScore = engineOverrideConfidence / 100;

    // Log the decision with permissions
    console.log(`🧠 [${token}] Engine: ${engineSignal.score.toFixed(0)} (${engineSignal.action}) | ${engineSignal.reason.join(", ")} | Mode: ${engineOverrideMode} | Longs:${signalEngineAllowLongs} Shorts:${signalEngineAllowShorts}`);

  } else if (totalExposure >= THRESHOLDS.minSmExposureUsd) {
    // FALLBACK: No whale_tracker confidence — still run SignalEngine for validation
    console.log(`⚠️ [${token}] No whale_tracker confidence, running Engine with ratio-only data`)

    // Capital Dominance v3: Attenuate on-chain flows when perps dominate (fallback path)
    let flowAttenuationFb = 1.0
    const onchainSmNetFb = smData.onchain_sm_net ?? 0
    const onchainWhaleNetFb = smData.onchain_whale_net ?? 0
    const onchainAbsVolFb = Math.abs(onchainSmNetFb) + Math.abs(onchainWhaleNetFb)

    if (totalExposure > 0 && onchainAbsVolFb > 0) {
      const volumeRatioFb = totalExposure / onchainAbsVolFb
      if (volumeRatioFb > 10) {
        flowAttenuationFb = 0.1
        console.log(`📉 [${token}] Capital Dominance (fb): perps $${(totalExposure/1e6).toFixed(1)}M >> onchain $${(onchainAbsVolFb/1e6).toFixed(1)}M → attenuation=0.1`)
      } else if (volumeRatioFb > 3) {
        flowAttenuationFb = 0.3
        console.log(`📉 [${token}] Capital Dominance (fb): perps $${(totalExposure/1e6).toFixed(1)}M > onchain $${(onchainAbsVolFb/1e6).toFixed(1)}M → attenuation=0.3`)
      }
    }

    const engineSignal = SignalEngine.analyze(
      token,
      {
        flow_1h: (smData.flow_1h ?? smData.netflow_1h ?? 0) * flowAttenuationFb,
        flow_24h: (smData.netflow_24h ?? smData.flow_24h ?? 0) * flowAttenuationFb,
        flow_7d: (smData.netflow_7d ?? smData.flow_7d ?? 0) * flowAttenuationFb,
        cex_flow: (smData.cex_netflow_7d ?? 0) * flowAttenuationFb
      },
      {
        ratio: ratio,
        whaleConviction: 0,  // No whale_tracker confidence available
        whaleDirection: dominantSide
      }
    );

    signalEngineAllowLongs = engineSignal.allowLongs;
    signalEngineAllowShorts = engineSignal.allowShorts;
    signalEngineOverride = engineSignal.overrideRegime;
    engineScore = engineSignal.score;

    if (engineSignal.action === 'WAIT') {
      dominantSide = 'NEUTRAL';
      convictionScore = Math.abs(engineSignal.score) / 100;
      console.log(`🧠 [${token}] Engine OVERRIDE (fallback): ${engineSignal.score.toFixed(0)} -> PURE_MM`);
    } else if (engineSignal.action === 'SHORT') {
      dominantSide = 'SHORT';
      convictionScore = Math.abs(engineSignal.score) / 100;
      console.log(`🧠 [${token}] Engine CONFIRMS (fallback): ${engineSignal.score.toFixed(0)} -> FOLLOW_SM_SHORT`);
    } else if (engineSignal.action === 'LONG') {
      dominantSide = 'LONG';
      convictionScore = Math.abs(engineSignal.score) / 100;
      console.log(`🧠 [${token}] Engine CONFIRMS (fallback): ${engineSignal.score.toFixed(0)} -> FOLLOW_SM_LONG`);
    }

    console.log(`🧠 [${token}] Engine: ${engineSignal.score.toFixed(0)} (${engineSignal.action}) | ${engineSignal.reason.join(", ")} | Longs:${signalEngineAllowLongs} Shorts:${signalEngineAllowShorts}`);
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

  // 🎯 DYNAMIC RISK: Leverage + Vision SL
  const dailyVol = estimateDailyVolatility(token)
  const recommendedLeverage = TokenRiskCalculator.calculateLeverage({
    symbol: token,
    volatility: dailyVol,
    confidence: convictionScore * 100,
    current_price: 0  // Price not available in SmAutoDetector; used by calculateVisionStopLoss with entryPrice
  })
  const visionSlPct = TokenRiskCalculator.calculateVisionSlPercent(dailyVol, token)

  console.log(`🤖 [SmAutoDetector] ${token}:`, {
    rawLongs: `$${(rawLongsUsd / 1e6).toFixed(2)}M`,
    rawShorts: `$${(rawShortsUsd / 1e6).toFixed(2)}M`,
    ratio: ratio === Infinity ? '∞' : ratio.toFixed(2),
    dominantSide,
    conviction: convictionScore.toFixed(2),
    trend: `${trend} (${trendStrength})`,
    mode,
    bidMult: multipliers.bid.toFixed(2),
    askMult: multipliers.ask.toFixed(2),
    leverage: `${recommendedLeverage}x`,
    visionSL: `${(visionSlPct * 100).toFixed(1)}%`
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
    trendStrength,
    // 🧠 SIGNAL ENGINE MASTER CONTROL
    signalEngineAllowLongs,
    signalEngineAllowShorts,
    signalEngineOverride,
    engineScore,
    // 🎯 DYNAMIC RISK
    recommendedLeverage,
    visionSlPct,
    volatility: dailyVol
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

// ============================================================
// RATIO MONITORING
// Tracks ratio history and fires alerts on threshold crossings
// ============================================================

/** Previous ratio values for change detection */
const prevRatios: Map<string, number> = new Map()

/** Last alert timestamp per token (for cooldown) */
const lastAlertTime: Map<string, number> = new Map()

/** Ratio history for trend tracking: token -> [{ ts, ratio }] */
const ratioHistory: Map<string, Array<{ ts: number; ratio: number }>> = new Map()
const RATIO_HISTORY_MAX = 60  // Keep last 60 data points (~30 min at 30s intervals)

function checkRatioAlerts(analysis: Map<string, TokenSmAnalysis>): void {
  const now = Date.now()

  for (const alert of RATIO_ALERTS) {
    const tokenAnalysis = analysis.get(alert.token)
    if (!tokenAnalysis) continue

    const currentRatio = tokenAnalysis.ratio
    const prevRatio = prevRatios.get(alert.token)

    // Track history
    let history = ratioHistory.get(alert.token)
    if (!history) {
      history = []
      ratioHistory.set(alert.token, history)
    }
    history.push({ ts: now, ratio: currentRatio })
    if (history.length > RATIO_HISTORY_MAX) {
      history.shift()
    }

    // Calculate trend (ratio change over last 10 data points ~5 min)
    let trendStr = ''
    if (history.length >= 10) {
      const recent = history[history.length - 1].ratio
      const older = history[history.length - 10].ratio
      const change = recent - older
      const pct = older > 0 ? ((change / older) * 100).toFixed(1) : '?'
      const arrow = change > 0.1 ? '📈' : change < -0.1 ? '📉' : '➡️'
      trendStr = ` | trend: ${arrow} ${change > 0 ? '+' : ''}${change.toFixed(2)}x (${pct}%) over ~5min`
    }

    // Check threshold crossing
    const isBelow = currentRatio < alert.threshold && currentRatio !== Infinity
    const wasAbove = prevRatio === undefined || prevRatio >= alert.threshold

    if (isBelow) {
      const lastAlert = lastAlertTime.get(alert.token) || 0
      const justCrossed = wasAbove && prevRatio !== undefined
      const cooldownExpired = (now - lastAlert) >= RATIO_ALERT_COOLDOWN_MS

      if (justCrossed || cooldownExpired) {
        const crossMsg = justCrossed ? 'THRESHOLD CROSSED' : 'STILL BELOW'
        console.log(`🚨🚨🚨 [RATIO_MONITOR] ${alert.token}: ${crossMsg} - ratio ${currentRatio.toFixed(2)}x < ${alert.threshold}x${trendStr}`)
        console.log(`🚨 [RATIO_MONITOR] ${alert.message}`)
        console.log(`🚨 [RATIO_MONITOR] ${alert.token}: longs=$${(tokenAnalysis.rawLongsUsd / 1000).toFixed(0)}K shorts=$${(tokenAnalysis.rawShortsUsd / 1000).toFixed(0)}K uPnL_shorts=$${(tokenAnalysis.shortsUpnl / 1000).toFixed(0)}K`)
        lastAlertTime.set(alert.token, now)
      }
    } else if (prevRatio !== undefined && prevRatio < alert.threshold && currentRatio >= alert.threshold) {
      // Ratio recovered above threshold
      console.log(`✅ [RATIO_MONITOR] ${alert.token}: RECOVERED above ${alert.threshold}x - ratio now ${currentRatio.toFixed(2)}x${trendStr}`)
      lastAlertTime.delete(alert.token)
    }

    // Always log ratio status on data refresh (but not every 30s - only when ratio changes significantly)
    if (prevRatio === undefined || Math.abs(currentRatio - prevRatio) > 0.05) {
      const status = isBelow ? '⚠️ BELOW' : '✅ OK'
      console.log(`📊 [RATIO_MONITOR] ${alert.token}: ratio=${currentRatio.toFixed(2)}x (threshold=${alert.threshold}x) ${status}${trendStr}`)
    }

    prevRatios.set(alert.token, currentRatio)
  }
}

// ============================================================
// VIP FLASH OVERRIDE
// Reads live VIP positions from vip_spy.py (30s polling)
// Downgrades directional mode to PURE_MM when top VIP disagrees
// ============================================================
const VIP_FLASH_MIN_WEIGHT = 0.90       // Tylko top VIPy (Generał 0.95, Major 0.95, Wice-Generał 0.90, Kraken A 0.90)
const VIP_FLASH_MIN_POSITION_USD = 50_000  // Ignoruj pozycje < $50K
const VIP_SPY_STATE_PATH = '/tmp/vip_spy_state.json'

interface VipPosition {
  side: 'LONG' | 'SHORT'
  size: number
  position_value: number
}

async function readVipSpyState(): Promise<Record<string, Record<string, VipPosition>> | null> {
  try {
    const content = await fsp.readFile(VIP_SPY_STATE_PATH, 'utf-8')
    return JSON.parse(content)
  } catch {
    return null  // File missing or corrupted — skip override
  }
}

/**
 * Loads SM data and analyzes all tokens.
 * Results are cached for 30 seconds.
 */
export async function loadAndAnalyzeAllTokens(forceReload = false): Promise<Map<string, TokenSmAnalysis>> {
  const now = Date.now()

  // Return cached if fresh (unless forced)
  if (!forceReload && now - lastLoadTime < CACHE_TTL_MS && cachedAnalysis.size > 0) {
    return cachedAnalysis
  }

  try {
    const smDataPath = '/tmp/smart_money_data.json'
    const content = await fsp.readFile(smDataPath, 'utf-8')
    const smFile: SmartMoneyFile = JSON.parse(content)

    // Inject on-chain proxy data for tokens with weak HL perps data (ZEC, VIRTUAL)
    const nansenClient = getNansenProAPI()
    const enrichedSmData = await injectProxyData(smFile.data, nansenClient)

    const newAnalysis = new Map<string, TokenSmAnalysis>()

    for (const [token, smData] of Object.entries(enrichedSmData)) {
      const analysis = analyzeTokenSm(token, smData)
      newAnalysis.set(token, analysis)
    }

    // 🕵️ VIP FLASH OVERRIDE: Check live VIP positions vs stale whale_tracker
    const vipState = await readVipSpyState()
    if (vipState) {
      for (const [token, analysis] of newAnalysis.entries()) {
        // Only check directional modes
        if (analysis.mode !== MmMode.FOLLOW_SM_SHORT && analysis.mode !== MmMode.FOLLOW_SM_LONG) continue

        const isShortMode = analysis.mode === MmMode.FOLLOW_SM_SHORT

        // Check each VIP address
        for (const [address, positions] of Object.entries(vipState)) {
          const trader = KNOWN_TRADERS[address]
          if (!trader || trader.signalWeight < VIP_FLASH_MIN_WEIGHT) continue

          const vipPos = positions[token]
          if (!vipPos || vipPos.position_value < VIP_FLASH_MIN_POSITION_USD) continue

          const vipIsLong = vipPos.side === 'LONG'
          const disagrees = (isShortMode && vipIsLong) || (!isShortMode && !vipIsLong)

          if (disagrees) {
            const prevMode = analysis.mode
            // Downgrade to PURE_MM (conservative — don't flip, just stop)
            analysis.mode = MmMode.PURE_MM
            analysis.multipliers = {
              bid: 1.0,
              ask: 1.0,
              bidLocked: false,
              askLocked: false,
              maxInventoryUsd: analysis.multipliers.maxInventoryUsd,
              priority: analysis.multipliers.priority,
              source: 'VIP_FLASH_OVERRIDE',
              reason: `${trader.label} (w=${trader.signalWeight}) is ${vipPos.side} $${(vipPos.position_value / 1000).toFixed(0)}K — disagrees with ${prevMode}`
            }
            analysis.convictionScore = 0  // No conviction — conflicting signals
            console.log(`🕵️ [VIP_FLASH] ${token}: ${trader.label} is ${vipPos.side} $${(vipPos.position_value / 1000).toFixed(0)}K vs ${prevMode} → PURE_MM (flash override)`)
            break  // One VIP disagreement is enough
          }
        }
      }
    }

    cachedAnalysis = newAnalysis
    lastLoadTime = now

    // Check ratio alerts on fresh data
    checkRatioAlerts(newAnalysis)

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
// Env-driven PURE_MM override: "FORCE_MM_PAIRS=BTC,SOL,ETH"
const FORCE_MM_PAIRS: Set<string> = new Set(
  (process.env.FORCE_MM_PAIRS || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
)

export function isForcedMmPair(token: string): boolean {
  return FORCE_MM_PAIRS.has(token.toUpperCase())
}

export function getAutoEmergencyOverrideSync(token: string): {
  bidEnabled: boolean
  askEnabled: boolean
  bidMultiplier: number
  askMultiplier: number
  maxInventoryUsd: number
  reason: string
  mode: MmMode
  convictionScore: number
  // 🧠 SIGNAL ENGINE MASTER FLAGS
  signalEngineOverride: boolean
  signalEngineAllowLongs: boolean
  signalEngineAllowShorts: boolean
} | undefined {
  // 🔧 FORCE PURE_MM for env-specified pairs (e.g. at support after big drops)
  if (isForcedMmPair(token)) {
    const analysis = cachedAnalysis.get(token)
    return {
      bidEnabled: true,
      askEnabled: true,
      bidMultiplier: 1.0,
      askMultiplier: 1.0,
      maxInventoryUsd: analysis?.multipliers?.maxInventoryUsd ?? 5000,
      reason: `[FORCE_MM] ${token}: PURE_MM forced via env (both sides enabled)`,
      mode: MmMode.PURE_MM,
      convictionScore: 0,
      signalEngineOverride: true,
      signalEngineAllowLongs: true,
      signalEngineAllowShorts: true
    }
  }

  const analysis = cachedAnalysis.get(token)

  if (!analysis) {
    return undefined
  }

  // 🧠 SIGNAL ENGINE: For PURE_MM mode with SignalEngine override, return BOTH sides enabled
  // This prevents whale_tracker.py from overriding SignalEngine's decision
  if (analysis.signalEngineOverride && analysis.mode === MmMode.PURE_MM) {
    return {
      bidEnabled: true,  // FORCE both sides for PURE_MM
      askEnabled: true,
      bidMultiplier: 1.0,
      askMultiplier: 1.0,
      maxInventoryUsd: analysis.multipliers.maxInventoryUsd,
      reason: `[SIGNAL_ENGINE] PURE_MM - both sides enabled (score in WAIT zone)`,
      mode: MmMode.PURE_MM,
      convictionScore: analysis.convictionScore,
      signalEngineOverride: true,
      signalEngineAllowLongs: true,
      signalEngineAllowShorts: true
    }
  }

  // Skip FLAT mode (no trading)
  if (analysis.mode === MmMode.FLAT) {
    return undefined
  }

  // Skip regular PURE_MM (without SignalEngine override) - let whale_tracker.py handle it
  if (analysis.mode === MmMode.PURE_MM && !analysis.signalEngineOverride) {
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
    convictionScore: analysis.convictionScore,
    signalEngineOverride: analysis.signalEngineOverride ?? false,
    signalEngineAllowLongs: analysis.signalEngineAllowLongs ?? true,
    signalEngineAllowShorts: analysis.signalEngineAllowShorts ?? true
  }
}

/**
 * Check if token is in FOLLOW_SM mode (SHORT or LONG) based on SM analysis.
 * Replaces hardcoded SHORT_ONLY_TOKENS list - bot decides direction from data.
 */
export function isFollowSmToken(token: string): boolean {
  const analysis = cachedAnalysis.get(token)
  if (!analysis) return false
  return analysis.mode === MmMode.FOLLOW_SM_SHORT || analysis.mode === MmMode.FOLLOW_SM_LONG
}

/**
 * Gets dynamic risk parameters for a token from cached analysis.
 * Used by mm_hl.ts for per-token leverage and Vision SL.
 */
export function getTokenRiskParams(token: string): {
  recommendedLeverage: number
  visionSlPct: number
  volatility: number
} | undefined {
  const analysis = cachedAnalysis.get(token)
  if (!analysis) return undefined
  return {
    recommendedLeverage: analysis.recommendedLeverage,
    visionSlPct: analysis.visionSlPct,
    volatility: analysis.volatility
  }
}

/**
 * Get SM direction for a token: 'SHORT', 'LONG', or null.
 */
export function getSmDirection(token: string): 'SHORT' | 'LONG' | null {
  if (isForcedMmPair(token)) return null  // PURE_MM → no SM direction
  const analysis = cachedAnalysis.get(token)
  if (!analysis) return null
  if (analysis.mode === MmMode.FOLLOW_SM_SHORT) return 'SHORT'
  if (analysis.mode === MmMode.FOLLOW_SM_LONG) return 'LONG'
  return null
}

/**
 * Check if holding position aligns with SM direction (HOLD_FOR_TP logic).
 * SHORT position + SM SHORT = hold for TP
 * LONG position + SM LONG = hold for TP
 */
export function shouldHoldForTp(token: string, positionSide: 'short' | 'long' | 'none'): boolean {
  if (positionSide === 'none') return false
  const dir = getSmDirection(token)
  if (!dir) return false
  return (positionSide === 'short' && dir === 'SHORT') || (positionSide === 'long' && dir === 'LONG')
}

// ============================================================
// SM ROTATION STATE (4H Lock + Flash Rotation)
// Prevents token churn by locking selected pairs for 4 hours.
// Emergency override: >$10M new imbalance triggers immediate rotation.
// ============================================================

let lastSmRotationTime = 0
let cachedSmPairs: string[] = []
const SM_ROTATION_LOCK_MS = 4 * 60 * 60 * 1000   // 4 hours
const FLASH_ROTATION_THRESHOLD = 10_000_000        // $10M

/**
 * Returns top N tokens by SM conviction score.
 * Only includes tokens with FOLLOW_SM_SHORT or FOLLOW_SM_LONG mode.
 * Call loadAndAnalyzeAllTokens() first to populate cache.
 *
 * 4H ROTATION LOCK: Once pairs are selected, they stay locked for 4 hours
 * to prevent churn from minor ranking shifts every ~90s cycle.
 *
 * FLASH ROTATION: If a NEW token (not already tracked) appears with >$10M
 * net imbalance, the lock is bypassed and rotation happens immediately.
 */
export function getTopSmPairs(count: number): string[] {
  if (!cachedAnalysis || cachedAnalysis.size === 0) return cachedSmPairs.length > 0 ? cachedSmPairs : []

  const eligible = [...cachedAnalysis.entries()]
    .filter(([_, a]) => a.mode === MmMode.FOLLOW_SM_SHORT || a.mode === MmMode.FOLLOW_SM_LONG)

  if (eligible.length === 0) return cachedSmPairs.length > 0 ? cachedSmPairs : []

  // Capital Dominance v3: Sort by absolute net USD imbalance (biggest money wins)
  eligible.sort((a, b) => {
    // PRIMARY: Capital Dominance = |longs - shorts| (biggest money wins)
    const netA = Math.abs(a[1].rawLongsUsd - a[1].rawShortsUsd)
    const netB = Math.abs(b[1].rawLongsUsd - b[1].rawShortsUsd)
    if (netB !== netA) return netB - netA
    // TIEBREAKER: Engine score
    return Math.abs(b[1].engineScore) - Math.abs(a[1].engineScore)
  })

  const newTopTokens = eligible.slice(0, count).map(([token]) => token)
  const now = Date.now()

  // --- FLASH ROTATION CHECK ---
  // If a new token with >$10M imbalance appeared that wasn't in cached list, rotate immediately
  const isFlashRotation = newTopTokens.some(token => {
    if (cachedSmPairs.includes(token)) return false  // already tracked
    const analysis = cachedAnalysis.get(token)
    if (!analysis) return false
    const absNet = Math.abs(analysis.rawLongsUsd - analysis.rawShortsUsd)
    return absNet > FLASH_ROTATION_THRESHOLD
  })

  // --- 4H LOCK ---
  if (cachedSmPairs.length > 0 && !isFlashRotation && (now - lastSmRotationTime < SM_ROTATION_LOCK_MS)) {
    // Locked — return cached pairs
    return cachedSmPairs
  }

  // --- ROTATE ---
  if (isFlashRotation) {
    console.log(`🚨 [SM ROTATION] FLASH ROTATION — new >$10M imbalance detected`)
  } else if (cachedSmPairs.length > 0) {
    console.log(`🔄 [SM ROTATION] 4H rotation cycle — updating portfolio`)
  }

  // Log Capital Dominance leaders
  console.log(`[SM Auto-Select] Capital Dominance Leaders:`)
  eligible.slice(0, count + 2).forEach(([t, a]) => {
    const net = a.rawLongsUsd - a.rawShortsUsd
    const dir = net > 0 ? '🟩 LONG' : '🟥 SHORT'
    console.log(`   ${t}: ${dir} $${(Math.abs(net)/1e6).toFixed(1)}M net | Engine: ${a.engineScore}`)
  })

  // Update cache
  lastSmRotationTime = now
  cachedSmPairs = newTopTokens

  console.log(`[SM ROTATION] Locked pairs for 4H: ${cachedSmPairs.join(', ')}`)
  return cachedSmPairs
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

  // Check ratio alerts on fresh data
  checkRatioAlerts(newAnalysis)
}

// ============================================================
// PROXY DATA FETCHING (For perps without HL-native data)
// ============================================================

/**
 * Fetches SM data from Nansen for proxy tokens (on-chain equivalents of HL perps).
 * This allows us to get SM signals for VIRTUAL (Base) to trade VIRTUAL perp on HL.
 */
export async function fetchProxySmData(
  perpSymbol: string,
  nansenClient?: any  // NansenProAPI instance
): Promise<SmartMoneyEntry | null> {
  const proxy = PERP_TO_ONCHAIN_PROXY[perpSymbol]
  if (!proxy || !nansenClient) {
    return null
  }

  try {
    console.log(`🔗 [PROXY] Fetching ${perpSymbol} SM data from ${proxy.chain} (${proxy.tokenAddress.slice(0, 10)}...)`)

    // Fetch token flow signals from Nansen
    const flowSignals = await nansenClient.getTokenFlowSignals(proxy.tokenAddress, proxy.chain)
    if (!flowSignals) {
      console.warn(`⚠️ [PROXY] No flow signals for ${perpSymbol} on ${proxy.chain}`)
      return null
    }

    // Convert Nansen flow signals to SmartMoneyEntry format
    const smEntry: SmartMoneyEntry = {
      // Nansen flows: positive = buying (LONG bias), negative = selling (SHORT bias)
      current_longs_usd: flowSignals.smartMoneyNet > 0 ? Math.abs(flowSignals.smartMoneyNet) : 0,
      current_shorts_usd: flowSignals.smartMoneyNet < 0 ? Math.abs(flowSignals.smartMoneyNet) : 0,
      longs_count: flowSignals.buyCount || 0,
      shorts_count: flowSignals.sellCount || 0,
      longs_upnl: 0,  // Not available from on-chain data
      shorts_upnl: 0,

      // Calculate bias from net flows (-1 to +1, where +1 = all buying)
      bias: flowSignals.confidence * (flowSignals.smartMoneyNet > 0 ? 1 : -1),
      flow: flowSignals.smartMoneyNet,

      // Trend detection from whale + smart money combined
      trend: flowSignals.smartMoneyNet > 0 ? 'increasing_longs' :
             flowSignals.smartMoneyNet < 0 ? 'increasing_shorts' : 'stable',
      trend_strength: flowSignals.confidence > 0.7 ? 'strong' :
                      flowSignals.confidence > 0.4 ? 'moderate' : 'weak',

      // Use Nansen confidence directly
      trading_mode_confidence: flowSignals.confidence * 100,
      trading_mode: flowSignals.smartMoneyNet > 0 ? 'FOLLOW_SM_LONG' :
                    flowSignals.smartMoneyNet < 0 ? 'FOLLOW_SM_SHORT' : 'PURE_MM'
    }

    console.log(`✅ [PROXY] ${perpSymbol}: SM Net=$${(flowSignals.smartMoneyNet/1000).toFixed(0)}k, ` +
                `Whale=$${(flowSignals.whaleNet/1000).toFixed(0)}k, Conf=${(flowSignals.confidence*100).toFixed(0)}%`)

    return smEntry

  } catch (err) {
    console.error(`❌ [PROXY] Failed to fetch ${perpSymbol} from ${proxy.chain}:`, err)
    return null
  }
}

/**
 * Injects proxy token data into the SM data map.
 * Call this after loading whale_tracker data but before analysis.
 */
export async function injectProxyData(
  smData: Record<string, SmartMoneyEntry>,
  nansenClient?: any
): Promise<Record<string, SmartMoneyEntry>> {
  if (!nansenClient) {
    console.log(`⚠️ [PROXY] No Nansen client provided, skipping proxy injection`)
    return smData
  }

  const enrichedData = { ...smData }

  for (const [perpSymbol, proxy] of Object.entries(PERP_TO_ONCHAIN_PROXY)) {
    const proxyData = await fetchProxySmData(perpSymbol, nansenClient)
    if (!proxyData) continue

    const existing = enrichedData[perpSymbol]
    const perpVol = existing
      ? (existing.current_longs_usd ?? 0) + (existing.current_shorts_usd ?? 0)
      : 0
    const onchainVol = (proxyData.current_longs_usd ?? 0) + (proxyData.current_shorts_usd ?? 0)

    if (perpVol > 0 && perpVol > onchainVol) {
      // PERP dominates — keep perp data, add on-chain as supplement
      enrichedData[perpSymbol] = {
        ...existing!,
        onchain_sm_net: (proxyData.current_longs_usd ?? 0) - (proxyData.current_shorts_usd ?? 0),
        onchain_whale_net: proxyData.flow ?? 0,
        onchain_chain: proxy.chain,
        onchain_confidence: proxyData.trading_mode_confidence ?? 0,
      }
      console.log(`✅ [PROXY] ${perpSymbol}: PERP dominates ($${(perpVol/1e6).toFixed(1)}M > $${(onchainVol/1e6).toFixed(1)}M) — kept perp data, added onchain`)
    } else {
      // On-chain dominates (or no perp data) — use on-chain as primary
      enrichedData[perpSymbol] = proxyData
      console.log(`✅ [PROXY] ${perpSymbol}: ONCHAIN primary ($${(onchainVol/1e6).toFixed(1)}M vs $${(perpVol/1e6).toFixed(1)}M perp)`)
    }
  }

  return enrichedData
}

// Export known traders for reference
export { KNOWN_TRADERS, THRESHOLDS }
