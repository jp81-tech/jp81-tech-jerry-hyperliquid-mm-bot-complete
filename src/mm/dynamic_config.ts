import { promises as fsp } from 'fs'
import path from 'path'
import { AlertManager } from '../alerts/AlertManager.js'
import { BottomSignal, BottomSignalDetector, BottomSignalType } from '../signals/BottomSignalDetector.js'
import { FlowHistoryTracker, getFlowHistoryTracker, getTokenThresholds } from '../signals/FlowHistoryTracker.js'
import { CoinTuning, NANSEN_TOKENS } from '../signals/market_vision.js'
import { getNansenAlertAdjustments } from '../signals/nansen_alert_handler.js'
import { loadOnChainDataFromFile, mergeOnChainData } from '../signals/onchain_parser.js'
import { getValidationTracker, SignalValidationTracker } from '../signals/SignalValidationTracker.js'
import { getSqueezePlayManager, SqueezePlayManager, SqueezePlaySignal } from '../signals/SqueezePlayManager.js'
import { getHyperliquidDataFetcher, HyperliquidDataFetcher } from '../api/hyperliquid_data_fetcher.js'
import { getChartPainter, ChartState } from '../signals/ChartPainter.js'
import { generateSmartMoneySignal, SmartMoneySignal } from '../signals/sm_signal_service.js'
import { TelemetryCollector } from '../telemetry/TelemetryCollector.js'
import { SmartMoneyEntry, SmartMoneyFile } from '../types/smart_money.js'
import { ConsoleNotifier } from '../utils/notifier.js'
import { telegramBot } from '../utils/telegram_bot.js'
import { HyperliquidMarketData } from './market_data.js'
import { AlphaSignalAggregator, CombinedAlphaSignal } from '../signals/AlphaSignals.js'
import { getAutoEmergencyOverrideSync, MmMode, updateCacheFromSmData } from './SmAutoDetector.js'
import { readNansenBiasJson, NansenBiasEntry, NansenTradingMode } from './nansen_bias_cache.js'
import fs from 'fs'

type BiasDirection = 'LONG' | 'SHORT' | 'NEUTRAL'

// ============================================================
// STRATEGY PRIORITY SYSTEM
// Prevents lower-priority strategies from overriding higher-priority ones
// Lower number = higher priority (EMERGENCY cannot be overridden)
// ============================================================

export enum StrategyPriority {
  EMERGENCY = 0,      // Highest - FOLLOW SM, BULL_TRAP, DEAD_CAT (cannot be overridden)
  REVERSAL = 1,       // SM reversal detection (auto-detected)
  FOLLOW_SM = 2,      // EMERGENCY_OVERRIDES config
  BOTTOM_SIGNAL = 3,  // Detected bottom - can relax FOLLOW_SM
  CONTRARIAN = 4,     // Squeeze play contrarian
  SM_SIGNAL = 5,      // General SM signal adjustments
  NANSEN_ALERT = 6,   // On-chain flow alerts
  SQUEEZE_BOOST = 7,  // Squeeze entry boost
  CHART_PAINTER = 8,  // Technical chart adjustments
  DEFAULT = 99        // Base multipliers
}

export interface MultiplierState {
  bidMultiplier: number
  askMultiplier: number
  maxPosition: number
  targetInventory: number
  priority: StrategyPriority
  bidLocked: boolean      // Cannot increase bid (EMERGENCY, BULL_TRAP, DEAD_CAT)
  askLocked: boolean      // Cannot increase ask (reversal detection)
  source: string          // Which strategy set this
  reason: string          // Human-readable reason
}

/**
 * Creates initial multiplier state with default values
 */
function createInitialMultiplierState(
  bidMultiplier: number,
  askMultiplier: number,
  maxPosition: number,
  targetInventory: number
): MultiplierState {
  return {
    bidMultiplier,
    askMultiplier,
    maxPosition,
    targetInventory,
    priority: StrategyPriority.DEFAULT,
    bidLocked: false,
    askLocked: false,
    source: 'DEFAULT',
    reason: 'Initial values from bias calculation'
  }
}

/**
 * Applies a strategy's multipliers respecting the priority system.
 * Higher priority (lower number) strategies cannot be overridden.
 * Locked multipliers (bid/ask) cannot be increased by any strategy.
 *
 * @param current - Current multiplier state
 * @param incoming - New multipliers from a strategy
 * @returns Updated multiplier state
 */
function applyMultiplier(
  current: MultiplierState,
  incoming: Partial<MultiplierState> & { priority: StrategyPriority; source: string }
): MultiplierState {
  // If incoming has LOWER priority (higher number), it cannot override
  if (incoming.priority > current.priority) {
    console.log(
      `🔒 [${incoming.source}] blocked by [${current.source}] ` +
      `(priority ${incoming.priority} < ${current.priority})`
    )
    return current
  }

  // Start with current state
  const result = { ...current }

  // Apply bid multiplier (respecting lock)
  if (incoming.bidMultiplier !== undefined) {
    if (current.bidLocked) {
      // Locked: can only DECREASE or keep same
      result.bidMultiplier = Math.min(current.bidMultiplier, incoming.bidMultiplier)
    } else {
      result.bidMultiplier = incoming.bidMultiplier
    }
  }

  // Apply ask multiplier (respecting lock)
  if (incoming.askMultiplier !== undefined) {
    if (current.askLocked) {
      // Locked: can only DECREASE or keep same
      result.askMultiplier = Math.min(current.askMultiplier, incoming.askMultiplier)
    } else {
      result.askMultiplier = incoming.askMultiplier
    }
  }

  // Apply max position
  if (incoming.maxPosition !== undefined) {
    result.maxPosition = incoming.maxPosition
  }

  // Apply target inventory
  if (incoming.targetInventory !== undefined) {
    result.targetInventory = incoming.targetInventory
  }

  // Update priority and source
  result.priority = incoming.priority
  result.source = incoming.source
  result.reason = incoming.reason ?? current.reason

  // Apply locks from incoming (locks can only be set, not unset)
  if (incoming.bidLocked) {
    result.bidLocked = true
  }
  if (incoming.askLocked) {
    result.askLocked = true
  }

  return result
}

/**
 * Safely adjusts a multiplier, respecting the locked state.
 * Use this for strategies that modify (not replace) multipliers.
 */
function adjustMultiplier(
  current: MultiplierState,
  adjustment: {
    bidFactor?: number      // Multiply bid by this
    askFactor?: number      // Multiply ask by this
    bidClamp?: { min: number; max: number }
    askClamp?: { min: number; max: number }
  },
  source: string
): MultiplierState {
  const result = { ...current }

  // Adjust bid (only if not locked, or if reducing)
  if (adjustment.bidFactor !== undefined) {
    const newBid = current.bidMultiplier * adjustment.bidFactor
    if (adjustment.bidClamp) {
      const clamped = Math.max(adjustment.bidClamp.min, Math.min(adjustment.bidClamp.max, newBid))
      // If locked, can only decrease
      if (current.bidLocked) {
        result.bidMultiplier = Math.min(current.bidMultiplier, clamped)
      } else {
        result.bidMultiplier = clamped
      }
    } else {
      if (current.bidLocked) {
        result.bidMultiplier = Math.min(current.bidMultiplier, newBid)
      } else {
        result.bidMultiplier = newBid
      }
    }
  }

  // Adjust ask (only if not locked, or if reducing)
  if (adjustment.askFactor !== undefined) {
    const newAsk = current.askMultiplier * adjustment.askFactor
    if (adjustment.askClamp) {
      const clamped = Math.max(adjustment.askClamp.min, Math.min(adjustment.askClamp.max, newAsk))
      if (current.askLocked) {
        result.askMultiplier = Math.min(current.askMultiplier, clamped)
      } else {
        result.askMultiplier = clamped
      }
    } else {
      if (current.askLocked) {
        result.askMultiplier = Math.min(current.askMultiplier, newAsk)
      } else {
        result.askMultiplier = newAsk
      }
    }
  }

  result.source = source
  return result
}

// ============================================================
// SM CONFLICT DETECTION (Contrarian Squeeze Play)
// ============================================================

type SMConflictSeverity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

interface SMConflictAlert {
  token: string
  botSide: 'long' | 'short' | 'neutral'
  smSide: 'long' | 'short' | 'neutral'
  smNetPositionUsd: number
  conflictSeverity: SMConflictSeverity
  recommendation: string
  contrarian: {
    bidMultiplier: number
    askMultiplier: number
    maxInventoryMultiplier: number
    squeezeTriggerPrice?: number  // Price at which to close all positions
    stopLossPrice?: number        // Hard stop loss
  }
}

// Contrarian config per token (squeeze play thresholds)
// 2026-01-19: Increased maxInventoryUsd to allow meaningful orders (CLIP_USD=$100)
const CONTRARIAN_CONFIG: Record<string, {
  squeezeTriggerPct: number   // % above current price to trigger squeeze exit
  stopLossPct: number         // % below entry to trigger stop loss
  maxInventoryUsd: number     // Max position size in USD for contrarian play
}> = {
  DOGE: {
    squeezeTriggerPct: 0.15,    // +15% = squeeze trigger
    stopLossPct: 0.10,          // -10% = stop loss
    maxInventoryUsd: 3000       // INCREASED from 1500
  },
  SUI: {
    squeezeTriggerPct: 0.12,    // +12% = squeeze trigger
    stopLossPct: 0.10,          // -10% = stop loss
    maxInventoryUsd: 4000       // INCREASED from 2000
  },
  LIT: {
    squeezeTriggerPct: 0.15,    // +15% = squeeze trigger
    stopLossPct: 0.12,          // -12% = stop loss (more volatile)
    maxInventoryUsd: 3000       // INCREASED from 2000
  }
}

// ============================================================
// AUTOMATIC SM REVERSAL DETECTION
// Detects when SM is closing positions en masse → blocks new positions in that direction
// This is AUTOMATIC and takes precedence over manual EMERGENCY_OVERRIDES
// ============================================================

type ReversalType = 'SM_CLOSING_SHORTS' | 'SM_CLOSING_LONGS' | 'SM_BUILDING_SHORTS' | 'SM_BUILDING_LONGS' | 'NONE'

interface SMReversalSignal {
  type: ReversalType
  strength: 'WEAK' | 'MODERATE' | 'STRONG' | 'EXTREME'
  confidence: number  // 0-100%
  metrics: {
    closedPositions: number
    positionUsdChange: number
    countChange: number
    upnlChange: number
  }
  action: {
    blockNewShorts: boolean
    blockNewLongs: boolean
    bidMultiplier: number
    askMultiplier: number
    reason: string
  }
}

// Thresholds for reversal detection - NOW PER-TOKEN (see FlowHistoryTracker.ts)
// Use getTokenThresholds(token) to get thresholds for specific token
// Examples:
//   SOL: $10M (high liquidity)
//   SUI: $3M (medium liquidity)
//   DOGE: $2M (lower liquidity)
//   Default: $5M

/**
 * Automatically detects SM reversal signals from position changes
 * This runs on every refresh and returns blocking recommendations
 * NOW USES PER-TOKEN THRESHOLDS for better calibration
 */
