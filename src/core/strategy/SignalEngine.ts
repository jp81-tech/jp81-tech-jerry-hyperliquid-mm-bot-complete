// ============================================
// 🧠 SIGNAL ENGINE v3.1 - WHALE TRACKER OVERRIDE
// With Full Conflict Analysis & Trade Parameters
// MASTER PRIORITY - Overrides REGIME/HARD_BLOCK
// NEW: Whale Tracker Override when SM bias is EXTREME
// ============================================

export type SignalDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type SignalStrength = 'EXTREME' | 'STRONG' | 'MODERATE' | 'WEAK' | 'NEUTRAL';
export type Confidence = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NO_TRADE';
export type Timeframe = '1h' | '6h' | '24h' | '7d';
export type Decision = 'LONG' | 'SHORT' | 'NO_TRADE';
export type ConflictType = 'NONE' | 'SOURCE' | 'TIMEFRAME' | 'REGIME';
export type ConflictSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface TimeframedSignal {
  source: 'onchain' | 'hlperps' | 'regime';
  timeframe: Timeframe;
  direction: SignalDirection;
  strength: SignalStrength;
  score: number;
  factors: string[];
}

export interface ConflictAnalysis {
  hasConflict: boolean;
  type: ConflictType;
  severity: ConflictSeverity;
  description: string;
  resolution: string;
  scoreAdjustment: number;
}

export interface TradeParameters {
  side: 'LONG' | 'SHORT';
  leverage: number;
  sizePercent: number;
  sizeUsd: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  trailingStopPercent: number;
  maxSlippage: number;
}

export interface OnChainMetrics {
  smNetflow: {
    smNetflow_1h: number;
    smNetflow_24h: number;
    smNetflow_7d: number;
  };
  cexNetflow: {
    cexNetflow_1h: number;
    cexNetflow_24h: number;
    cexNetflow_7d: number;
  };
}

export interface HLPerpsMetrics {
  shortLongRatio: number;
  positions: Array<{
    address: string;
    side: 'Long' | 'Short';
    positionValue: number;
    pnl: number;
  }>;
  whaleConviction: number;
  whaleDirection: string;
}

export interface RegimeContext {
  currentRegime: 'BULL' | 'BEAR' | 'RANGE' | 'UNKNOWN';
  btcTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  volatility: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface RiskLimits {
  currentDrawdown: number;
  maxDrawdownPercent: number;
  openPositions: number;
  maxOpenPositions: number;
  maxPositionSize: number;
}

export interface CurrentPosition {
  size: number;
  entryPrice: number;
  side: 'LONG' | 'SHORT' | 'NONE';
}

// ============================================
// 🐋 WHALE TRACKER OVERRIDE CONFIG v3.1
// ============================================

export interface WhaleTrackerOverride {
  triggered: boolean;
  direction: 'LONG' | 'SHORT' | null;
  reason: string;
  confidence: number;
  shortLongRatio: number;
  totalLongValue: number;
  totalShortValue: number;
}

export interface WhaleTrackerConfig {
  // Extreme bias thresholds - triggers OVERRIDE
  extremeRatio: number;        // 5.0 = 5x more shorts than longs
  extremeConfidence: number;   // 80% minimum confidence for override
  minPositionValue: number;    // $500k minimum total positions

