import { LiqCluster } from './moon_stream_guard'
import { SniperModeConfig, getSniperModeConfig } from '../config/short_only_config'

// ============================================================
// SNIPER MODE — Mean Reversion After Liquidation Cascades
//
// State machine: WATCHING -> CASCADE_DETECTED -> SNIPER_ARMED
//   -> ENTRY_ACTIVE -> POSITION_HELD -> COOLDOWN -> WATCHING
//
// Exploits the snap-back after forced liquidations exhaust:
// e.g. SHORT cluster squeezed -> forced buys push price up ->
// once all shorts liquidated, no more forced buyers -> price drops.
// Sniper enters counter-trend immediately after exhaustion.
// ============================================================

export type SniperPhase =
  | 'WATCHING'
  | 'CASCADE_DETECTED'
  | 'SNIPER_ARMED'
  | 'ENTRY_ACTIVE'
  | 'POSITION_HELD'
  | 'COOLDOWN'

export interface SniperOutput {
  active: boolean
  phase: SniperPhase
  bidMultOverride: number     // multiplier (1.0 = no change)
  askMultOverride: number
  sizeCapPct: number          // cap grid size (1.0 = no cap)
  overrideLiqGravity: boolean // suppress Gravity Guard when sniper active
  exitUrgent: boolean         // bypass BREAKEVEN_BLOCK (same as inventorySlPanic)
  reason: string              // log message
}

interface SniperState {
  phase: SniperPhase
  // CASCADE_DETECTED
  cascadeStartPrice: number
  cascadeStartTime: number
  targetCluster: LiqCluster | null
  cascadePeakPrice: number
  cascadeDirection: 'up' | 'down' // up = pumping into SHORT cluster, down = dumping into LONG cluster
  // ENTRY_ACTIVE
  entryDirection: 'short' | 'long'
  entryArmedTime: number
  // POSITION_HELD
  entryPrice: number
  entryTime: number
  bestPriceSinceEntry: number
  trailingActivated: boolean
  // COOLDOWN
  cooldownUntil: number
}

const INACTIVE_OUTPUT: SniperOutput = {
  active: false,
  phase: 'WATCHING',
  bidMultOverride: 1.0,
  askMultOverride: 1.0,
  sizeCapPct: 1.0,
  overrideLiqGravity: false,
  exitUrgent: false,
  reason: '',
}

function defaultState(): SniperState {
  return {
    phase: 'WATCHING',
    cascadeStartPrice: 0,
    cascadeStartTime: 0,
    targetCluster: null,
    cascadePeakPrice: 0,
    cascadeDirection: 'up',
    entryDirection: 'short',
    entryArmedTime: 0,
    entryPrice: 0,
    entryTime: 0,
    bestPriceSinceEntry: 0,
    trailingActivated: false,
    cooldownUntil: 0,
  }
}

export interface SniperTickInput {
  midPrice: number
  actualSkew: number
  clusters: LiqCluster[]
  recentVolumes15m: number[]  // from PairAnalysis (last 9 candle volumes)
  priceHistory: { price: number; ts: number }[]  // pumpShieldHistory
}

export class SniperMode {
  private states: Map<string, SniperState> = new Map()
  private configs: Map<string, SniperModeConfig> = new Map()

  constructor(tokens: string[]) {
    for (const token of tokens) {
      const cfg = getSniperModeConfig(token)
      this.configs.set(token, cfg)
      this.states.set(token, defaultState())
    }
  }

  getState(pair: string): SniperState {
    return this.states.get(pair) || defaultState()
  }

