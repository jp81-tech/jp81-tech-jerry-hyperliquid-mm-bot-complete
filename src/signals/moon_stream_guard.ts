// ============================================================
// MOON STREAM GUARD — Liquidation Gravity + Order Flow Imbalance
// Polls Moon Dev API for:
//   1. Liquidation clusters (positions with liq_price, value, leverage)
//   2. Order flow imbalance (buy/sell ratio per coin, 1h and 4h)
// ============================================================

import https from 'https';
import { sendDiscordAlert } from '../utils/discord_notifier.js';

const API_BASE = 'https://api.moondev.com/api';
const API_KEY = 'jaroslaw_qe';
const POLL_INTERVAL_MS = 45_000;       // 45s — main poll (liqs + imbalance)
const POSITION_POLL_INTERVAL_MS = 90_000; // 90s — position poll (cluster detection)
const HLP_POLL_INTERVAL_MS = 120_000;  // 120s — HLP position poll (direct from HL API)

// ── HLP Config ────────────────────────────────────────────
const HLP_ADDRESS = '0x010461C14e146ac35Fe42271BDC1134Ee31C703a';
const HLP_API_URL = 'https://api.hyperliquid.xyz/info';
const HLP_ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 60 min between same-type alerts
const HLP_ALERT_MIN_VALUE_USD = 100_000;       // Min position value to alert (kPEPE)
const HLP_ALERT_MIN_VALUE_VIRTUAL = 50_000;    // Min for VIRTUAL

// ── Danger Zone Thresholds ──────────────────────────────────
const KPEPE_LIQ_THRESHOLD_USD = 15_000;
const KPEPE_IMBALANCE_THRESHOLD = -0.80;
const VIRTUAL_LIQ_THRESHOLD_USD = 25_000;
const VIRTUAL_IMBALANCE_THRESHOLD = -0.75;

// ── Cluster detection ───────────────────────────────────────
const CLUSTER_GROUP_PCT = 2.0;        // Group liq_prices within 2% of each other
const CLUSTER_MIN_VALUE_USD = 50_000; // Min cluster value to report
const CLUSTER_MAX_DISTANCE_PCT = 25;  // Max distance from current price

// ── Cooldown ────────────────────────────────────────────────
const WARNING_COOLDOWN_MS = 5 * 60 * 1000;

// ── Interfaces ──────────────────────────────────────────────

export interface LiqCluster {
  price: number;
  totalValueUsd: number;
  positionCount: number;
  distancePct: number;       // positive = above current, negative = below
  side: 'long' | 'short';
}

export interface HlpPosition {
  coin: string;
  szi: number;               // signed size (positive=LONG, negative=SHORT)
  entryPx: number;
  valueUsd: number;           // |szi| * entryPx
  unrealizedPnl: number;
  side: 'LONG' | 'SHORT';
}

export interface MoonGuardOutput {
  kpepeSqueezeWarning: boolean;
  virtualSqueezeWarning: boolean;
  kpepeLiqUsd: number;
  kpepeImbalanceRatio: number;
  virtualLiqUsd: number;
  virtualImbalanceRatio: number;
  // New: imbalance per timeframe
  kpepeImbalance1h: number;
  kpepeImbalance4h: number;
  virtualImbalance1h: number;
  virtualImbalance4h: number;
  // New: short/long ratio from positions
  kpepeShortLongRatio: number;
  virtualShortLongRatio: number;
  // New: liquidation clusters
  kpepeLiqClusters: LiqCluster[];
  virtualLiqClusters: LiqCluster[];
  // HLP positions
  hlpPositions: HlpPosition[];
  hlpKpepe: HlpPosition | null;
  hlpVirtual: HlpPosition | null;
  hlpEquity: number;
  lastUpdate: number;
  reason: string;
}

interface LiquidationEntry {
  symbol: string;
  exchange: string;
  total_liquidations: number;
  long_liquidations: number;
  short_liquidations: number;
}

interface PositionEntry {
  liq_price: number;
  value: number;
  leverage: number;
  side?: string;
}

export class MoonStreamGuard {
  private output: MoonGuardOutput = this.defaultOutput();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private positionTimer: ReturnType<typeof setInterval> | null = null;
  private hlpTimer: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  private positionTickCount = 0;
  private hlpTickCount = 0;
  private kpepeWarningUntil = 0;
  private virtualWarningUntil = 0;
  private consecutiveErrors = 0;
  private positionConsecutiveErrors = 0;
  private hlpConsecutiveErrors = 0;

