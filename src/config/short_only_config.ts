// ============================================================
// CENTRALIZED SHORT-ONLY CONFIGURATION
// "Ostateczne Rozkazy" - All pairs follow Wice-Generał SHORT
// Single source of truth - change tokens HERE, not in 14 places
// ============================================================

/**
 * All tokens that are in SHORT-ONLY mode following Generals.
 * Used by: GENERALS_FORCE_SHORT, HOLD_FOR_TP, SIGNAL_ENGINE_TOKENS,
 *          FORCE_SHORT_ONLY, MM_TOKENS, KNOWN_ACTIVE_TOKENS
 */
export const SHORT_ONLY_TOKENS: string[] = ['HYPE', 'LIT', 'FARTCOIN', 'ENA', 'SUI']

/**
 * Tokens protected by STICKY_PAIRS (existing positions we protect).
 * These get HOLD_FOR_TP treatment but are managed separately
 * (not in GENERALS_FORCE_SHORT - won't aggressively open new shorts).
 */
export const STICKY_SHORT_TOKENS: string[] = ['PUMP']

/**
 * All tokens that get HOLD_FOR_TP treatment (SHORT_ONLY + STICKY).
 */
export const ALL_HOLD_FOR_TP_TOKENS: string[] = [...SHORT_ONLY_TOKENS, ...STICKY_SHORT_TOKENS]

/**
 * Max inventory per pair in USD for GENERALS_FORCE_SHORT.
 * With $10K equity across 6 pairs (5 manual + PUMP sticky):
 * ~$5K per pair at 2x leverage
 */
export const GENERALS_MAX_INVENTORY_USD = 5000

/**
 * Minimum short/long ratio required for GENERALS_OVERRIDE to force SHORT.
 * If SM ratio is below this (e.g. HYPE at 1.06x), skip the force override
 * and let normal analysis logic decide. Prevents shorting near-neutral tokens.
 */
export const GENERALS_MIN_SHORT_RATIO = 2.0

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
 * Helper: check if a token is in SHORT_ONLY mode (GENERALS_FORCE_SHORT)
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
  'HYPE':     { chaseThreshold: -3.0, bounceThreshold: 0.5 },
}

export function getBounceFilterConfig(token: string): BounceFilterConfig {
  return { ...BOUNCE_FILTER_DEFAULTS, ...(BOUNCE_FILTER_OVERRIDES[token.toUpperCase()] || {}) }
}
