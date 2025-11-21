/**
 * Behavioural Guard - Anti-FOMO / Anti-Knife Decision Module
 * 
 * Prevents the bot from:
 * - Buying into FOMO pumps (fear of missing out)
 * - Catching falling knives (buying during sharp drops)
 * - Trading when orderbook depth is too low
 * 
 * Two modes: normal (conservative) and aggressive (more sensitive)
 * Per-token configuration for ZEC, UNI, VIRTUAL
 */

export type BehaviourMode = 'normal' | 'aggressive'

export interface BehaviourProfile {
  fomo1mPct: number      // FOMO threshold 1m (%)
  fomo5mPct: number      // FOMO threshold 5m (%)
  knife1mPct: number     // Knife threshold 1m (%)
  knife5mPct: number     // Knife threshold 5m (%)
  minDepthRatio: number  // Min orderbook depth ratio
  fomoSpreadBoost: number // Spread multiplier for FOMO (e.g. 1.3 = 30% wider)
  knifeSuspendMinutes: number // Knife suspension duration (minutes)
}

export interface BehaviourCheckInput {
  pair: string
  mode: BehaviourMode
  ret1mPct: number       // zmiana ceny w % za 1m, np. 1.2 = +1.2%
  ret5mPct: number       // zmiana ceny w % za 5m
  depthRatio: number     // orderbookDepthUsd / baseOrderUsd
  nowMs: number
  knifeSuspendedUntilMs?: number
}

export interface BehaviourDecision {
  shouldQuote: boolean
  suppressBuys: boolean
  spreadBoost: number      // mnożnik na makerSpreadBps
  sizeMultiplier: number   // mnożnik na sizeUsd
  knifeSuspendedUntilMs?: number
  reason?: string
}

// ────────────────────────────────────────────────────────────────
// Per-token profiles (normal / aggressive)
// ────────────────────────────────────────────────────────────────

const profiles: Record<string, { normal: BehaviourProfile; aggressive: BehaviourProfile }> = {
  ZEC: {
    normal: {
      fomo1mPct: 1.0,      // +1.0% w 1m
      fomo5mPct: 2.5,      // +2.5% w 5m
      knife1mPct: -0.8,    // -0.8% w 1m
      knife5mPct: -2.5,    // -2.5% w 5m
      minDepthRatio: 0.25, // 25% mediany
      fomoSpreadBoost: 1.4, // ×1.4 spread boost
      knifeSuspendMinutes: 2
    },
    aggressive: {
      fomo1mPct: 0.7,      // +0.7% w 1m (bardziej wrażliwy)
      fomo5mPct: 1.8,      // +1.8% w 5m
      knife1mPct: -1.2,    // -1.2% w 1m (pełna paranoja na noże)
      knife5mPct: -3.5,    // -3.5% w 5m
      minDepthRatio: 0.30, // 30% mediany (mocniejszy panic-filter)
      fomoSpreadBoost: 1.8, // ×1.8 spread boost
      knifeSuspendMinutes: 4
    }
  },
  UNI: {
    normal: {
      fomo1mPct: 1.0,      // +1.0% w 1m
      fomo5mPct: 2.5,      // +2.5% w 5m
      knife1mPct: -0.8,    // -0.8% w 1m
      knife5mPct: -2.3,    // -2.3% w 5m (trochę łagodniejszy nóż)
      minDepthRatio: 0.22, // 22% mediany
      fomoSpreadBoost: 1.4, // ×1.4 spread boost
      knifeSuspendMinutes: 3
    },
    aggressive: {
      fomo1mPct: 0.8,      // +0.8% w 1m
      fomo5mPct: 2.0,      // +2.0% w 5m
      knife1mPct: -1.0,    // -1.0% w 1m
      knife5mPct: -3.0,    // -3.0% w 5m
      minDepthRatio: 0.27, // 27% mediany
      fomoSpreadBoost: 1.8, // ×1.8 spread boost
      knifeSuspendMinutes: 5
    }
  },
  VIRTUAL: {
    normal: {
      fomo1mPct: 1.0,      // +1.0% w 1m
      fomo5mPct: 2.3,      // +2.3% w 5m
      knife1mPct: -0.8,    // -0.8% w 1m
      knife5mPct: -2.3,    // -2.3% w 5m
      minDepthRatio: 0.22, // 22% mediany (podobny profil do UNI)
      fomoSpreadBoost: 1.5, // ×1.5 spread boost
      knifeSuspendMinutes: 3
    },
    aggressive: {
      fomo1mPct: 0.8,      // +0.8% w 1m
      fomo5mPct: 2.0,      // +2.0% w 5m
      knife1mPct: -1.0,    // -1.0% w 1m
      knife5mPct: -3.0,    // -3.0% w 5m (kopia agresywnego UNI)
      minDepthRatio: 0.27, // 27% mediany
      fomoSpreadBoost: 1.9, // ×1.9 spread boost
      knifeSuspendMinutes: 5
    }
  }
}

