/**
 * AlphaExtractionEngine.ts - Main orchestration layer for Smart Money tracking
 *
 * Combines:
 * 1. NansenFeed - Real-time SM position data
 * 2. SmartMoneyAnalyzer - Core trading mode analysis
 * 3. TradeSequenceDetector - Front-running pattern detection
 * 4. SignalAggregator - Final trading command generation
 */

import { EventEmitter } from 'events'
import {
  NansenFeed,
  type AccountState,
  type Position,
  type AggregatedCoinData,
  type NansenBiasOutput,
  type SmartMoneyData,
  WHALES,
  TRACKED_COINS,
} from './data/NansenFeed.js'
import {
  determineTradingMode,
  detectPerpsSpotDivergence,
  calculateMomentumPenalty,
  getSmDirection,
  getPnlDirection,
  type TradingModeInput,
  type TradingModeResult,
} from './logic/SmartMoneyAnalyzer.js'
import type { NansenTradingMode, NansenTrend } from '../mm/nansen_bias_cache.js'

// ============================================================
// TYPES & INTERFACES
// ============================================================

/** Types of detected trade sequences */
export type SequenceType =
  | 'WHALE_CLOSING_POSITION'      // Whale closing entire position
  | 'WHALE_REDUCING_SIZE'         // Whale reducing position >50%
  | 'WHALE_FLIPPING_DIRECTION'    // Whale switching from long to short or vice versa
  | 'MULTI_WHALE_SAME_MOVE'       // 3+ whales making same move within timeframe
  | 'LARGE_POSITION_OPENED'       // New large position opened by conviction trader
  | 'CONVICTION_TRADER_EXIT'      // High-tier trader exiting completely
  | 'FUND_REBALANCE'              // Institutional fund making large rebalance

/** Urgency levels for trading commands */
export type Urgency = 'IMMEDIATE' | 'HIGH' | 'NORMAL' | 'LOW'

/** Detected trade sequence */
export interface TradeSequence {
  type: SequenceType
  coin: string
  whaleAddress: string
  whaleName: string
  details: {
    previousSize?: number
    newSize?: number
    previousSide?: 'Long' | 'Short'
    newSide?: 'Long' | 'Short' | null
    changeUsd?: number
    changePct?: number
    unrealizedPnl?: number
  }
  timestamp: Date
  signalStrength: number  // 0-100
  suggestedAction: 'FOLLOW' | 'FADE' | 'WATCH'
}

/** Final trading command from SignalAggregator */
export interface TradingCommand {
  coin: string
  action: 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE_LONG' | 'CLOSE_SHORT' | 'REDUCE_LONG' | 'REDUCE_SHORT' | 'HOLD' | 'BLOCKED'
  urgency: Urgency
  confidence: number
  maxPositionMultiplier: number
  reason: string
  sources: {
    tradingMode?: TradingModeResult
    sequence?: TradeSequence
  }
  bypassDelay: boolean  // If true, execute immediately without standard delays
  timestamp: Date
}

/** Position snapshot for change detection */
interface PositionSnapshot {
  coin: string
  side: 'Long' | 'Short'
  size: number
  positionValue: number
  unrealizedPnl: number
  timestamp: Date
}

/** Historical position data per whale */
interface WhaleHistory {
  address: string
  lastPositions: Map<string, PositionSnapshot>
  lastUpdate: Date
}

// ============================================================
// TRADE SEQUENCE DETECTOR
// ============================================================

/**
 * TradeSequenceDetector - Detects actionable trading patterns in real-time
 *
 * FRONT-RUNNING SCENARIOS:
 * 1. Whale closing position → They know something, follow immediately
 * 2. Whale flipping direction → Strong reversal signal
 * 3. Multiple whales same move → Coordinated or consensus signal
 * 4. Conviction trader exit → High-tier trader exiting = alarm
 */
export class TradeSequenceDetector {
  private whaleHistory: Map<string, WhaleHistory> = new Map()

