// ============================================================
// CENTRALIZED SHORT-ONLY CONFIGURATION
// "Ostateczne Rozkazy" - All pairs follow Wice-Generał SHORT
// Single source of truth - change tokens HERE, not in 14 places
// ============================================================

/**
 * All tokens that are in SHORT-ONLY mode following SM.
 * Used by: HOLD_FOR_TP, SIGNAL_ENGINE_TOKENS,
 *          FORCE_SHORT_ONLY, MM_TOKENS, KNOWN_ACTIVE_TOKENS
 */
export const SHORT_ONLY_TOKENS: string[] = ['LIT', 'FARTCOIN', 'PUMP']

/**
 * All tokens that get HOLD_FOR_TP treatment.
 */
export const ALL_HOLD_FOR_TP_TOKENS: string[] = SHORT_ONLY_TOKENS

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

/**
 * Helper: check if a token is in SHORT_ONLY mode
 */
export function isShortOnlyToken(token: string): boolean {
  return SHORT_ONLY_TOKENS.includes(token.toUpperCase())
}

/**
 * Helper: check if a token gets HOLD_FOR_TP treatment
 */
export function isHoldForTpToken(token: string): boolean {
  return ALL_HOLD_FOR_TP_TOKENS.includes(token.toUpperCase())
}

// ============================================================
// SHORT-ON-BOUNCE FILTER
// "Nie goń dna, shortuj na bounce'u"
// SM traderzy czekają na odbicie i dopiero wtedy dodają shorty
// ============================================================

export interface BounceFilterConfig {
  chaseThreshold: number      // blokuj aski gdy change1h < tego (cena spada mocno)
  bounceThreshold: number     // pełne aski gdy change1h >= tego (odbicie potwierdzone)
  neutralAskMult: number      // mnożnik ask w strefie neutralnej
  enabled: boolean
}

export const BOUNCE_FILTER_DEFAULTS: BounceFilterConfig = {
  chaseThreshold: -2.0,
  bounceThreshold: 0.3,
  neutralAskMult: 0.5,
  enabled: true,
}

export const BOUNCE_FILTER_OVERRIDES: Record<string, Partial<BounceFilterConfig>> = {
  'FARTCOIN': { chaseThreshold: -3.0, bounceThreshold: 0.5 },
}

export function getBounceFilterConfig(token: string): BounceFilterConfig {
  return { ...BOUNCE_FILTER_DEFAULTS, ...(BOUNCE_FILTER_OVERRIDES[token.toUpperCase()] || {}) }
}
