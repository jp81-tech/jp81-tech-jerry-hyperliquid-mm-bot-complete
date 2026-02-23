// ============================================================
// kPEPE TOXICITY ENGINE
// Detects toxic flow patterns and adjusts grid parameters.
// Infers toxicity from fill PATTERNS (no counterparty addresses
// available on Hyperliquid fills).
// ============================================================

export interface KpepeFillEvent {
  timestamp: number
  side: 'buy' | 'sell'
  price: number
  sizeUsd: number
  midPriceAtFill: number
  isAdverse: boolean
}

export interface KpepeToxicityState {
  recentFills: KpepeFillEvent[]
  consecutiveToxicFills: number
  lastFillTime: number
  toxicityLevel: 'NORMAL' | 'ELEVATED' | 'HIGH' | 'CRITICAL' | 'PAUSED'
  cooldownUntil: number
  spreadMultOverride: number
  hedgePending: boolean
  lastHedgeTime: number
}

export interface KpepeToxicityOutput {
  spreadMult: number
  sizeMultBid: number
  sizeMultAsk: number
  removeLayers: number[]
  shouldPause: boolean
  shouldHedge: boolean
  hedgeSide: 'buy' | 'sell'
  hedgeSizeUsd: number
  reason: string
}

// Enhanced 10-zone time-of-day profile (replaces old 4-zone getKpepeTimeMultiplier)
export function getKpepeTimeZoneProfile(): { spreadMult: number; sizeMult: number } {
  const hour = new Date().getUTCHours()
  const zones: Record<number, { spreadMult: number; sizeMult: number }> = {
    0:  { spreadMult: 1.00, sizeMult: 1.00 },  // 00-02 UTC: cooldown
    2:  { spreadMult: 0.85, sizeMult: 1.10 },  // 02-04: Asia low -> tight
    4:  { spreadMult: 0.90, sizeMult: 1.05 },  // 04-06: Asia building
    6:  { spreadMult: 1.00, sizeMult: 1.00 },  // 06-08: Asia peak
    8:  { spreadMult: 1.05, sizeMult: 0.95 },  // 08-10: Europe open
    10: { spreadMult: 1.00, sizeMult: 1.00 },  // 10-12: Europe mid
    12: { spreadMult: 1.10, sizeMult: 0.90 },  // 12-14: US pre-market
    14: { spreadMult: 1.20, sizeMult: 0.85 },  // 14-16: US open (most toxic)
    16: { spreadMult: 1.15, sizeMult: 0.90 },  // 16-18: US mid
    18: { spreadMult: 1.10, sizeMult: 0.95 },  // 18-20: US wind-down
    20: { spreadMult: 1.05, sizeMult: 1.00 },  // 20-22: quiet
    22: { spreadMult: 1.00, sizeMult: 1.00 },  // 22-00: cooldown
  }
  const slot = Math.floor(hour / 2) * 2
  return zones[slot] || { spreadMult: 1.0, sizeMult: 1.0 }
}

const FILL_WINDOW_MS = 5 * 60 * 1000       // 5-minute rolling window
const RAPID_FILL_WINDOW_MS = 10 * 1000      // 10s for rapid fill detection
const SWEEP_WINDOW_MS = 30 * 1000           // 30s for sweep detection
const HEDGE_COOLDOWN_MS = 15 * 60 * 1000    // 15 min between hedges
const PAUSE_DURATION_MS = 120 * 1000        // 2 min pause on CRITICAL
const ADVERSE_MARK_OUT_BPS = 10             // 10bps move = adverse

export class KpepeToxicityEngine {
  private state: KpepeToxicityState = {
    recentFills: [],
    consecutiveToxicFills: 0,
    lastFillTime: 0,
    toxicityLevel: 'NORMAL',
    cooldownUntil: 0,
    spreadMultOverride: 1.0,
    hedgePending: false,
    lastHedgeTime: 0,
  }

  private output: KpepeToxicityOutput = this.defaultOutput()

  private defaultOutput(): KpepeToxicityOutput {
    return {
      spreadMult: 1.0,
      sizeMultBid: 1.0,
      sizeMultAsk: 1.0,
      removeLayers: [],
      shouldPause: false,
      shouldHedge: false,
      hedgeSide: 'buy',
      hedgeSizeUsd: 0,
      reason: '',
    }
  }

