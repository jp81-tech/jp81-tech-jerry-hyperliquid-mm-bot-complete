import { HyperliquidAPI } from '../api/hyperliquid.js';
import { Technicals } from './technicals.js';
import { getNansenHyperliquidAPI, NansenHyperliquidAPI } from '../integrations/nansen_scoring.js';
import { getNansenProAPI, NansenProAPI } from '../integrations/nansen_pro.js';
import { AIArtist, VisualAnalysis } from '../vision/ai_artist.js';

export const NANSEN_TOKENS: Record<string, { chain: string; address: string }> = {
  'VIRTUAL': { chain: 'base', address: '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b' },
  'ZEC': { chain: 'solana', address: 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS' },
  'HYPE': { chain: 'hyperevm', address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' },
  'MONO': { chain: 'bnb', address: '0xD4099A517f2Fbe8a730d2ECaad1D0824B75e084a' }
};

export type MarketRegime = 'bull' | 'bear' | 'sideways' | 'volatile';

export type MarketVisionState = {
  btcTrend: 'bull' | 'bear' | 'neutral';
  btcRsi: number;
  regime: MarketRegime;
  globalBiasScore: number; // -100 (strong bear) to +100 (strong bull)
  lastUpdate: number;
};

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
  support4h: number; // HTF Support Price (Low of last 30 4h candles)
  resistance4h: number; // HTF Resistance Price (High of last 30 4h candles)
  activeCandlePattern: 'none' | 'bullish_pinbar' | 'bearish_pinbar' | 'bullish_engulfing' | 'bearish_engulfing';
  isFlashCrash: boolean; // True if last candle > 3% move
  visualAnalysis?: VisualAnalysis; // AI Vision output
  biasScore: number; // -100 to +100
  nansenPressure: number; // Net Buy/Sell Pressure in USD
  nansenScore: number; // Contribution to bias
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
  private isRunning: boolean = false;
  private updateIntervalMs: number = 2 * 60 * 1000; // Update every 2 minutes (faster for reversal detection)
  // We will dynamically update this list based on what the bot is trading
  private activePairs: string[] = ['ZEC', 'HYPE', 'VIRTUAL', 'UNI', 'ETH', 'SOL', 'BTC', 'MON'];

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
            // A. HTF Context: 4h Candles for 200 EMA & Support/Resistance
            const candles4h = await this.api.getCandles(pair, '4h', now - 60 * 24 * 60 * 60 * 1000, now);
            let trend4h: 'bull' | 'bear' | 'neutral' = 'neutral';
            let ema200_4h = 0;
            let support4h = 0;
            let resistance4h = 999999;

            if (candles4h && candles4h.length >= 200) {
                const ema200Series = Technicals.calculateEMA(candles4h, 200);
                ema200_4h = Technicals.getLatest(ema200Series) || 0;
                const currentPrice = candles4h[candles4h.length - 1].c;

                if (ema200_4h > 0) {
                    trend4h = currentPrice > ema200_4h ? 'bull' : 'bear';
                }

                // HTF Support/Resistance (Last 30 candles = 5 days)
                const last30_4h = candles4h.slice(-30);
                support4h = Math.min(...last30_4h.map(c => c.l));
                resistance4h = Math.max(...last30_4h.map(c => c.h));
            }

            // B. MTF Context: 1h Candles for volatility and tactical bias
            const candles = await this.api.getCandles(pair, '1h', now - 7 * 24 * 60 * 60 * 1000, now);
            if (!candles || candles.length < 50) continue;

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
            }

            // FLASH CRASH DETECTOR (High Volatility Anomaly)
            let isFlashCrash = false;
            if (candles15m && candles15m.length > 0) {
                const last = candles15m[candles15m.length - 1]; // Current forming candle
                const rangePct = last.o > 0 ? (last.h - last.l) / last.o : 0;
                if (rangePct > 0.03) { // > 3% move in 15 mins
                    isFlashCrash = true;
                    console.warn(`⚡ ${pair}: FLASH CRASH/PUMP DETECTED! (${(rangePct*100).toFixed(1)}% move in 15m)`);
                }
            }

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
                            console.log(`🧠 [GOD MODE] ${pair} Smart Money Accumulation: +$${(smFlow/1000).toFixed(0)}k`);
                            nansenScore += 10;
                        } else if (smFlow < -100000) {
                            console.log(`🧠 [GOD MODE] ${pair} Smart Money Dumping: -$${(Math.abs(smFlow)/1000).toFixed(0)}k`);
                            nansenScore -= 10;
                        }

                        // Whale Watch
                        if (whaleFlow > 500000) {
                            console.log(`🐳 [GOD MODE] ${pair} WHALE Accumulation: +$${(whaleFlow/1000).toFixed(0)}k`);
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
                supportDist: distSup,
                resistanceDist: distRes,
                activeCandlePattern,
                isFlashCrash,
                visualAnalysis,
                nansenPressure,
                nansenScore,
                biasScore: Math.max(-100, Math.min(100, score))
            };

            this.pairAnalysis.set(pair, analysis);

            // Console log vital changes
            if (trend15m === 'bull' && trend4h === 'bear') {
                console.log(`👁️  ${pair}: GOLDEN TICKET! 4h Bear but 15m Bullish Cross.`);
            }

            if (reversalWarning !== 'none') {
                console.log(`👁️  ${pair}: Reversal Signal (${reversalWarning})! Score=${score} (4h=${trend4h})`);
            }

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
    const isBullishTrend = analysis.trend4h === 'bull' || (analysis.trend15m === 'bull' && analysis.rsi15m < 80);

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

    // 6. WALL PROTECTION (HTF Support/Resistance)
    // If we are extremely close (< 1.5%) to a major 4h wall, we pause entries into the wall
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