function detectSMReversal(token: string, entry: SmartMoneyEntry): SMReversalSignal {
  const closedShorts = entry.closed_short_positions_24h ?? 0
  const closedLongs = entry.closed_long_positions_24h ?? 0
  const shortsUsdChange = entry.shorts_usd_change_24h ?? 0
  const longsUsdChange = entry.longs_usd_change_24h ?? 0
  const shortsCountChange = entry.shorts_count_change_24h ?? 0
  const longsCountChange = entry.longs_count_change_24h ?? 0
  const shortsUpnlChange = entry.shorts_upnl_change_24h ?? 0
  const longsUpnlChange = entry.longs_upnl_change_24h ?? 0
  const newShorts = entry.new_short_positions_24h ?? 0
  const newLongs = entry.new_long_positions_24h ?? 0

  // Get per-token thresholds
  const T = getTokenThresholds(token)

  // ============================================================
  // DETECT: SM CLOSING SHORTS (Bullish Reversal)
  // Signals: shorts closed + shorts USD reduced significantly
  // Action: BLOCK NEW SHORTS (don't fight the reversal)
  // ============================================================
  const shortsClosingScore =
    (closedShorts >= T.minClosedPositions ? 25 : 0) +
    (Math.abs(shortsUsdChange) >= T.minUsdReduction ? 30 : 0) +
    (Math.abs(shortsUsdChange) >= T.strongUsdReduction ? 20 : 0) +
    (shortsCountChange <= -2 ? 15 : 0) +
    (shortsUpnlChange < -T.upnlConfirmationThreshold ? 10 : 0)  // Shorts taking losses = closing

  if (shortsClosingScore >= 40 && shortsUsdChange < 0) {
    const strength = Math.abs(shortsUsdChange) >= T.extremeUsdReduction ? 'EXTREME' :
                     Math.abs(shortsUsdChange) >= T.strongUsdReduction ? 'STRONG' :
                     shortsClosingScore >= 70 ? 'MODERATE' : 'WEAK'

    const bidMult = strength === 'EXTREME' ? 1.0 : strength === 'STRONG' ? 1.0 : 1.0
    const askMult = strength === 'EXTREME' ? 0 : strength === 'STRONG' ? 0.3 : 0.5

    return {
      type: 'SM_CLOSING_SHORTS',
      strength,
      confidence: Math.min(100, shortsClosingScore),
      metrics: {
        closedPositions: closedShorts,
        positionUsdChange: shortsUsdChange,
        countChange: shortsCountChange,
        upnlChange: shortsUpnlChange
      },
      action: {
        blockNewShorts: true,
        blockNewLongs: false,
        bidMultiplier: bidMult,    // Allow buying (could go long)
        askMultiplier: askMult,    // Block or reduce selling (no new shorts)
        reason: `SM closing ${closedShorts} shorts (${(shortsUsdChange / 1e6).toFixed(1)}M USD) - BLOCK NEW SHORTS`
      }
    }
  }

  // ============================================================
  // DETECT: SM CLOSING LONGS (Bearish Reversal)
  // Signals: longs closed + longs USD reduced significantly
  // Action: BLOCK NEW LONGS (don't fight the reversal)
  // ============================================================
  const longsClosingScore =
    (closedLongs >= T.minClosedPositions ? 25 : 0) +
    (Math.abs(longsUsdChange) >= T.minUsdReduction ? 30 : 0) +
    (Math.abs(longsUsdChange) >= T.strongUsdReduction ? 20 : 0) +
    (longsCountChange <= -2 ? 15 : 0) +
    (longsUpnlChange < -T.upnlConfirmationThreshold ? 10 : 0)

  if (longsClosingScore >= 40 && longsUsdChange < 0) {
    const strength = Math.abs(longsUsdChange) >= T.extremeUsdReduction ? 'EXTREME' :
                     Math.abs(longsUsdChange) >= T.strongUsdReduction ? 'STRONG' :
                     longsClosingScore >= 70 ? 'MODERATE' : 'WEAK'

    const bidMult = strength === 'EXTREME' ? 0 : strength === 'STRONG' ? 0.3 : 0.5
    const askMult = strength === 'EXTREME' ? 1.0 : strength === 'STRONG' ? 1.0 : 1.0

    return {
      type: 'SM_CLOSING_LONGS',
      strength,
      confidence: Math.min(100, longsClosingScore),
      metrics: {
        closedPositions: closedLongs,
        positionUsdChange: longsUsdChange,
        countChange: longsCountChange,
        upnlChange: longsUpnlChange
      },
      action: {
        blockNewShorts: false,
        blockNewLongs: true,
        bidMultiplier: bidMult,    // Block or reduce buying (no new longs)
        askMultiplier: askMult,    // Allow selling (could go short)
        reason: `SM closing ${closedLongs} longs (${(longsUsdChange / 1e6).toFixed(1)}M USD) - BLOCK NEW LONGS`
      }
    }
  }

  // ============================================================
  // DETECT: SM BUILDING SHORTS (Bearish Conviction)
  // Action: Follow SM, prefer shorts
  // ============================================================
  const buildingShortsScore =
    (newShorts >= T.minNewPositions ? 25 : 0) +
    (shortsUsdChange >= T.minUsdIncrease ? 30 : 0) +
    (shortsUsdChange >= T.strongUsdIncrease ? 25 : 0) +
    (shortsCountChange >= 2 ? 20 : 0)

  if (buildingShortsScore >= 50 && shortsUsdChange > 0) {
    return {
      type: 'SM_BUILDING_SHORTS',
      strength: shortsUsdChange >= T.strongUsdIncrease ? 'STRONG' : 'MODERATE',
      confidence: Math.min(100, buildingShortsScore),
      metrics: {
        closedPositions: 0,
        positionUsdChange: shortsUsdChange,
        countChange: shortsCountChange,
        upnlChange: shortsUpnlChange
      },
      action: {
        blockNewShorts: false,
        blockNewLongs: true,  // Block longs when SM building shorts
        bidMultiplier: 0.5,
        askMultiplier: 1.2,
        reason: `SM building ${newShorts} new shorts (+${(shortsUsdChange / 1e6).toFixed(1)}M USD) - FOLLOW SM SHORT`
      }
    }
  }

  // ============================================================
  // DETECT: SM BUILDING LONGS (Bullish Conviction)
  // Action: Follow SM, prefer longs
  // ============================================================
  const buildingLongsScore =
    (newLongs >= T.minNewPositions ? 25 : 0) +
    (longsUsdChange >= T.minUsdIncrease ? 30 : 0) +
    (longsUsdChange >= T.strongUsdIncrease ? 25 : 0) +
    (longsCountChange >= 2 ? 20 : 0)

  if (buildingLongsScore >= 50 && longsUsdChange > 0) {
    return {
      type: 'SM_BUILDING_LONGS',
      strength: longsUsdChange >= T.strongUsdIncrease ? 'STRONG' : 'MODERATE',
      confidence: Math.min(100, buildingLongsScore),
      metrics: {
        closedPositions: 0,
        positionUsdChange: longsUsdChange,
        countChange: longsCountChange,
        upnlChange: longsUpnlChange
      },
      action: {
        blockNewShorts: true,  // Block shorts when SM building longs
        blockNewLongs: false,
        bidMultiplier: 1.2,
        askMultiplier: 0.5,
        reason: `SM building ${newLongs} new longs (+${(longsUsdChange / 1e6).toFixed(1)}M USD) - FOLLOW SM LONG`
      }
    }
  }

  // No reversal detected
  return {
    type: 'NONE',
    strength: 'WEAK',
    confidence: 0,
    metrics: { closedPositions: 0, positionUsdChange: 0, countChange: 0, upnlChange: 0 },
    action: {
      blockNewShorts: false,
      blockNewLongs: false,
      bidMultiplier: 1.0,
      askMultiplier: 1.0,
      reason: 'No reversal signal'
    }
  }
}

// ============================================================
// EMERGENCY OVERRIDE - When SM shorts are WINNING, don't fight them!
// Updated: 2026-01-10 based on live SM PnL analysis
// NOTE: Automatic reversal detection (above) takes precedence!
// ============================================================
interface EmergencyOverride {
  bidEnabled: boolean        // Allow placing bids (buying)
  askEnabled: boolean        // Allow placing asks (selling)
  bidMultiplier: number      // Bid size multiplier (0 = no bids)
  askMultiplier: number      // Ask size multiplier
  maxInventoryUsd: number    // Override max inventory
  reason: string             // Why this override is active
}

const EMERGENCY_OVERRIDES: Record<string, EmergencyOverride> = {
  // DOGE: SM shorts winning - FOLLOW SM, aggressive shorting
  DOGE: {
    bidEnabled: false,
    askEnabled: true,
    bidMultiplier: 0,
    askMultiplier: 1.8,      // Aggressive asks to build short
    maxInventoryUsd: 5000,   // Increased from 1500 for better capital utilization
    reason: 'SM shorts winning - FOLLOW SM, aggressive short'
  },
  // SUI: SM shorts winning - FOLLOW SM, aggressive shorting
  SUI: {
    bidEnabled: false,
    askEnabled: true,
    bidMultiplier: 0,
    askMultiplier: 1.8,      // Aggressive asks to build short
    maxInventoryUsd: 5000,   // Increased from 1500 for better capital utilization
    reason: 'SM shorts winning - FOLLOW SM, aggressive short'
  },
  // LIT: SM has $8.2M short @ $2.62, +$2.6M uPnL - FOLLOW SM aggressively
  LIT: {
    bidEnabled: false,
    askEnabled: true,
    bidMultiplier: 0,
    askMultiplier: 2.5,      // More aggressive asks to build short faster
    maxInventoryUsd: 2000,   // Doubled from $1000 per user request
    reason: 'SM $8.2M short +$2.6M uPnL, whale 0xa31211 adding - aggressive short'
  },
  // SOL: REMOVED OVERRIDE 2026-01-19 - After fixing whale_tracker signal_weight,
  // SOL is now BULLISH (weighted: $76M LONG vs $51M SHORT = 60% long bias)
  // Mega shorters (0x35d115, 0x06cecf) now have reduced signal_weight (0.35)
  // Let the dynamic system handle SOL based on real-time weighted SM data
  // SOL: { ... } // COMMENTED OUT - using dynamic system

}

function detectSMConflict(
  token: string,
  targetInventory: number,      // >0 = bot wants long, <0 = bot wants short
  smNetPositionUsd: number,     // >0 = SM is long, <0 = SM is short
  currentPrice?: number
): SMConflictAlert {
  const botSide: 'long' | 'short' | 'neutral' =
    targetInventory > 0.05 ? 'long' : targetInventory < -0.05 ? 'short' : 'neutral'
  const smSide: 'long' | 'short' | 'neutral' =
    smNetPositionUsd > 10000 ? 'long' : smNetPositionUsd < -10000 ? 'short' : 'neutral'

  // No conflict if aligned or neutral
  const isConflict = botSide !== 'neutral' && smSide !== 'neutral' && botSide !== smSide

  if (!isConflict) {
    return {
      token,
      botSide,
      smSide,
      smNetPositionUsd,
      conflictSeverity: 'NONE',
      recommendation: 'Aligned with SM or neutral - proceed normally',
      contrarian: {
        bidMultiplier: 1.0,
        askMultiplier: 1.0,
        maxInventoryMultiplier: 1.0
      }
    }
  }

  // Calculate severity based on SM position size
  const absSmPosition = Math.abs(smNetPositionUsd)
  let severity: SMConflictSeverity
  let recommendation: string
  let bidMult: number
  let askMult: number
  let invMult: number

  // CONTRARIAN STRATEGY: We're going AGAINST SM
  // - Smaller position sizes (reduced inventory)
  // - Wider spreads on the side we're accumulating
  // - Tighter spreads on the side we'd exit (to profit from squeeze)

  if (absSmPosition > 1_000_000) {
    severity = 'CRITICAL'
    recommendation = `🎲 CONTRARIAN CRITICAL: SM has $${(absSmPosition / 1e6).toFixed(1)}M ${smSide}. Playing squeeze with TINY size.`
    bidMult = botSide === 'long' ? 0.40 : 1.20   // Very far bids if accumulating long
    askMult = botSide === 'long' ? 1.20 : 0.40   // Wide asks to profit from spike
    invMult = 0.25  // Only 25% of normal inventory
  } else if (absSmPosition > 500_000) {
    severity = 'HIGH'
    recommendation = `🎲 CONTRARIAN HIGH: SM ${smSide} $${(absSmPosition / 1e3).toFixed(0)}k. Conservative squeeze play.`
    bidMult = botSide === 'long' ? 0.50 : 1.15
    askMult = botSide === 'long' ? 1.15 : 0.50
    invMult = 0.40
  } else if (absSmPosition > 100_000) {
    severity = 'MEDIUM'
    recommendation = `🎲 CONTRARIAN: SM ${smSide} $${(absSmPosition / 1e3).toFixed(0)}k. Moderate squeeze play.`
    bidMult = botSide === 'long' ? 0.65 : 1.08
    askMult = botSide === 'long' ? 1.08 : 0.65
    invMult = 0.60
  } else {
    severity = 'LOW'
    recommendation = 'Minor SM conflict - standard approach'
    bidMult = botSide === 'long' ? 0.80 : 1.05
    askMult = botSide === 'long' ? 1.05 : 0.80
    invMult = 0.80
  }

  // Calculate squeeze trigger and stop loss prices
  const config = CONTRARIAN_CONFIG[token]
  let squeezeTriggerPrice: number | undefined
  let stopLossPrice: number | undefined

  if (currentPrice && config) {
    if (botSide === 'long') {
      squeezeTriggerPrice = currentPrice * (1 + config.squeezeTriggerPct)
      stopLossPrice = currentPrice * (1 - config.stopLossPct)
    } else if (botSide === 'short') {
      squeezeTriggerPrice = currentPrice * (1 - config.squeezeTriggerPct)
      stopLossPrice = currentPrice * (1 + config.stopLossPct)
    }
  }

  return {
    token,
    botSide,
    smSide,
    smNetPositionUsd,
    conflictSeverity: severity,
    recommendation,
    contrarian: {
      bidMultiplier: bidMult,
      askMultiplier: askMult,
      maxInventoryMultiplier: invMult,
      squeezeTriggerPrice,
      stopLossPrice
    }
  }
}

export type DynamicConfigManagerOptions = {
  tokens: string[]
  dataPath?: string
  intervalMs?: number
  notifier?: ConsoleNotifier
  marketDataProvider?: (token: string) => Promise<HyperliquidMarketData | null>
  telemetryCollector?: TelemetryCollector
  alertManager?: AlertManager
}

const DEFAULT_TUNING: CoinTuning = {
  enabled: true,
  baseSpreadBps: 15,
  minSpreadBps: 10,
  maxSpreadBps: 40,
  smFlowSpreadMult: 1.0,
  smPositionSpreadMult: 1.0,
  baseOrderSizeUsd: 1000,      // Increased from 500
  maxPositionUsd: 25_000,      // Increased from 10_000 (for $16k account)
  smSignalSkew: 0,
  inventorySkewMult: 1.5,
  maxLeverage: 3,              // Increased from 1 (allow some leverage)
  stopLossPct: 0.05,
  bidSizeMultiplier: 1.0,
  askSizeMultiplier: 1.0,
  capitalMultiplier: 1.0,
  targetInventory: 0
}

/**
 * Dynamically adjusts NANSEN_TOKENS tuning parameters using smart_money_data.json
 */
export class DynamicConfigManager {
  private readonly tokens: string[]
  private readonly dataPaths: string[]
  private readonly intervalMs: number
  private readonly notifier: ConsoleNotifier
  private readonly baseTuning: Map<string, CoinTuning>
  private timer: NodeJS.Timeout | null = null
  private refreshing = false
  private readonly marketDataProvider?: (token: string) => Promise<HyperliquidMarketData | null>
  private readonly telemetryCollector?: TelemetryCollector
  private readonly alertManager?: AlertManager
  private readonly bottomDetector: BottomSignalDetector
  private lastBottomSignals: Map<string, BottomSignal> = new Map()
  private readonly validationTracker: SignalValidationTracker
  private readonly flowHistoryTracker: FlowHistoryTracker
  private readonly squeezePlayManager: SqueezePlayManager
  private readonly hlDataFetcher: HyperliquidDataFetcher
  private lastReversalSignals: Map<string, { type: ReversalType; timestamp: number }> = new Map()
  private lastSqueezeSignals: Map<string, SqueezePlaySignal> = new Map()
  private readonly alphaSignals: AlphaSignalAggregator
  private lastAlphaLog: number = 0
  private nansenBiasData: Record<string, NansenBiasEntry> = {}  // Contrarian logic from whale_tracker.py
  private nansenBiasLastLoad: number = 0

  constructor(options: DynamicConfigManagerOptions) {
    this.tokens = options.tokens
    const fallbackPaths = [
      options.dataPath,
      path.join(process.cwd(), 'runtime', 'smart_money_data.json'),
      path.join(process.cwd(), 'smart_money_data.json'),
      '/tmp/smart_money_data.json'
    ].filter((p): p is string => Boolean(p))
    this.dataPaths = Array.from(new Set(fallbackPaths))
    this.intervalMs = options.intervalMs ?? 5 * 60 * 1000
    this.notifier = options.notifier ?? new ConsoleNotifier()
    this.baseTuning = new Map()
    this.marketDataProvider = options.marketDataProvider
    this.telemetryCollector = options.telemetryCollector
    this.alertManager = options.alertManager

    // Initialize bottom signal detector
    this.bottomDetector = new BottomSignalDetector(this.dataPaths[this.dataPaths.length - 1] || '/tmp/smart_money_data.json')
    this.setupBottomDetectorEvents()

    // Initialize signal validation tracker
    this.validationTracker = getValidationTracker()

    // Initialize flow history tracker for sustained trend detection
    this.flowHistoryTracker = getFlowHistoryTracker()

    // Initialize squeeze play manager for aggressive squeeze longs
    this.squeezePlayManager = getSqueezePlayManager()

    // Initialize Hyperliquid data fetcher for OI history and price momentum
    this.hlDataFetcher = getHyperliquidDataFetcher()

    // Initialize Alpha Signal Aggregator (funding, cross-asset, time-of-day)
    this.alphaSignals = new AlphaSignalAggregator()

    for (const token of this.tokens) {
      const base = NANSEN_TOKENS[token]?.tuning
      this.baseTuning.set(token, base ? { ...base } : { ...DEFAULT_TUNING })
    }
  }

