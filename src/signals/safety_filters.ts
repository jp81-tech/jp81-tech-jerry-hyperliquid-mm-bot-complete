// ═══════════════════════════════════════════════════════════════════════════
// SAFETY FILTERS - Liquidity & CEX Flow Analysis
// Enterprise-grade protection against liquidity traps and distribution events
// Based on Nansen API real data structure
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// ENUMS & TYPES
// ═══════════════════════════════════════════════════════════════════════════

export enum CEXFlowSignal {
  STRONG_OUTFLOW = 'strong_outflow',      // Mocne wypływy z CEX = bullish
  MODERATE_OUTFLOW = 'moderate_outflow',  // Umiarkowane wypływy
  NEUTRAL = 'neutral',                     // Brak sygnału
  MODERATE_INFLOW = 'moderate_inflow',    // Umiarkowane wpływy = bearish
  STRONG_INFLOW = 'strong_inflow'         // Mocne wpływy na CEX = BLOCK
}

export interface SafetyScore {
  liquidityScore: number;    // 0-25
  cexFlowScore: number;      // -30 to +25
  isSafe: boolean;
  isBlocked: boolean;        // Hard block (strong inflow)
  reasons: string[];
}

export interface LiquidityAnalysis {
  score: number;
  passed: boolean;
  reason?: string;
  metrics: {
    liquidity_usd: number;
    market_cap_usd: number;
    volume_24h_usd: number;
    mcap_to_liq_ratio: number;
    vol_to_mcap_ratio: number;
  };
}

export interface CexFlowAnalysis {
  score: number;
  signal: CEXFlowSignal;
  isDistributing: boolean;
  isBullish: boolean;
  flowDirection: 'inflow' | 'outflow' | 'neutral';
  flowAmountUsd: number;
  ratioVsAverage: number;
  // --- NEW FIELDS FOR MM LOGIC ---
  alertLevel: 'SAFE' | 'WATCH' | 'CAUTION' | 'WARNING' | 'CRITICAL' | 'ACCUMULATION' | 'STRONG_ACCUMULATION' | 'EXTREME_ACCUMULATION';
  spreadMultiplier: number;    // > 1.0 dla dystrybucji (szerszy spread)
  inventoryMultiplier: number; // < 1.0 dla dystrybucji, > 1.0 dla akumulacji
  bidAggressiveness: number;   // > 0 dla akumulacji (agresywniejszy bid)
  message: string;
}

export const ACCUMULATION_CONFIG = {
  // Thresholds for Composite Score
  scoreExtremme: 80,
  scoreStrong: 60,
  scoreRegular: 40,
  scoreWatch: 20,

  // Adjustments
  extremeBidAdj: 0.15,
  extremeInvAdj: 1.25,

  strongBidAdj: 0.10,
  strongInvAdj: 1.15,

  regularBidAdj: 0.05,
  regularInvAdj: 1.10
};