  tick(pair: string, input: SniperTickInput): SniperOutput {
    const cfg = this.configs.get(pair)
    if (!cfg || !cfg.enabled) return INACTIVE_OUTPUT

    let state = this.states.get(pair)
    if (!state) {
      state = defaultState()
      this.states.set(pair, state)
    }

    const now = Date.now()
    const { midPrice, actualSkew, clusters, recentVolumes15m, priceHistory } = input

    switch (state.phase) {
      case 'WATCHING':
        return this.tickWatching(pair, state, cfg, now, midPrice, actualSkew, clusters, recentVolumes15m, priceHistory)
      case 'CASCADE_DETECTED':
        return this.tickCascadeDetected(pair, state, cfg, now, midPrice)
      case 'SNIPER_ARMED':
        return this.tickSniperArmed(pair, state, cfg, now, midPrice, actualSkew)
      case 'ENTRY_ACTIVE':
        return this.tickEntryActive(pair, state, cfg, now, midPrice, actualSkew)
      case 'POSITION_HELD':
        return this.tickPositionHeld(pair, state, cfg, now, midPrice, actualSkew)
      case 'COOLDOWN':
        return this.tickCooldown(pair, state, cfg, now)
      default:
        return INACTIVE_OUTPUT
    }
  }

  private tickWatching(
    pair: string, state: SniperState, cfg: SniperModeConfig, now: number,
    midPrice: number, actualSkew: number, clusters: LiqCluster[],
    recentVolumes15m: number[], priceHistory: { price: number; ts: number }[]
  ): SniperOutput {
    // Must be flat to enter sniper mode
    if (Math.abs(actualSkew) > 0.10) {
      return { ...INACTIVE_OUTPUT, phase: 'WATCHING', reason: `flat check failed (skew=${(actualSkew * 100).toFixed(1)}%)` }
    }

    // Find qualifying cluster: large enough, close enough
    const qualifyingCluster = clusters.find(c =>
      c.totalValueUsd >= cfg.clusterMinValueUsd && Math.abs(c.distancePct) < 3.0
    )
    if (!qualifyingCluster) {
      return { ...INACTIVE_OUTPUT, phase: 'WATCHING', reason: 'no qualifying cluster' }
    }

    // Check price movement toward cluster in last 15min
    const recentMove = this.getRecentMove(priceHistory, 15 * 60 * 1000)
    if (recentMove === null) {
      return { ...INACTIVE_OUTPUT, phase: 'WATCHING', reason: 'insufficient price history' }
    }

    // Determine cascade direction
    const clusterAbove = qualifyingCluster.distancePct > 0
    const movingToward = clusterAbove ? recentMove > 0 : recentMove < 0
    const movePct = Math.abs(recentMove)

    if (!movingToward || movePct < cfg.cascadeMinMovePct) {
      return { ...INACTIVE_OUTPUT, phase: 'WATCHING', reason: `move ${movePct.toFixed(2)}% < ${cfg.cascadeMinMovePct}% or wrong direction` }
    }

    // Volume spike check
    if (recentVolumes15m.length < 2) {
      return { ...INACTIVE_OUTPUT, phase: 'WATCHING', reason: 'insufficient volume data' }
    }
    const currentVol = recentVolumes15m[recentVolumes15m.length - 1]
    const avgVol = recentVolumes15m.slice(0, -1).reduce((a, b) => a + b, 0) / (recentVolumes15m.length - 1)
    if (avgVol <= 0 || currentVol < avgVol * cfg.volumeSpikeMultiplier) {
      return { ...INACTIVE_OUTPUT, phase: 'WATCHING', reason: `vol spike ${avgVol > 0 ? (currentVol / avgVol).toFixed(1) : '0'}x < ${cfg.volumeSpikeMultiplier}x` }
    }

    // All conditions met -> CASCADE_DETECTED
    state.phase = 'CASCADE_DETECTED'
    state.cascadeStartPrice = midPrice
    state.cascadeStartTime = now
    state.targetCluster = qualifyingCluster
    state.cascadePeakPrice = midPrice
    state.cascadeDirection = clusterAbove ? 'up' : 'down'

    return {
      active: true,
      phase: 'CASCADE_DETECTED',
      bidMultOverride: 1.0,
      askMultOverride: 1.0,
      sizeCapPct: 1.0,
      overrideLiqGravity: false,
      exitUrgent: false,
      reason: `cascade toward ${qualifyingCluster.side.toUpperCase()} cluster $${(qualifyingCluster.totalValueUsd / 1000).toFixed(0)}K at ${qualifyingCluster.distancePct.toFixed(1)}% | move=${movePct.toFixed(2)}% vol=${(currentVol / avgVol).toFixed(1)}x`,
    }
  }