  private setupBottomDetectorEvents(): void {
    this.bottomDetector.on('bottom_detected', ({ token, signal, recommendation }) => {
      const msg = `🟢🟢🟢 [BOTTOM DETECTED] ${token} | ` +
        `Signal: ${signal.signalStrength}% | ` +
        `Bid×${recommendation.bidMultiplier.toFixed(2)} Max: $${recommendation.maxInventory}`
      this.notifier.warn(msg)

      // TELEGRAM ALERT for CONFIRMED_BOTTOM
      const telegramMsg = `🟢🟢🟢 <b>CONFIRMED BOTTOM: ${token}</b>\n\n` +
        `📊 Signal Strength: ${signal.signalStrength}%\n` +
        `💰 Price: $${signal.priceLevel.toFixed(6)}\n` +
        `🎯 Confidence: ${signal.confidence}\n\n` +
        `<b>Active Signals:</b>\n` +
        Object.entries(signal.signals)
          .filter(([_, detail]) => (detail as any).active)
          .map(([key, detail]) => `  ✅ ${(detail as any).description}`)
          .join('\n') +
        `\n\n<b>Recommendation:</b>\n` +
        `  Action: ${recommendation.action}\n` +
        `  Bid×${recommendation.bidMultiplier.toFixed(2)}\n` +
        `  Max Inventory: $${recommendation.maxInventory}\n\n` +
        `🚀 Emergency override RELAXED - starting to buy!`

      telegramBot.send(telegramMsg, 'warn').catch(err => {
        this.notifier.warn(`Failed to send Telegram alert: ${err}`)
      })
    })

    this.bottomDetector.on('bull_trap_warning', ({ token, signal }) => {
      this.notifier.warn(
        `⚠️🔺 [BULL TRAP WARNING] ${token} | ` +
        `SM shorts still winning - CAUTION`
      )
    })

    this.bottomDetector.on('alert', ({ type, token, message }) => {
      this.notifier.info(`[BottomSignal] ${token}: ${message}`)
    })
  }

  /**
   * Detect bottom signal for token using current market data
   */
  private detectBottomSignal(
    token: string,
    marketData: HyperliquidMarketData | null,
    entry: SmartMoneyEntry
  ): BottomSignal | null {
    // Only detect for tokens in the detector's list
    const detectTokens = ['DOGE', 'SUI', 'LIT']
    if (!detectTokens.includes(token)) {
      return null
    }

    const price = marketData?.markPrice ?? 0
    if (price <= 0) {
      return null
    }

    // Get funding rate for signal detection
    const fundingRate = marketData?.fundingRateAnnualized ?? 0
    const funding = {
      currentRate: fundingRate / 100 / 8760, // Convert annual % to 1h rate
      previousRate: fundingRate / 100 / 8760, // No history, use same
    }

    return this.bottomDetector.detect(token, price, funding)
  }

  /**
   * Get last bottom signal for token (exposed for telemetry)
   */
  getBottomSignal(token: string): BottomSignal | undefined {
    return this.lastBottomSignals.get(token)
  }

  /**
   * Get bottom detector status summary
   */
  getBottomDetectorStatus(): string {
    return this.bottomDetector.getStatus()
  }

  start(): void {
    if (this.timer || this.tokens.length === 0) {
      return
    }
    void this.refresh()
    this.timer = setInterval(() => {
      void this.refresh()
    }, this.intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getTrackedTokens(): string[] {
    return [...this.tokens]
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const file = await this.loadSmartMoneyFile()
      if (!file) return

      // Update SmAutoDetector cache BEFORE processing tokens
      // This allows deriveTuning to use auto-detected SM directions
      updateCacheFromSmData(file.data)

      // Load nansen_bias.json for Contrarian Logic (tradingMode from whale_tracker.py)
      this.loadNansenBiasData()

      for (const token of this.tokens) {
        const entry = file.data[token]
        if (!entry) continue
        await this.applyTuningForToken(token, entry)
      }

      // Update pending signal validations with current prices
      await this.updatePendingSignalValidations()
    } catch (err: any) {
      this.notifier.warn(`[DynamicConfig] refresh failed: ${err?.message || err}`)
    } finally {
      this.refreshing = false
    }
  }

  private async loadSmartMoneyFile(): Promise<SmartMoneyFile | null> {
    for (const candidate of this.dataPaths) {
      try {
        const raw = await fsp.readFile(candidate, 'utf8')
        const json = JSON.parse(raw)
        if (!json?.data || typeof json.data !== 'object') {
          continue
        }

        // Enrich with on-chain data if available
        const onChainData = loadOnChainDataFromFile(candidate)
        if (Object.keys(onChainData).length > 0) {
          for (const [token, entry] of Object.entries(json.data)) {
            if (onChainData[token]) {
              json.data[token] = mergeOnChainData(entry, onChainData[token])
            }
          }
          this.notifier.info(`[DynamicConfig] Enriched ${Object.keys(onChainData).length} tokens with on-chain data`)
        }

        return json as SmartMoneyFile
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          this.notifier.warn(`[DynamicConfig] Unable to read ${candidate}: ${err?.message || err}`)
        }
      }
    }
    return null
  }

  /**
   * Load nansen_bias.json for Contrarian Logic (tradingMode from whale_tracker.py)
   * This contains trading mode decisions based on SM positions AND uPnL status:
   * - FOLLOW_SM_LONG: SM is LONG and winning → go LONG
   * - FOLLOW_SM_SHORT: SM is SHORT and winning → go SHORT
   * - CONTRARIAN_LONG: SM is SHORT but underwater → potential squeeze, go LONG
   * - CONTRARIAN_SHORT: SM is LONG but underwater → reversal, go SHORT
   * - NEUTRAL: mixed signals
   */
  private loadNansenBiasData(): void {
    try {
      const now = Date.now()
      // Only reload every 30 seconds to avoid excessive file reads
      if (now - this.nansenBiasLastLoad < 30_000 && Object.keys(this.nansenBiasData).length > 0) {
        return
      }

      const biasData = readNansenBiasJson()
      if (biasData) {
        this.nansenBiasData = biasData
        this.nansenBiasLastLoad = now
        // Log contrarian signals
        for (const [token, entry] of Object.entries(biasData)) {
          if (entry.tradingMode && entry.tradingMode.startsWith('CONTRARIAN')) {
            console.log(
              `[Contrarian] ${token}: ${entry.tradingMode} (conf: ${entry.tradingModeConfidence}%) - ${entry.tradingModeReason}`
            )
          }
        }
      }
    } catch {
      // Silent fail - keep using cached data
    }
  }

  /**
   * Get trading mode for a token from nansen_bias.json
   * Returns the contrarian logic result from whale_tracker.py
   */
  getTradingModeForToken(token: string): {
    mode: NansenTradingMode
    confidence: number
    reason: string
    maxPositionMultiplier: number
    squeezeFailed?: boolean           // True if squeeze timeout exceeded (>12h)
    squeezeDurationHours?: number     // How long in CONTRARIAN mode
  } | null {
    const entry = this.nansenBiasData[token]
    if (!entry || !entry.tradingMode) {
      return null
    }
    return {
      mode: entry.tradingMode,
      confidence: entry.tradingModeConfidence ?? 50,
      reason: entry.tradingModeReason ?? 'No reason provided',
      maxPositionMultiplier: entry.maxPositionMultiplier ?? 1.0,
      squeezeFailed: entry.squeezeFailed,
      squeezeDurationHours: entry.squeezeDurationHours
    }
  }

  private async applyTuningForToken(token: string, entry: SmartMoneyEntry): Promise<void> {
    const base = this.baseTuning.get(token) ?? DEFAULT_TUNING
    const current = NANSEN_TOKENS[token]?.tuning ?? { ...base }

    const marketData = this.marketDataProvider ? await this.marketDataProvider(token) : null

    // Run bottom signal detection
    const bottomSignal = this.detectBottomSignal(token, marketData, entry)
    if (bottomSignal) {
      this.lastBottomSignals.set(token, bottomSignal)
    }

    // Record flow snapshot for sustained trend detection (every 5 min)
    this.flowHistoryTracker.recordSnapshot(token, {
      bias: typeof entry.bias === 'number' ? entry.bias : 0.5,
      longsUsd: entry.current_longs_usd ?? 0,
      shortsUsd: entry.current_shorts_usd ?? 0,
      longsCount: entry.longs_count ?? 0,
      shortsCount: entry.shorts_count ?? 0,
      longsUpnl: entry.longs_upnl ?? 0,
      shortsUpnl: entry.shorts_upnl ?? 0
    })

    const smSignal = generateSmartMoneySignal(token, entry)
    const next = this.deriveTuning(token, base, entry, marketData, bottomSignal, smSignal)
    const hasChanged = this.hasMeaningfulChange(current, next)
    if (!hasChanged) {
      return
    }

    NANSEN_TOKENS[token] = {
      ...(NANSEN_TOKENS[token] || { chain: 'hyperliquid', address: token }),
      tuning: next
    }

    const snapshot = this.buildSnapshot(token, entry, marketData, next)
    if (snapshot) {
      this.telemetryCollector?.recordSnapshot(snapshot)
      this.alertManager?.evaluateSnapshot(snapshot)
      this.telemetryCollector?.recordDiagnostics({
        timestamp: new Date(),
        token,
        event: 'CONFIG_UPDATE',
        level: 'INFO',
        message: 'Dynamic tuning applied',
        context: { baseSpread: next.baseSpreadBps, baseOrderSize: next.baseOrderSizeUsd }
      })
    }

    this.notifier.info(
      `[DynamicConfig] ${token} spread ${current.baseSpreadBps}→${next.baseSpreadBps}bps ` +
      `size bid×${(next.bidSizeMultiplier ?? 1).toFixed(2)} ask×${(next.askSizeMultiplier ?? 1).toFixed(2)} ` +
      `cap×${(next.capitalMultiplier ?? 1).toFixed(2)} inv=${(next.targetInventory ?? 0).toFixed(2)}`
    )
  }

