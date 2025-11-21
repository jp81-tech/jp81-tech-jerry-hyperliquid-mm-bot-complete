// src/utils/riskConfig.ts
import "dotenv/config";

export type RiskConfig = {
  dynamicClip: boolean;
  clipMinUsd: number;
  clipMaxUsd: number;
  clipVolFactor: number;
  maxExposureMultiplier: number;

  antiPumpEnabled: boolean;
  pump1m: number;
  pump5m: number;

  antiDumpEnabled: boolean;
  dump1m: number;
  dump5m: number;

  biasEnabled: boolean;
  biasStrength: number;
  biasDecayMinMin: number;
  biasDecayMaxMin: number;

  dailyLossLimitUsd: number;
  dailyLossPauseMin: number;

  spreadBaseBps: number;
  spreadMaxBps: number;
  spreadVolMultiplier: number;

  rsiTopGuardEnabled: boolean;
  rsiBottomGuardEnabled: boolean;
  rsiOverbought: number;
  rsiOversold: number;
  topHighDistanceBps: number;
  bottomLowDistanceBps: number;

  fomoGuardEnabled: boolean;
  fomoVolumeZscore: number;
  fomoHighDistanceBps: number;
};

const num = (v: string | undefined, def: number): number =>
  v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : def;

export const riskConfig: RiskConfig = {
  dynamicClip: (process.env.DYNAMIC_CLIP ?? "false").toLowerCase() === "true",
  clipMinUsd: num(process.env.CLIP_MIN_USD, 40),
  clipMaxUsd: num(process.env.CLIP_MAX_USD, 180),
  clipVolFactor: num(process.env.CLIP_VOL_FACTOR, 0.25),
  maxExposureMultiplier: num(process.env.MAX_EXPOSURE_MULTIPLIER, 6),

  antiPumpEnabled:
    (process.env.ANTI_PUMP_ENABLED ?? "false").toLowerCase() === "true",
  pump1m: num(process.env.PUMP_THRESHOLD_1M, 2.0),
  pump5m: num(process.env.PUMP_THRESHOLD_5M, 3.5),

  antiDumpEnabled:
    (process.env.ANTI_DUMP_ENABLED ?? "false").toLowerCase() === "true",
  dump1m: num(process.env.DUMP_THRESHOLD_1M, 2.0),
  dump5m: num(process.env.DUMP_THRESHOLD_5M, 3.5),

  biasEnabled: (process.env.BIAS_ENABLED ?? "false").toLowerCase() === "true",
  biasStrength: num(process.env.BIAS_STRENGTH, 0.35),
  biasDecayMinMin: num(process.env.BIAS_DECAY_MIN, 30),
  biasDecayMaxMin: num(process.env.BIAS_DECAY_MAX, 240),

  dailyLossLimitUsd: num(process.env.DAILY_LOSS_LIMIT_USD, 120),
  dailyLossPauseMin: num(process.env.DAILY_LOSS_PAUSE_MIN, 180),

  spreadBaseBps: num(process.env.SPREAD_BASE_BPS, 28),
  spreadMaxBps: num(process.env.SPREAD_MAX_BPS, 45),
  spreadVolMultiplier: num(process.env.SPREAD_VOL_MULTIPLIER, 1.5),

  rsiTopGuardEnabled:
    (process.env.RSI_TOP_GUARD_ENABLED ?? "false").toLowerCase() === "true",
  rsiBottomGuardEnabled:
    (process.env.RSI_BOTTOM_GUARD_ENABLED ?? "false").toLowerCase() === "true",
  rsiOverbought: num(process.env.RSI_OVERBOUGHT, 70),
  rsiOversold: num(process.env.RSI_OVERSOLD, 30),
  topHighDistanceBps: num(process.env.TOP_HIGH_DISTANCE_BPS, 50),
  bottomLowDistanceBps: num(process.env.BOTTOM_LOW_DISTANCE_BPS, 50),

  fomoGuardEnabled:
    (process.env.FOMO_GUARD_ENABLED ?? "false").toLowerCase() === "true",
  fomoVolumeZscore: num(process.env.FOMO_VOLUME_ZSCORE, 2.0),
  fomoHighDistanceBps: num(process.env.FOMO_HIGH_DISTANCE_BPS, 75),
};