  // Called on every kPEPE fill from WebSocket
  recordFill(fill: Omit<KpepeFillEvent, 'isAdverse'>): void {
    const now = Date.now()

    // Classify as adverse: did price move against our fill?
    // For BUY: adverse if mid was above our fill price (we bought high)
    // For SELL: adverse if mid was below our fill price (we sold low)
    const markOut = fill.side === 'buy'
      ? (fill.midPriceAtFill - fill.price) / fill.midPriceAtFill
      : (fill.price - fill.midPriceAtFill) / fill.midPriceAtFill
    const isAdverse = markOut < -(ADVERSE_MARK_OUT_BPS / 10000)

    const event: KpepeFillEvent = { ...fill, isAdverse }
    this.state.recentFills.push(event)
    this.state.lastFillTime = now

    // Prune old fills
    this.state.recentFills = this.state.recentFills.filter(
      f => now - f.timestamp < FILL_WINDOW_MS
    )

    // Update consecutive toxic counter
    if (isAdverse) {
      this.state.consecutiveToxicFills++
    } else {
      this.state.consecutiveToxicFills = 0
    }
  }

  // Called every main loop tick
  tick(
    vpinLevel: 'LOW' | 'NORMAL' | 'ELEVATED' | 'HIGH' | 'CRITICAL',
    adverseMult: number,
    fundingRate: number,
    oiChange1h: number,
    momentum1h: number,
    actualSkew: number,
    skewDurationMin: number,
  ): void {
    const now = Date.now()
    const out = this.defaultOutput()
    const reasons: string[] = []

    // Check if we're in cooldown pause
    if (this.state.cooldownUntil > now) {
      out.shouldPause = true
      out.reason = `COOLDOWN ${((this.state.cooldownUntil - now) / 1000).toFixed(0)}s remaining`
      this.state.toxicityLevel = 'PAUSED'
      this.output = out
      return
    }

    // ── 1. CONSECUTIVE TOXIC FILL ESCALATION ────────────────────────
    const consec = this.state.consecutiveToxicFills
    if (consec >= 10) {
      out.shouldPause = true
      this.state.cooldownUntil = now + PAUSE_DURATION_MS
      this.state.toxicityLevel = 'CRITICAL'
      reasons.push(`consec=${consec}->PAUSE`)
    } else if (consec >= 7) {
      out.spreadMult += 0.40
      out.removeLayers = [1, 2]
      this.state.toxicityLevel = 'HIGH'
      reasons.push(`consec=${consec}->removeL1,2`)
    } else if (consec >= 5) {
      out.spreadMult += 0.30
      out.removeLayers = [1]
      this.state.toxicityLevel = 'ELEVATED'
      reasons.push(`consec=${consec}->removeL1`)
    } else if (consec >= 3) {
      out.spreadMult += 0.20
      this.state.toxicityLevel = 'ELEVATED'
      reasons.push(`consec=${consec}->widen`)
    }

    // ── 2. RAPID FILL DETECTION ─────────────────────────────────────
    const rapidFills = this.state.recentFills.filter(
      f => now - f.timestamp < RAPID_FILL_WINDOW_MS
    )
    if (rapidFills.length >= 3) {
      out.spreadMult += 0.30
      if (!out.removeLayers.includes(1)) out.removeLayers.push(1)
      reasons.push(`rapid=${rapidFills.length}in10s`)
    }

    // ── 3. SWEEP DETECTION ──────────────────────────────────────────
    // Fills hitting 3+ different layers within 30s
    const sweepFills = this.state.recentFills.filter(
      f => now - f.timestamp < SWEEP_WINDOW_MS
    )
    if (sweepFills.length >= 3) {
      // Calculate price spread of recent fills to detect sweep across layers
      const prices = sweepFills.map(f => f.price)
      const priceRange = Math.max(...prices) - Math.min(...prices)
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length
      const rangeBps = avgPrice > 0 ? (priceRange / avgPrice) * 10000 : 0

      // If fills span >20bps range, it's a multi-layer sweep
      if (rangeBps > 20) {
        out.spreadMult += 0.50
        reasons.push(`sweep=${sweepFills.length}fills/${rangeBps.toFixed(0)}bps`)
      }
    }

    // ── 4. COORDINATED ATTACK DETECTION ─────────────────────────────
    const vpinHigh = vpinLevel === 'HIGH' || vpinLevel === 'CRITICAL'
    const adverseActive = adverseMult > 1.0
    const hasRapid = rapidFills.length >= 3
    if (vpinHigh && adverseActive && hasRapid) {
      out.shouldPause = true
      this.state.cooldownUntil = now + PAUSE_DURATION_MS
      this.state.toxicityLevel = 'CRITICAL'
      reasons.push(`COORDINATED(VPIN=${vpinLevel}+adverse+rapid)`)
    }

    // ── 5. VOLATILITY-BASED SIZE ────────────────────────────────────
    const absMom = Math.abs(momentum1h)
    if (absMom > 5) {
      out.sizeMultBid *= 0.40
      out.sizeMultAsk *= 0.40
      reasons.push(`vol=${momentum1h.toFixed(1)}%->size×0.40`)
    } else if (absMom > 3) {
      out.sizeMultBid *= 0.60
      out.sizeMultAsk *= 0.60
      reasons.push(`vol=${momentum1h.toFixed(1)}%->size×0.60`)
    }

    // ── 6. OI-BASED SPREAD ──────────────────────────────────────────
    if (oiChange1h > 10) {
      out.spreadMult += 0.15
      reasons.push(`OI+${oiChange1h.toFixed(1)}%->widen`)
    } else if (oiChange1h < -10) {
      out.spreadMult += 0.10
      reasons.push(`OI${oiChange1h.toFixed(1)}%->widen`)
    }

    // ── 7. FUNDING RATE ASYMMETRY ───────────────────────────────────
    if (fundingRate > 0.0001) {
      // Longs pay -> favor shorts (reduce bids)
      out.sizeMultBid *= 0.80
      reasons.push(`fund+${(fundingRate * 100).toFixed(4)}%->bid×0.80`)
    } else if (fundingRate < -0.0001) {
      // Shorts pay -> favor longs (reduce asks)
      out.sizeMultAsk *= 0.80
      reasons.push(`fund${(fundingRate * 100).toFixed(4)}%->ask×0.80`)
    }

    // ── 8. HEDGE TRIGGER ────────────────────────────────────────────
    if (
      Math.abs(actualSkew) > 0.50 &&
      skewDurationMin > 30 &&
      now - this.state.lastHedgeTime > HEDGE_COOLDOWN_MS &&
      !out.shouldPause
    ) {
      out.shouldHedge = true
      out.hedgeSide = actualSkew > 0 ? 'sell' : 'buy'
      // Hedge 20% of current position value — use skew as proxy
      // Actual position USD will be passed from caller, so use a relative size
      out.hedgeSizeUsd = 0 // Caller computes from position
      this.state.lastHedgeTime = now
      reasons.push(`HEDGE(skew=${(actualSkew * 100).toFixed(1)}%,${skewDurationMin.toFixed(0)}min)`)
    }

    // ── Clamp spread multiplier ─────────────────────────────────────
    out.spreadMult = Math.max(1.0, out.spreadMult)

    // Update toxicity level if not already set
    if (this.state.toxicityLevel !== 'CRITICAL' && this.state.toxicityLevel !== 'PAUSED') {
      if (out.spreadMult > 1.3) this.state.toxicityLevel = 'HIGH'
      else if (out.spreadMult > 1.1) this.state.toxicityLevel = 'ELEVATED'
      else this.state.toxicityLevel = 'NORMAL'
    }

    out.reason = reasons.join(' | ') || 'clean'
    this.output = out
  }

  getOutput(): KpepeToxicityOutput {
    return this.output
  }

  getConsecutiveToxic(): number {
    return this.state.consecutiveToxicFills
  }

  getToxicityLevel(): string {
    return this.state.toxicityLevel
  }

  reset(): void {
    this.state = {
      recentFills: [],
      consecutiveToxicFills: 0,
      lastFillTime: 0,
      toxicityLevel: 'NORMAL',
      cooldownUntil: 0,
      spreadMultOverride: 1.0,
      hedgePending: false,
      lastHedgeTime: 0,
    }
    this.output = this.defaultOutput()
  }
}