  private deriveTuning(
    token: string,
    base: CoinTuning,
    entry: SmartMoneyEntry,
    marketData?: HyperliquidMarketData | null,
    bottomSignal?: BottomSignal | null,
    smSignal?: SmartMoneySignal
  ): CoinTuning {
    const biasRatio = this.clamp(typeof entry.bias === 'number' ? entry.bias : 0.5, 0, 1)
    const dominance = Math.abs(0.5 - biasRatio) // 0 .. 0.5
    const dominanceScale = dominance * 2 // 0..1
    const direction: BiasDirection =
      biasRatio < 0.48 ? 'SHORT' : biasRatio > 0.52 ? 'LONG' : 'NEUTRAL'
    const directionSign = direction === 'SHORT' ? 1 : direction === 'LONG' ? -1 : 0
    const signalDirection = smSignal?.direction ?? 'neutral'
    const signalLean = signalDirection === 'short' ? 1 : signalDirection === 'long' ? -1 : 0
    const signalConfidence = smSignal?.confidence ?? 0

    let baseSpread = base.baseSpreadBps ?? DEFAULT_TUNING.baseSpreadBps
    // Strong dominance → allow tighter quoting but increase risk buffers
    baseSpread -= Math.round((dominanceScale - 0.2) * 5) // e.g. dominance 0.4 => -1 spread

    // Trend-driven adjustments
    const trend = entry.trend || 'unknown'
    if (trend === 'increasing_shorts' && directionSign > 0) {
      baseSpread += 1 // shorts adding into trend -> widen slightly
    } else if (trend === 'increasing_longs' && directionSign < 0) {
      baseSpread += 1
    }

    // Large 7d flow swings widen spread
    const flowChange = entry.flow_change_7d ?? 0
    if (Math.abs(flowChange) > 3_000_000) {
      baseSpread += 2
    } else if (Math.abs(flowChange) > 1_000_000) {
      baseSpread += 1
    }

    const minSpread = Math.max(
      base.minSpreadBps ?? DEFAULT_TUNING.minSpreadBps,
      Math.round((baseSpread * 0.6))
    )
    const maxSpread = Math.max(
      base.maxSpreadBps ?? DEFAULT_TUNING.maxSpreadBps,
      minSpread + 10
    )

    baseSpread = this.clamp(Math.round(baseSpread), minSpread, maxSpread - 2)

    // Signal skew pushes inventory bias toward Smart Money direction
    const smSignalSkew = this.clamp(directionSign * dominanceScale * 0.8, -0.45, 0.45)
    const inventorySkewMult = this.clamp(
      (base.inventorySkewMult ?? DEFAULT_TUNING.inventorySkewMult) + dominanceScale * 0.8,
      1.2,
      3.0
    )

    // Spread multipliers increase when flows are aggressive
    const flowIntensity = Math.min(1.5, Math.abs(flowChange) / 2_000_000)
    const smFlowSpreadMult =
      Math.max(1.0, (base.smFlowSpreadMult ?? 1.0) + flowIntensity * 0.15)
    const smPositionSpreadMult =
      Math.max(1.0, (base.smPositionSpreadMult ?? 1.0) + dominanceScale * 0.2)

    const { bid: biasBidMult, ask: biasAskMult } = this.getBiasSizeMultipliers(biasRatio)
    const trendFactor = this.getTrendAggression(direction, flowChange, entry.trend)
    const squeezeAnalysis = this.getSqueezeAnalysis(direction, entry)
    const marketAdjust = this.calculateMarketAdjustments(marketData)
    const fundingAdjust = this.calculateFundingAdjustment(direction, marketData)
    const flowInventoryBias = this.getFlowInventoryBias(entry.flow)

    baseSpread *= marketAdjust.spreadMultiplier

    // Apply squeeze factor to capital
    const baseCapitalMult = trendFactor * squeezeAnalysis.capitalFactor * marketAdjust.capitalMultiplier
    const capitalMultiplier = this.clamp(baseCapitalMult, 0.25, 2.0)

    // Apply squeeze factors to bid/ask sizing (KEY CHANGE for squeeze protection)
    const bidSizeMultiplier = this.clamp(
      biasBidMult * fundingAdjust.bidMultiplier * marketAdjust.bidSizeMultiplier * squeezeAnalysis.bidFactor,
      0.2,
      2.5
    )
    const askSizeMultiplier = this.clamp(
      biasAskMult * fundingAdjust.askMultiplier * marketAdjust.askSizeMultiplier * squeezeAnalysis.askFactor,
      0.2,
      2.5
    )

    // Emit squeeze alert if risk detected
    if (squeezeAnalysis.isSqueezeRisk && squeezeAnalysis.riskLevel !== 'none') {
      const squeezeType = direction === 'SHORT' ? 'SHORT SQUEEZE' : 'LONG SQUEEZE'
      const severity = squeezeAnalysis.riskLevel === 'critical' ? 'CRITICAL' :
        squeezeAnalysis.riskLevel === 'high' ? 'HIGH' : 'WARNING'
      this.notifier.warn(
        `🔥 [${severity}] ${squeezeType} RISK on ${token} ` +
        `| Underwater: $${Math.abs(squeezeAnalysis.underwaterAmount / 1_000_000).toFixed(2)}M ` +
        `| Bid×${squeezeAnalysis.bidFactor.toFixed(2)} Ask×${squeezeAnalysis.askFactor.toFixed(2)} ` +
        `| SM: ${entry.signal || 'n/a'} | Dir: ${direction}`
      )
    }

    // Calculate preliminary target inventory
    let targetInventory = this.clamp(
      directionSign * dominanceScale * 0.6 + fundingAdjust.inventoryBias + flowInventoryBias,
      -0.6,
      0.6
    )
    if (smSignal && smSignal.type !== 'BLOCKED' && signalLean !== 0) {
      targetInventory = this.clamp(
        targetInventory + signalLean * signalConfidence * 0.4,
        -0.7,
        0.7
      )
    }

    // ============================================================
    // BIDIRECTIONAL SQUEEZE STRATEGY
    // SQUEEZE LONG: When SM has large shorts vulnerable → open LONGs
    // SQUEEZE SHORT: When SM has large longs vulnerable → open SHORTs
    // This is CONTRARIAN - we bet on positions getting liquidated
    // ============================================================
    let squeezePlaySignal: SqueezePlaySignal | null = null
    let squeezeShortSignal: SqueezePlaySignal | null = null
    let squeezePlayActive = false
    let squeezeShortActive = false

    if (marketData?.markPrice && this.squeezePlayManager.isEnabled()) {
      // Get real market data from HyperliquidDataFetcher (OI history + price momentum)
      // Use sync version - returns cached data and triggers background refresh if stale
      const hlSnapshot = this.hlDataFetcher.getMarketSnapshotSync(token)

      // Build market data for squeeze analysis - prefer real data from hlSnapshot
      const squeezeMarketData = {
        markPrice: marketData.markPrice,
        fundingRate: marketData.fundingRateAnnualized ? marketData.fundingRateAnnualized / 365 / 3 : undefined,
        volume24h: marketData.volume24h,
        avgVolume24h: marketData.volume24h ? marketData.volume24h * 0.8 : undefined,
        // ⭐ Use REAL price momentum from candles (not estimated!)
        priceChange1h: hlSnapshot?.momentum.change1h ?? (marketData.priceChangePct24h ? marketData.priceChangePct24h / 24 : undefined),
        priceChange24h: hlSnapshot?.momentum.change24h ?? marketData.priceChangePct24h,
        openInterest: marketData.openInterest,
        // ⭐ Use REAL OI change from history tracking (not SM-based estimate!)
        openInterestChange24h: hlSnapshot?.oi.change24h ?? 0
      }

      // Log divergence detection for debugging
      if (hlSnapshot?.divergence !== 'NEUTRAL' && hlSnapshot?.divergenceStrength && hlSnapshot.divergenceStrength >= 30) {
        const emoji = hlSnapshot.divergence === 'BULLISH' ? '🟢' : '🔴'
        this.notifier.warn(
          `${emoji} [OI DIVERGENCE] ${token} ${hlSnapshot.divergence} (${hlSnapshot.divergenceStrength}%) | ` +
          `Price 1h: ${hlSnapshot.momentum.change1h >= 0 ? '+' : ''}${hlSnapshot.momentum.change1h.toFixed(2)}% | ` +
          `OI 1h: ${hlSnapshot.oi.change1h >= 0 ? '+' : ''}${hlSnapshot.oi.change1h.toFixed(2)}%`
        )
      }

      // DEBUG: Log squeeze data every ~5 minutes for trading tokens
      const tradingTokens = ['SOL', 'DOGE', 'SUI', 'LIT']
      if (tradingTokens.includes(token) && Math.random() < 0.02) { // ~2% chance per iteration = every ~50 iterations
        const smData = entry
        this.notifier.info(
          `📊 [SQUEEZE DEBUG] ${token} | ` +
          `OI 1h: ${hlSnapshot?.oi.change1h?.toFixed(2) ?? 'N/A'}% | ` +
          `Price 1h: ${hlSnapshot?.momentum.change1h?.toFixed(2) ?? 'N/A'}% | ` +
          `Divergence: ${hlSnapshot?.divergence ?? 'N/A'} (${hlSnapshot?.divergenceStrength ?? 0}%) | ` +
          `SM Shorts: $${((smData.current_shorts_usd || 0) / 1e6).toFixed(2)}M | ` +
          `SM Longs: $${((smData.current_longs_usd || 0) / 1e6).toFixed(2)}M`
        )
      }

      // ============================================================
      // SQUEEZE LONG: Check exits and entries
      // ============================================================
      const longExitSignal = this.squeezePlayManager.checkExitSignals(token, marketData.markPrice, 'LONG')
      if (longExitSignal && longExitSignal.shouldExit) {
        squeezePlaySignal = longExitSignal
        this.lastSqueezeSignals.set(token, longExitSignal)

        const exitEmoji = longExitSignal.exitReason?.includes('TP') ? '💰' : '🛑'
        this.notifier.warn(
          `${exitEmoji} [SQUEEZE LONG EXIT] ${token} | ${longExitSignal.exitReason} | ` +
          `Size: $${longExitSignal.recommendedSizeUsd.toFixed(0)}`
        )

        const telegramMsg = `${exitEmoji} <b>SQUEEZE LONG ${longExitSignal.exitReason}: ${token}</b>\n\n` +
          `💵 Exit Size: $${longExitSignal.recommendedSizeUsd.toFixed(0)}\n` +
          `📊 Reason: ${longExitSignal.entryReasons[0] || longExitSignal.exitReason}\n\n` +
          longExitSignal.entryWarnings.map(w => `⚠️ ${w}`).join('\n')

        telegramBot.send(telegramMsg, longExitSignal.exitReason?.includes('STOP') ? 'warn' : 'info').catch(() => {})
      } else {
        // Check for LONG entry
        const longEntrySignal = this.squeezePlayManager.analyzeSqueezeOpportunity(token, entry, marketData.markPrice, squeezeMarketData)

        // DEBUG: Log LONG score for trading tokens (every ~5 iterations)
        if (tradingTokens.includes(token) && Math.random() < 0.2) {
          this.notifier.info(
            `🎰 [SQUEEZE LONG] ${token} | Score: ${longEntrySignal.entryScore}% | ` +
            `Enter: ${longEntrySignal.shouldEnter} | ` +
            `OI1h: ${squeezeMarketData.openInterestChange24h?.toFixed(1) ?? 'N/A'}% | ` +
            `Price1h: ${squeezeMarketData.priceChange1h?.toFixed(2) ?? 'N/A'}%`
          )
        }

        if (longEntrySignal.shouldEnter && longEntrySignal.entryScore >= 50) {
          squeezePlaySignal = longEntrySignal
          squeezePlayActive = true
          this.lastSqueezeSignals.set(token, longEntrySignal)

          const scoreEmoji = longEntrySignal.entryScore >= 80 ? '🎰🎰🎰' :
                            longEntrySignal.entryScore >= 65 ? '🎰🎰' : '🎰'
          this.notifier.warn(
            `${scoreEmoji} [SQUEEZE LONG] ${token} | Score: ${longEntrySignal.entryScore}% | ` +
            `SM Shorts: $${(longEntrySignal.smShortsUsd / 1e6).toFixed(1)}M | ` +
            `Shorts Profit: $${(longEntrySignal.smShortsProfit / 1e3).toFixed(0)}K | ` +
            `Recommended: $${longEntrySignal.recommendedSizeUsd.toFixed(0)} LONG | ` +
            `TP1: ${(longEntrySignal.tp1Price ?? 0).toFixed(4)} | SL: ${(longEntrySignal.stopLossPrice ?? 0).toFixed(4)}`
          )

          if (longEntrySignal.entryScore >= 60) {
            const telegramMsg = `${scoreEmoji} <b>SQUEEZE LONG OPPORTUNITY: ${token}</b>\n\n` +
              `📊 Score: ${longEntrySignal.entryScore}%\n` +
              `💰 SM Shorts: $${(longEntrySignal.smShortsUsd / 1e6).toFixed(1)}M\n` +
              `📈 Shorts Profit: $${(longEntrySignal.smShortsProfit / 1e3).toFixed(0)}K\n` +
              `🎯 L/S Ratio: ${longEntrySignal.smLongsRatio.toFixed(2)}\n\n` +
              `<b>Recommendation:</b>\n` +
              `  Size: $${longEntrySignal.recommendedSizeUsd.toFixed(0)} LONG\n` +
              `  Entry: $${(longEntrySignal.suggestedEntryPrice ?? 0).toFixed(4)}\n` +
              `  TP1: $${(longEntrySignal.tp1Price ?? 0).toFixed(4)}\n` +
              `  TP2: $${(longEntrySignal.tp2Price ?? 0).toFixed(4)}\n` +
              `  SL: $${(longEntrySignal.stopLossPrice ?? 0).toFixed(4)}\n\n` +
              `<b>Reasons:</b>\n` +
              longEntrySignal.entryReasons.map(r => `  ✅ ${r}`).join('\n') +
              (longEntrySignal.entryWarnings.length > 0 ? '\n\n<b>Warnings:</b>\n' +
                longEntrySignal.entryWarnings.map(w => `  ⚠️ ${w}`).join('\n') : '')

            telegramBot.send(telegramMsg, 'warn').catch(() => {})
          }
        }
      }

      // ============================================================
      // SQUEEZE SHORT: Check exits and entries
      // ============================================================
      const shortExitSignal = this.squeezePlayManager.checkExitSignals(token, marketData.markPrice, 'SHORT')
      if (shortExitSignal && shortExitSignal.shouldExit) {
        squeezeShortSignal = shortExitSignal
        this.lastSqueezeSignals.set(`${token}_SHORT`, shortExitSignal)

        const exitEmoji = shortExitSignal.exitReason?.includes('TP') ? '💰' : '🛑'
        this.notifier.warn(
          `${exitEmoji} [SQUEEZE SHORT EXIT] ${token} | ${shortExitSignal.exitReason} | ` +
          `Size: $${shortExitSignal.recommendedSizeUsd.toFixed(0)}`
        )

        const telegramMsg = `${exitEmoji} <b>SQUEEZE SHORT ${shortExitSignal.exitReason}: ${token}</b>\n\n` +
          `💵 Exit Size: $${shortExitSignal.recommendedSizeUsd.toFixed(0)}\n` +
          `📊 Reason: ${shortExitSignal.entryReasons[0] || shortExitSignal.exitReason}\n\n` +
          shortExitSignal.entryWarnings.map(w => `⚠️ ${w}`).join('\n')

        telegramBot.send(telegramMsg, shortExitSignal.exitReason?.includes('STOP') ? 'warn' : 'info').catch(() => {})
      } else {
        // Check for SHORT entry
        const shortEntrySignal = this.squeezePlayManager.analyzeSqueezeShortOpportunity(token, entry, marketData.markPrice, squeezeMarketData)

        // DEBUG: Log SHORT score for relevant tokens (every ~5 iterations)
        const shortTokens = ['SOL', 'ETH', 'XRP', 'HYPE']
        if (shortTokens.includes(token) && Math.random() < 0.2) {
          this.notifier.info(
            `🔻 [SQUEEZE SHORT] ${token} | Score: ${shortEntrySignal.entryScore}% | ` +
            `Enter: ${shortEntrySignal.shouldEnter} | ` +
            `OI1h: ${squeezeMarketData.openInterestChange24h?.toFixed(1) ?? 'N/A'}% | ` +
            `Price1h: ${squeezeMarketData.priceChange1h?.toFixed(2) ?? 'N/A'}%`
          )
        }

        if (shortEntrySignal.shouldEnter && shortEntrySignal.entryScore >= 50) {
          squeezeShortSignal = shortEntrySignal
          squeezeShortActive = true
          this.lastSqueezeSignals.set(`${token}_SHORT`, shortEntrySignal)

          const scoreEmoji = shortEntrySignal.entryScore >= 80 ? '🔻🔻🔻' :
                            shortEntrySignal.entryScore >= 65 ? '🔻🔻' : '🔻'
          this.notifier.warn(
            `${scoreEmoji} [SQUEEZE SHORT] ${token} | Score: ${shortEntrySignal.entryScore}% | ` +
            `SM Longs: $${(shortEntrySignal.smLongsUsd / 1e6).toFixed(1)}M | ` +
            `Longs Profit: $${(shortEntrySignal.smLongsProfit / 1e3).toFixed(0)}K | ` +
            `Recommended: $${shortEntrySignal.recommendedSizeUsd.toFixed(0)} SHORT | ` +
            `TP1: ${(shortEntrySignal.tp1Price ?? 0).toFixed(4)} | SL: ${(shortEntrySignal.stopLossPrice ?? 0).toFixed(4)}`
          )

          if (shortEntrySignal.entryScore >= 60) {
            const telegramMsg = `${scoreEmoji} <b>SQUEEZE SHORT OPPORTUNITY: ${token}</b>\n\n` +
              `📊 Score: ${shortEntrySignal.entryScore}%\n` +
              `💰 SM Longs: $${(shortEntrySignal.smLongsUsd / 1e6).toFixed(1)}M\n` +
              `📉 Longs Profit: $${(shortEntrySignal.smLongsProfit / 1e3).toFixed(0)}K\n` +
              `🎯 S/L Ratio: ${(1 - shortEntrySignal.smLongsRatio).toFixed(2)}\n\n` +
              `<b>Recommendation:</b>\n` +
              `  Size: $${shortEntrySignal.recommendedSizeUsd.toFixed(0)} SHORT\n` +
              `  Entry: $${(shortEntrySignal.suggestedEntryPrice ?? 0).toFixed(4)}\n` +
              `  TP1: $${(shortEntrySignal.tp1Price ?? 0).toFixed(4)}\n` +
              `  TP2: $${(shortEntrySignal.tp2Price ?? 0).toFixed(4)}\n` +
              `  SL: $${(shortEntrySignal.stopLossPrice ?? 0).toFixed(4)}\n\n` +
              `<b>Reasons:</b>\n` +
              shortEntrySignal.entryReasons.map(r => `  ✅ ${r}`).join('\n') +
              (shortEntrySignal.entryWarnings.length > 0 ? '\n\n<b>Warnings:</b>\n' +
                shortEntrySignal.entryWarnings.map(w => `  ⚠️ ${w}`).join('\n') : '')

            telegramBot.send(telegramMsg, 'warn').catch(() => {})
          }
        }
      }
    }

    // ============================================================
    // AUTOMATIC SM REVERSAL DETECTION (HIGHEST PRIORITY!)
    // Detects when SM is closing positions and auto-blocks new positions
    // This runs FIRST before any manual overrides
    // ============================================================
    const smReversal = detectSMReversal(token, entry)
    let reversalBidBlock = false
    let reversalAskBlock = false

    if (smReversal.type !== 'NONE') {
      // ============================================================
      // SUSTAINED TREND CHECK (v3.0 improvement)
      // Only confirm reversal if trend has been sustained for 2+ hours
      // ============================================================
      const sustainedCheck = this.flowHistoryTracker.shouldConfirmReversal(
        token,
        smReversal.type as 'SM_CLOSING_SHORTS' | 'SM_CLOSING_LONGS' | 'SM_BUILDING_SHORTS' | 'SM_BUILDING_LONGS'
      )
      const trendAnalysis = this.flowHistoryTracker.analyzeTrend(token)

      // Log reversal detection with sustained status
      const emoji = smReversal.type.includes('CLOSING') ? '🔄' : '📈'
      const sustainedEmoji = sustainedCheck.confirmed ? '✅' : '⏳'
      const alertLevel = smReversal.strength === 'EXTREME' ? '🚨🚨🚨' :
                         smReversal.strength === 'STRONG' ? '🚨🚨' : '⚠️'

      this.notifier.warn(
        `${alertLevel} [AUTO-REVERSAL] ${token} | ${smReversal.type} (${smReversal.strength}) ` +
        `| Conf: ${smReversal.confidence}% | Sustained: ${sustainedEmoji} ${trendAnalysis.sustainedHours.toFixed(1)}h ` +
        `| ${smReversal.action.reason}`
      )

      // Only apply reversal blocks if trend is SUSTAINED or signal is EXTREME
      const shouldApplyBlocks = sustainedCheck.confirmed || smReversal.strength === 'EXTREME'

      if (!shouldApplyBlocks) {
        this.notifier.info(
          `[REVERSAL] ${token} signal NOT confirmed: ${sustainedCheck.reason}. ` +
          `Waiting for sustained trend (${trendAnalysis.sustainedHours.toFixed(1)}h / ${getTokenThresholds(token).sustainedHoursRequired}h required)`
        )
      }

      // Send Telegram alert for STRONG and EXTREME reversals (only if sustained or EXTREME)
      if ((smReversal.strength === 'STRONG' || smReversal.strength === 'EXTREME') && shouldApplyBlocks) {
        const telegramMsg = `${alertLevel} <b>SM REVERSAL ${sustainedCheck.confirmed ? 'CONFIRMED' : 'EXTREME'}: ${token}</b>\n\n` +
          `📊 Type: ${smReversal.type}\n` +
          `💪 Strength: ${smReversal.strength}\n` +
          `🎯 Confidence: ${smReversal.confidence}%\n` +
          `⏱️ Sustained: ${trendAnalysis.sustainedHours.toFixed(1)}h (${trendAnalysis.consistency.toFixed(0)}% consistent)\n\n` +
          `<b>Metrics:</b>\n` +
          `  Closed positions: ${smReversal.metrics.closedPositions}\n` +
          `  USD change: $${(smReversal.metrics.positionUsdChange / 1e6).toFixed(2)}M\n` +
          `  Count change: ${smReversal.metrics.countChange}\n\n` +
          `<b>Action:</b>\n` +
          `  ${smReversal.action.reason}\n` +
          `  Bid×${smReversal.action.bidMultiplier.toFixed(2)} Ask×${smReversal.action.askMultiplier.toFixed(2)}`

        telegramBot.send(telegramMsg, 'warn').catch(() => { })
      }

      // Track which sides are blocked by reversal detection (only if sustained)
      if (shouldApplyBlocks) {
        reversalBidBlock = smReversal.action.blockNewLongs
        reversalAskBlock = smReversal.action.blockNewShorts
      }

      // Register signal with validation tracker (only if new signal, sustained, and has price)
      const lastSignal = this.lastReversalSignals.get(token)
      const now = Date.now()
      const isNewSignal = !lastSignal ||
        lastSignal.type !== smReversal.type ||
        (now - lastSignal.timestamp) > 4 * 60 * 60 * 1000  // 4 hours cooldown

      if (isNewSignal && shouldApplyBlocks && marketData?.markPrice) {
        const signalId = this.validationTracker.registerSignal(
          token,
          smReversal.type as any,
          smReversal.strength as any,
          smReversal.confidence,
          marketData.markPrice,
          {
            closedPositions: smReversal.metrics.closedPositions,
            positionUsdChange: smReversal.metrics.positionUsdChange,
            countChange: smReversal.metrics.countChange
          }
        )
        this.lastReversalSignals.set(token, { type: smReversal.type, timestamp: now })

        this.notifier.info(`[ValidationTracker] Registered SUSTAINED signal ${signalId} for ${token}`)
      }
    }

    // ============================================================
    // SM CONFLICT DETECTION (CONTRARIAN SQUEEZE PLAY)
    // Now enhanced with uPnL-based tradingMode from whale_tracker.py!
    // ============================================================
    const smLongsUsd = entry.current_longs_usd ?? 0
    const smShortsUsd = entry.current_shorts_usd ?? 0
    const smNetPositionUsd = smLongsUsd - smShortsUsd  // >0 = SM net long, <0 = SM net short

    const currentPrice = marketData?.markPrice
    const smConflict = detectSMConflict(token, targetInventory, smNetPositionUsd, currentPrice)

    // NEW: Get tradingMode from whale_tracker.py Contrarian Logic
    const tradingModeInfo = this.getTradingModeForToken(token)
    const tradingMode = tradingModeInfo?.mode ?? 'NEUTRAL'
    const tradingModeConfidence = tradingModeInfo?.confidence ?? 50
    const tradingModeMaxPosMult = tradingModeInfo?.maxPositionMultiplier ?? 1.0

    // ============================================================
    // MULTIPLIER STATE - Central priority-based multiplier management
    // ============================================================
    let finalCapitalMult = capitalMultiplier
    let followSmMode: 'FOLLOW_SM_SHORT' | 'FOLLOW_SM_LONG' | null = null  // Track FOLLOW SM mode

    // Initialize multiplier state with base values
    let multState = createInitialMultiplierState(
      bidSizeMultiplier,
      askSizeMultiplier,
      base.maxPositionUsd ?? DEFAULT_TUNING.maxPositionUsd,
      targetInventory
    )

    // ============================================================
    // APPLY REVERSAL BLOCKS FIRST (REVERSAL priority)
    // ============================================================
    if (smReversal.type !== 'NONE') {
      // Adjust target inventory based on reversal type
      let reversalTargetInventory = targetInventory
      if (smReversal.type === 'SM_CLOSING_SHORTS') {
        reversalTargetInventory = Math.min(targetInventory, 0)  // Don't go short
      } else if (smReversal.type === 'SM_CLOSING_LONGS') {
        reversalTargetInventory = Math.max(targetInventory, 0)  // Don't go long
      } else if (smReversal.type === 'SM_BUILDING_SHORTS') {
        reversalTargetInventory = Math.max(targetInventory, 0.2)  // Lean short
      } else if (smReversal.type === 'SM_BUILDING_LONGS') {
        reversalTargetInventory = Math.min(targetInventory, -0.2)  // Lean long
      }

      // Apply reversal with proper priority
      if (reversalBidBlock || reversalAskBlock) {
        multState = applyMultiplier(multState, {
          bidMultiplier: reversalBidBlock ? smReversal.action.bidMultiplier : multState.bidMultiplier,
          askMultiplier: reversalAskBlock ? smReversal.action.askMultiplier : multState.askMultiplier,
          targetInventory: reversalTargetInventory,
          priority: StrategyPriority.REVERSAL,
          bidLocked: reversalBidBlock && smReversal.action.bidMultiplier === 0,
          askLocked: reversalAskBlock && smReversal.action.askMultiplier === 0,
          source: 'REVERSAL',
          reason: smReversal.action.reason
        })
      }
    }

    // ============================================================
    // FOLLOW SM from whale_tracker.py tradingMode (NEW - prioritizes PnL-based signals!)
    // This handles FOLLOW_SM_LONG/SHORT from nansen_bias.json BEFORE contrarian check
    // Catches cases like SOL where position ratio is neutral but PnL ratio is dominant
    // ============================================================
    const isFollowSmMode = tradingMode === 'FOLLOW_SM_LONG' || tradingMode === 'FOLLOW_SM_SHORT'

    if (isFollowSmMode && tradingModeConfidence >= 60) {
      // Apply FOLLOW SM from whale_tracker.py tradingMode
      const followDirection = tradingMode === 'FOLLOW_SM_SHORT' ? 'SHORT' : 'LONG'
      const followBid = followDirection === 'SHORT' ? 0 : 2.0       // No bids if SHORT, aggressive if LONG
      const followAsk = followDirection === 'SHORT' ? 2.0 : 0       // Aggressive asks if SHORT, no asks if LONG
      const followTargetInv = followDirection === 'SHORT' ? -0.3 : 0.3  // Lean with SM

      // Use maxPositionMultiplier from tradingMode (1.0 for FOLLOW modes)
      const followMaxPos = multState.maxPosition * tradingModeMaxPosMult

      // Apply with FOLLOW_SM priority (same as EMERGENCY)
      multState = applyMultiplier(multState, {
        bidMultiplier: followBid,
        askMultiplier: followAsk,
        maxPosition: followMaxPos,
        targetInventory: followTargetInv,
        priority: StrategyPriority.FOLLOW_SM,  // Higher than CONTRARIAN
        bidLocked: followDirection === 'SHORT',   // Lock bids if shorting
        askLocked: followDirection === 'LONG',    // Lock asks if longing
        source: `NANSEN_${tradingMode}`,
        reason: `[NANSEN] ${tradingModeInfo?.reason} [conf:${tradingModeConfidence}%]`
      })

      // Track FOLLOW SM mode
      followSmMode = tradingMode as 'FOLLOW_SM_SHORT' | 'FOLLOW_SM_LONG'

      this.notifier.warn(
        `🛑 [FOLLOW SM] ${token} | ${tradingModeInfo?.reason} ` +
        `| Bid×${followBid.toFixed(2)} Ask×${followAsk.toFixed(2)} MaxPos: $${followMaxPos.toFixed(0)} Target: ${(followTargetInv * 100).toFixed(0)}% ` +
        `| 🔒 BidLocked: ${multState.bidLocked} AskLocked: ${multState.askLocked} ` +
        `| 🤖 NANSEN: ${tradingMode}`
      )
    }

    // ============================================================
    // CONTRARIAN SQUEEZE PLAY (CONTRARIAN priority - lower than REVERSAL & FOLLOW_SM)
    // Enhanced with uPnL-based tradingMode from whale_tracker.py!
    //
    // NEW LOGIC:
    // - CONTRARIAN_LONG: SM is SHORT but underwater → squeeze potential, go LONG with TINY size
    // - CONTRARIAN_SHORT: SM is LONG but underwater → reversal potential, go SHORT with TINY size
    // - FOLLOW_SM_*: Already handled above with higher priority
    // ============================================================
    const isContrarianMode = tradingMode === 'CONTRARIAN_LONG' || tradingMode === 'CONTRARIAN_SHORT'

    // ============================================================
    // SQUEEZE TIMEOUT PROTECTION - Force exit if squeeze didn't materialize
    // When squeezeFailed=true (>12h in CONTRARIAN without squeeze), exit position
    // ============================================================
    if (tradingModeInfo?.squeezeFailed) {
      const squeezeDuration = tradingModeInfo.squeezeDurationHours ?? 0
      this.notifier.warn(
        `⏰ [SQUEEZE TIMEOUT] ${token} | CONTRARIAN mode for ${squeezeDuration.toFixed(1)}h without squeeze - FORCING EXIT!`
      )

      // Force exit: set maxPosition to 0 and block new entries
      multState = applyMultiplier(multState, {
        bidMultiplier: 0,       // No new buys
        askMultiplier: 0,       // No new sells
        maxPosition: 0,         // Force exit all positions
        targetInventory: 0,     // Flatten to neutral
        bidLocked: true,
        askLocked: true,
        priority: StrategyPriority.EMERGENCY,  // Highest priority
        source: 'SQUEEZE_TIMEOUT',
        reason: `⏰ SQUEEZE TIMEOUT: ${squeezeDuration.toFixed(1)}h in CONTRARIAN - squeeze failed, exiting!`
      })

      // Skip remaining contrarian logic - we're exiting
      // The bot will sell/buy to flatten position
    }

    // Skip contrarian section if already applied FOLLOW_SM from nansen (conf >= 60)
    const alreadyAppliedFollowSm = isFollowSmMode && tradingModeConfidence >= 60
    if ((smConflict.conflictSeverity !== 'NONE' || isContrarianMode) && !alreadyAppliedFollowSm && !tradingModeInfo?.squeezeFailed) {
      // Calculate contrarian multipliers
      const contrarianBid = this.clamp(
        bidSizeMultiplier * smConflict.contrarian.bidMultiplier,
        0.2,
        2.5
      )
      const contrarianAsk = this.clamp(
        askSizeMultiplier * smConflict.contrarian.askMultiplier,
        0.2,
        2.5
      )
      finalCapitalMult = this.clamp(
        capitalMultiplier * smConflict.contrarian.maxInventoryMultiplier,
        0.15,
        2.0
      )

      // Apply contrarian max inventory from config
      let contrarianMaxPos = multState.maxPosition
      const contrarianConfig = CONTRARIAN_CONFIG[token]
      if (contrarianConfig) {
        contrarianMaxPos = Math.min(contrarianMaxPos, contrarianConfig.maxInventoryUsd)
      }

      // NEW: Apply maxPositionMultiplier from whale_tracker.py tradingMode
      // CONTRARIAN modes use 0.25x (25%) of normal position size
      if (isContrarianMode) {
        contrarianMaxPos = Math.min(contrarianMaxPos, multState.maxPosition * tradingModeMaxPosMult)
      }

      // Set target inventory based on contrarian direction
      let contrarianTargetInv = multState.targetInventory
      if (tradingMode === 'CONTRARIAN_LONG') {
        contrarianTargetInv = Math.min(targetInventory, -0.3)  // Lean LONG (negative = long bias)
      } else if (tradingMode === 'CONTRARIAN_SHORT') {
        contrarianTargetInv = Math.max(targetInventory, 0.3)   // Lean SHORT (positive = short bias)
      }

      // Additional defensive clamp for LIT during CRITICAL conflicts
      // 2026-01-19: Increased cap from $500 to $1500 to allow meaningful orders
      let litBid = contrarianBid
      let litAsk = contrarianAsk
      let litTargetInv = contrarianTargetInv
      if (token === 'LIT' && smConflict.conflictSeverity === 'CRITICAL') {
        litBid = Math.min(contrarianBid, 0.3) // slightly bigger bids
        litAsk = Math.max(contrarianAsk, 1.2)
        contrarianMaxPos = Math.min(contrarianMaxPos, 3000)  // INCREASED from 1500 for better capital utilization
        litTargetInv = 0 // stay flat, no deepening long
        this.notifier.warn(
          `🚫 [CONTRARIAN] LIT critical SM conflict - forcing defensive mode (max $3000 inventory, targetInventory=0)`
        )
      }

      // Build reason string with tradingMode info
      const reason = isContrarianMode
        ? `${tradingModeInfo?.reason || smConflict.recommendation} [${tradingMode} conf:${tradingModeConfidence}%]`
        : smConflict.recommendation

      // Apply CONTRARIAN with proper priority (lower than REVERSAL and EMERGENCY)
      multState = applyMultiplier(multState, {
        bidMultiplier: token === 'LIT' && smConflict.conflictSeverity === 'CRITICAL' ? litBid : contrarianBid,
        askMultiplier: token === 'LIT' && smConflict.conflictSeverity === 'CRITICAL' ? litAsk : contrarianAsk,
        maxPosition: contrarianMaxPos,
        targetInventory: token === 'LIT' && smConflict.conflictSeverity === 'CRITICAL' ? litTargetInv : contrarianTargetInv,
        priority: StrategyPriority.CONTRARIAN,
        source: isContrarianMode ? `CONTRARIAN_${tradingMode}` : 'CONTRARIAN',
        reason
      })

      // Log contrarian alert with tradingMode info
      this.notifier.warn(
        `🎲 [CONTRARIAN] ${token} | ${reason} ` +
        `| Final Bid×${multState.bidMultiplier.toFixed(2)} Ask×${multState.askMultiplier.toFixed(2)} ` +
        `| MaxPos: $${multState.maxPosition.toFixed(0)} (${(tradingModeMaxPosMult * 100).toFixed(0)}% of normal)` +
        `| TargetInv: ${contrarianTargetInv.toFixed(2)} ` +
        `| SqueezeTrigger: ${smConflict.contrarian.squeezeTriggerPrice ? '$' + smConflict.contrarian.squeezeTriggerPrice.toFixed(4) : 'n/a'} ` +
        `| StopLoss: ${smConflict.contrarian.stopLossPrice ? '$' + smConflict.contrarian.stopLossPrice.toFixed(4) : 'n/a'}`
      )
    }

    // ============================================================
    // EMERGENCY OVERRIDE / FOLLOW SM (EMERGENCY priority - HIGHEST!)
    // Now using AUTO-DETECTION from SmAutoDetector!
    // Falls back to hardcoded EMERGENCY_OVERRIDES if auto-detection unavailable
    // ============================================================
    let emergencyOverride = EMERGENCY_OVERRIDES[token]  // Fallback
    let emergencyOverrideApplied = false
    let autoDetectedMode: MmMode | undefined

    // Try auto-detection first (SYNC - uses cached data)
    // Cache is populated by updateCacheFromSmData in refresh()
    const autoOverride = getAutoEmergencyOverrideSync(token)
    if (autoOverride) {
      // Use auto-detected override instead of hardcoded!
      emergencyOverride = {
        bidEnabled: autoOverride.bidEnabled,
        askEnabled: autoOverride.askEnabled,
        bidMultiplier: autoOverride.bidMultiplier,
        askMultiplier: autoOverride.askMultiplier,
        maxInventoryUsd: autoOverride.maxInventoryUsd,
        reason: `[AUTO] ${autoOverride.reason}`
      }
      autoDetectedMode = autoOverride.mode
      console.log(`🤖 [AUTO-DETECT] ${token}: ${autoOverride.mode} (conviction: ${(autoOverride.convictionScore * 100).toFixed(0)}%)`)
    }

    if (emergencyOverride) {
      // Determine multipliers - EMERGENCY uses override values directly!
      // For SHORT mode: bid=0, ask=override (aggressive selling)
      // For LONG mode: bid=override (aggressive buying), ask=0
      const emergencyBid = !emergencyOverride.bidEnabled ? 0 : emergencyOverride.bidMultiplier
      const emergencyAsk = !emergencyOverride.askEnabled ? 0 : emergencyOverride.askMultiplier

      // Set inventory target based on direction
      let emergencyTargetInventory = 0
      if (!emergencyOverride.bidEnabled && emergencyOverride.askEnabled) {
        emergencyTargetInventory = -0.3  // Follow SM SHORT
        followSmMode = 'FOLLOW_SM_SHORT'
      } else if (emergencyOverride.bidEnabled && !emergencyOverride.askEnabled) {
        emergencyTargetInventory = 0.3   // Follow SM LONG
        followSmMode = 'FOLLOW_SM_LONG'
      }

      // Apply with EMERGENCY priority (cannot be overridden!)
      multState = applyMultiplier(multState, {
        bidMultiplier: emergencyBid,
        askMultiplier: emergencyAsk,
        maxPosition: emergencyOverride.maxInventoryUsd,
        targetInventory: emergencyTargetInventory,
        priority: StrategyPriority.EMERGENCY,
        bidLocked: !emergencyOverride.bidEnabled,  // Lock bid if disabled
        askLocked: !emergencyOverride.askEnabled,  // Lock ask if disabled
        source: autoDetectedMode ? `AUTO_${autoDetectedMode}` : 'FOLLOW_SM',
        reason: emergencyOverride.reason
      })

      emergencyOverrideApplied = true

      this.notifier.warn(
        `🛑 [FOLLOW SM] ${token} | ${emergencyOverride.reason} | ` +
        `Bid×${multState.bidMultiplier.toFixed(2)} Ask×${multState.askMultiplier.toFixed(2)} ` +
        `MaxPos: $${multState.maxPosition} Target: ${(multState.targetInventory * 100).toFixed(0)}% ` +
        `| 🔒 BidLocked: ${multState.bidLocked} AskLocked: ${multState.askLocked}` +
        (autoDetectedMode ? ` | 🤖 AUTO: ${autoDetectedMode}` : '')
      )
    }

    // ============================================================
    // BOTTOM SIGNAL DETECTION - Can relax emergency overrides!
    // When a confirmed bottom is detected, gradually allow buying
    // ============================================================
    let bottomSignalType: BottomSignalType = 'NO_SIGNAL'
    let bottomSignalStrength = 0

    if (bottomSignal) {
      bottomSignalType = bottomSignal.signalType
      bottomSignalStrength = bottomSignal.signalStrength

      // CONFIRMED_BOTTOM: Override emergency, start buying again
      if (bottomSignal.signalType === 'CONFIRMED_BOTTOM' && emergencyOverrideApplied) {
        const rec = bottomSignal.recommendation
        const bottomBid = rec.bidMultiplier
        const bottomMaxPos = Math.max(multState.maxPosition, rec.maxInventory)

        // CONFIRMED_BOTTOM is special - it CAN override EMERGENCY (unlocks bid)
        multState = {
          ...multState,
          bidMultiplier: bottomBid,
          maxPosition: bottomMaxPos,
          targetInventory: -0.2,  // Lean slightly long to start buying
          bidLocked: false,       // Unlock bid!
          priority: StrategyPriority.BOTTOM_SIGNAL,
          source: 'BOTTOM_OVERRIDE',
          reason: 'Confirmed bottom - relaxing emergency override'
        }

        this.notifier.warn(
          `🟢🟢🟢 [BOTTOM OVERRIDE] ${token} | CONFIRMED BOTTOM detected! ` +
          `| Strength: ${bottomSignal.signalStrength}% | ` +
          `Bid×${multState.bidMultiplier.toFixed(2)} MaxPos: $${multState.maxPosition} | ` +
          `EMERGENCY OVERRIDE RELAXED - starting to buy!`
        )

        // Send Telegram alert for confirmed bottom override
        const telegramMsg = `🟢🟢🟢 <b>BOTTOM OVERRIDE: ${token}</b>\n\n` +
          `📊 Signal Strength: ${bottomSignal.signalStrength}%\n` +
          `💰 Price: $${bottomSignal.priceLevel.toFixed(6)}\n` +
          `🎯 Confidence: ${bottomSignal.confidence}\n\n` +
          `<b>Config Applied:</b>\n` +
          `  Bid×${multState.bidMultiplier.toFixed(2)}\n` +
          `  Max Position: $${multState.maxPosition}\n` +
          `  Target Inventory: ${multState.targetInventory.toFixed(2)}\n\n` +
          `🚀 <b>EMERGENCY OVERRIDE RELAXED</b>\n` +
          `Bot will start buying cautiously!`

        telegramBot.send(telegramMsg, 'warn').catch(() => { })
      }

      // POTENTIAL_BOTTOM: Partially relax emergency
      else if (bottomSignal.signalType === 'POTENTIAL_BOTTOM' && emergencyOverrideApplied) {
        const rec = bottomSignal.recommendation
        // Only partially relax - use half of recommendation (but respect lock)
        const newBid = Math.min(multState.bidMultiplier + rec.bidMultiplier * 0.5, 0.3)
        const newMaxPos = Math.max(multState.maxPosition, rec.maxInventory * 0.5)

        // Partial relaxation - don't fully unlock
        multState = adjustMultiplier(multState, {
          bidFactor: newBid / Math.max(multState.bidMultiplier, 0.01),
          bidClamp: { min: 0, max: 0.3 }
        }, 'POTENTIAL_BOTTOM')
        multState.maxPosition = newMaxPos

        this.notifier.warn(
          `🟢 [BOTTOM SIGNAL] ${token} | POTENTIAL BOTTOM detected! ` +
          `| Strength: ${bottomSignal.signalStrength}% | ` +
          `Bid×${multState.bidMultiplier.toFixed(2)} | Cautiously increasing bids`
        )

        // Telegram heads-up for potential bottom
        const telegramMsg = `🟢 <b>POTENTIAL BOTTOM: ${token}</b>\n\n` +
          `📊 Signal Strength: ${bottomSignal.signalStrength}%\n` +
          `💰 Price: $${bottomSignal.priceLevel.toFixed(6)}\n` +
          `🎯 Confidence: ${bottomSignal.confidence}\n\n` +
          `<b>Early Signs:</b>\n` +
          Object.entries(bottomSignal.signals)
            .filter(([_, detail]) => (detail as any).active)
            .map(([key, detail]) => `  ✅ ${(detail as any).description}`)
            .join('\n') +
          `\n\n⏳ Watching for confirmation...`

        telegramBot.send(telegramMsg, 'info').catch(() => { })
      }

      // ACCUMULATION_ZONE: Very cautious buying
      else if (bottomSignal.signalType === 'ACCUMULATION_ZONE' && emergencyOverrideApplied) {
        const rec = bottomSignal.recommendation
        // Minimal relaxation (respect lock via adjustMultiplier)
        multState = adjustMultiplier(multState, {
          bidFactor: 1 + rec.bidMultiplier * 0.3,
          bidClamp: { min: 0, max: 0.15 }
        }, 'ACCUMULATION')

        this.notifier.info(
          `📊 [ACCUMULATION] ${token} | SM accumulating | ` +
          `Bid×${multState.bidMultiplier.toFixed(2)} | Testing small bids`
        )
      }

      // BULL_TRAP: Reinforce emergency override! (EMERGENCY priority)
      else if (bottomSignal.signalType === 'BULL_TRAP') {
        multState = applyMultiplier(multState, {
          bidMultiplier: 0,
          maxPosition: Math.min(multState.maxPosition, 200),
          targetInventory: 0.1,  // Slight short bias
          priority: StrategyPriority.EMERGENCY,
          bidLocked: true,
          source: 'BULL_TRAP',
          reason: 'Fake bounce detected - SM shorts still winning'
        })

        this.notifier.warn(
          `⚠️🔺 [BULL TRAP] ${token} | Fake bounce detected! ` +
          `SM shorts still winning | Bid×0 | DO NOT BUY!`
        )
      }

      // DEAD_CAT_BOUNCE: Stay out completely (EMERGENCY priority)
      else if (bottomSignal.signalType === 'DEAD_CAT_BOUNCE') {
        multState = applyMultiplier(multState, {
          bidMultiplier: 0,
          maxPosition: 0,
          targetInventory: 0,
          priority: StrategyPriority.EMERGENCY,
          bidLocked: true,
          source: 'DEAD_CAT',
          reason: 'Dead cat bounce - no buying, no positions'
        })

        this.notifier.warn(
          `🔻 [DEAD CAT] ${token} | Dead cat bounce detected! ` +
          `No buying, no positions`
        )
      }
    }

    // ============================================================
    // SM SIGNAL ADJUSTMENTS (respects bidLocked)
    // ============================================================
    if (smSignal) {
      if (smSignal.type === 'BLOCKED') {
        multState = adjustMultiplier(multState, {
          bidFactor: 0.7,
          askFactor: 0.7,
          bidClamp: { min: 0.1, max: 2.5 },
          askClamp: { min: 0.1, max: 2.5 }
        }, 'SM_SIGNAL_BLOCKED')
        finalCapitalMult = Math.min(finalCapitalMult, 0.4)
      } else {
        if (signalLean > 0) {
          multState = adjustMultiplier(multState, {
            bidFactor: 1 - 0.5 * signalConfidence,
            askFactor: 1 + 0.35 * signalConfidence,
            bidClamp: { min: 0.1, max: 2.5 },
            askClamp: { min: 0.2, max: 2.5 }
          }, 'SM_SIGNAL_SHORT')
        } else if (signalLean < 0) {
          multState = adjustMultiplier(multState, {
            bidFactor: 1 + 0.35 * signalConfidence,
            askFactor: 1 - 0.5 * signalConfidence,
            bidClamp: { min: 0.2, max: 2.5 },
            askClamp: { min: 0.1, max: 2.5 }
          }, 'SM_SIGNAL_LONG')
        } else {
          multState = adjustMultiplier(multState, {
            bidFactor: 1 + signalConfidence * 0.1,
            askFactor: 1 + signalConfidence * 0.1,
            bidClamp: { min: 0.2, max: 2.5 },
            askClamp: { min: 0.2, max: 2.5 }
          }, 'SM_SIGNAL_NEUTRAL')
        }
        finalCapitalMult = this.clamp(finalCapitalMult * (0.85 + signalConfidence * 0.5), 0.2, 2.0)
      }
    }

    // ============================================================
    // NANSEN ALERT ADJUSTMENTS (On-chain flow alerts from Telegram)
    // Uses adjustMultiplier - respects bidLocked/askLocked
    // ============================================================
    const nansenAlert = getNansenAlertAdjustments(token)
    if (nansenAlert) {
      multState = adjustMultiplier(multState, {
        bidFactor: nansenAlert.bidMultiplier,
        askFactor: nansenAlert.askMultiplier,
        bidClamp: { min: 0.1, max: 2.5 },
        askClamp: { min: 0.1, max: 2.5 }
      }, 'NANSEN_ALERT')

      finalCapitalMult = this.clamp(finalCapitalMult * nansenAlert.capitalMultiplier, 0.15, 2.0)
      multState.maxPosition = this.clamp(
        multState.maxPosition * nansenAlert.maxInventoryMultiplier,
        100,
        base.maxPositionUsd ?? DEFAULT_TUNING.maxPositionUsd
      )
      multState.targetInventory = this.clamp(
        multState.targetInventory + nansenAlert.targetInventoryBias,
        -0.7,
        0.7
      )

      this.notifier.warn(
        `🔔 [NANSEN ALERT] ${token} | ${nansenAlert.reason} | ` +
        `Bid×${multState.bidLocked ? '0 (LOCKED)' : nansenAlert.bidMultiplier.toFixed(2)} Ask×${nansenAlert.askMultiplier.toFixed(2)} ` +
        `TargetInv: ${nansenAlert.targetInventoryBias > 0 ? '+' : ''}${nansenAlert.targetInventoryBias.toFixed(2)}`
      )
    }

    // ============================================================
    // AGGRESSIVE SQUEEZE LONG BID BOOST
    // Uses adjustMultiplier - respects bidLocked
    // ============================================================
    if (squeezePlayActive && squeezePlaySignal) {
      const scoreBoost = squeezePlaySignal.entryScore >= 80 ? 2.0 :
                         squeezePlaySignal.entryScore >= 65 ? 1.5 : 1.25

      multState = adjustMultiplier(multState, {
        bidFactor: scoreBoost,
        askFactor: 0.7,
        bidClamp: { min: 0.5, max: 3.0 },
        askClamp: { min: 0.2, max: 2.0 }
      }, 'SQUEEZE_LONG_BOOST')

      // Bias inventory toward long
      multState.targetInventory = this.clamp(multState.targetInventory - 0.3, -0.7, 0.2)

      this.notifier.info(
        `🎰 [SQUEEZE LONG BOOST] ${token} | Score: ${squeezePlaySignal.entryScore}% | ` +
        `Bid×${scoreBoost.toFixed(2)} → ${multState.bidMultiplier.toFixed(2)} | ` +
        `Target: ${multState.targetInventory.toFixed(2)} (long bias) | Locked: ${multState.bidLocked}`
      )
    }

    // ============================================================
    // AGGRESSIVE SQUEEZE SHORT ASK BOOST
    // Uses adjustMultiplier - respects askLocked and bidLocked
    // ============================================================
    if (squeezeShortActive && squeezeShortSignal) {
      const scoreBoost = squeezeShortSignal.entryScore >= 80 ? 2.0 :
                         squeezeShortSignal.entryScore >= 65 ? 1.5 : 1.25

      multState = adjustMultiplier(multState, {
        bidFactor: 0.7,
        askFactor: scoreBoost,
        bidClamp: { min: 0.2, max: 2.0 },
        askClamp: { min: 0.5, max: 3.0 }
      }, 'SQUEEZE_SHORT_BOOST')

      // Bias inventory toward short
      multState.targetInventory = this.clamp(multState.targetInventory + 0.3, -0.2, 0.7)

      this.notifier.info(
        `🔻 [SQUEEZE SHORT BOOST] ${token} | Score: ${squeezeShortSignal.entryScore}% | ` +
        `Ask×${scoreBoost.toFixed(2)} → ${multState.askMultiplier.toFixed(2)} | ` +
        `Target: ${multState.targetInventory.toFixed(2)} (short bias) | BidLocked: ${multState.bidLocked}`
      )
    }

    // ============================================================
    // CHART PAINTER - S/R, Trendlines, Signal Zones
    // Uses adjustMultiplier - respects bidLocked/askLocked
    // ============================================================
    let chartState: ChartState | null = null
    const chartPainter = getChartPainter()

    // Update chart in background for trading tokens (trigger every ~5 minutes)
    const chartTradingTokens = ['SOL', 'DOGE', 'SUI', 'LIT']
    if (chartTradingTokens.includes(token)) {
      // Get sync state (may be slightly stale but fast)
      chartState = chartPainter.getChartStateSync(token)

      // Trigger async update periodically (fire and forget)
      const lastChartUpdate = chartState?.lastUpdate ?? 0
      const chartAge = Date.now() - lastChartUpdate
      if (chartAge > 5 * 60 * 1000) {
        chartPainter.updateChart(token).catch(err =>
          console.warn(`[ChartPainter] Failed to update ${token}:`, err)
        )
      }

      // Apply chart-based adjustments if we have state
      if (chartState && chartState.lastUpdate > 0) {
        const chartBidBoost = chartState.bidBoost
        const chartAskBoost = chartState.askBoost
        const chartSpreadAdj = chartState.spreadAdjust

        // Apply multipliers using adjustMultiplier (respects locks!)
        multState = adjustMultiplier(multState, {
          bidFactor: chartBidBoost,
          askFactor: chartAskBoost,
          bidClamp: { min: 0.1, max: 3.0 },
          askClamp: { min: 0.1, max: 3.0 }
        }, 'CHART_PAINTER')

        // Adjust spread (note: baseSpread was set earlier, we modify it here)
        baseSpread = this.clamp(baseSpread + chartSpreadAdj, minSpread, maxSpread - 2)

        // Log chart analysis (10% of iterations)
        if (Math.random() < 0.1) {
          const pos = chartState.pricePosition
          const trend = chartState.activeTrend
          const supDist = chartState.supportDistance.toFixed(1)
          const resDist = chartState.resistanceDistance.toFixed(1)

          this.notifier.info(
            `🎨 [CHART] ${token} | ${pos} | Trend: ${trend} | ` +
            `S/R: ${supDist}%/${resDist}% | ` +
            `Bid×${chartBidBoost.toFixed(2)} Ask×${chartAskBoost.toFixed(2)} Spread: ${chartSpreadAdj > 0 ? '+' : ''}${chartSpreadAdj}bp`
          )
        }
      }
    }

    // ============================================================
    // ALPHA SIGNALS - Funding Rate, Cross-Asset, Time-of-Day
    // Applied AFTER all strategy signals, uses adjustMultiplier to respect locks
    // ============================================================
    const alphaPrice = marketData?.markPrice ?? 0
    const alphaFunding = marketData?.fundingRateAnnualized ?? 0

    // Update reference prices for cross-asset correlation (BTC, ETH, SOL)
    if (['BTC', 'ETH', 'SOL'].includes(token) && alphaPrice > 0) {
      this.alphaSignals.updateReferencePrices({ [token]: alphaPrice })
    }

    // Get combined alpha signal
    const alphaSignal = this.alphaSignals.analyze(token, alphaPrice, alphaFunding)

    // Apply alpha adjustments (respects priority locks)
    if (alphaSignal.dominantSignal !== 'NONE') {
      multState = adjustMultiplier(multState, {
        bidFactor: alphaSignal.finalBidMultiplier,
        askFactor: alphaSignal.finalAskMultiplier,
        bidClamp: { min: 0.1, max: 3.0 },
        askClamp: { min: 0.1, max: 3.0 }
      }, `ALPHA_${alphaSignal.dominantSignal}`)

      // Adjust spread based on alpha signals
      baseSpread *= alphaSignal.finalSpreadMultiplier

      // Adjust target inventory for funding bias
      if (alphaSignal.funding && Math.abs(alphaSignal.funding.inventoryBias) > 0.05) {
        multState.targetInventory = this.clamp(
          multState.targetInventory + alphaSignal.funding.inventoryBias,
          -0.7,
          0.7
        )
      }

      // Log alpha signal (throttled - max once per minute per token)
      const now = Date.now()
      if (now - this.lastAlphaLog > 60000) {
        this.lastAlphaLog = now
        const reasons = alphaSignal.reasons.slice(0, 2).join(' | ')
        this.notifier.info(
          `📈 [ALPHA] ${token} | ${alphaSignal.dominantSignal} | ` +
          `Bid×${alphaSignal.finalBidMultiplier.toFixed(2)} Ask×${alphaSignal.finalAskMultiplier.toFixed(2)} ` +
          `Spread×${alphaSignal.finalSpreadMultiplier.toFixed(2)} | ${reasons}`
        )
      }
    }

    const baseOrderSource = base.baseOrderSizeUsd ?? DEFAULT_TUNING.baseOrderSizeUsd
    const baseOrderSizeUsd = this.clamp(
      baseOrderSource * finalCapitalMult,
      50,
      multState.maxPosition
    )

    return {
      ...base,
      enabled: true,
      baseSpreadBps: baseSpread,
      minSpreadBps: minSpread,
      maxSpreadBps: maxSpread,
      smFlowSpreadMult,
      smPositionSpreadMult,
      smSignalSkew,
      inventorySkewMult,
      baseOrderSizeUsd,
      maxPositionUsd: multState.maxPosition,
      maxLeverage: base.maxLeverage ?? DEFAULT_TUNING.maxLeverage,
      stopLossPct: base.stopLossPct ?? DEFAULT_TUNING.stopLossPct,
      bidSizeMultiplier: multState.bidMultiplier,
      askSizeMultiplier: multState.askMultiplier,
      capitalMultiplier: finalCapitalMult,
      targetInventory: multState.targetInventory,
      // Contrarian squeeze play fields (for mm_hl.ts to use)
      squeezeTriggerPrice: smConflict.contrarian.squeezeTriggerPrice,
      stopLossPrice: smConflict.contrarian.stopLossPrice,
      smConflictSeverity: smConflict.conflictSeverity,
      smSignalType: smSignal?.type,
      smSignalConfidence: smSignal?.confidence,
      smSignalDirection: smSignal?.direction,
      smSignalReasons: smSignal?.reasons,
      smSignalWarnings: smSignal?.warnings,
      // Bottom signal detection fields
      bottomSignalType,
      bottomSignalStrength,
      // SM Reversal detection fields (auto-detected)
      smReversalType: smReversal.type,
      smReversalStrength: smReversal.strength,
      smReversalConfidence: smReversal.confidence,
      smReversalReason: smReversal.action.reason,
      // On-chain divergence data
      onChainDivergence: smSignal?.onChainDivergence,
      // Aggressive squeeze LONG play fields
      squeezePlayActive,
      squeezePlayScore: squeezePlaySignal?.entryScore ?? 0,
      squeezePlayRecommendedSize: squeezePlaySignal?.recommendedSizeUsd ?? 0,
      squeezePlayTp1: squeezePlaySignal?.tp1Price,
      squeezePlayTp2: squeezePlaySignal?.tp2Price,
      squeezePlayTp3: squeezePlaySignal?.tp3Price,
      squeezePlayStopLoss: squeezePlaySignal?.stopLossPrice,
      squeezePlayReasons: squeezePlaySignal?.entryReasons ?? [],
      squeezePlayWarnings: squeezePlaySignal?.entryWarnings ?? [],
      // Aggressive squeeze SHORT play fields
      squeezeShortActive,
      squeezeShortScore: squeezeShortSignal?.entryScore ?? 0,
      squeezeShortRecommendedSize: squeezeShortSignal?.recommendedSizeUsd ?? 0,
      squeezeShortTp1: squeezeShortSignal?.tp1Price,
      squeezeShortTp2: squeezeShortSignal?.tp2Price,
      squeezeShortTp3: squeezeShortSignal?.tp3Price,
      squeezeShortStopLoss: squeezeShortSignal?.stopLossPrice,
      squeezeShortReasons: squeezeShortSignal?.entryReasons ?? [],
      squeezeShortWarnings: squeezeShortSignal?.entryWarnings ?? [],
      // ChartPainter fields
      chartPricePosition: chartState?.pricePosition ?? 'MID_RANGE',
      chartActiveTrend: chartState?.activeTrend ?? 'SIDEWAYS',
      chartSupportDistance: chartState?.supportDistance ?? 999,
      chartResistanceDistance: chartState?.resistanceDistance ?? 999,
      chartBidBoost: chartState?.bidBoost ?? 1.0,
      chartAskBoost: chartState?.askBoost ?? 1.0,
      chartSpreadAdjust: chartState?.spreadAdjust ?? 0,
      // FOLLOW SM mode - allows grid_manager to bypass skew locks
      followSmMode,
      // Alpha Signals (Funding, Cross-Asset, Time-of-Day)
      alphaDominantSignal: alphaSignal.dominantSignal,
      alphaFundingAction: alphaSignal.funding?.action ?? 'NEUTRAL',
      alphaFundingLevel: alphaSignal.funding?.extremeLevel ?? 'NORMAL',
      alphaCrossAssetRef: alphaSignal.crossAsset?.referenceToken,
      alphaCrossAssetMove: alphaSignal.crossAsset?.referenceMove,
      alphaTimeOfDaySession: alphaSignal.timeOfDay.session,
      alphaTimeOfDayVolatility: alphaSignal.timeOfDay.expectedVolatility,
    } as CoinTuning
  }

