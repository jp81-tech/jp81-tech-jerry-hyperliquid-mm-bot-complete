/**
 * AlphaEngineIntegration.ts - Bridge between AlphaExtractionEngine and mm_hl.ts
 *
 * Replaces Python whale_tracker.py + JSON file reading with native TypeScript
 * real-time Smart Money tracking.
 *
 * USAGE IN mm_hl.ts:
 * 1. Import: import { alphaEngineIntegration } from './core/AlphaEngineIntegration'
 * 2. In initialize(): await alphaEngineIntegration.start()
 * 3. Replace tryLoadNansenBiasIntoCache() calls with alphaEngineIntegration.getNansenBiasCache()
 * 4. Subscribe to immediate_signal events for fast reaction
 */

import { EventEmitter } from 'events'
import {
  AlphaExtractionEngine,
  type TradingCommand,
  type TradeSequence,
  type Urgency,
} from './AlphaExtractionEngine.js'
import type {
  NansenBiasEntry,
  NansenTradingMode,
  NansenTrend,
  NansenTrendStrength,
} from '../mm/nansen_bias_cache.js'
import { TRACKED_COINS } from './data/NansenFeed.js'

// ============================================================
// TYPES
// ============================================================

/** Safe default configuration when no data available */
export interface SafeDefaults {
  tradingMode: NansenTradingMode
  confidence: number
  maxPositionMultiplier: number
  allowLongs: boolean
  allowShorts: boolean
  spreadMultiplier: number
}

/** Trading permissions derived from signals */
export interface TradingPermissions {
  allowLongs: boolean
  allowShorts: boolean
  bidMultiplier: number      // 0-1, controls bid size
  askMultiplier: number      // 0-1, controls ask size
  spreadMultiplier: number   // 1.0 = normal, >1 = wider (protection)
  urgency: Urgency
  bypassDelay: boolean
}

/** Combined signal output for GridManager */
export interface CombinedSignal {
  coin: string
  permissions: TradingPermissions
  command: TradingCommand | null
  sequence: TradeSequence | null
  nansenBias: NansenBiasEntry | null
  isUsingFallback: boolean
}

// ============================================================
// CONSTANTS
// ============================================================

/** Safe defaults when AlphaEngine has no data */
const SAFE_DEFAULTS: SafeDefaults = {
  tradingMode: 'NEUTRAL',
  confidence: 0,
  maxPositionMultiplier: 0.5,  // 50% of normal (was 0.1 - too conservative!)
  allowLongs: true,            // Allow both sides
  allowShorts: true,           // With moderate size
  spreadMultiplier: 1.3,       // Slightly wider spread for protection
}

/** Time before considering data stale (ms) */
const STALE_DATA_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

/** Update interval for AlphaEngine (ms) */
const DEFAULT_UPDATE_INTERVAL_MS = 30_000 // 30 seconds

// ============================================================
// ALPHA ENGINE INTEGRATION
// ============================================================

/**
 * AlphaEngineIntegration - Manages AlphaExtractionEngine lifecycle and provides
 * a clean interface for mm_hl.ts to consume signals.
 */
export class AlphaEngineIntegration extends EventEmitter {
  private engine: AlphaExtractionEngine
  private lastUpdateTime: number = 0
  private isRunning: boolean = false

  // Caches for mm_hl.ts compatibility
  private nansenBiasCache: {
    lastLoad: number
    data: Record<string, NansenBiasEntry>
  } = { lastLoad: 0, data: {} }

  private commandCache: Map<string, TradingCommand> = new Map()
  private sequenceCache: Map<string, TradeSequence[]> = new Map()

  // Immediate signal queue (for fast reaction)
  private immediateSignalQueue: TradingCommand[] = []

  constructor() {
    super()
    this.engine = new AlphaExtractionEngine()
    this.setupEventListeners()
  }

  /**
   * Setup event listeners from AlphaEngine
   */
  private setupEventListeners(): void {
    // Handle immediate signals (bypass delays)
    this.engine.on('immediate_signal', (command: TradingCommand) => {
      console.log(`[AlphaIntegration] IMMEDIATE SIGNAL: ${command.coin} ${command.action}`)
      this.immediateSignalQueue.push(command)
      this.emit('immediate_signal', command)
    })

    // Handle sequence detection
    this.engine.on('sequence_detected', (sequence: TradeSequence) => {
      const existing = this.sequenceCache.get(sequence.coin) || []
      existing.push(sequence)
      // Keep only last 10 sequences per coin
      if (existing.length > 10) existing.shift()
      this.sequenceCache.set(sequence.coin, existing)
      this.emit('sequence_detected', sequence)
    })

    // Handle full updates
    this.engine.on('update', (data: {
      commands: Record<string, TradingCommand>
      sequences: TradeSequence[]
      nansenBias: Record<string, NansenBiasEntry>
      timestamp: Date
    }) => {
      this.lastUpdateTime = Date.now()

      // Update caches
      this.nansenBiasCache = {
        lastLoad: this.lastUpdateTime,
        data: data.nansenBias,
      }

      for (const [coin, cmd] of Object.entries(data.commands)) {
        this.commandCache.set(coin, cmd)
      }

      this.emit('update', data)
    })
  }

