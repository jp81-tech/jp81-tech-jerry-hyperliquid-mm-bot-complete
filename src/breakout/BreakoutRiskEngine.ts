import type { BreakoutSignal, BreakoutState } from './types.js'
import type { BreakoutConfig } from './config.js'

export interface SizingResult {
  allowed: boolean
  reason: string
  sizeUsd: number
  leverage: number
}

export class BreakoutRiskEngine {
  private config: BreakoutConfig
  private initialEquity = 0

  constructor(config: BreakoutConfig) {
    this.config = config
  }

  setInitialEquity(equity: number) {
    if (this.initialEquity === 0) {
      this.initialEquity = equity
    }
  }

  calculateSize(
    signal: BreakoutSignal,
    equity: number,
    state: BreakoutState,
  ): SizingResult {

    const deny = (reason: string): SizingResult => ({
      allowed: false, reason, sizeUsd: 0, leverage: this.config.defaultLeverage
    })

    // Max positions check
    const activeCount = Object.keys(state.positions).length
    if (activeCount >= this.config.maxPositions) {
      return deny(`Max positions (${this.config.maxPositions}) reached`)
    }

    // Already have position in this token
    if (state.positions[signal.token]) {
      return deny(`Already in ${signal.token}`)
    }

    // Daily loss kill switch
    this.checkDailyReset(state)
    const dailyLossPct = Math.abs(Math.min(0, state.dailyPnl)) / equity * 100
    if (dailyLossPct >= this.config.maxDailyLossPct) {
      return deny(`Daily loss ${dailyLossPct.toFixed(1)}% >= ${this.config.maxDailyLossPct}% limit`)
    }

    // Total drawdown kill switch
    if (this.initialEquity > 0) {
      const drawdownPct = (this.initialEquity - equity) / this.initialEquity * 100
      if (drawdownPct >= this.config.maxDrawdownPct) {
        return deny(`Drawdown ${drawdownPct.toFixed(1)}% >= ${this.config.maxDrawdownPct}% limit`)
      }
    }

    // Position sizing: risk X% of equity
    const riskUsd = equity * (this.config.riskPct / 100)
    const riskPct = signal.riskR / signal.entryPrice  // SL distance as %
    if (riskPct <= 0 || riskPct > 0.10) {
      return deny(`SL distance ${(riskPct * 100).toFixed(2)}% out of range`)
    }

    const sizeUsd = riskUsd / riskPct

    // Cap at 50% equity
    const maxSizeUsd = equity * 0.5
    const finalSize = Math.min(sizeUsd, maxSizeUsd)

    // Check leverage requirement
    const leverageNeeded = finalSize / equity
    if (leverageNeeded > this.config.defaultLeverage) {
      return deny(`Would need ${leverageNeeded.toFixed(1)}x lev (max ${this.config.defaultLeverage}x)`)
    }

    return {
      allowed: true,
      reason: `Risk $${riskUsd.toFixed(0)} (${this.config.riskPct}%) | SL dist ${(riskPct * 100).toFixed(2)}%`,
      sizeUsd: finalSize,
      leverage: this.config.defaultLeverage,
    }
  }

  checkDailyReset(state: BreakoutState) {
    const now = Date.now()
    const dayMs = 24 * 60 * 60 * 1000
    if (now - state.dailyPnlResetTime > dayMs) {
      state.dailyPnl = 0
      state.dailyPnlResetTime = now
    }
  }

  /**
   * Check if price hit SL or TP for an active position.
   * Returns 'SL' | 'TP' | 'TRAIL' | null
   */
  checkExit(
    midPrice: number,
    pos: { side: 'LONG' | 'SHORT', slPrice: number, tpPrice: number },
  ): 'SL' | 'TP' | null {

    if (pos.side === 'LONG') {
      if (midPrice <= pos.slPrice) return 'SL'
      if (midPrice >= pos.tpPrice) return 'TP'
    } else {
      if (midPrice >= pos.slPrice) return 'SL'
      if (midPrice <= pos.tpPrice) return 'TP'
    }
    return null
  }

  /**
   * Update trailing SL based on new Donchian lower/upper.
   * For LONG: SL = max(current SL, new Donchian lower)
   * For SHORT: SL = min(current SL, new Donchian upper)
   */
  updateTrailingSL(
    side: 'LONG' | 'SHORT',
    currentSL: number,
    donchianUpper: number,
    donchianLower: number,
  ): number {
    if (side === 'LONG') {
      return Math.max(currentSL, donchianLower)
    } else {
      return Math.min(currentSL, donchianUpper)
    }
  }
}