  // Mid prices for cluster distance calculation
  private midPrices: Record<string, number> = {};

  // HLP alert cooldowns: key → last alert timestamp
  private hlpAlertCooldowns: Map<string, number> = new Map();
  // Previous HLP positions for change detection
  private prevHlpKpepe: HlpPosition | null = null;
  private prevHlpVirtual: HlpPosition | null = null;

  private defaultOutput(): MoonGuardOutput {
    return {
      kpepeSqueezeWarning: false,
      virtualSqueezeWarning: false,
      kpepeLiqUsd: 0,
      kpepeImbalanceRatio: 0,
      virtualLiqUsd: 0,
      virtualImbalanceRatio: 0,
      kpepeImbalance1h: 0,
      kpepeImbalance4h: 0,
      virtualImbalance1h: 0,
      virtualImbalance4h: 0,
      kpepeShortLongRatio: 0,
      virtualShortLongRatio: 0,
      kpepeLiqClusters: [],
      virtualLiqClusters: [],
      hlpPositions: [],
      hlpKpepe: null,
      hlpVirtual: null,
      hlpEquity: 0,
      lastUpdate: 0,
      reason: '',
    };
  }

  start(): void {
    if (this.pollTimer) return;
    console.log(`[MOON_GUARD] Started — main poll ${POLL_INTERVAL_MS / 1000}s, positions ${POSITION_POLL_INTERVAL_MS / 1000}s, HLP ${HLP_POLL_INTERVAL_MS / 1000}s`);
    this.poll();
    this.pollPositions();
    this.pollHlp();
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    this.positionTimer = setInterval(() => this.pollPositions(), POSITION_POLL_INTERVAL_MS);
    this.hlpTimer = setInterval(() => this.pollHlp(), HLP_POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.positionTimer) {
      clearInterval(this.positionTimer);
      this.positionTimer = null;
    }
    if (this.hlpTimer) {
      clearInterval(this.hlpTimer);
      this.hlpTimer = null;
    }
  }

  getOutput(): MoonGuardOutput {
    return this.output;
  }

  /** Called from mm_hl.ts to pass current mid prices for distance calculation */
  updateMidPrices(kpepe: number, virtual: number): void {
    if (kpepe > 0) this.midPrices['kPEPE'] = kpepe;
    if (virtual > 0) this.midPrices['VIRTUAL'] = virtual;
  }

  // ── Main poll: liquidations + imbalance ─────────────────────