  /**
   * Start the AlphaEngine
   */
  async start(intervalMs: number = DEFAULT_UPDATE_INTERVAL_MS): Promise<void> {
    if (this.isRunning) {
      console.log('[AlphaIntegration] Already running')
      return
    }

    console.log('[AlphaIntegration] Starting AlphaExtractionEngine...')
    this.isRunning = true

    try {
      await this.engine.start(intervalMs)
      console.log(`[AlphaIntegration] Engine started with ${intervalMs}ms interval`)
    } catch (error) {
      console.error('[AlphaIntegration] Failed to start engine:', error)
      this.isRunning = false
      throw error
    }
  }

  /**
   * Stop the AlphaEngine
   */
  stop(): void {
    this.engine.stop()
    this.isRunning = false
    console.log('[AlphaIntegration] Engine stopped')
  }

  /**
   * Check if data is stale
   */
  isDataStale(): boolean {
    return Date.now() - this.lastUpdateTime > STALE_DATA_THRESHOLD_MS
  }

  /**
   * Get NansenBiasCache (compatible with mm_hl.ts)
   */
  getNansenBiasCache(): { lastLoad: number; data: Record<string, NansenBiasEntry> } {
    return this.nansenBiasCache
  }

  /**
   * Get NansenBiasEntry for a specific coin
   */
  getNansenBias(coin: string): NansenBiasEntry | null {
    return this.nansenBiasCache.data[coin] || null
  }

  /**
   * Get trading command for a specific coin
   */
  getCommand(coin: string): TradingCommand | null {
    return this.commandCache.get(coin) || null
  }

  /**
   * Get recent sequences for a coin
   */
  getSequences(coin: string): TradeSequence[] {
    return this.sequenceCache.get(coin) || []
  }

  /**
   * Pop next immediate signal from queue
   */
  popImmediateSignal(): TradingCommand | null {
    return this.immediateSignalQueue.shift() || null
  }

  /**
   * Check if there are pending immediate signals
   */
  hasImmediateSignals(): boolean {
    return this.immediateSignalQueue.length > 0
  }

  /**
   * Get trading permissions from signals (for GridManager)
   * Includes fallback logic when no data available
   */
  getTradingPermissions(coin: string): TradingPermissions {
    const command = this.commandCache.get(coin)
    const bias = this.nansenBiasCache.data[coin]

    // Check for stale data or no data
    if (this.isDataStale() || !command || !bias) {
      console.log(`[AlphaIntegration] ${coin}: Using SAFE DEFAULTS (stale=${this.isDataStale()}, cmd=${!!command}, bias=${!!bias})`)
      return {
        allowLongs: SAFE_DEFAULTS.allowLongs,
        allowShorts: SAFE_DEFAULTS.allowShorts,
        bidMultiplier: SAFE_DEFAULTS.maxPositionMultiplier,
        askMultiplier: SAFE_DEFAULTS.maxPositionMultiplier,
        spreadMultiplier: SAFE_DEFAULTS.spreadMultiplier,
        urgency: 'LOW',
        bypassDelay: false,
      }
    }

    // Derive permissions from command and bias
    const permissions = this.derivePermissions(command, bias)
    return permissions
  }