  // Moderate bias thresholds - just BOOSTS score
  moderateRatio: number;       // 2.0 = 2x bias
  moderateConfidence: number;  // 60% minimum confidence for boost
  boostAmount: number;         // +15 score boost
}

const DEFAULT_WHALE_CONFIG: WhaleTrackerConfig = {
  extremeRatio: 5.0,
  extremeConfidence: 80,
  minPositionValue: 500_000,
  moderateRatio: 2.0,
  moderateConfidence: 60,
  boostAmount: 15
};

// Per-token whale override minimum position thresholds
// Small-cap tokens need lower thresholds — $5K kPEPE position is meaningful
const WHALE_POSITION_OVERRIDES: Record<string, number> = {
  'kPEPE': 5_000,
  'LIT': 10_000,
  // Default remains $500K for VIRTUAL, FARTCOIN etc.
};

export interface SignalEngineResult {
  token: string;
  timestamp: Date;
  currentPrice: number;
  decision: Decision;
  confidence: Confidence;
  scores: {
    onChain: number;
    hlPerps: number;
    regime: number;
    risk: number;
    raw: number;
    combined: number;
  };
  timeframeSignals: TimeframedSignal[];
  conflict: ConflictAnalysis;
  tradeParams: TradeParameters | null;
  bullishFactors: string[];
  bearishFactors: string[];
  warnings: string[];
  invalidationConditions: string[];
  // For backward compatibility
  action: 'LONG' | 'SHORT' | 'WAIT';
  score: number;
  reason: string[];
  // MASTER CONTROL FLAGS
  overrideRegime: boolean;
  allowLongs: boolean;
  allowShorts: boolean;
  // v3.1 - Whale Tracker Override info
  whaleOverride?: WhaleTrackerOverride;
}

export interface SignalEngineConfig {
  token: string;
  sourceWeights: {
    onChain: number;
    hlPerps: number;
    regime: number;
    risk: number;
  };
  timeframeWeights: Record<string, number>;
  thresholds: {
    flow: {
      '1h': { weak: number; moderate: number; strong: number; extreme: number };
      '24h': { weak: number; moderate: number; strong: number; extreme: number };
      '7d': { weak: number; moderate: number; strong: number; extreme: number };
    };
    hlPerps: {
      moderateRatio: number;
      strongRatio: number;
      extremeRatio: number;
    };
    decision: {
      low: number;
      medium: number;
      high: number;
      critical: number;
    };
  };
  conflict: {
    source: { threshold: number; action: string; sizeReduction: number };
    regime: { threshold: number; action: string; sizeReduction: number };
  };
  keyPlayers: Array<{ address: string; name: string; weight: number }>;
  regimeModifiers: Record<string, { longMult: number; shortMult: number }>;
  tradeParams: Record<Confidence, {
    sizePercent: number;
    leverage: number;
    slPercent: number;
    tpPercent: number;
    trailing: number;
  }>;
}

// ============================================
// DEFAULT CONFIGS PER TOKEN
// ============================================

const DEFAULT_CONFIG: SignalEngineConfig = {
  token: 'DEFAULT',
  sourceWeights: { onChain: 0.35, hlPerps: 0.35, regime: 0.20, risk: 0.10 },
  timeframeWeights: { '1h': 0.2, '24h': 0.5, '7d': 0.3 },
  thresholds: {
    flow: {
      '1h': { weak: 10_000, moderate: 50_000, strong: 200_000, extreme: 500_000 },
      '24h': { weak: 50_000, moderate: 200_000, strong: 500_000, extreme: 1_000_000 },
      '7d': { weak: 100_000, moderate: 500_000, strong: 1_000_000, extreme: 3_000_000 }
    },
    hlPerps: { moderateRatio: 1.5, strongRatio: 3.0, extremeRatio: 5.0 },
    decision: { low: 20, medium: 40, high: 60, critical: 80 }
  },
  conflict: {
    source: { threshold: 50, action: 'REDUCE_SIZE', sizeReduction: 0.5 },
    regime: { threshold: 40, action: 'REDUCE_SIZE', sizeReduction: 0.3 }
  },
  keyPlayers: [],
  regimeModifiers: {
    'BULL': { longMult: 1.2, shortMult: 0.7 },
    'BEAR': { longMult: 0.7, shortMult: 1.2 },
    'RANGE': { longMult: 1.0, shortMult: 1.0 },
    'UNKNOWN': { longMult: 0.8, shortMult: 0.8 }
  },
  tradeParams: {
    'CRITICAL': { sizePercent: 15, leverage: 5, slPercent: 2, tpPercent: 6, trailing: 1.5 },
    'HIGH': { sizePercent: 10, leverage: 4, slPercent: 2.5, tpPercent: 5, trailing: 1.2 },
    'MEDIUM': { sizePercent: 6, leverage: 3, slPercent: 3, tpPercent: 4, trailing: 1.0 },
    'LOW': { sizePercent: 3, leverage: 2, slPercent: 4, tpPercent: 3, trailing: 0.8 },
    'NO_TRADE': { sizePercent: 0, leverage: 1, slPercent: 5, tpPercent: 5, trailing: 0 }
  }
};

const TOKEN_CONFIGS: Record<string, Partial<SignalEngineConfig>> = {
  'LIT': {
    token: 'LIT',
    sourceWeights: { onChain: 0.30, hlPerps: 0.45, regime: 0.15, risk: 0.10 },
    thresholds: {
      flow: {
        '1h': { weak: 50_000, moderate: 150_000, strong: 400_000, extreme: 800_000 },
        '24h': { weak: 200_000, moderate: 500_000, strong: 1_000_000, extreme: 2_000_000 },
        '7d': { weak: 500_000, moderate: 1_000_000, strong: 3_000_000, extreme: 5_000_000 }
      },
      hlPerps: { moderateRatio: 2.0, strongRatio: 4.0, extremeRatio: 8.0 },
      decision: { low: 25, medium: 45, high: 65, critical: 85 }
    }
  },
  'VIRTUAL': {
    token: 'VIRTUAL',
    sourceWeights: { onChain: 0.45, hlPerps: 0.30, regime: 0.15, risk: 0.10 },
    thresholds: {
      flow: {
        '1h': { weak: 30_000, moderate: 100_000, strong: 300_000, extreme: 600_000 },
        '24h': { weak: 100_000, moderate: 300_000, strong: 700_000, extreme: 1_500_000 },
        '7d': { weak: 300_000, moderate: 700_000, strong: 2_000_000, extreme: 4_000_000 }
      },
      hlPerps: { moderateRatio: 1.5, strongRatio: 3.0, extremeRatio: 6.0 },
      decision: { low: 20, medium: 40, high: 60, critical: 80 }
    }
  },
  'FARTCOIN': {
    token: 'FARTCOIN',
    sourceWeights: { onChain: 0.40, hlPerps: 0.35, regime: 0.15, risk: 0.10 },
    thresholds: {
      flow: {
        '1h': { weak: 20_000, moderate: 80_000, strong: 200_000, extreme: 400_000 },
        '24h': { weak: 80_000, moderate: 200_000, strong: 500_000, extreme: 1_000_000 },
        '7d': { weak: 200_000, moderate: 500_000, strong: 1_500_000, extreme: 3_000_000 }
      },
      hlPerps: { moderateRatio: 2.0, strongRatio: 5.0, extremeRatio: 10.0 },
      decision: { low: 25, medium: 45, high: 65, critical: 85 }
    }
  }
};

// ============================================
// SIGNAL ENGINE CLASS
// ============================================

export class SignalEngine {
  private config: SignalEngineConfig;
  private whaleConfig: WhaleTrackerConfig;
  private currentPrice: number = 0;
  private portfolioValue: number = 15000; // Default