export interface TokenSafetyData {
  liquidity_usd?: number;
  market_cap_usd?: number;
  volume_24h_usd?: number;
  cex_flow_summary?: string;      // "Net outflow of $5.2M (2.3x higher than average)"
  cex_net_flow_usd?: number;      // Pre-parsed: negative = outflow, positive = inflow
  cex_ratio_vs_average?: number;  // 2.3 = 2.3x vs average
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export const LIQUIDITY_CONFIG = {
  // Hard filters (instant reject)
  minLiquidity: 100_000,           // $100k minimum liquidity
  minMarketCap: 500_000,           // $500k minimum market cap
  minVol24h: 50_000,               // $50k minimum daily volume
  maxMcapToLiqRatio: 50,           // Max MCap/Liquidity ratio
  minVolToMcapRatio: 0.01,         // Min 1% daily turnover

  // Liquidity tiers (scoring)
  excellentLiquidity: 10_000_000,  // $10M+ = 10 pts
  goodLiquidity: 1_000_000,        // $1M+ = 8 pts
  acceptableLiquidity: 500_000,    // $500k+ = 6 pts
  minimalLiquidity: 100_000,       // $100k+ = 4 pts

  // Volume tiers
  highVolumeRatio: 0.10,           // 10%+ daily turnover = 10 pts
  mediumVolumeRatio: 0.05,         // 5%+ = 7 pts
  lowVolumeRatio: 0.02,            // 2%+ = 4 pts
  minVolumeRatio: 0.01,            // 1%+ = 2 pts

  // MCap/Liq efficiency tiers
  excellentMcapLiqRatio: 5,        // < 5x = 5 pts
  goodMcapLiqRatio: 10,            // < 10x = 3 pts
  acceptableMcapLiqRatio: 20,      // < 20x = 1 pt
};

export const CEX_FLOW_CONFIG = {
  // --- RATIO THRESHOLDS (Your suggested logic) ---
  safeRatioMax: 1.0,      // < 1.0x = Safe (✅)
  watchRatioMax: 1.5,     // 1.0x - 1.5x = Watch (👀)
  cautionRatioMax: 2.5,   // 1.5x - 2.5x = Caution (⚠️)
  warningRatioMax: 4.0,   // 2.5x - 4.0x = Warning (🔴)
  // >= 4.0x = Critical (🚨)

  // --- ACTIONS PER LEVEL ---
  cautionSpreadMult: 1.10,    // +10% spread
  cautionInvMult: 0.90,       // -10% inventory limit

  warningSpreadMult: 1.20,    // +20% spread
  warningInvMult: 0.75,       // -25% inventory limit

  criticalSpreadMult: 1.50,   // +50% spread
  criticalInvMult: 0.50,      // -50% inventory limit

  // Legacy thresholds (kept for scoring)
  strongOutflowThr: -500_000,
  moderateOutflowThr: -100_000,
  moderateInflowThr: 100_000,
  strongInflowThr: 500_000,
};

// ═══════════════════════════════════════════════════════════════════════════
// SAFETY FILTER CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class SafetyFilter {

  /**
   * Analyze token liquidity quality with full metrics
   * Returns score (0-25) and pass/fail status
   */
  static analyzeLiquidity(token: TokenSafetyData): LiquidityAnalysis {
    const liq = token.liquidity_usd || 0;
    const mcap = token.market_cap_usd || 0;
    const vol = token.volume_24h_usd || 0;

    // Calculate ratios
    const mcapToLiq = liq > 0 ? mcap / liq : Infinity;
    const volToMcap = mcap > 0 ? vol / mcap : 0;

    const metrics = {
      liquidity_usd: liq,
      market_cap_usd: mcap,
      volume_24h_usd: vol,
      mcap_to_liq_ratio: mcapToLiq,
      vol_to_mcap_ratio: volToMcap,
    };

    // ─────────────────────────────────────────────
    // HARD FILTERS (Instant Reject)
    // ─────────────────────────────────────────────
    if (liq < LIQUIDITY_CONFIG.minLiquidity) {
      return {
        score: 0,
        passed: false,
        reason: `Liquidity $${(liq / 1000).toFixed(0)}k < min $${(LIQUIDITY_CONFIG.minLiquidity / 1000).toFixed(0)}k`,
        metrics
      };
    }

    if (mcap < LIQUIDITY_CONFIG.minMarketCap) {
      return {
        score: 0,
        passed: false,
        reason: `MarketCap $${(mcap / 1000).toFixed(0)}k < min $${(LIQUIDITY_CONFIG.minMarketCap / 1000).toFixed(0)}k`,
        metrics
      };
    }

    if (vol < LIQUIDITY_CONFIG.minVol24h) {
      return {
        score: 0,
        passed: false,
        reason: `Volume24h $${(vol / 1000).toFixed(0)}k < min $${(LIQUIDITY_CONFIG.minVol24h / 1000).toFixed(0)}k`,
        metrics
      };
    }

    if (mcapToLiq > LIQUIDITY_CONFIG.maxMcapToLiqRatio) {
      return {
        score: 0,
        passed: false,
        reason: `MCap/Liq ratio ${mcapToLiq.toFixed(1)}x > max ${LIQUIDITY_CONFIG.maxMcapToLiqRatio}x`,
        metrics
      };
    }

    if (volToMcap < LIQUIDITY_CONFIG.minVolToMcapRatio) {
      return {
        score: 0,
        passed: false,
        reason: `Vol/MCap ${(volToMcap * 100).toFixed(2)}% < min ${(LIQUIDITY_CONFIG.minVolToMcapRatio * 100).toFixed(0)}%`,
        metrics
      };
    }

    // ─────────────────────────────────────────────
    // LIQUIDITY SCORING (0-10 pts)
    // ─────────────────────────────────────────────
    let score = 0;

    if (liq >= LIQUIDITY_CONFIG.excellentLiquidity) {
      score += 10;
    } else if (liq >= LIQUIDITY_CONFIG.goodLiquidity) {
      score += 8;
    } else if (liq >= LIQUIDITY_CONFIG.acceptableLiquidity) {
      score += 6;
    } else {
      score += 4;
    }

    // ─────────────────────────────────────────────
    // VOLUME HEALTH SCORING (0-10 pts)
    // ─────────────────────────────────────────────
    if (volToMcap >= LIQUIDITY_CONFIG.highVolumeRatio) {
      score += 10;
    } else if (volToMcap >= LIQUIDITY_CONFIG.mediumVolumeRatio) {
      score += 7;
    } else if (volToMcap >= LIQUIDITY_CONFIG.lowVolumeRatio) {
      score += 4;
    } else {
      score += 2;
    }

    // ─────────────────────────────────────────────
    // MCAP/LIQUIDITY EFFICIENCY (0-5 pts)
    // ─────────────────────────────────────────────
    if (mcapToLiq <= LIQUIDITY_CONFIG.excellentMcapLiqRatio) {
      score += 5;
    } else if (mcapToLiq <= LIQUIDITY_CONFIG.goodMcapLiqRatio) {
      score += 3;
    } else if (mcapToLiq <= LIQUIDITY_CONFIG.acceptableMcapLiqRatio) {
      score += 1;
    }

    return { score, passed: true, metrics };
  }