  private hasMeaningfulChange(current: CoinTuning, next: CoinTuning): boolean {
    return (
      Math.abs(current.baseSpreadBps - next.baseSpreadBps) >= 1 ||
      Math.abs(current.minSpreadBps - next.minSpreadBps) >= 1 ||
      Math.abs(current.maxSpreadBps - next.maxSpreadBps) >= 1 ||
      Math.abs(current.smSignalSkew - next.smSignalSkew) >= 0.05 ||
      Math.abs(current.inventorySkewMult - next.inventorySkewMult) >= 0.1 ||
      Math.abs((current.bidSizeMultiplier ?? 1) - (next.bidSizeMultiplier ?? 1)) >= 0.1 ||
      Math.abs((current.askSizeMultiplier ?? 1) - (next.askSizeMultiplier ?? 1)) >= 0.1 ||
      Math.abs((current.capitalMultiplier ?? 1) - (next.capitalMultiplier ?? 1)) >= 0.1 ||
      Math.abs(current.baseOrderSizeUsd - next.baseOrderSizeUsd) >= 50
    )
  }

  private getBiasSizeMultipliers(biasRatio: number): { bid: number; ask: number } {
    if (biasRatio <= 0.1) return { bid: 0.4, ask: 1.6 }
    if (biasRatio <= 0.2) return { bid: 0.6, ask: 1.4 }
    if (biasRatio <= 0.4) return { bid: 0.8, ask: 1.2 }
    if (biasRatio <= 0.6) return { bid: 1.0, ask: 1.0 }
    if (biasRatio <= 0.8) return { bid: 1.2, ask: 0.8 }
    if (biasRatio <= 0.9) return { bid: 1.4, ask: 0.6 }
    return { bid: 1.6, ask: 0.4 }
  }