  constructor(token: string, portfolioValue?: number) {
    const tokenConfig = TOKEN_CONFIGS[token] || {};
    this.config = this.mergeConfig(DEFAULT_CONFIG, tokenConfig);
    this.config.token = token;
    this.whaleConfig = DEFAULT_WHALE_CONFIG;
    if (portfolioValue) this.portfolioValue = portfolioValue;
  }

  private mergeConfig(base: SignalEngineConfig, override: Partial<SignalEngineConfig>): SignalEngineConfig {
    return {
      ...base,
      ...override,
      sourceWeights: { ...base.sourceWeights, ...override.sourceWeights },
      timeframeWeights: { ...base.timeframeWeights, ...override.timeframeWeights },
      thresholds: {
        flow: { ...base.thresholds.flow, ...override.thresholds?.flow },
        hlPerps: { ...base.thresholds.hlPerps, ...override.thresholds?.hlPerps },
        decision: { ...base.thresholds.decision, ...override.thresholds?.decision }
      },
      conflict: { ...base.conflict, ...override.conflict }
    };
  }

  // ============================================
  // MAIN ANALYZE METHOD
  // ============================================

  analyze(
    onChain: OnChainMetrics,
    hlPerps: HLPerpsMetrics,
    regime: RegimeContext,
    risk: RiskLimits,
    currentPosition: CurrentPosition,
    currentPrice: number
  ): SignalEngineResult {
    this.currentPrice = currentPrice;
    const debug: any = {};

    // STEP 1: Calculate individual scores
    const onChainResult = this.calculateOnChainScore(onChain);
    const hlPerpsResult = this.calculateHLPerpsScore(hlPerps);
    const regimeResult = this.calculateRegimeScore(regime, onChainResult.score, hlPerpsResult.score);
    const riskResult = this.calculateRiskScore(risk);

    // STEP 1.5 (v3.1): Check for Whale Tracker Override
    const whaleOverride = this.checkWhaleTrackerOverride(hlPerps);

    // STEP 2: Detect conflicts
    const conflict = this.detectConflicts(onChainResult, hlPerpsResult, regimeResult);

    // STEP 3: Calculate combined score
    const weightedOnChain = onChainResult.score * this.config.sourceWeights.onChain;
    const weightedHLPerps = hlPerpsResult.score * this.config.sourceWeights.hlPerps;
    const weightedRegime = regimeResult.score * this.config.sourceWeights.regime;
    const weightedRisk = riskResult.score * this.config.sourceWeights.risk;

    let combinedScore = weightedOnChain + weightedHLPerps + weightedRegime + weightedRisk;
    combinedScore += conflict.scoreAdjustment;

    // STEP 3.5 (v3.1): Apply Whale Boost if not override
    if (!whaleOverride.triggered) {
      const whaleBoost = this.calculateWhaleBoost(hlPerps);
      if (whaleBoost !== 0) {
        combinedScore += whaleBoost;
        console.log(`[SignalEngine] Whale boost applied: ${whaleBoost > 0 ? '+' : ''}${whaleBoost}`);
      }
    }

    // Risk penalty
    if (riskResult.score < 0 && combinedScore > 0) {
      combinedScore *= (1 + riskResult.score / 100);
    }

    combinedScore = Math.max(-100, Math.min(100, combinedScore));

    debug.scores = {
      onChain: onChainResult.score,
      hlPerps: hlPerpsResult.score,
      regime: regimeResult.score,
      risk: riskResult.score,
      raw: weightedOnChain + weightedHLPerps + weightedRegime + weightedRisk,
      combined: combinedScore
    };

    // STEP 4: Determine decision & confidence (with whale override)
    const { decision, confidence } = this.determineDecision(combinedScore, conflict, whaleOverride);

    // STEP 5: Calculate trade parameters
    const tradeParams = this.calculateTradeParams(decision, confidence, conflict, risk, currentPosition);

    // STEP 6: Compile reasoning
    const bullishFactors = [...onChainResult.bullishFactors, ...hlPerpsResult.bullishFactors, ...regimeResult.bullishFactors];
    const bearishFactors = [...onChainResult.bearishFactors, ...hlPerpsResult.bearishFactors, ...regimeResult.bearishFactors];
    const warnings = [...riskResult.warnings, conflict.description].filter(w => w !== '');
    const invalidationConditions = this.defineInvalidation(decision, hlPerps);

    // STEP 7: Determine MASTER CONTROL flags
    // When decision is NO_TRADE, allow both sides for PURE_MM
    const overrideRegime = true; // SignalEngine ALWAYS overrides REGIME
    let allowLongs = true;
    let allowShorts = true;

    if (decision === 'LONG') {
      allowShorts = false; // Only longs
    } else if (decision === 'SHORT') {
      allowLongs = false; // Only shorts
    }
    // NO_TRADE = both sides allowed (PURE_MM)

    // Backward compatible action
    const action: 'LONG' | 'SHORT' | 'WAIT' = decision === 'NO_TRADE' ? 'WAIT' : decision;

    return {
      token: this.config.token,
      timestamp: new Date(),
      currentPrice: this.currentPrice,
      decision,
      confidence,
      scores: debug.scores,
      timeframeSignals: [...onChainResult.signals, ...hlPerpsResult.signals],
      conflict,
      tradeParams,
      bullishFactors,
      bearishFactors,
      warnings,
      invalidationConditions,
      // Backward compatibility
      action,
      score: combinedScore,
      reason: [...bullishFactors, ...bearishFactors],
      // MASTER CONTROL
      overrideRegime,
      allowLongs,
      allowShorts,
      // v3.1 Whale Override info
      whaleOverride
    };
  }