  private async poll(): Promise<void> {
    this.tickCount++;
    const now = Date.now();
    const reasons: string[] = [];

    try {
      const [liqData, imb1hData, imb4hData] = await Promise.all([
        this.fetchLiquidations(),
        this.fetchImbalance('1h'),
        this.fetchImbalance('4h'),
      ]);

      this.consecutiveErrors = 0;

      // ── kPEPE Analysis ──────────────────────────────────────
      const kpepeLiq = this.sumLiquidations(liqData, 'PEPE');
      const kpepeImb1h = this.extractImbalance(imb1hData, 'kPEPE');
      const kpepeImb4h = this.extractImbalance(imb4hData, 'kPEPE');

      this.output.kpepeLiqUsd = kpepeLiq;
      this.output.kpepeImbalance1h = kpepeImb1h;
      this.output.kpepeImbalance4h = kpepeImb4h;
      // Backward compat: kpepeImbalanceRatio = 1h value
      this.output.kpepeImbalanceRatio = kpepeImb1h;

      let kpepeTriggered = false;
      if (kpepeLiq > KPEPE_LIQ_THRESHOLD_USD) {
        kpepeTriggered = true;
        reasons.push(`kPEPE liq=$${kpepeLiq.toFixed(0)}>${KPEPE_LIQ_THRESHOLD_USD}`);
      }
      if (kpepeImb1h < KPEPE_IMBALANCE_THRESHOLD) {
        kpepeTriggered = true;
        reasons.push(`kPEPE imb=${kpepeImb1h.toFixed(2)}<${KPEPE_IMBALANCE_THRESHOLD}`);
      }

      if (kpepeTriggered) {
        this.kpepeWarningUntil = now + WARNING_COOLDOWN_MS;
        console.warn(`[MOON_GUARD] kPEPE Liquidation Spike Detected ($${kpepeLiq.toFixed(0)})! imb1h=${kpepeImb1h.toFixed(2)} imb4h=${kpepeImb4h.toFixed(2)} | Blocking Bids.`);
      }
      this.output.kpepeSqueezeWarning = now < this.kpepeWarningUntil;

      // ── VIRTUAL Analysis ────────────────────────────────────
      const virtualLiq = this.sumLiquidations(liqData, 'VIRTUAL');
      const virtualImb1h = this.extractImbalance(imb1hData, 'VIRTUAL');
      const virtualImb4h = this.extractImbalance(imb4hData, 'VIRTUAL');

      this.output.virtualLiqUsd = virtualLiq;
      this.output.virtualImbalance1h = virtualImb1h;
      this.output.virtualImbalance4h = virtualImb4h;
      this.output.virtualImbalanceRatio = virtualImb1h;

      let virtualTriggered = false;
      if (virtualLiq > VIRTUAL_LIQ_THRESHOLD_USD) {
        virtualTriggered = true;
        reasons.push(`VIRTUAL liq=$${virtualLiq.toFixed(0)}>${VIRTUAL_LIQ_THRESHOLD_USD}`);
      }
      if (virtualImb1h < VIRTUAL_IMBALANCE_THRESHOLD) {
        virtualTriggered = true;
        reasons.push(`VIRTUAL imb=${virtualImb1h.toFixed(2)}<${VIRTUAL_IMBALANCE_THRESHOLD}`);
      }

      if (virtualTriggered) {
        this.virtualWarningUntil = now + WARNING_COOLDOWN_MS;
        console.warn(`[MOON_GUARD] VIRTUAL Liquidation Spike Detected ($${virtualLiq.toFixed(0)})! imb1h=${virtualImb1h.toFixed(2)} imb4h=${virtualImb4h.toFixed(2)} | Blocking Bids.`);
      }
      this.output.virtualSqueezeWarning = now < this.virtualWarningUntil;

      this.output.lastUpdate = now;
      this.output.reason = reasons.join(' | ') || 'clean';

      // Periodic status log every 20 polls (~15 min)
      if (this.tickCount % 20 === 0) {
        const kWarn = this.output.kpepeSqueezeWarning ? 'ACTIVE' : 'off';
        const vWarn = this.output.virtualSqueezeWarning ? 'ACTIVE' : 'off';
        console.log(`[MOON_GUARD] tick=${this.tickCount} kPEPE: liq=$${kpepeLiq.toFixed(0)} imb1h=${kpepeImb1h.toFixed(2)} imb4h=${kpepeImb4h.toFixed(2)} warn=${kWarn} | VIRTUAL: liq=$${virtualLiq.toFixed(0)} imb1h=${virtualImb1h.toFixed(2)} imb4h=${virtualImb4h.toFixed(2)} warn=${vWarn}`);
      }

    } catch (err: any) {
      this.consecutiveErrors++;
      if (this.consecutiveErrors <= 3 || this.consecutiveErrors % 10 === 0) {
        console.warn(`[MOON_GUARD] Poll error #${this.consecutiveErrors}: ${err?.message || err}`);
      }
      this.output.kpepeSqueezeWarning = now < this.kpepeWarningUntil;
      this.output.virtualSqueezeWarning = now < this.virtualWarningUntil;
    }
  }

  // ── Position poll: cluster detection ────────────────────────