  /**
   * Parse CEX flow from Nansen summary text
   * Example: "Exchange wallets: Net outflow of $5.2M (2.3x higher than average)"
   */
  static parseCexFlowSummary(summary: string): { netFlow: number; ratio: number } {
    if (!summary) return { netFlow: 0, ratio: 1.0 };

    // Pattern: "Net outflow of $5.2M" or "Net inflow of $1.2M"
    const flowRegex = /Net (inflow|outflow) of \$([0-9.]+)([kKmMbB]?)/i;
    // Pattern: "2.3x higher than average" or "1.5x lower than average"
    const ratioRegex = /([0-9.]+)x (higher|lower) than average/i;

    const flowMatch = summary.match(flowRegex);
    const ratioMatch = summary.match(ratioRegex);

    let netFlow = 0;
    let ratio = 1.0;

    if (flowMatch) {
      const direction = flowMatch[1].toLowerCase();
      let value = parseFloat(flowMatch[2]);
      const multiplier = (flowMatch[3] || '').toUpperCase();

      if (multiplier === 'K') value *= 1_000;
      else if (multiplier === 'M') value *= 1_000_000;
      else if (multiplier === 'B') value *= 1_000_000_000;

      // Outflow = negative, Inflow = positive
      netFlow = direction === 'outflow' ? -value : value;
    }

    if (ratioMatch) {
      ratio = parseFloat(ratioMatch[1]);
    }

    return { netFlow, ratio };
  }

  /**
   * Analyze CEX flows and determine signal
   */
  static analyzeCexFlow(summary: string | undefined): CexFlowAnalysis {
    if (!summary) {
      return {
        score: 0,
        signal: CEXFlowSignal.NEUTRAL,
        isDistributing: false,
        isBullish: false,
        flowDirection: 'neutral',
        flowAmountUsd: 0,
        ratioVsAverage: 1.0,
        alertLevel: 'SAFE',
        spreadMultiplier: 1.0,
        inventoryMultiplier: 1.0,
        message: 'No summary'
      };
    }

    const { netFlow, ratio } = this.parseCexFlowSummary(summary);
    return this.analyzeCexFlowNumeric(netFlow, ratio);
  }