  // ============================================
  // STATIC ANALYZE (backward compatible)
  // ============================================

  static analyze(
    token: string,
    smData: { flow_1h?: number; flow_24h?: number; flow_7d?: number; cex_flow?: number },
    hlData: { ratio: number; whaleConviction: number; whaleDirection: string }
  ): { action: 'LONG' | 'SHORT' | 'WAIT'; score: number; reason: string[]; confidence: number; allowLongs: boolean; allowShorts: boolean; overrideRegime: boolean } {
    const engine = new SignalEngine(token);

    const onChain: OnChainMetrics = {
      smNetflow: {
        smNetflow_1h: smData.flow_1h || 0,
        smNetflow_24h: smData.flow_24h || 0,
        smNetflow_7d: smData.flow_7d || 0
      },
      cexNetflow: {
        cexNetflow_1h: 0,
        cexNetflow_24h: 0,
        cexNetflow_7d: smData.cex_flow || 0
      }
    };

    const hlPerps: HLPerpsMetrics = {
      shortLongRatio: hlData.ratio || 1,
      positions: [],
      whaleConviction: hlData.whaleConviction || 0,
      whaleDirection: hlData.whaleDirection || 'NEUTRAL'
    };

    const regime: RegimeContext = {
      currentRegime: 'UNKNOWN',
      btcTrend: 'NEUTRAL',
      volatility: 'MEDIUM'
    };

    const risk: RiskLimits = {
      currentDrawdown: 0,
      maxDrawdownPercent: 10,
      openPositions: 1,
      maxOpenPositions: 5,
      maxPositionSize: 5000
    };

    const currentPosition: CurrentPosition = {
      size: 0,
      entryPrice: 0,
      side: 'NONE'
    };

    const result = engine.analyze(onChain, hlPerps, regime, risk, currentPosition, 1);

    return {
      action: result.action,
      score: result.score,
      reason: result.reason,
      confidence: result.confidence === 'CRITICAL' ? 95 :
                  result.confidence === 'HIGH' ? 80 :
                  result.confidence === 'MEDIUM' ? 60 :
                  result.confidence === 'LOW' ? 40 : 20,
      allowLongs: result.allowLongs,
      allowShorts: result.allowShorts,
      overrideRegime: result.overrideRegime
    };
  }

  // ============================================
  // CALCULATION METHODS
  // ============================================

