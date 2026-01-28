import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import cron, { ScheduledTask } from 'node-cron';
import { HyperliquidMarketData } from '../mm/market_data.js';
import { NANSEN_TOKENS, CoinTuning } from '../signals/market_vision.js';
import { Notifier, ConsoleNotifier } from '../utils/notifier.js';
import { SmartMoneyEntry, SmartMoneyFile } from '../types/smart_money.js';

export type GridRecommendation = {
  bidMultiplier: number;
  askMultiplier: number;
  inventoryBias: 'long' | 'short' | 'neutral';
  riskLevel: 'low' | 'medium' | 'high';
  targetInventory: number | null;
  reasoning: string[];
};

export type TokenSnapshot = {
  symbol: string;
  hlSymbol: string;
  generatedAt: string;
  dataTimestamp: string | null;
  smartMoney?: {
    biasScore?: number;
    signal?: string;
    flowUsd?: number;
    longsUsd?: number;
    shortsUsd?: number;
    longsUpnl?: number;
    shortsUpnl?: number;
    topPnL?: string;
    trend?: string;
    trendStrength?: string;
    momentum?: number;
    velocity?: number;
    flowChange7d?: number;
  };
  market?: {
    markPrice: number;
    priceChangePct24h: number;
    volume24h: number;
    openInterest: number;
    fundingRate: number;
    fundingRateAnnualized: number;
    volumeToOiRatio: number;
  };
  tuning?: CoinTuning;
  recommendation: GridRecommendation;
};

export type DailySnapshot = {
  snapshotId: string;
  generatedAt: string;
  sourceTimestamp: string | null;
  timezone: string;
  tokens: TokenSnapshot[];
  meta: {
    totalTracked: number;
    totalSmartMoneyFlowUsd: number;
    sentiment: 'bullish' | 'bearish' | 'neutral';
    missingTokens: string[];
    btcPrice?: number;
    ethPrice?: number;
  };
};

type MarketDataFetcher = (symbol: string) => Promise<HyperliquidMarketData | null>;

export type DailySnapshotOptions = {
  tokens: string[];
  marketDataFetcher: MarketDataFetcher;
  smartMoneyPath?: string;
  outputDir?: string;
  cron?: string;
  timezone?: string;
  notifier?: Notifier;
};

const DEFAULT_SMART_MONEY_PATH = process.env.SMART_MONEY_DATA_PATH || '/tmp/smart_money_data.json';
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), 'telemetry_snapshots');
const DEFAULT_CRON_EXPR = process.env.DAILY_SNAPSHOT_CRON || '0 */4 * * *'; // Every 4h by default
const DEFAULT_TIMEZONE = process.env.DAILY_SNAPSHOT_TZ || 'Europe/Warsaw';

export class DailySnapshotGenerator {
  private readonly tokens: string[];
  private readonly marketDataFetcher: MarketDataFetcher;
  private readonly smartMoneyPath: string;
  private readonly outputDir: string;
  private readonly timezone: string;
  private readonly notifier: Notifier;
  private cronTask?: ScheduledTask;
  private cronExpression: string;

  constructor(options: DailySnapshotOptions) {
    this.tokens = options.tokens.map((t) => t.toUpperCase());
    this.marketDataFetcher = options.marketDataFetcher;
    this.smartMoneyPath = options.smartMoneyPath || DEFAULT_SMART_MONEY_PATH;
    this.outputDir = options.outputDir ? path.resolve(options.outputDir) : DEFAULT_OUTPUT_DIR;
    this.timezone = options.timezone || DEFAULT_TIMEZONE;
    this.cronExpression = options.cron || DEFAULT_CRON_EXPR;
    this.notifier = options.notifier || new ConsoleNotifier();
    this.ensureOutputDir();
  }

  start(cronExpression?: string, runOnStart: boolean = true): void {
    if (cronExpression) {
      this.cronExpression = cronExpression;
    }

    if (this.cronTask) {
      this.cronTask.stop();
    }

    this.cronTask = cron.schedule(
      this.cronExpression,
      () => this.safeGenerate('cron'),
      { timezone: this.timezone }
    );
    this.notifier.info(`🗓️  Daily snapshot scheduler armed (cron=${this.cronExpression}, tz=${this.timezone})`);

    if (runOnStart) {
      this.safeGenerate('startup').catch(() => {
        /* logged in safeGenerate */
      });
    }
  }

