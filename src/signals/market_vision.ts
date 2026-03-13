import { HyperliquidAPI } from '../api/hyperliquid.js';
import { getNansenProAPI, NansenProAPI } from '../integrations/nansen_pro.js';
import { getNansenHyperliquidAPI, NansenHyperliquidAPI } from '../integrations/nansen_scoring.js';
import { AIArtist, VisualAnalysis } from '../vision/ai_artist.js';
import { Technicals } from './technicals.js';
import { getMomentumGuardConfig } from '../config/short_only_config.js';

export type CoinTuning = {
  enabled: boolean;
  baseSpreadBps: number;
  minSpreadBps: number;
  maxSpreadBps: number;
  smFlowSpreadMult: number;      // Mnożnik gdy wysoki SM flow
  smPositionSpreadMult: number;  // Mnożnik gdy SM mocno pozycjonowane
  baseOrderSizeUsd: number;
  maxPositionUsd: number;
  smSignalSkew: number;          // Kierunkowy bias (-0.5 do 0.5)
  inventorySkewMult: number;     // Jak agresywnie reagować na inventory
  maxLeverage: number;
  stopLossPct: number;

  // Dynamic runtime properties (set by DynamicConfigManager)
  bidSizeMultiplier?: number;
  askSizeMultiplier?: number;
  capitalMultiplier?: number;
  targetInventory?: number;
  followSmMode?: string;
  squeezeTriggerPrice?: number;
  stopLossPrice?: number;
  smConflictSeverity?: string;
  smSignalType?: string;
  smSignalDirection?: string;
  smSignalConfidence?: number;
  smSignalReasons?: string[];
  smSignalWarnings?: string[];
  onChainDivergence?: string;
  bottomSignalType?: string;
};

export const NANSEN_TOKENS: Record<string, { chain: string; address: string; spreadCaps?: { min: number; max: number }; tuning?: CoinTuning }> = {
  'VIRTUAL': {
    chain: 'base',
    address: '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b',
    spreadCaps: { min: 0.8, max: 2.0 }
  },
  'ZEC': {
    chain: 'solana',
    address: 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS',
    spreadCaps: { min: 0.9, max: 1.4 },
    tuning: { // 🔴 SELL (-$1.3M netflow)
      enabled: true,
      baseSpreadBps: 25,
      minSpreadBps: 15,
      maxSpreadBps: 80,
      smFlowSpreadMult: 1.4,
      smPositionSpreadMult: 1.3,
      baseOrderSizeUsd: 500,
      maxPositionUsd: 10000,
      smSignalSkew: -0.15,
      inventorySkewMult: 1.3,
      maxLeverage: 2,
      stopLossPct: 0.04
    }
  },
  'HYPE': {
    chain: 'hyperliquid',  // 🔧 FIX 2026-01-25: Changed from hyperevm - HYPE is a perp with no on-chain flows
    address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    spreadCaps: { min: 0.9, max: 1.3 },
    tuning: { // NEUTRAL / HIGH VOL
      enabled: true,
      baseSpreadBps: 30,
      minSpreadBps: 20,
      maxSpreadBps: 100,
      smFlowSpreadMult: 1.5,
      smPositionSpreadMult: 1.3,
      baseOrderSizeUsd: 500,
      maxPositionUsd: 8000,
      smSignalSkew: 0.0,
      inventorySkewMult: 1.5,
      maxLeverage: 2,
      stopLossPct: 0.05
    }
  },
  'MON': {
    chain: 'bnb',
    address: '0xD4099A517f2Fbe8a730d2ECaad1D0824B75e084a',
    spreadCaps: { min: 1.0, max: 3.0 }
  },
  'ETH': {
    chain: 'ethereum',
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    spreadCaps: { min: 0.9, max: 1.5 },
    tuning: { // 🔴 SM HEAVY SHORT (7L / 43S)
      enabled: true,
      baseSpreadBps: 10,
      minSpreadBps: 6,
      maxSpreadBps: 40,
      smFlowSpreadMult: 1.25,
      smPositionSpreadMult: 1.35,
      baseOrderSizeUsd: 1500,
      maxPositionUsd: 25000,
      smSignalSkew: -0.20,
      inventorySkewMult: 1.15,
      maxLeverage: 4,
      stopLossPct: 0.025
    }
  },
  'BTC': { // Dodaję manualnie mimo braku adresu, bo jest w tuningu
    chain: 'ethereum',
    address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
    tuning: { // 🔴 SM HEAVY SHORT (9L / 52S)
      enabled: true,
      baseSpreadBps: 12,
      minSpreadBps: 8,
      maxSpreadBps: 50,
      smFlowSpreadMult: 1.3,
      smPositionSpreadMult: 1.4,
      baseOrderSizeUsd: 2000,
      maxPositionUsd: 30000,
      smSignalSkew: -0.25, // Strong sell bias
      inventorySkewMult: 1.2,
      maxLeverage: 3,
      stopLossPct: 0.02
    }
  },
  'FARTCOIN': {
    chain: 'solana',
    address: '9BB6NFEBSJbCrqODX4F9kR743r923Q83tq6kF659pump',
    spreadCaps: { min: 0.9, max: 2.0 },
    tuning: {
      enabled: true,
      baseSpreadBps: 20,        // 0.20% — slightly wider for meme volatility
      minSpreadBps: 10,         // 0.10% floor
      maxSpreadBps: 60,         // 0.60% during extreme vol
      smFlowSpreadMult: 1.3,    // Widen on SM flow detection
      smPositionSpreadMult: 1.2,
      baseOrderSizeUsd: 2000,   // $2K per level — aggressive SM-following
      maxPositionUsd: 10000,    // $10K max position
      smSignalSkew: 0.0,        // Dynamic from SmAutoDetector (FOLLOW_SM_SHORT/LONG)
      inventorySkewMult: 1.5,   // Aggressive rebalancing for meme
      maxLeverage: 5,
      stopLossPct: 0.05         // 5% SL — meme needs breathing room
    }
  },
  // 🔧 FIX 2026-02-01: "Ostateczne Rozkazy" - new SHORT targets
  'ENA': {
    chain: 'ethereum',
    address: '0x57e114B691Db790C35207b2e685D4A43181e6061',
    spreadCaps: { min: 0.9, max: 1.5 },
    tuning: {
      enabled: true,
      baseSpreadBps: 20,
      minSpreadBps: 12,
      maxSpreadBps: 60,
      smFlowSpreadMult: 1.3,
      smPositionSpreadMult: 1.2,
      baseOrderSizeUsd: 500,
      maxPositionUsd: 5000,
      smSignalSkew: -0.20,
      inventorySkewMult: 1.3,
      maxLeverage: 3,
      stopLossPct: 0.04
    }
  },
  'SUI': {
    chain: 'sui',
    address: '0x2::sui::SUI',
    spreadCaps: { min: 0.9, max: 1.5 },
    tuning: {
      enabled: true,
      baseSpreadBps: 18,
      minSpreadBps: 10,
      maxSpreadBps: 50,
      smFlowSpreadMult: 1.3,
      smPositionSpreadMult: 1.2,
      baseOrderSizeUsd: 500,
      maxPositionUsd: 5000,
      smSignalSkew: -0.20,
      inventorySkewMult: 1.3,
      maxLeverage: 3,
      stopLossPct: 0.035
    }
  },
  'PUMP': {
    chain: 'hyperliquid',
    address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    spreadCaps: { min: 1.0, max: 3.0 }
  },
  'LIT': {
    chain: 'ethereum',
    address: '0xb59490ab09a0f526cc7305822ac65f2ab12f9723',
    spreadCaps: { min: 0.9, max: 1.5 },
    tuning: {
      enabled: true,
      baseSpreadBps: 30,        // 0.30% — wider spread, less loss on small moves
      minSpreadBps: 15,         // 0.15% min during calm
      maxSpreadBps: 60,         // 0.60% during vol
      smFlowSpreadMult: 1.3,    // Widen on SM flow detection
      smPositionSpreadMult: 1.2,
      baseOrderSizeUsd: 2000,   // $2K per level — aggressive SM-following
      maxPositionUsd: 10000,    // $10K max position
      smSignalSkew: 0.0,        // Dynamic from SmAutoDetector (FOLLOW_SM_SHORT/LONG)
      inventorySkewMult: 1.3,   // Standard inventory management
      maxLeverage: 5,
      stopLossPct: 0.04         // 4% SL — altcoin, medium volatility
    }
  },
  'SOL': {
    chain: 'solana',
    address: 'So11111111111111111111111111111111111111112',
    spreadCaps: { min: 0.9, max: 1.3 }
  },
  'WIF': {
    chain: 'solana',
    address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    spreadCaps: { min: 1.0, max: 2.5 }
  },
  'DOGE': {
    chain: 'bnb',
    address: '0xba2ae424d960c26247dd6c32edc70b295c744c43',
    spreadCaps: { min: 0.9, max: 1.3 }
  },
  'XRP': {
    chain: 'bnb',
    address: '0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe',
    spreadCaps: { min: 0.9, max: 1.3 }
  },
  'POPCAT': {
    chain: 'hyperliquid',
    address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    spreadCaps: { min: 0.9, max: 1.5 },
    tuning: {
      enabled: true,
      baseSpreadBps: 42,       // 0.42% target spread
      minSpreadBps: 25,        // 0.25% minimum
      maxSpreadBps: 90,        // 0.90% extreme vol
      smFlowSpreadMult: 1.0,   // No SM adjustment (PURE_MM)
      smPositionSpreadMult: 1.0,
      baseOrderSizeUsd: 1000,  // $1,000 per level (5 levels)
      maxPositionUsd: 11000,   // $11K max position (92% of $12k)
      smSignalSkew: 0.0,       // Neutral — no directional bias
      inventorySkewMult: 1.5,  // Aggressive rebalancing for meme
      maxLeverage: 3,
      stopLossPct: 0.015       // 1.5% SL — tight for meme volatility
    }
  },
  'kPEPE': {
    chain: 'hyperliquid',
    address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    spreadCaps: { min: 0.9, max: 1.5 },
    tuning: {
      enabled: true,
      baseSpreadBps: 10,       // 0.10% base — tight kPEPE book (market spread ~3bps)
      minSpreadBps: 5,         // 0.05% floor — allow tight quoting near mid
      maxSpreadBps: 60,        // 0.60% cap — allows L4 sweep layer
      smFlowSpreadMult: 1.0,   // No SM adjustment (PURE_MM)
      smPositionSpreadMult: 1.0,
      baseOrderSizeUsd: 2000,  // $2K per level — deep book supports it
      maxPositionUsd: 10000,   // $10K max position
      smSignalSkew: 0.0,       // Neutral — no directional bias
      inventorySkewMult: 2.0,  // Aggressive rebalancing (was 1.3) — matched to custom skew logic
      maxLeverage: 5,
      stopLossPct: 0.04        // 4% SL — memecoin volatility
    }
  }
};