  private getTrendAggression(direction: BiasDirection, flowChange: number, trend?: string): number {
    let factor = 1.0
    if (direction === 'SHORT') {
      if (flowChange > 500_000) factor *= 0.6 // Shorts closing
      else if (flowChange < -500_000) factor *= 1.15 // Shorts adding
      if (trend === 'increasing_shorts') factor *= 1.1
      if (trend === 'increasing_longs') factor *= 0.8
    } else if (direction === 'LONG') {
      if (flowChange < -500_000) factor *= 0.6 // Longs closing
      else if (flowChange > 500_000) factor *= 1.15
      if (trend === 'increasing_longs') factor *= 1.1
      if (trend === 'increasing_shorts') factor *= 0.8
    } else {
      if (Math.abs(flowChange) > 1_000_000) {
        factor *= 1.1
      }
    }
    if (trend && trend.toLowerCase().includes('pivot')) {
      factor *= 1.2
    }
    return this.clamp(factor, 0.3, 1.5)
  }

  /**
   * Enhanced squeeze detection with separate bid/ask adjustments and alert flags
   */
  private getSqueezeFactor(direction: BiasDirection, entry: SmartMoneyEntry): number {
    const { capitalFactor } = this.getSqueezeAnalysis(direction, entry)
    return capitalFactor
  }