  private async pollPositions(): Promise<void> {
    this.positionTickCount++;

    try {
      const posData = await this.fetchJsonRaw<any>(`${API_BASE}/positions/all_crypto.json?api_key=${API_KEY}`);
      this.positionConsecutiveErrors = 0;

      const symbols = posData?.symbols ?? posData?.data?.symbols ?? {};

      // kPEPE clusters
      const kpepePositions = this.extractPositions(symbols, 'kPEPE', 'PEPE');
      const kpepeMid = this.midPrices['kPEPE'] ?? 0;
      if (kpepeMid > 0) {
        this.output.kpepeLiqClusters = this.buildClusters(kpepePositions, kpepeMid);
        this.output.kpepeShortLongRatio = this.computeShortLongRatio(kpepePositions);
      }

      // VIRTUAL clusters
      const virtualPositions = this.extractPositions(symbols, 'VIRTUAL');
      const virtualMid = this.midPrices['VIRTUAL'] ?? 0;
      if (virtualMid > 0) {
        this.output.virtualLiqClusters = this.buildClusters(virtualPositions, virtualMid);
        this.output.virtualShortLongRatio = this.computeShortLongRatio(virtualPositions);
      }

      if (this.positionTickCount % 20 === 0) {
        const kClusters = this.output.kpepeLiqClusters.length;
        const vClusters = this.output.virtualLiqClusters.length;
        console.log(`[MOON_GUARD] Positions tick=${this.positionTickCount} kPEPE: ${kClusters} clusters, S/L=${this.output.kpepeShortLongRatio.toFixed(2)} | VIRTUAL: ${vClusters} clusters, S/L=${this.output.virtualShortLongRatio.toFixed(2)}`);
      }

    } catch (err: any) {
      this.positionConsecutiveErrors++;
      if (this.positionConsecutiveErrors <= 3 || this.positionConsecutiveErrors % 10 === 0) {
        console.warn(`[MOON_GUARD] Position poll error #${this.positionConsecutiveErrors}: ${err?.message || err}`);
      }
      // Keep previous cached data — don't zero out
    }
  }

  // ── HLP poll: Hyperliquid LP position tracking ─────────────

  private async pollHlp(): Promise<void> {
    this.hlpTickCount++;

    try {
      const data = await this.fetchHlpState();
      this.hlpConsecutiveErrors = 0;

      const equity = parseFloat(data?.marginSummary?.accountValue ?? '0');
      this.output.hlpEquity = equity;

      const positions: HlpPosition[] = [];
      for (const ap of (data?.assetPositions ?? [])) {
        const pos = ap.position;
        const szi = parseFloat(pos.szi);
        if (szi === 0) continue;
        const entryPx = parseFloat(pos.entryPx);
        const valueUsd = Math.abs(szi) * entryPx;
        const unrealizedPnl = parseFloat(pos.unrealizedPnl);
        const side = szi > 0 ? 'LONG' as const : 'SHORT' as const;
        positions.push({ coin: pos.coin, szi, entryPx, valueUsd, unrealizedPnl, side });
      }

      // Sort by value descending
      positions.sort((a, b) => b.valueUsd - a.valueUsd);
      this.output.hlpPositions = positions;

      // Extract kPEPE and VIRTUAL
      const kpepePos = positions.find(p => p.coin === 'kPEPE') ?? null;
      const virtualPos = positions.find(p => p.coin === 'VIRTUAL') ?? null;

      this.output.hlpKpepe = kpepePos;
      this.output.hlpVirtual = virtualPos;

      // Check for alerts
      this.checkHlpAlerts(kpepePos, virtualPos);

      // Store for next comparison
      this.prevHlpKpepe = kpepePos;
      this.prevHlpVirtual = virtualPos;

      // Periodic log every 15 ticks (~30 min)
      if (this.hlpTickCount % 15 === 0 || this.hlpTickCount <= 2) {
        const kStr = kpepePos ? `${kpepePos.side} $${kpepePos.valueUsd.toFixed(0)} uPnl=$${kpepePos.unrealizedPnl.toFixed(0)}` : 'FLAT';
        const vStr = virtualPos ? `${virtualPos.side} $${virtualPos.valueUsd.toFixed(0)} uPnl=$${virtualPos.unrealizedPnl.toFixed(0)}` : 'FLAT';
        console.log(`[HLP_TRACKER] tick=${this.hlpTickCount} kPEPE: ${kStr} | VIRTUAL: ${vStr} | HLP equity=$${(equity / 1e6).toFixed(1)}M | ${positions.length} positions`);
      }

    } catch (err: any) {
      this.hlpConsecutiveErrors++;
      if (this.hlpConsecutiveErrors <= 3 || this.hlpConsecutiveErrors % 10 === 0) {
        console.warn(`[HLP_TRACKER] Poll error #${this.hlpConsecutiveErrors}: ${err?.message || err}`);
      }
    }
  }

