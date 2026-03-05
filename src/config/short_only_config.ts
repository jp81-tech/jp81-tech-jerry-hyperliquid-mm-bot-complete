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
  pumpThresholdPct: number        // change1h % for max score — fallback when ATR unavailable (e.g. 3.0 for kPEPE)
  useAtrThreshold: boolean        // true = derive pumpThreshold from 1.5×ATR% (adapts to vol regime)
  atrThresholdMult: number        // multiplier for ATR-based threshold (default 1.5 = threshold at 1.5×ATR)
  dumpSensitivityMult: number     // asymmetry: dump threshold = pumpThreshold × this (default 0.7 = react 30% faster to dumps)
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
  // Dynamic TP (Spread Widener): widen closing-side spread during micro-reversal
  tpSpreadWidenerEnabled: boolean // default true
  tpSpreadMult: number            // closing-side spread multiplier during micro-reversal (default 1.5 = 50% wider)
  // Inventory SL (Panic Mode): force-close when skew + drawdown exceed ATR-based thresholds
  inventorySlEnabled: boolean     // default true
  maxSkewSlThreshold: number      // |skew| must exceed this to arm panic mode (default 0.40 = 40%)
  slAtrMultiplier: number         // drawdown threshold = slAtrMult × ATR% (default 2.5)
  panicClosingMult: number        // increase closing-side size by this mult in panic (default 2.0)
  // Auto-Skewing (Inventory Price Shifting): shift grid center based on position
  autoSkewEnabled: boolean        // default true
  autoSkewShiftBps: number        // bps shift per 10% skew (default 2.0 → 30% skew = 6bps shift)
  autoSkewMaxShiftBps: number     // max safe shift cap (default 15.0 bps = 0.15%)
  // S/R Progressive Reduction: take profit by closing position approaching S/R
  srReductionEnabled: boolean         // Enable S/R progressive reduction (default true)
  srReductionStartAtr: number         // Start reduction zone at N × ATR from S/R (default 3.0)
  srMaxRetainPct: number              // Max position to retain at S/R level (default 0.20 = 20%)
  srClosingBoostMult: number          // Closing-side multiplier boost at S/R (default 2.0)
  // S/R Accumulation: build position at S/R when flat/small
  srAccumulationEnabled: boolean       // Enable S/R accumulation (default true)
  srAccumBounceBoost: number           // Bounce-side size multiplier at S/R (default 1.5 = 50% more)
  srAccumCounterReduce: number         // Counter-side size multiplier at S/R (default 0.50 = 50% less)
  srAccumSpreadWiden: number           // Bounce-side spread widener at S/R (default 1.3 = 30% wider)
  srAccumFreshMultiplier: number       // Fresh touch multiplier: stronger accumulation when skew is low (first touch)
  srReductionGraceCandles: number      // Grace period after S/R break: wait N candles before reducing (assess fakeout vs real break)
  // Breakout TP: aggressively close on strong momentum aligned with position
  srBreakoutTpEnabled: boolean         // Enable breakout TP (default true)
  srBreakoutTpScoreThreshold: number   // Min |momentumScore| to trigger (default 0.50)
  srBreakoutTpClosingBoost: number     // Closing-side multiplier boost (default 1.5)
  // Inventory-Aware MG: override MG when position is against momentum
  inventoryAwareMgEnabled: boolean       // Enable inventory-aware override (default true)
  inventoryAwareMgThreshold: number      // Min |skew| to trigger (default 0.15 = 15%)
  inventoryAwareMgClosingBoost: number   // Max closing-side multiplier (default 1.3)
}