  /**
   * Analyze CEX flow from numeric values (pre-parsed)
   */
  static analyzeCexFlowNumeric(
    netFlowUsd: number | undefined,
    ratioVsAverage: number = 1.0,
    smNetflowUsd: number = 0 // Dodatkowy parametr dla composite score
  ): CexFlowAnalysis {
    if (netFlowUsd === undefined || netFlowUsd === null) {
      return {
        score: 0,
        signal: CEXFlowSignal.NEUTRAL,
        isDistributing: false,
        isBullish: false,
        flowDirection: 'neutral',
        flowAmountUsd: 0,
        ratioVsAverage: 1.0,
        alertLevel: 'SAFE',
        spreadMultiplier: 1.0,
        inventoryMultiplier: 1.0,
        bidAggressiveness: 0,
        message: 'No flow data'
      };
    }

    let signal: CEXFlowSignal;
    let score: number = 0;

    // Bezwzględne progi dla punktacji technicznej
    if (netFlowUsd <= CEX_FLOW_CONFIG.strongOutflowThr) {
      signal = CEXFlowSignal.STRONG_OUTFLOW;
      score = 20;
    } else if (netFlowUsd <= CEX_FLOW_CONFIG.moderateOutflowThr) {
      signal = CEXFlowSignal.MODERATE_OUTFLOW;
      score = 10;
    } else if (netFlowUsd >= CEX_FLOW_CONFIG.strongInflowThr) {
      signal = CEXFlowSignal.STRONG_INFLOW;
      score = -25;
    } else if (netFlowUsd >= CEX_FLOW_CONFIG.moderateInflowThr) {
      signal = CEXFlowSignal.MODERATE_INFLOW;
      score = -10;
    } else {
      signal = CEXFlowSignal.NEUTRAL;
      score = 0;
    }

    // --- TWOJA LOGIKA ALERTÓW MM ---
    let alertLevel: CexFlowAnalysis['alertLevel'] = 'SAFE';
    let spreadMultiplier = 1.0;
    let inventoryMultiplier = 1.0;
    let bidAggressiveness = 0;
    let message = '';

    // 🔴 1. DYSTRYBUCJA (CEX Inflow)
    if (netFlowUsd > 0) {
      if (ratioVsAverage < CEX_FLOW_CONFIG.safeRatioMax) {
        alertLevel = 'SAFE';
        message = `CEX inflow ${ratioVsAverage.toFixed(1)}x vs avg - poniżej normy`;
      } else if (ratioVsAverage < CEX_FLOW_CONFIG.watchRatioMax) {
        alertLevel = 'WATCH';
        message = `CEX inflow ${ratioVsAverage.toFixed(1)}x vs avg - monitoruj`;
      } else if (ratioVsAverage < CEX_FLOW_CONFIG.cautionRatioMax) {
        alertLevel = 'CAUTION';
        spreadMultiplier = CEX_FLOW_CONFIG.cautionSpreadMult;
        inventoryMultiplier = CEX_FLOW_CONFIG.cautionInvMult;
        message = `CEX inflow ${ratioVsAverage.toFixed(1)}x vs avg - podwyższona presja`;
      } else if (ratioVsAverage < CEX_FLOW_CONFIG.warningRatioMax) {
        alertLevel = 'WARNING';
        spreadMultiplier = CEX_FLOW_CONFIG.warningSpreadMult;
        inventoryMultiplier = CEX_FLOW_CONFIG.warningInvMult;
        message = `CEX inflow ${ratioVsAverage.toFixed(1)}x vs avg - SILNA presja!`;
      } else {
        alertLevel = 'CRITICAL';
        spreadMultiplier = CEX_FLOW_CONFIG.criticalSpreadMult;
        inventoryMultiplier = CEX_FLOW_CONFIG.criticalInvMult;
        message = `CEX inflow ${ratioVsAverage.toFixed(1)}x vs avg - EKSTREMALNY!`;
      }
    }
    // 🟢 2. AKUMULACJA (CEX Outflow)
    else if (netFlowUsd < 0) {
      const cexRatio = Math.abs(ratioVsAverage);
      let compositeScore = 0;

      // CEX Outflow score (40% wagi)
      if (cexRatio >= 10.0) compositeScore += 40;
      else if (cexRatio >= 5.0) compositeScore += 32;
      else if (cexRatio >= 2.5) compositeScore += 24;
      else if (cexRatio >= 1.5) compositeScore += 16;
      else if (cexRatio >= 1.0) compositeScore += 8;

      // Smart Money Flow score (waga łączona Whale + SM + TopPnL = 60%)
      // Symulujemy wagę na podstawie smNetflowUsd (jeśli dodatni = bullish)
      if (smNetflowUsd > 100_000) compositeScore += 60;
      else if (smNetflowUsd > 50_000) compositeScore += 40;
      else if (smNetflowUsd > 0) compositeScore += 20;
      else if (smNetflowUsd < -100_000) compositeScore -= 30; // Kara za SM Selling

      compositeScore = Math.max(0, Math.min(100, compositeScore));

      if (compositeScore >= ACCUMULATION_CONFIG.scoreExtremme) {
        alertLevel = 'EXTREME_ACCUMULATION';
        bidAggressiveness = ACCUMULATION_CONFIG.extremeBidAdj;
        inventoryMultiplier = ACCUMULATION_CONFIG.extremeInvAdj;
        message = `EXTREME ACCUMULATION (${compositeScore}/100) - Aggressive Bids`;
      } else if (compositeScore >= ACCUMULATION_CONFIG.scoreStrong) {
        alertLevel = 'STRONG_ACCUMULATION';
        bidAggressiveness = ACCUMULATION_CONFIG.strongBidAdj;
        inventoryMultiplier = ACCUMULATION_CONFIG.strongInvAdj;
        message = `STRONG ACCUMULATION (${compositeScore}/100) - Favor Bids`;
      } else if (compositeScore >= ACCUMULATION_CONFIG.scoreRegular) {
        alertLevel = 'ACCUMULATION';
        bidAggressiveness = ACCUMULATION_CONFIG.regularBidAdj;
        inventoryMultiplier = ACCUMULATION_CONFIG.regularInvAdj;
        message = `Accumulation detected (${compositeScore}/100)`;
      } else if (compositeScore >= ACCUMULATION_CONFIG.scoreWatch) {
        alertLevel = 'WATCH';
        message = `Watching accumulation (${compositeScore}/100)`;
      } else {
        alertLevel = 'SAFE';
        message = `Normal CEX outflow (${cexRatio.toFixed(1)}x)`;
      }
    }

    const isBullish = netFlowUsd < 0;
    const isDistributing = alertLevel === 'CRITICAL' || (alertLevel === 'WARNING' && ratioVsAverage > 3.0);
    const flowDirection: 'inflow' | 'outflow' | 'neutral' =
      netFlowUsd < 0 ? 'outflow' : netFlowUsd > 0 ? 'inflow' : 'neutral';

    return {
      score,
      signal,
      isDistributing,
      isBullish,
      flowDirection,
      flowAmountUsd: Math.abs(netFlowUsd),
      ratioVsAverage,
      alertLevel,
      spreadMultiplier,
      inventoryMultiplier,
      bidAggressiveness,
      message
    };
  }