  private checkHlpAlerts(kpepe: HlpPosition | null, virtual: HlpPosition | null): void {
    const now = Date.now();

    // ── kPEPE HLP alerts ──────────────────────────────────────
    if (kpepe && kpepe.valueUsd >= HLP_ALERT_MIN_VALUE_USD) {
      const prevSide = this.prevHlpKpepe?.side ?? null;
      const sideFlipped = prevSide && prevSide !== kpepe.side;
      const isNew = !this.prevHlpKpepe && kpepe.valueUsd >= HLP_ALERT_MIN_VALUE_USD;
      const valueSurge = this.prevHlpKpepe && kpepe.valueUsd > this.prevHlpKpepe.valueUsd * 1.5;

      if (kpepe.side === 'LONG') {
        // HLP LONG kPEPE = HLP accumulated longs → dump could force HLP to sell → cascade
        const alertKey = `hlp_kpepe_long`;
        if (this.shouldSendHlpAlert(alertKey, now) && (sideFlipped || isNew || valueSurge || this.hlpTickCount <= 2)) {
          const msg = [
            `[HLP] kPEPE: HLP is LONG $${this.fmtK(kpepe.valueUsd)} (${this.fmtSzi(kpepe.szi)} kPEPE)`,
            `Entry: $${kpepe.entryPx.toPrecision(4)} | uPnl: $${kpepe.unrealizedPnl.toFixed(0)}`,
            `If price dumps, HLP forced to sell = CASCADE risk`,
            sideFlipped ? `FLIPPED from ${prevSide}!` : '',
          ].filter(Boolean).join('\n');
          sendDiscordAlert(msg).catch(() => {});
          this.hlpAlertCooldowns.set(alertKey, now);
          console.log(`[HLP_ALERT] kPEPE LONG $${this.fmtK(kpepe.valueUsd)} — cascade risk alert sent`);
        }
      } else {
        // HLP SHORT kPEPE = HLP accumulated shorts → pump could force HLP to buy back → squeeze
        const alertKey = `hlp_kpepe_short`;
        if (this.shouldSendHlpAlert(alertKey, now) && (sideFlipped || isNew || valueSurge || this.hlpTickCount <= 2)) {
          const msg = [
            `[HLP] kPEPE: HLP is SHORT $${this.fmtK(kpepe.valueUsd)} (${this.fmtSzi(kpepe.szi)} kPEPE)`,
            `Entry: $${kpepe.entryPx.toPrecision(4)} | uPnl: $${kpepe.unrealizedPnl.toFixed(0)}`,
            `If price pumps, HLP forced to buy back = SQUEEZE risk`,
            sideFlipped ? `FLIPPED from ${prevSide}!` : '',
          ].filter(Boolean).join('\n');
          sendDiscordAlert(msg).catch(() => {});
          this.hlpAlertCooldowns.set(alertKey, now);
          console.log(`[HLP_ALERT] kPEPE SHORT $${this.fmtK(kpepe.valueUsd)} — squeeze risk alert sent`);
        }
      }
    }

    // ── VIRTUAL HLP alerts ────────────────────────────────────
    if (virtual && virtual.valueUsd >= HLP_ALERT_MIN_VALUE_VIRTUAL) {
      const prevSide = this.prevHlpVirtual?.side ?? null;
      const sideFlipped = prevSide && prevSide !== virtual.side;
      const isNew = !this.prevHlpVirtual && virtual.valueUsd >= HLP_ALERT_MIN_VALUE_VIRTUAL;
      const valueSurge = this.prevHlpVirtual && virtual.valueUsd > this.prevHlpVirtual.valueUsd * 1.5;

      if (virtual.side === 'LONG') {
        const alertKey = `hlp_virtual_long`;
        if (this.shouldSendHlpAlert(alertKey, now) && (sideFlipped || isNew || valueSurge || this.hlpTickCount <= 2)) {
          const msg = [
            `[HLP] VIRTUAL: HLP is LONG $${this.fmtK(virtual.valueUsd)} (${this.fmtSzi(virtual.szi)} VIRTUAL)`,
            `Entry: $${virtual.entryPx.toFixed(4)} | uPnl: $${virtual.unrealizedPnl.toFixed(0)}`,
            `If price dumps, HLP forced to sell = CASCADE risk`,
            sideFlipped ? `FLIPPED from ${prevSide}!` : '',
          ].filter(Boolean).join('\n');
          sendDiscordAlert(msg).catch(() => {});
          this.hlpAlertCooldowns.set(alertKey, now);
          console.log(`[HLP_ALERT] VIRTUAL LONG $${this.fmtK(virtual.valueUsd)} — cascade risk alert sent`);
        }
      } else {
        const alertKey = `hlp_virtual_short`;
        if (this.shouldSendHlpAlert(alertKey, now) && (sideFlipped || isNew || valueSurge || this.hlpTickCount <= 2)) {
          const msg = [
            `[HLP] VIRTUAL: HLP is SHORT $${this.fmtK(virtual.valueUsd)} (${this.fmtSzi(virtual.szi)} VIRTUAL)`,
            `Entry: $${virtual.entryPx.toFixed(4)} | uPnl: $${virtual.unrealizedPnl.toFixed(0)}`,
            `If price pumps, HLP forced to buy back = SQUEEZE risk`,
            sideFlipped ? `FLIPPED from ${prevSide}!` : '',
          ].filter(Boolean).join('\n');
          sendDiscordAlert(msg).catch(() => {});
          this.hlpAlertCooldowns.set(alertKey, now);
          console.log(`[HLP_ALERT] VIRTUAL SHORT $${this.fmtK(virtual.valueUsd)} — squeeze risk alert sent`);
        }
      }
    }
  }