  stop(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = undefined;
    }
  }

  async generateSnapshot(): Promise<DailySnapshot | null> {
    const smartMoney = await this.loadSmartMoneyFile();
    if (!smartMoney) {
      return null;
    }

    const generatedAt = new Date();
    const tokenSnapshots: TokenSnapshot[] = [];
    const missingTokens: string[] = [];

    for (const symbol of this.tokens) {
      const entry = smartMoney.data[symbol] || smartMoney.data[symbol.toUpperCase()] || smartMoney.data[symbol.toLowerCase()];
      const market = await this.marketDataFetcher(symbol).catch(() => null);

      if (!entry && !market) {
        missingTokens.push(symbol);
        continue;
      }

      const snapshot = this.buildTokenSnapshot(symbol, smartMoney.timestamp, entry, market);
      tokenSnapshots.push(snapshot);
    }

    const dailySnapshot: DailySnapshot = {
      snapshotId: this.buildSnapshotId(generatedAt),
      generatedAt: generatedAt.toISOString(),
      sourceTimestamp: smartMoney.timestamp || null,
      timezone: this.timezone,
      tokens: tokenSnapshots,
      meta: {
        totalTracked: tokenSnapshots.length,
        totalSmartMoneyFlowUsd: tokenSnapshots.reduce((sum, token) => sum + Math.abs(token.smartMoney?.flowUsd || 0), 0),
        sentiment: this.deriveSentiment(tokenSnapshots),
        missingTokens,
        btcPrice: await this.getPrice('BTC'),
        ethPrice: await this.getPrice('ETH')
      }
    };

    await this.persistSnapshot(dailySnapshot);
    return dailySnapshot;
  }

  private async safeGenerate(reason: string): Promise<void> {
    try {
      const snapshot = await this.generateSnapshot();
      if (snapshot) {
        this.notifier.info(`🧾 [Telemetry] Daily snapshot stored (${reason}) id=${snapshot.snapshotId}`);
      }
    } catch (error) {
      this.notifier.error(`❌ Failed to generate daily snapshot (${reason}): ${(error as Error).message}`);
    }
  }

  private async getPrice(symbol: string): Promise<number | undefined> {
    try {
      const data = await this.marketDataFetcher(symbol);
      return data?.markPrice;
    } catch {
      return undefined;
    }
  }

  private ensureOutputDir(): void {
    try {
      fs.mkdirSync(this.outputDir, { recursive: true });
    } catch (error: any) {
      this.notifier.error(`Failed to prepare telemetry directory (${this.outputDir}): ${error.message}`);
    }
  }

  private buildSnapshotId(date: Date): string {
    const dateKey = date.toISOString().split('T')[0];
    return `snapshot_${dateKey}_${date.getTime()}`;
  }

  private async persistSnapshot(snapshot: DailySnapshot): Promise<void> {
    const dateKey = snapshot.generatedAt.split('T')[0];
    const datedPath = path.join(this.outputDir, `${dateKey}.json`);
    const latestPath = path.join(this.outputDir, 'latest.json');
    const payload = JSON.stringify(snapshot, null, 2);

    await fsp.writeFile(datedPath, payload, 'utf-8');
    await fsp.writeFile(latestPath, payload, 'utf-8');
  }

  private buildTokenSnapshot(
    symbol: string,
    dataTimestamp: string | undefined,
    entry: SmartMoneyEntry | undefined,
    market: HyperliquidMarketData | null
  ): TokenSnapshot {
    const tuning = NANSEN_TOKENS[symbol]?.tuning;
    const recommendation = this.buildRecommendation(symbol, entry, market, tuning);

    return {
      symbol,
      hlSymbol: NANSEN_TOKENS[symbol]?.address || symbol,
      generatedAt: new Date().toISOString(),
      dataTimestamp: dataTimestamp || null,
      smartMoney: entry
        ? {
            biasScore: entry.bias,
            signal: entry.signal,
            flowUsd: entry.flow,
            longsUsd: entry.current_longs_usd,
            shortsUsd: entry.current_shorts_usd,
            longsUpnl: entry.longs_upnl,
            shortsUpnl: entry.shorts_upnl,
            topPnL: entry.top_traders_pnl,
            trend: entry.trend,
            trendStrength: entry.trend_strength,
            momentum: entry.momentum,
            velocity: entry.velocity,
            flowChange7d: entry.flow_change_7d
          }
        : undefined,
      market: market
        ? {
            markPrice: market.markPrice,
            priceChangePct24h: market.priceChangePct24h,
            volume24h: market.volume24h,
            openInterest: market.openInterest,
            fundingRate: market.fundingRate,
            fundingRateAnnualized: market.fundingRateAnnualized,
            volumeToOiRatio: market.volumeToOiRatio
          }
        : undefined,
      tuning,
      recommendation
    };
  }

  private buildRecommendation(
    symbol: string,
    entry: SmartMoneyEntry | undefined,
    market: HyperliquidMarketData | null,
    tuning: CoinTuning | undefined
  ): GridRecommendation {
    let bidMultiplier = tuning?.bidSizeMultiplier ?? 1.0;
    let askMultiplier = tuning?.askSizeMultiplier ?? 1.0;
    let inventoryBias: 'long' | 'short' | 'neutral' = 'neutral';
    let riskLevel: 'low' | 'medium' | 'high' = 'medium';
    const reasoning: string[] = [];

    if (entry) {
      const signal = entry.signal?.toLowerCase();
      if (signal?.includes('bear')) {
        inventoryBias = 'short';
        bidMultiplier *= 0.8;
        askMultiplier *= 1.1;
        reasoning.push('Smart Money bias bearish');
      } else if (signal?.includes('bull')) {
        inventoryBias = 'long';
        bidMultiplier *= 1.1;
        askMultiplier *= 0.9;
        reasoning.push('Smart Money bias bullish');
      }

      const flowMagnitude = Math.abs(entry.flow ?? 0);
      if (flowMagnitude > 10_000_000) {
        riskLevel = 'high';
        reasoning.push(`Large net flow $${(flowMagnitude / 1e6).toFixed(1)}M`);
      } else if (flowMagnitude < 1_000_000) {
        riskLevel = riskLevel === 'medium' ? 'low' : riskLevel;
      }

      if (entry.top_traders_pnl?.includes('winning')) {
        reasoning.push(`Top traders ${entry.top_traders_pnl.replace('_', ' ')}`);
      }
    }

    if (market) {
      if (market.volume24h < 5_000_000) {
        riskLevel = 'high';
        reasoning.push(`Low liquidity ($${(market.volume24h / 1e6).toFixed(2)}M 24h)`);
        bidMultiplier *= 0.9;
        askMultiplier *= 1.1;
      } else if (market.volume24h > 20_000_000 && riskLevel !== 'high') {
        riskLevel = 'low';
        reasoning.push('High liquidity - stable quoting');
      }

      if (Math.abs(market.fundingRateAnnualized) > 50) {
        reasoning.push(`Funding anomaly (${market.fundingRateAnnualized.toFixed(1)}% annualized)`);
        riskLevel = 'high';
      }
    }

    if (!reasoning.length) {
      reasoning.push('Baseline tuning applied');
    }

    return {
      bidMultiplier: Number(bidMultiplier.toFixed(2)),
      askMultiplier: Number(askMultiplier.toFixed(2)),
      inventoryBias,
      riskLevel,
      targetInventory: tuning?.targetInventory ?? null,
      reasoning
    };
  }

  private deriveSentiment(tokens: TokenSnapshot[]): 'bullish' | 'bearish' | 'neutral' {
    const scores = tokens
      .map((t) => t.smartMoney?.biasScore ?? 0.5);

    if (scores.length === 0) {
      return 'neutral';
    }

    const avg = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    if (avg > 0.6) return 'bullish';
    if (avg < 0.4) return 'bearish';
    return 'neutral';
  }

  private async loadSmartMoneyFile(): Promise<SmartMoneyFile | null> {
    try {
      const raw = await fsp.readFile(this.smartMoneyPath, 'utf-8');
      const parsed = JSON.parse(raw) as SmartMoneyFile;
      if (!parsed?.data) {
        throw new Error('Invalid smart money payload');
      }
      return parsed;
    } catch (error) {
      this.notifier.error(
        `Failed to read smart money data from ${this.smartMoneyPath}: ${(error as Error).message}`
      );
      return null;
    }
  }
}


