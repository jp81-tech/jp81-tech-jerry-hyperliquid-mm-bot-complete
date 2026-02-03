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
  chaseThreshold: -2.0,
  bounceThreshold: 0.3,
  neutralAskMult: 0.5,
  fadingDropPct: 0.15,        // 0.15% pullback od szczytu = bounce się kończy → shortuj
  risingAskMult: 0.25,        // 25% mocy gdy bounce wciąż rośnie (nie goń szczytu)
  enabled: true,
}

export const BOUNCE_FILTER_OVERRIDES: Record<string, Partial<BounceFilterConfig>> = {
  'FARTCOIN': { chaseThreshold: -3.0, bounceThreshold: 0.5 },
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
  chaseThreshold: 2.0,        // blokuj kupowanie gdy 1h > +2%
  dipThreshold: -0.3,         // pełne bidy gdy 1h <= -0.3% (korekta)
  neutralBidMult: 0.5,
  enabled: true,
}

export const DIP_FILTER_OVERRIDES: Record<string, Partial<DipFilterConfig>> = {
  'SOL': { chaseThreshold: 3.0, dipThreshold: -0.5 },
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

export const FUNDING_FILTER_OVERRIDES: Record<string, Partial<FundingFilterConfig>> = {}

export function getFundingFilterConfig(token: string): FundingFilterConfig {
  return { ...FUNDING_FILTER_DEFAULTS, ...(FUNDING_FILTER_OVERRIDES[token.toUpperCase()] || {}) }
}