  /**
   * Derive trading permissions from command and bias
   */
  private derivePermissions(command: TradingCommand, bias: NansenBiasEntry): TradingPermissions {
    let allowLongs = true
    let allowShorts = true
    let bidMultiplier = command.maxPositionMultiplier
    let askMultiplier = command.maxPositionMultiplier
    let spreadMultiplier = 1.0

    // Action-based permission adjustment
    switch (command.action) {
      case 'OPEN_LONG':
        // Bullish - favor longs
        allowShorts = command.confidence < 70  // Only allow shorts if low confidence
        askMultiplier = Math.min(0.25, askMultiplier)  // Reduce asks
        break

      case 'OPEN_SHORT':
        // Bearish - favor shorts
        allowLongs = command.confidence < 70
        bidMultiplier = Math.min(0.25, bidMultiplier)  // Reduce bids
        break

      case 'CLOSE_LONG':
        // Exiting long - block new longs
        allowLongs = false
        bidMultiplier = 0
        break

      case 'CLOSE_SHORT':
        // Exiting short - block new shorts
        allowShorts = false
        askMultiplier = 0
        break

      case 'BLOCKED':
        // Both sides blocked
        allowLongs = false
        allowShorts = false
        bidMultiplier = 0
        askMultiplier = 0
        spreadMultiplier = 2.0
        break

      case 'HOLD':
      default:
        // Neutral - use moderate settings
        bidMultiplier = Math.min(0.5, bidMultiplier)
        askMultiplier = Math.min(0.5, askMultiplier)
        spreadMultiplier = 1.2
        break
    }

    // Apply divergence/momentum warnings
    if (bias.divergenceWarning || bias.momentumWarning) {
      spreadMultiplier = Math.max(spreadMultiplier, 1.3)
      bidMultiplier *= 0.7
      askMultiplier *= 0.7
    }

    // Apply squeeze failed protection
    if (bias.squeezeFailed) {
      spreadMultiplier = Math.max(spreadMultiplier, 1.5)
    }

    return {
      allowLongs,
      allowShorts,
      bidMultiplier: Math.max(0, Math.min(1, bidMultiplier)),
      askMultiplier: Math.max(0, Math.min(1, askMultiplier)),
      spreadMultiplier: Math.max(1, spreadMultiplier),
      urgency: command.urgency,
      bypassDelay: command.bypassDelay,
    }
  }

  /**
   * Get combined signal for a coin (full context)
   */
  getCombinedSignal(coin: string): CombinedSignal {
    const command = this.commandCache.get(coin) || null
    const sequences = this.sequenceCache.get(coin) || []
    const nansenBias = this.nansenBiasCache.data[coin] || null
    const isUsingFallback = this.isDataStale() || !command || !nansenBias

    return {
      coin,
      permissions: this.getTradingPermissions(coin),
      command,
      sequence: sequences.length > 0 ? sequences[sequences.length - 1] : null,
      nansenBias,
      isUsingFallback,
    }
  }

  /**
   * Get all combined signals
   */
  getAllCombinedSignals(): Record<string, CombinedSignal> {
    const result: Record<string, CombinedSignal> = {}
    for (const coin of TRACKED_COINS) {
      result[coin] = this.getCombinedSignal(coin)
    }
    return result
  }

  /**
   * Force a manual update (bypass interval)
   */
  async forceUpdate(): Promise<void> {
    console.log('[AlphaIntegration] Force update triggered')
    await this.engine.update()
  }

  /**
   * Check if engine is running
   */
  getIsRunning(): boolean {
    return this.isRunning
  }

  /**
   * Get tracked coins
   */
  getTrackedCoins(): string[] {
    return [...TRACKED_COINS]
  }
}

// ============================================================
// SINGLETON EXPORT
// ============================================================

export const alphaEngineIntegration = new AlphaEngineIntegration()

// ============================================================
// HELPER FUNCTIONS FOR mm_hl.ts MIGRATION
// ============================================================

/**
 * Replacement for tryLoadNansenBiasIntoCache()
 * Returns cached data from AlphaEngine instead of reading JSON file
 */
export function getAlphaEngineBiasCache(): { lastLoad: number; data: Record<string, NansenBiasEntry> } {
  return alphaEngineIntegration.getNansenBiasCache()
}

/**
 * Get bias entry for a coin (replacement for nansenBiasCache.data[coin])
 */
export function getAlphaBias(coin: string): NansenBiasEntry | null {
  return alphaEngineIntegration.getNansenBias(coin)
}

/**
 * Get trading permissions for GridManager
 */
export function getAlphaPermissions(coin: string): TradingPermissions {
  return alphaEngineIntegration.getTradingPermissions(coin)
}

/**
 * Check if we should execute immediately (sequence detected)
 */
export function shouldBypassDelay(coin: string): boolean {
  const cmd = alphaEngineIntegration.getCommand(coin)
  return cmd?.bypassDelay || false
}

/**
 * Get size multipliers for bid/ask based on signals
 */
export function getAlphaSizeMultipliers(coin: string): { bid: number; ask: number } {
  const perms = alphaEngineIntegration.getTradingPermissions(coin)
  return {
    bid: perms.bidMultiplier,
    ask: perms.askMultiplier,
  }
}

// ============================================================
// RE-EXPORTS FOR mm_hl.ts
// ============================================================

export type { TradingCommand, TradeSequence, Urgency } from './AlphaExtractionEngine'
