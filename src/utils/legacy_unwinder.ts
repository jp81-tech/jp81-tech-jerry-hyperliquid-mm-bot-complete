/**
 * Legacy Position Unwinding Manager
 *
 * Tier 1: Safety Limits
 * - Force exit on max loss
 * - Force exit on max age
 *
 * Tier 2: Smart Unwinding
 * - One-sided quoting (reduce-only)
 * - Wider spreads to avoid adverse selection
 */

export type LegacyPosition = {
  symbol: string
  side: 'long' | 'short'
  size: number
  entryPrice: number
  currentPrice: number
  unrealizedPnl: number
  createdAtMs: number
}

export type UnwindConfig = {
  maxLossUsd: number          // -100 = force exit at $100 loss
  maxAgeHours: number          // 48 = force exit after 48 hours
  unwindMode: 'passive' | 'active'
  reduceOnly: boolean
  spreadMultiplier: number     // 1.5 = 1.5x wider spreads
}

export type UnwindDecision = {
  shouldForceExit: boolean
  reason?: string
  strategy: 'wait' | 'reduce_only' | 'force_exit'
  spreadMultiplier: number
}

export class LegacyUnwinder {
  private config: UnwindConfig

  constructor(config: UnwindConfig) {
    this.config = config
  }

  /**
   * Decide what to do with a legacy position
   */
  evaluatePosition(position: LegacyPosition): UnwindDecision {
    // Tier 1: Check safety limits
    const forceExit = this.shouldForceExit(position)
    if (forceExit) {
      return {
        shouldForceExit: true,
        reason: forceExit.reason,
        strategy: 'force_exit',
        spreadMultiplier: 1.0  // Don't care about spread on force exit
      }
    }

    // Tier 2: Smart unwinding based on mode
    if (this.config.unwindMode === 'passive') {
      // Original behavior: wait for profit
      return {
        shouldForceExit: false,
        strategy: 'wait',
        spreadMultiplier: 1.0
      }
    }

    // Active mode: reduce-only with wider spreads
    return {
      shouldForceExit: false,
      strategy: 'reduce_only',
      spreadMultiplier: this.config.spreadMultiplier
    }
  }

  /**
   * Check if position should be force-exited
   */
  private shouldForceExit(position: LegacyPosition): { reason: string } | null {
    // Check max loss
    if (position.unrealizedPnl < this.config.maxLossUsd) {
      return {
        reason: `Loss $${position.unrealizedPnl.toFixed(2)} exceeds max loss $${this.config.maxLossUsd}`
      }
    }

    // Check max age
    const ageHours = (Date.now() - position.createdAtMs) / (1000 * 60 * 60)
    if (ageHours > this.config.maxAgeHours) {
      return {
        reason: `Position age ${ageHours.toFixed(1)}h exceeds max ${this.config.maxAgeHours}h`
      }
    }

    return null
  }

  /**
   * Determine which side to quote for reduce-only
   */
  getReducingSide(position: LegacyPosition): 'buy' | 'sell' {
    // If long, place sell orders to reduce
    // If short, place buy orders to reduce
    return position.side === 'long' ? 'sell' : 'buy'
  }

  /**
   * Calculate adjusted spread for legacy position
   */
  getAdjustedSpreadBps(baseSpreadBps: number): number {
    return baseSpreadBps * this.config.spreadMultiplier
  }
}

/**
 * Create unwinder from environment variables
 */
export function createLegacyUnwinderFromEnv(): LegacyUnwinder {
  const config: UnwindConfig = {
    maxLossUsd: parseFloat(process.env.LEGACY_MAX_LOSS_USD || '-100'),
    maxAgeHours: parseFloat(process.env.LEGACY_MAX_AGE_HOURS || '48'),
    unwindMode: (process.env.LEGACY_UNWIND_MODE || 'passive') as 'passive' | 'active',
    reduceOnly: process.env.LEGACY_REDUCE_ONLY === 'true',
    spreadMultiplier: parseFloat(process.env.LEGACY_SPREAD_MULTIPLIER || '1.5')
  }

  return new LegacyUnwinder(config)
}