  /**
   * Get combined safety analysis for a token
   */
  static getFullSafetyScore(token: TokenSafetyData): SafetyScore {
    const reasons: string[] = [];

    // Analyze liquidity
    const liqAnalysis = this.analyzeLiquidity(token);
    if (!liqAnalysis.passed && liqAnalysis.reason) {
      reasons.push(liqAnalysis.reason);
    }

    // Analyze CEX flow
    let cexAnalysis: CexFlowAnalysis;
    if (token.cex_net_flow_usd !== undefined) {
      cexAnalysis = this.analyzeCexFlowNumeric(
        token.cex_net_flow_usd,
        token.cex_ratio_vs_average
      );
    } else {
      cexAnalysis = this.analyzeCexFlow(token.cex_flow_summary);
    }

    // Add CEX flow info to reasons
    if (cexAnalysis.isDistributing) {
      const flowM = (cexAnalysis.flowAmountUsd / 1e6).toFixed(1);
      reasons.push(`BLOCKED: CEX Dump $${flowM}M inflow (${cexAnalysis.ratioVsAverage.toFixed(1)}x avg)`);
    } else if (cexAnalysis.isBullish) {
      const flowM = (cexAnalysis.flowAmountUsd / 1e6).toFixed(1);
      reasons.push(`CEX Accumulation: $${flowM}M outflow (${cexAnalysis.ratioVsAverage.toFixed(1)}x avg)`);
    }

    const isSafe = liqAnalysis.passed && !cexAnalysis.isDistributing;
    const isBlocked = cexAnalysis.isDistributing;

    return {
      liquidityScore: liqAnalysis.score,
      cexFlowScore: cexAnalysis.score,
      isSafe,
      isBlocked,
      reasons
    };
  }

