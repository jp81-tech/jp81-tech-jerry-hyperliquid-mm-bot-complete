// ============================================================
// SM FOLLOWING CONFIGURATION
// Bot autonomously decides SHORT or LONG based on SM data
// No hardcoded token lists - SmAutoDetector handles direction
// ============================================================

// ============================================================
// RATIO MONITORING / ALERTS
// Tracks ratio changes and alerts when crossing thresholds
// ============================================================

export interface RatioAlert {
  token: string
  /** Alert when ratio drops BELOW this value */
  threshold: number
  /** Log message when threshold crossed */
  message: string
}

/**
 * Active ratio alerts. Bot will log a loud warning when a token's
 * SM short/long ratio drops below the configured threshold.
 * Alerts fire once per crossing + repeat every 5 minutes while below.
 */
export const RATIO_ALERTS: RatioAlert[] = [
  { token: 'LIT', threshold: 3.5, message: 'LIT ratio spadl ponizej 3.5x - rozwaz redukcje pozycji!' },
]

/** Cooldown between repeated alerts for the same token (ms) */
export const RATIO_ALERT_COOLDOWN_MS = 5 * 60 * 1000  // 5 minutes

// ============================================================
// SHORT-ON-BOUNCE FILTER
// "Nie goń dna, shortuj na bounce'u"
// SM traderzy czekają na odbicie i dopiero wtedy dodają shorty
// Applied when SM mode is FOLLOW_SM_SHORT
// ============================================================

export interface BounceFilterConfig {
  chaseThreshold: number      // blokuj aski gdy change1h < tego (cena spada mocno)
  bounceThreshold: number     // pełne aski gdy change1h >= tego (odbicie potwierdzone)
  neutralAskMult: number      // mnożnik ask w strefie neutralnej
  fadingDropPct: number       // % spadku od szczytu bounce = potwierdzenie szczytu (np. 0.15 = 0.15%)
  risingAskMult: number       // mnożnik ask gdy bounce wciąż rośnie (czekamy na szczyt)
  enabled: boolean
}

export const BOUNCE_FILTER_DEFAULTS: BounceFilterConfig = {
  chaseThreshold: 0.0,         // blokuj shorty gdy 1h < 0% (czerwona świeczka = nie shortuj!)
  bounceThreshold: 0.3,
  neutralAskMult: 0.5,
  fadingDropPct: 0.15,        // 0.15% pullback od szczytu = bounce się kończy → shortuj
  risingAskMult: 0.25,        // 25% mocy gdy bounce wciąż rośnie (nie goń szczytu)
  enabled: true,
}

export const BOUNCE_FILTER_OVERRIDES: Record<string, Partial<BounceFilterConfig>> = {
  'FARTCOIN': { bounceThreshold: 0.5 },
  'BTC': { fadingDropPct: 0.10 },      // BTC: tighter — 0.10% drop = fading
  'ETH': { fadingDropPct: 0.12 },      // ETH: tighter — 0.12% drop = fading
}

export function getBounceFilterConfig(token: string): BounceFilterConfig {
  return { ...BOUNCE_FILTER_DEFAULTS, ...(BOUNCE_FILTER_OVERRIDES[token.toUpperCase()] || {}) }
}

// ============================================================
// LONG-ON-DIP FILTER (mirror of BOUNCE_FILTER)
// "Nie goń szczytu, kupuj na dipie"
// SM traderzy czekają na korektę i dopiero wtedy kupują
// Applied when SM mode is FOLLOW_SM_LONG
// ============================================================

export interface DipFilterConfig {
  chaseThreshold: number      // blokuj bidy gdy change1h > tego (cena rośnie mocno)
  dipThreshold: number        // pełne bidy gdy change1h <= tego (korekta potwierdzona)
  neutralBidMult: number      // mnożnik bid w strefie neutralnej
  enabled: boolean
}

export const DIP_FILTER_DEFAULTS: DipFilterConfig = {
  chaseThreshold: 0.0,        // blokuj longi gdy 1h > 0% (zielona świeczka = nie longuj!)
  dipThreshold: -0.3,         // pełne bidy gdy 1h <= -0.3% (korekta)
  neutralBidMult: 0.5,
  enabled: true,
}

export const DIP_FILTER_OVERRIDES: Record<string, Partial<DipFilterConfig>> = {
  'SOL': { dipThreshold: -0.5 },
}

export function getDipFilterConfig(token: string): DipFilterConfig {
  return { ...DIP_FILTER_DEFAULTS, ...(DIP_FILTER_OVERRIDES[token.toUpperCase()] || {}) }
}

// ============================================================
// FUNDING RATE FILTER
// "Nie wchodź gdy funding płaci przeciwko tobie"
// Blocks entries when funding is extreme in the WRONG direction
// SHORT blocked when funding very negative (shorts crowded)
// LONG blocked when funding very positive (longs crowded)
// ============================================================