  private calculateOnChainScore(metrics: OnChainMetrics): {
    score: number;
    signals: TimeframedSignal[];
    bullishFactors: string[];
    bearishFactors: string[]
  } {
    let score = 0;
    const signals: TimeframedSignal[] = [];
    const factors = { bullish: [] as string[], bearish: [] as string[] };
    const t = this.config.thresholds.flow;

    const analyzeFlow = (flow: number, cexFlow: number, tf: Timeframe, thresholds: any): number => {
      const netFlow = flow - cexFlow;
      const absFlow = Math.abs(netFlow);
      const direction: SignalDirection = netFlow > 0 ? 'BULLISH' : (netFlow < 0 ? 'BEARISH' : 'NEUTRAL');
      let sScore = 0;
      let strength: SignalStrength = 'NEUTRAL';

      if (absFlow >= thresholds.extreme) { sScore = 100; strength = 'EXTREME'; }
      else if (absFlow >= thresholds.strong) { sScore = 75; strength = 'STRONG'; }
      else if (absFlow >= thresholds.moderate) { sScore = 50; strength = 'MODERATE'; }
      else if (absFlow >= thresholds.weak) { sScore = 25; strength = 'WEAK'; }

      sScore *= (direction === 'BULLISH' ? 1 : -1);

      signals.push({
        source: 'onchain',
        timeframe: tf,
        direction,
        strength,
        score: sScore,
        factors: [`${tf} NetFlow: ${(netFlow / 1000).toFixed(0)}k`]
      });

      const factorText = `${tf} Flow ${direction === 'BULLISH' ? '+' : '-'}${(absFlow / 1000).toFixed(0)}k`;
      if (direction === 'BULLISH' && strength !== 'NEUTRAL') factors.bullish.push(factorText);
      if (direction === 'BEARISH' && strength !== 'NEUTRAL') factors.bearish.push(factorText);

      return sScore * this.config.timeframeWeights[tf];
    };

    score += analyzeFlow(metrics.smNetflow.smNetflow_1h, metrics.cexNetflow.cexNetflow_1h, '1h', t['1h']);
    score += analyzeFlow(metrics.smNetflow.smNetflow_24h, metrics.cexNetflow.cexNetflow_24h, '24h', t['24h']);
    score += analyzeFlow(metrics.smNetflow.smNetflow_7d, metrics.cexNetflow.cexNetflow_7d, '7d', t['7d']);

    score = Math.max(-100, Math.min(100, score));

    return { score, signals, bullishFactors: factors.bullish, bearishFactors: factors.bearish };
  }

  private calculateHLPerpsScore(metrics: HLPerpsMetrics): {
    score: number;
    signals: TimeframedSignal[];
    bullishFactors: string[];
    bearishFactors: string[]
  } {
    let score = 0;
    const signals: TimeframedSignal[] = [];
    const factors = { bullish: [] as string[], bearish: [] as string[] };
    const t = this.config.thresholds.hlPerps;

    // 1. Ratio Analysis
    let ratioScore = 0;
    if (metrics.shortLongRatio >= t.extremeRatio) ratioScore = -100;
    else if (metrics.shortLongRatio >= t.strongRatio) ratioScore = -75;
    else if (metrics.shortLongRatio >= t.moderateRatio) ratioScore = -50;
    else if (metrics.shortLongRatio <= 0.5) ratioScore = 50;

    signals.push({
      source: 'hlperps',
      timeframe: '1h',
      direction: ratioScore > 0 ? 'BULLISH' : (ratioScore < 0 ? 'BEARISH' : 'NEUTRAL'),
      strength: Math.abs(ratioScore) >= 75 ? 'STRONG' : 'MODERATE',
      score: ratioScore,
      factors: [`LS Ratio: ${metrics.shortLongRatio.toFixed(2)}x`]
    });

    if (ratioScore > 0) factors.bullish.push(`Low LS Ratio ${metrics.shortLongRatio.toFixed(2)}x`);
    if (ratioScore < 0) factors.bearish.push(`High LS Ratio ${metrics.shortLongRatio.toFixed(2)}x`);

    score += ratioScore * 0.4;

    // 2. Whale Conviction
    let whaleScore = 0;
    if (metrics.whaleDirection === 'SHORT' || metrics.whaleDirection === 'BEARISH') {
      whaleScore = -100 * metrics.whaleConviction;
      if (metrics.whaleConviction > 0.5) factors.bearish.push(`Whale SHORT ${(metrics.whaleConviction * 100).toFixed(0)}%`);
    } else if (metrics.whaleDirection === 'LONG' || metrics.whaleDirection === 'BULLISH') {
      whaleScore = 100 * metrics.whaleConviction;
      if (metrics.whaleConviction > 0.5) factors.bullish.push(`Whale LONG ${(metrics.whaleConviction * 100).toFixed(0)}%`);
    }

    // Analyze key player positions
    for (const pos of metrics.positions) {
      const kp = this.config.keyPlayers.find(k => k.address === pos.address);
      if (kp) {
        const dirScore = pos.side === 'Long' ? 100 : -100;
        whaleScore += dirScore * kp.weight;
        const msg = `${kp.name} ${pos.side} ${(pos.positionValue / 1000).toFixed(0)}k`;
        if (pos.side === 'Long') factors.bullish.push(msg);
        else factors.bearish.push(msg);
      }
    }

    whaleScore = Math.max(-100, Math.min(100, whaleScore));

    signals.push({
      source: 'hlperps',
      timeframe: '24h',
      direction: whaleScore > 0 ? 'BULLISH' : (whaleScore < 0 ? 'BEARISH' : 'NEUTRAL'),
      strength: Math.abs(whaleScore) > 50 ? 'STRONG' : 'WEAK',
      score: whaleScore,
      factors: [`Whale Conviction: ${whaleScore.toFixed(0)}`]
    });

    score += whaleScore * 0.6;

    return { score, signals, bullishFactors: factors.bullish, bearishFactors: factors.bearish };
  }