  private shouldSendHlpAlert(key: string, now: number): boolean {
    const last = this.hlpAlertCooldowns.get(key) ?? 0;
    return now - last >= HLP_ALERT_COOLDOWN_MS;
  }

  private fmtK(val: number): string {
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
    return val.toFixed(0);
  }

  private fmtSzi(szi: number): string {
    const abs = Math.abs(szi);
    if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}K`;
    return abs.toFixed(2);
  }

  private fetchHlpState(): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('HLP fetch timeout')), 10_000);
      const payload = JSON.stringify({ type: 'clearinghouseState', user: HLP_ADDRESS });

      const req = https.request(HLP_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          clearTimeout(timeout);
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`HLP JSON parse error: ${body.slice(0, 100)}`));
          }
        });
        res.on('error', (e: Error) => { clearTimeout(timeout); reject(e); });
      });

      req.on('error', (e: Error) => { clearTimeout(timeout); reject(e); });
      req.write(payload);
      req.end();
    });
  }

  // ── Helpers ─────────────────────────────────────────────────

  private sumLiquidations(data: LiquidationEntry[], symbolMatch: string): number {
    const match = symbolMatch.toUpperCase();
    let total = 0;
    for (const entry of data) {
      if (entry.symbol?.toUpperCase().includes(match)) {
        total += entry.total_liquidations || 0;
      }
    }
    return total;
  }

  private extractImbalance(data: any, coin: string): number {
    if (!data || typeof data !== 'object') return 0;
    const byCoin = data.by_coin ?? data.data?.by_coin ?? {};
    // Try exact match, then partial
    const entry = byCoin[coin] ?? byCoin[coin.toUpperCase()] ?? null;
    if (entry && typeof entry.imbalance_ratio === 'number') {
      return entry.imbalance_ratio;
    }
    // Fallback: search keys
    for (const key of Object.keys(byCoin)) {
      if (key.toUpperCase().includes(coin.toUpperCase())) {
        return byCoin[key]?.imbalance_ratio ?? 0;
      }
    }
    return 0;
  }

  private extractPositions(symbols: Record<string, any>, ...nameMatches: string[]): PositionEntry[] {
    const result: PositionEntry[] = [];
    for (const [sym, data] of Object.entries(symbols)) {
      const symUp = sym.toUpperCase();
      if (!nameMatches.some(n => symUp.includes(n.toUpperCase()))) continue;

      // Process longs
      const longs = data?.longs ?? data?.long_positions ?? [];
      for (const pos of (Array.isArray(longs) ? longs : [])) {
        const liqPrice = Number(pos.liq_price ?? pos.liquidation_price ?? 0);
        const value = Number(pos.value ?? pos.position_value ?? 0);
        const leverage = Number(pos.leverage ?? 0);
        if (liqPrice > 0 && value > 0) {
          result.push({ liq_price: liqPrice, value, leverage, side: 'long' });
        }
      }

      // Process shorts
      const shorts = data?.shorts ?? data?.short_positions ?? [];
      for (const pos of (Array.isArray(shorts) ? shorts : [])) {
        const liqPrice = Number(pos.liq_price ?? pos.liquidation_price ?? 0);
        const value = Number(pos.value ?? pos.position_value ?? 0);
        const leverage = Number(pos.leverage ?? 0);
        if (liqPrice > 0 && value > 0) {
          result.push({ liq_price: liqPrice, value, leverage, side: 'short' });
        }
      }
    }
    return result;
  }

  private buildClusters(positions: PositionEntry[], midPrice: number): LiqCluster[] {
    if (positions.length === 0 || midPrice <= 0) return [];

    // Sort by liq_price
    const sorted = [...positions].sort((a, b) => a.liq_price - b.liq_price);

    // Group into clusters (liq_prices within CLUSTER_GROUP_PCT of each other)
    const clusters: LiqCluster[] = [];
    let currentCluster: PositionEntry[] = [sorted[0]];
    let clusterCenter = sorted[0].liq_price;

    for (let i = 1; i < sorted.length; i++) {
      const pos = sorted[i];
      const distFromCenter = Math.abs(pos.liq_price - clusterCenter) / clusterCenter * 100;

      if (distFromCenter <= CLUSTER_GROUP_PCT) {
        currentCluster.push(pos);
      } else {
        // Finalize current cluster
        this.finalizeCluster(currentCluster, midPrice, clusters);
        currentCluster = [pos];
        clusterCenter = pos.liq_price;
      }
    }
    // Finalize last cluster
    this.finalizeCluster(currentCluster, midPrice, clusters);

    // Filter: min value, max distance
    const filtered = clusters.filter(c =>
      c.totalValueUsd >= CLUSTER_MIN_VALUE_USD &&
      Math.abs(c.distancePct) <= CLUSTER_MAX_DISTANCE_PCT
    );

    // Sort by absolute distance (closest first)
    filtered.sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct));

    return filtered;
  }

  private finalizeCluster(positions: PositionEntry[], midPrice: number, out: LiqCluster[]): void {
    if (positions.length === 0) return;

    const totalValue = positions.reduce((s, p) => s + p.value, 0);
    const avgPrice = positions.reduce((s, p) => s + p.liq_price * p.value, 0) / totalValue;
    const distancePct = ((avgPrice - midPrice) / midPrice) * 100;

    // Determine dominant side
    let longValue = 0, shortValue = 0;
    for (const p of positions) {
      if (p.side === 'long') longValue += p.value;
      else shortValue += p.value;
    }

    out.push({
      price: avgPrice,
      totalValueUsd: totalValue,
      positionCount: positions.length,
      distancePct,
      side: longValue >= shortValue ? 'long' : 'short',
    });
  }

  private computeShortLongRatio(positions: PositionEntry[]): number {
    let longValue = 0, shortValue = 0;
    for (const p of positions) {
      if (p.side === 'long') longValue += p.value;
      else shortValue += p.value;
    }
    if (longValue === 0) return shortValue > 0 ? 99.0 : 0;
    return shortValue / longValue;
  }

  // ── API fetching ────────────────────────────────────────────

  private fetchLiquidations(): Promise<LiquidationEntry[]> {
    return this.fetchJson(`${API_BASE}/all_liquidations/1h.json?api_key=${API_KEY}`);
  }

  private fetchImbalance(window: '1h' | '4h'): Promise<any> {
    return this.fetchJsonRaw(`${API_BASE}/imbalance/${window}.json?api_key=${API_KEY}`);
  }

  /** Existing fetchJson — unwraps to array. Used for liquidation data. */
  private fetchJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 10_000);

      https.get(url, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          clearTimeout(timeout);
          try {
            const parsed = JSON.parse(body);
            const arr = Array.isArray(parsed) ? parsed : (parsed?.data ?? parsed?.liquidations ?? []);
            resolve(Array.isArray(arr) ? arr as T : [] as unknown as T);
          } catch {
            reject(new Error(`JSON parse error: ${body.slice(0, 100)}`));
          }
        });
        res.on('error', (e: Error) => { clearTimeout(timeout); reject(e); });
      }).on('error', (e: Error) => { clearTimeout(timeout); reject(e); });
    });
  }

  /** New fetchJsonRaw — returns raw parsed JSON (for object responses like imbalance). */
  private fetchJsonRaw<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 10_000);

      https.get(url, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          clearTimeout(timeout);
          try {
            const parsed = JSON.parse(body);
            resolve(parsed as T);
          } catch {
            reject(new Error(`JSON parse error: ${body.slice(0, 100)}`));
          }
        });
        res.on('error', (e: Error) => { clearTimeout(timeout); reject(e); });
      }).on('error', (e: Error) => { clearTimeout(timeout); reject(e); });
    });
  }
}