export type MarketRegime = 'bull' | 'bear' | 'sideways' | 'volatile';

export type MarketVisionState = {
  btcTrend: 'bull' | 'bear' | 'neutral';
  btcRsi: number;
  regime: MarketRegime;
  globalBiasScore: number; // -100 (strong bear) to +100 (strong bull)
  lastUpdate: number;
};

// S/R Flip Detection — when price breaks through S/R, the old level flips role
export interface FlipCandidate {
  level: number           // S/R price that was broken
  type: 'resistance_to_support' | 'support_to_resistance'
  breakCandle: number     // timestamp of first candle beyond level
  confirmationCount: number  // candles closed on "good" side
  maxExtension: number    // furthest close beyond level (in ATR units)
}

export interface FlippedLevel {
  level: number
  type: 'resistance_to_support' | 'support_to_resistance'
  confirmedAt: number
  retestCount: number
  strength: number        // 1.0 → decays over time
  lastRetestAt: number
  lastDecayAt: number     // timestamp for time-proportional decay
}

export type PairAnalysis = {
  symbol: string;
  trend: 'bull' | 'bear' | 'neutral';
  trend4h: 'bull' | 'bear' | 'neutral'; // 4h Trend vs 200 EMA
  trend15m: 'bull' | 'bear' | 'neutral'; // 15m Trend vs EMA 9/21
  rsi15m: number; // 15m RSI for entry timing
  reversalWarning: 'none' | 'bullish_divergence' | 'bearish_divergence' | 'momentum_cross'; // Early warning
  volatility: 'low' | 'medium' | 'high';
  supportDist: number; // % distance to support
  resistanceDist: number; // % distance to resistance
  rsi: number;
  atr: number;
  ema200_4h: number; // Value of 200 EMA on 4h
  support4h: number; // HTF Support Price — 1h candles, last 72 (3 days)
  resistance4h: number; // HTF Resistance Price — 1h candles, last 72 (3 days)
  supportBody4h: number; // HTF Support from candle bodies (min of O/C) — 1h×72, wick-filtered
  resistanceBody4h: number; // HTF Resistance from candle bodies (max of O/C) — 1h×72, wick-filtered
  supportBody12h: number; // Short-term support from 1h candle bodies (last 50 = 50h) for MG proximity + SMA S/R
  resistanceBody12h: number; // Short-term resistance from 1h candle bodies (last 50 = 50h) for MG proximity + SMA S/R
  lastCandle15mClose: number; // Last CLOSED 15m candle close price (for confirmed S/R break detection)
  sma20: number; // SMA 20 from 1h candles (fast SMA for crossover)
  sma60: number; // SMA 60 from 1h candles (slow SMA for crossover)
  smaCrossover: 'golden' | 'death' | 'none'; // Golden cross = SMA20 > SMA60, Death cross = SMA20 < SMA60
  vwap: number; // Rolling 24h VWAP from 1h candles — "fair value" gravity anchor
  vwapDistance: number; // (price - vwap) / vwap — positive = premium, negative = discount
  activeCandlePattern: 'none' | 'bullish_pinbar' | 'bearish_pinbar' | 'bullish_engulfing' | 'bearish_engulfing';
  isFlashCrash: boolean; // True if last candle > 3% move
  visualAnalysis?: VisualAnalysis; // AI Vision output
  biasScore: number; // -100 to +100
  nansenPressure: number; // Net Buy/Sell Pressure in USD
  nansenScore: number; // Contribution to bias
  recentVolumes15m: number[]; // Last 9 candle volumes for spike detection (sniper mode)
  effectiveSupport?: number;     // Flipped R→S level if between raw support and price
  effectiveResistance?: number;  // Flipped S→R level if between raw resistance and price
};