  private calculateRegimeScore(
    regime: RegimeContext,
    onChainScore: number,
    hlScore: number
  ): { score: number; bullishFactors: string[]; bearishFactors: string[] } {
    let score = 0;
    const factors = { bullish: [] as string[], bearish: [] as string[] };

    const currentSignalDir = (onChainScore + hlScore) > 0 ? 'BULLISH' : 'BEARISH';

    if (regime.currentRegime === 'BULL') {
      if (currentSignalDir === 'BULLISH') {
        score = 100;
        factors.bullish.push('Regime: BULL (Trend Alignment)');
      } else {
        score = -50;
        factors.bearish.push('Regime: BULL (Counter-trend)');
      }
    } else if (regime.currentRegime === 'BEAR') {
      if (currentSignalDir === 'BEARISH') {
        score = -100;
        factors.bearish.push('Regime: BEAR (Trend Alignment)');
      } else {
        score = 50;
        factors.bullish.push('Regime: BEAR (Counter-trend)');
      }
    }

    // BTC correlation
    if (regime.btcTrend === 'BULLISH') { score += 20; factors.bullish.push('BTC Trend Bullish'); }
    if (regime.btcTrend === 'BEARISH') { score -= 20; factors.bearish.push('BTC Trend Bearish'); }

    return { score: Math.max(-100, Math.min(100, score)), bullishFactors: factors.bullish, bearishFactors: factors.bearish };
  }

  private calculateRiskScore(risk: RiskLimits): { score: number; warnings: string[] } {
    let score = 0;
    const warnings: string[] = [];

    const ddPercent = (risk.currentDrawdown / risk.maxDrawdownPercent) * 100;
    if (ddPercent > 80) {
      score = -100;
      warnings.push(`CRITICAL DRAWDOWN: ${(risk.currentDrawdown * 100).toFixed(1)}%`);
    } else if (ddPercent > 50) {
      score = -50;
      warnings.push('High Drawdown warning');
    }

    const expPercent = (risk.openPositions / risk.maxOpenPositions) * 100;
    if (expPercent > 90) {
      score -= 50;
      warnings.push('Max Exposure Reached');
    }

    return { score, warnings };
  }

  // ============================================
  // 🐋 WHALE TRACKER OVERRIDE CHECK v3.1
  // ============================================