  /**
   * Calculate safety boost for rotation scoring
   * Returns -999 for blocked, or normalized score (-0.3 to +0.5)
   */
  static getSafetyBoost(token: TokenSafetyData): number {
    const safety = this.getFullSafetyScore(token);

    // Hard block for distribution or failed liquidity
    if (!safety.isSafe || safety.isBlocked) {
      return -999;
    }

    // Normalize: (liquidityScore + cexFlowScore) / 100
    // liquidityScore: 0-25, cexFlowScore: -30 to +25
    // Total range: -30 to +50, normalized to -0.30 to +0.50
    return (safety.liquidityScore + safety.cexFlowScore) / 100;
  }

  /**
   * Calculate total score for a token (SM + Liquidity + CEX)
   */
  static calculateTotalScore(
    smScore: number,
    token: TokenSafetyData
  ): { totalScore: number; signalStrength: string; passesAll: boolean; reasons: string[] } {
    const safety = this.getFullSafetyScore(token);
    const totalScore = smScore + safety.liquidityScore + safety.cexFlowScore;

    let signalStrength: string;
    if (totalScore >= 120) {
      signalStrength = 'VERY_STRONG';
    } else if (totalScore >= 80) {
      signalStrength = 'STRONG';
    } else if (totalScore >= 50) {
      signalStrength = 'MODERATE';
    } else {
      signalStrength = 'WEAK';
    }

    const passesAll = safety.isSafe && !safety.isBlocked && totalScore >= 50;

    return {
      totalScore,
      signalStrength,
      passesAll,
      reasons: safety.reasons
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HYPERLIQUID PERPS ADAPTER
// Converts Hyperliquid perp data to TokenSafetyData format
// ═══════════════════════════════════════════════════════════════════════════

export interface HyperliquidPerpData {
  coin: string;
  openInterest?: string;      // Total OI in contracts
  dayNtlVlm?: string;         // 24h notional volume USD
  midPx?: string;             // Current mid price
  funding?: string;           // Current funding rate
  smNetflowUsd?: number;      // Smart Money net flow
}

/**
 * Minimum thresholds for Hyperliquid perps
 * Lower than spot because perps have leverage
 */
const HL_PERP_CONFIG = {
  minOpenInterestUsd: 50_000,      // $50k minimum OI
  minVolume24hUsd: 100_000,        // $100k minimum volume

  // OI tiers
  excellentOI: 50_000_000,         // $50M+ = 10 pts
  goodOI: 5_000_000,               // $5M+ = 8 pts
  acceptableOI: 500_000,           // $500k+ = 6 pts

  // SM flow thresholds
  strongSMOutflow: -200_000,       // SM exiting (danger)
  strongSMInflow: 200_000,         // SM entering (bullish)

  // Volume/OI ratio tiers
  highVolOIRatio: 1.0,             // Very active
  mediumVolOIRatio: 0.5,           // Active
  lowVolOIRatio: 0.2,              // Low activity

  // Funding crowding threshold
  crowdedFundingThr: 0.001,        // 0.1% funding = crowded
};

/**
 * Convert Hyperliquid perp data to TokenSafetyData
 */
export function perpDataToSafetyData(
  perpData: HyperliquidPerpData,
  smNetflowUsd?: number
): TokenSafetyData {
  const midPx = parseFloat(perpData.midPx || '0');
  const oi = parseFloat(perpData.openInterest || '0');
  const volume = parseFloat(perpData.dayNtlVlm || '0');
  const openInterestUsd = oi * midPx;

  return {
    liquidity_usd: openInterestUsd,
    volume_24h_usd: volume,
    market_cap_usd: openInterestUsd * 2, // Rough proxy
    cex_net_flow_usd: smNetflowUsd
  };
}

/**
 * Analyze Hyperliquid perp safety
 */
export function analyzePerpSafety(
  perpData: HyperliquidPerpData,
  smNetflowUsd?: number
): SafetyScore {
  const reasons: string[] = [];
  let liquidityScore = 0;
  let cexFlowScore = 0;
  let isSafe = true;
  let isBlocked = false;

  const midPx = parseFloat(perpData.midPx || '0');
  const oi = parseFloat(perpData.openInterest || '0');
  const volume = parseFloat(perpData.dayNtlVlm || '0');
  const openInterestUsd = oi * midPx;

  // ─────────────────────────────────────────────
  // 1. OPEN INTEREST CHECK
  // ─────────────────────────────────────────────
  if (openInterestUsd < HL_PERP_CONFIG.minOpenInterestUsd) {
    isSafe = false;
    reasons.push(`Low OI: $${(openInterestUsd / 1000).toFixed(0)}k < $${(HL_PERP_CONFIG.minOpenInterestUsd / 1000).toFixed(0)}k`);
  } else if (openInterestUsd >= HL_PERP_CONFIG.excellentOI) {
    liquidityScore = 10;
  } else if (openInterestUsd >= HL_PERP_CONFIG.goodOI) {
    liquidityScore = 8;
  } else if (openInterestUsd >= HL_PERP_CONFIG.acceptableOI) {
    liquidityScore = 6;
  } else {
    liquidityScore = 4;
  }

  // ─────────────────────────────────────────────
  // 2. VOLUME CHECK
  // ─────────────────────────────────────────────
  if (volume < HL_PERP_CONFIG.minVolume24hUsd) {
    isSafe = false;
    reasons.push(`Low Vol: $${(volume / 1000).toFixed(0)}k < $${(HL_PERP_CONFIG.minVolume24hUsd / 1000).toFixed(0)}k`);
  } else {
    const volToOI = openInterestUsd > 0 ? volume / openInterestUsd : 0;
    if (volToOI >= HL_PERP_CONFIG.highVolOIRatio) {
      liquidityScore += 10;
    } else if (volToOI >= HL_PERP_CONFIG.mediumVolOIRatio) {
      liquidityScore += 7;
    } else if (volToOI >= HL_PERP_CONFIG.lowVolOIRatio) {
      liquidityScore += 4;
    } else {
      liquidityScore += 2;
    }
  }

  // ─────────────────────────────────────────────
  // 3. SMART MONEY FLOW
  // ─────────────────────────────────────────────
  if (smNetflowUsd !== undefined) {
    if (smNetflowUsd <= HL_PERP_CONFIG.strongSMOutflow) {
      // SM exiting = danger
      cexFlowScore = -15;
      isBlocked = true;
      reasons.push(`SM Exit: $${(Math.abs(smNetflowUsd) / 1000).toFixed(0)}k outflow`);
    } else if (smNetflowUsd >= HL_PERP_CONFIG.strongSMInflow) {
      // SM entering = bullish
      cexFlowScore = 15;
      reasons.push(`SM Entry: $${(smNetflowUsd / 1000).toFixed(0)}k inflow`);
    }
  }

  // ─────────────────────────────────────────────
  // 4. FUNDING RATE (Crowding Risk)
  // ─────────────────────────────────────────────
  const funding = parseFloat(perpData.funding || '0');
  if (Math.abs(funding) > HL_PERP_CONFIG.crowdedFundingThr) {
    const crowdedSide = funding > 0 ? 'LONG' : 'SHORT';
    reasons.push(`Crowded ${crowdedSide}: funding ${(funding * 100).toFixed(3)}%`);
    liquidityScore = Math.max(0, liquidityScore - 2);
  }

  return {
    liquidityScore: Math.max(0, liquidityScore),
    cexFlowScore,
    isSafe: isSafe && !isBlocked,
    isBlocked,
    reasons
  };
}

/**
 * Get safety boost for a Hyperliquid perp
 */
export function getPerpSafetyBoost(
  perpData: HyperliquidPerpData,
  smNetflowUsd?: number
): number {
  const safety = analyzePerpSafety(perpData, smNetflowUsd);

  if (!safety.isSafe || safety.isBlocked) {
    return -999;
  }

  return (safety.liquidityScore + safety.cexFlowScore) / 100;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default SafetyFilter;