  private tickCascadeDetected(
    pair: string, state: SniperState, cfg: SniperModeConfig, now: number, midPrice: number
  ): SniperOutput {
    const cluster = state.targetCluster!
    const elapsed = now - state.cascadeStartTime

    // Timeout: 5 min without reaching cluster
    if (elapsed > 5 * 60 * 1000) {
      this.resetToWatching(state)
      return { ...INACTIVE_OUTPUT, phase: 'WATCHING', reason: 'cascade timeout (5min)' }
    }

    // Update peak price
    if (state.cascadeDirection === 'up') {
      state.cascadePeakPrice = Math.max(state.cascadePeakPrice, midPrice)
    } else {
      state.cascadePeakPrice = Math.min(state.cascadePeakPrice, midPrice)
    }

    // Check if price entered cluster zone (|distancePct| < 0.5%)
    // Recalculate distance from current price to cluster price
    const distToCluster = ((cluster.price - midPrice) / midPrice) * 100
    if (Math.abs(distToCluster) > 0.5) {
      return {
        active: true,
        phase: 'CASCADE_DETECTED',
        bidMultOverride: 1.0,
        askMultOverride: 1.0,
        sizeCapPct: 1.0,
        overrideLiqGravity: false,
        exitUrgent: false,
        reason: `approaching cluster dist=${Math.abs(distToCluster).toFixed(2)}% peak=${state.cascadePeakPrice.toFixed(6)}`,
      }
    }

    // Price entered cluster zone -> SNIPER_ARMED
    state.phase = 'SNIPER_ARMED'
    state.entryArmedTime = now

    return {
      active: true,
      phase: 'SNIPER_ARMED',
      bidMultOverride: 1.0,
      askMultOverride: 1.0,
      sizeCapPct: 1.0,
      overrideLiqGravity: false,
      exitUrgent: false,
      reason: `entered cluster zone — watching for exhaustion reversal`,
    }
  }

  private tickSniperArmed(
    pair: string, state: SniperState, cfg: SniperModeConfig, now: number,
    midPrice: number, actualSkew: number
  ): SniperOutput {
    // Timeout: 5 min in armed state
    if (now - state.entryArmedTime > 5 * 60 * 1000) {
      this.resetToWatching(state)
      return { ...INACTIVE_OUTPUT, phase: 'WATCHING', reason: 'armed timeout (5min)' }
    }

    // Keep tracking peak
    if (state.cascadeDirection === 'up') {
      state.cascadePeakPrice = Math.max(state.cascadePeakPrice, midPrice)
    } else {
      state.cascadePeakPrice = Math.min(state.cascadePeakPrice, midPrice)
    }

    // Check for reversal from peak
    let reversalPct: number
    if (state.cascadeDirection === 'up') {
      // Price pumped into SHORT cluster, now reversing down
      reversalPct = ((state.cascadePeakPrice - midPrice) / state.cascadePeakPrice) * 100
    } else {
      // Price dumped into LONG cluster, now reversing up
      reversalPct = ((midPrice - state.cascadePeakPrice) / state.cascadePeakPrice) * 100
    }

    if (reversalPct < cfg.reversalThresholdPct) {
      return {
        active: true,
        phase: 'SNIPER_ARMED',
        bidMultOverride: 1.0,
        askMultOverride: 1.0,
        sizeCapPct: 1.0,
        overrideLiqGravity: false,
        exitUrgent: false,
        reason: `waiting reversal=${reversalPct.toFixed(3)}% < ${cfg.reversalThresholdPct}% peak=${state.cascadePeakPrice.toFixed(6)}`,
      }
    }

    // Must be flat to enter
    if (Math.abs(actualSkew) > 0.10) {
      return {
        active: true,
        phase: 'SNIPER_ARMED',
        bidMultOverride: 1.0,
        askMultOverride: 1.0,
        sizeCapPct: 1.0,
        overrideLiqGravity: false,
        exitUrgent: false,
        reason: `reversal confirmed but not flat (skew=${(actualSkew * 100).toFixed(1)}%)`,
      }
    }

    // Exhaustion confirmed! -> ENTRY_ACTIVE
    state.phase = 'ENTRY_ACTIVE'
    state.entryArmedTime = now

    // SHORT cluster squeezed (price pumped up) -> enter SHORT (price will drop back)
    // LONG cluster dumped (price dropped) -> enter LONG (price will bounce back)
    if (state.cascadeDirection === 'up') {
      state.entryDirection = 'short'
    } else {
      state.entryDirection = 'long'
    }

    const bidMult = state.entryDirection === 'long' ? 3.0 : 0.0
    const askMult = state.entryDirection === 'short' ? 3.0 : 0.0

    return {
      active: true,
      phase: 'ENTRY_ACTIVE',
      bidMultOverride: bidMult,
      askMultOverride: askMult,
      sizeCapPct: cfg.maxPositionPct,
      overrideLiqGravity: true,
      exitUrgent: false,
      reason: `EXHAUSTION CONFIRMED reversal=${reversalPct.toFixed(2)}% -> entering ${state.entryDirection.toUpperCase()} | peak=${state.cascadePeakPrice.toFixed(6)}`,
    }
  }