// Fallback profil (dla innych par, zachowuje się mniej więcej jak UNI normal)
const defaultProfile: { normal: BehaviourProfile; aggressive: BehaviourProfile } = {
  normal: {
    fomo1mPct: 1.0,
    fomo5mPct: 2.5,
    knife1mPct: -0.8,
    knife5mPct: -2.3,
    minDepthRatio: 0.22,
    fomoSpreadBoost: 1.4,
    knifeSuspendMinutes: 3
  },
  aggressive: {
    fomo1mPct: 0.8,
    fomo5mPct: 2.0,
    knife1mPct: -1.0,
    knife5mPct: -3.0,
    minDepthRatio: 0.27,
    fomoSpreadBoost: 1.8,
    knifeSuspendMinutes: 5
  }
}

function getProfile(pair: string, mode: BehaviourMode): BehaviourProfile {
  const key = pair.toUpperCase().split(/[-_]/)[0] // Extract token from "ZEC-PERP" -> "ZEC"
  const entry = profiles[key] ?? defaultProfile
  return entry[mode]
}

// ────────────────────────────────────────────────────────────────
// Główna funkcja – Anti-FOMO / Anti-Knife decision
// ────────────────────────────────────────────────────────────────

export function evaluateBehaviourGuard(input: BehaviourCheckInput): BehaviourDecision {
  const profile = getProfile(input.pair, input.mode)

  let shouldQuote = true
  let suppressBuys = false
  let spreadBoost = 1.0
  let sizeMultiplier = 1.0
  let knifeSuspendedUntilMs = input.knifeSuspendedUntilMs
  const reasons: string[] = []

  // 1) Jeśli aktywny jest już knife-cooldown → dalej tłumimy BUY
  if (knifeSuspendedUntilMs && input.nowMs < knifeSuspendedUntilMs) {
    suppressBuys = true
    reasons.push('knife_cooldown_active')
  }

  // 2) Anti-Knife: silny spadek w krótkim oknie → zawieszamy BUY
  const isKnife =
    input.ret1mPct <= profile.knife1mPct ||
    input.ret5mPct <= profile.knife5mPct

  if (isKnife) {
    suppressBuys = true
    knifeSuspendedUntilMs = input.nowMs + profile.knifeSuspendMinutes * 60 * 1000
    reasons.push('knife_guard_triggered')
  }

  // 3) Anti-FOMO: szybki wzrost → nie gonimy świecy, tylko rozszerzamy spread i zmniejszamy size
  const isFomo =
    input.ret1mPct >= profile.fomo1mPct ||
    input.ret5mPct >= profile.fomo5mPct

  if (isFomo) {
    spreadBoost = Math.max(spreadBoost, profile.fomoSpreadBoost)
    sizeMultiplier *= 0.7
    reasons.push('fomo_guard_triggered')
  }

  // 4) Głębokość orderbooka za mała → zmniejsz size (nie wycofujemy się całkiem, ale robimy mniejszy ślad)
  if (input.depthRatio < profile.minDepthRatio) {
    sizeMultiplier *= 0.5
    reasons.push('low_depth')
  }

  // Możesz tu dodać twardy stop: jeśli depthRatio << minDepthRatio, np. < 0.1:
  // if (input.depthRatio < profile.minDepthRatio * 0.4) {
  //   shouldQuote = false
  //   reasons.push('depth_too_low_hard_stop')
  // }

  return {
    shouldQuote,
    suppressBuys,
    spreadBoost,
    sizeMultiplier,
    knifeSuspendedUntilMs,
    reason: reasons.join(',')
  }
}