  private getSqueezeAnalysis(direction: BiasDirection, entry: SmartMoneyEntry): {
    capitalFactor: number
    bidFactor: number
    askFactor: number
    isSqueezeRisk: boolean
    riskLevel: 'none' | 'moderate' | 'high' | 'critical'
    underwaterAmount: number
  } {
    const longsUpnl = entry.longs_upnl ?? 0
    const shortsUpnl = entry.shorts_upnl ?? 0
    let capitalFactor = 1.0
    let bidFactor = 1.0
    let askFactor = 1.0
    let isSqueezeRisk = false
    let riskLevel: 'none' | 'moderate' | 'high' | 'critical' = 'none'
    let underwaterAmount = 0

    if (direction === 'SHORT') {
      underwaterAmount = Math.min(0, shortsUpnl)

      // Shorts underwater = potential SHORT SQUEEZE
      if (shortsUpnl < -1_500_000) {
        capitalFactor *= 0.35
        bidFactor *= 0.50    // ↓↓ Very conservative bids (don't accumulate into squeeze)
        askFactor *= 1.10    // ↑ Slightly wider asks (profit from volatility)
        isSqueezeRisk = true
        riskLevel = 'critical'
      } else if (shortsUpnl < -1_000_000) {
        capitalFactor *= 0.5
        bidFactor *= 0.60    // ↓ Conservative bids
        askFactor *= 1.05
        isSqueezeRisk = true
        riskLevel = 'high'
      } else if (shortsUpnl < -500_000) {
        capitalFactor *= 0.6
        bidFactor *= 0.75    // ↓ Moderate bid reduction
        isSqueezeRisk = true
        riskLevel = 'moderate'
      } else if (shortsUpnl > 400_000) {
        capitalFactor *= 1.1  // Shorts winning, more confidence
        bidFactor *= 1.1
      }

      // Additional factor if longs are winning (shorts getting squeezed)
      if (entry.top_traders_pnl === 'longs_winning') {
        capitalFactor *= 0.85
        bidFactor *= 0.85
        if (!isSqueezeRisk) {
          isSqueezeRisk = true
          riskLevel = 'moderate'
        }
      }
    } else if (direction === 'LONG') {
      underwaterAmount = Math.min(0, longsUpnl)

      // Longs underwater = potential LONG SQUEEZE (dump)
      if (longsUpnl < -1_500_000) {
        capitalFactor *= 0.4
        askFactor *= 0.50    // ↓↓ Very conservative asks
        bidFactor *= 1.10    // ↑ Slightly aggressive bids (buy the dip)
        isSqueezeRisk = true
        riskLevel = 'critical'
      } else if (longsUpnl < -1_000_000) {
        capitalFactor *= 0.5
        askFactor *= 0.60
        isSqueezeRisk = true
        riskLevel = 'high'
      } else if (longsUpnl < -500_000) {
        capitalFactor *= 0.6
        askFactor *= 0.75
        isSqueezeRisk = true
        riskLevel = 'moderate'
      } else if (longsUpnl > 400_000) {
        capitalFactor *= 1.1
        askFactor *= 1.1
      }

      if (entry.top_traders_pnl === 'shorts_winning') {
        capitalFactor *= 0.85
        askFactor *= 0.85
        if (!isSqueezeRisk) {
          isSqueezeRisk = true
          riskLevel = 'moderate'
        }
      }
    }

    return {
      capitalFactor: this.clamp(capitalFactor, 0.3, 1.4),
      bidFactor: this.clamp(bidFactor, 0.4, 1.3),
      askFactor: this.clamp(askFactor, 0.4, 1.3),
      isSqueezeRisk,
      riskLevel,
      underwaterAmount
    }
  }