export class MarketVisionService {
  private api: HyperliquidAPI;
  private nansen: NansenHyperliquidAPI;
  private nansenPro: NansenProAPI;
  private aiArtist: AIArtist;
  private lastVisionUpdate: Map<string, number> = new Map();
  private state: MarketVisionState = {
    btcTrend: 'neutral',
    btcRsi: 50,
    regime: 'sideways',
    globalBiasScore: 0,
    lastUpdate: 0
  };

  private pairAnalysis: Map<string, PairAnalysis> = new Map();
  // S/R Flip Detection state
  private flipCandidates: Map<string, FlipCandidate> = new Map();
  private flippedLevels: Map<string, FlippedLevel[]> = new Map();
  private isRunning: boolean = false;
  private updateIntervalMs: number = 2 * 60 * 1000; // Update every 2 minutes (faster for reversal detection)
  // We will dynamically update this list based on what the bot is trading
  private activePairs: string[] = ['LIT', 'kPEPE', 'ETH', 'BTC', 'HYPE', 'SOL', 'VIRTUAL'];

  constructor(api: HyperliquidAPI) {
    this.api = api;
    this.nansen = getNansenHyperliquidAPI();
    this.nansenPro = getNansenProAPI();
    this.aiArtist = new AIArtist();
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('👁️  MarketVision started');
    this.loop();
  }

  stop() {
    this.isRunning = false;
  }

  private async loop() {
    while (this.isRunning) {
      try {
        await this.updateAnalysis();
      } catch (error) {
        console.error('MarketVision update failed:', error);
      }
      await new Promise(resolve => setTimeout(resolve, this.updateIntervalMs));
    }
  }