export const MOMENTUM_GUARD_DEFAULTS: MomentumGuardConfig = {
  enabled: true,
  pumpThresholdPct: 2.0,
  useAtrThreshold: true,          // Use ATR-derived threshold (adapts to vol regime)
  atrThresholdMult: 1.5,          // Threshold = 1.5 × ATR% (1h)
  dumpSensitivityMult: 0.7,       // Dumps react 30% faster (crypto falls faster than it rises)
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
  tpSpreadWidenerEnabled: true,
  tpSpreadMult: 1.5,             // 50% wider closing-side spread during micro-reversal
  inventorySlEnabled: true,
  maxSkewSlThreshold: 0.40,      // Arm panic when |skew| > 40%
  slAtrMultiplier: 2.5,          // Drawdown threshold = 2.5 × ATR%
  panicClosingMult: 2.0,         // 2× closing-side size in panic mode
  autoSkewEnabled: true,
  autoSkewShiftBps: 2.0,         // Shift 2 bps per 10% skew (30% skew → 6bps shift)
  autoSkewMaxShiftBps: 15.0,     // Max shift 15 bps (0.15%) — safety cap
  srReductionEnabled: true,
  srReductionStartAtr: 3.0,      // Start zone at 3×ATR from S/R
  srMaxRetainPct: 0.20,          // 20% max position at S/R level
  srClosingBoostMult: 2.0,       // 2× closing-side boost at S/R
  srAccumulationEnabled: true,
  srAccumBounceBoost: 1.5,       // 50% more on bounce side at S/R
  srAccumCounterReduce: 0.50,    // 50% less on counter side at S/R
  srAccumSpreadWiden: 1.3,       // 30% wider spread on bounce side at S/R
  srAccumFreshMultiplier: 2.0,   // Fresh touch: 2× boost when skew=0% (first touch of S/R)
  srReductionGraceCandles: 2,    // Wait 2 candles (~30 min at 15min candles) after S/R break before reducing
  srBreakoutTpEnabled: true,
  srBreakoutTpScoreThreshold: 0.50,  // Min |score| to trigger breakout TP
  srBreakoutTpClosingBoost: 1.5,     // 1.5× closing-side boost on breakout
  inventoryAwareMgEnabled: true,
  inventoryAwareMgThreshold: 0.15,     // 15% |skew| minimum to trigger
  inventoryAwareMgClosingBoost: 1.3,   // Max closing-side multiplier
}

export const MOMENTUM_GUARD_OVERRIDES: Record<string, Partial<MomentumGuardConfig>> = {
  'kPEPE': {
    pumpThresholdPct: 3.0,       // Memecoin: wider pump threshold (higher normal vol)
    atrThresholdMult: 2.0,       // 2× ATR for pump/dump detection
    moderateThreshold: 0.28,     // Lower than default 0.4 — proximity signal alone can trigger MODERATE
                                 // At support (prox=-0.80): score=-0.29 → MODERATE → bid×1.15 ask×0.40
                                 // Default 0.4 required momentum+RSI help → stuck in LIGHT at support
    autoSkewShiftBps: 1.5,       // Gentle skew — hold positions, don't rush to close (30% skew = 4.5bps shift)
    autoSkewMaxShiftBps: 10.0,   // Conservative cap — even at 80% skew, max 10bps shift
    srReductionStartAtr: 2.5,    // kPEPE: start earlier (volatile, moves fast)
    srMaxRetainPct: 0.08,        // 8% max at S/R (was 20% — too high, bot ran symmetric grid at -12% skew)
    srAccumBounceBoost: 1.8,         // kPEPE: more aggressive accumulation (strong bounce from support)
    srAccumFreshMultiplier: 3.0,     // kPEPE: 3× fresh touch boost (aggressive on first touch)
    srReductionGraceCandles: 3,      // kPEPE: 3 candles (~45 min) grace — volatile, fakeouts common
    srBreakoutTpScoreThreshold: 0.40, // kPEPE: trigger earlier (volatile, momentum is real sooner)
    inventoryAwareMgThreshold: 0.08,   // 8% (was 15% — INV_AWARE must kick in earlier for closing at S/R)
    inventoryAwareMgClosingBoost: 1.5,  // kPEPE: more aggressive closing when stuck against momentum
  },
}