  // Thresholds for sequence detection
  private readonly THRESHOLDS = {
    /** Minimum position change to detect (USD) */
    MIN_CHANGE_USD: 100000,
    /** Percentage change to count as "reducing" */
    REDUCING_PCT: 50,
    /** Number of whales for "multi-whale" signal */
    MULTI_WHALE_COUNT: 3,
    /** Time window for multi-whale detection (ms) */
    MULTI_WHALE_WINDOW_MS: 5 * 60 * 1000, // 5 minutes
    /** Minimum signal weight for conviction trader */
    CONVICTION_WEIGHT: 0.85,
    /** Minimum position value for "large position" */
    LARGE_POSITION_USD: 1000000,
  }

  // Recent sequences for multi-whale detection
  private recentSequences: TradeSequence[] = []

  /**
   * Analyze position changes and detect sequences
   */
  detectSequences(
    currentPositions: Map<string, AccountState>,
    coin: string
  ): TradeSequence[] {
    const sequences: TradeSequence[] = []
    const now = new Date()

    currentPositions.forEach((accountState, address) => {
      const whaleInfo = WHALES[address.toLowerCase()]
      if (!whaleInfo) return

      // Get current position for this coin
      const currentPos = accountState.positions.find(p => p.coin === coin)

      // Get historical position
      const history = this.whaleHistory.get(address)
      const previousSnapshot = history?.lastPositions.get(coin)

      // Detect changes
      const sequence = this.analyzePositionChange(
        address,
        whaleInfo.name,
        whaleInfo.signalWeight,
        whaleInfo.tier,
        coin,
        previousSnapshot,
        currentPos,
        now
      )

      if (sequence) {
        sequences.push(sequence)
        this.recentSequences.push(sequence)
      }

      // Update history
      this.updateHistory(address, coin, currentPos, now)
    })

    // Clean old sequences
    this.cleanOldSequences()

    // Check for multi-whale pattern
    const multiWhaleSequence = this.detectMultiWhalePattern(coin, sequences)
    if (multiWhaleSequence) {
      sequences.push(multiWhaleSequence)
    }

    return sequences
  }

  /**
   * Analyze single position change for patterns
   */
  private analyzePositionChange(
    address: string,
    whaleName: string,
    signalWeight: number,
    tier: string,
    coin: string,
    previous: PositionSnapshot | undefined,
    current: Position | undefined,
    timestamp: Date
  ): TradeSequence | null {
    // No previous data - check for new large position
    if (!previous) {
      if (current && current.positionValue >= this.THRESHOLDS.LARGE_POSITION_USD && signalWeight >= this.THRESHOLDS.CONVICTION_WEIGHT) {
        return {
          type: 'LARGE_POSITION_OPENED',
          coin,
          whaleAddress: address,
          whaleName,
          details: {
            newSize: current.size,
            newSide: current.side,
            changeUsd: current.positionValue,
          },
          timestamp,
          signalStrength: Math.min(95, signalWeight * 100),
          suggestedAction: 'FOLLOW',
        }
      }
      return null
    }

    // Position closed entirely
    if (previous && !current) {
      const baseStrength = Math.min(90, signalWeight * 100 + (previous.positionValue / 100000))

      // Conviction trader exit is more significant
      if (signalWeight >= this.THRESHOLDS.CONVICTION_WEIGHT) {
        return {
          type: 'CONVICTION_TRADER_EXIT',
          coin,
          whaleAddress: address,
          whaleName,
          details: {
            previousSize: previous.size,
            previousSide: previous.side,
            changeUsd: -previous.positionValue,
            changePct: -100,
            unrealizedPnl: previous.unrealizedPnl,
          },
          timestamp,
          signalStrength: Math.min(95, baseStrength + 10),
          suggestedAction: previous.unrealizedPnl > 0 ? 'FADE' : 'FOLLOW',  // If profitable exit, might be taking profits (FADE). If loss exit, might know something bad (FOLLOW)
        }
      }

      return {
        type: 'WHALE_CLOSING_POSITION',
        coin,
        whaleAddress: address,
        whaleName,
        details: {
          previousSize: previous.size,
          previousSide: previous.side,
          changeUsd: -previous.positionValue,
          changePct: -100,
          unrealizedPnl: previous.unrealizedPnl,
        },
        timestamp,
        signalStrength: baseStrength,
        suggestedAction: previous.unrealizedPnl > 0 ? 'WATCH' : 'FOLLOW',
      }
    }

    // Position exists in both - check for changes
    if (previous && current) {
      const changeUsd = current.positionValue - previous.positionValue
      const changePct = (changeUsd / previous.positionValue) * 100

      // Direction flip (long -> short or short -> long)
      if (previous.side !== current.side) {
        return {
          type: 'WHALE_FLIPPING_DIRECTION',
          coin,
          whaleAddress: address,
          whaleName,
          details: {
            previousSize: previous.size,
            newSize: current.size,
            previousSide: previous.side,
            newSide: current.side,
            changeUsd,
            unrealizedPnl: previous.unrealizedPnl,
          },
          timestamp,
          signalStrength: Math.min(95, signalWeight * 100 + 20),  // Direction flip is high signal
          suggestedAction: 'FOLLOW',
        }
      }

      // Significant reduction (>50% decrease)
      if (changePct <= -this.THRESHOLDS.REDUCING_PCT && Math.abs(changeUsd) >= this.THRESHOLDS.MIN_CHANGE_USD) {
        return {
          type: 'WHALE_REDUCING_SIZE',
          coin,
          whaleAddress: address,
          whaleName,
          details: {
            previousSize: previous.size,
            newSize: current.size,
            previousSide: previous.side,
            newSide: current.side,
            changeUsd,
            changePct,
            unrealizedPnl: previous.unrealizedPnl,
          },
          timestamp,
          signalStrength: Math.min(85, signalWeight * 80 + Math.abs(changePct) / 5),
          suggestedAction: previous.unrealizedPnl > 0 ? 'WATCH' : 'FOLLOW',
        }
      }

      // Fund rebalance (institutional tier with large change)
      if (tier === 'FUND' && Math.abs(changeUsd) >= this.THRESHOLDS.LARGE_POSITION_USD) {
        return {
          type: 'FUND_REBALANCE',
          coin,
          whaleAddress: address,
          whaleName,
          details: {
            previousSize: previous.size,
            newSize: current.size,
            previousSide: previous.side,
            newSide: current.side,
            changeUsd,
            changePct,
          },
          timestamp,
          signalStrength: Math.min(80, 60 + Math.abs(changeUsd) / 500000 * 10),
          suggestedAction: changeUsd > 0 ? 'FOLLOW' : 'WATCH',
        }
      }
    }

    return null
  }