  private async updateAnalysis() {
    const now = Date.now();
    // 1. Fetch BTC Context (The "Tide")
    try {
      // 4h candles for trend
      const btcCandles = await this.api.getCandles('BTC', '4h', now - 60 * 24 * 60 * 60 * 1000, now);
      if (btcCandles && btcCandles.length > 200) {
        const ema200 = Technicals.calculateEMA(btcCandles, 200);
        const rsi = Technicals.calculateRSI(btcCandles, 14);
        const latestClose = btcCandles[btcCandles.length - 1].c;
        const latestEma = Technicals.getLatest(ema200) || latestClose;
        const latestRsi = Technicals.getLatest(rsi) || 50;

        // Determine trend relative to EMA200
        this.state.btcTrend = latestClose > latestEma ? 'bull' : 'bear';
        this.state.btcRsi = latestRsi;

        // Determine regime
        if (latestRsi > 70 || latestRsi < 30) {
          this.state.regime = 'volatile';
        } else {
          // Simple check: if price is close to EMA (within 2%), it's sideways/choppy
          const dist = Math.abs((latestClose - latestEma) / latestEma);
          this.state.regime = dist < 0.02 ? 'sideways' : this.state.btcTrend;
        }

        console.log(`👁️  BTC Context: ${latestClose.toFixed(0)} vs EMA200=${latestEma.toFixed(0)} (${this.state.btcTrend}) | RSI=${latestRsi.toFixed(1)} | Regime=${this.state.regime}`);
      }
    } catch (error) {
      console.warn('Failed to fetch BTC candles:', error);
    }

    // NEW: Fetch Nansen Smart Money Data
    let nansenMap = new Map<string, any>();
    try {
      if (this.nansen.isEnabled()) {
        // Fetch top 100 tokens to increase chance of finding our pairs
        const nansenData = await this.nansen.getPerpScreener({ limit: 100, sortBy: 'buy_sell_pressure' });
        for (const token of nansenData) {
          nansenMap.set(token.token_symbol, token);
        }
        // Also try with USDT suffix just in case
        for (const token of nansenData) {
          if (token.token_symbol.endsWith('USDT')) {
            nansenMap.set(token.token_symbol.replace('USDT', ''), token);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to fetch Nansen data:', e);
    }

    // 2. Analyze Active Pairs (The "Boats")
    for (const pair of this.activePairs) {
      try {
        // A+B. 1h Candles — volatility, tactical bias, HTF S/R, AND EMA200 trend
        // Previously fetched 4h candles separately for EMA200 — removed to save 6 API calls/cycle
        // EMA200 on 1h = 200h = ~8.3 day trend anchor (sufficient for volatile memecoins)
        const candles = await this.api.getCandles(pair, '1h', now - 34 * 24 * 60 * 60 * 1000, now);
        let trend4h: 'bull' | 'bear' | 'neutral' = 'neutral';
        let ema200_4h = 0;
        let support4h = 0;
        let resistance4h = 999999;
        let supportBody4h = 0;
        let resistanceBody4h = 999999;

        if (!candles || candles.length < 50) continue;

        // EMA200 from 1h candles (200h = ~8.3 day trend anchor)
        if (candles.length >= 200) {
          const ema200Series = Technicals.calculateEMA(candles, 200);
          ema200_4h = Technicals.getLatest(ema200Series) || 0;
          const currentPrice = candles[candles.length - 1].c;
          if (ema200_4h > 0) {
            trend4h = currentPrice > ema200_4h ? 'bull' : 'bear';
          }
        }

        // HTF Support/Resistance from 1h candles (last 72 = 3 days)
        // Previously 4h×30 (5 days) — too wide for volatile memecoins, price never entered ATR zone
        // 1h×72 (3 days) gives tighter HTF levels while still capturing multi-day structure
        const htfLookback = Math.min(72, candles.length);
        if (htfLookback >= 24) {
          const htf1h = candles.slice(-htfLookback);
          support4h = Math.min(...htf1h.map(c => c.l));
          resistance4h = Math.max(...htf1h.map(c => c.h));
          // Body-based S/R — filters out wick noise (flash crash spikes)
          supportBody4h = Math.min(...htf1h.map(c => Math.min(c.o, c.c)));
          resistanceBody4h = Math.max(...htf1h.map(c => Math.max(c.o, c.c)));
        }

        // STF S/R from 1h candles (last 24 = 24h) — for Momentum Guard proximity
        // Using 1h candles for stable S/R levels, MM operates on 15m candles for execution
        let supportBody12h = 0;
        let resistanceBody12h = 0;
        let sma20 = 0;
        let sma60 = 0;
        let smaCrossover: 'golden' | 'death' | 'none' = 'none';

        // C. STF Context: 15m Candles for "Golden Ticket" Entry
        // We fetch last 2 days (48h) of 15m candles
        const candles15m = await this.api.getCandles(pair, '15m', now - 2 * 24 * 60 * 60 * 1000, now);
        let trend15m: 'bull' | 'bear' | 'neutral' = 'neutral';
        let rsi15m = 50;

        if (candles15m && candles15m.length >= 21) {
          const ema9_15m = Technicals.getLatest(Technicals.calculateEMA(candles15m, 9)) || 0;
          const ema21_15m = Technicals.getLatest(Technicals.calculateEMA(candles15m, 21)) || 0;
          rsi15m = Technicals.getLatest(Technicals.calculateRSI(candles15m, 14)) || 50;

          if (ema9_15m > 0 && ema21_15m > 0) {
            trend15m = ema9_15m > ema21_15m ? 'bull' : 'bear';
          }

          // STF S/R from 1h candle bodies (last 50 = 50h) — matches backtest rolling(50) S/R
          // MM still operates on 15m candles for execution timing
          const stfLookback = Math.min(50, candles.length);
          if (stfLookback >= 12) {
            const recent1h = candles.slice(-stfLookback);
            supportBody12h = Math.min(...recent1h.map(c => Math.min(c.o, c.c)));
            resistanceBody12h = Math.max(...recent1h.map(c => Math.max(c.o, c.c)));
          }

          // SMA fast/slow from 1h candles — crossover signal for momentum strategy
          // Periods are per-token from MomentumGuardConfig (kPEPE: 20/60, VIRTUAL: 20/30, etc.)
          const mgConfig = getMomentumGuardConfig(pair);
          const smaFast = mgConfig.smaFastPeriod;   // e.g. 20
          const smaSlow = mgConfig.smaSlowPeriod;    // e.g. 60 (kPEPE) or 30 (VIRTUAL)
          const closes1h = candles.map((c: any) => c.c);
          if (closes1h.length >= smaSlow) {
            const sumFast = closes1h.slice(-smaFast).reduce((a: number, b: number) => a + b, 0);
            sma20 = sumFast / smaFast;
            const sumSlow = closes1h.slice(-smaSlow).reduce((a: number, b: number) => a + b, 0);
            sma60 = sumSlow / smaSlow;
            // Check previous bar's SMAs for crossover detection
            const prevClosesFast = closes1h.slice(-(smaFast + 1), -1);
            const prevClosesSlow = closes1h.slice(-(smaSlow + 1), -1);
            if (prevClosesFast.length === smaFast && prevClosesSlow.length === smaSlow) {
              const prevSmaFast = prevClosesFast.reduce((a: number, b: number) => a + b, 0) / smaFast;
              const prevSmaSlow = prevClosesSlow.reduce((a: number, b: number) => a + b, 0) / smaSlow;
              if (sma20 > sma60 && prevSmaFast <= prevSmaSlow) {
                smaCrossover = 'golden';  // Fast SMA just crossed above slow SMA
              } else if (sma20 < sma60 && prevSmaFast >= prevSmaSlow) {
                smaCrossover = 'death';   // Fast SMA just crossed below slow SMA
              }
            }
          } else if (closes1h.length >= smaFast) {
            const sumFast = closes1h.slice(-smaFast).reduce((a: number, b: number) => a + b, 0);
            sma20 = sumFast / smaFast;
          }
        }

        // Rolling 24h VWAP from 1h candles — "fair value" gravity anchor for grid
        // VWAP = Sum(TypicalPrice × Volume) / Sum(Volume) over last 24 1h candles
        let vwap = 0;
        let vwapDistance = 0;
        const vwapLookback = Math.min(24, candles.length);
        if (vwapLookback >= 12) {
          const vwapCandles = candles.slice(-vwapLookback);
          let sumTpv = 0;
          let sumVol = 0;
          for (const c of vwapCandles) {
            const tp = (c.h + c.l + c.c) / 3;
            sumTpv += tp * c.v;
            sumVol += c.v;
          }
          if (sumVol > 0) {
            vwap = sumTpv / sumVol;
            const currentPrice = candles[candles.length - 1].c;
            vwapDistance = (currentPrice - vwap) / vwap;
          }
        }

        // Last CLOSED 15m candle close — for confirmed S/R break detection
        // candles15m[-1] = forming (current), candles15m[-2] = last closed
        let lastCandle15mClose = 0;
        if (candles15m && candles15m.length >= 2) {
          lastCandle15mClose = candles15m[candles15m.length - 2].c;
        }

        // FLASH CRASH DETECTOR (High Volatility Anomaly)
        let isFlashCrash = false;
        if (candles15m && candles15m.length > 0) {
          const last = candles15m[candles15m.length - 1]; // Current forming candle
          const rangePct = last.o > 0 ? (last.h - last.l) / last.o : 0;
          if (rangePct > 0.03) { // > 3% move in 15 mins
            isFlashCrash = true;
            console.warn(`⚡ ${pair}: FLASH CRASH/PUMP DETECTED! (${(rangePct * 100).toFixed(1)}% move in 15m)`);
          }
        }

        // Recent 15m volumes for sniper mode cascade detection
        const recentVolumes15m = (candles15m && candles15m.length >= 9)
          ? candles15m.slice(-9).map(c => Number(c.v || 0))
          : [];

        // AI VISION (GPT-4o Chart Analysis)
        let visualAnalysis: VisualAnalysis | undefined = this.pairAnalysis.get(pair)?.visualAnalysis;
        const lastVision = this.lastVisionUpdate.get(pair) || 0;
        // Update every 15 mins OR on flash crash (max once per 5 mins)
        const visionDue = (now - lastVision > 15 * 60 * 1000) || (isFlashCrash && now - lastVision > 5 * 60 * 1000);

        if (visionDue && this.aiArtist.isEnabled()) {
          try {
            // Mapper to ensure clean data for ChartRenderer
            const cleanCandles = candles15m.map(c => ({
              o: Number(c.o),
              h: Number(c.h),
              l: Number(c.l),
              c: Number(c.c),
              t: Number(c.t),
              v: Number(c.v || 0)
            }));

            visualAnalysis = await this.aiArtist.analyzeChart(cleanCandles);
            this.lastVisionUpdate.set(pair, now);

            if (visualAnalysis.patternConfidence >= 0.6 || visualAnalysis.squeezeRisk || visualAnalysis.breakoutRisk) {
              console.log(`🎨 [AI VISION] ${pair}: ${visualAnalysis.pattern} | Trend:${visualAnalysis.visualTrend} | Score:${visualAnalysis.visualScore} | "${visualAnalysis.comment}"`);
            }
          } catch (e) {
            // silent fail
          }
        }

        const close = candles[candles.length - 1].c;
        const rsi = Technicals.getLatest(Technicals.calculateRSI(candles, 14)) || 50;
        const atr = Technicals.getLatest(Technicals.calculateATR(candles, 14)) || 0;
        const ema50 = Technicals.getLatest(Technicals.calculateEMA(candles, 50)) || close;

        // Reversal Detector: 9 vs 21 EMA Cross
        const ema9Series = Technicals.calculateEMA(candles, 9);
        const ema21Series = Technicals.calculateEMA(candles, 21);
        const ema9 = Technicals.getLatest(ema9Series) || close;
        const ema21 = Technicals.getLatest(ema21Series) || close;

        // Reversal warning logic
        let reversalWarning: 'none' | 'bullish_divergence' | 'bearish_divergence' | 'momentum_cross' = 'none';

        // Check for momentum cross against the major trend
        if (trend4h === 'bear' && ema9 > ema21) {
          reversalWarning = 'momentum_cross'; // Bullish cross in a bear trend
        } else if (trend4h === 'bull' && ema9 < ema21) {
          reversalWarning = 'momentum_cross'; // Bearish cross in a bull trend
        }

        // Volatility classification based on ATR %
        const atrPct = (atr / close) * 100;
        let volatility: 'low' | 'medium' | 'high' = 'medium';
        if (atrPct > 2.0) volatility = 'high';
        if (atrPct < 0.5) volatility = 'low';

        // Trend (1h)
        const trend = close > ema50 ? 'bull' : 'bear';

        // Candle Pattern Detection (1h)
        let activeCandlePattern: PairAnalysis['activeCandlePattern'] = 'none';
        if (candles.length >= 3) {
          const lastCandle = candles[candles.length - 2]; // Last fully completed candle
          const prevCandle = candles[candles.length - 3];

          if (lastCandle && prevCandle) {
            const total = lastCandle.h - lastCandle.l;
            const wickTop = lastCandle.h - Math.max(lastCandle.c, lastCandle.o);
            const wickBottom = Math.min(lastCandle.c, lastCandle.o) - lastCandle.l;

            // Pinbar
            if (total > 0) {
              if (wickBottom > 0.6 * total) activeCandlePattern = 'bullish_pinbar';
              else if (wickTop > 0.6 * total) activeCandlePattern = 'bearish_pinbar';
            }

            // Engulfing
            if (activeCandlePattern === 'none') {
              const isBullish = lastCandle.c > lastCandle.o;
              const prevBullish = prevCandle.c > prevCandle.o;
              if (isBullish && !prevBullish && lastCandle.c > prevCandle.h && lastCandle.o < prevCandle.l) {
                activeCandlePattern = 'bullish_engulfing';
              } else if (!isBullish && prevBullish && lastCandle.c < prevCandle.l && lastCandle.o > prevCandle.h) {
                activeCandlePattern = 'bearish_engulfing';
              }
            }

            if (activeCandlePattern !== 'none') {
              console.log(`🕯️  ${pair} Pattern Detected: ${activeCandlePattern} (1h)`);
            }
          }
        }

        // Distances to HTF Walls
        const distRes = resistance4h > 0 ? (resistance4h - close) / close : 999;
        const distSup = support4h > 0 ? (close - support4h) / close : 999;

        // Nansen Logic (Classic Screener)
        let nansenPressure = 0;
        let nansenScore = 0;
        const nansenData = nansenMap.get(pair);
        if (nansenData) {
          nansenPressure = nansenData.buy_sell_pressure; // USD
          const pressureMillions = nansenPressure / 1000000;
          nansenScore = Math.max(-30, Math.min(30, pressureMillions * 20));
        }

        // --- NANSEN GOD MODE DEEP DIVE ---
        // Analiza on-chain dla VIRTUAL, ZEC, HYPE
        const godModeConfig = NANSEN_TOKENS[pair];
        if (godModeConfig && this.nansenPro.isEnabled()) {
          try {
            // 1. Flow Intelligence (Smart Money & Whale Flows)
            const flows = await this.nansenPro.getFlowIntelligence([godModeConfig.address], godModeConfig.chain);
            if (flows && flows.length > 0) {
              const f = flows[0];
              const smFlow = f.smart_money_flow_usd || 0;
              const whaleFlow = f.whale_flow_usd || 0;

              // Boost score if Smart Money is accumulating
              if (smFlow > 100000) {
                console.log(`🧠 [GOD MODE] ${pair} Smart Money Accumulation: +$${(smFlow / 1000).toFixed(0)}k`);
                nansenScore += 10;
              } else if (smFlow < -100000) {
                console.log(`🧠 [GOD MODE] ${pair} Smart Money Dumping: -$${(Math.abs(smFlow) / 1000).toFixed(0)}k`);
                nansenScore -= 10;
              }

              // Whale Watch
              if (whaleFlow > 500000) {
                console.log(`🐳 [GOD MODE] ${pair} WHALE Accumulation: +$${(whaleFlow / 1000).toFixed(0)}k`);
                nansenScore += 5;
              }
            }

            // 2. Special Logic for HYPE Perps
            if (pair === 'HYPE') {
              const perps = await this.nansenPro.getTgmPerpPositions('HYPE');
              if (perps && perps.length > 0) {
                const longs = perps.filter(p => p.side === 'long').reduce((s, p) => s + p.position_value_usd, 0);
                const shorts = perps.filter(p => p.side === 'short').reduce((s, p) => s + p.position_value_usd, 0);
                const ratio = longs / (shorts || 1);

                if (ratio > 2.5) {
                  console.log(`⚡ [GOD MODE] HYPE Perp Bias: HEAVY LONG (Ratio ${ratio.toFixed(2)})`);
                  // Uwaga: Jeśli wszyscy są Long, to może być sygnał korekty (funding/long squeeze risk)
                  // Ale w trendzie to potwierdzenie siły. Traktujemy ostrożnie (+5)
                  nansenScore += 5;
                } else if (ratio < 0.4) {
                  console.log(`⚡ [GOD MODE] HYPE Perp Bias: HEAVY SHORT (Ratio ${ratio.toFixed(2)})`);
                  nansenScore -= 5;
                }
              }
            }

          } catch (gmError) {
            // Silent fail for god mode to not disrupt main loop
          }
        }

        // Bias Score Calculation (-100 to +100)
        let score = 0;

        // --- PRIMARY BIAS: 4h 200 EMA (The "Anchor") ---
        // User requested this to be the "most important bias"
        if (trend4h === 'bull') score += 50;
        if (trend4h === 'bear') score -= 50;

        // --- SECONDARY BIAS: 15m Trend (Now more impactful) ---
        if (trend15m === 'bull') score += 25; // Boosted influence
        else score -= 25;

        // --- NANSEN SMART MONEY BIAS ---
        // "Eyes" of the bot - giving bias even in sideways markets
        if (nansenScore !== 0) {
          score += nansenScore;
          // console.log(`👁️  ${pair}: Nansen Smart Money Bias: ${nansenScore.toFixed(1)}`);
        }

        // --- AI VISION BIAS ---
        if (visualAnalysis) {
          // Map visualScore (0-100) to bias (-10 to +10) -> approx +/- 3bps impact
          const visualBias = (visualAnalysis.visualScore - 50) * 0.2;
          score += visualBias;

          // Pattern Confidence Boost
          if (visualAnalysis.patternConfidence > 0.6) {
            if (visualAnalysis.visualTrend === 'up') score += 10;
            if (visualAnalysis.visualTrend === 'down') score -= 10;
          }
        }

        // --- REVERSAL LOGIC (Early Detection) ---
        // If we detect a reversal signal (9/21 cross against trend), we heavily dampen the score
        if (reversalWarning === 'momentum_cross') {
          if (trend4h === 'bear') {
            score += 35; // Neutralize the -50 bear score significantly
            // console.log(`👁️  ${pair} Bullish Reversal Detected! Dampening Bear Bias.`);
          } else if (trend4h === 'bull') {
            score -= 35; // Neutralize the +50 bull score significantly
            // console.log(`👁️  ${pair} Bearish Reversal Detected! Dampening Bull Bias.`);
          }
        }

        // --- TACTICAL: RSI Mean Reversion ---
        // High RSI -> sell pressure -> negative score
        if (rsi > 75) score -= 25; // Stronger penalty for high RSI
        if (rsi < 25) score += 25; // Stronger bonus for low RSI

        // --- TACTICAL: S/R Bounce ---
        if (distSup < 0.02) score += 20; // Near support -> buy
        if (distRes < 0.02) score -= 20; // Near resistance -> sell

        // --- GLOBAL CONTEXT: BTC ---
        if (this.state.btcTrend === 'bear') score -= 10;
        if (this.state.btcTrend === 'bull') score += 10;

        const analysis: PairAnalysis = {
          symbol: pair,
          trend,
          trend4h,
          trend15m,
          rsi15m,
          reversalWarning,
          volatility,
          rsi,
          atr,
          ema200_4h,
          support4h,
          resistance4h,
          supportBody4h,
          resistanceBody4h,
          supportBody12h,
          resistanceBody12h,
          lastCandle15mClose,
          sma20,
          sma60,
          smaCrossover,
          vwap,
          vwapDistance,
          supportDist: distSup,
          resistanceDist: distRes,
          activeCandlePattern,
          isFlashCrash,
          visualAnalysis,
          nansenPressure,
          nansenScore,
          biasScore: Math.max(-100, Math.min(100, score)),
          recentVolumes15m,
        };

        this.pairAnalysis.set(pair, analysis);

        // S/R Flip Detection — update after raw S/R computed, sets effectiveSupport/effectiveResistance
        this.updateFlipDetection(pair, analysis);

        // THROTTLE REQUESTS: Prevent 429 on Hyperliquid and Nansen
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (err) {
        // ignore individual pair errors
        console.warn(`Failed to update analysis for ${pair}:`, err);
      }
    }

    this.state.lastUpdate = now;
    this.state.globalBiasScore = this.calculateGlobalBiasScore();
  }

  private calculateGlobalBiasScore(): number {
    let score = 0;
    if (this.state.btcTrend === 'bull') score += 50;
    if (this.state.btcTrend === 'bear') score -= 50;
    score += (this.state.btcRsi - 50) * 1; // RSI contribution

    // Average pair bias
    const pairScores = Array.from(this.pairAnalysis.values()).map(pa => pa.biasScore);
    if (pairScores.length > 0) {
      score += pairScores.reduce((sum, s) => sum + s, 0) / pairScores.length * 0.5; // 50% weight
    }
    return Math.max(-100, Math.min(100, score));
  }

  /**
   * S/R Flip Detection — detects when price breaks through S/R and the old level flips role.
   * After breakout + confirmation, tracks flipped levels and sets effectiveSupport/effectiveResistance.
   */
  private updateFlipDetection(pair: string, analysis: PairAnalysis): void {
    const config = getMomentumGuardConfig(pair);
    const confirmCandles = config.srFlipConfirmCandles ?? 3;
    const minExtATR = config.srFlipMinExtensionATR ?? 0.3;
    const retestZoneATR = config.srFlipRetestZoneATR ?? 0.5;
    const decayPerHour = config.srFlipDecayPerHour ?? 0.02;
    const maxAgeHours = config.srFlipMaxAgeHours ?? 48;

    const now = Date.now();
    const price = analysis.lastCandle15mClose || 0;
    const atr = analysis.atr || 0;
    const rawSupport = analysis.supportBody12h || 0;
    const rawResistance = analysis.resistanceBody12h || 0;

    if (!price || !atr || !rawSupport || !rawResistance) return;

    // --- 1. Check for new breakout candidates ---
    const candidateKey = pair;
    let candidate = this.flipCandidates.get(candidateKey);

    // Resistance breakout: candle closed ABOVE resistance + minExtATR
    if (price > rawResistance + minExtATR * atr) {
      if (!candidate || candidate.type !== 'resistance_to_support') {
        candidate = {
          level: rawResistance,
          type: 'resistance_to_support',
          breakCandle: now,
          confirmationCount: 1,
          maxExtension: (price - rawResistance) / atr,
        };
        this.flipCandidates.set(candidateKey, candidate);
      } else {
        candidate.confirmationCount++;
        candidate.maxExtension = Math.max(candidate.maxExtension, (price - rawResistance) / atr);
      }
    }
    // Support breakdown: candle closed BELOW support - minExtATR
    else if (price < rawSupport - minExtATR * atr) {
      if (!candidate || candidate.type !== 'support_to_resistance') {
        candidate = {
          level: rawSupport,
          type: 'support_to_resistance',
          breakCandle: now,
          confirmationCount: 1,
          maxExtension: (rawSupport - price) / atr,
        };
        this.flipCandidates.set(candidateKey, candidate);
      } else {
        candidate.confirmationCount++;
        candidate.maxExtension = Math.max(candidate.maxExtension, (rawSupport - price) / atr);
      }
    }
    // Price came back inside S/R range — cancel candidate
    else if (candidate) {
      this.flipCandidates.delete(candidateKey);
      candidate = undefined;
    }

    // --- 2. Promote confirmed candidates to FlippedLevel ---
    if (candidate && candidate.confirmationCount >= confirmCandles) {
      const levels = this.flippedLevels.get(pair) || [];
      // Max 1 active per type
      const existingIdx = levels.findIndex(l => l.type === candidate!.type);
      const flipped: FlippedLevel = {
        level: candidate.level,
        type: candidate.type,
        confirmedAt: now,
        retestCount: 0,
        strength: 1.0,
        lastRetestAt: now,
        lastDecayAt: now,
      };
      if (existingIdx >= 0) {
        levels[existingIdx] = flipped;
      } else {
        levels.push(flipped);
      }
      this.flippedLevels.set(pair, levels);
      this.flipCandidates.delete(candidateKey);

      console.log(`🔄 [SR_FLIP] ${pair}: ${candidate.type} confirmed — level=${candidate.level.toPrecision(5)} ext=${candidate.maxExtension.toFixed(2)}ATR confirms=${candidate.confirmationCount}`);
    }

    // --- 3. Update flipped levels: retests, decay, expiry ---
    const levels = this.flippedLevels.get(pair);
    if (levels) {
      for (let i = levels.length - 1; i >= 0; i--) {
        const fl = levels[i];

        // Retest detection: price comes back near flipped level
        const distToFlipped = Math.abs(price - fl.level) / atr;
        if (distToFlipped <= retestZoneATR) {
          fl.retestCount++;
          fl.strength = Math.min(1.0, fl.strength + 0.1); // refresh on retest
          fl.lastRetestAt = now;
        }

        // Time-based decay (proportional to elapsed time since last decay)
        const ageHours = (now - fl.confirmedAt) / (3600 * 1000);
        const hoursSinceLastDecay = (now - fl.lastDecayAt) / (3600 * 1000);
        let decayAmount = decayPerHour * hoursSinceLastDecay;

        // Rolling drift: raw support rose above flipped support → faster decay (3x)
        if (fl.type === 'resistance_to_support' && rawSupport > fl.level) {
          decayAmount += decayPerHour * 2 * hoursSinceLastDecay;
        }
        if (fl.type === 'support_to_resistance' && rawResistance < fl.level) {
          decayAmount += decayPerHour * 2 * hoursSinceLastDecay;
        }
        fl.strength -= decayAmount;
        fl.lastDecayAt = now;

        // Expiry
        if (fl.strength <= 0 || ageHours > maxAgeHours) {
          levels.splice(i, 1);
        }
      }
      if (levels.length === 0) {
        this.flippedLevels.delete(pair);
      }
    }

    // --- 4. Set effectiveSupport / effectiveResistance ---
    const activeLevels = this.flippedLevels.get(pair) || [];

    // Flipped R→S: old resistance became support. Must be BETWEEN raw support and price.
    const flippedSupport = activeLevels.find(l =>
      l.type === 'resistance_to_support' && l.level > rawSupport && l.level < price
    );
    if (flippedSupport) {
      analysis.effectiveSupport = flippedSupport.level;
    }

    // Flipped S→R: old support became resistance. Must be BETWEEN raw resistance and price.
    const flippedResist = activeLevels.find(l =>
      l.type === 'support_to_resistance' && l.level < rawResistance && l.level > price
    );
    if (flippedResist) {
      analysis.effectiveResistance = flippedResist.level;
    }
  }

  getGlobalState(): MarketVisionState {
    return { ...this.state };
  }

  getPairAnalysis(symbol: string): PairAnalysis | undefined {
    return this.pairAnalysis.get(symbol);
  }

  /**
   * Vision-aware spread multiplier.
   *
   * - przy wysokim ryzyku / squeeze / breakout => szerzej
   * - przy czytelnym, spokojnym obrazie => można delikatnie zwęzić
   */
  getSpreadMultiplier(symbol: string): number {
    const analysis = this.pairAnalysis.get(symbol);
    if (!analysis) return 1.0;

    let mult = 1.0;

    // --- CLASSIC (ATR / REGIME) ---
    if (analysis.volatility === 'high') mult *= 2.0;
    if (analysis.volatility === 'low') mult *= 0.9;
    if (this.state.regime === 'volatile') mult *= 1.2;
    if (analysis.reversalWarning !== 'none') mult *= 1.3;

    // --- AI VISION ---
    const v = analysis.visualAnalysis;
    if (v) {
      // 1) riskScore -> im wyżej, tym szerzej (od 5 w górę)
      const r = v.riskScore;  // 0..10
      const kSpreadMax = 0.5; // max +50% przez sam riskScore
      if (r > 5) {
        const over = (r - 5) / 5;        // 0..1
        const extra = kSpreadMax * over; // 0..0.5
        mult *= (1 + extra);               // 1..1.5
      }

      // 2) visualScore -> czytelny trend + niskie ryzyko => można lekko zwęzić
      const s = (v.visualScore - 50) / 50; // -1..+1
      if (Math.abs(s) > 0.5 && r < 4) {
        mult *= 0.9; // -10% spreadu przy ładnym, spokojnym trendzie
      }

      // 3) squeeze / breakout / exhaustion -> dodatkowe poszerzenie
      if (v.squeezeRisk || v.breakoutRisk) {
        mult *= 1.25; // chcemy mniej agresywnego quoting w okolicach wybicia
      }

      if (v.exhaustion) {
        mult *= 1.2; // ruch zmęczony => niepewność, wolimy szerzej
      }
    }

    // 4) Końcowy clamp
    if (mult < 0.7) mult = 0.7;
    if (mult > 2.5) mult = 2.5;

    return mult;
  }

  /**
   * Vision-based directional bid/ask bias for PURE_MM grid.
   * Returns { bidMult, askMult } — multiplicative adjustments to sizeMultipliers.
   *
   * Unlike getSizeSkew() (which injects into inventorySkew and is bypassed for PURE_MM),
   * this returns direct multipliers for the kPEPE pipeline.
   *
   * Signals used:
   * 1. Trend alignment (4h + 15m) — strongest signal (40%)
   * 2. RSI extremes (overbought/oversold) (25%)
   * 3. AI Vision (visualScore, exhaustion) (20%)
   * 4. S/R proximity (near support = bullish, near resistance = bearish) (15%)
   *
   * Range: bidMult/askMult in [0.80, 1.20] — soft ±20% max bias.
   */
  getDirectionalBias(symbol: string): { bidMult: number; askMult: number; reason: string } {
    const analysis = this.pairAnalysis.get(symbol);
    if (!analysis) return { bidMult: 1.0, askMult: 1.0, reason: '' };

    let score = 0; // -1.0 (bearish) to +1.0 (bullish)

    // 1. Trend alignment (weight 40%)
    const t4h = analysis.trend4h;
    const t15m = analysis.trend15m;
    if (t4h === 'bull' && t15m === 'bull') score += 0.40;
    else if (t4h === 'bear' && t15m === 'bear') score -= 0.40;
    else if (t4h === 'bull') score += 0.15;
    else if (t4h === 'bear') score -= 0.15;

    // 2. RSI (weight 25%)
    const rsi = analysis.rsi;
    if (rsi > 75) score -= 0.25 * ((rsi - 75) / 25);
    else if (rsi < 25) score += 0.25 * ((25 - rsi) / 25);

    // 3. AI Vision (weight 20%)
    const v = analysis.visualAnalysis;
    if (v) {
      const vs = (v.visualScore - 50) / 50; // -1..+1
      score += 0.20 * vs;
      if (v.exhaustion) score *= 0.5; // halve conviction when exhausted
    }

    // 4. S/R proximity (weight 15%)
    if (analysis.supportDist < 0.02) score += 0.15;
    if (analysis.resistanceDist < 0.02) score -= 0.15;

    // Clamp score to [-1, 1]
    score = Math.max(-1.0, Math.min(1.0, score));

    // Convert to multipliers — max ±20% bias
    const maxBias = 0.20;
    const bias = score * maxBias;
    const bidMult = 1.0 + bias;
    const askMult = 1.0 - bias;

    const reason = Math.abs(score) >= 0.10
      ? `score=${score.toFixed(2)} t4h=${t4h} t15m=${t15m} RSI=${rsi.toFixed(0)}${v ? ` vs=${v.visualScore}` : ''}`
      : '';

    return { bidMult, askMult, reason };
  }

  /**
   * Calculates directional size skew (-1.0 to 1.0)
   * Positive = skew towards Longs (bid heavy)
   * Negative = skew towards Shorts (ask heavy)
   *
   * NOTE: The GridManager interprets skew as "Inventory Skew".
   * - Positive Inventory Skew (Long) -> Widen Bids (Don't Buy), Narrow Asks (Sell) -> BEARISH Action
   * - Negative Inventory Skew (Short) -> Narrow Bids (Buy), Widen Asks (Don't Sell) -> BULLISH Action
   *
   * Therefore, we must INVERT the Bias Score:
   * - Bearish Bias (Negative Score) -> Return POSITIVE Skew (Simulate Long -> Sell)
   * - Bullish Bias (Positive Score) -> Return NEGATIVE Skew (Simulate Short -> Buy)
   */
  getSizeSkew(symbol: string): number {
    const analysis = this.pairAnalysis.get(symbol);
    if (!analysis) return 0;

    // Map bias score (-100..100) to skew (-0.8..0.8)
    // INVERTED: Bearish Score (-) -> Positive Skew (+)
    return -(analysis.biasScore / 125);
  }

  /**
   * Dynamic position size multiplier based on:
   * - multi-timeframe trend (4h / 15m)
   * - Nansen smart money
   * - AI Vision (visualScore, patternConfidence, riskScore, exhaustion, breakout/squeeze)
   *
   * Range: 0.5x (very defensive) to 1.5x (aggressive, high conviction).
   */
  getSizeMultiplier(symbol: string): number {
    const analysis = this.pairAnalysis.get(symbol);
    if (!analysis) return 1.0;

    const trend4h = analysis.trend4h;
    const trend15m = analysis.trend15m;
    const v = analysis.visualAnalysis;

    let mult = 1.0;

    // ---- 0) Flash crash hard-stop ----
    if (analysis.isFlashCrash) {
      return 0.5; // always cut size in panic mode
    }

    // ---- 1) Trend alignment baseline ----
    const is4hDir = trend4h === "bull" || trend4h === "bear";
    const is15mDir = trend15m === "bull" || trend15m === "bear";

    if (is4hDir && is15mDir && trend4h === trend15m) {
      // strong trend alignment
      mult = 1.25;
    } else if (is4hDir && is15mDir && trend4h !== trend15m) {
      // conflict - be defensive
      mult = 0.8;
    } else {
      mult = 1.0; // no clear trend
    }

    // ---- 2) Nansen boost (smart money) ----
    if (trend4h === "bull" && analysis.nansenScore > 10) {
      mult += 0.1;
    } else if (trend4h === "bear" && analysis.nansenScore < -10) {
      mult += 0.1;
    }

    // ---- 3) AI Vision – Sentiment + Pattern + Risk ----
    if (v) {
      // 3a) Sentiment from visualScore (0..100) -> s in [-1, 1]
      const s = (v.visualScore - 50) / 50;
      const kSent = 0.2;
      mult += kSent * s;

      // 3b) Pattern + patternConfidence - only with 4h trend
      let patternBoost = 0;
      if (v.patternConfidence > 0.5) {
        const confAdj = (v.patternConfidence - 0.5) / 0.5; // 0..1
        const kPatternMax = 0.2;

        const sameDir =
          (v.visualTrend === "up" && trend4h === "bull") ||
          (v.visualTrend === "down" && trend4h === "bear");

        if (sameDir) {
          patternBoost = kPatternMax * confAdj;
        }
      }
      mult += patternBoost;

      // 3c) riskScore - upper half <6..10> cuts size up to 50%
      const r = v.riskScore;
      const r0 = 6;
      const kRiskMaxCut = 0.5;
      if (r > r0) {
        const over = (r - r0) / (10 - r0);
        const cut = kRiskMaxCut * over;
        mult *= (1 - cut);
      }

      // 3d) exhaustion
      if (v.exhaustion) {
        mult *= 0.7;
      }

      // 3e) breakout / squeeze
      if (v.breakoutRisk || v.squeezeRisk) {
        mult *= 0.85;
      }
    }

    // ---- 4) Final Clamp ----
    if (mult < 0.5) mult = 0.5;
    if (mult > 1.5) mult = 1.5;

    return mult;
  }

  /**
   * Institutional Trade Permissions (Regime Gating)
   * Prevents "Catching Falling Knives" and "Buying Tops"
   */
  getTradePermissions(symbol: string): { allowLongs: boolean; allowShorts: boolean; reason: string } {
    const analysis = this.pairAnalysis.get(symbol);
    if (!analysis) return { allowLongs: true, allowShorts: true, reason: 'no_analysis' };

    let allowLongs = true;
    let allowShorts = true;
    const reasons: string[] = [];

    // 1. FALLING KNIFE PROTOCOL (Don't buy in strong bear trend)
    // If Trend is Bearish on 4h (The Anchor), we DO NOT buy falling knives.
    if (analysis.trend4h === 'bear') {
      // TACTICAL OVERRIDE: 15m Momentum Cross (The "Golden Ticket")
      // If the 15m trend shows a Golden Cross (EMA 9 > EMA 21), we assume a localized reversal.
      // We allow entry to catch the V-Shape recovery without waiting for the slow 4h 200 EMA.
      if (analysis.trend15m === 'bull') {
        // RSI FILTER: Don't chase if locally overbought (Dead Cat Bounce risk)
        if (analysis.rsi15m < 70) {
          allowLongs = true;
          reasons.push('bear_4h_but_bull_15m_override');
        } else {
          allowLongs = false;
          reasons.push('bear_4h_bull_15m_but_rsi_overbought');
        }
      } else {
        allowLongs = false;
        reasons.push('trend4h_bear_no_knife_catching');
      }
    }

    // 2. FOMO PROTECTION (Don't buy tops)
    // If RSI is Overbought (> 75), do not open new longs.
    if (analysis.rsi > 75) {
      allowLongs = false;
      reasons.push('rsi_overbought_no_top_buying');
    }

    // 3. TRAIN WRECK PROTECTION (Don't short parabolic pumps)
    // If Trend is Bullish on 4h OR 15m has Golden Ticket (Bullish Cross), do not stand in front of the train.
    // FIX: 15m bull in 4h bear = dead cat bounce, NOT bullish trend.
    // Don't block shorts based on 15m bounce when 4h anchor is bearish.
    const isBullishTrend = analysis.trend4h === 'bull' || (analysis.trend4h !== 'bear' && analysis.trend15m === 'bull' && analysis.rsi15m < 80);

    if (isBullishTrend) {
      // TACTICAL OVERRIDE: 15m Momentum Cross (The "Golden Ticket" for Shorting)
      // If 15m flips bearish (9 < 21), we allow shorts early.
      if (analysis.trend15m === 'bear') {
        // RSI FILTER: Don't short if locally oversold (Dip buying risk)
        // SAFETY INCREASED: Raised threshold from 30 to 35
        if (analysis.rsi15m > 35) {
          allowShorts = true;
          reasons.push('bull_trend_but_bear_15m_override');
        } else {
          allowShorts = false;
          reasons.push('bull_trend_bear_15m_but_rsi_oversold');
        }
      } else {
        allowShorts = false;
        reasons.push('bull_trend_no_shorting_pump');
      }
    }

    // 4. BOTTOM SELLING PROTECTION (Don't panic sell the bottom)
    // If RSI is Oversold (< 30), prevent new shorts.
    // SAFETY INCREASED: Raised threshold from 25 to 30
    if (analysis.rsi < 30) {
      allowShorts = false;
      reasons.push('rsi_oversold_no_bottom_selling');
    }

    // 5. GLOBAL RISK OFF (BTC Crash)
    if (this.state.btcTrend === 'bear' && this.state.regime === 'volatile') {
      // If BTC is crashing hard, limit Longs on alts too.
      // EXCEPTION: If the alt has a "Golden Ticket" (Strong local trend), we allow Decoupling.
      const hasGoldenTicket = analysis.trend15m === 'bull' && analysis.rsi15m < 70;

      if (allowLongs && !hasGoldenTicket) {
        allowLongs = false;
        reasons.push('btc_crash_global_risk_off');
      } else if (allowLongs && hasGoldenTicket) {
        // We keep allowLongs = true, but maybe log a warning?
        reasons.push('btc_crash_ignored_due_to_golden_ticket');
      }
    }

    // 6. WALL PROTECTION (HTF Support/Resistance from 1h×72 = 3 days)
    // If we are extremely close (< 1.5%) to a major HTF wall, we pause entries into the wall
    // unless we have a specific Price Action pattern that suggests a breakout.
    if (analysis.resistanceDist < 0.015) {
      if (analysis.activeCandlePattern !== 'bullish_engulfing') {
        allowLongs = false;
        reasons.push('near_htf_resistance_wait_for_breakout');
      }
    }
    if (analysis.supportDist < 0.015) {
      if (analysis.activeCandlePattern !== 'bearish_engulfing') {
        allowShorts = false;
        reasons.push('near_htf_support_wait_for_breakdown');
      }
    }

    // 7. PRICE ACTION OVERRIDE (Reversal Patterns 1h)
    // Respect Pinbars (rejections) immediately
    if (analysis.activeCandlePattern === 'bearish_pinbar') {
      allowLongs = false;
      reasons.push('bearish_pinbar_rejection');
    }
    if (analysis.activeCandlePattern === 'bullish_pinbar') {
      allowShorts = false;
      reasons.push('bullish_pinbar_rejection');
    }

    // 8. FLASH CRASH PROTECTION
    if (analysis.isFlashCrash) {
      allowLongs = false;
      allowShorts = false;
      reasons.push('flash_crash_volatility_pause');
    }

    return {
      allowLongs,
      allowShorts,
      reason: reasons.join('|') || 'neutral_regime'
    };
  }
}