  private checkWhaleTrackerOverride(hlPerps: HLPerpsMetrics): WhaleTrackerOverride {
    const cfg = this.whaleConfig;
    const ratio = hlPerps.shortLongRatio;
    const conviction = hlPerps.whaleConviction * 100; // Convert to percentage

    // Calculate total position values from positions array
    let totalLongValue = 0;
    let totalShortValue = 0;
    for (const pos of hlPerps.positions) {
      if (pos.side === 'Long') totalLongValue += pos.positionValue;
      else totalShortValue += pos.positionValue;
    }
    const totalValue = totalLongValue + totalShortValue;

    // Default: no override
    const result: WhaleTrackerOverride = {
      triggered: false,
      direction: null,
      reason: '',
      confidence: conviction,
      shortLongRatio: ratio,
      totalLongValue,
      totalShortValue
    };

    // CHECK 1: Minimum position value (per-token override for small-cap tokens)
    const token = this.config.token;
    const minPosition = WHALE_POSITION_OVERRIDES[token] ?? cfg.minPositionValue;
    if (totalValue < minPosition) {
      result.reason = `Position value $${(totalValue/1000).toFixed(0)}k < $${(minPosition/1000).toFixed(0)}k min`;
      return result;
    }

    // CHECK 2: EXTREME SHORT bias (ratio >= 5.0 + high conviction)
    if (ratio >= cfg.extremeRatio && conviction >= cfg.extremeConfidence) {
      result.triggered = true;
      result.direction = 'SHORT';
      result.reason = `🐋 WHALE OVERRIDE: Ratio ${ratio.toFixed(1)}x (≥${cfg.extremeRatio}x) + ${conviction.toFixed(0)}% confidence → FORCE SHORT`;
      return result;
    }

    // CHECK 3: EXTREME LONG bias (ratio <= 0.2 = 1/5 + high conviction)
    const inverseRatio = 1 / ratio;
    if (inverseRatio >= cfg.extremeRatio && conviction >= cfg.extremeConfidence) {
      result.triggered = true;
      result.direction = 'LONG';
      result.reason = `🐋 WHALE OVERRIDE: Inverse ratio ${inverseRatio.toFixed(1)}x (≥${cfg.extremeRatio}x) + ${conviction.toFixed(0)}% confidence → FORCE LONG`;
      return result;
    }

    // CHECK 4: Strong ratio bypass for small-cap tokens
    // When ratio is extreme (>=5.0) but conviction is below extremeConfidence,
    // still override if using per-token lower threshold — the ratio speaks for itself
    const netExposure = totalShortValue - totalLongValue;
    if (ratio >= cfg.extremeRatio && Math.abs(netExposure) >= minPosition && minPosition < cfg.minPositionValue) {
      result.triggered = true;
      result.direction = netExposure > 0 ? 'SHORT' : 'LONG';
      result.reason = `🐋 WHALE OVERRIDE (strong ratio): Ratio ${ratio.toFixed(1)}x (≥${cfg.extremeRatio}x) + $${(Math.abs(netExposure)/1000).toFixed(0)}k exposure → FORCE ${result.direction}`;
      return result;
    }
    if (inverseRatio >= cfg.extremeRatio && Math.abs(netExposure) >= minPosition && minPosition < cfg.minPositionValue) {
      result.triggered = true;
      result.direction = netExposure < 0 ? 'LONG' : 'SHORT';
      result.reason = `🐋 WHALE OVERRIDE (strong ratio): Inverse ratio ${inverseRatio.toFixed(1)}x (≥${cfg.extremeRatio}x) + $${(Math.abs(netExposure)/1000).toFixed(0)}k exposure → FORCE ${result.direction}`;
      return result;
    }

    result.reason = `No extreme bias (ratio=${ratio.toFixed(2)}, conviction=${conviction.toFixed(0)}%)`;
    return result;
  }

  private calculateWhaleBoost(hlPerps: HLPerpsMetrics): number {
    const cfg = this.whaleConfig;
    const ratio = hlPerps.shortLongRatio;
    const conviction = hlPerps.whaleConviction * 100;

    // Only apply boost if above moderate threshold
    if (conviction < cfg.moderateConfidence) return 0;

    // SHORT bias (ratio > 2.0) → negative boost (push toward SHORT)
    if (ratio >= cfg.moderateRatio) {
      return -cfg.boostAmount;
    }

    // LONG bias (ratio < 0.5) → positive boost (push toward LONG)
    const inverseRatio = 1 / ratio;
    if (inverseRatio >= cfg.moderateRatio) {
      return cfg.boostAmount;
    }

    return 0;
  }

  private detectConflicts(onChain: any, hl: any, regime: any): ConflictAnalysis {
    let conflict: ConflictAnalysis = {
      hasConflict: false,
      type: 'NONE',
      severity: 'LOW',
      description: '',
      resolution: 'NONE',
      scoreAdjustment: 0
    };

    // Source Conflict (OnChain vs HL)
    if (Math.abs(onChain.score - hl.score) > this.config.conflict.source.threshold) {
      if ((onChain.score > 0 && hl.score < 0) || (onChain.score < 0 && hl.score > 0)) {
        conflict = {
          hasConflict: true,
          type: 'SOURCE',
          severity: 'HIGH',
          description: `Conflict: OnChain (${onChain.score.toFixed(0)}) vs HL (${hl.score.toFixed(0)})`,
          resolution: this.config.conflict.source.action,
          scoreAdjustment: -30
        };
      }
    }

    // Regime Conflict
    const signalScore = (onChain.score + hl.score) / 2;
    if (Math.abs(signalScore - regime.score) > this.config.conflict.regime.threshold) {
      if ((signalScore > 0 && regime.score < 0) || (signalScore < 0 && regime.score > 0)) {
        if (!conflict.hasConflict || conflict.severity !== 'HIGH') {
          conflict = {
            hasConflict: true,
            type: 'REGIME',
            severity: 'MEDIUM',
            description: `Regime Mismatch: Signal (${signalScore.toFixed(0)}) vs Regime (${regime.score.toFixed(0)})`,
            resolution: this.config.conflict.regime.action,
            scoreAdjustment: -20
          };
        }
      }
    }

    return conflict;
  }

