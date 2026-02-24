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