  /**
   * Detect multi-whale coordinated pattern
   */
  private detectMultiWhalePattern(coin: string, currentSequences: TradeSequence[]): TradeSequence | null {
    const now = Date.now()
    const windowStart = now - this.THRESHOLDS.MULTI_WHALE_WINDOW_MS

    // Get recent sequences for this coin
    const recentForCoin = this.recentSequences.filter(
      s => s.coin === coin && s.timestamp.getTime() >= windowStart
    )

    // Count same-direction moves
    const closingLongs = recentForCoin.filter(
      s => (s.type === 'WHALE_CLOSING_POSITION' || s.type === 'WHALE_REDUCING_SIZE') &&
           s.details.previousSide === 'Long'
    )
    const closingShorts = recentForCoin.filter(
      s => (s.type === 'WHALE_CLOSING_POSITION' || s.type === 'WHALE_REDUCING_SIZE') &&
           s.details.previousSide === 'Short'
    )

    if (closingLongs.length >= this.THRESHOLDS.MULTI_WHALE_COUNT) {
      return {
        type: 'MULTI_WHALE_SAME_MOVE',
        coin,
        whaleAddress: 'MULTIPLE',
        whaleName: `${closingLongs.length} whales closing longs`,
        details: {
          changePct: closingLongs.length,
        },
        timestamp: new Date(),
        signalStrength: Math.min(95, 70 + closingLongs.length * 5),
        suggestedAction: 'FOLLOW',  // Multiple whales exiting longs = bearish
      }
    }

    if (closingShorts.length >= this.THRESHOLDS.MULTI_WHALE_COUNT) {
      return {
        type: 'MULTI_WHALE_SAME_MOVE',
        coin,
        whaleAddress: 'MULTIPLE',
        whaleName: `${closingShorts.length} whales closing shorts`,
        details: {
          changePct: closingShorts.length,
        },
        timestamp: new Date(),
        signalStrength: Math.min(95, 70 + closingShorts.length * 5),
        suggestedAction: 'FOLLOW',  // Multiple whales exiting shorts = bullish
      }
    }

    return null
  }