  private tickEntryActive(
    pair: string, state: SniperState, cfg: SniperModeConfig, now: number,
    midPrice: number, actualSkew: number
  ): SniperOutput {
    // Timeout: 3 min no fill
    if (now - state.entryArmedTime > 3 * 60 * 1000) {
      this.resetToWatching(state)
      return { ...INACTIVE_OUTPUT, phase: 'WATCHING', reason: 'entry timeout (3min, no fill)' }
    }

    // Check for fill: |actualSkew| > 0.05 in expected direction
    const filled = state.entryDirection === 'short'
      ? actualSkew < -0.05
      : actualSkew > 0.05

    if (!filled) {
      const bidMult = state.entryDirection === 'long' ? 3.0 : 0.0
      const askMult = state.entryDirection === 'short' ? 3.0 : 0.0
      return {
        active: true,
        phase: 'ENTRY_ACTIVE',
        bidMultOverride: bidMult,
        askMultOverride: askMult,
        sizeCapPct: cfg.maxPositionPct,
        overrideLiqGravity: true,
        exitUrgent: false,
        reason: `waiting for fill (skew=${(actualSkew * 100).toFixed(1)}%) dir=${state.entryDirection}`,
      }
    }

    // Fill detected -> POSITION_HELD
    state.phase = 'POSITION_HELD'
    state.entryPrice = midPrice
    state.entryTime = now
    state.bestPriceSinceEntry = midPrice
    state.trailingActivated = false

    return this.tickPositionHeld(pair, state, cfg, now, midPrice, actualSkew)
  }

