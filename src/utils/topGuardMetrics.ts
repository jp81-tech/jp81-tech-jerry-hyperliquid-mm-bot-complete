import { TopGuardContext } from "./topGuards.js";

type HistoryPoint = {
  t: number;    // seconds since epoch
  mid: number;
  vol: number;
};

type RuntimeMetrics = {
  ret1m: number;
  ret5m: number;
  rsi5m?: number;
  high24h: number;
  vol5mZscore: number;
};

export class TopGuardMetricsStore {
  private history: Record<string, HistoryPoint[]> = {};
  private vol5mEma: Record<string, number> = {};

  private nowSec(): number {
    return Date.now() / 1000;
  }

  private pushPoint(symbol: string, midPx: number, vol: number): HistoryPoint[] {
    const t = this.nowSec();
    const arr = this.history[symbol] || [];
    arr.push({ t, mid: midPx, vol });
    const cutoff24h = t - 24 * 3600;
    while (arr.length > 0 && arr[0].t < cutoff24h) {
      arr.shift();
    }
    this.history[symbol] = arr;
    return arr;
  }

  private computeReturns(arr: HistoryPoint[], midPx: number, now: number): { ret1m: number; ret5m: number } {
    const cutoff1m = now - 60;
    const cutoff5m = now - 300;
    let ret1m = 0;
    let ret5m = 0;

    let px1m = midPx;
    let px5m = midPx;

    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      if (p.t <= cutoff5m && px5m === midPx) {
        px5m = p.mid;
      }
      if (p.t <= cutoff1m && px1m === midPx) {
        px1m = p.mid;
        break;
      }
    }

    if (px1m > 0 && midPx > 0 && px1m !== midPx) {
      ret1m = midPx / px1m - 1;
    }
    if (px5m > 0 && midPx > 0 && px5m !== midPx) {
      ret5m = midPx / px5m - 1;
    }

    return { ret1m, ret5m };
  }

  private computeHigh24h(arr: HistoryPoint[], midPx: number): number {
    let high = midPx;
    for (const p of arr) {
      if (p.mid > high) high = p.mid;
    }
    return high;
  }

  private computeRsi(arr: HistoryPoint[]): number | undefined {
    if (arr.length < 15) return undefined;

    let gains = 0;
    let losses = 0;
    let count = 0;

    for (let i = arr.length - 1; i > 0 && count < 30; i--, count++) {
      const diff = arr[i].mid - arr[i - 1].mid;
      if (diff > 0) gains += diff;
      else if (diff < 0) losses -= diff;
    }

    if (count === 0) return undefined;

    const avgGain = gains / count;
    const avgLoss = losses / count;
    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private computeVolume5mZscore(symbol: string, arr: HistoryPoint[], now: number): number {
    const cutoff5m = now - 300;
    let vol5m = 0;

    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      if (p.t < cutoff5m) break;
      vol5m += p.vol;
    }

    let ema = this.vol5mEma[symbol];
    if (ema === undefined) {
      ema = vol5m;
    } else {
      const alpha = 0.2;
      ema = alpha * vol5m + (1 - alpha) * ema;
    }
    this.vol5mEma[symbol] = ema;

    if (ema <= 0) return 0;
    return (vol5m - ema) / ema;
  }

  update(symbol: string, midPx: number, vol: number = 0): RuntimeMetrics {
    const arr = this.pushPoint(symbol, midPx, vol);
    const now = this.nowSec();

    const { ret1m, ret5m } = this.computeReturns(arr, midPx, now);
    const high24h = this.computeHigh24h(arr, midPx);
    const rsi5m = this.computeRsi(arr);
    const vol5mZscore = this.computeVolume5mZscore(symbol, arr, now);

    return { ret1m, ret5m, rsi5m, high24h, vol5mZscore };
  }

  buildContext(symbol: string, midPx: number, vol: number = 0): TopGuardContext {
    const m = this.update(symbol, midPx, vol);
    const ctx: TopGuardContext = {
      midPx,
      ret1m: m.ret1m,
      ret5m: m.ret5m,
      rsi5m: m.rsi5m,
      localHigh24h: m.high24h,
      volume5mZscore: m.vol5mZscore,
      recentBuyStreak: 0,
      recentBuyNotionalUsd: 0,
    };
    return ctx;
  }
}