  /**
   * Update whale history with current position
   */
  private updateHistory(address: string, coin: string, position: Position | undefined, timestamp: Date): void {
    let history = this.whaleHistory.get(address)
    if (!history) {
      history = {
        address,
        lastPositions: new Map(),
        lastUpdate: timestamp,
      }
      this.whaleHistory.set(address, history)
    }

    if (position) {
      history.lastPositions.set(coin, {
        coin,
        side: position.side,
        size: position.size,
        positionValue: position.positionValue,
        unrealizedPnl: position.unrealizedPnl,
        timestamp,
      })
    } else {
      history.lastPositions.delete(coin)
    }
    history.lastUpdate = timestamp
  }

  /**
   * Clean old sequences from memory
   */
  private cleanOldSequences(): void {
    const cutoff = Date.now() - this.THRESHOLDS.MULTI_WHALE_WINDOW_MS * 2
    this.recentSequences = this.recentSequences.filter(
      s => s.timestamp.getTime() >= cutoff
    )
  }

  /**
   * Get recent sequences for monitoring
   */
  getRecentSequences(coin?: string): TradeSequence[] {
    if (coin) {
      return this.recentSequences.filter(s => s.coin === coin)
    }
    return [...this.recentSequences]
  }
}

// ============================================================
// SIGNAL AGGREGATOR
// ============================================================

/**
 * SignalAggregator - Combines trading mode and sequence signals into final command
 *
 * PRIORITY LOGIC:
 * 1. IMMEDIATE: Whale flip/exit with high signal strength → bypass delays
 * 2. HIGH: Multi-whale pattern or conviction trader move
 * 3. NORMAL: Standard trading mode signal
 * 4. LOW: Weak signals or neutral mode
 */
export class SignalAggregator {
  /**
   * Generate final trading command from all signals
   */
  generateCommand(
    coin: string,
    tradingMode: TradingModeResult,
    sequences: TradeSequence[],
    currentTrend?: NansenTrend
  ): TradingCommand {
    const now = new Date()

    // Find highest priority sequence
    const prioritySequence = this.findPrioritySequence(sequences)

    // Determine if we should bypass standard delays
    const bypassDelay = this.shouldBypassDelay(prioritySequence, tradingMode)

    // Calculate combined confidence
    const combinedConfidence = this.calculateCombinedConfidence(tradingMode, prioritySequence)

    // Determine urgency
    const urgency = this.determineUrgency(tradingMode, prioritySequence, bypassDelay)

    // Determine action
    const { action, reason } = this.determineAction(tradingMode, prioritySequence, currentTrend)

    // Calculate max position multiplier (sequence can override)
    const maxPositionMultiplier = this.calculateMaxMultiplier(tradingMode, prioritySequence)

    return {
      coin,
      action,
      urgency,
      confidence: combinedConfidence,
      maxPositionMultiplier,
      reason,
      sources: {
        tradingMode,
        sequence: prioritySequence,
      },
      bypassDelay,
      timestamp: now,
    }
  }

  /**
   * Find highest priority sequence from detected patterns
   */
  private findPrioritySequence(sequences: TradeSequence[]): TradeSequence | undefined {
    if (sequences.length === 0) return undefined

    // Priority order
    const typePriority: Record<SequenceType, number> = {
      'WHALE_FLIPPING_DIRECTION': 100,
      'MULTI_WHALE_SAME_MOVE': 95,
      'CONVICTION_TRADER_EXIT': 90,
      'WHALE_CLOSING_POSITION': 80,
      'LARGE_POSITION_OPENED': 70,
      'WHALE_REDUCING_SIZE': 60,
      'FUND_REBALANCE': 50,
    }

    return sequences.sort((a, b) => {
      const priorityDiff = typePriority[b.type] - typePriority[a.type]
      if (priorityDiff !== 0) return priorityDiff
      return b.signalStrength - a.signalStrength
    })[0]
  }