  private calculateMarketAdjustments(marketData?: HyperliquidMarketData | null) {
    if (!marketData) {
      return { spreadMultiplier: 1.0, capitalMultiplier: 1.0, bidSizeMultiplier: 1.0, askSizeMultiplier: 1.0 }
    }
    const pctMove = Math.abs(marketData.priceChangePct24h || 0)
    let spreadMult = 1.0
    let capitalMult = 1.0
    let bidMult = 1.0
    let askMult = 1.0
    if (pctMove > 10) {
      spreadMult *= 2.5
      capitalMult *= 0.4
      bidMult *= 0.6
      askMult *= 0.6
    } else if (pctMove > 5) {
      spreadMult *= 1.8
      capitalMult *= 0.6
      bidMult *= 0.7
      askMult *= 0.7
    } else if (pctMove > 3) {
      spreadMult *= 1.4
      capitalMult *= 0.75
    } else if (pctMove < 1) {
      spreadMult *= 0.95
      capitalMult *= 1.1
    }

    const volToOi = marketData.volumeToOiRatio || 0
    if (volToOi > 1.5) {
      capitalMult *= 1.15
    } else if (volToOi < 0.5) {
      capitalMult *= 0.85
    }

    return {
      spreadMultiplier: this.clamp(spreadMult, 0.6, 3.0),
      capitalMultiplier: this.clamp(capitalMult, 0.25, 2.0),
      bidSizeMultiplier: this.clamp(bidMult, 0.2, 1.5),
      askSizeMultiplier: this.clamp(askMult, 0.2, 1.5)
    }
  }

  private calculateFundingAdjustment(direction: BiasDirection, marketData?: HyperliquidMarketData | null) {
    const funding = marketData?.fundingRateAnnualized ?? 0
    let inventoryBias = 0
    let bidMultiplier = 1.0
    let askMultiplier = 1.0
    if (funding < -20) {
      // shorts paid -> lean short
      inventoryBias += 0.1
      askMultiplier *= 1.1
    } else if (funding > 20) {
      inventoryBias -= 0.1
      bidMultiplier *= 1.1
    }
    if (direction === 'SHORT' && funding < -40) {
      inventoryBias += 0.05
    }
    if (direction === 'LONG' && funding > 40) {
      inventoryBias -= 0.05
    }
    return { inventoryBias, bidMultiplier, askMultiplier }
  }

  private getFlowInventoryBias(flow?: number): number {
    if (!flow) return 0
    if (flow > 2_000_000) return -0.1
    if (flow > 500_000) return -0.05
    if (flow < -2_000_000) return 0.1
    if (flow < -500_000) return 0.05
    return 0
  }

  private buildSnapshot(
    token: string,
    entry: SmartMoneyEntry,
    marketData: HyperliquidMarketData | null,
    tuning: CoinTuning
  ) {
    if (!this.telemetryCollector && !this.alertManager) return null
    const conflict = detectSMConflict(
      token,
      tuning.targetInventory ?? 0,
      (entry.current_longs_usd ?? 0) - (entry.current_shorts_usd ?? 0),
      marketData?.markPrice
    )
    const signalTags: string[] = []
    if (tuning.smSignalType) {
      signalTags.push(
        `SM:${tuning.smSignalType}:${Math.round((tuning.smSignalConfidence ?? 0) * 100)}%`
      )
    }
    if (tuning.bottomSignalType && tuning.bottomSignalType !== 'NO_SIGNAL') {
      signalTags.push(`BOTTOM:${tuning.bottomSignalType}`)
    }

    const snapshot = {
      timestamp: new Date(),
      token,
      smartMoney: {
        totalLongsUsd: entry.current_longs_usd ?? 0,
        totalShortsUsd: entry.current_shorts_usd ?? 0,
        biasRatio: typeof entry.bias === 'number' ? entry.bias : 0.5,
        netPositionUsd: (entry.current_longs_usd ?? 0) - (entry.current_shorts_usd ?? 0),
        numLongTraders: entry.momentum ?? 0,
        numShortTraders: entry.velocity ?? 0,
        topWhaleAddress: entry.signal,
        topWhalePositionUsd: entry.flow_change_7d,
        topWhaleUnrealizedPnl: entry.shorts_upnl ?? 0,
        concentrationRisk: entry.trend_strength === 'strong' ? 0.9 : entry.trend_strength === 'moderate' ? 0.7 : 0.4
      },
      flow: {
        balanceChange7d: entry.flow_change_7d ?? 0,
        trend: entry.trend,
        isPivot: entry.trend === 'pivot'
      },
      market: {
        markPrice: marketData?.markPrice,
        priceChangePct24h: marketData?.priceChangePct24h,
        volume24h: marketData?.volume24h,
        openInterest: marketData?.openInterest,
        fundingRateAnnualized: marketData?.fundingRateAnnualized
      },
      bot: {
        currentInventory: 0,
        targetInventory: tuning.targetInventory ?? 0,
        capitalMultiplier: tuning.capitalMultiplier ?? 1
      },
      config: {
        baseSpreadBps: tuning.baseSpreadBps,
        minSpreadBps: tuning.minSpreadBps,
        maxSpreadBps: tuning.maxSpreadBps,
        baseOrderSizeUsd: tuning.baseOrderSizeUsd,
        bidSizeMultiplier: tuning.bidSizeMultiplier ?? 1,
        askSizeMultiplier: tuning.askSizeMultiplier ?? 1
      },
      smSignal: tuning.smSignalType
        ? {
          type: tuning.smSignalType,
          direction: tuning.smSignalDirection ?? 'neutral',
          confidence: tuning.smSignalConfidence ?? 0,
          netPositionUsd: (entry.current_longs_usd ?? 0) - (entry.current_shorts_usd ?? 0),
          reasons: tuning.smSignalReasons ?? [],
          warnings: tuning.smSignalWarnings ?? []
        }
        : undefined,
      signals: signalTags,
      contrarian:
        conflict.conflictSeverity !== 'NONE'
          ? {
            severity: conflict.conflictSeverity,
            smNetPositionUsd: conflict.smNetPositionUsd,
            botSide: conflict.botSide,
            smSide: conflict.smSide,
            squeezeTriggerPrice: conflict.contrarian.squeezeTriggerPrice,
            stopLossPrice: conflict.contrarian.stopLossPrice
          }
          : undefined
    } as const
    return snapshot
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
  }

  // ============================================================
  // SIGNAL VALIDATION TRACKER PUBLIC METHODS
  // ============================================================

  /**
   * Update pending signals with current prices
   * Called during refresh cycle to track price movements after signals
   */
  async updatePendingSignalValidations(): Promise<void> {
    const priceMap: Record<string, number> = {}

    for (const token of this.tokens) {
      if (this.marketDataProvider) {
        const marketData = await this.marketDataProvider(token)
        if (marketData?.markPrice) {
          priceMap[token] = marketData.markPrice
        }
      }
    }

    if (Object.keys(priceMap).length > 0) {
      this.validationTracker.updateAllPendingSignals(priceMap)
    }
  }

  /**
   * Get validation report for signals
   */
  getValidationReport(): string {
    return this.validationTracker.getReportString()
  }

  /**
   * Get validation tracker instance (for external access)
   */
  getValidationTracker(): SignalValidationTracker {
    return this.validationTracker
  }

  /**
   * Log validation report to console and optionally send to Telegram
   */
  async logValidationReport(sendTelegram: boolean = false): Promise<void> {
    const report = this.validationTracker.generateReport()
    const reportString = this.validationTracker.getReportString()

    this.notifier.info(reportString)

    if (sendTelegram && report.validatedSignals > 0) {
      const telegramMsg = `📊 <b>SIGNAL VALIDATION REPORT</b>\n\n` +
        `📈 Total Signals: ${report.totalSignals}\n` +
        `✅ Validated (24h+): ${report.validatedSignals}\n` +
        `🎯 Correct: ${report.correctSignals24h}\n` +
        `📊 Accuracy: ${report.accuracy24h.toFixed(1)}%\n\n` +
        `<b>By Type:</b>\n` +
        Object.entries(report.byType)
          .map(([type, stats]) => `  ${type}: ${stats.accuracy24h.toFixed(0)}% (${stats.correct24h}/${stats.validated})`)
          .join('\n') +
        `\n\n<b>Suggestions:</b>\n` +
        Object.entries(report.thresholdSuggestions)
          .filter(([_, s]) => s.suggestion !== 'OK')
          .map(([token, s]) => `  ${s.suggestion === 'INCREASE' ? '⬆️' : '⬇️'} ${token}: ${s.reason}`)
          .join('\n')

      await telegramBot.send(telegramMsg, 'info').catch(() => { })
    }
  }

  // ============================================
  // SQUEEZE PLAY MANAGER ACCESS
  // ============================================

  /**
   * Get the squeeze play manager instance
   */
  getSqueezePlayManager(): SqueezePlayManager {
    return this.squeezePlayManager
  }

  /**
   * Get squeeze play status string
   */
  getSqueezePlayStatus(): string {
    return this.squeezePlayManager.getStatus()
  }

  /**
   * Enable/disable aggressive squeeze plays
   */
  setSqueezePlayEnabled(enabled: boolean): void {
    this.squeezePlayManager.setEnabled(enabled)
    this.notifier.warn(`🎰 Squeeze play ${enabled ? 'ENABLED' : 'DISABLED'}`)
  }

  /**
   * Get last squeeze signal for a token
   */
  getLastSqueezeSignal(token: string): SqueezePlaySignal | undefined {
    return this.lastSqueezeSignals.get(token)
  }
}


