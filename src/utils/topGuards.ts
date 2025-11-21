// src/utils/topGuards.ts

export type TopGuardContext = {
  midPx: number;                // aktualny mid price
  ret1m: number;                // (px_now / px_1m_ago - 1)
  ret5m: number;                // (px_now / px_5m_ago - 1)
  rsi5m?: number;               // RSI z 5m (opcjonalnie)
  localHigh24h: number;         // 24h high
  volume5mZscore: number;       // z-score wolumenu 5m
  recentBuyStreak: number;      // ile ostatnich filli to BUY z rzędu
  recentBuyNotionalUsd: number; // suma notional BUY z ostatnich X minut
};

export type TopGuardDecision = {
  block: boolean;
  reason?: string;
};

function getEnvBool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === "true") return true;
  if (v === "false") return false;
  return def;
}

function getEnvNum(name: string, def: number): number {
  const v = process.env[name];
  if (v == null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/**
 * Główna funkcja: zwraca block=true jeśli NIE wolno składać BUY (long / redukcja shorta).
 */
export function shouldBlockTopBuy(
  symbol: string,
  ctx: TopGuardContext
): TopGuardDecision {
  const mid = ctx.midPx;
  const high = ctx.localHigh24h > 0 ? ctx.localHigh24h : ctx.midPx;

  const distFromHighPct =
    high > 0 ? (high - mid) / high : 1;

  const distFromHighBps = distFromHighPct * 10_000;

  // === 1) Anti-pump (czysto procentowy ruch) ===
  if (getEnvBool("ANTI_TOP_PUMP_ENABLED", true)) {
    const thr1m = getEnvNum("ANTI_TOP_PUMP_RET1M", 0.02);  // 2%
    const thr5m = getEnvNum("ANTI_TOP_PUMP_RET5M", 0.035); // 3.5%

    if (ctx.ret1m >= thr1m || ctx.ret5m >= thr5m) {
      return {
        block: true,
        reason: `pump_guard ret1m=${(ctx.ret1m * 100).toFixed(
          2
        )}% ret5m=${(ctx.ret5m * 100).toFixed(2)}%`,
      };
    }
  }

  // === 2) RSI top guard ===
  if (getEnvBool("RSI_TOP_GUARD_ENABLED", true)) {
    const rsiOverbought = getEnvNum("RSI_OVERBOUGHT", 70);
    const topHighDistBps = getEnvNum("TOP_HIGH_DISTANCE_BPS", 50); // 0.5%

    if (
      ctx.rsi5m != null &&
      ctx.rsi5m >= rsiOverbought &&
      distFromHighBps <= topHighDistBps
    ) {
      return {
        block: true,
        reason: `rsi_top_guard rsi5m=${ctx.rsi5m.toFixed(
          1
        )} distFromHighBps=${distFromHighBps.toFixed(1)}`,
      };
    }
  }

  // === 3) FOMO / crowd guard ===
  if (getEnvBool("FOMO_GUARD_ENABLED", true)) {
    const volZThr = getEnvNum("FOMO_VOLUME_ZSCORE", 2.0);
    const highDistBps = getEnvNum("FOMO_HIGH_DISTANCE_BPS", 75); // 0.75%

    if (
      ctx.volume5mZscore >= volZThr &&
      distFromHighBps <= highDistBps
    ) {
      return {
        block: true,
        reason: `fomo_guard volZ=${ctx.volume5mZscore.toFixed(
          2
        )} distFromHighBps=${distFromHighBps.toFixed(1)}`,
      };
    }
  }

  return { block: false };
}