  /**
   * Determine if we should bypass standard delays
   */
  private shouldBypassDelay(sequence: TradeSequence | undefined, mode: TradingModeResult): boolean {
    // Bypass if squeeze failed (need to exit fast)
    if (mode.squeezeFailed) return true

    // Bypass for high-priority sequences ONLY if they don't conflict with trading mode
    if (sequence) {
      const sequenceDirection = this.getSequenceDirection(sequence)
      const modeDirection = this.getModeDirection(mode.mode)
      const isConflict = sequenceDirection && modeDirection && sequenceDirection !== modeDirection

      // CRITICAL FIX: Don't bypass delay for conflicting MULTI_WHALE_SAME_MOVE
      // These can be misleading when small positions close while large ones remain
      if (isConflict && mode.confidence >= 70) {
        // Only allow bypass for WHALE_FLIPPING_DIRECTION (true reversal signal)
        if (sequence.type === 'WHALE_FLIPPING_DIRECTION') {
          console.log(`[SignalAggregator] Bypass delay: WHALE_FLIPPING_DIRECTION overrides conflict`)
          return true
        }
        // Don't bypass for other conflicting sequences
        console.log(`[SignalAggregator] NO bypass delay: ${sequence.type} conflicts with ${mode.mode} (${mode.confidence}% conf)`)
        return false
      }

      // No conflict - allow bypass for high-priority sequences
      if (sequence.type === 'WHALE_FLIPPING_DIRECTION') return true
      if (sequence.type === 'MULTI_WHALE_SAME_MOVE') return true
      if (sequence.type === 'CONVICTION_TRADER_EXIT' && sequence.signalStrength >= 85) return true
      if (sequence.type === 'WHALE_CLOSING_POSITION' && sequence.signalStrength >= 80) return true
    }

    return false
  }

  /**
   * Calculate combined confidence from all signals
   */
  private calculateCombinedConfidence(mode: TradingModeResult, sequence: TradeSequence | undefined): number {
    let confidence = mode.confidence

    if (sequence) {
      // Boost confidence if sequence confirms trading mode direction
      const sequenceDirection = this.getSequenceDirection(sequence)
      const modeDirection = this.getModeDirection(mode.mode)

      if (sequenceDirection && modeDirection && sequenceDirection === modeDirection) {
        // Signals align - boost confidence
        confidence = Math.min(98, confidence + (sequence.signalStrength / 4))
      } else if (sequenceDirection && modeDirection && sequenceDirection !== modeDirection) {
        // Signals conflict - reduce confidence but consider sequence
        if (sequence.signalStrength >= 85) {
          // High strength sequence overrides
          confidence = sequence.signalStrength
        } else {
          // Mixed signals - reduce
          confidence = Math.max(20, confidence - 20)
        }
      }
    }

    return Math.round(confidence)
  }

  /**
   * Determine urgency level
   */
  private determineUrgency(
    mode: TradingModeResult,
    sequence: TradeSequence | undefined,
    bypassDelay: boolean
  ): Urgency {
    if (bypassDelay) return 'IMMEDIATE'

    if (sequence && sequence.signalStrength >= 80) return 'HIGH'

    if (mode.confidence >= 85) return 'HIGH'
    if (mode.confidence >= 60) return 'NORMAL'

    return 'LOW'
  }