  private tickPositionHeld(
    pair: string, state: SniperState, cfg: SniperModeConfig, now: number,
    midPrice: number, actualSkew: number
  ): SniperOutput {
    const elapsed = (now - state.entryTime) / 60_000 // minutes

    // External close check: |actualSkew| < 0.03
    if (Math.abs(actualSkew) < 0.03) {
      this.transitionToCooldown(state, cfg, now)
      return { ...INACTIVE_OUTPUT, phase: 'COOLDOWN', reason: `position externally closed (skew=${(actualSkew * 100).toFixed(1)}%)` }
    }

    // Calculate PnL %
    let pnlPct: number
    if (state.entryDirection === 'short') {
      pnlPct = ((state.entryPrice - midPrice) / state.entryPrice) * 100
      state.bestPriceSinceEntry = Math.min(state.bestPriceSinceEntry, midPrice)
    } else {
      pnlPct = ((midPrice - state.entryPrice) / state.entryPrice) * 100
      state.bestPriceSinceEntry = Math.max(state.bestPriceSinceEntry, midPrice)
    }

    // Hard stop
    if (pnlPct < -cfg.hardStopPct) {
      const exitBid = state.entryDirection === 'short' ? 3.0 : 0.0
      const exitAsk = state.entryDirection === 'short' ? 0.0 : 3.0
      this.transitionToCooldown(state, cfg, now)
      return {
        active: true,
        phase: 'COOLDOWN',
        bidMultOverride: exitBid,
        askMultOverride: exitAsk,
        sizeCapPct: 1.0,
        overrideLiqGravity: true,
        exitUrgent: true,
        reason: `HARD STOP pnl=${pnlPct.toFixed(2)}% < -${cfg.hardStopPct}%`,
      }
    }

    // Duration stop
    if (elapsed > cfg.maxHoldMinutes) {
      const exitBid = state.entryDirection === 'short' ? 3.0 : 0.0
      const exitAsk = state.entryDirection === 'short' ? 0.0 : 3.0
      this.transitionToCooldown(state, cfg, now)
      return {
        active: true,
        phase: 'COOLDOWN',
        bidMultOverride: exitBid,
        askMultOverride: exitAsk,
        sizeCapPct: 1.0,
        overrideLiqGravity: true,
        exitUrgent: false,
        reason: `DURATION STOP ${elapsed.toFixed(1)}min > ${cfg.maxHoldMinutes}min | pnl=${pnlPct.toFixed(2)}%`,
      }
    }

    // Trailing stop
    if (pnlPct >= cfg.trailingActivatePct) {
      state.trailingActivated = true
    }

    if (state.trailingActivated) {
      // Calculate retrace from best
      let retracePct: number
      if (state.entryDirection === 'short') {
        retracePct = ((midPrice - state.bestPriceSinceEntry) / state.bestPriceSinceEntry) * 100
      } else {
        retracePct = ((state.bestPriceSinceEntry - midPrice) / state.bestPriceSinceEntry) * 100
      }

      if (retracePct >= cfg.trailingStopPct) {
        const exitBid = state.entryDirection === 'short' ? 3.0 : 0.0
        const exitAsk = state.entryDirection === 'short' ? 0.0 : 3.0
        this.transitionToCooldown(state, cfg, now)
        return {
          active: true,
          phase: 'COOLDOWN',
          bidMultOverride: exitBid,
          askMultOverride: exitAsk,
          sizeCapPct: 1.0,
          overrideLiqGravity: true,
          exitUrgent: false,
          reason: `TRAILING STOP retrace=${retracePct.toFixed(2)}% pnl=${pnlPct.toFixed(2)}%`,
        }
      }
    }

    // Hold position — keep neutral multipliers (let grid manage)
    return {
      active: true,
      phase: 'POSITION_HELD',
      bidMultOverride: 1.0,
      askMultOverride: 1.0,
      sizeCapPct: cfg.maxPositionPct,
      overrideLiqGravity: true,
      exitUrgent: false,
      reason: `holding ${state.entryDirection.toUpperCase()} pnl=${pnlPct.toFixed(2)}% elapsed=${elapsed.toFixed(1)}min trail=${state.trailingActivated ? 'ON' : 'off'}`,
    }
  }

  private tickCooldown(
    pair: string, state: SniperState, cfg: SniperModeConfig, now: number
  ): SniperOutput {
    if (now >= state.cooldownUntil) {
      this.resetToWatching(state)
      return { ...INACTIVE_OUTPUT, phase: 'WATCHING', reason: 'cooldown expired' }
    }

    const remaining = Math.ceil((state.cooldownUntil - now) / 60_000)
    return {
      ...INACTIVE_OUTPUT,
      phase: 'COOLDOWN',
      reason: `cooldown ${remaining}min remaining`,
    }
  }

  private resetToWatching(state: SniperState): void {
    const s = defaultState()
    Object.assign(state, s)
  }

  private transitionToCooldown(state: SniperState, cfg: SniperModeConfig, now: number): void {
    state.phase = 'COOLDOWN'
    state.cooldownUntil = now + cfg.cooldownMinutes * 60_000
  }

  /** Get recent price move % over a time window from priceHistory */
  private getRecentMove(
    priceHistory: { price: number; ts: number }[],
    windowMs: number
  ): number | null {
    if (priceHistory.length < 2) return null
    const now = Date.now()
    const cutoff = now - windowMs
    const recent = priceHistory.filter(p => p.ts >= cutoff)
    if (recent.length < 2) return null
    const oldest = recent[0].price
    const newest = recent[recent.length - 1].price
    if (oldest <= 0) return null
    return ((newest - oldest) / oldest) * 100
  }
}