export function getMomentumGuardConfig(token: string): MomentumGuardConfig {
  return { ...MOMENTUM_GUARD_DEFAULTS, ...(MOMENTUM_GUARD_OVERRIDES[token] || {}) }
}

// ============================================================
// DYNAMIC SPREAD — ATR-based grid layer scaling + min profit buffer
// Prevents fee-eating close orders in choppy/sideways markets.
// Applied to PURE_MM tokens (kPEPE).
//
// 3 mechanisms:
// 1) ATR-based L1 scaling: widen L1 when vol is low (choppy → fees eat spread)
// 2) Min Profit Buffer: remove close orders that would be < minProfitBps from entry
// 3) Don't Chase the Price: freeze TP at minimum profitable distance from entry
// ============================================================

export interface DynamicSpreadConfig {
  enabled: boolean

  // ATR-based L1 scaling
  atrScalingEnabled: boolean
  baseL1Bps: number              // Default L1 offset when ATR matches "normal" vol (18 bps)
  lowVolAtrPctThreshold: number  // ATR% below this = low vol (choppy) → widen L1
  highVolAtrPctThreshold: number // ATR% above this = high vol (trending) → tighten L1
  lowVolL1Bps: number            // L1 in low vol regime (wider = safer)
  highVolL1Bps: number           // L1 in high vol regime (tighter = capture more)
  // L2-L5 scale proportionally: L2 = L1 × l2Ratio, etc.
  l2Ratio: number                // L2/L1 ratio (default 1.67 = 30/18)
  l3Ratio: number                // L3/L1 ratio (default 2.50 = 45/18)
  l4Ratio: number                // L4/L1 ratio (default 3.61 = 65/18)
  l5Ratio: number                // L5/L1 ratio (default 8.33 = 150/18)

  // Min Profit Buffer: filter close orders below fee threshold
  minProfitEnabled: boolean
  minProfitBps: number           // Minimum distance from entry for close orders (default 10 bps)
  // 3.5 bps round-trip fee + 6.5 bps safety = 10 bps minimum

  // Don't Chase the Price: freeze TP at min profit distance
  tpFreezeEnabled: boolean
  // When position opened, calculate min profitable close price.
  // Grid re-centering cannot move close orders closer than this.
}

export const DYNAMIC_SPREAD_DEFAULTS: DynamicSpreadConfig = {
  enabled: true,

  atrScalingEnabled: true,
  baseL1Bps: 18,
  lowVolAtrPctThreshold: 0.30,   // ATR% < 0.30% = low vol (choppy)
  highVolAtrPctThreshold: 0.80,  // ATR% > 0.80% = high vol (big swings)
  lowVolL1Bps: 20,               // Low vol: moderate spread (fee protection)
  highVolL1Bps: 18,              // High vol: base spread (was 14 = too tight for memecoins)
  l2Ratio: 1.67,                 // 30/18
  l3Ratio: 2.50,                 // 45/18
  l4Ratio: 3.61,                 // 65/18
  l5Ratio: 8.33,                 // 150/18

  minProfitEnabled: true,
  minProfitBps: 10,              // 3.5 bps fee + 6.5 bps safety

  tpFreezeEnabled: true,
}

export const DYNAMIC_SPREAD_OVERRIDES: Record<string, Partial<DynamicSpreadConfig>> = {
  'kPEPE': {
    // Memecoin with 5-10% hourly swings needs WIDER spread in high vol
    // to avoid adverse selection (filling on every micro-move)
    lowVolL1Bps: 22,              // kPEPE even in low vol = wider than majors
    highVolL1Bps: 32,             // In high vol WIDEN (not tighten!) for memecoins
    highVolAtrPctThreshold: 1.20, // kPEPE "high vol" threshold is higher (normally more volatile)
  },
}

export function getDynamicSpreadConfig(token: string): DynamicSpreadConfig {
  return { ...DYNAMIC_SPREAD_DEFAULTS, ...(DYNAMIC_SPREAD_OVERRIDES[token] || {}) }
}