  /**
   * Determine trading action
   */
  private determineAction(
    mode: TradingModeResult,
    sequence: TradeSequence | undefined,
    trend?: NansenTrend
  ): { action: TradingCommand['action']; reason: string } {
    // Squeeze failed - close position
    if (mode.squeezeFailed) {
      const action = mode.mode === 'CONTRARIAN_LONG' ? 'CLOSE_LONG' : 'CLOSE_SHORT'
      return { action, reason: `SQUEEZE TIMEOUT - ${mode.reason}` }
    }

    // Check for high-strength sequence
    if (sequence && sequence.signalStrength >= 85) {
      const sequenceDirection = this.getSequenceDirection(sequence)
      const modeDirection = this.getModeDirection(mode.mode)

      // CRITICAL FIX: Don't let sequence override trading mode when they CONFLICT
      // and trading mode has high confidence (positions are clear)
      const isConflict = sequenceDirection && modeDirection && sequenceDirection !== modeDirection

      if (isConflict && mode.confidence >= 70) {
        // Sequence conflicts with high-confidence trading mode
        // Only override if sequence is EXTREMELY strong (whale flipping or very high strength)
        const isExtremeSequence =
          sequence.type === 'WHALE_FLIPPING_DIRECTION' ||
          (sequence.signalStrength >= 95 && sequence.type !== 'MULTI_WHALE_SAME_MOVE')

        if (!isExtremeSequence) {
          // Don't override - trust the trading mode (aggregate positions)
          console.log(`[SignalAggregator] SEQUENCE CONFLICT: ${sequence.type} (${sequenceDirection}) vs ${mode.mode} (${modeDirection}) - trusting trading mode (${mode.confidence}% conf)`)
          // Fall through to standard mode-based action
        } else {
          // Extreme sequence - still override but log it
          console.log(`[SignalAggregator] EXTREME SEQUENCE OVERRIDE: ${sequence.type} overriding ${mode.mode}`)
          const sequenceAction = this.getActionFromSequence(sequence)
          if (sequenceAction) {
            return {
              action: sequenceAction,
              reason: `EXTREME SEQUENCE: ${sequence.type} by ${sequence.whaleName} (${sequence.signalStrength}% strength) - OVERRIDING ${mode.mode}`
            }
          }
        }
      } else {
        // No conflict OR trading mode has low confidence - sequence can override
        const sequenceAction = this.getActionFromSequence(sequence)
        if (sequenceAction) {
          return {
            action: sequenceAction,
            reason: `SEQUENCE DETECTED: ${sequence.type} by ${sequence.whaleName} (${sequence.signalStrength}% strength)`
          }
        }
      }
    }

    // Standard mode-based action
    switch (mode.mode) {
      case 'FOLLOW_SM_LONG':
        return { action: 'OPEN_LONG', reason: mode.reason }
      case 'FOLLOW_SM_SHORT':
        return { action: 'OPEN_SHORT', reason: mode.reason }
      case 'CONTRARIAN_LONG':
        return { action: 'OPEN_LONG', reason: `CONTRARIAN: ${mode.reason}` }
      case 'CONTRARIAN_SHORT':
        return { action: 'OPEN_SHORT', reason: `CONTRARIAN: ${mode.reason}` }
      case 'NEUTRAL':
        return { action: 'HOLD', reason: mode.reason }
      case 'BLOCKED':
        return { action: 'BLOCKED', reason: mode.reason }
      default:
        return { action: 'HOLD', reason: 'Unknown mode' }
    }
  }

  /**
   * Calculate max position multiplier
   */
  private calculateMaxMultiplier(mode: TradingModeResult, sequence: TradeSequence | undefined): number {
    let mult = mode.maxPositionMultiplier

    // Sequence can boost multiplier if aligned and high strength
    if (sequence && sequence.suggestedAction === 'FOLLOW' && sequence.signalStrength >= 80) {
      mult = Math.min(1.0, mult + 0.25)
    }

    // Reduce for watch signals
    if (sequence && sequence.suggestedAction === 'WATCH') {
      mult = Math.max(0.1, mult - 0.15)
    }

    return Math.round(mult * 100) / 100
  }

  /**
   * Get direction implied by sequence
   */
  private getSequenceDirection(sequence: TradeSequence): 'long' | 'short' | null {
    switch (sequence.type) {
      case 'WHALE_CLOSING_POSITION':
      case 'WHALE_REDUCING_SIZE':
      case 'CONVICTION_TRADER_EXIT':
        // Closing longs = bearish, closing shorts = bullish
        if (sequence.details.previousSide === 'Long') return 'short'
        if (sequence.details.previousSide === 'Short') return 'long'
        return null

      case 'WHALE_FLIPPING_DIRECTION':
        // New direction is the signal
        if (sequence.details.newSide === 'Long') return 'long'
        if (sequence.details.newSide === 'Short') return 'short'
        return null

      case 'LARGE_POSITION_OPENED':
        if (sequence.details.newSide === 'Long') return 'long'
        if (sequence.details.newSide === 'Short') return 'short'
        return null

      case 'MULTI_WHALE_SAME_MOVE':
        // Check whaleName for direction hint
        if (sequence.whaleName.includes('longs')) return 'short'  // Closing longs = bearish
        if (sequence.whaleName.includes('shorts')) return 'long'  // Closing shorts = bullish
        return null

      default:
        return null
    }
  }