export interface FundingFilterConfig {
  /** Block entry when |funding| exceeds this against our direction */
  crowdedThreshold: number
  /** Reduce size when |funding| exceeds this against our direction */
  cautionThreshold: number
  /** Size multiplier in caution zone */
  cautionMult: number
  enabled: boolean
}

export const FUNDING_FILTER_DEFAULTS: FundingFilterConfig = {
  crowdedThreshold: 0.0005,   // 0.05%/8h — very crowded, block entry
  cautionThreshold: 0.0001,   // 0.01%/8h — somewhat crowded, reduce size
  cautionMult: 0.5,
  enabled: true,
}

export const FUNDING_FILTER_OVERRIDES: Record<string, Partial<FundingFilterConfig>> = {
  'KPEPE': {
    crowdedThreshold: 0.0003,   // 0.03% (tighter — memecoins have wild funding)
    cautionThreshold: 0.0001,   // 0.01%
    cautionMult: 0.70,          // More aggressive reduction
    enabled: true
  }
}

export function getFundingFilterConfig(token: string): FundingFilterConfig {
  return { ...FUNDING_FILTER_DEFAULTS, ...(FUNDING_FILTER_OVERRIDES[token.toUpperCase()] || {}) }
}

// ============================================================
// FIB GUARD — nie shortuj dna
// Redukuje aski gdy cena jest blisko Fib support + RSI oversold
// SM Override: wysoki SM confidence wylacza guard
// ============================================================

export interface FibGuardConfig {
  proximityBps: number     // ile bps od Fib level = "blisko" (default 50 = 0.5%)
  rsiOversoldThreshold: number  // RSI ponizej tego = oversold (default 30)
  rsiNeutralThreshold: number   // RSI powyzej tego = nie oversold (default 45)
  drawdownMinPct: number   // min drawdown od high24h zeby guard sie wlaczyl (default 2%)
  drawdownMaxPct: number   // drawdown dajacy max score (default 8%)
  smOverrideConfidence: number  // SM confidence >= tego → guard OFF (default 70)
  smSoftenConfidence: number    // SM confidence >= tego → guard × 0.5 (default 50)
  strongGuardMult: number  // askMult gdy score >= 0.7 (default 0.15)
  moderateGuardMult: number // askMult gdy score >= 0.5 (default 0.30)
  lightGuardMult: number   // askMult gdy score >= 0.3 (default 0.50)
  enabled: boolean
}

export const FIB_GUARD_DEFAULTS: FibGuardConfig = {
  proximityBps: 50,        // 0.5% od Fib level
  rsiOversoldThreshold: 30,
  rsiNeutralThreshold: 45,
  drawdownMinPct: 2.0,
  drawdownMaxPct: 8.0,
  smOverrideConfidence: 70,
  smSoftenConfidence: 50,
  strongGuardMult: 0.15,
  moderateGuardMult: 0.30,
  lightGuardMult: 0.50,
  enabled: true,
}

export const FIB_GUARD_OVERRIDES: Record<string, Partial<FibGuardConfig>> = {
  'BTC': { proximityBps: 30, drawdownMaxPct: 5.0 },   // BTC: tighter proximity, smaller drawdown
  'ETH': { proximityBps: 35, drawdownMaxPct: 6.0 },
  'LIT': { proximityBps: 80, drawdownMaxPct: 12.0 },   // LIT: wider — volatile memecoin
  'FARTCOIN': { proximityBps: 80, drawdownMaxPct: 12.0 },
}

export function getFibGuardConfig(token: string): FibGuardConfig {
  return { ...FIB_GUARD_DEFAULTS, ...(FIB_GUARD_OVERRIDES[token.toUpperCase()] || {}) }
}

// ============================================================
// PUMP SHIELD — bid protection during rapid price rises
// Blocks/reduces bids when price pumps while holding SHORT
// Prevents grid bids from closing shorts at the top of a pump
// Scale-in: optionally increases asks during pump (like 58bro)
// ============================================================

export interface PumpShieldConfig {
  enabled: boolean

  // Detection: % price rise over N ticks to trigger
  lightPumpPct: number          // e.g., 1.0% — light bid reduction
  moderatePumpPct: number       // e.g., 2.0% — heavy bid reduction
  aggressivePumpPct: number     // e.g., 3.5% — block all bids

  // Reaction: bid multiplier per level
  lightBidMult: number          // 0.50 — reduce 50%
  moderateBidMult: number       // 0.10 — reduce 90%
  aggressiveBidMult: number     // 0.00 — block all bids

  // Scale-in: increase asks during pump (like 58bro)
  scaleInEnabled: boolean
  scaleInAskMult: number        // 1.30 — increase asks 30%