  private determineDecision(
    score: number,
    conflict: ConflictAnalysis,
    whaleOverride?: WhaleTrackerOverride
  ): { decision: Decision; confidence: Confidence } {
    const t = this.config.thresholds.decision;
    const absScore = Math.abs(score);
    let decision: Decision = 'NO_TRADE';
    let confidence: Confidence = 'NO_TRADE';

    // 🐋 v3.1: WHALE TRACKER OVERRIDE - bypasses normal thresholds
    if (whaleOverride?.triggered && whaleOverride.direction) {
      decision = whaleOverride.direction;
      // High confidence when override is triggered
      confidence = whaleOverride.confidence >= 90 ? 'CRITICAL' : 'HIGH';
      console.log(`[SignalEngine] ${whaleOverride.reason}`);
      return { decision, confidence };
    }

    // 🎯 KEY THRESHOLDS v3.1 (lowered from ±50 to ±25):
    // Score ≤ -25 → SHORT
    // Score ≥ +25 → LONG
    // -25 < Score < +25 → NO_TRADE (WAIT/PURE_MM)
    const LONG_THRESHOLD = 25;
    const SHORT_THRESHOLD = -25;

    if (score >= LONG_THRESHOLD) {
      decision = 'LONG';
    } else if (score <= SHORT_THRESHOLD) {
      decision = 'SHORT';
    } else {
      // Score between -25 and +25 → WAIT (PURE_MM)
      return { decision: 'NO_TRADE', confidence: 'NO_TRADE' };
    }

    // Confidence based on how far past threshold
    if (absScore >= t.critical) confidence = 'CRITICAL';
    else if (absScore >= t.high) confidence = 'HIGH';
    else if (absScore >= t.medium) confidence = 'MEDIUM';
    else confidence = 'LOW';

    // Downgrade on conflict
    if (conflict.hasConflict) {
      if (confidence === 'CRITICAL') confidence = 'HIGH';
      else if (confidence === 'HIGH') confidence = 'MEDIUM';
      else if (confidence === 'MEDIUM') confidence = 'LOW';
      else if (confidence === 'LOW') {
        confidence = 'NO_TRADE';
        decision = 'NO_TRADE';
      }
    }

    return { decision, confidence };
  }

  private calculateTradeParams(
    decision: Decision,
    confidence: Confidence,
    conflict: ConflictAnalysis,
    risk: RiskLimits,
    currentPos: CurrentPosition
  ): TradeParameters | null {
    if (decision === 'NO_TRADE' || confidence === 'NO_TRADE') return null;

    const base = this.config.tradeParams[confidence];
    let sizePercent = base.sizePercent;

    // Conflict reduction
    if (conflict.hasConflict) {
      if (conflict.type === 'SOURCE') sizePercent *= (1 - this.config.conflict.source.sizeReduction);
      if (conflict.type === 'REGIME') sizePercent *= (1 - this.config.conflict.regime.sizeReduction);
    }

    // Risk limit check
    const currentSizeUsd = currentPos.size * currentPos.entryPrice;
    const projectedSizeUsd = (this.portfolioValue * sizePercent / 100) * base.leverage;

    if ((currentSizeUsd + projectedSizeUsd) > risk.maxPositionSize) {
      const allowedUsd = Math.max(0, risk.maxPositionSize - currentSizeUsd);
      sizePercent = (allowedUsd / base.leverage / this.portfolioValue) * 100;
    }

    const entryPrice = this.currentPrice;
    const slDist = entryPrice * (base.slPercent / 100);
    const tpDist = entryPrice * (base.tpPercent / 100);

    return {
      side: decision as 'LONG' | 'SHORT',
      leverage: base.leverage,
      sizePercent,
      sizeUsd: (this.portfolioValue * sizePercent / 100) * base.leverage,
      entryPrice,
      stopLoss: decision === 'LONG' ? entryPrice - slDist : entryPrice + slDist,
      takeProfit: decision === 'LONG' ? entryPrice + tpDist : entryPrice - tpDist,
      trailingStopPercent: base.trailing,
      maxSlippage: 0.005
    };
  }

  private defineInvalidation(decision: Decision, metrics: HLPerpsMetrics): string[] {
    const conditions: string[] = [];
    if (decision === 'SHORT') {
      conditions.push(`Short/Long Ratio drops below 1.0 (currently ${metrics.shortLongRatio.toFixed(2)})`);
      conditions.push('Whale flips to LONG');
    } else if (decision === 'LONG') {
      conditions.push('Short/Long Ratio rises above 3.0');
      conditions.push('Whale flips to SHORT');
    }
    return conditions;
  }
}

export { TOKEN_CONFIGS, DEFAULT_WHALE_CONFIG };