  /**
   * Get direction from trading mode
   */
  private getModeDirection(mode: NansenTradingMode): 'long' | 'short' | null {
    if (mode === 'FOLLOW_SM_LONG' || mode === 'CONTRARIAN_LONG') return 'long'
    if (mode === 'FOLLOW_SM_SHORT' || mode === 'CONTRARIAN_SHORT') return 'short'
    return null
  }

  /**
   * Get trading action from sequence
   */
  private getActionFromSequence(sequence: TradeSequence): TradingCommand['action'] | null {
    const direction = this.getSequenceDirection(sequence)

    if (sequence.suggestedAction === 'FOLLOW') {
      if (direction === 'long') return 'OPEN_LONG'
      if (direction === 'short') return 'OPEN_SHORT'
    }

    if (sequence.suggestedAction === 'FADE') {
      // Fade = opposite direction
      if (direction === 'long') return 'OPEN_SHORT'
      if (direction === 'short') return 'OPEN_LONG'
    }

    return null
  }
}

// ============================================================
// ALPHA EXTRACTION ENGINE
// ============================================================

/**
 * AlphaExtractionEngine - Main orchestration class
 *
 * Lifecycle:
 * 1. Initialize NansenFeed
 * 2. On data update:
 *    a. Run SmartMoneyAnalyzer for each coin
 *    b. Run TradeSequenceDetector for each coin
 *    c. Run SignalAggregator to generate commands
 * 3. Emit trading commands with appropriate urgency
 */
export class AlphaExtractionEngine extends EventEmitter {
  private nansenFeed: NansenFeed
  private sequenceDetector: TradeSequenceDetector
  private signalAggregator: SignalAggregator

  // State tracking
  private lastPositions: Map<string, AccountState> = new Map()
  private lastCommands: Map<string, TradingCommand> = new Map()
  private squeezeDurations: Map<string, { startTime: Date; mode: NansenTradingMode }> = new Map()

  // Configuration
  private updateIntervalMs: number = 30000  // 30 seconds
  private updateTimer: NodeJS.Timeout | null = null
  private isRunning: boolean = false

  constructor() {
    super()
    this.nansenFeed = new NansenFeed()
    this.sequenceDetector = new TradeSequenceDetector()
    this.signalAggregator = new SignalAggregator()

    // Wire up NansenFeed events
    this.nansenFeed.on('update', this.handleNansenUpdate.bind(this))
  }

  /**
   * Start the engine
   */
  async start(intervalMs?: number): Promise<void> {
    if (this.isRunning) {
      console.log('[AlphaEngine] Already running')
      return
    }

    if (intervalMs) {
      this.updateIntervalMs = intervalMs
    }

    console.log('[AlphaEngine] Starting...')
    this.isRunning = true

    // Initial update
    await this.update()

    // Start periodic updates
    this.updateTimer = setInterval(() => {
      this.update().catch(err => {
        console.error('[AlphaEngine] Update error:', err)
      })
    }, this.updateIntervalMs)

    console.log(`[AlphaEngine] Started with ${this.updateIntervalMs}ms interval`)
  }