  // Detection window
  windowTicks: number           // 5 ticks (5 min at 60s interval)

  // Cooldown: ticks after pump before restoring bids
  cooldownTicks: number         // 3 ticks (3 min)

  // SM integration: only activate when SM confidence >= this
  smMinConfidence: number       // 40% — even low SM SHORT confidence activates
}

const PUMP_SHIELD_DEFAULTS: PumpShieldConfig = {
  enabled: true,
  lightPumpPct: 1.0,
  moderatePumpPct: 2.0,
  aggressivePumpPct: 3.5,
  lightBidMult: 0.50,
  moderateBidMult: 0.10,
  aggressiveBidMult: 0.00,
  scaleInEnabled: true,
  scaleInAskMult: 1.30,
  windowTicks: 5,
  cooldownTicks: 3,
  smMinConfidence: 40,
}

const PUMP_SHIELD_OVERRIDES: Record<string, Partial<PumpShieldConfig>> = {
  'BTC':      { lightPumpPct: 0.5, moderatePumpPct: 1.0, aggressivePumpPct: 2.0 },
  'ETH':      { lightPumpPct: 0.6, moderatePumpPct: 1.2, aggressivePumpPct: 2.5 },
  'SOL':      { lightPumpPct: 0.8, moderatePumpPct: 1.5, aggressivePumpPct: 3.0 },
  'HYPE':     { lightPumpPct: 1.0, moderatePumpPct: 2.0, aggressivePumpPct: 3.5 },
  'LIT':      { lightPumpPct: 1.5, moderatePumpPct: 3.0, aggressivePumpPct: 5.0 },
  'FARTCOIN': { lightPumpPct: 1.5, moderatePumpPct: 3.0, aggressivePumpPct: 5.0 },
  'kPEPE':    { lightPumpPct: 2.0, moderatePumpPct: 4.0, aggressivePumpPct: 6.0, scaleInEnabled: false },
  'MON':      { lightPumpPct: 1.5, moderatePumpPct: 3.0, aggressivePumpPct: 5.0 },
}

export function getPumpShieldConfig(pair: string): PumpShieldConfig {
  const overrides = PUMP_SHIELD_OVERRIDES[pair] || {}
  return { ...PUMP_SHIELD_DEFAULTS, ...overrides }
}

// ============================================================
// MOMENTUM GUARD — asymetryczny grid na podstawie trendu
// "Nie kupuj szczytów, nie shortuj dna"
// Redukuje bidy gdy cena rośnie (overbought / near resistance)
// Redukuje aski gdy cena spada (oversold / near support)
// Applied to PURE_MM tokens (kPEPE) — SM tokens use HOLD_FOR_TP
// ============================================================

export interface MomentumGuardConfig {
  enabled: boolean
  pumpThresholdPct: number        // change1h % for max score (e.g. 3.0 for kPEPE)
  rsiOverboughtThreshold: number  // RSI above this → reduce bids (default 65)
  rsiOversoldThreshold: number    // RSI below this → reduce asks (default 35)
  // Multipliers at each momentum level (pump side shown, dump is mirrored)
  strongBidMult: number           // bid mult when strong pump (default 0.10)
  strongAskMult: number           // ask mult when strong pump (default 1.30)
  moderateBidMult: number         // bid mult when moderate pump (default 0.40)
  moderateAskMult: number         // ask mult when moderate pump (default 1.15)
  lightBidMult: number            // bid mult when light pump (default 0.70)
  lightAskMult: number            // ask mult when light pump (default 1.05)
  // Score thresholds
  strongThreshold: number         // |score| >= this → strong (default 0.7)
  moderateThreshold: number       // |score| >= this → moderate (default 0.4)
  lightThreshold: number          // |score| >= this → light (default 0.2)
}

export const MOMENTUM_GUARD_DEFAULTS: MomentumGuardConfig = {
  enabled: true,
  pumpThresholdPct: 2.0,
  rsiOverboughtThreshold: 65,
  rsiOversoldThreshold: 35,
  strongBidMult: 0.10,
  strongAskMult: 1.30,
  moderateBidMult: 0.40,
  moderateAskMult: 1.15,
  lightBidMult: 0.70,
  lightAskMult: 1.05,
  strongThreshold: 0.7,
  moderateThreshold: 0.4,
  lightThreshold: 0.2,
}

export const MOMENTUM_GUARD_OVERRIDES: Record<string, Partial<MomentumGuardConfig>> = {
  'kPEPE': { pumpThresholdPct: 3.0 },  // Memecoin: wider threshold (higher normal vol)
}

export function getMomentumGuardConfig(token: string): MomentumGuardConfig {
  return { ...MOMENTUM_GUARD_DEFAULTS, ...(MOMENTUM_GUARD_OVERRIDES[token] || {}) }
}