  /**
   * Stop the engine
   */
  stop(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = null
    }
    this.isRunning = false
    console.log('[AlphaEngine] Stopped')
  }

  /**
   * Perform single update cycle
   */
  async update(): Promise<{
    commands: Map<string, TradingCommand>
    sequences: TradeSequence[]
    nansenBias: Record<string, NansenBiasOutput>
  }> {
    const startTime = Date.now()
    console.log('[AlphaEngine] Update cycle starting...')

    // 1. Fetch latest data from NansenFeed
    const { smartMoneyData, nansenBias, aggregated } = await this.nansenFeed.update()

    // 2. Get current positions for sequence detection
    const currentPositions = await this.nansenFeed.fetchAllPositions()

    // 3. Process each coin
    const allSequences: TradeSequence[] = []
    const commands = new Map<string, TradingCommand>()

    for (const coin of TRACKED_COINS) {
      const coinData = aggregated[coin]
      if (!coinData) continue

      // 3a. Detect sequences
      const sequences = this.sequenceDetector.detectSequences(currentPositions, coin)
      allSequences.push(...sequences)

      // 3b. Calculate squeeze duration if in CONTRARIAN mode
      const squeezeDuration = this.calculateSqueezeDuration(coin, nansenBias[coin]?.tradingMode)

      // 3c. Run SmartMoneyAnalyzer
      const tradingModeInput: TradingModeInput = {
        weightedLongs: coinData.longs,
        weightedShorts: coinData.shorts,
        longsUpnl: coinData.longsUpnl,
        shortsUpnl: coinData.shortsUpnl,
        velocity: nansenBias[coin]?.buySellPressure ?? 0,
        trend: nansenBias[coin]?.trend ?? 'unknown',
        squeezeDurationHours: squeezeDuration,
      }

      const tradingModeResult = determineTradingMode(tradingModeInput)

      // 3d. Generate trading command
      const command = this.signalAggregator.generateCommand(
        coin,
        tradingModeResult,
        sequences,
        nansenBias[coin]?.trend
      )

      commands.set(coin, command)

      // 3e. Emit events for immediate-urgency commands
      if (command.urgency === 'IMMEDIATE') {
        this.emit('immediate_signal', command)
        console.log(`[AlphaEngine] IMMEDIATE SIGNAL: ${coin} ${command.action} - ${command.reason}`)
      }

      // 3f. Emit sequence events
      for (const seq of sequences) {
        this.emit('sequence_detected', seq)
        if (seq.signalStrength >= 80) {
          console.log(`[AlphaEngine] HIGH PRIORITY SEQUENCE: ${seq.type} for ${coin} by ${seq.whaleName}`)
        }
      }
    }

    // 4. Store for next cycle
    this.lastPositions = currentPositions
    this.lastCommands = commands

    // 5. Emit general update
    this.emit('update', {
      commands: Object.fromEntries(commands),
      sequences: allSequences,
      nansenBias,
      timestamp: new Date(),
    })

    const elapsed = Date.now() - startTime
    console.log(`[AlphaEngine] Update complete in ${elapsed}ms. ${allSequences.length} sequences detected.`)

    return { commands, sequences: allSequences, nansenBias }
  }

  /**
   * Calculate how long we've been in CONTRARIAN mode for a coin
   */
  private calculateSqueezeDuration(coin: string, currentMode?: NansenTradingMode): number {
    const isContrarian = currentMode === 'CONTRARIAN_LONG' || currentMode === 'CONTRARIAN_SHORT'
    const tracking = this.squeezeDurations.get(coin)

    if (!isContrarian) {
      // Not in contrarian mode - reset tracking
      this.squeezeDurations.delete(coin)
      return 0
    }

    if (!tracking || tracking.mode !== currentMode) {
      // New contrarian mode - start tracking
      this.squeezeDurations.set(coin, { startTime: new Date(), mode: currentMode })
      return 0
    }

    // Calculate duration in hours
    const durationMs = Date.now() - tracking.startTime.getTime()
    return durationMs / (1000 * 60 * 60)
  }

  /**
   * Get current command for a coin
   */
  getCommand(coin: string): TradingCommand | undefined {
    return this.lastCommands.get(coin)
  }

  /**
   * Get all current commands
   */
  getAllCommands(): Map<string, TradingCommand> {
    return this.lastCommands
  }

  /**
   * Get recent sequences
   */
  getRecentSequences(coin?: string): TradeSequence[] {
    return this.sequenceDetector.getRecentSequences(coin)
  }

  /**
   * Check if engine is running
   */
  getIsRunning(): boolean {
    return this.isRunning
  }

  /**
   * Handle NansenFeed update event
   */
  private handleNansenUpdate(data: {
    smartMoneyData: SmartMoneyData
    nansenBias: Record<string, NansenBiasOutput>
    aggregated: Record<string, AggregatedCoinData>
  }): void {
    // This is called by NansenFeed.update() which we already handle
    // Can be used for additional processing if needed
  }
}

// ============================================================
// EXPORTS
// ============================================================

// Export singleton instance
export const alphaEngine = new AlphaExtractionEngine()

// Export classes for testing
export { NansenFeed } from './data/NansenFeed'
