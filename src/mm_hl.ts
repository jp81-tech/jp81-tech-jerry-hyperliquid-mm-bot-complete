import * as hl from '@nktkas/hyperliquid'
import dns from 'dns'
import 'dotenv/config'

// 🛡️ FIX: Node.js 18+ IPv6/IPv4 compatibility issue
dns.setDefaultResultOrder('ipv4first')

import crypto from 'crypto'
import { ethers } from 'ethers'
import fs from 'fs'
import fetch from 'node-fetch'
import path from 'path'
import { AlertManager } from './alerts/AlertManager.js'
import { HyperliquidAPI } from './api/hyperliquid.js'
import { applyBehaviouralRiskToLayers, type BehaviouralRiskMode } from './behaviouralRisk.js'
import { BinancePriceAnchor } from './integrations/binance_anchor.js'
import { getGoldenDuoSignal, type GoldenDuoSignal } from './integrations/nansen_hyperliquid.js'
import { CopyTradingSignal, getNansenProAPI } from './integrations/nansen_pro.js'
import { isPairBlockedByLiquidity, loadLiquidityFlags } from './liquidityFlags.js'
import { BIAS_CONFIGS } from './mm/bias_config.js'
import { DynamicConfigManager } from './mm/dynamic_config.js'
import { getAutoEmergencyOverrideSync, loadAndAnalyzeAllTokens, MmMode } from './mm/SmAutoDetector.js'
import { HyperliquidMarketDataProvider } from './mm/market_data.js'
import { tryLoadNansenBiasIntoCache, type NansenBiasEntry } from './mm/nansen_bias_cache.js'
// 🚀 AlphaExtractionEngine - Native TypeScript Smart Money tracking (replaces whale_tracker.py)
import {
  alphaEngineIntegration,
  getAlphaEngineBiasCache,
  getAlphaSizeMultipliers,
  shouldBypassDelay,
  type TradingPermissions,
  type TradingCommand,
} from './core/AlphaEngineIntegration.js'
// 🔮 Oracle Vision - Price prediction using SM data + Linear Regression
import {
  oracleEngine,
  generateSignalDashboard,
  generateDivergenceAlerts,
  type OracleSignal,
} from './oracle/index.js'
import { PositionProtector } from './mm/position_protector.js'
import type { PositionRiskStatus } from './mm/position_risk_manager.js'
import { PositionRiskManager } from './mm/position_risk_manager.js'
import { computeSideAutoSpread } from './risk/auto_spread.js'
import { createConservativeRiskConfig, RiskAction, RiskManager, type RiskCheckResult } from './risk/RiskManager.js'
import { createDefaultShadowWatch, ShadowWatch } from './risk/shadowWatch.js'
import { TrendFilter } from './risk/trendFilter.js'
import {
  SmartRotationEngine,
  type NansenWhaleRisk,
  type PairAnalysisLite
} from './rotation/smart_rotation.js'
import { ShadowAlertIntegration, ShadowTradingIntegration, type NansenTrade, type TradeSignal } from './shadow/index.js'
import { AdverseSelectionTracker } from './signals/adverse_selection.js'
import { FundingArbitrage } from './signals/funding_arbitrage.js'
import { LiquidationShield } from './signals/liquidation_shield.js'
import { MarketVisionService, NANSEN_TOKENS } from './signals/market_vision.js'
import { VPINAnalyzer } from './signals/vpin_analyzer.js'
import { WhaleIntelligence } from './signals/whale_intelligence.js'
// 🔔 Nansen Alert Integration - Real-time SM alert processing
import {
  processNansenAlert,
  shouldBlockBids,
  shouldBlockAsks,
  updateBotState,
  nansenIntegration,
  getMMSignalStatus,
  shouldStartMM,
  shouldStopMM
} from './signals/nansen_alert_integration.js'
import { Supervisor, SupervisorHooks } from './supervisor/index.js'
import { DailySnapshotGenerator } from './telemetry/DailySnapshotGenerator.js'
import { TelemetryCollector } from './telemetry/TelemetryCollector.js'
import { TelemetryServer } from './telemetry/TelemetryServer.js'
import { AlertCategory, AlertSeverity } from './types/alerts.js'
import {
  calculateInventorySkew,
  ChaseConfig,
  getInstrumentSpecs,
  INSTITUTIONAL_PRESET,
  roundToTick,
  ThrottleTracker,
  VolatilityTracker
} from './utils/chase.js'
import { GridManager, GridOrder } from './utils/grid_manager.js'
import { killSwitchActive } from './utils/kill_switch.js'
import { createLegacyUnwinderFromEnv, LegacyUnwinder } from './utils/legacy_unwinder.js'
import { mmAlertBot } from './utils/mm_alert_bot.js'
import { ConsoleNotifier } from './utils/notifier.js'
import { OrderReporter } from './utils/order_reporter.js'
import { positionSizeUSD } from './utils/position_sizing.js'
import {
  adjustPriceByTicks,
  calculateNotionalInt,
  getPriceDecimals,
  getSizeDecimals,
  intToDecimalString,
  quantizeOrder,
  quantizePrice,
  quantizeSize,
  validateFormat
} from './utils/quant.js'
import { RateLimitReserver } from './utils/rate_limit_reserve.js'
import { sendRiskAlert, sendSystemAlert } from './utils/slack_router.js'
import { applySpecOverrides } from './utils/spec_overrides.js'
import { VolatilityRotation } from './utils/volatility_rotation.js'
import { HyperliquidWebSocket, L2BookUpdate } from './utils/websocket_client.js'

// ─────────────────────────────────────────────────────────────────────────────
// TYPE EXTENSIONS - Fix TypeScript errors without changing runtime
// ─────────────────────────────────────────────────────────────────────────────

// Extend HyperliquidAPI to include infoClient (exists at runtime)
type ExtendedHyperliquidAPI = HyperliquidAPI & {
  infoClient: hl.InfoClient
}

// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN DUO DATA (Smart Money + Whale positioning from Nansen)
// ─────────────────────────────────────────────────────────────────────────────

type GoldenDuoData = {
  bias: number                    // 0-1 scale (0=bearish, 1=bullish)
  signal: string                  // 'bullish', 'bearish', 'aligned_bearish', 'divergence_strong', etc.
  sm_net_balance_usd: number      // Smart Money net position in USD
  whale_net_balance_usd: number   // Whale net position in USD
  sm_holders?: number             // Optional: number of SM holders/traders (used for liquidity confidence)
  whale_dump_alert?: boolean      // True if whale is dumping
  positionBias?: number           // Legacy compatibility
  flowSkew?: number               // Flow skew -1 to +1
  divergence_type?: string        // 'sm_bull_whale_bear', 'sm_bear_whale_bull', 'none'
  divergence_strength?: string    // 'extreme', 'strong', 'moderate', 'weak', 'none'
  divergence_spread_mult?: number // Spread multiplier for divergence
  divergence_inventory_mult?: number // Inventory multiplier for divergence
  top_traders_pnl?: 'positive' | 'negative' | 'mixed' | 'shorts_winning' | 'longs_underwater' // 🛡️ uPnL Weighting
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTITUTIONAL SIZE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

type InstitutionalSizeConfig = {
  minUsd: number           // twarde minimum notional (np. min notional HL + buffer)
  targetUsd: number        // docelowy rozmiar pojedynczego childa
  maxUsd: number           // hard cap per order
  maxUsdAbs?: number       // dodatkowy absolutny limit (np. 800$ dla ZEC)
}

const INSTITUTIONAL_SIZE_CONFIG: Record<string, InstitutionalSizeConfig> = {
  // duże, drogie coiny – targetUsd=100 → softCap=$200
  ETH: {
    minUsd: 20,
    targetUsd: 100,
    maxUsd: 200,
    maxUsdAbs: 2000
  },
  SOL: {
    minUsd: 20,
    targetUsd: 100,
    maxUsd: 200,
    maxUsdAbs: 2000
  },
  ZEC: {
    minUsd: 15,    // zawsze >= 15$
    targetUsd: 50, // docelowy child
    maxUsd: 150,   // pojedynczy order nie > 150$
    maxUsdAbs: 1500 // absolutny sufit bezpieczeństwa
  },
  UNI: {
    minUsd: 15,
    targetUsd: 40,
    maxUsd: 100
  },
  // memki / tańsze
  VIRTUAL: {
    minUsd: 15,
    targetUsd: 40,
    maxUsd: 100
  },
  HYPE: {
    minUsd: 15,
    targetUsd: 50,
    maxUsd: 120
  },
  MON: {
    minUsd: 11,
    targetUsd: 16,
    maxUsd: 40
  },
  HMSTR: {
    minUsd: 11,
    targetUsd: 16,
    maxUsd: 40
  },
  BOME: {
    minUsd: 11,
    targetUsd: 16,
    maxUsd: 40
  },
  XPL: {
    minUsd: 60,    // Higher minimum due to below_min rejections at ~$40
    targetUsd: 80,
    maxUsd: 150
  },
  // Dodane dla większych pozycji - ULTRA DENSE GRID
  LIT: {
    minUsd: 15,      // zmniejszone z 20 dla gęstszej siatki
    targetUsd: 25,   // zmniejszone z 100 dla więcej zleceń
    maxUsd: 100,
    maxUsdAbs: 2000
  },
  SUI: {
    minUsd: 20,
    targetUsd: 100,
    maxUsd: 200,
    maxUsdAbs: 2000
  },
  DOGE: {
    minUsd: 20,
    targetUsd: 100,
    maxUsd: 200,
    maxUsdAbs: 2000
  },
  kPEPE: {
    minUsd: 20,
    targetUsd: 100,
    maxUsd: 200,
    maxUsdAbs: 2000
  },
  WIF: {
    minUsd: 20,
    targetUsd: 100,
    maxUsd: 200,
    maxUsdAbs: 2000
  },
  PUMP: {
    minUsd: 20,
    targetUsd: 100,
    maxUsd: 200,
    maxUsdAbs: 2000
  },
  XRP: {
    minUsd: 20,
    targetUsd: 100,
    maxUsd: 200,
    maxUsdAbs: 2000
  },
  BTC: {
    minUsd: 20,
    targetUsd: 100,
    maxUsd: 200,
    maxUsdAbs: 2000
  },
  FARTCOIN: {
    minUsd: 15,      // zmniejszone z 20 dla gęstszej siatki
    targetUsd: 25,   // zmniejszone z 100 dla więcej zleceń
    maxUsd: 100,
    maxUsdAbs: 2000
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAX INVENTORY PER COIN (institutional guard)
// ─────────────────────────────────────────────────────────────────────────────

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]
  if (raw === undefined) return fallback
  return raw === "true" || raw === "1"
}

const MAX_INVENTORY_COINS: Record<string, number> = {
  ZEC: envNumber("ZEC_INVENTORY_CAP_COINS", 0),
  UNI: envNumber("UNI_INVENTORY_CAP_COINS", 0),
  VIRTUAL: envNumber("VIRTUAL_INVENTORY_CAP_COINS", 0),
  HMSTR: envNumber("HMSTR_INVENTORY_CAP_COINS", 0),
  BOME: envNumber("BOME_INVENTORY_CAP_COINS", 0),
  MON: envNumber("MON_INVENTORY_CAP_COINS", 0),
  ETH: envNumber("ETH_INVENTORY_CAP_COINS", 0),
  FARTCOIN: envNumber("FARTCOIN_INVENTORY_CAP_COINS", 0)
}

const MAX_INVENTORY_USD: Record<string, number> = {
  ZEC: envNumber("ZEC_MAX_POSITION_USD", 5000),
  HYPE: envNumber("HYPE_MAX_POSITION_USD", 5000),
  VIRTUAL: envNumber("VIRTUAL_MAX_POSITION_USD", 5000),
  MON: envNumber("MON_MAX_POSITION_USD", 5000),
  UNI: envNumber("UNI_MAX_POSITION_USD", 5000),
  HMSTR: envNumber("HMSTR_MAX_POSITION_USD", 5000),
  BOME: envNumber("BOME_MAX_POSITION_USD", 5000),
  ETH: envNumber("ETH_MAX_POSITION_USD", 5000),
  FARTCOIN: envNumber("FARTCOIN_MAX_POSITION_USD", 5000),
  XPL: envNumber("XPL_MAX_POSITION_USD", 5000),
  LIT: envNumber("LIT_MAX_POSITION_USD", 5000),
  SUI: envNumber("SUI_MAX_POSITION_USD", 5000),
  DOGE: envNumber("DOGE_MAX_POSITION_USD", 5000),
  kPEPE: envNumber("kPEPE_MAX_POSITION_USD", 5000),
  WIF: envNumber("WIF_MAX_POSITION_USD", 5000),
  PUMP: envNumber("PUMP_MAX_POSITION_USD", 5000),
  XRP: envNumber("XRP_MAX_POSITION_USD", 5000),
  BTC: envNumber("BTC_MAX_POSITION_USD", 5000),
  SOL: envNumber("SOL_MAX_POSITION_USD", 5000)
}

// ─────────────────────────────────────────────────────────────────────────────
// UNWIND MODE CONFIG
// ─────────────────────────────────────────────────────────────────────────────

type UnwindMode = "off" | "manual" | "auto"

function getUnwindMode(): UnwindMode {
  const mode = (process.env.UNWIND_MODE || "off").toLowerCase()
  return mode === "manual" || mode === "auto" ? mode : "off"
}

function getUnwindCoins(): Set<string> {
  const raw = process.env.UNWIND_COINS || ""
  return new Set(
    raw
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
  )
}

function getUnwindThresholdMult(): number {
  const mult = Number(process.env.UNWIND_AUTO_THRESHOLD_MULT ?? "1")
  return Number.isFinite(mult) && mult > 0 ? mult : 1
}

function shouldUnwindCoin(coin: string, currentPosSz: number, maxInv: number): boolean {
  const mode = getUnwindMode()
  if (mode === "off") return false

  const coins = getUnwindCoins()
  if (!coins.has(coin)) return false

  if (mode === "manual") return true

  const thresholdMult = getUnwindThresholdMult()
  const threshold = maxInv * thresholdMult
  return Math.abs(currentPosSz) + EPS >= threshold
}

// ─────────────────────────────────────────────────────────────────────────────
// DAILY NOTIONAL CAPS (per coin, per day)
// ─────────────────────────────────────────────────────────────────────────────

const GLOBAL_DAILY_NOTIONAL_CAP_USD = Number(process.env.DAILY_NOTIONAL_CAP_USD ?? "50000")

const PER_COIN_DAILY_NOTIONAL_CAP_USD: Record<string, number> = {
  ZEC: Number(process.env.ZEC_DAILY_NOTIONAL_CAP_USD ?? "60000"),
  UNI: Number(process.env.UNI_DAILY_NOTIONAL_CAP_USD ?? "40000"),
  VIRTUAL: Number(process.env.VIRTUAL_DAILY_NOTIONAL_CAP_USD ?? "40000"),
  MON: Number(process.env.MON_DAILY_NOTIONAL_CAP_USD ?? "20000"),
  HMSTR: Number(process.env.HMSTR_DAILY_NOTIONAL_CAP_USD ?? "20000"),
  BOME: Number(process.env.BOME_DAILY_NOTIONAL_CAP_USD ?? "20000")
}

function getDailyNotionalCapUsd(symbol: string): number {
  return PER_COIN_DAILY_NOTIONAL_CAP_USD[symbol] ?? GLOBAL_DAILY_NOTIONAL_CAP_USD
}

/**
 * Convert UTC hour to CET (UTC+1) and wrap into 0–23 range.
 */
function getCETHour(now: Date = new Date()): number {
  const utcHour = now.getUTCHours()
  return (utcHour + 1 + 24) % 24
}

// ─────────────────────────────────────────────────────────────────────────────
// ZEC DEFENSIVE MODE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getZecDownMovePct(): number {
  return envNumber("ZEC_DOWN_MOVE_PCT", 3)
}

function getZecDownWindowSec(): number {
  return envNumber("ZEC_DOWN_WINDOW_SEC", 1800)
}

function getZecDefensiveMaxPosUsd(): number {
  return envNumber("ZEC_DEFENSIVE_MAX_POSITION_USD", 1500)
}

function isZecDefensiveUnwindOnly(): boolean {
  return envBool("ZEC_DEFENSIVE_UNWIND_ONLY", true)
}

function getZecNightMaxPosUsd(): number {
  return envNumber("ZEC_NIGHT_MAX_POSITION_USD", 1200)
}

function isZecNightUnwindOnly(): boolean {
  return envBool("ZEC_NIGHT_UNWIND_ONLY", true)
}

const ZEC_PRICE_HISTORY: Array<{ t: number; mid: number }> = []

function recordZecMidPrice(midPrice: number): void {
  if (!Number.isFinite(midPrice) || midPrice <= 0) {
    return
  }
  const now = Date.now()
  ZEC_PRICE_HISTORY.push({ t: now, mid: midPrice })
  const retentionMs = getZecDownWindowSec() * 1000 * 2
  const cutoff = now - retentionMs
  while (ZEC_PRICE_HISTORY.length && ZEC_PRICE_HISTORY[0].t < cutoff) {
    ZEC_PRICE_HISTORY.shift()
  }
}

function getZecMovePct(windowSec: number = getZecDownWindowSec()): number | null {
  if (ZEC_PRICE_HISTORY.length < 2) {
    return null
  }
  const now = Date.now()
  const cutoff = now - windowSec * 1000

  let startIndex = ZEC_PRICE_HISTORY.findIndex(sample => sample.t >= cutoff)
  if (startIndex === -1) {
    startIndex = ZEC_PRICE_HISTORY.length - 1
  }

  const first = ZEC_PRICE_HISTORY[startIndex]
  const last = ZEC_PRICE_HISTORY[ZEC_PRICE_HISTORY.length - 1]
  if (!first || !last || first.mid <= 0) {
    return null
  }

  return ((last.mid - first.mid) / first.mid) * 100
}

function isZecDowntrendActive(): boolean {
  const movePct = getZecMovePct(getZecDownWindowSec())
  if (movePct === null) {
    return false
  }
  return movePct <= -getZecDownMovePct()
}

function isWeekend(now: Date = new Date()): boolean {
  const day = now.getUTCDay()
  return day === 0 || day === 6
}

function getGlobalDowntrendMovePct(): number {
  return Number(process.env.DOWNTREND_MOVE_PCT ?? "3")
}

function getGlobalDowntrendWindowSec(): number {
  const mins = Number(process.env.DOWNTREND_WINDOW_MIN ?? "30")
  if (Number.isFinite(mins) && mins > 0) {
    return mins * 60
  }
  return getZecDownWindowSec()
}

function isGlobalDowntrendActive(): boolean {
  const movePct = getZecMovePct(getGlobalDowntrendWindowSec())
  if (movePct === null) {
    return false
  }
  return movePct <= -getGlobalDowntrendMovePct()
}

const DEFENSIVE_CONFIG: Record<string, { flag: string; sizeMult: number; spreadMult: number }> = {
  ZEC: { flag: "ZEC_DEFENSIVE_ENABLED", sizeMult: 0.5, spreadMult: 1.3 },
  UNI: { flag: "UNI_DEFENSIVE_ENABLED", sizeMult: 0.6, spreadMult: 1.25 },
  VIRTUAL: { flag: "VIRTUAL_DEFENSIVE_ENABLED", sizeMult: 0.6, spreadMult: 1.25 }
}

function getWeekendSizeMult(): number {
  const raw = Number(process.env.WEEKEND_BOOST_SIZE_MULT ?? "1.25")
  return Number.isFinite(raw) && raw > 0 ? raw : 1
}

function getWeekendSpreadMult(): number {
  const raw = Number(process.env.WEEKEND_BOOST_SPREAD_MULT ?? "0.85")
  return Number.isFinite(raw) && raw > 0 ? raw : 1
}

type AdaptiveMode = 'none' | 'defensive' | 'weekend'

function computeAdaptiveMultipliers(symbol: string, now: Date, globalDowntrend: boolean): {
  sizeMult: number
  spreadMult: number
  mode: AdaptiveMode
} {
  let sizeMult = 1
  let spreadMult = 1
  const symbolKey = symbol.toUpperCase()

  if (globalDowntrend) {
    const cfg = DEFENSIVE_CONFIG[symbolKey]
    if (cfg && envBool(cfg.flag, symbolKey === "ZEC")) {
      sizeMult *= cfg.sizeMult
      spreadMult *= cfg.spreadMult
      return { sizeMult, spreadMult, mode: 'defensive' }
    }
    return { sizeMult, spreadMult, mode: 'none' }
  }

  if (envBool("WEEKEND_BOOST_ENABLED", false) && isWeekend(now)) {
    sizeMult *= getWeekendSizeMult()
    spreadMult *= getWeekendSpreadMult()
    return { sizeMult, spreadMult, mode: 'weekend' }
  }

  return { sizeMult, spreadMult, mode: 'none' }
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED CONSTANTS & HELPERS - Centralized rounding logic
// ─────────────────────────────────────────────────────────────────────────────

const EPS = 1e-12

/**
 * Guess szDecimals from mid price (until exchange provides true decimals)
 * High-price assets need fewer decimals to avoid sub-lot rounding
 */
function guessSzDecimals(midPx: number): number {
  // Special case for MON: force integer size (0 decimals) due to API failures
  if (midPx < 0.1) return 0
  return midPx > 100 ? 2 : midPx > 10 ? 3 : 4
}

/**
 * Compute coin step (minimum valid size increment)
 * @param specs - Instrument specs with lotSize
 * @param szDec - Size decimals (from exchange or guessed)
 * @returns Minimum coin increment
 */
function coinStepFrom(specs: { lotSize?: number }, szDec: number): number {
  return Math.max(specs.lotSize ?? 0, Math.pow(10, -szDec))
}

/**
 * Quantize to step with floor rounding (exact decimals, integer arithmetic)
 */
function quantizeFloor(x: number, step: number): number {
  if (step <= 0) return x
  // Use integer arithmetic to avoid float crumbs
  const numSteps = Math.floor((x + 1e-12) / step)
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))
  const multiplier = Math.pow(10, decimals)
  const stepInt = Math.round(step * multiplier)
  const result = (numSteps * stepInt) / multiplier
  return Number(result.toFixed(decimals))
}

/**
 * Quantize to step with ceiling rounding (exact decimals, integer arithmetic)
 */
function quantizeCeil(x: number, step: number): number {
  if (step <= 0) return x
  // Use integer arithmetic to avoid float crumbs
  const numSteps = Math.ceil((x - 1e-12) / step)
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))
  const multiplier = Math.pow(10, decimals)
  const stepInt = Math.round(step * multiplier)
  const result = (numSteps * stepInt) / multiplier
  return Number(result.toFixed(decimals))
}

/**
 * Get decimal precision from tick size
 */
function priceDecimalsFromTick(tickSize: number): number {
  return Math.max(0, -Math.floor(Math.log10(tickSize)))
}

// ─────────────────────────────────────────────────────────────────────────────
// CHILD ORDER NORMALIZER - Ensures all orders meet minimum notional requirements
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-buckets child orders to ensure each meets minimum notional requirements
 * while preserving total capital allocation.
 *
 * @param orders - Array of grid orders from GridManager
 * @param opts - Target and minimum USD amounts per order
 * @returns Rebucketed orders that all meet minimum notional floor
 */
function normalizeChildNotionals(
  orders: Array<{ price: number; sizeUsd: number; side: "bid" | "ask"; layer: number; units: number }>,
  opts: { targetUsd: number; minUsd: number }
) {
  const target = Math.max(opts.targetUsd, opts.minUsd + 2); // keep ~$2 buffer above exchange floor
  const total = orders.reduce((a, o) => a + (o.sizeUsd || 0), 0);
  if (total <= 0) return [];

  // How many children can we afford at ≥ target?
  let slots = Math.floor(total / target);
  if (slots <= 0) {
    // Not enough budget to create even one child above min → pick the largest order only if it clears min
    const best = orders.reduce((acc, o) => (o.sizeUsd > (acc?.sizeUsd ?? 0) ? o : acc), orders[0]);
    if (!best || best.sizeUsd + 1e-9 < opts.minUsd) return [];
    // Allocate all budget to this order (capped by its price conversion later)
    return [{ ...best, sizeUsd: Math.max(opts.minUsd, Math.min(best.sizeUsd, total)) }];
  }

  // Preserve order of original children (sorted by layer then distance typically).
  const rebuilt: typeof orders = [];
  let remaining = total;

  for (let i = 0; i < orders.length && slots > 0; i++) {
    const o = orders[i];
    // ensure we leave enough to fund remaining slots at least 'target' each
    const minReserve = (slots - 1) * target;
    let alloc = Math.min(target, Math.max(opts.minUsd, remaining - minReserve));
    // Ensure alloc is at least minUsd (fix for UNI getting ~$7 orders)
    if (alloc + 1e-9 < opts.minUsd) {
      alloc = opts.minUsd
    }
    if (alloc + 1e-9 >= opts.minUsd) {
      rebuilt.push({ ...o, sizeUsd: alloc });
      remaining -= alloc;
      slots -= 1;
    }
  }
  // ignore any tiny 'remaining' dust < minUsd

  return rebuilt;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE MANAGER - Persists bot state to disk
// ─────────────────────────────────────────────────────────────────────────────

type BotState = {
  positions: { [pair: string]: { size: number; entryPrice: number; side: 'long' | 'short' } }
  trades: { ts: number; pair: string; side: string; price: number; size: number; pnl?: number }[]
  dailyPnl: number
  totalPnl: number
  lastResetDate: string
  dailyPnlAnchorUsd?: number  // Anchor point: raw daily PnL from Hyperliquid at reset time
  execStats: { success: number; fail: number; latencies: number[] }
  lastProcessedFillTime?: number  // Track last synced fill to avoid double-counting
  processedFillOids?: string[]  // Track processed order IDs
}

type OrderHistoryEntry = {
  cloid: string  // Our client order ID
  oid?: string  // Exchange order ID (if assigned)
  pair: string
  side: 'buy' | 'sell'
  price: number
  size: number
  timestamp: number
  status: 'placed' | 'modified' | 'cancelled' | 'filled' | 'rejected'
  method: 'place' | 'batchModify' | 'cancel'
}

class StateManager {
  private stateFile: string
  private state: BotState

  constructor(stateFile?: string) {
    this.stateFile = stateFile || path.join(process.cwd(), 'data/bot_state.json')
    this.state = this.loadState()
  }

  private loadState(): BotState {
    try {
      if (fs.existsSync(this.stateFile)) {
        const loaded = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'))
        // Ensure new fields exist
        loaded.lastProcessedFillTime = loaded.lastProcessedFillTime || 0
        loaded.processedFillOids = loaded.processedFillOids || []
        return loaded
      }
    } catch (e) { }
    return {
      positions: {},
      trades: [],
      dailyPnl: 0,
      totalPnl: 0,
      lastResetDate: new Date().toISOString().split('T')[0],
      execStats: { success: 0, fail: 0, latencies: [] },
      lastProcessedFillTime: 0,
      processedFillOids: []
    }
  }

  saveState() {
    // Async non-blocking save for performance
    setImmediate(() => {
      try {
        fs.mkdirSync(path.dirname(this.stateFile), { recursive: true })
        fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2))
      } catch (e) {
        console.error('Failed to save state:', e)
      }
    })
  }

  getState() {
    return this.state
  }

  getLastProcessedFillTime(): number | null {
    return this.state.lastProcessedFillTime ?? null
  }

  getLastTradeTimestamp(): number | null {
    if (!this.state.trades.length) return null
    const latest = this.state.trades[this.state.trades.length - 1]
    return latest?.ts ?? null
  }

  updatePosition(pair: string, size: number, entryPrice: number, side: 'long' | 'short') {
    if (size === 0) {
      delete this.state.positions[pair]
    } else {
      this.state.positions[pair] = { size, entryPrice, side }
    }
    this.saveState()
  }

  recordTrade(pair: string, side: string, price: number, size: number, pnl?: number) {
    this.state.trades.push({
      ts: Date.now(),
      pair,
      side,
      price,
      size,
      pnl
    })

    // Keep last 1000 trades
    if (this.state.trades.length > 1000) {
      this.state.trades = this.state.trades.slice(-1000)
    }

    if (pnl !== undefined) {
      this.state.dailyPnl += pnl
      this.state.totalPnl += pnl
    }

    this.saveState()
  }

  recordExecution(success: boolean, latencyMs?: number) {
    if (success) {
      this.state.execStats.success++
    } else {
      this.state.execStats.fail++
    }

    if (latencyMs !== undefined) {
      this.state.execStats.latencies.push(latencyMs)
      // Keep last 100 latencies
      if (this.state.execStats.latencies.length > 100) {
        this.state.execStats.latencies = this.state.execStats.latencies.slice(-100)
      }
    }

    this.saveState()
  }

  /**
   * Resetuje lokalny licznik daily PnL, ustawiając anchor
   * na „surowy” PnL z giełdy w momencie resetu.
   */
  resetDailyPnlWithAnchor(rawExchangeDailyPnlUsd: number): void {
    this.state.dailyPnlAnchorUsd = rawExchangeDailyPnlUsd
    this.state.dailyPnl = 0
    const today = new Date().toISOString().split('T')[0]
    this.state.lastResetDate = today
    this.saveState()
  }

  /**
   * Ustawia daily PnL na podstawie surowego PnL z giełdy,
   * odejmując anchor (jeśli istnieje).
   */
  setDailyPnlFromRaw(rawExchangeDailyPnlUsd: number): void {
    const anchor = this.state.dailyPnlAnchorUsd ?? 0
    const effectiveDailyPnl = rawExchangeDailyPnlUsd - anchor
    this.state.dailyPnl = effectiveDailyPnl
    this.saveState()
  }

  resetDailyPnl(rawDailyPnlUsd?: number) {
    const today = new Date().toISOString().split('T')[0]
    if (this.state.lastResetDate !== today) {
      // Set anchor to current raw daily PnL from Hyperliquid (if provided)
      // This allows us to track PnL relative to reset point, not absolute daily PnL
      if (rawDailyPnlUsd !== undefined) {
        this.resetDailyPnlWithAnchor(rawDailyPnlUsd)
      } else {
        // If no raw PnL provided, reset anchor to 0 (will be set on next sync)
        this.state.dailyPnlAnchorUsd = 0
        this.state.dailyPnl = 0
        this.state.lastResetDate = today
        this.saveState()
      }
    }
  }

  /**
   * Sync PnL from Hyperliquid fills - uses exchange's reported closedPnl
   * This is the SOURCE OF TRUTH for PnL tracking
   */
  async syncPnLFromHyperliquid(
    infoClient: hl.InfoClient,
    walletAddress: string,
    onFill?: (pair: string, notionalUsd: number, fillTime: Date) => void
  ): Promise<{ newFills: number, pnlDelta: number }> {
    try {
      // Fetch fills from last 24h using userFillsByTime (userFills returns stale data)
      const startTime = Date.now() - 24 * 60 * 60 * 1000
      const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'userFillsByTime', user: walletAddress, startTime })
      })
      const fills = await response.json() as any[]

      if (!fills || fills.length === 0) {
        return { newFills: 0, pnlDelta: 0 }
      }

      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayStr = today.toISOString().split('T')[0]

      // Initialize processedFillOids if not exists
      if (!this.state.processedFillOids) {
        this.state.processedFillOids = []
      }

      // Calculate raw daily PnL from ALL fills from today (including already processed ones)
      // This is needed to set the anchor correctly after reset
      let rawDailyPnlUsd = 0
      for (const fill of fills) {
        const fillTime = new Date(fill.time)
        if (fillTime >= today) {
          const closedPnl = parseFloat(fill.closedPnl || '0')
          const fee = parseFloat(fill.fee)
          const netPnl = closedPnl + fee
          rawDailyPnlUsd += netPnl
        }
      }

      // Check if reset happened (new day)
      const wasReset = this.state.lastResetDate !== todayStr
      if (wasReset) {
        // Reset happened: set anchor to current raw daily PnL from Hyperliquid
        // This allows us to track PnL relative to reset point, not absolute daily PnL
        this.resetDailyPnlWithAnchor(rawDailyPnlUsd)
        console.log(`[PNL RESET] New day detected. Anchor set to: $${rawDailyPnlUsd.toFixed(2)}`)
      }

      // Initialize anchor if not set (first run or manual reset)
      if (this.state.dailyPnlAnchorUsd === undefined || this.state.dailyPnlAnchorUsd === null) {
        this.state.dailyPnlAnchorUsd = rawDailyPnlUsd
        console.log(`[PNL ANCHOR] Initial anchor set to: $${rawDailyPnlUsd.toFixed(2)}`)
        this.saveState()
      }

      const anchor = this.state.dailyPnlAnchorUsd ?? 0

      let newFills = 0
      let pnlDelta = 0

      // Process fills newest to oldest (only new fills)
      for (const fill of fills) {
        // Skip if already processed
        if (this.state.processedFillOids!.includes(String(fill.oid))) {
          continue
        }

        const fillTime = new Date(fill.time)
        const closedPnl = parseFloat(fill.closedPnl || '0')
        const fee = parseFloat(fill.fee)

        // Net PnL includes fees (fees are negative, so we add them)
        const netPnl = closedPnl + fee  // fee is already negative

        // Add to total PnL
        this.state.totalPnl += netPnl

        // Track daily notional (for daily cap enforcement)
        if (onFill) {
          const fillSize = parseFloat(fill.sz)
          const fillPrice = parseFloat(fill.px)
          const notionalUsd = Math.abs(fillSize * fillPrice)
          onFill(fill.coin, notionalUsd, fillTime)
        }

        pnlDelta += netPnl
        newFills++

        // Mark as processed
        this.state.processedFillOids!.push(String(fill.oid))

        // Record in trades list
        this.state.trades.push({
          ts: fillTime.getTime(),
          pair: fill.coin,
          side: fill.side,
          price: parseFloat(fill.px),
          size: parseFloat(fill.sz),
          pnl: netPnl
        })

        this.state.lastProcessedFillTime = fillTime.getTime()
      }

      // Calculate effective daily PnL: raw from HL minus anchor
      // This gives us PnL relative to reset point, not absolute daily PnL
      this.setDailyPnlFromRaw(rawDailyPnlUsd)
      const effectiveDailyPnl = this.state.dailyPnl

      // Log PnL sync details
      if (newFills > 0 || wasReset) {
        console.log(
          `[PNL SYNC] rawDaily=$${rawDailyPnlUsd.toFixed(2)} anchor=$${anchor.toFixed(2)} ` +
          `effective=$${effectiveDailyPnl.toFixed(2)} newFills=${newFills}`
        )
      }

      // Keep only last 10000 processed OIDs to prevent unlimited growth
      if (this.state.processedFillOids!.length > 10000) {
        this.state.processedFillOids = this.state.processedFillOids!.slice(-10000)
      }

      // Keep last 1000 trades
      if (this.state.trades.length > 1000) {
        this.state.trades = this.state.trades.slice(-1000)
      }

      this.saveState()
      return { newFills, pnlDelta }

    } catch (error) {
      console.error('Error syncing PnL from Hyperliquid:', error)
      return { newFills: 0, pnlDelta: 0 }
    }
  }

  getExecStats() {
    const { success, fail, latencies } = this.state.execStats
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0
    return {
      lastN: success + fail,
      success,
      fail,
      avgLatencyMs: avgLatency
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL PERFORMANCE TRACKER (Weryfikacja jakości sygnałów Nansena)
// ─────────────────────────────────────────────────────────────────────────────

type SignalSnapshot = {
  timestamp: number
  pair: string
  biasAtEntry: number // np. 0.86 (Bullish)
  priceAtEntry: number
  status: 'monitoring' | 'validated_win' | 'validated_loss'
}

class SignalVerifier {
  private snapshots: SignalSnapshot[] = []
  private confidenceScores: Map<string, number> = new Map() // Pair -> Score (0.0 - 1.0)
  private readonly VERIFICATION_WINDOW_MS = 4 * 60 * 60 * 1000 // 4 godziny na sprawdzenie
  private readonly MIN_CONFIDENCE = 0.2
  private readonly MAX_CONFIDENCE = 1.0

  constructor() {
    // Domyślne zaufanie startowe 50%
    this.confidenceScores.set('DEFAULT', 0.5)
  }

  /**
   * Rejestruje nowy silny sygnał do sprawdzenia
   */
  trackSignal(pair: string, bias: number, price: number) {
    // Rejestrujemy tylko silne sygnały (> 0.5 lub < -0.5) i unikamy duplikatów w krótkim czasie
    if (Math.abs(bias) < 0.5) return

    const existing = this.snapshots.find(s => s.pair === pair && s.status === 'monitoring')
    if (existing && Date.now() - existing.timestamp < 60 * 60 * 1000) return // Nie spamujemy snapshotami co chwila

    this.snapshots.push({
      timestamp: Date.now(),
      pair,
      biasAtEntry: bias,
      priceAtEntry: price,
      status: 'monitoring'
    })
    console.log(`🕵️ [VERIFIER] Tracking new signal for ${pair}: Bias ${bias.toFixed(2)} @ ${price}`)
  }

  /**
   * Sprawdza historyczne sygnały i aktualizuje wynik zaufania
   */
  updatePerformance(pair: string, currentPrice: number) {
    const now = Date.now()
    let changed = false

    for (const snap of this.snapshots) {
      if (snap.pair !== pair || snap.status !== 'monitoring') continue

      // Sprawdzamy po upływie okna czasowego (np. 1h minimalnie, max 4h)
      if (now - snap.timestamp > this.VERIFICATION_WINDOW_MS) {
        // Logika weryfikacji:
        // Jeśli Bias był Bullish (>0), a cena wzrosła -> WIN
        // Jeśli Bias był Bearish (<0), a cena spadła -> WIN
        const priceChangePct = (currentPrice - snap.priceAtEntry) / snap.priceAtEntry
        const isWin = (snap.biasAtEntry > 0 && priceChangePct > 0.005) || // +0.5% profit
          (snap.biasAtEntry < 0 && priceChangePct < -0.005)   // +0.5% profit (na short)

        snap.status = isWin ? 'validated_win' : 'validated_loss'
        this.updateScore(pair, isWin)
        changed = true

        console.log(`🕵️ [VERIFIER] Result for ${pair}: ${isWin ? '✅ WIN' : '❌ LOSS'} (Bias: ${snap.biasAtEntry}, Delta: ${(priceChangePct * 100).toFixed(2)}%)`)
      }
    }

    // Cleanup starych snapshotów
    if (this.snapshots.length > 100) {
      this.snapshots = this.snapshots.filter(s => now - s.timestamp < this.VERIFICATION_WINDOW_MS * 2)
    }
  }

  private updateScore(pair: string, isWin: boolean) {
    let score = this.confidenceScores.get(pair) ?? 0.5
    // Jeśli WIN -> Zwiększamy zaufanie o 10%
    // Jeśli LOSS -> Zmniejszamy zaufanie o 20% (szybciej tracimy zaufanie niż zyskujemy)
    if (isWin) {
      score = Math.min(this.MAX_CONFIDENCE, score + 0.1)
    } else {
      score = Math.max(this.MIN_CONFIDENCE, score - 0.2)
    }
    this.confidenceScores.set(pair, score)
  }

  getConfidence(pair: string): number {
    return this.confidenceScores.get(pair) ?? 0.5
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PAPER TRADING - Simulates order execution
// ─────────────────────────────────────────────────────────────────────────────

class PaperTrading implements TradingInterface {
  private makerFeeBps = 1.5  // 0.015% maker fee
  private takerFeeBps = 4.5  // 0.045% taker fee

  async placeOrder(
    pair: string,
    side: 'buy' | 'sell',
    price: number,
    sizeUsd: number,
    orderType: 'limit' | 'market' = 'limit'
  ): Promise<{ success: boolean; fillPrice?: number; fee?: number }> {
    // Simulate realistic fill probability
    const fillProb = orderType === 'market' ? 0.95 : 0.7

    if (Math.random() > fillProb) {
      return { success: false }
    }

    // Simulate slippage for market orders
    let fillPrice = price
    if (orderType === 'market') {
      const slippageBps = Math.random() * 10 // 0-10 bps slippage
      fillPrice = side === 'buy'
        ? price * (1 + slippageBps / 10000)
        : price * (1 - slippageBps / 10000)
    }

    // Calculate fees
    const feeBps = orderType === 'limit' ? this.makerFeeBps : this.takerFeeBps
    const fee = sizeUsd * feeBps / 10000

    return { success: true, fillPrice, fee }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    return Math.random() > 0.05 // 95% cancel success rate
  }

  async cancelPairOrders(pair: string): Promise<void> {
    // Paper trading: no-op, orders are simulated
    return
  }

  async getPosition(pair: string): Promise<{ size: number; entryPrice: number } | null> {
    // Will be managed by StateManager
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE TRADING - Real Hyperliquid SDK integration
// ─────────────────────────────────────────────────────────────────────────────

interface TradingInterface {
  placeOrder(
    pair: string,
    side: 'buy' | 'sell',
    price: number,
    sizeUsd: number,
    orderType: 'limit' | 'market',
    reduceOnly?: boolean
  ): Promise<{ success: boolean; fillPrice?: number; fee?: number }>
  cancelOrder(orderId: string): Promise<boolean>
  getPosition(pair: string): Promise<{ size: number; entryPrice: number } | null>
  cancelPairOrders(pair: string): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTITUTIONAL ORDER SIZE NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

type NormalizeOrderSizeParams = {
  coin: string
  price: number
  sizeCoins: number
  coinStep: number
  layerTargetUsd?: number   // target z grida (jeśli masz pod ręką)
}

type NormalizeOrderSizeResult = {
  sizeCoins: number
  notional: number
  reason?: string
}

function normalizeOrderSizeInstitutional(params: NormalizeOrderSizeParams): NormalizeOrderSizeResult {
  const { coin, price, coinStep } = params
  let { sizeCoins } = params

  if (price <= 0 || sizeCoins <= 0 || coinStep <= 0) {
    return {
      sizeCoins: 0,
      notional: 0,
      reason: "[SANITY] invalid px/size/step"
    }
  }

  const cfg = INSTITUTIONAL_SIZE_CONFIG[coin] ?? {
    minUsd: 10,
    targetUsd: 12,
    maxUsd: 40
  }

  let targetUsd = cfg.targetUsd

  if (params.layerTargetUsd && params.layerTargetUsd > 0) {
    // niech layer wpływa, ale niech nie zaniża nam targetu poniżej minUsd
    targetUsd = Math.max(cfg.minUsd, Math.min(params.layerTargetUsd, cfg.maxUsd))
  }

  const maxUsd = cfg.maxUsd
  const maxUsdAbs = cfg.maxUsdAbs ?? maxUsd * 3

  // 1) bazowy notional
  let notional = price * sizeCoins

  // 2) clamp do minUsd
  if (notional < cfg.minUsd) {
    const newSize = cfg.minUsd / price
    sizeCoins = Math.max(coinStep, Math.round(newSize / coinStep) * coinStep)
    notional = price * sizeCoins
    return {
      sizeCoins,
      notional,
      reason: "[SANITY_MIN] bumped to minUsd"
    }
  }

  // 3) clamp do targetUsd * 2 (miękki) i maxUsd (twardy)
  const softCap = targetUsd * 2
  let capUsd = Math.min(maxUsd, softCap)

  if (notional > capUsd) {
    const newSize = capUsd / price
    sizeCoins = Math.max(coinStep, Math.round(newSize / coinStep) * coinStep)
    notional = price * sizeCoins
    return {
      sizeCoins,
      notional,
      reason: "[SANITY_MAX] clipped to capUsd"
    }
  }

  // 4) absolutny maksymalny notional na wszelki wypadek (np. flash spike)
  if (notional > maxUsdAbs) {
    const newSize = maxUsdAbs / price
    sizeCoins = Math.max(coinStep, Math.round(newSize / coinStep) * coinStep)
    notional = price * sizeCoins
    return {
      sizeCoins,
      notional,
      reason: "[SANITY_ABS] clipped to maxUsdAbs"
    }
  }

  // 5) dopasowanie do stepu bez zmiany logiki
  const steppedSize = Math.max(coinStep, Math.round(sizeCoins / coinStep) * coinStep)
  notional = price * steppedSize

  return {
    sizeCoins: steppedSize,
    notional,
    reason: undefined
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY GUARD (max position per coin)
// ─────────────────────────────────────────────────────────────────────────────

type InventoryCheckParams = {
  coin: string
  side: "buy" | "sell"  // buy = long, sell = short
  sizeCoins: number
  currentPosSz: number  // dodatnie = long, ujemne = short
  price?: number        // opcjonalnie aktualna cena dla limitów USD
}

function isInventoryAllowed(params: InventoryCheckParams): {
  allowed: boolean
  projectedPos: number
  reason?: string
} {
  const { coin, side, sizeCoins, currentPosSz, price } = params
  let maxInv = MAX_INVENTORY_COINS[coin]

  if ((!maxInv || maxInv <= 0) && price && price > 0) {
    const usdCap = MAX_INVENTORY_USD[coin]
    if (usdCap && usdCap > 0) {
      maxInv = usdCap / price
    }
  }

  // jeśli nie skonfigurowano – nie ograniczamy
  if (!maxInv || maxInv <= 0) {
    return { allowed: true, projectedPos: currentPosSz }
  }

  const delta = side === "buy" ? sizeCoins : -sizeCoins
  const projected = currentPosSz + delta
  const crossesLimit = Math.abs(projected) > maxInv + EPS
  const increasesExposure = Math.abs(projected) > Math.abs(currentPosSz) + EPS

  if (crossesLimit && increasesExposure) {
    return {
      allowed: false,
      projectedPos: projected,
      reason: "[INVENTORY_GUARD] order would increase exposure beyond limit"
    }
  }

  return {
    allowed: true,
    projectedPos: projected
  }
}

class LiveTrading implements TradingInterface {
  private exchClient: hl.ExchangeClient
  private infoClient: hl.InfoClient
  private api: HyperliquidAPI
  private assetMap: Map<string, number> = new Map()
  private assetDecimals: Map<string, number> = new Map()
  private walletAddress: string
  private makerFeeBps = 1.5  // 0.015% maker fee
  private takerFeeBps = 4.5  // 0.045% taker fee
  private enablePostOnly: boolean = false  // Post-only (ALO) orders
  private cloidCounter: number = Date.now()  // Client Order ID counter
  private orderCloidMap: Map<string, string> = new Map()  // Maps cloid -> oid
  private deadManSwitchActive: boolean = false  // Dead Man's Switch status
  private orderHistory: OrderHistoryEntry[] = []  // Complete order history with cloid
  private chaseConfig: ChaseConfig | null = null  // Institutional chase mode configuration

  // Tier 2/3: Advanced trackers
  private volatilityTracker: Map<string, VolatilityTracker> = new Map()
  private throttleTracker: ThrottleTracker = new ThrottleTracker()
  private lastFillPrice: Map<string, number> = new Map()  // Track last fill for price bands

  // WebSocket & Rate Limit
  private websocket: HyperliquidWebSocket | null = null
  private rateLimitReserver: RateLimitReserver | null = null
  public l2BookCache: Map<string, L2BookUpdate> = new Map()  // Cache latest L2 book data (exposed for bot-level analytics)

  // Quantization telemetry per asset/side (rolling counters)
  private quantTelemetry: Map<string, {
    submit_ok: number
    tick_err: number
    size_err: number
    alo_reject: number
    sol_fallback_used: number
    sol_fallback_success: number
    recent_submits: Array<{ timestamp: number; tick_err: boolean }> // Last 30 submits for auto-suppression
  }> = new Map()

  // SOL discrepancy tracking (for backoff)
  private solTickDiscrepancies: Array<{ timestamp: number; side: string; ticks: number }> = []
  private solSuppressedUntil: number = 0
  private solSuppressionLoggedAt: number = 0

  // Precomputed minNotionalInt cache per asset (refresh on spec updates)
  private minNotionalIntCache: Map<string, {
    minNotionalInt: number
    stepMultiplier: number
    tickMultiplier: number
    updatedAt: number
  }> = new Map()

  // Spec refresh timestamps (refresh every 5 min or on tick error)
  private specRefreshTimestamps: Map<string, number> = new Map()

  // SOL fallback & suppression toggles (from env)
  private solTickFallbackEnabled: boolean
  private solSuppressWindowSec: number
  private solSuppressThreshold: number
  private specsRefreshSec: number

  // 🛡️ TOXIC FLOW PROTECTION MODULES
  public vpinAnalyzers: Map<string, VPINAnalyzer> = new Map()
  public adverseTracker: AdverseSelectionTracker = new AdverseSelectionTracker()
  public binanceAnchor: BinancePriceAnchor = new BinancePriceAnchor(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'HYPEUSDT', 'AAVEUSDT', 'AVAXUSDT'])
  public whaleIntel: WhaleIntelligence = new WhaleIntelligence()
  public fundingArb: FundingArbitrage = new FundingArbitrage()
  public liqShield: LiquidationShield = new LiquidationShield()

  // 🔮 SMART MONEY SHADOW TRADING MODULE
  public shadowTrading: ShadowTradingIntegration = new ShadowTradingIntegration()
  private shadowAlert: ShadowAlertIntegration | null = null
  private shadowTradePollInterval?: ReturnType<typeof setInterval>
  private shadowConsensusInterval?: ReturnType<typeof setInterval>
  private shadowLastTradeTimestamp = 0
  private shadowFeedUrl?: string

  // Per-process sequence counter for disambiguating concurrent attempts
  private seq: number = 0

  // Daily notional tracking (per coin, per day)
  private dailyNotionalByPair: Map<string, number> = new Map()
  private dailyNotionalDay: string | null = null

  /**
   * 🛡️ MODULE 3: Deadzone Check (API Economy)
   * Prevents spamming exchange with micro-updates (< 2bps change).
   */
  private shouldUpdateQuote(newPrice: number, oldPrice: number | undefined): boolean {
    if (!oldPrice) return true;
    const diffBps = Math.abs(newPrice - oldPrice) / oldPrice * 10000;
    return diffBps >= 2.0; // 2bps deadzone
  }

  constructor(privateKey: string, api: HyperliquidAPI, chaseConfig: ChaseConfig | null = null) {
    if (!privateKey) {
      throw new Error('Private key required for live trading')
    }

    this.chaseConfig = chaseConfig
    this.api = api

    // Initialize clients
    this.exchClient = new hl.ExchangeClient({
      wallet: privateKey,
      transport: new hl.HttpTransport()
    })

    this.infoClient = new hl.InfoClient({
      transport: new hl.HttpTransport()
    })

    // Derive wallet address from private key
    this.walletAddress = this.deriveAddress(privateKey)

    // Read post-only setting from environment
    this.enablePostOnly = process.env.ENABLE_POST_ONLY === 'true'

    // Read SOL fallback & suppression toggles from environment
    this.solTickFallbackEnabled = (process.env.SOL_TICK_FALLBACK || 'on') === 'on'
    this.solSuppressWindowSec = parseInt(process.env.SOL_SUPPRESS_WINDOW_SEC || '60', 10)
    this.solSuppressThreshold = parseInt(process.env.SOL_SUPPRESS_THRESHOLD || '10', 10)
    this.specsRefreshSec = parseInt(process.env.SPECS_REFRESH_SEC || '300', 10)

    console.log(`🔧 SOL controls: fallback=${this.solTickFallbackEnabled} window=${this.solSuppressWindowSec}s threshold=${this.solSuppressThreshold}`)
    console.log(`🔧 Spec refresh: ${this.specsRefreshSec}s TTL`)

    const build = process.env.BUILD_ID || process.env.GIT_COMMIT || 'dev'
    console.log(`🔧 Build=${build}`)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DAILY NOTIONAL TRACKING
  // ─────────────────────────────────────────────────────────────────────────────

  private getDayKey(date: Date): string {
    return date.toISOString().slice(0, 10) // "YYYY-MM-DD"
  }

  private resetDailyNotionalIfNeeded(now: Date): void {
    const dayKey = this.getDayKey(now)
    if (this.dailyNotionalDay !== dayKey) {
      this.dailyNotionalDay = dayKey
      this.dailyNotionalByPair.clear()
      console.log(`[RISK] Reset daily notional counters for new day ${dayKey}`)
    }
  }

  addDailyNotional(pair: string, notionalUsd: number, now: Date = new Date()): void {
    this.resetDailyNotionalIfNeeded(now)
    const prev = this.dailyNotionalByPair.get(pair) ?? 0
    const next = prev + Math.max(0, notionalUsd)
    this.dailyNotionalByPair.set(pair, next)
  }

  getDailyNotional(pair: string, now: Date = new Date()): number {
    this.resetDailyNotionalIfNeeded(now)
    return this.dailyNotionalByPair.get(pair) ?? 0
  }

  private deriveAddress(privateKey: string): string {
    // For simplicity, we'll use ethers to derive the address
    // In production, you might want to use the SDK's built-in method
    try {
      const wallet = new ethers.Wallet(privateKey)
      return wallet.address
    } catch (e) {
      throw new Error(`Failed to derive address from private key: ${e}`)
    }
  }

  /**
   * Generate unique client order ID (cloid)
   * Returns 128-bit hex string
   */
  private generateCloid(): string {
    this.cloidCounter++
    const timestamp = Date.now()
    const counter = this.cloidCounter
    // Create 128-bit hex string (32 characters)
    return `0x${timestamp.toString(16).padStart(16, '0')}${counter.toString(16).padStart(16, '0')}`
  }

  /**
   * Track quantization telemetry for asset/side
   */
  private trackQuant(pair: string, side: string, event: 'submit_ok' | 'tick_err' | 'size_err' | 'alo_reject' | 'sol_fallback_used' | 'sol_fallback_success') {
    const key = `${pair}_${side}`
    if (!this.quantTelemetry.has(key)) {
      this.quantTelemetry.set(key, {
        submit_ok: 0,
        tick_err: 0,
        size_err: 0,
        alo_reject: 0,
        sol_fallback_used: 0,
        sol_fallback_success: 0,
        recent_submits: []
      })
    }
    const stats = this.quantTelemetry.get(key)!
    stats[event]++

    // Track recent submits for auto-suppression (last 30 only)
    if (event === 'submit_ok' || event === 'tick_err') {
      stats.recent_submits.push({
        timestamp: Date.now(),
        tick_err: event === 'tick_err'
      })
      // Keep only last 30
      if (stats.recent_submits.length > 30) {
        stats.recent_submits.shift()
      }
    }
  }

  /**
   * Log telemetry summary (called every N orders)
   */
  private logQuantTelemetry() {
    const totalSubmits = Array.from(this.quantTelemetry.values()).reduce((sum, s) => sum + s.submit_ok + s.tick_err + s.size_err, 0)
    if (totalSubmits === 0) return

    console.log(`\n📊 QUANT TELEMETRY (last ${totalSubmits} orders):`)
    for (const [key, stats] of this.quantTelemetry.entries()) {
      const total = stats.submit_ok + stats.tick_err + stats.size_err
      if (total === 0) continue

      const successRate = ((stats.submit_ok / total) * 100).toFixed(1)
      const tickErrRate = ((stats.tick_err / total) * 100).toFixed(1)
      const fallbackRate = stats.sol_fallback_used > 0 ? ((stats.sol_fallback_success / stats.sol_fallback_used) * 100).toFixed(1) : '0.0'

      console.log(`  ${key}: ${successRate}% ok | ${tickErrRate}% tick_err | fallback: ${stats.sol_fallback_used}/${stats.sol_fallback_success} (${fallbackRate}%)`)
    }
  }

  /**
   * Track SOL tick discrepancy and check if should suppress
   */
  private trackSolDiscrepancy(side: string, ticks: number): void {
    const now = Date.now()
    this.solTickDiscrepancies.push({ timestamp: now, side, ticks })

    // Keep only last N seconds (configurable)
    const windowMs = this.solSuppressWindowSec * 1000
    this.solTickDiscrepancies = this.solTickDiscrepancies.filter(d => d.timestamp > now - windowMs)

    // If > threshold discrepancies in window, suppress SOL for window duration
    if (this.solTickDiscrepancies.length > this.solSuppressThreshold && this.solSuppressedUntil < now) {
      this.solSuppressedUntil = now + windowMs
      console.warn(`⚠️  SOL suppressed for ${this.solSuppressWindowSec}s due to ${this.solTickDiscrepancies.length} tick discrepancies`)
    }
  }

  /**
   * Check if SOL is currently suppressed
   */
  private isSolSuppressed(): boolean {
    return Date.now() < this.solSuppressedUntil
  }

  /**
   * Check if SOL should be auto-suppressed (3+ tick errors in last 30 submits per side)
   */
  private checkSolAutoSuppression(pair: string, side: string): boolean {
    if (pair !== 'SOL') return false

    const key = `${pair}_${side}`
    const stats = this.quantTelemetry.get(key)
    if (!stats || stats.recent_submits.length < 10) return false // Need at least 10 samples

    // Count tick errors in recent submits
    const tickErrors = stats.recent_submits.filter(s => s.tick_err).length

    // If 3+ tick errors in last 30 submits, suppress for 60s
    if (tickErrors >= 3 && this.solSuppressedUntil < Date.now()) {
      this.solSuppressedUntil = Date.now() + 60000

      // Log once when entering suppression
      if (this.solSuppressionLoggedAt < Date.now() - 60000) {
        console.warn(`🔴 sol_suppressed_60s pair=SOL side=${side} tick_err_count=${tickErrors}/30 entering`)
        this.solSuppressionLoggedAt = Date.now()
      }

      return true
    }

    // Log once when exiting suppression
    if (this.solSuppressedUntil > 0 && Date.now() >= this.solSuppressedUntil && this.solSuppressionLoggedAt > 0) {
      console.log(`✅ sol_suppressed_60s pair=SOL side=${side} exiting`)
      this.solSuppressionLoggedAt = 0
    }

    return false
  }

  /**
   * Check if specs should be refreshed (configurable TTL or on first tick error)
   */
  private shouldRefreshSpecs(pair: string): boolean {
    const lastRefresh = this.specRefreshTimestamps.get(pair) || 0
    const now = Date.now()
    const refreshIntervalMs = this.specsRefreshSec * 1000
    return now - lastRefresh > refreshIntervalMs
  }

  /**
   * Refresh specs and precompute minNotionalInt for a pair
   */
  private refreshSpecsAndCache(pair: string): void {
    const specs = getInstrumentSpecs(pair)
    const tickSize = specs.tickSize
    const lotSize = specs.lotSize
    const pxDec = getPriceDecimals(tickSize)
    const stepDec = getSizeDecimals(lotSize)

    const stepMultiplier = Math.pow(10, stepDec)
    const tickMultiplier = Math.pow(10, pxDec)
    const minNotionalInt = Math.round(specs.minNotional * stepMultiplier * tickMultiplier)

    this.minNotionalIntCache.set(pair, {
      minNotionalInt,
      stepMultiplier,
      tickMultiplier,
      updatedAt: Date.now()
    })

    this.specRefreshTimestamps.set(pair, Date.now())
  }

  /**
   * Get cached minNotionalInt or compute on-demand
   */
  private getMinNotionalInt(pair: string): { minNotionalInt: number; stepMultiplier: number; tickMultiplier: number } {
    let cached = this.minNotionalIntCache.get(pair)

    // Refresh if stale (>5 min) or missing
    if (!cached || this.shouldRefreshSpecs(pair)) {
      this.refreshSpecsAndCache(pair)
      cached = this.minNotionalIntCache.get(pair)!
    }

    return cached
  }

  /**
   * Calculate appropriate price decimals based on price magnitude
   * This ensures prices are rounded to valid tick sizes
   */
  private getPriceDecimals(price: number): number {
    if (price >= 10000) return 1;      // BTC-like: $100k -> 1 decimal
    if (price >= 1000) return 2;       // BTC-like: $10k -> 2 decimals
    if (price >= 100) return 2;        // ETH-like: $100+ -> 2 decimals
    if (price >= 10) return 3;         // Mid-range: $10+ -> 3 decimals
    if (price >= 1) return 4;          // Low: $1+ -> 4 decimals
    if (price >= 0.1) return 5;        // Very low: $0.1+ -> 5 decimals
    return 6;                          // Ultra low: <$0.1 -> 6 decimals
  }

  /**
   * Round order size to szDecimals precision using floor rounding
   * Formula: Math.floor(size * 10^szDecimals + epsilon) / 10^szDecimals
   * This prevents 422 errors from Hyperliquid API
   *
   * The epsilon (1e-9) compensates for floating point precision errors
   * Example: 225.9 * 10 might give 2258.9999999999 instead of 2259.0
   */
  private roundToSzDecimals(size: number, szDecimals: number): number {
    if (szDecimals === 0) {
      return Math.floor(size + 1e-9)
    }
    const multiplier = Math.pow(10, szDecimals)
    const EPSILON = 1e-9
    return Math.floor(size * multiplier + EPSILON) / multiplier
  }

  /**
   * Set leverage for a specific asset
   * @param pair - The trading pair (e.g., "BTC", "ETH")
   * @param leverage - Leverage value (1 for no leverage, 2 for 2x, etc.)
   */
  async setLeverage(pair: string, leverage: number = 1): Promise<void> {
    try {
      const assetIndex = this.assetMap.get(pair)
      if (assetIndex === undefined) {
        console.log(`Asset ${pair} not found in mapping, skipping leverage set`)
        return
      }

      await this.exchClient.updateLeverage({
        asset: assetIndex,
        isCross: true,  // Use cross margin (shares margin across positions)
        leverage: leverage
      })

      console.log(`✅ Set ${pair} leverage to ${leverage}x`)
    } catch (error) {
      console.error(`Failed to set leverage for ${pair}: ${error}`)
      throw error
    }
  }

  async initialize(): Promise<void> {
    // Fetch asset mapping
    const [meta] = await this.api.getMetaAndAssetCtxs()

    meta.universe.forEach((market, index) => {
      this.assetMap.set(market.name, index)
      this.assetDecimals.set(market.name, market.szDecimals)
    })

    console.log(`LiveTrading initialized: ${this.assetMap.size} assets mapped`)

    // Initialize WebSocket for real-time data
    const enableWebSocket = process.env.ENABLE_WEBSOCKET === 'true'
    if (enableWebSocket) {
      try {
        this.websocket = new HyperliquidWebSocket()
        await this.websocket.connect()
        console.log('✅ WebSocket connected for real-time data')

        // 🛡️ ADVERSE SELECTION: Listen to our own fills
        if (this.walletAddress) {
          this.websocket.subscribeUserFills(this.walletAddress, (fills: any[]) => {
            fills.forEach(f => {
              this.adverseTracker.recordFill({
                id: f.oid.toString(),
                symbol: f.coin,
                side: f.side === 'B' ? 'buy' : 'sell',
                price: Number(f.px),
                size: Number(f.sz),
                midPriceAtFill: Number(f.px), // Simplified
                timestamp: Date.now()
              });
            });
          });
        }
      } catch (error) {
        console.error('❌ Failed to connect WebSocket:', error)
      }
    }

    // Initialize Rate Limit Reserver
    const enableRateReserve = process.env.ENABLE_RATE_RESERVE === 'true'
    if (enableRateReserve) {
      this.rateLimitReserver = new RateLimitReserver(this.exchClient, true)
      console.log('✅ Rate limit reservation enabled')
    }

    // 🛡️ TIER 0: Binance Price Anchor
    try {
      await this.binanceAnchor.connect()
    } catch (e) {
      console.error('⚠️ Binance Anchor failed to connect, but continuing...')
    }
  }

  /**
   * Subscribe to L2 book updates for trading pairs
   */
  subscribeToL2Books(pairs: string[]): void {
    if (!this.websocket || !this.websocket.isConnected()) {
      return
    }

    for (const pair of pairs) {
      // Check if already subscribed (avoid duplicate subscriptions)
      if (!this.l2BookCache.has(pair)) {
        this.websocket.subscribeL2Book(pair, (data: L2BookUpdate) => {
          // Cache the latest L2 book data
          this.l2BookCache.set(pair, data)
        })

        // 🧪 VPIN: Subscribe to all trades for this pair
        this.websocket.subscribeTrades(pair, (trade: any) => {
          if (!this.vpinAnalyzers.has(pair)) {
            this.vpinAnalyzers.set(pair, new VPINAnalyzer());
          }
          this.vpinAnalyzers.get(pair)!.addTrade(Number(trade.px), Number(trade.sz), trade.side === 'B' ? 'buy' : 'sell');
        });

        console.log(`📊 Subscribed to L2 book & Trades: ${pair}`)
      }
    }
  }

  /**
   * Check rate limit usage and auto-reserve if needed
   */
  async checkAndReserveRateLimit(): Promise<void> {
    if (!this.rateLimitReserver) {
      return
    }

    // Estimate current rate limit usage based on recent order activity
    // Hyperliquid has a base limit of ~1200 requests/min
    const recentOrders = this.orderHistory.filter(
      o => Date.now() - o.timestamp < 60000
    )
    const currentUsage = recentOrders.length / 1200

    // Auto-reserve if usage is high (80% threshold)
    await this.rateLimitReserver.autoReserve(currentUsage, 0.8)
  }

  /**
   * Normalizuje rozmiar orderu:
   *  - zaokrągla do najbliższego kroku (coinStep)
   *  - MAX clamp: jeśli notional > 2× targetUsd → skaluje w dół (dla ZEC: 1.00 → 0.01)
   *  - MIN clamp: jeśli notional < minUsd → skaluje w górę (dla UNI: $7 → $12)
   *
   * Zwraca:
   *  - szCoin  – finalny rozmiar w COINACH (np. 0.01 ZEC)
   *  - notional – wartość w USDC (szCoin * px)
   */
  private normalizeOrderSize(
    coin: string,
    rawSzCoin: number,
    px: number,
    coinStep: number,
    targetUsd: number,
    minUsd: number = 0
  ): { szCoin: number; notional: number } {
    if (rawSzCoin <= 0 || !isFinite(rawSzCoin) || !isFinite(px)) {
      console.warn(
        `[SANITY] ${coin} got invalid rawSzCoin=${rawSzCoin}, px=${px} – forcing sz=0`
      );
      return { szCoin: 0, notional: 0 };
    }

    // Zaokrąglenie do najbliższego kroku
    const steps = Math.round(rawSzCoin / coinStep);
    let szCoin = steps * coinStep;
    let notional = szCoin * px;

    if (!isFinite(notional)) {
      console.warn(
        `[SANITY] ${coin} invalid notional after rounding: rawSz=${rawSzCoin}, ` +
        `coinStep=${coinStep}, steps=${steps}, px=${px}`
      );
      return { szCoin: 0, notional: 0 };
    }

    // MAX clamp: nie pozwalamy, żeby notional był >> targetUsd (dla ZEC: 1.00 → 0.01)
    if (targetUsd > 0 && notional > targetUsd * 2) {
      const factor = targetUsd / notional;
      const adjustedSteps = Math.max(1, Math.floor(steps * factor));
      const newSzCoin = adjustedSteps * coinStep;
      const newNotional = newSzCoin * px;

      console.warn(
        `[SANITY MAX] ${coin} rawSz=${rawSzCoin.toFixed(6)} coinStep=${coinStep} ` +
        `steps=${steps} notional=${notional.toFixed(2)} > 2×target=${(targetUsd * 2).toFixed(2)} ` +
        `→ clamp sz=${newSzCoin.toFixed(6)} notional=${newNotional.toFixed(2)}`
      );

      szCoin = newSzCoin;
      notional = newNotional;
    }

    // MIN clamp: podbijamy rozmiar, jeśli notional < minUsd (dla UNI: $7 → $12)
    if (minUsd > 0 && notional + 1e-9 < minUsd) {
      const minSzCoin = minUsd / px;
      const minSteps = Math.ceil(minSzCoin / coinStep);
      const newSzCoin = minSteps * coinStep;
      const newNotional = newSzCoin * px;

      console.warn(
        `[SANITY MIN] ${coin} rawSz=${rawSzCoin.toFixed(6)} coinStep=${coinStep} ` +
        `steps=${steps} notional=${notional.toFixed(2)} < min=${minUsd.toFixed(2)} ` +
        `→ clamp sz=${newSzCoin.toFixed(6)} notional=${newNotional.toFixed(2)}`
      );

      szCoin = newSzCoin;
      notional = newNotional;
    }

    return { szCoin, notional };
  }

  // ZEC defensive guards helper
  private applyZecDefensiveGuards(ctx: {
    side: string
    roundedPrice: number
    currentPosSz: number
    cetHour: number
  }): boolean {
    return true
  }

  async placeOrder(
    pair: string,
    side: 'buy' | 'sell',
    price: number,
    sizeUsd: number,
    orderType: 'limit' | 'market' = 'limit',
    reduceOnly: boolean = false
  ): Promise<{ success: boolean; fillPrice?: number; fee?: number }> {
    try {
      const now = new Date()
      let reduceOnlyLocal = reduceOnly
      let cetHourZec: number | null = null

      if (pair === 'ZEC') {
        const cetHour = getCETHour(now)
        cetHourZec = cetHour
        // ZEC schedule disabled permanently
        /*
        const offStart = Number(process.env.ZEC_OFF_HOUR_START ?? '0')
        const offEnd = Number(process.env.ZEC_OFF_HOUR_END ?? '7')

        let inOffWindow = false
        if (Number.isFinite(offStart) && Number.isFinite(offEnd) && offStart !== offEnd) {
          if (offStart < offEnd) {
            inOffWindow = cetHour >= offStart && cetHour <= offEnd
          } else {
            inOffWindow = cetHour >= offStart || cetHour <= offEnd
          }
        }

        if (inOffWindow) {
          console.warn(
            `[ZEC_SCHEDULE] Skip ${pair} ${side} at CET hour=${cetHour} (off-window ${offStart}-${offEnd})`
          )
          return { success: false }
        }
        */
      }

      // ═════════════════════════════════════════════════════════════════════
      // DAILY NOTIONAL CAP CHECK (early exit)
      // ═════════════════════════════════════════════════════════════════════
      const capUsd = getDailyNotionalCapUsd(pair)
      const usedUsd = this.getDailyNotional(pair, now)

      if (usedUsd >= capUsd) {
        console.warn(
          `[NOTIONAL_CAP] (SOFT) pair=${pair} side=${side} used=${usedUsd.toFixed(2)} cap=${capUsd.toFixed(
            2
          )} → logging only, NOT blocking`
        )
      }

      // Early return if SOL is temporarily suppressed
      if (pair === 'SOL' && this.isSolSuppressed()) {
        console.log(`⏸️  SOL order skipped (suppressed until ${new Date(this.solSuppressedUntil).toLocaleTimeString()})`)
        return { success: false }
      }
      // Get asset index and decimals
      const assetIndex = this.assetMap.get(pair)
      if (assetIndex === undefined) {
        throw new Error(`Asset ${pair} not found in mapping`)
      }

      // Get instrument specs for proper tick/lot alignment
      const specs = getInstrumentSpecs(pair)

      // Round price to valid tick size (institutional-grade rounding)
      let roundedPrice = roundToTick(price, specs.tickSize)

      // 🛡️ MODULE 3: Deadzone Check (API Economy)
      // If we already have an order near this price, skip update to save rate limits
      const lastPrice = this.lastFillPrice.get(pair);
      if (!reduceOnlyLocal && !this.shouldUpdateQuote(roundedPrice, lastPrice)) {
        return { success: false };
      }
      this.lastFillPrice.set(pair, roundedPrice);

      // ═════════════════════════════════════════════════════════════════════
      // TIER 2: Volatility Detection
      // ═════════════════════════════════════════════════════════════════════
      if (this.chaseConfig) {
        // Get or create volatility tracker for this pair
        if (!this.volatilityTracker.has(pair)) {
          this.volatilityTracker.set(pair, new VolatilityTracker())
        }
        const volTracker = this.volatilityTracker.get(pair)!

        // Add current price to tracker
        volTracker.addPrice(price)

        // Check if volatile
        const rv = volTracker.getRealizedVolatility(this.chaseConfig.volatility.rvWindowMs)
        const isVolatile = rv > this.chaseConfig.volatility.sigmaFastThreshold

        if (isVolatile) {
          console.log(`⚡ ${pair} volatile (σ=${rv.toFixed(4)}), widening spread by ${this.chaseConfig.volatility.spreadWidenTicks} ticks`)
          // Adjust offset based on volatility
          const offsetAdjustment = this.chaseConfig.volatility.spreadWidenTicks * specs.tickSize
          if (side === 'buy') {
            roundedPrice -= offsetAdjustment  // Buy lower when volatile
          } else {
            roundedPrice += offsetAdjustment  // Sell higher when volatile
          }
          roundedPrice = roundToTick(roundedPrice, specs.tickSize)
        }
      }

      // Convert USD size to coins
      let sizeInCoins = sizeUsd / roundedPrice

      // Use szDecimals from API metadata (fetched during initialize())
      // Fall back to price-based guess only if metadata is unavailable
      const mapValue = this.assetDecimals.get(pair)
      const sizeDecimals = (mapValue !== undefined) ? mapValue : guessSzDecimals(roundedPrice)

      // Exact quantization to szDecimals (floor)
      const decStep = Math.pow(10, -sizeDecimals)
      sizeInCoins = quantizeFloor(sizeInCoins, decStep)

      // Compute coin step (lot vs decimals)
      const coinStep = Math.max(specs.lotSize > 0 ? specs.lotSize : 0, decStep)

      // Enforce min coin based on lot grid (for tiny-price assets like PUMP)
      if (sizeInCoins + 1e-12 < coinStep) {
        sizeInCoins = quantizeCeil(coinStep, coinStep)
      }

      // Ensure price is exactly on tick (round to tick first, then fix decimals)
      roundedPrice = roundToTick(roundedPrice, specs.tickSize)
      let pxDec = priceDecimalsFromTick(specs.tickSize) // Will be updated by quantResult below
      roundedPrice = Number(roundedPrice.toFixed(pxDec))

      // ═════════════════════════════════════════════════════════════════════
      // INSTITUTIONAL ORDER SIZE NORMALIZATION
      // Twarde sito: min/target/max notional + coinStep
      // ═════════════════════════════════════════════════════════════════════
      const oldSizeInCoins = sizeInCoins
      const norm = normalizeOrderSizeInstitutional({
        coin: pair,
        price: roundedPrice,
        sizeCoins: sizeInCoins,
        coinStep: coinStep,
        layerTargetUsd: sizeUsd // target z grida/rebucket
      })

      if (norm.sizeCoins <= 0) {
        console.warn(
          `[SKIP] ${pair} invalid normalized size. sizeCoins=${sizeInCoins} price=${roundedPrice} reason=${norm.reason}`
        )
        return { success: false }
      }

      // Update sizeInCoins with normalized value
      sizeInCoins = norm.sizeCoins

      // Log adjustment if size changed or reason provided
      if (norm.reason || Math.abs(oldSizeInCoins - sizeInCoins) > 1e-9) {
        console.log(
          `[INSTIT_SIZE] ${pair} ${side.toUpperCase()} ${norm.reason || 'OK'} :: ` +
          `px=${roundedPrice.toFixed(4)} oldSize=${oldSizeInCoins.toFixed(sizeDecimals)} ` +
          `newSize=${sizeInCoins.toFixed(sizeDecimals)} notional=${norm.notional.toFixed(2)}`
        )
      }

      // ═════════════════════════════════════════════════════════════════════
      // UNWIND MODE + INVENTORY GUARD
      // ═════════════════════════════════════════════════════════════════════
      try {
        const currentPosition = await this.getPosition(pair)
        const currentPosSz = currentPosition?.size ?? 0  // dodatnie = long, ujemne = short
        const maxInv = MAX_INVENTORY_COINS[pair]

        if (pair === 'ZEC') {
          const cetHour = cetHourZec ?? getCETHour(now)
          const allowed = this.applyZecDefensiveGuards({
            side,
            roundedPrice,
            currentPosSz,
            cetHour
          })
          if (!allowed) {
            return { success: false }
          }
        }

        // Reduce-only if unwind is active for this coin
        if (maxInv && shouldUnwindCoin(pair, currentPosSz, maxInv)) {
          reduceOnlyLocal = true
          try {
            console.log(
              `[UNWIND_MODE] ${pair} active. side=${side} curPos=${currentPosSz.toFixed(sizeDecimals)} max=${maxInv} mode=${getUnwindMode()}`
            )
          } catch {
            // ignore formatting errors
          }
        }

        const invCheck = isInventoryAllowed({
          coin: pair,
          side: side,  // 'buy' or 'sell'
          sizeCoins: sizeInCoins,
          currentPosSz: currentPosSz,
          price: roundedPrice
        })

        if (!invCheck.allowed) {
          console.warn(
            `[INVENTORY_GUARD] ${pair} skip order. side=${side} size=${sizeInCoins.toFixed(sizeDecimals)} ` +
            `curPos=${currentPosSz.toFixed(sizeDecimals)} projected=${invCheck.projectedPos.toFixed(sizeDecimals)} ` +
            `max=${MAX_INVENTORY_COINS[pair] ?? 'unlimited'} reason=${invCheck.reason}`
          )
          return { success: false }
        }
      } catch (error) {
        // Jeśli guard się wywali – logujemy ale nie blokujemy (może być timeout)
        console.warn(`[INVENTORY_GUARD] ${pair} inventory guard error: ${error}`)
      }

      // ═════════════════════════════════════════════════════════════════════
      // FINAL QUANTIZATION & STRINGIFY (right before submit)
      // V2: Use spec-driven quantization with maker-safe ALO mode
      // ═════════════════════════════════════════════════════════════════════

      // Use V2 quantizeOrder for spec-driven quantization with ENV overrides
      const makerIntent = this.enablePostOnly ? 'alo' : 'gtc'
      const baseSpec = { tickSize: specs.tickSize.toString(), lotSize: specs.lotSize.toString() }
      const finalSpec = applySpecOverrides(pair, baseSpec)
      const quantResult = quantizeOrder(
        pair,
        side,
        makerIntent,
        roundedPrice.toString(),
        sizeInCoins.toString(),
        finalSpec
      )

      let priceInt = quantResult.priceInt
      let finalPriceStr = quantResult.pxQ
      let numPriceTicks = quantResult.ticks
      const sizeInt = quantResult.sizeInt
      const finalSizeStr = quantResult.szQ
      const numSizeSteps = quantResult.steps
      pxDec = quantResult.pxDec // Update with spec-driven value
      const stepDec = quantResult.stepDec

      // Keep tickSizeInt for SOL fallback logic
      const tickMultiplier = Math.pow(10, pxDec)
      const tickSizeInt = Math.round(specs.tickSize * tickMultiplier)

      // (d) String format validation (last safety net before SDK)
      if (!validateFormat(finalPriceStr, pxDec)) {
        console.warn(`⚠️  Price string format invalid: ${finalPriceStr} (expected ${pxDec} decimals)`)
        return { success: false }
      }
      if (!validateFormat(finalSizeStr, stepDec)) {
        console.warn(`⚠️  Size string format invalid: ${finalSizeStr} (expected ${stepDec} decimals)`)
        return { success: false }
      }

      // (e) DEBUG breadcrumb with tick counts for correlation
      const finalNotional = Number(finalSizeStr) * Number(finalPriceStr)
      const finalCoinStep = specs.lotSize || Math.pow(10, -stepDec)
      console.log(
        `🔍 DEBUG submit: pair=${pair} size=${finalSizeStr}(${numSizeSteps}steps) step=${finalCoinStep} price=${finalPriceStr}(${numPriceTicks}ticks) side=${side} notional=${finalNotional.toFixed(2)}`
      )

      // (f) Notional check using precomputed minNotionalInt (zero float comparison)
      const stepMultiplier = Math.pow(10, stepDec)
      const minNotionalCache = this.getMinNotionalInt(pair)

      // Use cached minNotionalInt for pure integer comparison with overflow protection
      const MAX_SAFE = Number.MAX_SAFE_INTEGER
      let belowMinNotional = false

      if (sizeInt > MAX_SAFE / Math.max(1, priceInt)) {
        // Overflow risk - use safer comparison
        belowMinNotional = (sizeInt / stepMultiplier) * (priceInt / tickMultiplier) < specs.minNotional
      } else {
        // Safe integer multiplication
        belowMinNotional = sizeInt * priceInt < minNotionalCache.minNotionalInt
      }

      if (belowMinNotional) {
        const notional = calculateNotionalInt(sizeInt, priceInt, stepMultiplier, tickMultiplier)
        console.warn(`⚠️  Order below min notional: $${notional.toFixed(2)} < $${specs.minNotional}`)
        // Machine-friendly log for SRE
        const tsMin = new Date().toISOString()
        console.log(`quant_evt=below_min ts=${tsMin} pair=${pair} side=${side} ticks=${numPriceTicks} stepInt=${sizeInt} szInt=${sizeInt} notional=${notional.toFixed(2)}`)
        return { success: false }
      }

      // Update for logging only
      sizeInCoins = Number(finalSizeStr)
      roundedPrice = Number(finalPriceStr)

      // Sanity check: ensure no NaN or invalid values
      if (!Number.isFinite(roundedPrice) || !Number.isFinite(sizeInCoins)) {
        console.error(`❌ Invalid order params: price=${roundedPrice}, size=${sizeInCoins}`)
        return { success: false }
      }

      // ═════════════════════════════════════════════════════════════════════
      // TIER 2: Min Edge Check
      // ═════════════════════════════════════════════════════════════════════
      if (this.chaseConfig && this.chaseConfig.minEdgeTicks > 0) {
        // Get current mid price from market
        const l2 = await this.infoClient.l2Book({ coin: pair })
        if (l2 && l2.levels && l2.levels[0] && l2.levels[0].length > 0 && l2.levels[1] && l2.levels[1].length > 0) {
          const bestAsk = parseFloat(l2.levels[0][0]?.px || '0')
          const bestBid = parseFloat(l2.levels[1][0]?.px || '0')
          const midPrice = (bestBid + bestAsk) / 2
          const edgeTicks = Math.abs(roundedPrice - midPrice) / specs.tickSize

          if (edgeTicks < this.chaseConfig.minEdgeTicks) {
            console.warn(`⚠️  ${pair} edge too small (${edgeTicks.toFixed(1)} < ${this.chaseConfig.minEdgeTicks} ticks), skipping order`)
            return { success: false }
          }
        }
      }

      // ═════════════════════════════════════════════════════════════════════
      // TIER 2: Inventory Skewing
      // ═════════════════════════════════════════════════════════════════════
      if (this.chaseConfig) {
        try {
          const userState = await this.infoClient.clearinghouseState({ user: this.walletAddress })
          if (userState && userState.assetPositions) {
            const position = userState.assetPositions.find((p: any) => p.position.coin === pair)
            if (position) {
              const szi = parseFloat(position.position.szi)
              const inventoryUsd = szi * roundedPrice
              const skewTicks = calculateInventorySkew(inventoryUsd, this.chaseConfig)

              if (skewTicks !== 0) {
                console.log(`📊 ${pair} inventory skew: ${inventoryUsd.toFixed(0)} USD → ${skewTicks} ticks`)
                const skewAdjustment = skewTicks * specs.tickSize
                // Skew pushes quotes away from current position
                // If long (positive inventory), widen sell quotes, tighten buy quotes
                if (side === 'buy') {
                  roundedPrice -= skewAdjustment  // Tighten buy when long
                } else {
                  roundedPrice += skewAdjustment  // Widen sell when long
                }
                roundedPrice = roundToTick(roundedPrice, specs.tickSize)
              }
            }
          }
        } catch (e) {
          // Ignore errors, continue without skew
        }
      }

      // DEBUG: Logging disabled for performance (uncomment if needed)
      // console.log(`[DEBUG] ${pair} Order:`)
      // console.log(`  sizeUsd: $${sizeUsd.toFixed(2)}`)
      // console.log(`  price: $${price}`)
      // console.log(`  sizeDecimals: ${sizeDecimals}`)
      // console.log(`  raw sizeInCoins: ${(sizeUsd / price).toFixed(8)}`)
      // console.log(`  rounded sizeInCoins: ${sizeInCoins}`)
      // console.log(`  assetIndex: ${assetIndex}`)

      // ═════════════════════════════════════════════════════════════════════
      // TIER 3: Price Band Guards (prevent orders too far from last fill)
      // ═════════════════════════════════════════════════════════════════════
      if (this.chaseConfig && this.chaseConfig.priceBandTicks > 0) {
        const lastFill = this.lastFillPrice.get(pair)
        if (lastFill) {
          const priceDiffTicks = Math.abs(roundedPrice - lastFill) / specs.tickSize
          if (priceDiffTicks > this.chaseConfig.priceBandTicks) {
            console.warn(`⚠️  ${pair} price ${roundedPrice} too far from last fill ${lastFill} (${priceDiffTicks.toFixed(1)} > ${this.chaseConfig.priceBandTicks} ticks)`)
            return { success: false }
          }
        } else {
          // First order - set last fill to current price
          this.lastFillPrice.set(pair, roundedPrice)
        }
      }

      // ═════════════════════════════════════════════════════════════════════
      // TIER 3: Multi-level Ladder (TODO: requires batchModify integration)
      // Currently placing single order at best level
      // ═════════════════════════════════════════════════════════════════════

      // Generate client order ID for tracking
      const cloid = this.generateCloid()

      // Build order request
      // Institutional chase mode: TIF support
      // Use short TIF (3-5s) for limit orders to reduce stale quotes
      const chaseConfig = this.chaseConfig || { tifSeconds: 3 }
      const tifSeconds = chaseConfig.tifSeconds || 0

      // Retry logic for ALO (post-only) rejections with auto-shade
      const maxRetries = this.chaseConfig?.retryOnPostOnlyReject || 1
      const autoShadeTicks = this.chaseConfig?.autoShadeOnRejectTicks || 1

      // Capture seq for correlation (incremented once per order request, not per retry)
      this.seq++
      const seqOriginal = this.seq

      // TIF and RO flags (used in logging throughout retry loop and after)
      const tifLabel = this.enablePostOnly ? 'Alo' : 'Gtc'
      const roFlag = reduceOnlyLocal ? 1 : 0

      // Use stringified values for submission (exact decimals, avoid float conversion)
      let currentPriceStr = finalPriceStr
      let currentSizeStr = finalSizeStr

      // ═════════════════════════════════════════════════════════════════════
      // SANITY CHECK: Ensure size is in COINS, not steps
      // ═════════════════════════════════════════════════════════════════════
      const sizeInCoinsFinal = Number(currentSizeStr)
      const notionalFinal = sizeInCoinsFinal * Number(currentPriceStr)
      const targetChildUsd = sizeUsd // Original target from grid/rebucket
      const maxAllowedUsd = targetChildUsd * 2 // Allow 2x buffer for rounding

      if (notionalFinal > maxAllowedUsd) {
        console.warn(
          `⚠️  Size sanity check failed: ${pair} notional $${notionalFinal.toFixed(2)} > $${maxAllowedUsd.toFixed(2)} (target: $${targetChildUsd.toFixed(2)})`
        )
        // Clamp to reasonable size: recalculate from target USD
        const clampedSizeCoins = targetChildUsd / Number(currentPriceStr)
        const coinStep = specs.lotSize || Math.pow(10, -stepDec)
        const clampedSteps = Math.round(clampedSizeCoins / coinStep)
        const clampedSizeFinal = (clampedSteps * coinStep).toFixed(stepDec)
        currentSizeStr = clampedSizeFinal
        console.log(
          `🔧 Clamped ${pair} size: ${sizeInCoinsFinal.toFixed(stepDec)} → ${clampedSizeFinal} (notional: $${(Number(clampedSizeFinal) * Number(currentPriceStr)).toFixed(2)})`
        )
      }

      let attempt = 0
      let lastResult: any = null

      while (attempt <= maxRetries) {
        attempt++

        // Note: Hyperliquid doesn't have traditional "market" orders
        // For market-like execution, use limit orders with IOC (Immediate or Cancel)
        const orderRequest: any = {
          orders: [{
            a: assetIndex,
            b: side === 'buy',
            p: currentPriceStr,
            s: currentSizeStr,
            r: reduceOnlyLocal, // reduce-only flag for closing/readjusting positions
            t: orderType === 'market'
              ? { limit: { tif: 'Ioc' } } // IOC for fast execution like market order
              : { limit: { tif: this.enablePostOnly ? 'Alo' : 'Gtc' } }, // Alo = post-only (maker-only), Gtc = can be taker
            c: cloid // Client order ID for tracking
          }],
          grouping: 'na'
        }

        // Add expiresAfter based on TIF setting
        // TIF=0 means GTC (5 min expiry), TIF>0 means short expiry (institutional mode)
        const expiresAfter = tifSeconds > 0
          ? Date.now() + (tifSeconds * 1000) // Short TIF (e.g., 3-5s)
          : Date.now() + (5 * 60 * 1000) // GTC fallback (5 min)

        // SRE-friendly: Log attempt BEFORE SDK call (ISO + epoch for math/joins)
        const tsObj = new Date()
        const ts = tsObj.toISOString()
        const tms = tsObj.getTime()
        console.log(`quant_evt=attempt ts=${ts} tms=${tms} seq=${seqOriginal} pair=${pair} side=${side} tif=${tifLabel} ro=${roFlag} cloid=${cloid} pxDec=${pxDec} stepDec=${stepDec} priceInt=${priceInt} sizeInt=${sizeInt} ticks=${numPriceTicks} steps=${numSizeSteps} try=${attempt}`)

        // Place order with expiresAfter (pass as options object)
        console.log(`[SDK DEBUG] Placing order: pair=${pair} p=${orderRequest.orders[0].p} s=${orderRequest.orders[0].s}`)

        try {
          lastResult = await this.exchClient.order(orderRequest, { expiresAfter })
          // console.log(`[DEBUG] Order result:`, JSON.stringify(lastResult, null, 2))

          // Check for ALO rejection (post-only would cross)
          if (lastResult && lastResult.response && lastResult.response.data) {
            const statuses = lastResult.response.data.statuses
            if (statuses && statuses[0] && 'error' in statuses[0]) {
              const errorMsg = statuses[0].error || ''

              // ALO rejection - retry with shaded price
              if (errorMsg.includes('Alo') || errorMsg.includes('would cross')) {
                if (attempt <= maxRetries) {
                  // Auto-shade using centralized utility (pure integer tick arithmetic)
                  const shadeTicks = side === 'buy' ? -autoShadeTicks : autoShadeTicks
                  currentPriceStr = adjustPriceByTicks(currentPriceStr, shadeTicks, specs.tickSize, pxDec)

                  console.log(`⚠️  ALO reject - auto-shade attempt ${attempt}: ${side} @${currentPriceStr}`)
                  continue // Retry with shaded price
                }
              }

              // SOL-specific ±1 tick fallback for "tick size" errors
              if (pair === 'SOL' && errorMsg.toLowerCase().includes('tick') && attempt <= maxRetries) {
                // Try ±1 tick variation (respect side-aware direction)
                const tickDelta = side === 'buy' ? -1 : 1 // Buy: -1 tick (lower), Sell: +1 tick (higher)
                const altPriceStr = adjustPriceByTicks(currentPriceStr, tickDelta, specs.tickSize, pxDec)

                console.log(`🔧 SOL tick retry attempt ${attempt}: ${currentPriceStr} → ${altPriceStr} (${tickDelta > 0 ? '+' : ''}${tickDelta} tick)`)
                currentPriceStr = altPriceStr
                continue // Retry with adjusted price
              }
            }
          }

          // Success or non-retryable error - break
          break
        } catch (error: any) {
          const msg = String(error?.message ?? error)
          const isTickErr = /tick size/i.test(msg)
          const isSizeErr = /invalid size/i.test(msg)
          const isAloErr = /Alo|would cross/i.test(msg)
          const isSOL = pair === 'SOL'

          // Track telemetry
          if (isTickErr) this.trackQuant(pair, side, 'tick_err')
          if (isSizeErr) this.trackQuant(pair, side, 'size_err')
          if (isAloErr) this.trackQuant(pair, side, 'alo_reject')

          // Machine-friendly logs for SRE (single line per error with ISO + epoch + error codes)
          const tsErrObj = new Date()
          const tsErr = tsErrObj.toISOString()
          const tmsErr = tsErrObj.getTime()
          if (isTickErr) {
            console.log(`quant_evt=submit ts=${tsErr} tms=${tmsErr} seq=${seqOriginal} cloid=${cloid} pair=${pair} side=${side} tif=${tifLabel} ro=${roFlag} ticks=${numPriceTicks} stepInt=${sizeInt} szInt=${sizeInt} ok=0 err=tick_size err_code=E_TICK`)
          }
          if (isSizeErr) {
            console.log(`quant_evt=submit ts=${tsErr} tms=${tmsErr} seq=${seqOriginal} cloid=${cloid} pair=${pair} side=${side} tif=${tifLabel} ro=${roFlag} ticks=${numPriceTicks} stepInt=${sizeInt} szInt=${sizeInt} ok=0 err=invalid_size err_code=E_SIZE`)
          }
          if (isAloErr) {
            console.log(`quant_evt=submit ts=${tsErr} tms=${tmsErr} seq=${seqOriginal} cloid=${cloid} pair=${pair} side=${side} tif=${tifLabel} ro=${roFlag} ticks=${numPriceTicks} stepInt=${sizeInt} szInt=${sizeInt} ok=0 err=alo_reject err_code=E_ALO`)
          }

          // Check auto-suppression (3+ tick errors in last 30 submits)
          if (isSOL && isTickErr && this.checkSolAutoSuppression(pair, side)) {
            console.warn(`⏸️  SOL auto-suppressed (3+ tick errors in recent 30 submits)`)
            const tsSuppObj = new Date()
            const tsSupp = tsSuppObj.toISOString()
            const tmsSupp = tsSuppObj.getTime()
            console.log(`quant_evt=submit ts=${tsSupp} tms=${tmsSupp} seq=${seqOriginal} cloid=${cloid} pair=${pair} side=${side} tif=${tifLabel} ro=${roFlag} ticks=${numPriceTicks} stepInt=${sizeInt} szInt=${sizeInt} ok=0 err=tick_size_auto_suppressed err_code=E_TICK_SUPP`)
            return { success: false }
          }

          // SOL-only, airtight ±1 tick fallback using integer math
          if (isSOL && isTickErr && attempt === 1 && this.solTickFallbackEnabled) {
            this.trackQuant(pair, side, 'sol_fallback_used')

            // Refresh specs on first tick error (in case pxDec/tickSize changed)
            let specsChanged = false
            if (this.shouldRefreshSpecs(pair)) {
              const oldTickSize = specs.tickSize
              const oldLotSize = specs.lotSize
              this.refreshSpecsAndCache(pair)
              const refreshedSpecs = getInstrumentSpecs(pair)

              // Check if specs actually changed
              if (refreshedSpecs.tickSize !== oldTickSize || refreshedSpecs.lotSize !== oldLotSize) {
                specsChanged = true
                console.log(`🔄 SOL specs changed: tick ${oldTickSize}→${refreshedSpecs.tickSize}, lot ${oldLotSize}→${refreshedSpecs.lotSize}`)

                // CRITICAL: Recompute ALL locals with fresh specs
                const pxDecRef = getPriceDecimals(refreshedSpecs.tickSize)
                const stepDecRef = getSizeDecimals(refreshedSpecs.lotSize)
                const tickMultRef = Math.pow(10, pxDecRef)
                const tickSizeIntRef = Math.round(refreshedSpecs.tickSize * tickMultRef)

                // Re-quantize with fresh specs
                const qP = quantizePrice(roundedPrice, refreshedSpecs.tickSize, pxDecRef, side)
                const qS = quantizeSize(sizeInCoins, refreshedSpecs.lotSize, stepDecRef)
                currentPriceStr = qP.strValue
                currentSizeStr = qS.strValue

                console.log(`🔄 Re-quantized: p=${currentPriceStr}(${qP.numSteps}ticks) s=${currentSizeStr}(${qS.numSteps}steps)`)
                // Retry with new quantization (skip fallback)
                continue
              }
            }

            try {
              const pxDecLocal = pxDec
              const tickInt = tickSizeInt

              // derive integer ticks from the string without floating ops
              const [iPart, fPartRaw = ''] = currentPriceStr.split('.')
              const fPart = (fPartRaw + '0'.repeat(pxDecLocal)).slice(0, pxDecLocal)
              const currentTicks = parseInt(iPart, 10) * tickMultiplier + parseInt(fPart || '0', 10)

              // side-aware preference: buy → try -1 first, then +1; sell → try +1 first, then -1
              const order = side === 'buy' ? [-1, +1] : [+1, -1]

              let fallbackSuccess = false
              for (const off of order) {
                const altTicks = currentTicks + off
                if (altTicks <= 0) continue

                // rebuild string from ticks
                const altPriceStr = intToDecimalString(altTicks, pxDecLocal)

                // quick regex format check
                const priceRegex = new RegExp(`^\\d+(\\.\\d{${pxDecLocal}})?$`)
                if (!priceRegex.test(altPriceStr)) continue

                // use same size string
                const orderRequestAlt: any = {
                  orders: [{
                    a: assetIndex,
                    b: side === 'buy',
                    p: altPriceStr,
                    s: currentSizeStr,
                    r: reduceOnly,
                    t: orderType === 'market' ? { limit: { tif: 'Ioc' } }
                      : { limit: { tif: this.enablePostOnly ? 'Alo' : 'Gtc' } },
                    c: cloid
                  }],
                  grouping: 'na'
                }

                console.log(`[SDK DEBUG] SOL fallback ±1tick: try ${off > 0 ? '+1' : '-1'} -> p=${altPriceStr} s=${currentSizeStr}`)

                const expiresAfterAlt = tifSeconds > 0
                  ? Date.now() + (tifSeconds * 1000)
                  : Date.now() + (5 * 60 * 1000)

                try {
                  lastResult = await this.exchClient.order(orderRequestAlt, { expiresAfter: expiresAfterAlt })

                  // If successful, mark success and break
                  if (lastResult && lastResult.status === 'ok') {
                    currentPriceStr = altPriceStr
                    fallbackSuccess = true
                    this.trackQuant(pair, side, 'sol_fallback_success')
                    console.log(`✅ SOL fallback succeeded with ${off > 0 ? '+1' : '-1'} tick`)
                    break
                  }
                } catch (e3: any) {
                  // If first direction fails, try opposite direction
                  const e3Msg = String(e3?.message ?? e3)
                  if (/tick size/i.test(e3Msg)) {
                    console.log(`⚠️  SOL fallback ${off > 0 ? '+1' : '-1'} tick failed, trying opposite...`)
                    continue // Try next offset
                  } else {
                    throw e3 // Re-throw non-tick errors
                  }
                }
              }

              if (!fallbackSuccess) {
                console.error(`🔴 sol_tick_double_fail side=${side} pxDec=${pxDecLocal} ticks=${currentTicks} ts=${Date.now()}`)
                // Track discrepancy for backoff
                this.trackSolDiscrepancy(side, currentTicks)
              }
            } catch (e2) {
              console.error(`SOL ±1tick fallback failed: ${e2}`)
              // Track discrepancy
              const [iPart, fPartRaw = ''] = currentPriceStr.split('.')
              const fPart = (fPartRaw + '0'.repeat(pxDec)).slice(0, pxDec)
              const ticks = parseInt(iPart, 10) * tickMultiplier + parseInt(fPart || '0', 10)
              this.trackSolDiscrepancy(side, ticks)
            }
          }

          // ALO rejection thrown as exception - retry with shaded price
          if (isAloErr && attempt <= maxRetries) {
            const shadeTicks = side === 'buy' ? -autoShadeTicks : autoShadeTicks
            currentPriceStr = adjustPriceByTicks(currentPriceStr, shadeTicks, specs.tickSize, pxDec)

            console.log(`⚠️  ALO reject (exception) - auto-shade attempt ${attempt}: ${side} @${currentPriceStr}`)
            continue // Retry with shaded price
          }

          // If not retryable, just log and break (don't throw)
          console.error(`Error placing order [${pair} ${side}]: ${msg}`)
          break
        }
      }

      const result = lastResult

      // Check if order was successful
      if (result && result.status === 'ok') {
        // Track success telemetry
        this.trackQuant(pair, side, 'submit_ok')

        // Machine-friendly log for SRE (ISO + epoch)
        const tsOkObj = new Date()
        const tsOk = tsOkObj.toISOString()
        const tmsOk = tsOkObj.getTime()
        console.log(`quant_evt=submit ts=${tsOk} tms=${tmsOk} seq=${seqOriginal} cloid=${cloid} pair=${pair} side=${side} tif=${tifLabel} ro=${roFlag} ticks=${numPriceTicks} stepInt=${sizeInt} szInt=${sizeInt} ok=1 err=none`)

        // Log telemetry every 200 orders
        const totalOrders = Array.from(this.quantTelemetry.values()).reduce((sum, s) => sum + s.submit_ok + s.tick_err + s.size_err, 0)
        if (totalOrders > 0 && totalOrders % 200 === 0) {
          this.logQuantTelemetry()
        }

        let oidValue: string | undefined

        // Save cloid mapping if we got an oid back
        if (result.response && result.response.data && result.response.data.statuses) {
          const statuses = result.response.data.statuses
          if (statuses[0] && 'resting' in statuses[0]) {
            const oid = statuses[0].resting.oid
            oidValue = String(oid)
            if (cloid) {
              this.orderCloidMap.set(cloid, oidValue)
            }
          }
        }

        // Record order in history
        this.recordOrder({
          cloid,
          oid: oidValue,
          pair,
          side,
          price,
          size: sizeInCoins,
          timestamp: Date.now(),
          status: 'placed',
          method: 'place'
        })

        // For limit orders, we won't know the fill price immediately
        // For market orders, we might get fill info in the response
        const feeBps = orderType === 'limit' ? this.makerFeeBps : this.takerFeeBps
        const fee = sizeUsd * feeBps / 10000

        return {
          success: true,
          fillPrice: price, // For limit orders, this is the requested price
          fee
        }
      } else {
        // Record rejected order
        this.recordOrder({
          cloid,
          pair,
          side,
          price,
          size: sizeInCoins,
          timestamp: Date.now(),
          status: 'rejected',
          method: 'place'
        })

        console.error(`❌ Order failed:`, JSON.stringify(result, null, 2))
        return { success: false }
      }

    } catch (error) {
      console.error(`Error placing order [${pair} ${side}]: ${error}`)
      return { success: false }
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      // Cancel order using SDK
      const result = await this.exchClient.cancel({
        cancels: [{ a: 0, o: parseInt(orderId) }] // Simplified
      })
      return result && result.status === 'ok'
    } catch (error) {
      console.error(`Error canceling order: ${error}`)
      return false
    }
  }

  async getPosition(pair: string): Promise<{ size: number; entryPrice: number } | null> {
    try {
      // Get user state from Hyperliquid
      const userState = await this.infoClient.clearinghouseState({ user: this.walletAddress })

      if (!userState || !userState.assetPositions) {
        return null
      }

      // Find position for this pair
      const assetIndex = this.assetMap.get(pair)
      if (assetIndex === undefined) {
        return null
      }

      const position = userState.assetPositions.find((p: any) => p.position.coin === pair)

      if (!position) {
        return null
      }

      return {
        size: parseFloat(position.position.szi),
        entryPrice: parseFloat(position.position.entryPx)
      }

    } catch (error) {
      console.error(`Error getting position: ${error}`)
      return null
    }
  }

  /**
   * Cancel all open orders - called on bot startup for clean slate
   *
   * Strategy: Use nonce invalidation first (fast, guaranteed, saves rate limits),
   * then fallback to individual cancels if needed.
   *
   * @see https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint#invalidate-pending-nonce-noop
   */
  async cancelAllOrders(): Promise<void> {
    try {
      const orders = await this.infoClient.openOrders({ user: this.walletAddress })

      if (!orders || orders.length === 0) {
        console.log('No open orders to cancel')
        return
      }

      console.log(`⚡ Canceling ${orders.length} orders via nonce invalidation (fast mode)...`)

      // PRIMARY: Use nonce invalidation - single tx, guaranteed, saves rate limits
      const nonceSuccess = await this.cancelAllOrdersByNonce()

      if (nonceSuccess) {
        console.log('✅ All orders canceled via nonce invalidation')
        return
      }

      // FALLBACK: If nonce invalidation fails, use individual cancels
      console.log('⚠️ Nonce invalidation failed, falling back to individual cancels...')

      for (const order of orders) {
        const assetIndex = this.assetMap.get(order.coin)
        if (assetIndex === undefined) continue

        try {
          await this.exchClient.cancel({
            cancels: [{
              a: assetIndex,
              o: order.oid
            }]
          })
        } catch (e) {
          console.error(`Failed to cancel order ${order.oid}: ${e}`)
        }
      }

      console.log('All orders canceled (fallback method)')
    } catch (error) {
      console.error(`Error canceling all orders: ${error}`)
      throw error
    }
  }

  /**
   * Cancel all pending orders by invalidating the nonce
   *
   * This method uses a 'noop' transaction to invalidate the current nonce,
   * which effectively cancels all pending orders if the nonce transaction lands first.
   *
   * Benefits:
   * - Guaranteed cancellation if nonce tx lands first
   * - Saves rate limits compared to spam-canceling individual orders
   * - Single transaction instead of multiple cancel requests
   *
   * Use cases:
   * - Emergency cancel during high volatility
   * - Fallback when individual cancels fail
   * - Rate limit preservation
   */
  async cancelAllOrdersByNonce(): Promise<boolean> {
    try {
      console.log('🔄 Canceling all orders via nonce invalidation...')

      // Send a noop transaction to invalidate the nonce
      // This will cause all pending orders with the old nonce to be rejected
      const result = await this.exchClient.noop()

      if (result && result.status === 'ok') {
        console.log('✅ Nonce invalidation successful - all pending orders canceled')
        return true
      } else {
        console.error('❌ Nonce invalidation failed:', result)
        return false
      }
    } catch (error) {
      console.error('❌ Error during nonce invalidation:', error)
      return false
    }
  }

  /**
   * Cancel all open orders for a specific trading pair
   * This prevents stacking of unfilled orders when price moves
   */
  async cancelPairOrders(pair: string): Promise<void> {
    try {
      const orders = await this.infoClient.openOrders({ user: this.walletAddress })

      if (!orders || orders.length === 0) return

      // Filter orders for this specific pair
      const pairOrders = orders.filter(order => order.coin === pair)
      if (pairOrders.length === 0) return

      for (const order of pairOrders) {
        const assetIndex = this.assetMap.get(order.coin)
        if (assetIndex === undefined) continue

        try {
          await this.exchClient.cancel({
            cancels: [{
              a: assetIndex,
              o: order.oid
            }]
          })
        } catch (e) {
          // Silently ignore cancel errors (order may have already filled)
        }
      }
    } catch (error) {
      // Silently ignore errors - we'll place new orders anyway
    }
  }

  /**
   * Get open orders for a specific trading pair
   */
  async getOpenOrders(pair: string): Promise<any[]> {
    try {
      const orders = await this.infoClient.openOrders({ user: this.walletAddress })
      if (!orders || orders.length === 0) return []

      // Filter orders for this specific pair
      return orders.filter(order => order.coin === pair)
    } catch (error) {
      return []
    }
  }

  /**
   * Batch modify orders - MORE EFFICIENT than cancel + place
   * Modifies existing orders to new prices in a single API call
   */
  async batchModifyOrders(pair: string, newBidPrice: number, newAskPrice: number, sizeUsd: number): Promise<boolean> {
    try {
      const orders = await this.getOpenOrders(pair)
      if (orders.length === 0) return false

      const assetIndex = this.assetMap.get(pair)
      if (assetIndex === undefined) return false

      const sizeDecimals = this.assetDecimals.get(pair) ?? 8
      const priceDecimals = this.getPriceDecimals(newBidPrice)

      const modifies: any[] = []

      for (const order of orders) {
        const isBuy = order.side === 'B'
        const newPrice = isBuy ? newBidPrice : newAskPrice
        let sizeInCoins = sizeUsd / newPrice

        // Round to szDecimals precision using floor rounding
        sizeInCoins = this.roundToSzDecimals(sizeInCoins, sizeDecimals)

        const roundedPrice = Number(newPrice.toFixed(priceDecimals))

        modifies.push({
          oid: parseInt(order.oid),
          order: {
            a: assetIndex,
            b: isBuy,
            p: roundedPrice.toString(),
            s: sizeInCoins.toString(),
            r: false,
            t: { limit: { tif: this.enablePostOnly ? 'Alo' : 'Gtc' } }
          }
        })
      }

      if (modifies.length === 0) return false

      // Add expiresAfter based on chase config (use staleQuoteKillMs for consistency)
      const chaseConfig = this.chaseConfig || { staleQuoteKillMs: 300000 }
      const expiresAfter = Date.now() + (chaseConfig.staleQuoteKillMs || 300000) // 5min default

      // Use customAction since SDK might not have batchModify typed
      const result = await (this.exchClient as any).batchModify({ modifies }, { expiresAfter })

      if (result && result.status === 'ok') {
        // Record cancelled orders (old orders being replaced)
        for (const order of orders) {
          const isBuy = order.side === 'B'
          const oldPrice = parseFloat(order.limitPx)
          const sizeInCoins = sizeUsd / oldPrice

          this.recordOrder({
            cloid: this.generateCloid(),
            oid: order.oid,
            pair,
            side: isBuy ? 'buy' : 'sell',
            price: oldPrice,
            size: sizeInCoins,
            timestamp: Date.now(),
            status: 'cancelled',
            method: 'batchModify'
          })
        }

        // Record modified orders (new orders)
        for (const order of orders) {
          const isBuy = order.side === 'B'
          const newPrice = isBuy ? newBidPrice : newAskPrice
          const sizeInCoins = sizeUsd / newPrice

          this.recordOrder({
            cloid: this.generateCloid(), // Generate new cloid for modified order
            oid: order.oid,
            pair,
            side: isBuy ? 'buy' : 'sell',
            price: newPrice,
            size: sizeInCoins,
            timestamp: Date.now(),
            status: 'modified',
            method: 'batchModify'
          })
        }
      }

      return result && result.status === 'ok'
    } catch (error) {
      console.error(`Error batch modifying orders: ${error}`)
      return false
    }
  }

  /**
   * Dead Man's Switch - Schedule automatic cancel of all orders
   * Safety feature: if bot crashes, orders will be auto-canceled
   */
  async enableDeadManSwitch(timeSeconds: number = 300): Promise<void> {
    try {
      const time = Date.now() + (timeSeconds * 1000)
      await this.exchClient.scheduleCancel({ time })
      this.deadManSwitchActive = true
      console.log(`✅ Dead Man's Switch enabled (${timeSeconds}s)`)
    } catch (error) {
      console.error(`Failed to enable Dead Man's Switch: ${error}`)
    }
  }

  /**
   * Disable Dead Man's Switch
   */
  async disableDeadManSwitch(): Promise<void> {
    try {
      await this.exchClient.scheduleCancel({})
      this.deadManSwitchActive = false
      console.log(`✅ Dead Man's Switch disabled`)
    } catch (error) {
      console.error(`Failed to disable Dead Man's Switch: ${error}`)
    }
  }

  /**
   * EMERGENCY INSTANT CANCEL - Use during high volatility spikes
   *
   * This is the FASTEST way to cancel all pending orders:
   * - Single noop transaction
   * - No rate limit consumption
   * - Guaranteed cancellation if tx lands first
   *
   * Use cases:
   * - Flash crash detected
   * - Unusual spread spike
   * - Circuit breaker triggered
   * - Manual panic button
   *
   * @returns true if successful, false otherwise
   */
  async emergencyInstantCancel(): Promise<boolean> {
    console.log('🚨🚨🚨 EMERGENCY INSTANT CANCEL TRIGGERED 🚨🚨🚨')
    const startTime = Date.now()

    try {
      // Use nonce invalidation for instant cancel
      const result = await this.exchClient.noop()

      const elapsed = Date.now() - startTime

      if (result && result.status === 'ok') {
        console.log(`✅ Emergency cancel SUCCESS in ${elapsed}ms - all pending orders invalidated`)
        return true
      } else {
        console.error(`❌ Emergency cancel FAILED in ${elapsed}ms:`, result)
        return false
      }
    } catch (error) {
      const elapsed = Date.now() - startTime
      console.error(`❌ Emergency cancel ERROR in ${elapsed}ms:`, error)
      return false
    }
  }

  /**
   * Reserve additional API request weight
   * Costs 0.0005 USDC per request weight
   */
  async reserveRequestWeight(weight: number): Promise<void> {
    try {
      // Use customAction since this is a direct exchange endpoint
      const result = await (this.exchClient as any).customAction({
        type: 'reserveRequestWeight',
        weight
      })
      if (result && result.status === 'ok') {
        console.log(`✅ Reserved ${weight} request weight`)
      }
    } catch (error) {
      console.error(`Failed to reserve request weight: ${error}`)
    }
  }

  /**
   * Record order in history
   */
  recordOrder(entry: OrderHistoryEntry): void {
    this.orderHistory.push(entry)
    // Keep last 1000 orders only
    if (this.orderHistory.length > 1000) {
      this.orderHistory = this.orderHistory.slice(-1000)
    }
  }

  /**
   * Get order history (optionally filtered by time range)
   */
  getOrderHistory(sinceTimestamp?: number): OrderHistoryEntry[] {
    if (!sinceTimestamp) return this.orderHistory
    return this.orderHistory.filter(o => o.timestamp >= sinceTimestamp)
  }

  /**
   * Get summary statistics for order history
   */
  getOrderStats(sinceTimestamp?: number): {
    total: number
    placed: number
    modified: number
    cancelled: number
    filled: number
    rejected: number
    byPair: Record<string, number>
  } {
    const orders = this.getOrderHistory(sinceTimestamp)
    const stats = {
      total: orders.length,
      placed: orders.filter(o => o.status === 'placed').length,
      modified: orders.filter(o => o.status === 'modified').length,
      cancelled: orders.filter(o => o.status === 'cancelled').length,
      filled: orders.filter(o => o.status === 'filled').length,
      rejected: orders.filter(o => o.status === 'rejected').length,
      byPair: {} as Record<string, number>
    }

    // Count by pair
    for (const order of orders) {
      stats.byPair[order.pair] = (stats.byPair[order.pair] || 0) + 1
    }

    return stats
  }

  /**
   * Close all open positions - called on bot startup for clean slate
   */
  async closeAllPositions(): Promise<void> {
    try {
      const state = await this.infoClient.clearinghouseState({ user: this.walletAddress })

      if (!state.assetPositions || state.assetPositions.length === 0) {
        console.log('No open positions to close')
        return
      }

      console.log(`Closing ${state.assetPositions.length} positions...`)

      for (const assetPos of state.assetPositions) {
        const pos = assetPos.position
        const coin = pos.coin
        const size = parseFloat(pos.szi)

        if (size === 0) continue

        const assetIndex = this.assetMap.get(coin)
        if (assetIndex === undefined) continue

        const sizeDecimals = this.assetDecimals.get(coin) || 8
        const closeSize = Math.abs(size)

        try {
          // Get current market price
          const l2 = await this.infoClient.l2Book({ coin })
          if (!l2 || !l2.levels) {
            console.warn(`No L2 data for ${coin}, skipping close`)
            continue
          }
          const bestAsk = parseFloat(l2.levels[0]?.[0]?.px || '0')
          const bestBid = parseFloat(l2.levels[1]?.[0]?.px || '0')
          const midPrice = (bestAsk + bestBid) / 2

          // Close with market order (IOC with 5% slippage)
          let closePrice = size < 0
            ? midPrice * 1.05  // Buy to close short
            : midPrice * 0.95  // Sell to close long

          // Get tick size for proper quantization
          const specs = getInstrumentSpecs(coin)
          const tickSize = specs.tickSize
          const lotSize = specs.lotSize
          const pxDec = getPriceDecimals(tickSize)
          const szDec = getSizeDecimals(lotSize)

          // Quantize close price using centralized utilities (side-aware)
          const closeSide = size < 0 ? 'buy' : 'sell'
          const priceQuant = quantizePrice(closePrice, tickSize, pxDec, closeSide)
          const closePriceStr = priceQuant.strValue

          // Quantize close size using centralized utilities
          const sizeQuant = quantizeSize(closeSize, lotSize, szDec)
          const roundedCloseSize = sizeQuant.strValue

          await this.exchClient.order({
            orders: [{
              a: assetIndex,
              b: size < 0,  // buy if short, sell if long
              p: closePriceStr,
              s: roundedCloseSize,
              r: true,  // reduce-only
              t: { limit: { tif: 'Ioc' } }
            }],
            grouping: 'na'
          })

          console.log(`Closed ${coin}: ${size > 0 ? 'LONG' : 'SHORT'} ${closeSize}`)
        } catch (e) {
          console.error(`Failed to close ${coin} position: ${e}`)
        }
      }

      console.log('All positions closed')
    } catch (error) {
      console.error(`Error closing all positions: ${error}`)
      throw error
    }
  }

  /**
   * Close position for a specific pair (used during rotation cleanup, conflict SL, etc.)
   * @param pair - Trading pair to close
   * @param reason - Reason for close (rotation_cleanup, conflict_SL, manual, etc.)
   */
  async closePositionForPair(pair: string, reason: string = 'rotation_cleanup'): Promise<void> {
    try {
      const state = await this.infoClient.clearinghouseState({ user: this.walletAddress })

      if (!state.assetPositions || state.assetPositions.length === 0) {
        return
      }

      // Find position for this specific pair
      const assetPos = state.assetPositions.find((ap: any) => ap.position?.coin === pair)
      if (!assetPos) {
        return // No position for this pair
      }

      const pos = assetPos.position
      const size = parseFloat(pos.szi)

      if (Math.abs(size) < 1e-6) {
        return // Position too small, skip
      }

      // Extract unrealized PnL
      const unrealizedPnl = parseFloat(pos.unrealizedPnl || '0')
      const positionValue = parseFloat(pos.positionValue || '0')
      const entryPrice = parseFloat(pos.entryPx || '0')

      // Get Nansen bias for this pair
      let biasInfo = ''
      let biasRelation = 'unknown'
      try {
        // Nansen bias check disabled to avoid dependency issues
        /*
        const biasData = this.nansenBias.get(pair)
        // ...
        */
      } catch (err) {
        biasInfo = ' | bias=error'
      }

      const assetIndex = this.assetMap.get(pair)
      if (assetIndex === undefined) {
        console.warn(`⚠️  Asset index not found for ${pair}`)
        return
      }

      const sizeDecimals = this.assetDecimals.get(pair) || 8
      const closeSize = Math.abs(size)

      // Pre-close log with full context
      const posDir = size > 0 ? 'LONG' : 'SHORT'
      const pnlStr = unrealizedPnl >= 0 ? `+$${unrealizedPnl.toFixed(2)}` : `-$${Math.abs(unrealizedPnl).toFixed(2)}`

      // Choose emoji based on conflict severity
      let logEmoji = '💥'
      if (biasRelation.includes('strong-conflict')) {
        logEmoji = '⚠️'
      } else if (biasRelation.includes('conflict')) {
        logEmoji = '🟠'
      } else if (biasRelation.includes('aligned')) {
        logEmoji = '✅'
      } else {
        logEmoji = 'ℹ️'
      }

      console.log(`${logEmoji} Nansen-aware close ${pair}: pos=${posDir} ${closeSize.toFixed(4)} | uPnL=${pnlStr} | reason=${reason}${biasInfo}`)

      try {
        // Get current market price
        const l2 = await this.infoClient.l2Book({ coin: pair })
        if (!l2 || !l2.levels) {
          console.warn(`No L2 data for ${pair}, skipping close`)
          return
        }
        const bestAsk = parseFloat(l2.levels[0]?.[0]?.px || '0')
        const bestBid = parseFloat(l2.levels[1]?.[0]?.px || '0')
        const midPrice = (bestAsk + bestBid) / 2

        // Close with market order (IOC with 5% slippage)
        let closePrice = size < 0
          ? midPrice * 1.05  // Buy to close short
          : midPrice * 0.95  // Sell to close long

        // Get tick size for proper quantization
        const specs = getInstrumentSpecs(pair)
        const tickSize = specs.tickSize
        const lotSize = specs.lotSize
        const pxDec = getPriceDecimals(tickSize)
        const szDec = getSizeDecimals(lotSize)

        // Quantize close price using centralized utilities (side-aware)
        const closeSide = size < 0 ? 'buy' : 'sell'
        const priceQuant = quantizePrice(closePrice, tickSize, pxDec, closeSide)
        const closePriceStr = priceQuant.strValue

        // Quantize close size using centralized utilities
        const sizeQuant = quantizeSize(closeSize, lotSize, szDec)
        const roundedCloseSize = sizeQuant.strValue

        await this.exchClient.order({
          orders: [{
            a: assetIndex,
            b: size < 0,  // buy if short, sell if long
            p: closePriceStr,
            s: roundedCloseSize,
            r: true,  // reduce-only
            t: { limit: { tif: 'Ioc' } }
          }],
          grouping: 'na'
        })

        console.log(`💥 Position closed for ${pair}: ${posDir} ${closeSize.toFixed(4)} (reason=${reason})`)
      } catch (e) {
        console.error(`Failed to close ${pair} position: ${e}`)
      }
    } catch (error) {
      console.warn(`Error closing position for ${pair}: ${error}`)
    }
  }

  /**
   * Get recent fills from Hyperliquid API using userFillsByTime endpoint
   * Note: userFills endpoint returns cached/stale data, userFillsByTime is real-time
   */
  async getRecentFills(): Promise<{ time: number; coin: string; side: string }[]> {
    try {
      // Use userFillsByTime for real-time data (last 24h)
      const startTime = Date.now() - 24 * 60 * 60 * 1000
      const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'userFillsByTime',
          user: this.walletAddress,
          startTime
        })
      })
      const fills = await response.json() as any[]
      return fills.map((f: any) => ({
        time: f.time,
        coin: f.coin,
        side: f.side
      }))
    } catch (err) {
      console.warn('[LiveTrading] Failed to fetch fills:', err)
      return []
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HYPERLIQUID MM BOT - Main bot class
// ─────────────────────────────────────────────────────────────────────────────

type NansenBias = 'long' | 'short' | 'neutral' | 'bull' | 'bear' | 'unknown'

// ===== Rotation & pair management =====
const MAX_ACTIVE_PAIRS = Number(process.env.MAX_ACTIVE_PAIRS ?? 3)

// Pary, które mogą zostać nawet jeśli na chwilę wypadną z rotacji
const STICKY_PAIRS = (process.env.STICKY_PAIRS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)

class HyperliquidMMBot {
  private api: HyperliquidAPI
  private infoClient: hl.InfoClient
  private walletAddress: string = ''
  private rotation: VolatilityRotation
  private smartRotationEngine = new SmartRotationEngine({
    maxActivePairs: Number(process.env.ROTATION_MAX_ACTIVE_PAIRS || 3),
    minVolume1hUsd: 10_000,
    rotationIntervalMs: 15 * 60 * 1000,
  })
  private lastSmartRotationPairs: string[] = []
  private marketVision: MarketVisionService
  private supervisor: Supervisor
  private stateManager: StateManager
  private trading: TradingInterface
  private notifier: ConsoleNotifier
  private nansen: ReturnType<typeof getNansenProAPI>
  private nansenBias: any // Stub NansenBiasService for now
  private orderReporter: OrderReporter
  private chaseConfig: ChaseConfig | null = null
  private gridManager: GridManager | null = null
  private legacyUnwinder: LegacyUnwinder
  private lastWhaleCheck = 0;
  private _contrarianLogAt: Record<string, number> = {};  // Throttle contrarian status logs
  private _autoPauseLogAt: number = 0;  // Throttle auto-pause logs
  private marketDataProvider: HyperliquidMarketDataProvider
  private telemetryCollector: TelemetryCollector
  private alertManager: AlertManager
  private dailySnapshotGenerator?: DailySnapshotGenerator
  private telemetryServer?: TelemetryServer
  private lastFillTimestamp: number | null = null
  private lastFillWatchdogAlertAt: number = 0
  private fillWatchdogMaxIdleMs: number = Number(process.env.FILL_WATCHDOG_MAX_IDLE_MS || 6 * 60 * 60 * 1000)
  private fillWatchdogCooldownMs: number = Number(process.env.FILL_WATCHDOG_COOLDOWN_MS || 60 * 60 * 1000)
  private shadowTradesUrl?: string
  private shadowPollIntervalMs = 0
  private shadowConsensusIntervalMs = 0
  private shadowFetchTimeoutMs = 0
  private shadowTradePoller?: NodeJS.Timeout
  private shadowConsensusTimer?: NodeJS.Timeout
  private shadowAlertIntegration?: ShadowAlertIntegration
  private processedShadowTradeKeys: string[] = []
  private processedShadowTradeSet: Set<string> = new Set()

  private intervalSec: number
  private baseOrderUsd: number
  private makerSpreadBps: number
  private rotationIntervalSec: number
  private maxDailyLossUsd: number
  private lastRotationTime: number = 0

  // Risk Management (Hard Stop Protection)
  private riskManager?: RiskManager
  private currentRiskState?: RiskCheckResult
  private lastRiskLog: number = 0
  private lastPnLReport: number = 0  // Track hourly PnL reports

  // EMA 200 Trend Filter (Layer 3 Protection)
  private trendFilters: Map<string, TrendFilter> = new Map()
  private lastTrendLog: number = 0

  // Shadow Watch - Sideways Market Detection (Layer 4 Protection)
  private shadowWatchers: Map<string, ShadowWatch> = new Map()
  private lastShadowLog: number = 0

  // Signal Verifier - Learns which Nansen signals to trust (Layer 5 Intelligence)
  private signalVerifier = new SignalVerifier()

  // Taker order strategy (unlocks API rate limits)
  private enableTakerOrders: boolean
  private takerOrderIntervalMs: number
  private takerOrderSizeUsd: number
  private lastTakerOrderTime: number = 0

  // Copy-trading configuration
  private enableCopyTrading: boolean
  private copyTradingMinConfidence: number
  private copyTradingMinTraders: number
  private lastCopyTradingCheck: number = 0

  // Nansen bias lock (risk management against strong signals)
  private nansenBiasCache: {
    lastLoad: number
    data: Record<string, NansenBiasEntry>
  } = { lastLoad: 0, data: {} }

  // Golden Duo signals cache (Smart Money position bias + flow skew)
  private goldenDuoCache: Map<string, { signal: GoldenDuoSignal; timestamp: number }> = new Map()
  private goldenDuoCacheTTL = 60_000 // 60 seconds

  // Nansen conflict protection
  private nansenConflictCheckEnabled: boolean
  private nansenStrongContraHardCloseUsd: number
  private nansenStrongContraMaxLossUsd: number
  private nansenStrongContraMaxHours: number

  // Rotation time tracking (for 8h rule)
  private rotationSince: Record<string, number> = {}

  // Throttling dla debug logów multi-layer per para
  private lastGridDebugAt: Record<string, number> = {}

  // Per-pair limity spreadu (w bps) – override globalnych clampów
  private static readonly PAIR_SPREAD_LIMITS: Record<string, { min: number; max: number }> = {
    // Manual basket (DOGE/LIT/SUI) tuning
    DOGE: { min: 5, max: 25 },
    LIT: { min: 8, max: 35 },
    SUI: { min: 7, max: 30 },
    ZEC: { min: 35, max: 180 },     // Increased min spread further (sideways market, reducing churn)
    HYPE: { min: 15, max: 140 },    // More aggressive on HYPE
    XPL: { min: 35, max: 200 },     // 🚀 NEW: High volatility protection for XPL
    VIRTUAL: { min: 30, max: 400 },  // Widened for FORCE_SHORT_ONLY (anti-whipsaw)
    FARTCOIN: { min: 40, max: 500 } // Reduced from 90-2000 to get more fills
  }

  private tuning = {
    orderUsdFactor: 1.0,
    maxConcurrent: 1,
    backoffMs: 0,
    makerSpreadFactor: 1.0
  }

  private config = {
    enableMultiLayer: false,
    enableChaseMode: false,
    spreadProfile: 'conservative' as 'conservative' | 'aggressive'
  }

  private behaviouralRiskMode: BehaviouralRiskMode = 'normal'

  private isDryRun: boolean
  private dynamicConfigManager?: DynamicConfigManager

  // ───────────────────────────────────────────────────────────────────────────
  // Live position cache (source of truth: Hyperliquid)
  // Used as a safe fallback when local stateManager positions are missing/stale.
  // ───────────────────────────────────────────────────────────────────────────
  private livePosCache: {
    ts: number
    byCoin: Map<string, { size: number; entryPrice: number; side: 'long' | 'short' }>
  } = { ts: 0, byCoin: new Map() }

  private positionRiskManager?: PositionRiskManager
  private positionProtector?: PositionProtector

  private async getLivePositionForPair(pair: string): Promise<{ size: number; entryPrice: number; side: 'long' | 'short' } | null> {
    try {
      const now = Date.now()
      const ttlMs = Number(process.env.LIVE_POS_CACHE_MS || 5000)
      if (now - this.livePosCache.ts > ttlMs || this.livePosCache.byCoin.size === 0) {
        const walletAddress = (this.trading as any)?.walletAddress || this.walletAddress
        if (!walletAddress) return null
        const userState = await this.api.getClearinghouseState(walletAddress)
        this.positionRiskManager?.updateAccountValue(
          Number(userState?.marginSummary?.accountValue || 0)
        )
        const next = new Map<string, { size: number; entryPrice: number; side: 'long' | 'short' }>()
        for (const ap of userState?.assetPositions ?? []) {
          const p = ap?.position
          if (!p) continue
          const coin = String(p.coin || '').toUpperCase()
          const sz = Number(p.szi || 0)
          if (!coin || !Number.isFinite(sz) || Math.abs(sz) < 1e-9) continue
          const entry = Number(p.entryPx || 0)
          next.set(coin, { size: sz, entryPrice: entry, side: sz > 0 ? 'long' : 'short' })
        }
        this.livePosCache = { ts: now, byCoin: next }
      }
      return this.livePosCache.byCoin.get(pair.toUpperCase()) ?? null
    } catch {
      return null
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INSTITUTIONAL MULTI-TIER ARCHITECTURE
  // ═══════════════════════════════════════════════════════════════════════════

  // TIER 2: Tactical Worker (5s) - SM Trade Detection
  private tacticalInterval?: ReturnType<typeof setInterval>
  private tacticalSignalBuffer: Map<string, number> = new Map() // Symbol -> Alpha Shift bps

  // TIER 3: Strategic Worker (1m) - Golden Duo Sync
  private strategicInterval?: ReturnType<typeof setInterval>
  private goldenDuoData: Record<string, GoldenDuoData> = {}

  // TIER 4: Positioning Worker (1h) - Rotation
  private positioningInterval?: ReturnType<typeof setInterval>

  // CEX Flow Analysis (for distribution/accumulation detection)
  private cexFlowAnalysis: Map<string, { alertLevel: string; message: string; isDistributing: boolean; ratioVsAverage: number }> = new Map()

  constructor() {
    this.api = new HyperliquidAPI()
    this.infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })
    this.rotation = new VolatilityRotation({
      minVolatility: Number(process.env.MIN_VOLATILITY_PCT || 2.0),
      rotationThreshold: 1.5
    })
    this.marketVision = new MarketVisionService(this.api)
    this.stateManager = new StateManager()
    this.lastFillTimestamp =
      this.stateManager.getLastProcessedFillTime() ??
      this.stateManager.getLastTradeTimestamp() ??
      null
    this.notifier = new ConsoleNotifier()
    this.nansen = getNansenProAPI()
    this.orderReporter = new OrderReporter(this.notifier)
    this.marketDataProvider = new HyperliquidMarketDataProvider(this.api)
    this.telemetryCollector = new TelemetryCollector()
    this.alertManager = new AlertManager()
    const totalCapitalUsd = Number(process.env.RISK_TOTAL_CAPITAL_USD || process.env.ACCOUNT_VALUE_USD || 20000)
    this.positionRiskManager = new PositionRiskManager({
      totalCapitalUsd,
      maxPerTokenUsd: Number(process.env.RISK_MAX_TOKEN_EXPOSURE_USD || 1500),
      maxTotalExposureUsd: Number(
        process.env.RISK_MAX_TOTAL_EXPOSURE_USD || totalCapitalUsd * (1 - Number(process.env.RISK_RESERVE_RATIO || 0.2))
      ),
      reserveRatio: Number(process.env.RISK_RESERVE_RATIO || 0.2),
      maxDrawdownPct: Number(process.env.RISK_MAX_DRAWDOWN_PCT || 0.2),
      notifier: this.notifier,
      onPause: (reason) => {
        this.alertManager?.setExternalPause('position-risk', reason)
      },
      onResume: () => {
        this.alertManager?.clearExternalPause('position-risk')
      }
    })

    // Initialize PositionProtector for trailing stop / auto-close
    this.positionProtector = new PositionProtector({
      trailingStopPct: Number(process.env.TRAILING_STOP_PCT || 0.10),          // 10% trailing stop
      profitTakeStartPct: Number(process.env.PROFIT_TAKE_START_PCT || 0.05),   // Start trailing after 5% profit
      hardStopPct: Number(process.env.HARD_STOP_PCT || 0.15),                  // 15% hard stop loss
      notifier: this.notifier,
      onClosePosition: async (token, reason, pnlPct) => {
        try {
          await (this.trading as any).closePositionForPair?.(token, `position_protector_${reason}`)
          this.notifier.warn(
            `[PositionProtector] Closed ${token}: ${reason} | PnL: ${(pnlPct * 100).toFixed(2)}%`
          )
        } catch (err: any) {
          this.notifier.error(`[PositionProtector] Failed to close ${token}: ${err?.message || err}`)
        }
      }
    })

    const dynamicConfigTokens = (process.env.DYNAMIC_CONFIG_TOKENS ?? 'DOGE,LIT,SUI,SOL,VIRTUAL,FARTCOIN')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0)
    const dynamicConfigEnabled = process.env.DYNAMIC_CONFIG_ENABLED !== 'false'
    if (dynamicConfigEnabled && dynamicConfigTokens.length > 0) {
      this.dynamicConfigManager = new DynamicConfigManager({
        tokens: dynamicConfigTokens,
        notifier: this.notifier,
        intervalMs: Number(process.env.DYNAMIC_CONFIG_INTERVAL_MS || 5 * 60 * 1000),
        dataPath: process.env.SMART_MONEY_DATA_PATH,
        marketDataProvider: async (token) => this.marketDataProvider.getData(token),
        telemetryCollector: this.telemetryCollector,
        alertManager: this.alertManager
      })
    }

    const snapshotEnabled = process.env.DAILY_SNAPSHOT_ENABLED !== 'false'
    if (snapshotEnabled) {
      const snapshotTokens = (process.env.DAILY_SNAPSHOT_TOKENS ?? 'DOGE,LIT,SUI')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0);

      if (snapshotTokens.length > 0) {
        this.dailySnapshotGenerator = new DailySnapshotGenerator({
          tokens: snapshotTokens,
          marketDataFetcher: (token) => this.marketDataProvider.getData(token),
          smartMoneyPath: process.env.SMART_MONEY_DATA_PATH,
          outputDir: process.env.TELEMETRY_SNAPSHOT_DIR,
          cron: process.env.DAILY_SNAPSHOT_CRON,
          timezone: process.env.DAILY_SNAPSHOT_TZ,
          notifier: this.notifier
        })
      }
    }

    // Initialize TelemetryServer (REST API for monitoring)
    const telemetryServerEnabled = process.env.TELEMETRY_SERVER_ENABLED !== 'false'
    if (telemetryServerEnabled) {
      this.telemetryServer = new TelemetryServer({
        port: parseInt(process.env.TELEMETRY_PORT ?? '8080', 10),
        alertManager: this.alertManager,
        telemetryCollector: this.telemetryCollector,
        getPositions: () => this.getTelemetryPositions(),
        getPerformance: () => this.getTelemetryPerformance(),
        getContrarianData: () => this.getTelemetryContrarian(),
        getShadowData: () => this.getTelemetryShadow(),
        getSmartSignals: () => this.getTelemetrySmartSignals(),
        getWatchdogData: () => this.getTelemetryWatchdog(),
        getPositionRisk: () => this.getTelemetryPositionRisk()
      })
      this.telemetryServer.start()
    }

    // Initialize Nansen Bias Service (filter/bias engine)
    // Stub implementation - NansenBiasService not available
    this.nansenBias = {
      isEnabled: () => false,
      get: (pair: string) => null,
      getSignal: (pair: string) => null,
      getRotationCandidates: (pairs: string[]) => pairs,
      refreshForSymbols: async (pairs: string[]) => { }
    } as any

    // Initialize chase config (Institutional preset - HFT mode)
    this.config.enableChaseMode = process.env.CHASE_MODE_ENABLED === 'true'
    if (this.config.enableChaseMode) {
      this.chaseConfig = INSTITUTIONAL_PRESET
      console.log('🏁 Chase mode enabled: INSTITUTIONAL_PRESET')
    }

    // Behavioural risk mode (anti-FOMO / anti-knife)
    const riskModeFromEnv = (process.env.BEHAVIOURAL_RISK_MODE || 'normal').toLowerCase()
    this.behaviouralRiskMode = riskModeFromEnv === 'aggressive' ? 'aggressive' : 'normal'
    this.notifier.info(`🧠 Behavioural risk mode: ${this.behaviouralRiskMode}`)

    // Initialize GridManager (Institutional multi-layer quoting)
    this.config.enableMultiLayer = process.env.ENABLE_MULTI_LAYER === 'true'
    if (this.config.enableMultiLayer) {
      this.gridManager = new GridManager()
      console.log('🏛️  Multi-layer grid enabled:', this.gridManager.getSummary())
    }

    // Spread profile (conservative / aggressive)
    const profileEnv = (process.env.SPREAD_PROFILE || 'conservative').toLowerCase()
    this.config.spreadProfile = profileEnv === 'aggressive' ? 'aggressive' : 'conservative'
    console.log(
      `🎚️ Spread profile: ${this.config.spreadProfile} (env SPREAD_PROFILE=${process.env.SPREAD_PROFILE || 'conservative'})`
    )

    // 🔍 Debug: pokaż aktywny profil i warstwy dla kluczowych par
    const profile =
      (process.env.MULTI_LAYER_PROFILE as 'normal' | 'aggressive') || 'normal'

    const symbolsToShow = ['ZEC', 'UNI', 'VIRTUAL'] as const

    console.log(
      `🧩 Multi-layer profile: ${profile} (source: MULTI_LAYER_PROFILE env, default="normal")`
    )

    for (const sym of symbolsToShow) {
      // Layer budgets are handled by GridManager internally
      console.log(`   • ${sym} layers: (using GridManager config)`)
    }

    // Initialize Legacy Unwinder
    this.legacyUnwinder = createLegacyUnwinderFromEnv()
    console.log('📦 Legacy unwinding enabled: mode=' + (process.env.LEGACY_UNWIND_MODE || 'passive'))

    // Configuration from env
    this.intervalSec = Number(process.env.MM_INTERVAL_SEC || 60)
    this.baseOrderUsd = Number(process.env.BASE_ORDER_USD || 150)
    this.makerSpreadBps = Number(process.env.MAKER_SPREAD_BPS || 40)
    this.rotationIntervalSec = Number(process.env.ROTATION_INTERVAL_SEC || 14400) // 4 hours
    this.maxDailyLossUsd = Number(process.env.MAX_DAILY_LOSS_USD || 400)
    this.isDryRun = process.env.DRY_RUN === 'true'

    // Taker order configuration
    this.enableTakerOrders = process.env.ENABLE_TAKER_ORDERS === 'true'
    this.takerOrderIntervalMs = Number(process.env.TAKER_ORDER_INTERVAL_MIN || 60) * 60 * 1000
    this.takerOrderSizeUsd = Number(process.env.TAKER_ORDER_SIZE_USD || 100)

    // Copy-trading configuration
    this.enableCopyTrading = process.env.COPY_TRADING_ENABLED === 'true'
    this.copyTradingMinConfidence = Number(process.env.COPY_TRADING_MIN_CONFIDENCE || 60)
    this.copyTradingMinTraders = Number(process.env.COPY_TRADING_MIN_TRADERS || 3)

    // Nansen conflict protection configuration
    this.nansenConflictCheckEnabled = process.env.NANSEN_CONFLICT_CHECK_ENABLED !== 'false'
    this.nansenStrongContraHardCloseUsd = Number(process.env.NANSEN_STRONG_CONTRA_HARD_CLOSE_USD || 10)
    this.nansenStrongContraMaxLossUsd = Number(process.env.NANSEN_STRONG_CONTRA_MAX_LOSS_USD || 25)
    this.nansenStrongContraMaxHours = Number(process.env.NANSEN_STRONG_CONTRA_MAX_HOURS || 3)

    // Initialize trading interface based on mode
    if (this.isDryRun) {
      this.trading = new PaperTrading()
      this.notifier.info('📄 PAPER TRADING MODE - No real money at risk')
    } else {
      const privateKey = process.env.PRIVATE_KEY
      if (!privateKey) {
        throw new Error('❌ PRIVATE_KEY required for live trading! Set DRY_RUN=true for paper trading.')
      }
      this.trading = new LiveTrading(privateKey, this.api, this.chaseConfig)
      this.walletAddress = new ethers.Wallet(privateKey).address
      this.notifier.info('💰 LIVE TRADING MODE - REAL MONEY AT RISK!')
    }

    // Initialize supervisor
    const hooks: SupervisorHooks = {
      getExecStats: async () => this.stateManager.getExecStats(),
      getBalances: async () => ({ eth: 1.0, usdc: 20000 }), // Mock for now
      getStaleSec: async () => 0,
      pingVenue: async () => {
        try {
          await this.api.getMetaAndAssetCtxs()
          return true
        } catch {
          return false
        }
      },
      pingRpc: async () => true, // Mock
      applyTuning: async (t) => {
        // TUNING DISABLED: Always use 100% order size regardless of success rate
        this.tuning = {
          ...t,
          orderUsdFactor: 1.0  // Force 100% - ignoring auto-tuning adjustments
        }
      },
      setIntervalSec: (sec) => {
        this.intervalSec = sec
      },
      onKillSwitch: async () => {
        this.notifier.error('🚨 KILL SWITCH ACTIVATED - Stopping bot')
        process.exit(1)
      }
    }

    this.supervisor = new Supervisor({
      rpcUrls: ['https://api.hyperliquid.xyz'],
      venueProbes: [
        { name: 'Hyperliquid', url: 'https://api.hyperliquid.xyz/info', method: 'POST' }
      ],
      hooks,
      baseIntervalSec: this.intervalSec,
      maxIntervalSec: 45,
      notifier: this.notifier
    })

    this.notifier.info(`🤖 Hyperliquid MM Bot initialized`)
    this.notifier.info(`   Mode: ${this.isDryRun ? 'PAPER TRADING' : 'LIVE'}`)
    this.notifier.info(`   Base interval: ${this.intervalSec}s`)
    this.notifier.info(`   Base order size: $${this.baseOrderUsd}`)
    this.notifier.info(`   Maker spread: ${this.makerSpreadBps} bps`)
    this.notifier.info(`   Rotation interval: ${this.rotationIntervalSec / 3600}h`)
    if (this.enableTakerOrders) {
      this.notifier.info(`   ⚡ Taker orders: ENABLED ($${this.takerOrderSizeUsd} every ${this.takerOrderIntervalMs / 60000}min)`)
    }
    if (this.nansen.isEnabled()) {
      this.notifier.info(`   🔥 Nansen Pro: ENABLED (Copy-trading + Smart Money tracking)`)
      if (this.enableCopyTrading) {
        this.notifier.info(`   📊 Copy-trading: ${this.copyTradingMinConfidence}% confidence, ${this.copyTradingMinTraders}+ traders`)
      }
    }
    if (this.nansenConflictCheckEnabled) {
      this.notifier.info(`   🛡️  Nansen Conflict Protection: ENABLED`)
      this.notifier.info(`      Hard close threshold: $${this.nansenStrongContraHardCloseUsd}`)
      this.notifier.info(`      Max loss limit: $${this.nansenStrongContraMaxLossUsd}`)
      this.notifier.info(`      Max hold time: $${this.nansenStrongContraMaxHours}h`)
    }

    // ═══════════════════════════════════════════════════════════
    // RISK MANAGER INITIALIZATION (Hard Stop Protection)
    // ═══════════════════════════════════════════════════════════
    // Initialize RiskManager asynchronously after bot startup
    this.api.getClearinghouseState(this.walletAddress).then((state) => {
      const initialEquity = Number(state.marginSummary.accountValue || 0)
      this.riskManager = new RiskManager(
        initialEquity,
        createConservativeRiskConfig()  // 3% daily loss, 60% inventory
      )
      this.notifier.info('[RISK] ✅ Risk Manager active with hard stops enabled')
      this.notifier.info(`[RISK] Initial Equity: $${initialEquity.toFixed(2)}`)
    }).catch((err) => {
      console.error('[RISK] ❌ Failed to initialize RiskManager:', err)
    })
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Initialization
  // ───────────────────────────────────────────────────────────────────────────

  async initialize() {
    this.notifier.info('🚀 Initializing bot...')

    // Start Market Vision
    await this.marketVision.start();

    // Initialize live trading if not in dry run mode
    if (!this.isDryRun && this.trading instanceof LiveTrading) {
      await (this.trading as LiveTrading).initialize()
      this.notifier.info('✅ Live trading initialized')

      // Initialize lastFillTimestamp from API if not set from state
      if (!this.lastFillTimestamp) {
        try {
          const lt = this.trading as LiveTrading
          const fills = await lt.getRecentFills()
          if (fills.length > 0) {
            const latestFill = fills[fills.length - 1]
            this.lastFillTimestamp = latestFill.time
            const age = Math.round((Date.now() - this.lastFillTimestamp) / 60000)
            this.notifier.info(`📊 Last fill: ${age} minutes ago (${latestFill.coin} ${latestFill.side})`)
          } else {
            this.lastFillTimestamp = Date.now()
            this.notifier.info('📊 No fills found - watchdog starts from now')
          }
        } catch (err) {
          this.lastFillTimestamp = Date.now()
          this.notifier.warn(`⚠️ Could not fetch last fill: ${err}`)
        }
      }

      // AUTOMATIC CLEANUP ON STARTUP (optional via SKIP_STARTUP_CLEANUP env var)
      const skipCleanup = process.env.SKIP_STARTUP_CLEANUP === 'true'
      const rotationMode = process.env.ROTATION_MODE ?? 'auto'
      const preservePositions = process.env.PRESERVE_POSITIONS_ON_START === 'true'

      if (skipCleanup) {
        this.notifier.info('⏭️  Skipping startup cleanup - keeping existing positions')
      } else {
        const skipClosePositions = rotationMode === 'manual' || preservePositions
        this.notifier.info(
          skipClosePositions
            ? '🧹 Startup cleanup: canceling all open orders (preserving positions)...'
            : '🧹 Cleaning up: canceling all open orders and closing positions...'
        )
        try {
          await (this.trading as LiveTrading).cancelAllOrders()
          this.notifier.info('   ✅ All orders canceled')

          if (!skipClosePositions) {
            await (this.trading as LiveTrading).closeAllPositions()
            this.notifier.info('   ✅ All positions closed')
          } else {
            this.notifier.info('   ⏭️  Preserved positions on startup')
          }

          this.notifier.info('✅ Cleanup complete - starting with clean slate')
        } catch (error) {
          this.notifier.error(`❌ Cleanup failed: ${error}`)
          throw new Error('Failed to cleanup on startup')
        }
      }
    } else {
      this.notifier.info('✅ Paper trading ready')
    }

    // ════════════════════════════════════════════════════════════════════════
    // MULTI-TIER WORKERS (Institutional Order Book Intelligence)
    // ════════════════════════════════════════════════════════════════════════
    if (this.config.enableMultiLayer) {
      this.initializeMultiTierWorkers()
      this.notifier.info('🏛️  Multi-tier workers initialized (TACTICAL 5s, STRATEGIC 60s)')
    }

    if (this.dynamicConfigManager) {
      const tracked = this.dynamicConfigManager.getTrackedTokens().join(', ') || 'none'
      this.notifier.info(`[DynamicConfig] Enabled for tokens: ${tracked}`)
      this.dynamicConfigManager.start()
    }

    this.initializeShadowTrading()

    if (this.dailySnapshotGenerator) {
      const runOnStart = process.env.DAILY_SNAPSHOT_RUN_ON_START !== 'false'
      this.dailySnapshotGenerator.start(undefined, runOnStart)
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🚀 AlphaExtractionEngine - Native TypeScript Smart Money tracking
    // Replaces Python whale_tracker.py JSON file reading with real-time signals
    // ════════════════════════════════════════════════════════════════════════
    try {
      await alphaEngineIntegration.start(30_000) // 30s update interval
      this.notifier.info('🚀 AlphaExtractionEngine started (30s interval)')

      // Subscribe to immediate signals for fast reaction
      alphaEngineIntegration.on('immediate_signal', (command: TradingCommand) => {
        this.handleImmediateSignal(command)
      })

      // Subscribe to full updates to keep nansenBiasCache in sync
      alphaEngineIntegration.on('update', (data: { nansenBias: Record<string, NansenBiasEntry> }) => {
        this.nansenBiasCache = {
          lastLoad: Date.now(),
          data: data.nansenBias,
        }
      })

      this.notifier.info('✅ AlphaEngine event listeners active')
    } catch (err) {
      this.notifier.warn(`⚠️ AlphaEngine failed to start: ${err} - using JSON fallback`)
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🔮 Oracle Vision - Price prediction using SM data + Linear Regression
    // ════════════════════════════════════════════════════════════════════════
    try {
      await oracleEngine.start()
      this.notifier.info('🔮 Oracle Vision started (60s interval)')

      // Subscribe to Oracle signals for enhanced trading decisions
      oracleEngine.on('signal', (signal: OracleSignal) => {
        this.handleOracleSignal(signal)
      })

      // Log Oracle dashboard periodically (every 5 minutes)
      setInterval(() => {
        if (oracleEngine.isRunning()) {
          console.log(generateSignalDashboard())
          const alerts = generateDivergenceAlerts()
          if (alerts.includes('DIVERGENCE')) {
            console.log(alerts)
          }
        }
      }, 5 * 60 * 1000)

      this.notifier.info('✅ Oracle Vision event listeners active')
    } catch (err) {
      this.notifier.warn(`⚠️ Oracle Vision failed to start: ${err}`)
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Main Loop
  // ───────────────────────────────────────────────────────────────────────────

  async cancelAllOnBlockedPairs() {
    try {
      const liqFlags = loadLiquidityFlags();
      // 1. Fetch ALL open orders efficiently
      let allOrders: any[] = [];
      try {
        allOrders = await this.infoClient.openOrders({ user: this.walletAddress });
      } catch (e) {
        console.error('[LIQ_GUARD] Failed to fetch open orders:', e);
        return;
      }

      if (!allOrders || allOrders.length === 0) return;

      // 2. Check flags and cancel
      for (const order of allOrders) {
        const pair = order.coin;
        if (isPairBlockedByLiquidity(pair, liqFlags)) {
          console.warn(`[LIQ_GUARD] 🚨 PAIR BLOCKED: ${pair}. Cancelling order ${order.oid}...`);
          try {
            await this.trading.cancelOrder(order.oid);
            await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit safety
          } catch (e) {
            console.error(`[LIQ_GUARD] Failed to cancel ${order.oid}`, e);
          }
        }
      }
    } catch (err) {
      console.error('[LIQ_GUARD] Error in cancelAllOnBlockedPairs:', err);
    }
  }

  async mainLoop() {
    while (true) {
      try {
        // Check kill switch
        if (await killSwitchActive()) {
          this.notifier.error('❌ Kill switch active - bot stopped')
          break
        }

        this.checkFillWatchdog()

        // 🐋 Load whale tracker data into SmAutoDetector cache (refreshes every 30s)
        await loadAndAnalyzeAllTokens()

        // 🔔 NANSEN ALERT QUEUE: Process alerts from Telegram (via ai-executor)
        await this.processNansenAlertQueue()

        // 🛑 LIQUIDITY GUARD: Cancel orders on blocked pairs
        await this.cancelAllOnBlockedPairs();
        await this.sleep(2000);

        // ═══════════════════════════════════════════════════════════
        // RISK MANAGER CHECK (Hard Stop - Last Line of Defense)
        // ═══════════════════════════════════════════════════════════

        if (this.riskManager) {
          const currentEquity = await this.calculateTotalEquity()
          const totalInventoryValue = await this.getTotalInventoryValue()

          // Use BTC price as reference (or any liquid pair)
          const [, assetCtxs] = await this.api.getMetaAndAssetCtxs()
          const btcCtx = assetCtxs.find((ctx) => ctx.coin === 'BTC')
          const btcPrice = btcCtx ? Number(btcCtx.midPx) : 0

          const riskCheck = this.riskManager.checkHealth(
            currentEquity,
            totalInventoryValue,
            btcPrice
          )

          // Log warnings and critical alerts
          if (riskCheck.severity === 'warning') {
            console.warn(`[RISK] ⚠️ ${riskCheck.reason}`)
          } else if (riskCheck.severity === 'critical') {
            console.error(`[RISK] 🛑 ${riskCheck.reason}`)
          }

          // HARD STOP ACTIONS
          if (riskCheck.action === RiskAction.EMERGENCY_LIQUIDATE) {
            console.error('🚨 EMERGENCY LIQUIDATION TRIGGERED!')
            await this.emergencyLiquidateAll()
            process.exit(1)
          }

          if (riskCheck.action === RiskAction.HALT) {
            console.error('🛑 RISK MANAGER HALT! Shutting down bot.')
            process.exit(1)
          }

          // Store risk state for pair processing
          this.currentRiskState = riskCheck

          // Periodic risk stats logging (every 5 minutes)
          if (Date.now() - this.lastRiskLog > 5 * 60 * 1000) {
            const stats = this.riskManager.getSessionStats(currentEquity)
            console.log('═══════════════════════════════════════════════')
            console.log(`📊 Risk Status (${new Date().toLocaleTimeString()})`)
            console.log(`   Session Duration: ${stats.sessionDurationMin.toFixed(0)}min`)
            console.log(`   Initial Equity: $${stats.initialEquity.toFixed(2)}`)
            console.log(`   Current Equity: $${stats.currentEquity.toFixed(2)}`)
            console.log(`   PnL: $${stats.pnlUsd.toFixed(2)} (${stats.pnlPct.toFixed(2)}%)`)
            console.log(`   Max Drawdown: ${stats.maxDrawdownPct.toFixed(2)}%`)
            console.log('═══════════════════════════════════════════════')
            this.lastRiskLog = Date.now()
          }
        }

        // ═══════════════════════════════════════════════════════════
        // HOURLY PnL REPORT (Per-Pair Breakdown)
        // ═══════════════════════════════════════════════════════════

        // Log detailed PnL every 1 hour
        if (Date.now() - this.lastPnLReport > 60 * 60 * 1000) {
          await this.logHourlyPnL()
          this.lastPnLReport = Date.now()
        }

        // ⚡ SYNC PnL FROM HYPERLIQUID (SOURCE OF TRUTH)
        // Note: syncPnLFromHyperliquid() handles daily PnL reset automatically
        // when it detects a new day (lastResetDate !== today)
        if (this.trading instanceof LiveTrading) {
          const syncResult = await this.stateManager.syncPnLFromHyperliquid(
            (this.trading as any).infoClient,
            (this.trading as any).walletAddress,
            (pair: string, notionalUsd: number, fillTime: Date) => {
              // Track daily notional for cap enforcement
              (this.trading as LiveTrading).addDailyNotional(pair, notionalUsd, fillTime)
            }
          )
          if (syncResult.newFills > 0) {
            this.lastFillTimestamp = this.stateManager.getLastProcessedFillTime() ?? Date.now()
            const state = this.stateManager.getState()
            const anchor = state.dailyPnlAnchorUsd ?? 0
            const rawDailyPnl = anchor + state.dailyPnl // Reconstruct raw from effective + anchor
            this.notifier.info(
              `✅ Synced ${syncResult.newFills} new fills | ` +
              `rawDaily=$${rawDailyPnl.toFixed(2)} | effectiveDaily=$${state.dailyPnl.toFixed(2)} | ` +
              `PnL Δ: $${syncResult.pnlDelta.toFixed(2)}`
            )
          }
        }
        await this.sleep(2000);

        // Check daily loss limit
        const state = this.stateManager.getState()
        if (state.dailyPnl < -this.maxDailyLossUsd) {
          this.notifier.error(`❌ Daily loss limit reached: $${state.dailyPnl.toFixed(2)}`)

          // Send risk alert to Slack
          try {
            await sendRiskAlert(
              `Daily loss limit exceeded\n` +
              `Loss: $${Math.abs(state.dailyPnl).toFixed(2)}\n` +
              `Limit: $${this.maxDailyLossUsd.toFixed(2)}\n` +
              `Action: Bot stopping\n` +
              `Timestamp: ${new Date().toISOString()}`
            )
          } catch (e) {
            console.error('[RISK] Failed to send daily loss alert', e)
          }

          break
        }

        // Rotate pairs if needed
        await this.rotateIfNeeded()
        await this.sleep(2000);

        // WHALE TRACKER CHECK
        const now = Date.now();
        if (now - this.lastWhaleCheck > 300000) { // Check every 5 mins
          const whaleTokens = Object.entries(NANSEN_TOKENS).map(([symbol, cfg]) => ({
            symbol,
            address: cfg.address,
            chain: cfg.chain
          }));

          // Don't await to not block main loop
          mmAlertBot.checkWhaleActivity(whaleTokens).catch(err => {
            console.error('[WhaleTracker] Error:', err);
          });

          this.lastWhaleCheck = now;
        }

        // Check for Nansen strong conflicts and auto-close if needed
        if (this.nansenConflictCheckEnabled) {
          await this.checkNansenConflicts()
        }
        await this.sleep(2000);

        // Execute market making
        // Check for manual rotation mode override
        let activePairs: string[]
        const rotationMode = process.env.ROTATION_MODE ?? 'auto'
        const manualPairs = (process.env.MANUAL_ACTIVE_PAIRS ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)

        if (rotationMode === 'manual' && manualPairs.length > 0) {
          this.notifier.info(`[INFO] ROTATION_MODE=manual`)
          this.notifier.info(`[INFO] Using MANUAL_ACTIVE_PAIRS=${manualPairs.join(',')}`)
          activePairs = manualPairs
        } else {
          // Get active pairs from rotation (top by volatility + Nansen)
          activePairs = this.rotation.getCurrentPairs()
        }

        // Apply rotation pair limits: close positions outside MAX_ACTIVE_PAIRS
        // Update activePairs to the actual allowed list (after sticky pairs merge + cap)
        activePairs = await this.applyRotationPairs(activePairs)
        await this.sleep(2000);

        // Enforce MAX_ACTIVE_PAIRS for execution as well
        if (activePairs.length > MAX_ACTIVE_PAIRS) {
          this.notifier.warn(
            `⚠️  Truncating active pairs from ${activePairs.length} to MAX_ACTIVE_PAIRS=${MAX_ACTIVE_PAIRS}`
          )
          activePairs = activePairs.slice(0, MAX_ACTIVE_PAIRS)
        }

        // Now trade ONLY on active pairs (zombie positions have been cleaned)
        if (activePairs.length > 0) {
          // Subscribe to L2 books for real-time data (WebSocket)
          if (this.trading instanceof LiveTrading) {
            this.trading.subscribeToL2Books(activePairs)
          }

          // ═══════════════════════════════════════════════════════════════════
          // GOLDEN DUO: Fetch Smart Money signals for active pairs
          // ═══════════════════════════════════════════════════════════════════
          for (const pair of activePairs) {
            const signal = await this.getGoldenDuoSignalForPair(pair)
            if (signal && (signal.positionBias !== 0 || signal.flowSkew !== 0)) {
              this.notifier.info(
                `[NANSEN] ${pair} Bias: ${signal.positionBias.toFixed(2)}, Flow: ${signal.flowSkew.toFixed(2)}`
              )
            }
          }

          // Execute MM for active pairs only
          await this.executeMM(activePairs, activePairs)

          // Check and reserve rate limit if needed
          if (this.trading instanceof LiveTrading) {
            await this.trading.checkAndReserveRateLimit()
          }
        } else {
          this.notifier.warn('⚠️  No pairs selected yet, waiting for rotation...')
        }

        // Execute taker order if enabled (unlocks rate limits)
        if (this.enableTakerOrders && !this.isDryRun) {
          await this.executeTakerOrder()
        }

        // Supervisor tick
        const supervisorResult = await this.supervisor.tick()

        // Check if it's time to send order report
        if (this.orderReporter.shouldSendReport() && this.trading instanceof LiveTrading) {
          const sinceTime = Date.now() - (4 * 60 * 60 * 1000) // Last 4 hours
          const orders = this.trading.getOrderHistory(sinceTime)
          const stats = this.trading.getOrderStats(sinceTime)
          await this.orderReporter.sendReport(orders, stats)
        }

        // Log status
        this.logStatus(supervisorResult)

        // ═════════════════════════════════════════════════════════════════════
        // SANITY ASSERTIONS - Cheap runtime checks on every iteration
        // ═════════════════════════════════════════════════════════════════════
        const currentState = this.stateManager.getState()
        if (!Number.isFinite(currentState.dailyPnl)) {
          this.notifier.warn('⚠️  NaN dailyPnl detected')
        }

        // 🚀 IMMEDIATE SIGNAL: Check if AlphaEngine has high-priority signals
        // If so, reduce sleep time for faster reaction to whale moves
        const hasImmediateSignal = alphaEngineIntegration.hasImmediateSignals()
        if (hasImmediateSignal) {
          const immediateSignal = alphaEngineIntegration.popImmediateSignal()
          if (immediateSignal) {
            this.notifier.info(
              `🚀 [GRID] FORCE UPDATE: Processing IMMEDIATE signal for ${immediateSignal.coin}! ` +
              `Action=${immediateSignal.action} Conf=${immediateSignal.confidence}%`
            )
            // Fast cycle - only 5s delay instead of normal 60s
            await this.sleep(5000)
            continue // Skip to next iteration immediately
          }
        }

        // Normal sleep
        await this.sleep(this.intervalSec * 1000)

      } catch (error) {
        this.notifier.error(`Error in main loop: ${error}`)
        this.stateManager.recordExecution(false)
        await this.sleep(5000)
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Smart Rotation
  // ───────────────────────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────────────────────
  // Smart Money & Whale Scoring Logic (Zgodna z Pythonem)
  // ───────────────────────────────────────────────────────────────────────────

  private calculateCompositeScore(data: GoldenDuoData): { score: number; confidence: number; warnings: string[]; bias: NansenBias; whaleRisk: NansenWhaleRisk } {
    let smScore = 0
    let whaleScore = 0
    const warnings: string[] = []

    // 🛡️ uPnL / ROI Weighting Logic
    let pnlWeight = 1.0
    if (data.top_traders_pnl === 'positive' || data.top_traders_pnl === 'shorts_winning') {
      pnlWeight = 1.5 // Winner bonus
    } else if (data.top_traders_pnl === 'negative' || data.top_traders_pnl === 'longs_underwater') {
      pnlWeight = 0.5 // Bagholder penalty
    }

    // 1. SMART MONEY SCORING (60% weight)
    const smUsd = data.sm_net_balance_usd || 0
    if (smUsd > 50_000_000) smScore = 100
    else if (smUsd > 10_000_000) smScore = 70
    else if (smUsd > 1_000_000) smScore = 40
    else if (smUsd < -50_000_000) smScore = -100
    else if (smUsd < -10_000_000) smScore = -70
    else if (smUsd < -1_000_000) smScore = -40

    // Apply uPnL weight to SM score
    smScore *= pnlWeight

    // 2. WHALE SCORING (40% weight)
    const whaleUsd = data.whale_net_balance_usd || 0
    if (whaleUsd > 50_000_000) whaleScore = 100
    else if (whaleUsd > 10_000_000) whaleScore = 70
    else if (whaleUsd > 1_000_000) whaleScore = 40
    else if (whaleUsd < -50_000_000) whaleScore = -100
    else if (whaleUsd < -10_000_000) whaleScore = -70
    else if (whaleUsd < -1_000_000) whaleScore = -40

    const combinedScore = (smScore * 0.6) + (whaleScore * 0.4)

    // 3. CONFIDENCE & BIAS MAPPING
    let confidence = 0.4
    if ((smScore > 0 && whaleScore > 0) || (smScore < 0 && whaleScore < 0)) {
      confidence = 0.8 + (Math.min(Math.abs(smScore), Math.abs(whaleScore)) / 500)
    }

    const smHolders = Number(data.sm_holders ?? 9999)
    if (smHolders < 20) {
      warnings.push(`LOW_LIQUIDITY (${smHolders} SM holders)`)
      confidence *= 0.5
    }

    if (data.whale_dump_alert) {
      warnings.push('WHALE_DUMP_ALERT')
      if (combinedScore > 0) confidence *= 0.3
    }

    if ((smUsd > 0 && whaleUsd < -5_000_000) || (smUsd < 0 && whaleUsd > 5_000_000)) {
      warnings.push('SM_WHALE_DIVERGENCE')
      confidence *= 0.2
    }

    let bias: NansenBias = 'neutral'
    if (combinedScore >= 25) bias = 'bull'
    else if (combinedScore <= -25) bias = 'bear'

    let whaleRisk: NansenWhaleRisk = 'medium'
    if (whaleScore <= -70) whaleRisk = 'high'
    else if (whaleScore >= 40) whaleRisk = 'low'

    return { score: combinedScore, confidence, warnings, bias, whaleRisk }
  }

  private async runSmartRotation(
    candidatePairs: string[],
  ): Promise<string[]> {
    if (!process.env.ROTATION_ENABLED || process.env.ROTATION_ENABLED !== 'true') {
      return candidatePairs
    }

    if (process.env.ROTATION_MODE !== 'top3') {
      return candidatePairs
    }

    // New SmartRotationEngine doesn't handle cooldowns, logic moved to rotateIfNeeded
    // Just rank them here.

    const analyses: PairAnalysisLite[] = []

    for (const pair of candidatePairs) {
      const analysis = this.marketVision.getPairAnalysis(pair)
      const visual: any = analysis?.visualAnalysis || {}

      // Get Nansen Data
      let nansenBias: NansenBias = 'unknown'
      let nansenWhaleRisk: NansenWhaleRisk = 'unknown'
      let nansenScore = analysis?.nansenScore

      const symbol = pair.split('/')[0].toUpperCase()
      const config = NANSEN_TOKENS[symbol] || { chain: 'hyperliquid', address: symbol }

      // Get fresh data from Golden Duo Cache (already synced by Strategic Worker)
      const gdSignal = this.goldenDuoData[symbol] || this.goldenDuoData[symbol.toLowerCase()]

      if (gdSignal) {
        const composite = this.calculateCompositeScore(gdSignal)
        nansenBias = composite.bias
        nansenWhaleRisk = composite.whaleRisk
        nansenScore = composite.score

        if (composite.warnings.length > 0) {
          console.log(`⚠️ [NANSEN] ${pair} warnings: ${composite.warnings.join(', ')} (conf=${(composite.confidence * 100).toFixed(0)}%)`)
        }
      } else {
        // Fallback to legacy if available, but primarily use GoldenDuo
        try {
          if (config && this.nansen && this.nansen.isEnabled()) {
            const signals = await this.nansen.getTokenFlowSignals(config.address, config.chain)
            if (signals) {
              if (signals.smartMoneyNet > 100000) nansenBias = 'bull'
              else if (signals.smartMoneyNet < -100000) nansenBias = 'bear'
              else nansenBias = 'neutral'

              const whaleNet = Math.abs(signals.whaleNet)
              if (whaleNet > 5000000) nansenWhaleRisk = 'high'
              else if (whaleNet > 1000000) nansenWhaleRisk = 'medium'
              else nansenWhaleRisk = 'low'
            }
          }
        } catch (e) { }
      }

      // Map trend to 0..1
      let trendScore = 0.5
      const t4h = analysis?.trend4h
      if (t4h === 'bull') trendScore = 1.0
      else if (t4h === 'bear') trendScore = 0.0
      else trendScore = 0.5

      // Map visual risk (0-10) to 0..1 (where 1 is risky)
      let riskScore = 0.5
      if (visual?.riskScore !== undefined) {
        riskScore = visual.riskScore / 10.0
      }

      // 🧠 Intelligence Score Components
      const lt = this.trading as LiveTrading;
      const vpin = lt.vpinAnalyzers?.get(pair)?.calculateVPIN();
      const whaleIntelShift = lt.whaleIntel?.getAlphaShiftBps(symbol);

      // Get latest funding rate for this pair
      let fundingRate = 0;
      let midPxForPair = 0;
      try {
        const [meta, ctxs] = await this.api.getMetaAndAssetCtxs();
        const pairData = ctxs.find(ctx => ctx.coin === pair);
        fundingRate = Number(pairData?.funding || 0);
        midPxForPair = Number(pairData?.midPx || 0);
      } catch (e) {
        // ignore fetch error
      }

      // SmartRotationEngine expects its own NansenBias type; map our legacy bias values.
      const rotationBias: import('./rotation/smart_rotation.js').NansenBias =
        nansenBias === 'bull' || nansenBias === 'long'
          ? 'bull'
          : nansenBias === 'bear' || nansenBias === 'short'
            ? 'bear'
            : nansenBias === 'neutral'
              ? 'neutral'
              : 'unknown'

      const a: PairAnalysisLite = {
        symbol: pair,
        trendScore,
        volumeScore: 0.5, // Default volume score
        riskScore,
        nansenBias: rotationBias,
        nansenScore,
        nansenWhaleRisk,
        vpin,
        fundingRate,
        whaleIntelShift,
        // Pass full USD data for Smart Rotation 2.0
        smartMoneyData: gdSignal ? {
          netBalance: 0,
          netBalanceUsd: gdSignal.sm_net_balance_usd || 0,
          holders: Number((gdSignal as any).sm_holders || 0),
          longs24hUsd: 0,
          shorts24hUsd: 0
        } : undefined,
        whaleData: gdSignal ? {
          netBalance: 0,
          netBalanceUsd: gdSignal.whale_net_balance_usd || 0,
          holders: Number((gdSignal as any).whale_holders || 0),
          longs24hUsd: 0,
          shorts24hUsd: 0
        } : undefined,
        priceUsd: midPxForPair || 0
      }

      analyses.push(a)
    }

    const maxActive = Number(process.env.ROTATION_MAX_ACTIVE_PAIRS || 3)
    const ranked = this.smartRotationEngine.rankPairs(analyses, maxActive)

    const topPairs = ranked.map(r => r.symbol)

    const pretty = ranked
      .map(
        r =>
          `${r.symbol} (score=${r.score.toFixed(3)}, ` +
          `bias=${r.nansenBias}, whale=${r.nansenWhaleRisk}, ` +
          `vpin=${r.vpin !== undefined ? (r.vpin * 100).toFixed(0) + '%' : 'N/A'}, ` +
          `fund=${r.fundingRate !== undefined ? (r.fundingRate * 10000).toFixed(1) + 'bps' : 'N/A'})`
      )
      .join(' | ')

    this.notifier.info(
      `🔄 [SMART ROTATION] candidates=${candidatePairs.join(', ')} → top=${topPairs.join(', ')}`,
    )
    this.notifier.info(`   [SMART ROTATION DETAIL] ${pretty}`)

    // 🩺 Telemetry
    if (Math.random() < 0.1) {
      this.notifier.info(`🩺 [SMART ROTATION HEALTH] lastRun=${new Date().toISOString()} nansenOk=${!!this.nansen && this.nansen.isEnabled()} pairs=${topPairs.length}`)
    }

    this.lastSmartRotationPairs = topPairs
    return topPairs
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Volatility Rotation
  // ───────────────────────────────────────────────────────────────────────────

  async rotateIfNeeded() {
    // Manual mode or disabled rotation: do not auto-rotate / close positions automatically.
    // Active pairs are handled below via MANUAL_ACTIVE_PAIRS in the main loop.
    const rotationEnabled = process.env.ROTATION_ENABLED === 'true'
    const rotationMode = process.env.ROTATION_MODE ?? 'auto'
    if (!rotationEnabled || rotationMode === 'manual') {
      return
    }

    const now = Date.now()

    if (now - this.lastRotationTime < this.rotationIntervalSec * 1000) {
      return // Not time yet
    }

    this.notifier.info('🔄 Checking volatility rotation...')

    // Check copy-trading signals if enabled
    let copyTradingSignals: CopyTradingSignal[] = []
    if (this.enableCopyTrading && this.nansen.isEnabled()) {
      try {
        copyTradingSignals = await this.nansen.getCopyTradingSignals(
          this.copyTradingMinConfidence,
          this.copyTradingMinTraders
        )

        if (copyTradingSignals.length > 0) {
          this.notifier.info(`🔥 Found ${copyTradingSignals.length} copy-trading signals`)
          for (const sig of copyTradingSignals.slice(0, 3)) {
            this.notifier.info(`   ${sig.side === 'LONG' ? '🟢' : '🔴'} ${sig.token_symbol}: ${sig.confidence}% confidence (${sig.trader_count} traders)`)
          }
          // Store signals for use during execution
          this.storeCopyTradingSignals(copyTradingSignals)
        }
      } catch (error) {
        this.notifier.warn(`Copy-trading signals failed: ${error}`)
      }
    }

    try {
      // 1) Get candidate pairs from volatility rotation
      const topPairs = await this.rotation.getTop3Pairs()
      const candidatePairs = topPairs.map(s => s.pair)

      // 2) Run Smart Rotation 2.0 (VPIN + Whale + Funding)
      const orderedBySmartRotation = await this.runSmartRotation(candidatePairs)

      // 3) Target size and check if rotation is needed
      const targetCount = Math.min(
        MAX_ACTIVE_PAIRS,
        Number(process.env.ROTATION_TARGET_COUNT || 3)
      )

      const currentPairs = this.rotation.getCurrentPairs()
      const hasOverflow = currentPairs.length > targetCount

      // Check for overdue pairs
      const maxHoldMs = this.getMaxRotationHoldMs()
      const overduePairs = currentPairs.filter(p => this.isRotationOverdue(p))

      if (overduePairs.length > 0) {
        this.notifier.warn(`[ROTATION] Overdue pairs: ${overduePairs.join(',')} (maxHoldHours=${(maxHoldMs / 3600000).toFixed(1)})`)
      }

      const shouldRotate =
        currentPairs.length === 0 ||
        orderedBySmartRotation.length === 0 ||
        !orderedBySmartRotation.every((p: string) => currentPairs.includes(p)) ||
        orderedBySmartRotation[0] !== currentPairs[0] ||
        overduePairs.length > 0 ||
        hasOverflow

      if (shouldRotate) {
        const freshCandidates = orderedBySmartRotation.slice(0, targetCount * 2)
        let nextPairs = [...currentPairs].filter(p => !overduePairs.includes(p))

        for (const sym of freshCandidates) {
          if (nextPairs.length >= targetCount) break
          if (!nextPairs.includes(sym)) {
            nextPairs.push(sym)
          }
        }

        const newPairs = nextPairs.slice(0, targetCount)
        this.notifier.info(`🚀 [ROTATION COMPLETED] Active set: ${newPairs.join(', ')}`)
        this.notifier.info(`   Reason: Intelligence Score 2.0 (VPIN + Whale + Funding)`)

        // Update rotation state manually
        const rotationState = (this.rotation as any).state
        if (rotationState) {
          rotationState.currentPairs = newPairs
          rotationState.lastUpdate = Date.now()
            ; (this.rotation as any).saveState()
        }

        for (const p of newPairs) {
          if (!this.rotationSince[p]) this.markRotationEntered(p)
        }
        for (const old of Object.keys(this.rotationSince)) {
          if (!newPairs.includes(old)) delete this.rotationSince[old]
        }

        if (!this.isDryRun && this.trading instanceof LiveTrading) {
          const targetLeverage = Number(process.env.LEVERAGE || 1)
          for (const pair of newPairs) {
            try { await (this.trading as LiveTrading).setLeverage(pair, targetLeverage) } catch (e) { }
          }
        }

        this.lastRotationTime = Date.now()
        await this.closeOldPositions(newPairs)
      } else {
        this.notifier.info(`✅ [ROTATION STABLE] Matches Intelligence Score 2.0 target: ${currentPairs.join(', ')}`)
        this.lastRotationTime = Date.now()
      }
    } catch (error) {
      this.notifier.error(`Error in rotation: ${error}`)
    }
  }

  async closeOldPositions(newPairs: string[]) {
    const state = this.stateManager.getState()
    const positionsToClose = Object.keys(state.positions).filter(pair => !newPairs.includes(pair))

    const minLossToClose = parseFloat(process.env.MIN_LOSS_TO_CLOSE_USD || '-5') // Only close if loss < $5

    for (const pair of positionsToClose) {
      const pos = state.positions[pair]

      // Get current market price to calculate potential PnL
      try {
        // Use trading.infoClient if available, otherwise skip
        const infoClient = (this.trading as any).infoClient
        if (!infoClient) {
          console.warn(`No infoClient available for ${pair}, skipping PnL calculation`)
          continue
        }
        const l2 = await infoClient.l2Book({ coin: pair })
        if (!l2 || !l2.levels) {
          console.warn(`No L2 data for ${pair}, skipping PnL calculation`)
          continue
        }
        const bestBid = parseFloat(l2.levels[1]?.[0]?.px || '0')
        const bestAsk = parseFloat(l2.levels[0]?.[0]?.px || '0')
        const currentPrice = pos.side === 'long' ? bestBid : bestAsk

        // Calculate expected PnL
        const expectedPnl = pos.side === 'long'
          ? (currentPrice - pos.entryPrice) * pos.size
          : (pos.entryPrice - currentPrice) * pos.size

        // Only close if profitable OR small acceptable loss
        // minLossToClose = -50 (negative), expectedPnl = -0.14 (small loss)
        // Skip if loss exceeds threshold: -0.14 > -50 means loss is SMALLER than threshold, so close it
        // Skip if loss exceeds threshold: -60 > -50 is FALSE, means loss EXCEEDS threshold, so skip
        if (expectedPnl < minLossToClose) {
          this.notifier.warn(`   ⏸️  Skipping close for ${pair}: Expected loss $${expectedPnl.toFixed(2)} exceeds threshold $${minLossToClose} - will retry next rotation`)
          continue
        }

        this.notifier.info(`   Closing ${pair} position: ${pos.side} ${pos.size} (Expected PnL: $${expectedPnl.toFixed(2)})`)

        // Place reduce-only order to close position
        const closeResult = await this.trading.placeOrder(
          pair,
          pos.side === 'long' ? 'sell' : 'buy',
          currentPrice, // Use current market price
          pos.size,
          'market', // Will use IOC for fast execution
          true // reduce-only flag
        )

        if (closeResult.success && closeResult.fillPrice) {
          const actualPnl = pos.side === 'long'
            ? (closeResult.fillPrice - pos.entryPrice) * pos.size
            : (pos.entryPrice - closeResult.fillPrice) * pos.size

          this.stateManager.recordTrade(pair, 'close', closeResult.fillPrice, pos.size, actualPnl)
          this.stateManager.updatePosition(pair, 0, 0, 'long')
          this.notifier.info(`   ✓ Closed ${pair}: PnL $${actualPnl.toFixed(2)}`)
        }
      } catch (error) {
        this.notifier.error(`   Failed to close ${pair}: ${error}`)
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Legacy Position Management
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Get all pairs with open positions from the account
   */
  async getAllPositionPairs(): Promise<string[]> {
    let retries = 0
    const maxRetries = 3

    while (retries < maxRetries) {
      try {
        // Delegate to trading instance to get positions
        if (!(this.trading instanceof LiveTrading)) {
          this.notifier.warn(`getAllPositionPairs requires LiveTrading instance`)
          return []
        }

        const infoClient = (this.trading as any).infoClient
        const walletAddress = (this.trading as any).walletAddress

        if (!infoClient || typeof infoClient.clearinghouseState !== 'function') {
          this.notifier.warn(`InfoClient not initialized in LiveTrading`)
          return []
        }

        const userState = await infoClient.clearinghouseState({ user: walletAddress })

        if (!userState || !userState.assetPositions) {
          return []
        }

        // Extract pairs with non-zero position sizes
        const positionPairs = userState.assetPositions
          .filter((pos: any) => {
            const size = Math.abs(parseFloat(pos.position?.szi || '0'))
            return size > 0
          })
          .map((pos: any) => pos.position?.coin || '')
          .filter((pair: string) => pair !== '')

        return positionPairs
      } catch (error: any) {
        const errStr = String(error)
        const errMsg = error?.message || ''
        const fullMsg = (errStr + ' ' + errMsg).toLowerCase()
        const isRateLimit = fullMsg.includes('429') || fullMsg.includes('too many requests') || fullMsg.includes('venue unreachable')

        if (isRateLimit) {
          retries++
          const delay = 5000 * Math.pow(2, retries) // 10s, 20s, 40s
          this.notifier.warn(
            `⚠️ [HL-MM] Rate limit in getAllPositionPairs (attempt ${retries}/${maxRetries}). Sleeping ${delay}ms...`
          )
          await this.sleep(delay)
          continue
        }

        this.notifier.warn(`Failed to get position pairs: ${errStr}`)
        return []
      }
    }
    return []
  }

  /**
   * 🔔 Process Nansen alert queue from Telegram (via ai-executor)
   * Reads alerts from /tmp/nansen_raw_alert_queue.json and processes via NansenAlertIntegration
   */
  private async processNansenAlertQueue(): Promise<void> {
    const ALERT_QUEUE_FILE = '/tmp/nansen_raw_alert_queue.json'
    try {
      if (!fs.existsSync(ALERT_QUEUE_FILE)) return

      const content = fs.readFileSync(ALERT_QUEUE_FILE, 'utf8')
      const queue: Array<{ timestamp: string; message: string; token: string; processed: boolean }> = JSON.parse(content)

      const unprocessedCount = queue.filter(a => !a.processed).length
      if (unprocessedCount > 0) {
        console.log(`📥 [NANSEN_QUEUE] Processing ${unprocessedCount} unprocessed alerts...`)
      }

      let hasProcessed = false
      for (const alert of queue) {
        if (alert.processed) continue

        console.log(`📥 [NANSEN_QUEUE] Processing alert for ${alert.token}: ${alert.message.substring(0, 60)}...`)

        // Process alert through NansenAlertIntegration
        const decision = processNansenAlert(alert.message, alert.token)

        if (decision) {
          console.log(`🔔 [NANSEN_ALERT_QUEUE] Processed ${alert.token}: ${decision.action} (${decision.confidence}%) - ${decision.reason}`)

          // Handle immediate actions
          if (decision.action === 'LOCK_BIDS') {
            nansenIntegration.setLock('bid', decision.reason)
          } else if (decision.action === 'LOCK_ASKS') {
            nansenIntegration.setLock('ask', decision.reason)
          } else if (decision.action === 'CLOSE_LONG' || decision.action === 'CLOSE_SHORT') {
            console.log(`🔔 [NANSEN_ALERT_QUEUE] Position close signal queued for ${alert.token}`)
          }

          this.notifier.info(`🔔 [NANSEN] ${alert.token}: ${decision.action} - ${decision.reason}`)
        }

        alert.processed = true
        hasProcessed = true
      }

      // Save updated queue
      if (hasProcessed) {
        const processedAlerts = queue.filter(a => a.processed).slice(-5)
        const unprocessedAlerts = queue.filter(a => !a.processed)
        fs.writeFileSync(ALERT_QUEUE_FILE, JSON.stringify([...unprocessedAlerts, ...processedAlerts], null, 2))
      }
    } catch (err: any) {
      console.error(`❌ [NANSEN_QUEUE] Error processing queue: ${err.message}`)
    }
  }

  /**
   * Check for Nansen strong conflicts and auto-close positions that exceed risk limits
   */
  private async checkNansenConflicts(): Promise<void> {
    try {
      if (!(this.trading instanceof LiveTrading)) {
        return
      }

      const walletAddress = (this.trading as any).walletAddress

      const userState = await this.api.getClearinghouseState(walletAddress)
      if (!userState || !userState.assetPositions) {
        return
      }

      // Load Nansen bias data
      const biases = this.nansenBiasCache.data

      const now = Date.now()

      // Check each position for strong conflicts
      for (const assetPos of userState.assetPositions) {
        const pos = assetPos.position
        if (!pos) continue

        const size = parseFloat(pos.szi || '0')
        if (Math.abs(size) < 1e-6) continue

        const pair = pos.coin
        const posDir = size > 0 ? 'long' : 'short'
        const unrealizedPnl = parseFloat(pos.unrealizedPnl || '0')
        const positionValue = parseFloat((pos as any).positionValue || '0')
        const notional = Math.abs(positionValue)

        const bias = biases[pair]
        if (!bias) continue

        const biasDir = (bias.direction || 'neutral').toLowerCase()
        const biasStrength = bias.biasStrength || 'neutral'
        const biasBoost = bias.boost || 0

        if (biasStrength !== 'strong') continue

        const isConflict =
          (posDir === 'long' && biasDir === 'short') ||
          (posDir === 'short' && biasDir === 'long')

        if (!isConflict) continue

        let shouldClose = false
        let closeReason = ''

        // Trigger 1: Small position
        if (notional < this.nansenStrongContraHardCloseUsd) {
          shouldClose = true
          closeReason = `notional below hard close threshold ($${notional.toFixed(2)} < $${this.nansenStrongContraHardCloseUsd})`
        }

        // Trigger 2: Excessive loss
        if (unrealizedPnl <= -this.nansenStrongContraMaxLossUsd) {
          shouldClose = true
          closeReason = `uPnL below max loss limit ($${unrealizedPnl.toFixed(2)} <= -$${this.nansenStrongContraMaxLossUsd})`
        }

        // Trigger 3: Position age
        if (bias.updatedAt) {
          try {
            const biasTimestamp = new Date(bias.updatedAt).getTime()
            const ageHours = (now - biasTimestamp) / (1000 * 60 * 60)
            if (ageHours >= this.nansenStrongContraMaxHours) {
              shouldClose = true
              closeReason = `conflict age exceeds max hold time (${ageHours.toFixed(1)}h >= ${this.nansenStrongContraMaxHours}h)`
            }
          } catch (err) {
            // Skip age check
          }
        }

        if (shouldClose) {
          // 🚫 BYPASS AUTO-CLOSE FOR FOLLOW_SM MODES (Unholy Trinity protection)
          // In high-conviction SM-following mode, we trust on-chain data over bias conflicts
          // The "conflict" is expected - we're deliberately going against short-term bias
          const pairConfig = NANSEN_TOKENS[pair.toUpperCase()]?.tuning
          const isFollowSmMode = pairConfig?.followSmMode === 'FOLLOW_SM_SHORT' ||
                                  pairConfig?.followSmMode === 'FOLLOW_SM_LONG' ||
                                  pair === 'FARTCOIN' || pair === 'VIRTUAL' || pair === 'LIT'

          if (isFollowSmMode) {
            this.notifier.warn(
              `🛑 BYPASS Nansen conflict auto-close: ${pair} (FOLLOW_SM mode) | Would close: ${closeReason} | IGNORING`
            )
            continue // Skip auto-close, keep position
          }

          this.notifier.warn(
            `🛡️  Nansen strong conflict auto-close: ${pair} ${posDir.toUpperCase()} vs bias ${biasDir.toUpperCase()} +${biasBoost.toFixed(2)} | ${closeReason}`
          )

          if (this.trading instanceof LiveTrading) {
            await (this.trading as LiveTrading).closePositionForPair(pair, 'nansen_strong_conflict')
          }
        }
      }
    } catch (error: any) {
      this.notifier.warn(`Failed to check Nansen conflicts: ${error?.message ?? error}`)
    }
  }

  /**
   * Apply rotation pair limits - ensure we don't exceed MAX_ACTIVE_PAIRS
   * and close positions for pairs that are no longer in rotation.
   *
   * @param rotatedPairs - pairs suggested by rotation engine (Nansen + volatility)
   */
  private async applyRotationPairs(rotatedPairs: string[]): Promise<string[]> {
    try {
      // Check for manual rotation mode override
      const rotationMode = process.env.ROTATION_MODE ?? 'auto'
      const manualPairs = (process.env.MANUAL_ACTIVE_PAIRS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)

      let effectivePairs = rotatedPairs
      if (rotationMode === 'manual' && manualPairs.length > 0) {
        this.notifier.info(`[INFO] ROTATION_MODE=manual`)
        this.notifier.info(`[INFO] Using MANUAL_ACTIVE_PAIRS=${manualPairs.join(',')}`)

        // Allow Nansen suggestions to be added if they are strong
        const nansenPairs = rotatedPairs.filter(p => !manualPairs.includes(p))
        if (nansenPairs.length > 0) {
          this.notifier.info(`[INFO] Nansen suggests: ${nansenPairs.join(',')} - merging with manual pairs`)
          effectivePairs = [...manualPairs, ...nansenPairs]
        } else {
          effectivePairs = manualPairs
        }
      }

      // 🔍 DEBUG: Entry point
      this.notifier.info(
        `🧭 Rotation input: rotatedPairs=${effectivePairs.join(', ') || '∅'} | max=${MAX_ACTIVE_PAIRS}`
      )

      // 1. Limit rotation list to MAX_ACTIVE_PAIRS and merge stickies with cap respected
      const desiredPairs = effectivePairs.slice(0, MAX_ACTIVE_PAIRS)

      const stickyPairs = STICKY_PAIRS.filter(Boolean)
      if (stickyPairs.length > 0) {
        this.notifier.info(`🧲 Sticky pairs: ${stickyPairs.join(', ')}`)
      }

      // Prioritize sticky pairs, then rotation candidates, then cap to MAX_ACTIVE_PAIRS
      const merged: string[] = []
      for (const p of stickyPairs) {
        if (!merged.includes(p)) merged.push(p)
      }
      for (const p of desiredPairs) {
        if (!merged.includes(p)) merged.push(p)
      }

      let allowedList = merged
      if (merged.length > MAX_ACTIVE_PAIRS) {
        const dropped = merged.slice(MAX_ACTIVE_PAIRS)
        allowedList = merged.slice(0, MAX_ACTIVE_PAIRS)
        this.notifier.warn(
          `📉 Active pairs capped to MAX_ACTIVE_PAIRS=${MAX_ACTIVE_PAIRS}; dropped: ${dropped.join(', ')}`
        )
      }

      this.notifier.info(
        `📊 Allowed pairs (rotation + sticky): ${allowedList.join(', ') || '∅'} (count=${allowedList.length}/${MAX_ACTIVE_PAIRS})`
      )

      const allowedSet = new Set<string>(allowedList)

      // 3. Get current open positions
      const currentPairs = await this.getAllPositionPairs()
      this.notifier.info(
        `📊 Current position pairs: ${currentPairs.join(', ') || '∅'}`
      )

      // 4. Determine which pairs to close (in current positions BUT NOT in desired list)
      const pairsToClose: string[] = []
      for (const pair of currentPairs) {
        if (!allowedSet.has(pair)) {
          pairsToClose.push(pair)
        }
      }

      // 5. Close positions and cancel orders for pairs that dropped out of rotation
      if (pairsToClose.length === 0) {
        this.notifier.info(
          '🧹 Rotation cleanup: no positions to close (all positions within allowed set)'
        )
      } else {
        this.notifier.info(
          `🧹 Rotation cleanup: closing ${pairsToClose.length} pairs outside rotation: ${pairsToClose.join(', ')}`
        )

        for (const pair of pairsToClose) {
          try {
            this.notifier.info(`   ⏱️  Cleanup ${pair}: cancelling orders...`)

            // Cancel orders first
            if (this.trading instanceof LiveTrading) {
              await (this.trading as LiveTrading).cancelPairOrders(pair)
            }

            this.notifier.info(`   💥 Cleanup ${pair}: closing position...`)

            // Then close position
            if (this.trading instanceof LiveTrading) {
              await (this.trading as LiveTrading).closePositionForPair(pair, 'rotation_cleanup')
            }

            this.notifier.info(`   ✅ Cleanup done for ${pair}`)
          } catch (err: any) {
            this.notifier.error(`   ❌ Cleanup error for ${pair}: ${err?.message ?? err}`)
          }
        }
      }

      // Log active pairs summary
      const activePairsList = Array.from(allowedSet).join(', ')
      this.notifier.info(
        `📊 Active pairs (allowed set) after cleanup: ${activePairsList} (${allowedSet.size}/${MAX_ACTIVE_PAIRS})`
      )

      // Return the allowed list so caller can use it
      return Array.from(allowedSet)
    } catch (error: any) {
      this.notifier.error(`❌ applyRotationPairs failed: ${error?.message ?? error}`)
      return [] // Return empty array on error
    }
  }

  /**
   * Check if legacy positions are profitable and close them
   */
  async checkAndCloseProfitableLegacyPositions(legacyPairs: string[], assetCtxs: any[]) {
    const minProfitPct = parseFloat(process.env.LEGACY_PROFIT_THRESHOLD_PCT || '0.5') // Default: 0.5%

    for (const pair of legacyPairs) {
      try {
        // Defensive check: ensure API clients are initialized
        if (!this.infoClient || typeof this.infoClient.clearinghouseState !== 'function') {
          this.notifier.warn(`API infoClient not initialized for legacy position check`)
          continue
        }

        // Get position info from account
        const userState = await this.infoClient.clearinghouseState({ user: this.walletAddress })
        if (!userState?.assetPositions) continue

        const positionData = userState.assetPositions.find((p: any) => p.position?.coin === pair)
        if (!positionData?.position) continue

        const szi = parseFloat(positionData.position.szi)
        if (Math.abs(szi) === 0) continue

        const entryPx = parseFloat(positionData.position.entryPx || '0')
        const unrealizedPnl = parseFloat(positionData.position.unrealizedPnl || '0')

        // Get current market price
        const pairData = assetCtxs.find(ctx => ctx.coin === pair)
        if (!pairData) continue

        const midPrice = parseFloat(pairData.midPx || '0')
        if (midPrice === 0) continue

        // Calculate profit percentage
        const positionSize = Math.abs(szi)
        const positionValueUsd = positionSize * entryPx
        const profitPct = (unrealizedPnl / positionValueUsd) * 100

        this.notifier.info(`📊 ${pair} Legacy PnL: $${unrealizedPnl.toFixed(2)} (${profitPct.toFixed(2)}%)`)

        // Close if profitable enough
        if (profitPct >= minProfitPct) {
          this.notifier.info(`💰 Closing profitable legacy position: ${pair} at ${profitPct.toFixed(2)}% profit`)

          // Determine side for closing (opposite of current position)
          const side = szi > 0 ? 'sell' : 'buy'

          // Place reduce-only order to close position
          const closeResult = await this.trading.placeOrder(
            pair,
            side,
            midPrice,
            positionSize,
            'market', // Use market order for fast execution
            // true (reduceOnly) handled by order logic or overloaded args
          )

          if (closeResult.success && closeResult.fillPrice) {
            const actualPnl = parseFloat(positionData.position.unrealizedPnl || '0')
            this.stateManager.recordTrade(pair, 'close', closeResult.fillPrice, positionSize, actualPnl)
            this.notifier.info(`✅ Closed ${pair} legacy position: PnL $${actualPnl.toFixed(2)}`)
          }
        }
      } catch (error) {
        this.notifier.warn(`Failed to check/close legacy position for ${pair}: ${error}`)
      }
    }
  }

  /**
   * Store copy-trading signals for reference during execution
   * (Can be used to adjust order sizing or prioritize certain pairs)
   */
  private copyTradingSignalMap: Map<string, CopyTradingSignal> = new Map()

  private storeCopyTradingSignals(signals: CopyTradingSignal[]) {
    this.copyTradingSignalMap.clear()
    for (const sig of signals) {
      this.copyTradingSignalMap.set(sig.token_symbol, sig)
    }
  }

  private getCopyTradingSignal(pair: string): CopyTradingSignal | undefined {
    return this.copyTradingSignalMap.get(pair)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Market Making Execution
  // ───────────────────────────────────────────────────────────────────────────

  async executeMM(pairs: string[], activePairs: string[] = []) {
    // ⚡ OPTIMIZED: Fetch market data ONCE for all pairs (major latency improvement!)
    // Added retry logic for 429/Rate Limits
    let meta: any, assetCtxs: any
    let retries = 0
    const maxRetries = 3

    while (retries < maxRetries) {
      try {
        ;[meta, assetCtxs] = await this.api.getMetaAndAssetCtxs()
        break // Success
      } catch (error: any) {
        const errStr = String(error)
        const errMsg = error?.message || ''
        const fullMsg = (errStr + ' ' + errMsg).toLowerCase()

        if (fullMsg.includes('429') || fullMsg.includes('too many requests') || fullMsg.includes('venue unreachable')) {
          retries++
          const delay = 5000 * Math.pow(2, retries) // 10s, 20s, 40s
          this.notifier.warn(
            `⚠️ [HL-MM] Rate limit in executeMM data fetch (attempt ${retries}/${maxRetries}). Sleeping ${delay}ms...`
          )
          await this.sleep(delay)
          if (retries >= maxRetries) throw error
        } else {
          throw error // Rethrow non-rate-limit errors immediately
        }
      }
    }

    // Identify legacy pairs (positions not in top 3)
    const legacyPairs = pairs.filter(p => !activePairs.includes(p))

    if (legacyPairs.length > 0) {
      this.notifier.info(`📦 Legacy positions: ${legacyPairs.join(', ')} - continuing market-making`)
    }

    // ⚡ OPTIMIZED: Execute all pairs in parallel with shared market data
    // ONLY trade active pairs (respects STICKY_PAIRS + rotation selection)
    await Promise.all(
      activePairs.map(async (pair) => {
        try {
          await this.executePairMM(pair, assetCtxs)
        } catch (error) {
          this.notifier.error(`Error executing MM for ${pair}: ${error}`)
          this.stateManager.recordExecution(false)
        }
      })
    )
  }

  // ───────────────────────────────────────────────────────────────────────────
  // INSTITUTIONAL MULTI-LAYER MARKET MAKING
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Compute per-asset clip that guarantees ≥ min notional after rounding
   *
   * Returns {clipUsd, coinStep, coinsRounded, usdRounded}
   *
   * Logic:
   * 1. coinStep = max(lotSize, 10^-guessedSzDecimals)
   * 2. Round *up* (Math.ceil) so we never go below minNotional
   * 3. Return both coin-based and USD-based rounded values
   */
  private computePerAssetClip(
    pair: string,
    midPx: number,
    globalClipUsd: number,
    minNotionalUsd: number,
    specs: { lotSize?: number },
    guessedSzDecimals: number
  ): { clipUsd: number; coinStep: number; coinsRounded: number; usdRounded: number } {
    // Use centralized helper for coin step
    const coinStep = coinStepFrom(specs, guessedSzDecimals)

    // Start with the larger of globalClip or minNotional
    const targetUsd = Math.max(globalClipUsd, minNotionalUsd)

    // Convert to coins
    const rawCoins = targetUsd / midPx

    // Round UP to next coin step (ceiling) using exact quantization
    const coinsRounded = quantizeCeil(rawCoins, coinStep)

    // Recompute USD value after rounding
    const usdRounded = coinsRounded * midPx

    // Final clip is the rounded-up USD value (plus small buffer for safety)
    const clipUsd = Math.max(globalClipUsd, Math.ceil(usdRounded + 0.5))

    console.log(
      `[DEBUG CLIP] ${pair}: ` +
      `px=${midPx.toFixed(2)}, szDec=${guessedSzDecimals}, coinStep=${coinStep}, ` +
      `raw=${rawCoins.toFixed(4)}coin, ceil=${coinsRounded}coin, ` +
      `clipUsd=${clipUsd}`
    )

    return { clipUsd, coinStep, coinsRounded, usdRounded }
  }

  /**
   * Get Nansen directional bias for a trading pair (for risk management)
   * Returns 'long' for strong bullish signals, 'short' for bearish, 'neutral' otherwise
   */
  private getNansenBiasForPair(pair: string): NansenBias {
    try {
      const symbol = pair.split(/[-_]/)[0].toUpperCase()

      // Get fresh data from Golden Duo Cache (synced every 60s from Proxy)
      const gdSignal = this.goldenDuoData[symbol] || this.goldenDuoData[symbol.toLowerCase()]

      if (!gdSignal) {
        // DEBUG: Log when no signal found
        if (pair === 'ZEC' || pair === 'kPEPE') {
          console.log(`[DEBUG BIAS] ${pair}: No gdSignal found (keys: ${Object.keys(this.goldenDuoData).slice(0, 5).join(',')})`)
        }
        return 'neutral'
      }

      // bias is 0.0 (bearish) to 1.0 (bullish)
      const bias = gdSignal.bias
      const result: NansenBias = bias > 0.6 ? 'long' : bias < 0.4 ? 'short' : 'neutral'

      // DEBUG: Log bias calculation for key pairs
      if (pair === 'ZEC' || pair === 'kPEPE') {
        console.log(`[DEBUG BIAS] ${pair}: bias=${bias} → ${result}`)
      }

      return result
    } catch (error) {
      return 'neutral'
    }
  }

  /**
   * 🚀 Handle immediate signals from AlphaExtractionEngine
   * These signals bypass standard delays for faster reaction to whale moves
   */
  private handleImmediateSignal(command: TradingCommand): void {
    const pair = `${command.coin}-PERP`
    const msg = `🔔 [ALPHA] IMMEDIATE SIGNAL: ${command.coin} → ${command.action} ` +
      `(${command.confidence}% conf, ${command.urgency} urgency)`
    this.notifier.info(msg)

    // Update bias cache immediately for this coin
    const bias = alphaEngineIntegration.getNansenBias(command.coin)
    if (bias) {
      this.nansenBiasCache.data[command.coin] = bias
      this.nansenBiasCache.lastLoad = Date.now()
    }

    // Log for analysis - actual trading decision happens in main loop
    // based on permissions from AlphaEngineIntegration
    if (command.bypassDelay) {
      console.log(`[ALPHA] ${command.coin}: bypassDelay=true, will execute on next cycle`)
    }

    // If BLOCKED action, might want to trigger immediate order cancel
    if (command.action === 'BLOCKED') {
      this.notifier.warn(`⚠️ [ALPHA] ${command.coin} BLOCKED - consider canceling open orders`)
    }
  }

  // Oracle signal cache for grid adjustments
  private oracleSignalCache: Map<string, OracleSignal> = new Map()
  // Track previous Oracle actions for Signal Flip detection
  private oraclePrevAction: Map<string, string> = new Map()

  /**
   * Handle Oracle Vision signal
   * Used to adjust grid bias based on price predictions
   */
  private handleOracleSignal(signal: OracleSignal): void {
    const pair = `${signal.coin}-PERP`
    const prevAction = this.oraclePrevAction.get(signal.coin) || 'NEUTRAL'

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔔 SIGNAL FLIP DETECTION - Alert when action changes significantly
    // ═══════════════════════════════════════════════════════════════════════════
    const isFlip = prevAction !== signal.action && signal.action !== 'NEUTRAL'
    const isDirectionChange = (
      (prevAction.includes('LONG') && signal.action.includes('SHORT')) ||
      (prevAction.includes('SHORT') && signal.action.includes('LONG'))
    )
    const isBreakout = prevAction === 'NEUTRAL' && signal.action !== 'NEUTRAL'

    if (isFlip || isDirectionChange || isBreakout) {
      const flipEmoji = signal.action.includes('LONG') ? '📈' : signal.action.includes('SHORT') ? '📉' : '➡️'
      const alertType = isDirectionChange ? '🔄 DIRECTION FLIP' : isBreakout ? '💥 BREAKOUT' : '🔔 SIGNAL FLIP'

      const flipMsg = `${alertType} ${flipEmoji} ${signal.coin}: ${prevAction} → ${signal.action} ` +
        `| Score: ${signal.score} | RSI: ${signal.momentum.rsi.toFixed(0)} | R²: ${signal.regression.r2.toFixed(2)}`

      console.log(`\n${'═'.repeat(80)}`)
      console.log(`🔮 ORACLE SIGNAL FLIP DETECTED`)
      console.log(`${'═'.repeat(80)}`)
      console.log(flipMsg)
      console.log(`${'═'.repeat(80)}\n`)

      this.notifier.info(flipMsg)

      // Send Telegram alert for significant flips
      if (isDirectionChange || Math.abs(signal.score) > 30) {
        mmAlertBot.sendRiskAlert(flipMsg, 'warning').catch(() => {})
      }
    }

    // Update previous action tracking
    this.oraclePrevAction.set(signal.coin, signal.action)

    // Cache the signal
    this.oracleSignalCache.set(signal.coin, signal)

    // Only log significant signals (|score| > 40)
    if (Math.abs(signal.score) > 40) {
      const emoji = signal.score > 0 ? '🟢' : '🔴'
      const msg = `🔮 [ORACLE] ${signal.coin}: Score=${signal.score} Action=${signal.action} ` +
        `(Conf: ${signal.confidence}%, RSI: ${signal.momentum.rsi.toFixed(0)})`
      this.notifier.info(msg)

      // Log divergence alerts
      if (signal.divergence.hasDivergence) {
        const divEmoji = signal.divergence.type === 'bullish' ? '🟢' : '🔴'
        this.notifier.info(`${divEmoji} [ORACLE] ${signal.coin}: ${signal.divergence.description}`)
      }
    }

    // Strong signals (|score| > 60) trigger immediate logging
    if (Math.abs(signal.score) > 60) {
      console.log(`[ORACLE] STRONG SIGNAL: ${signal.coin}`)
      console.log(`  Score: ${signal.score}`)
      console.log(`  Action: ${signal.action}`)
      console.log(`  Prediction: $${signal.targets.predicted.toFixed(4)} (${signal.regression.trend})`)
      console.log(`  Support: $${signal.targets.support.toFixed(4)}, Resistance: $${signal.targets.resistance.toFixed(4)}`)
      console.log(`  Reason: ${signal.reason}`)
    }
  }

  /**
   * Get Oracle signal for grid bias adjustment
   * Returns multiplier: >1 = bullish bias, <1 = bearish bias, 1 = neutral
   */
  getOracleGridBias(coin: string): { bidMult: number; askMult: number; reason: string } {
    const signal = this.oracleSignalCache.get(coin)

    if (!signal || signal.confidence < 30) {
      return { bidMult: 1.0, askMult: 1.0, reason: 'Oracle: No signal or low confidence' }
    }

    // Score ranges:
    // >60: Strong bullish - increase bids, reduce asks
    // 30-60: Mild bullish
    // -30 to 30: Neutral
    // -60 to -30: Mild bearish
    // <-60: Strong bearish - reduce bids, increase asks

    let bidMult = 1.0
    let askMult = 1.0
    let reason = 'Oracle: '

    if (signal.score > 60) {
      bidMult = 1.3  // 30% more aggressive on bids
      askMult = 0.7  // 30% less aggressive on asks
      reason += `STRONG BULLISH (${signal.score})`
    } else if (signal.score > 30) {
      bidMult = 1.15
      askMult = 0.85
      reason += `Mild bullish (${signal.score})`
    } else if (signal.score < -60) {
      bidMult = 0.7
      askMult = 1.3
      reason += `STRONG BEARISH (${signal.score})`
    } else if (signal.score < -30) {
      bidMult = 0.85
      askMult = 1.15
      reason += `Mild bearish (${signal.score})`
    } else {
      reason += `Neutral (${signal.score})`
    }

    // Boost adjustments if divergence detected
    if (signal.divergence.hasDivergence) {
      if (signal.divergence.type === 'bullish') {
        bidMult *= 1.1
        reason += ' | DIV: SM accumulating'
      } else if (signal.divergence.type === 'bearish') {
        askMult *= 1.1
        reason += ' | DIV: SM distributing'
      }
    }

    return { bidMult, askMult, reason }
  }

  /**
   * Get Golden Duo signal for a trading pair (Smart Money position bias + flow skew)
   * Returns cached signal if fresh (< 60s), otherwise fetches new data from proxy
   */
  private async getGoldenDuoSignalForPair(pair: string): Promise<GoldenDuoSignal | null> {
    try {
      const symbol = pair.split(/[-_]/)[0].toUpperCase()
      const now = Date.now()

      // Check cache
      const cached = this.goldenDuoCache.get(symbol)
      if (cached && (now - cached.timestamp) < this.goldenDuoCacheTTL) {
        return cached.signal
      }

      // Fetch fresh signal from Golden Duo Proxy
      const signal = await getGoldenDuoSignal(symbol)

      // Update cache
      this.goldenDuoCache.set(symbol, { signal, timestamp: now })

      return signal
    } catch (error) {
      // Fail gracefully - return null if proxy is unavailable
      console.warn(`[Golden Duo] Failed to fetch signal for ${pair}:`, error)
      return null
    }
  }

  /**
   * GOLDEN DUO - RISK LAYER: Calculate dynamic inventory limits based on Smart Money Bias
   * Allows holding more of what whales are accumulating
   *
   * @param baseMaxUsd - Base maximum position size in USD
   * @param bias - Position bias from -1.0 (100% Short) to +1.0 (100% Long)
   * @returns Dynamic limits { maxLong, maxShort } in USD
   */
  private calculateDynamicLimits(baseMaxUsd: number, bias: number): { maxLong: number; maxShort: number } {
    const BIAS_STRENGTH = 1.5 // Aggressiveness: 1.0 = 100% bias doubles limit

    // Default: equal limits
    if (!bias || bias === 0) return { maxLong: baseMaxUsd, maxShort: baseMaxUsd }

    let maxLong = baseMaxUsd
    let maxShort = baseMaxUsd

    if (bias > 0) {
      // BULLISH: Smart Money is Long -> Increase Long, Decrease Short
      maxLong = baseMaxUsd * (1 + bias * BIAS_STRENGTH)
      // Protection: Short limit doesn't drop below 20% of base
      maxShort = Math.max(baseMaxUsd * 0.2, baseMaxUsd * (1 - bias * 0.5))
    } else {
      // BEARISH: Smart Money is Short -> Increase Short, Decrease Long
      const absBias = Math.abs(bias)
      maxShort = baseMaxUsd * (1 + absBias * BIAS_STRENGTH)
      maxLong = Math.max(baseMaxUsd * 0.2, baseMaxUsd * (1 - absBias * 0.5))
    }

    return { maxLong, maxShort }
  }

  /**
   * GOLDEN DUO - EXECUTION LAYER: Calculate price shift (Alpha Shift) based on Flow
   * "Front-runs" the market by shifting Bid/Ask toward money flow direction
   *
   * @param midPrice - Current mid price
   * @param spreadPercent - Current spread as decimal (e.g., 0.001 for 0.1%)
   * @param flowSkew - Flow skew from -1.0 (100% Sell) to +1.0 (100% Buy)
   * @returns Price shift in USD (positive = shift up, negative = shift down)
   */
  private calculateAlphaShift(midPrice: number, spreadPercent: number, flowSkew: number): number {
    const FLOW_INTENSITY = 0.8 // Aggressiveness: 1.0 = shift by full half-spread

    if (!flowSkew || flowSkew === 0) return 0

    // Calculate half spread in USD (distance from mid to Bid/Ask)
    const halfSpread = (midPrice * spreadPercent) / 2

    // Shift: Flow × HalfSpread × Intensity
    // Example: 0.5 (Buy Flow) × $1.00 × 0.8 = +$0.40
    return halfSpread * flowSkew * FLOW_INTENSITY
  }

  /**
   * Check if position is heavily against Nansen bias and should be closed early
   * Returns true if position should be force-closed
   */
  /**
   * Get close cost parameters from env
   */
  private getCloseCostParams() {
    const defaultBps = Number(process.env.NANSEN_CLOSE_COST_DEFAULT_BPS || '20') // 0.20%
    const spreadMultiplier = Number(process.env.NANSEN_CLOSE_COST_SPREAD_MULTIPLIER || '0.5')
    return { defaultBps, spreadMultiplier }
  }

  /**
   * Estimates close cost (in USD) based on:
   *  - notionalUsd
   *  - optionally current spread in bps
   */
  private estimateCloseCostUsd(
    pair: string,
    notionalUsd: number,
    currentSpreadBps?: number
  ): number {
    const { defaultBps, spreadMultiplier } = this.getCloseCostParams()

    const spreadBps = currentSpreadBps && currentSpreadBps > 0
      ? currentSpreadBps
      : defaultBps

    const effectiveBps = Math.max(
      defaultBps,
      Math.floor(spreadBps * spreadMultiplier)
    )

    const cost = notionalUsd * (effectiveBps / 10_000)

    this.notifier.info(
      `[NANSEN-SL] closeCost | pair=${pair} notional=${notionalUsd.toFixed(
        2
      )} spreadBps=${spreadBps} effBps=${effectiveBps} estCost=${cost.toFixed(2)}`
    )

    return cost
  }

  /**
   * Zastosuj profil spreadu (conservative / aggressive) do bazowego spreadu.
   * Aggressive lekko go ściska (np. 0.8x).
   */
  private applySpreadProfile(baseSpreadBps: number): number {
    if (baseSpreadBps <= 0) return baseSpreadBps

    if (this.config.spreadProfile !== 'aggressive') {
      return baseSpreadBps
    }

    const multEnv = process.env.AGGRESSIVE_SPREAD_MULTIPLIER
    const mult = multEnv !== undefined ? Number(multEnv) : 0.8

    if (!Number.isFinite(mult) || mult <= 0 || mult > 1) {
      // safety fallback
      return baseSpreadBps * 0.8
    }

    return baseSpreadBps * mult
  }

  /**
   * Clamp final per-side spread (in bps) into a safe band.
   * Zabezpiecza przed zbyt wąskim (prawie 0) i absurdalnie szerokim spreadem.
   * Używa per-pair limitów jeśli dostępne, w przeciwnym razie globalne.
   */
  private clampSpreadBps(pair: string, spreadBps: number): number {
    const isAggressive = this.config.spreadProfile === 'aggressive'
    const globalMinDefault = isAggressive ? 6 : 8
    const globalMaxDefault = isAggressive ? 120 : 140

    const globalMin = Number(process.env.MIN_FINAL_SPREAD_BPS || globalMinDefault)
    const globalMax = Number(process.env.MAX_FINAL_SPREAD_BPS || globalMaxDefault)

    // Extract base symbol from pair (e.g. "ZEC-PERP" -> "ZEC")
    const baseSymbol = pair.split(/[-_]/)[0].toUpperCase()
    const perPair = HyperliquidMMBot.PAIR_SPREAD_LIMITS[baseSymbol] || { min: globalMin, max: globalMax }

    // Per-pair ma pierwszeństwo, ale nie pozwalamy na totalne głupoty
    const minBps = Math.max(perPair.min, 1)
    // Allow wide spreads for FOLLOW_SM strategies (up to globalMax from env or perPair)
    const maxBps = Math.max(perPair.max, minBps + 1)

    let clamped = spreadBps
    if (!Number.isFinite(clamped)) {
      clamped = minBps
    }

    clamped = Math.min(Math.max(clamped, minBps), maxBps)
    return clamped
  }

  /**
   * Snapshot log – raz na wywołanie executePairMM
   * Pokazuje finalne wartości spreadu z breakdown.
   */
  private logSpreadSnapshot(params: {
    pair: string
    profile: 'conservative' | 'aggressive'
    baseRaw: number
    baseProfiled: number
    bidFinal: number
    askFinal: number
    invSkewPct: number
    mode: 'multi-layer' | 'regular'
  }): void {
    const {
      pair,
      profile,
      baseRaw,
      baseProfiled,
      bidFinal,
      askFinal,
      invSkewPct,
      mode
    } = params

    this.notifier.info(
      `[SNAPSHOT] pair=${pair} profile=${profile} mode=${mode} ` +
      `invSkew=${invSkewPct.toFixed(1)}% base=${baseRaw.toFixed(1)}bps ` +
      `profiled=${baseProfiled.toFixed(1)}bps bidFinal=${bidFinal.toFixed(1)}bps askFinal=${askFinal.toFixed(1)}bps`
    )
  }

  /**
   * Mark pair as entered rotation
   */
  private markRotationEntered(pair: string) {
    const now = Date.now()
    this.rotationSince[pair] = now
    this.notifier.info(
      `[ROTATION] Entered rotation | pair=${pair} at=${new Date(now).toISOString()}`
    )
  }

  /**
   * Get rotation age in milliseconds
   */
  private getRotationAgeMs(pair: string): number {
    const since = this.rotationSince[pair]
    if (!since) return 0
    return Date.now() - since
  }

  /**
   * Get max rotation hold time in milliseconds
   */
  private getMaxRotationHoldMs(): number {
    const hours = Number(process.env.ROTATION_MAX_HOLD_HOURS || '8')
    return hours * 60 * 60 * 1000
  }

  /**
   * Check if pair is overdue (exceeded max hold time)
   */
  private isRotationOverdue(pair: string): boolean {
    const age = this.getRotationAgeMs(pair)
    const maxMs = this.getMaxRotationHoldMs()
    return age > 0 && age >= maxMs
  }

  private async checkNansenConflictStopLoss(
    pair: string,
    positionSize: number,
    positionValueUsd: number,
    unrealizedPnlUsd: number
  ): Promise<boolean> {
    const bias = this.getNansenBiasForPair(pair)

    if (bias === 'neutral') return false

    // Check if we're on the wrong side of a strong bias
    const isShortAgainstLongBias = bias === 'long' && positionSize < 0
    const isLongAgainstShortBias = bias === 'short' && positionSize > 0

    if (!isShortAgainstLongBias && !isLongAgainstShortBias) {
      return false  // Position aligns with bias or is neutral
    }

    // Early stop-loss threshold: dynamic based on bias strength
    // Strong bias: -$20, Soft bias: -$50 (to prevent disasters like ZEC -$490)
    const symbol = pair.split(/[-_]/)[0].toUpperCase()
    const biasEntry = this.nansenBiasCache.data[symbol]
    const biasStrength = biasEntry?.biasStrength || 'neutral'
    const config = BIAS_CONFIGS[biasStrength]
    const NANSEN_CONFLICT_SL_USD = config.contraPnlLimit

    if (unrealizedPnlUsd < NANSEN_CONFLICT_SL_USD) {
      // Cost-benefit check with dynamic close cost
      // Estimate potential risk if we keep the position
      const biasBoost = Math.abs(biasEntry?.boost || 0)
      const riskPerBiasPoint = 0.01 // 1% per bias point
      const potentialRiskUsd = positionValueUsd * biasBoost * riskPerBiasPoint
      const totalRiskUsd = potentialRiskUsd + Math.abs(Math.min(0, unrealizedPnlUsd))

      // Estimate close cost (spread-aware)
      // If we have current spread in bps, we could pass it here
      // For now, we use undefined = fallback to defaultBps
      const estimatedCloseCostUsd = this.estimateCloseCostUsd(pair, positionValueUsd)

      // Skip close if cost > risk (unless severity is very high)
      // For now, we use simple threshold check - if cost > risk, skip
      // In future, we could add severity calculation here
      const severity = 5 // Default medium severity for this check
      if (estimatedCloseCostUsd > totalRiskUsd && severity < 8) {
        this.notifier.info(
          `[NANSEN-SL] Skip close | pair=${pair} severity=${severity.toFixed(
            1
          )} notional=${positionValueUsd.toFixed(
            2
          )} cost=${estimatedCloseCostUsd.toFixed(
            2
          )} risk=${totalRiskUsd.toFixed(2)}`
        )
        return false
      }

      const direction = positionSize > 0 ? 'LONG' : 'SHORT'
      const boostStr = biasEntry ? `+${biasEntry.boost.toFixed(2)}` : '?'
      const strengthLabel = biasStrength === 'strong' ? 'STRONG' : biasStrength === 'soft' ? 'soft' : ''

      this.notifier.warn(
        `🛑 [NANSEN CONFLICT SL] Closing ${direction} on ${pair} ` +
        `(PnL: $${unrealizedPnlUsd.toFixed(2)}, threshold: $${NANSEN_CONFLICT_SL_USD}) - ` +
        `position against Nansen ${bias.toUpperCase()} ${strengthLabel} bias ${boostStr}`
      )

      return true
    }

    return false
  }

  /**
   * Nansen-based spread multiplier + kill switch per pair.
   * Dynamically uses NANSEN_TOKENS config for any pair (ZEC, ETH, FARTCOIN, etc.)
   */
  private async getNansenGuardsForPair(
    pair: string
  ): Promise<{ spreadMult: number; pause: boolean; reason?: string }> {
    // Hard default – brak zmian jeśli Nansen off / brak integracji
    if (!this.nansen || !this.nansen.isEnabled || !this.nansen.isEnabled()) {
      return { spreadMult: 1.0, pause: false }
    }

    const symbol = pair.split(/[-_]/)[0].toUpperCase()
    let spreadMult = 1.0
    let pause = false
    let reason: string | undefined

    try {
      // ─────────────────────────────────────────────
      // 1) Generic Token Guard from Config
      // ─────────────────────────────────────────────
      const config = NANSEN_TOKENS[symbol]

      if (config) {
        // Use generic guard with optional custom spread caps
        const guard = await this.nansen.getGenericTokenGuard(
          `${symbol}/${config.chain}`,
          config.chain,
          config.address,
          config.spreadCaps // Pass custom { min, max } if defined
        )

        if (guard.pause) {
          pause = true
          reason = guard.reason
          this.notifier.warn(`⏸️ [NANSEN KILL SWITCH] ${symbol}: ${reason}`)
          return { spreadMult: 1.0, pause, reason }
        }

        spreadMult = guard.spreadMult
      } else {
        // Fallback for unconfigured tokens
        return { spreadMult: 1.0, pause: false }
      }

      // ─────────────────────────────────────────────
      // 2) ZEC-Specific Panic Spread Core (Risk Score)
      //    Retained for extra safety on ZEC/SOL
      // ─────────────────────────────────────────────
      if (symbol === 'ZEC') {
        try {
          const risk = await this.nansen.getThrottledTokenRiskScore(
            'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS',
            'solana'
          )

          if (risk.score >= 8) {
            spreadMult *= 1.4
            const msg = `core panic spread (risk=${risk.score}/10)`
            reason = reason ? `${reason} + ${msg}` : msg
            this.notifier.info(
              `🛡️ [NANSEN PANIC SPREAD CORE] ZEC/SOL risk=${risk.score}/10 → spreadMult×1.40`
            )
          } else if (risk.score >= 6) {
            spreadMult *= 1.2
            const msg = `core elevated risk (risk=${risk.score}/10)`
            reason = reason ? `${reason} + ${msg}` : msg
            this.notifier.info(
              `🛡️ [NANSEN RISK CORE] ZEC/SOL risk=${risk.score}/10 → spreadMult×1.20`
            )
          }
        } catch (e: any) {
          this.notifier.warn(
            `⚠️ [NANSEN RISK CORE] ZEC/SOL risk lookup failed: ${e?.message || e}`
          )
        }
      }

      // ─────────────────────────────────────────────
      // 3) CEX FLOW GUARD (Based on your new logic)
      // ─────────────────────────────────────────────
      const cexAnalysis = this.cexFlowAnalysis.get(symbol)
      if (cexAnalysis) {
        if (cexAnalysis.alertLevel !== 'SAFE' && cexAnalysis.alertLevel !== 'WATCH') {
          const cexSpreadMultiplier =
            cexAnalysis.alertLevel === 'CRITICAL'
              ? 1.6
              : cexAnalysis.alertLevel === 'ELEVATED'
                ? 1.3
                : cexAnalysis.alertLevel === 'WARNING'
                  ? 1.15
                  : 1.0
          spreadMult *= cexSpreadMultiplier
          const msg = `CEX flow ${cexAnalysis.alertLevel} (${cexAnalysis.ratioVsAverage.toFixed(1)}x)`
          reason = reason ? `${reason} + ${msg}` : msg

          if (cexAnalysis.alertLevel === 'CRITICAL') {
            pause = true // Hard stop for critical inflow
            reason += ' (PAUSED)'
          }
        }
      }

      // ─────────────────────────────────────────────
      // 4) Global clamps i logi diagnostyczne
      // ─────────────────────────────────────────────
      // Safety clamp
      if (spreadMult < 0.8) spreadMult = 0.8
      if (spreadMult > 3.0) spreadMult = 3.0

      const baseLabel =
        symbol === 'MON'
          ? '💀 [NANSEN GUARD]'
          : '🧠 [NANSEN GUARD]'

      // Log only if meaningful impact
      if (spreadMult !== 1.0 || pause) {
        this.notifier.info(
          `${baseLabel} ${pair} spreadMult=${spreadMult.toFixed(
            2
          )} pause=${pause ? 'YES' : 'no'} (${reason || 'ok'})`
        )
      }

      return { spreadMult, pause, reason }
    } catch (e: any) {
      // Fail-safe – jeśli Nansen coś wywali, nie blokuj bota
      this.notifier.warn(
        `⚠️ [NANSEN GUARD CORE] ${pair} exception: ${e?.message || e}`
      )
      return { spreadMult: 1.0, pause: false }
    }
  }

  /**
   * Institutional Grade Skew Pricing
   * Combines: Exponential Inventory + Funding Arbitrage + Whale Shadowing
   */
  private calculateAdvancedSkew(pair: string, currentSkew: number, fundingRate: number): number {
    const symbol = pair.split(/[-_]/)[0].toUpperCase();

    // 1. Exponential Inventory Skew
    const invRatio = Math.abs(currentSkew);
    const invSign = currentSkew >= 0 ? 1 : -1;
    const expFactor = 2.5; // Aggressiveness
    const exponentialSkew = invSign * 0.05 * (Math.exp(expFactor * invRatio) - 1);

    // 2. Funding-Induced Skew (Arbitrage)
    const fundingSkew = (fundingRate * 100) * 5;

    // 3. Whale Shadowing (Tactical Front-running)
    const tacticalShift = this.tacticalSignalBuffer.get(symbol) || 0;

    const combinedSkewBps = (exponentialSkew * 100) + fundingSkew + tacticalShift;
    return Math.max(-100, Math.min(100, combinedSkewBps));
  }

  /**
   * 📊 MODULE 1 & 2: Order Book Intelligence (Imbalance + Wall Detection)
   * Scans top levels of L2 book to detect momentum and large liquidity walls.
   */
  private analyzeOrderBook(pair: string): { imbalance: number; wallDetected: boolean; wallSide: 'bid' | 'ask' | 'none' } {
    const lt = this.trading as LiveTrading
    const book = lt.l2BookCache.get(pair);
    if (!book || !book.levels || book.levels[0].length === 0 || book.levels[1].length === 0) {
      return { imbalance: 0, wallDetected: false, wallSide: 'none' };
    }

    const DEPTH_LEVELS = 5;
    const WALL_THRESHOLD_USD = 50000; // $50k is a significant wall on most HL pairs

    let bidVol = 0;
    let askVol = 0;
    let wallDetected = false;
    let wallSide: 'bid' | 'ask' | 'none' = 'none';

    // book.levels: [asks, bids] where each level is [px, sz]
    const asks = book.levels[0]
    const bids = book.levels[1]

    // 1. Calculate Imbalance (Top 5 levels)
    for (let i = 0; i < Math.min(DEPTH_LEVELS, bids.length); i++) {
      const px = Number(bids[i][0])
      const sz = Number(bids[i][1])
      const vol = sz * px
      bidVol += vol;
      if (vol > WALL_THRESHOLD_USD) {
        wallDetected = true;
        wallSide = 'bid';
      }
    }

    for (let i = 0; i < Math.min(DEPTH_LEVELS, asks.length); i++) {
      const px = Number(asks[i][0])
      const sz = Number(asks[i][1])
      const vol = sz * px
      askVol += vol;
      if (vol > WALL_THRESHOLD_USD) {
        wallDetected = true;
        wallSide = 'ask';
      }
    }

    const imbalance = (bidVol - askVol) / (bidVol + askVol); // Range: -1 to +1

    return { imbalance, wallDetected, wallSide };
  }

  async executeMultiLayerMM(pair: string, assetCtxs?: any[]) {
    console.log(`[DEBUG ENTRY] executeMultiLayerMM called for ${pair}`)
    // 🔍 LIQUIDITY CHECK (Anti-Rug Pull)
    const liqFlags = loadLiquidityFlags();
    if (isPairBlockedByLiquidity(pair, liqFlags)) {
      console.warn(`[LIQUIDITY BLOCK] ${pair} is blocked due to CRITICAL/RUG risk!`);
      return; // Stop processing this pair
    }

    // 🛑 AUTO-PAUSE CHECK (Safety Circuit Breaker)
    // 🧠 SignalEngine PURE_MM tokens can bypass global pause
    const SIGNAL_ENGINE_TOKENS_PAUSE = ['LIT', 'VIRTUAL', 'FARTCOIN'];
    const signalEngineResultPause = SIGNAL_ENGINE_TOKENS_PAUSE.includes(pair)
      ? getAutoEmergencyOverrideSync(pair)
      : null;
    const isSignalEnginePureMmPause = signalEngineResultPause?.signalEngineOverride &&
      signalEngineResultPause?.mode === MmMode.PURE_MM;

    const shouldPause = this.alertManager?.shouldPauseTrading()
    if (shouldPause && !isSignalEnginePureMmPause) {
      const status = this.alertManager.getPauseStatus()
      if (!this._autoPauseLogAt || Date.now() - this._autoPauseLogAt > 60_000) {
        this._autoPauseLogAt = Date.now()
        const remainingMin = status.pausedUntil
          ? Math.ceil((status.pausedUntil.getTime() - Date.now()) / 60_000)
          : 0
        console.warn(
          `🛑 [AUTO-PAUSE] Trading suspended for ${pair} | ` +
          `Reason: ${status.reason} | Remaining: ${remainingMin} min`
        )
      }
      return // Skip trading while paused
    } else if (shouldPause && isSignalEnginePureMmPause) {
      console.log(`🧠 [SIGNAL_ENGINE] ${pair}: PURE_MM mode → AUTO-PAUSE bypassed, trading continues`)
    }

    const startTime = Date.now()

    // Only trade specific symbol in test mode - if empty, enable for all pairs
    const testSymbol = process.env.MULTI_LAYER_TEST_SYMBOL
    if (testSymbol && pair !== testSymbol) {
      // Use regular MM for non-test pairs without disabling gridManager
      return await this.executeRegularMM(pair, assetCtxs)
    }

    // Get current market data
    console.log(`[DEBUG ENTRY 2] ${pair}: Getting market data...`)
    if (!assetCtxs) {
      const [meta, ctxs] = await this.api.getMetaAndAssetCtxs()
      assetCtxs = ctxs
    }
    const pairData = assetCtxs.find(ctx => ctx.coin === pair)

    if (!pairData) {
      console.log(`[DEBUG EXIT] ${pair}: No pairData found!`)
      this.notifier.warn(`⚠️  No data for ${pair}`)
      return
    }
    console.log(`[DEBUG ENTRY 3] ${pair}: Got pairData, midPrice=${pairData.midPx}`)

    const midPrice = Number(pairData.midPx || 0)
    const funding = Number(pairData.funding || 0)
    if (midPrice === 0) {
      this.notifier.warn(`⚠️  Invalid mid price for ${pair}`)
      return
    }

    // 🛡️ TIER 0: EXTERNAL PRICE ANCHOR (Binance Protection)
    const symbol = pair.split(/[-_]/)[0]
    const liveTrading = this.trading as LiveTrading;
    if (liveTrading.binanceAnchor) {
      const discrepancy = liveTrading.binanceAnchor.getDiscrepancy(symbol, midPrice);
      if (discrepancy !== null && discrepancy > 0.01) { // 1% gap
        const binancePrice = liveTrading.binanceAnchor.getPrice(symbol);
        this.notifier.error(`🚨 [EXTERNAL ANCHOR PANIC] ${pair} HL=$${midPrice.toFixed(2)} vs Binance=$${binancePrice?.toFixed(2)} (gap=${(discrepancy * 100).toFixed(2)}%)! Stopping quotes.`);
        return; // Halt all activity for this pair to prevent arbitrage losses or flash crash issues
      }
    }

    if (pair === 'ZEC') {
      recordZecMidPrice(midPrice)
    }

    // Get position and calculate inventory skew.
    // Prefer local state (fast). If missing/stale, fall back to live HL state (cached).
    const state = this.stateManager.getState()
    let position = state.positions[pair]
    if (!position) {
      const livePos = await this.getLivePositionForPair(pair)
      if (livePos) {
        position = {
          size: livePos.size,
          entryPrice: livePos.entryPrice,
          side: livePos.side
        } as any
      }
    }

    // 🛑 HARD STOP for MON (Emergency Guard)
    if (pair === 'MON') {
      const monPos = position ? parseFloat((position as any).positionValue || '0') : 0;
      if (monPos > 6000) {
        console.warn(`[EMERGENCY_GUARD] MON position $${monPos.toFixed(2)} > $6000. FORCING NO BIDS.`);
        // Force disable longs for this iteration
        // We need to pass this restriction to generateGridOrders via permissions
      }
    }

    // 🛡️ POSITION PROTECTOR: Trailing stop & hard stop check
    // ═══════════════════════════════════════════════════════════════════════════
    // 🚫 EMERGENCY OVERRIDE BYPASS: Skip TRAILING_STOP for FOLLOW_SM modes
    // In high-conviction SM-following mode, we trust on-chain data over short-term
    // price fluctuations. Trailing stop at 8% would cut positions prematurely.
    // We still honor HARD_STOP as emergency safety net.
    // ═══════════════════════════════════════════════════════════════════════════
    const emergencyConfig = NANSEN_TOKENS[symbol.toUpperCase()]?.tuning
    const isEmergencyOverrideMode = emergencyConfig?.followSmMode === 'FOLLOW_SM_SHORT' ||
                                     emergencyConfig?.followSmMode === 'FOLLOW_SM_LONG'

    if (this.positionProtector && position && Math.abs(position.size) > 0) {
      const posSide = position.size > 0 ? 'long' : 'short'
      const protectorDecision = this.positionProtector.updatePosition(
        pair,
        posSide as 'long' | 'short',
        position.entryPrice,
        position.size,
        midPrice
      )
      if (protectorDecision.shouldClose) {
        // 🚫 BYPASS TRAILING_STOP for EMERGENCY_OVERRIDE pairs
        const isTrailingStop = protectorDecision.reason?.includes('TRAILING_STOP')
        if (isEmergencyOverrideMode && isTrailingStop) {
          // Log but DO NOT close - we're following Smart Money conviction
          console.log(
            `[PositionProtector] 🛑 BYPASS TRAILING_STOP for ${pair} (FOLLOW_SM mode active) | ` +
            `Reason: ${protectorDecision.reason} | PnL: ${(protectorDecision.pnlPct * 100).toFixed(2)}%`
          )
          // Continue trading - don't close
        } else {
          // Execute hard stop or non-emergency trailing stop
          const executed = await this.positionProtector.executeIfNeeded(pair, protectorDecision)
          if (executed) {
            return // Position closed, skip this MM cycle
          }
        }
      }
    }

    const capitalBase = Number(process.env.ROTATION_TARGET_PER_PAIR_USD || this.baseOrderUsd * 20) // Default: 20× baseOrderUsd if not set
    const currentDate = new Date()
    const globalDowntrend = isGlobalDowntrendActive()
    const adaptive = computeAdaptiveMultipliers(symbol.toUpperCase(), currentDate, globalDowntrend)

    // 🛡️ TIER 1: WHALE SHADOWING & FUNDING ARBITRAGE (INTELLIGENCE)
    const lt = this.trading as LiveTrading;

    // 1. Whale Intelligence Alpha Shift
    const whaleAlphaBps = lt.whaleIntel.getAlphaShiftBps(symbol.toUpperCase());
    if (Math.abs(whaleAlphaBps) > 0) {
      this.notifier.info(`🐋 [WHALE SHADOW] ${pair}: Alpha Shift ${whaleAlphaBps > 0 ? '+' : ''}${whaleAlphaBps.toFixed(1)}bps (following winners)`);
    }

    // 2. Funding Arbitrage
    const fundingBiasBps = lt.fundingArb.calculateFundingBias(funding) * 5; // Up to 5bps shift
    const fundingSpreadMult = lt.fundingArb.getSpreadMultiplier(funding);

    if (Math.abs(fundingBiasBps) > 1 || fundingSpreadMult > 1.0) {
      adaptive.spreadMult *= fundingSpreadMult;
      this.notifier.info(`💰 [FUNDING ARB] ${pair}: Bias=${fundingBiasBps.toFixed(1)}bps Mult=x${fundingSpreadMult.toFixed(2)} (funding=${(funding * 100).toFixed(4)}%)`);
    }

    // 3. Liquidation Shield
    const liqMult = lt.liqShield.getLiquidationRiskMultiplier(symbol.toUpperCase(), midPrice, lt.l2BookCache.get(pair));
    if (liqMult > 1.0) {
      adaptive.spreadMult *= liqMult;
      this.notifier.warn(`🛡️ [LIQUIDATION SHIELD] ${pair}: Large anomalous depth detected → spread x${liqMult}`);
    }

    if (adaptive.mode !== 'none') {
      this.notifier.info(
        `[RISK_ADAPT] ${pair} ${adaptive.mode === 'defensive' ? 'defensive mode' : 'weekend boost'} size×${adaptive.sizeMult.toFixed(2)} spread×${adaptive.spreadMult.toFixed(2)}`
      )
    }
    let capitalPerPair = capitalBase * adaptive.sizeMult
    let sizeMultipliers = { bid: 1.0, ask: 1.0 }
    let targetInventoryBias = 0
    let capitalMultiplier = 1.0

    // 🔧 APPLY TUNING OVERRIDES - DynamicConfigManager updates NANSEN_TOKENS directly
    // Read tuning from NANSEN_TOKENS which includes live emergency overrides
    const overridesConfig = NANSEN_TOKENS[symbol]?.tuning
    // DEBUG: Log tuning for key pairs
    const DEBUG_TOKENS = ['FARTCOIN', 'LIT', 'VIRTUAL'];
    if (DEBUG_TOKENS.includes(symbol)) {
      console.log(`[DEBUG-TUNING] ${symbol}: enabled=${overridesConfig?.enabled}, bidSizeMult=${overridesConfig?.bidSizeMultiplier}, pos=${position?.size ?? 'null'}`);
    }
    if (overridesConfig && overridesConfig.enabled) {
      if (overridesConfig.baseOrderSizeUsd) {
        const tunedCapital = overridesConfig.baseOrderSizeUsd * 20
        capitalPerPair = (capitalPerPair + tunedCapital) / 2
      }
      if (overridesConfig.maxPositionUsd && capitalPerPair > overridesConfig.maxPositionUsd) {
        capitalPerPair = overridesConfig.maxPositionUsd
      }
      if (overridesConfig.baseSpreadBps) {
        const currentSpreadBps = adaptive.spreadMult * 15; // Assume 15bps base
        if (Math.abs(currentSpreadBps - overridesConfig.baseSpreadBps) > 5) {
          const targetMult = overridesConfig.baseSpreadBps / 15
          adaptive.spreadMult = (adaptive.spreadMult + targetMult) / 2
        }
      }
      adaptive.spreadMult *= overridesConfig.smFlowSpreadMult
      adaptive.spreadMult *= overridesConfig.smPositionSpreadMult
      capitalMultiplier = overridesConfig.capitalMultiplier ?? capitalMultiplier
      sizeMultipliers = {
        bid: overridesConfig.bidSizeMultiplier ?? sizeMultipliers.bid,
        ask: overridesConfig.askSizeMultiplier ?? sizeMultipliers.ask
      }

      // 🔧 FIX 2026-01-22: POSITION REDUCTION OVERRIDE
      // If bidMultiplier=0 but we have a SHORT position, restore bid to 1.0 for position reduction
      // This prevents deadlock where we can't close shorts because bids are blocked
      // DEBUG: Log position check for key pairs
      // 🔧 FIX 2026-01-23: Removed VIRTUAL - user wants to HOLD SHORT for TP, not reduce
      const POSITION_REDUCE_TOKENS = [];  // 🔧 FIX 2026-01-24: FARTCOIN moved to HOLD_FOR_TP
      // Tokens that should HOLD position for TP (no automatic position reduction)
      const HOLD_FOR_TP_TOKENS = ['VIRTUAL', 'LIT', 'FARTCOIN'];
      if (POSITION_REDUCE_TOKENS.includes(symbol) && sizeMultipliers.bid === 0) {
        console.log(`[DEBUG-REDUCE] ${symbol}: bid=0, position=${position ? position.size : 'null'}`);
      }
      if (sizeMultipliers.bid === 0 && position && position.size < 0) {
        const posVal = Math.abs(position.size) * midPrice
        // 🔧 FIX 2026-01-23: Skip position reduction for HOLD_FOR_TP tokens
        if (HOLD_FOR_TP_TOKENS.includes(symbol)) {
          console.log(`💎 [HOLD_FOR_TP] ${symbol}: Keeping SHORT position for TP (no bid restore)`);
        } else if (posVal > 50) { // Only if position > $50
          sizeMultipliers.bid = 1.0  // Restore bid for position reduction
          this.notifier.info(`✅ [POSITION_REDUCE_FIX] ${symbol}: Restored bid×1.0 despite bidLocked - need to close SHORT $${posVal.toFixed(0)}`)
        }
      }
      // Same for asks when we have a LONG position
      if (sizeMultipliers.ask === 0 && position && position.size > 0) {
        const posVal = Math.abs(position.size) * midPrice
        if (posVal > 50) { // Only if position > $50
          sizeMultipliers.ask = 1.0  // Restore ask for position reduction
          this.notifier.info(`✅ [POSITION_REDUCE_FIX] ${symbol}: Restored ask×1.0 despite askLocked - need to close LONG $${posVal.toFixed(0)}`)
        }
      }

      targetInventoryBias = overridesConfig.targetInventory ?? 0
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 🔔 NANSEN ALERT INTEGRATION - Real-time SM signal processing
    // ═══════════════════════════════════════════════════════════════════════════
    // Update bot state for Nansen alert integration (allows real-time alert processing)
    const positionSideForAlert: 'long' | 'short' | 'none' =
      position ? (position.size > 0 ? 'long' : position.size < 0 ? 'short' : 'none') : 'none'
    const positionSizeForAlert = position ? Math.abs(position.size) : 0
    const entryPriceForAlert = position?.entryPrice ?? 0
    const unrealizedPnlForAlert = position
      ? (positionSideForAlert === 'long'
          ? (midPrice - entryPriceForAlert) * positionSizeForAlert
          : (entryPriceForAlert - midPrice) * positionSizeForAlert)
      : 0

    // Determine current mode based on HOLD_FOR_TP_TOKENS and SM following
    const NANSEN_HOLD_FOR_TP = ['VIRTUAL', 'LIT', 'FARTCOIN']
    const currentMode: 'MM' | 'FOLLOW_SM' | 'HOLD_FOR_TP' =
      NANSEN_HOLD_FOR_TP.includes(symbol) && positionSideForAlert === 'short'
        ? 'HOLD_FOR_TP'
        : 'FOLLOW_SM'

    // Calculate actual skew
    const maxPosUsd = Number(process.env.MAX_POSITION_USD || 10000)
    const actualSkewForAlert = position
      ? (position.size * midPrice) / maxPosUsd
      : 0

    // Update Nansen integration state
    updateBotState(
      symbol,
      currentMode,
      positionSideForAlert,
      positionSizeForAlert,
      entryPriceForAlert,
      unrealizedPnlForAlert,
      actualSkewForAlert
    )

    // Check for Nansen alert-based bid/ask blocking
    const nansenBidBlock = shouldBlockBids(symbol)
    const nansenAskBlock = shouldBlockAsks(symbol)

    if (nansenBidBlock.locked && sizeMultipliers.bid > 0) {
      console.log(`🔔 [NANSEN_ALERT] ${symbol}: BLOCKING BIDS - ${nansenBidBlock.reason}`)
      sizeMultipliers.bid = 0
    }
    if (nansenAskBlock.locked && sizeMultipliers.ask > 0) {
      console.log(`🔔 [NANSEN_ALERT] ${symbol}: BLOCKING ASKS - ${nansenAskBlock.reason}`)
      sizeMultipliers.ask = 0
    }

    // Check for position close signal
    const nansenCloseSignal = nansenIntegration.shouldClosePosition(symbol)
    if (nansenCloseSignal.close && position && Math.abs(position.size) > 0) {
      console.log(`🔔 [NANSEN_ALERT] ${symbol}: CLOSE SIGNAL - ${nansenCloseSignal.reason}`)
      try {
        await (this.trading as LiveTrading).closePositionForPair(pair, 'nansen_alert_close')
        this.notifier.info(`✅ [NANSEN_CLOSE] ${pair} position closed - ${nansenCloseSignal.reason}`)
        return // Exit after closing
      } catch (err: any) {
        this.notifier.error(`❌ [NANSEN_CLOSE FAILED] ${pair}: ${err?.message || err}`)
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════

    if (overridesConfig && overridesConfig.enabled) {
      // ============================================================
      // 🎲 CONTRARIAN SQUEEZE PLAY: AUTO-CLOSE TRIGGERS
      // ============================================================
      if (position && Math.abs(position.size) > 0) {
        const positionSide = position.size > 0 ? 'long' : 'short'
        const positionValueUsd = Math.abs(position.size) * midPrice

        // SQUEEZE TRIGGER: Price reached profit target → close all
        // NOTE: Squeeze trigger is calculated for CONTRARIAN direction (opposite of SM)
        // Only apply if our position matches the contrarian direction
        if (overridesConfig.squeezeTriggerPrice) {
          const triggerPrice = overridesConfig.squeezeTriggerPrice

          // Determine expected contrarian direction based on trigger vs entry
          // If trigger > entry, contrarian expects LONG (profit when price UP)
          // If trigger < entry, contrarian expects SHORT (profit when price DOWN)
          const entryPx = position.entryPrice || midPrice
          const contrarianExpectsLong = triggerPrice > entryPx
          const positionMatchesContrarian = (contrarianExpectsLong && positionSide === 'long') ||
                                            (!contrarianExpectsLong && positionSide === 'short')

          // Only apply squeeze trigger if position matches contrarian direction
          if (!positionMatchesContrarian) {
            // Position is opposite of contrarian expectation - skip squeeze trigger
            // This happens when MM fills create opposite position
          } else {
            const shouldTrigger = positionSide === 'long'
              ? midPrice >= triggerPrice  // Long: close when price goes UP
              : midPrice <= triggerPrice  // Short: close when price goes DOWN

            if (shouldTrigger) {
            const pnlPct = positionSide === 'long'
              ? ((midPrice - (position.entryPrice || midPrice)) / (position.entryPrice || midPrice)) * 100
              : (((position.entryPrice || midPrice) - midPrice) / (position.entryPrice || midPrice)) * 100

            this.notifier.warn(
              `🎯 [SQUEEZE TRIGGER] ${pair} HIT! Price $${midPrice.toFixed(4)} reached trigger $${triggerPrice.toFixed(4)} ` +
              `| ${positionSide.toUpperCase()} $${positionValueUsd.toFixed(0)} | PnL: ${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(2)}% ` +
              `| CLOSING POSITION...`
            )

            try {
              // Market close the position
              await (this.trading as LiveTrading).closePositionForPair(pair, 'squeeze_trigger')
              this.notifier.info(`✅ [SQUEEZE CLOSED] ${pair} position closed at $${midPrice.toFixed(4)}`)
              return // Exit after closing
            } catch (err: any) {
              this.notifier.error(`❌ [SQUEEZE CLOSE FAILED] ${pair}: ${err?.message || err}`)
            }
          }
          }
        }

        // STOP LOSS: Price hit stop → close all
        // NOTE: Stop loss is calculated for CONTRARIAN direction (opposite of SM)
        // Only apply if our position matches the contrarian direction
        if (overridesConfig.stopLossPrice) {
          const stopPrice = overridesConfig.stopLossPrice

          // Determine expected contrarian direction based on stop vs entry
          // If stop < entry, contrarian expects LONG (stop below entry protects LONG)
          // If stop > entry, contrarian expects SHORT (stop above entry protects SHORT)
          const entryPx = position.entryPrice || midPrice
          const contrarianExpectsLong = stopPrice < entryPx
          const positionMatchesContrarian = (contrarianExpectsLong && positionSide === 'long') ||
                                            (!contrarianExpectsLong && positionSide === 'short')

          // Only apply stop loss if position matches contrarian direction
          if (!positionMatchesContrarian) {
            // Position is opposite of contrarian expectation - skip stop loss
            // This happens when MM fills create opposite position (e.g., SHORT when expecting LONG)
            // These positions need manual management or different exit logic
          } else {
          const shouldStop = positionSide === 'long'
            ? midPrice <= stopPrice   // Long: stop when price goes DOWN
            : midPrice >= stopPrice   // Short: stop when price goes UP

          if (shouldStop) {
            const pnlPct = positionSide === 'long'
              ? ((midPrice - (position.entryPrice || midPrice)) / (position.entryPrice || midPrice)) * 100
              : (((position.entryPrice || midPrice) - midPrice) / (position.entryPrice || midPrice)) * 100

            this.notifier.error(
              `🛑 [STOP LOSS] ${pair} HIT! Price $${midPrice.toFixed(4)} reached stop $${stopPrice.toFixed(4)} ` +
              `| ${positionSide.toUpperCase()} $${positionValueUsd.toFixed(0)} | PnL: ${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(2)}% ` +
              `| EMERGENCY CLOSE...`
            )

            try {
              await (this.trading as LiveTrading).closePositionForPair(pair, 'stop_loss')
              this.notifier.info(`✅ [STOP CLOSED] ${pair} position closed at $${midPrice.toFixed(4)}`)
              return // Exit after closing
            } catch (err: any) {
              this.notifier.error(`❌ [STOP CLOSE FAILED] ${pair}: ${err?.message || err}`)
            }
          }
          }
        }

        // ============================================================
        // 💰 SM-ALIGNED TAKE PROFIT: Close profitable SHORT from BULL_TRAP
        // ============================================================
        // During BULL_TRAP (bid×0), bot only sells → creates SHORT from MM fills
        // This SHORT is ALIGNED with SM (both shorting) - NOT contrarian
        // When profitable, we should take profit by buying back
        const SM_ALIGNED_TP_THRESHOLD = 0.005  // 0.5% profit to trigger TP

        // 🔧 FIX 2026-01-24: Skip SM-ALIGNED TP for HOLD_FOR_TP tokens
        // User wants to hold positions longer, SM is still opening new shorts
        const HOLD_FOR_TP_SKIP_SM_TP = ['VIRTUAL', 'LIT', 'FARTCOIN']
        const skipSmAlignedTp = HOLD_FOR_TP_SKIP_SM_TP.includes(symbol)

        if (sizeMultipliers.bid === 0 && positionSide === 'short' && !skipSmAlignedTp) {
          const entryPx = position.entryPrice || midPrice
          const profitPct = (entryPx - midPrice) / entryPx  // SHORT profit when price drops

          if (profitPct >= SM_ALIGNED_TP_THRESHOLD) {
            const profitUsd = profitPct * positionValueUsd

            this.notifier.info(
              `💰 [SM-ALIGNED TP] ${pair} SHORT profitable! Entry: $${entryPx.toFixed(4)} → Now: $${midPrice.toFixed(4)} ` +
              `| Profit: +${(profitPct * 100).toFixed(2)}% ($${profitUsd.toFixed(2)}) | CLOSING TO LOCK PROFIT...`
            )

            try {
              await (this.trading as LiveTrading).closePositionForPair(pair, 'sm_aligned_tp')
              this.notifier.info(`✅ [SM-ALIGNED TP] ${pair} SHORT closed at $${midPrice.toFixed(4)} - profit locked!`)
              return // Exit after closing
            } catch (err: any) {
              this.notifier.error(`❌ [SM-ALIGNED TP FAILED] ${pair}: ${err?.message || err}`)
            }
          }
        }

        // Log contrarian status periodically
        if (overridesConfig.smConflictSeverity && overridesConfig.smConflictSeverity !== 'NONE') {
          const triggerDist = overridesConfig.squeezeTriggerPrice
            ? ((overridesConfig.squeezeTriggerPrice - midPrice) / midPrice * 100).toFixed(2)
            : 'n/a'
          const stopDist = overridesConfig.stopLossPrice
            ? ((midPrice - overridesConfig.stopLossPrice) / midPrice * 100).toFixed(2)
            : 'n/a'

          // Log once per 5 minutes to avoid spam
          const logKey = `contrarian_status_${pair}`
          const now = Date.now()
          if (!this._contrarianLogAt?.[logKey] || now - this._contrarianLogAt[logKey] > 300_000) {
            if (!this._contrarianLogAt) this._contrarianLogAt = {}
            this._contrarianLogAt[logKey] = now
            this.notifier.info(
              `🎲 [CONTRARIAN STATUS] ${pair} ${positionSide.toUpperCase()} $${positionValueUsd.toFixed(0)} ` +
              `| Trigger: ${triggerDist}% away | Stop: ${stopDist}% away ` +
              `| Severity: ${overridesConfig.smConflictSeverity}`
            )
          }
        }
      }
    }
    capitalPerPair *= capitalMultiplier
    capitalPerPair = Math.max(50, capitalPerPair)

    // 🔮 SHADOW TRADING: Get grid bias adjustment from elite SM traders
    const lt2 = this.trading as LiveTrading
    const shadowAdjustment = lt2.shadowTrading.getGridBiasAdjustment(symbol, targetInventoryBias)
    if (shadowAdjustment) {
      targetInventoryBias = shadowAdjustment.adjustedBias
      this.notifier.info(
        `🔮 [SHADOW] ${pair} bias adjusted: ${shadowAdjustment.originalBias.toFixed(3)} → ` +
        `${shadowAdjustment.adjustedBias.toFixed(3)} | ${shadowAdjustment.reason}`
      )
    }

    // 🔮⚔️ SHADOW-CONTRARIAN CONFLICT DETECTION
    // If we have a contrarian position AND strong shadow signal in opposite direction
    if (position && overridesConfig?.smConflictSeverity && overridesConfig.smConflictSeverity !== 'NONE') {
      const positionSideForConflict: 'long' | 'short' | 'none' =
        position.size > 0 ? 'long' : position.size < 0 ? 'short' : 'none'

      const conflict = lt2.shadowTrading.detectShadowContrarianConflict(
        symbol,
        positionSideForConflict,
        true, // contrarian is active
        {
          isCritical: overridesConfig.smConflictSeverity === 'CRITICAL'
        }
      )

      if (conflict.conflict && conflict.action === 'CLOSE_CONTRARIAN') {
        this.notifier.warn(
          `⚔️ [SHADOW-CONTRARIAN] ${pair}: ${conflict.reason} | AUTO-CLOSING POSITION`
        )
        try {
          await (this.trading as LiveTrading).closePositionForPair(pair, 'shadow_contrarian_conflict')
          this.notifier.info(`✅ [SHADOW OVERRIDE] ${pair} contrarian position closed due to strong SM signal`)
          return // Exit after closing
        } catch (err: any) {
          this.notifier.error(`❌ [SHADOW CLOSE FAILED] ${pair}: ${err?.message || err}`)
        }
      }
    }

    // 👁️ MARKET VISION DYNAMIC SIZING
    // Adjust size based on Trend Confidence (1.25x) or Flash Crash (0.5x)
    const visionSizeMult = this.marketVision.getSizeMultiplier(pair)
    if (visionSizeMult !== 1.0) {
      capitalPerPair *= visionSizeMult
      // Only log if significant change to avoid spam
      if (visionSizeMult < 0.8 || visionSizeMult > 1.2) {
        const analysis = this.marketVision.getPairAnalysis(pair);
        const nearS = (analysis?.supportDist || 1) < 0.02 ? '⚓ near S' : '';
        const nearR = (analysis?.resistanceDist || 1) < 0.02 ? '⛰️ near R' : '';

        this.notifier.info(
          `👁️ [VISION SIZE] ${pair} ×${visionSizeMult.toFixed(2)} ` +
          `(Trend 4h:${analysis?.trend4h}, 15m:${analysis?.trend15m} | ` +
          `Nansen:${analysis?.nansenScore != null ? analysis.nansenScore.toFixed(0) : 'n/a'} | ` +
          `AI:${analysis?.visualAnalysis?.pattern || 'none'}(${analysis?.visualAnalysis?.visualScore ?? 50}) | ` +
          `FlashCrash:${analysis?.isFlashCrash ? 'YES' : 'no'} | ` +
          `${nearS}${nearR})`
        );
      }
    }

    let inventorySkew = 0
    if (position) {
      const positionValueUsd = Math.abs(position.size) * midPrice
      inventorySkew = position.size > 0
        ? positionValueUsd / capitalPerPair  // Long: positive skew
        : -positionValueUsd / capitalPerPair // Short: negative skew
      // Clamp to [-1, 1] range
      inventorySkew = Math.max(-1, Math.min(1, inventorySkew))
    }

    const actualSkew = inventorySkew; // Capture real inventory skew BEFORE vision injection

    // 🔧 FIX 2026-01-23: HOLD_FOR_TP - Override inventorySkew to force grid to place ASKs
    // When holding SHORT for TP, we need to allocate capital to SELL side (not BUY for position reduction)
    const HOLD_FOR_TP_SKEW = ['VIRTUAL', 'LIT', 'FARTCOIN']
    if (HOLD_FOR_TP_SKEW.includes(pair) && actualSkew < -0.1) {
      // Force positive skew so grid allocates capital to ASKS (sells) instead of BIDS (buys)
      inventorySkew = 0.3  // Pretend we're 30% long → grid will place more asks to "reduce" it
      console.log(`💎 [HOLD_FOR_TP SKEW] ${pair}: Override inventorySkew from ${(actualSkew*100).toFixed(0)}% to +30% for ASK allocation`)
    }

    // 🧠 SignalEngine PURE_MM check for inventory deviation bypass
    const signalEngineResultInv = getAutoEmergencyOverrideSync(pair);
    const isSignalEnginePureMmInv = signalEngineResultInv?.signalEngineOverride && signalEngineResultInv?.mode === MmMode.PURE_MM;

    const inventoryDeviation = actualSkew - targetInventoryBias
    if (!isSignalEnginePureMmInv && inventoryDeviation > 0.05) {
      sizeMultipliers.bid *= 0.7
      sizeMultipliers.ask *= 1.2
    } else if (!isSignalEnginePureMmInv && inventoryDeviation < -0.05) {
      sizeMultipliers.bid *= 1.2
      sizeMultipliers.ask *= 0.7
    } else if (isSignalEnginePureMmInv) {
      console.log(`🧠 [SIGNAL_ENGINE] ${pair}: PURE_MM mode → inventory deviation adjustment bypassed`)
    }
    // Allow 0 for emergency overrides (SM winning scenario), otherwise clamp to 0.25 minimum
    const bidWasZero = sizeMultipliers.bid === 0
    const askWasZero = sizeMultipliers.ask === 0
    sizeMultipliers.bid = bidWasZero ? 0 : Math.min(2.5, Math.max(0.25, sizeMultipliers.bid))
    sizeMultipliers.ask = askWasZero ? 0 : Math.min(2.5, Math.max(0.25, sizeMultipliers.ask))

    // 🚀 AlphaEngine Size Multipliers - Apply real-time Smart Money signals
    // Only apply if AlphaEngine is running and has fresh data
    // 🧠 Skip for SignalEngine PURE_MM mode - keep multipliers at 1.0
    if (alphaEngineIntegration.getIsRunning() && !alphaEngineIntegration.isDataStale() && !isSignalEnginePureMmInv) {
      const alphaMultipliers = getAlphaSizeMultipliers(symbol)
      // AlphaEngine provides 0-1 multipliers, combine with existing multipliers
      const prevBid = sizeMultipliers.bid
      const prevAsk = sizeMultipliers.ask
      sizeMultipliers.bid *= alphaMultipliers.bid
      sizeMultipliers.ask *= alphaMultipliers.ask

      // Check for bypassDelay flag (whale sequence detected)
      const bypass = shouldBypassDelay(symbol)
      if (bypass) {
        console.log(`🔔 [ALPHA] ${pair} bypassDelay active - fast execution mode`)
      }

      // Log significant changes
      if (Math.abs(prevBid - sizeMultipliers.bid) > 0.1 || Math.abs(prevAsk - sizeMultipliers.ask) > 0.1) {
        console.log(`🚀 [ALPHA] ${pair} size: bid×${prevBid.toFixed(2)}→${sizeMultipliers.bid.toFixed(2)} ask×${prevAsk.toFixed(2)}→${sizeMultipliers.ask.toFixed(2)}`)
      }
    } else if (isSignalEnginePureMmInv && alphaEngineIntegration.getIsRunning()) {
      console.log(`🧠 [SIGNAL_ENGINE] ${pair}: PURE_MM mode → AlphaEngine multipliers bypassed (kept at bid×1.00 ask×1.00)`)
    }

    // 👁️ MarketVision Skew Injection
    const visionSkew = this.marketVision.getSizeSkew(pair);
    if (visionSkew !== 0) {
      const preVisionSkew = inventorySkew;
      inventorySkew += visionSkew;
      // Clamp again to keep within reasonable bounds, though we allow slightly > 1 for strong signals if needed
      inventorySkew = Math.max(-1.0, Math.min(1.0, inventorySkew));

      const visionAnalysis = this.marketVision.getPairAnalysis(pair);
      if (Math.abs(visionSkew) > 0.1 || visionAnalysis?.trend15m === 'bull') {
        const nansenInfo = visionAnalysis?.nansenScore
          ? ` | Nansen=${visionAnalysis.nansenScore > 0 ? 'Bull' : 'Bear'}(${visionAnalysis.nansenScore.toFixed(0)})`
          : '';

        this.notifier.info(
          `👁️ [VISION] ${pair} skew: ${(preVisionSkew * 100).toFixed(1)}% → ${(inventorySkew * 100).toFixed(1)}% ` +
          `(Skew: ${(visionSkew * 100).toFixed(1)}% | 4h=${visionAnalysis?.trend4h} | 15m=${visionAnalysis?.trend15m} | RSI15m=${visionAnalysis?.rsi15m?.toFixed(1)}${nansenInfo})`
        );
      }
    }

    // 🛡️ Nansen Conflict Stop-Loss: Close positions against strong bias early
    if (position) {
      const positionValueUsd = position.size * midPrice
      // Calculate unrealized PnL based on current price vs entry price
      const unrealizedPnlUsd = position.side === 'long'
        ? (midPrice - position.entryPrice) * position.size
        : (position.entryPrice - midPrice) * position.size

      const shouldForceClose = await this.checkNansenConflictStopLoss(
        pair,
        position.size,
        positionValueUsd,
        unrealizedPnlUsd
      )

      if (shouldForceClose) {
        // Force close the position immediately
        this.notifier.warn(`🛑 Force closing ${pair} due to Nansen conflict (position against strong bias)`)

        // Place market order to close position
        await this.trading.placeOrder(
          pair,
          position.side === 'long' ? 'sell' : 'buy',
          midPrice,
          position.size,
          'market'
        )

        return  // Skip MM for this cycle
      }
    }

    // 🔥 Get Nansen directional bias for risk management
    const nansenBias = this.getNansenBiasForPair(pair)
    const biasEntry = this.nansenBiasCache.data[symbol]
    const biasStrength = biasEntry?.biasStrength || 'neutral'

    // Get config for this bias strength
    const config = BIAS_CONFIGS[biasStrength]

    if (nansenBias !== 'neutral' && biasEntry) {
      const boostStr = `+${biasEntry.boost.toFixed(2)}`
      const strengthLabel = biasStrength === 'strong' ? 'STRONG' : biasStrength === 'soft' ? 'soft' : ''
      this.notifier.info(
        `🧭 ${pair} Nansen bias: ${nansenBias.toUpperCase()} ${boostStr} (${strengthLabel} signal)`
      )
    }

    // 🛡️ Bias Lock: Use dynamic parameters based on bias strength
    const MAX_CONTRA_SKEW = config.maxContraSkew
    const BIAS_BOOST = config.boostAmount

    // 🔧 FIX: BIAS_BOOST was incorrectly modifying inventorySkew, causing sideSpreads to calculate
    // wrong asymmetry. For SHORT bias it made bids tight (like we're already short and want to buy back)
    // instead of making asks tight (to sell into the trend).
    //
    // Directional spread asymmetry now comes ONLY from nansenBidFactor/nansenAskFactor.
    // We keep MAX_CONTRA_SKEW safety clamp to limit positions against the bias.

    if (nansenBias === 'long') {
      // Safety: Prevent excessive short positions against LONG bias
      const originalSkew = inventorySkew
      if (inventorySkew < -MAX_CONTRA_SKEW) {
        inventorySkew = -MAX_CONTRA_SKEW
        this.notifier.info(
          `🛡️ MAX_CONTRA_SKEW clamp: ${(originalSkew * 100).toFixed(1)}% → ${(inventorySkew * 100).toFixed(1)}% ` +
          `(Nansen LONG bias, limiting SHORT exposure to ${MAX_CONTRA_SKEW * 100}%)`
        )
      }
    }

    if (nansenBias === 'short') {
      // Safety: Prevent excessive long positions against SHORT bias
      const originalSkew = inventorySkew
      if (inventorySkew > MAX_CONTRA_SKEW) {
        inventorySkew = MAX_CONTRA_SKEW
        this.notifier.info(
          `🛡️ MAX_CONTRA_SKEW clamp: ${(originalSkew * 100).toFixed(1)}% → ${(inventorySkew * 100).toFixed(1)}% ` +
          `(Nansen SHORT bias, limiting LONG exposure to ${MAX_CONTRA_SKEW * 100}%)`
        )
      }
    }

    // 📊 Calculate L1 spread breakdown BEFORE generating orders (for detailed logging)
    // If token tuning provides a baseSpreadBps, use it as the L1 base offset (baseRaw) for this pair.
    // This makes the configured "DOGE=8bps / SUI=10bps / LIT=12bps" reflect in live quoting & logs.
    const baseL1OffsetBps =
      overridesConfig?.enabled && overridesConfig.baseSpreadBps && overridesConfig.baseSpreadBps > 0
        ? overridesConfig.baseSpreadBps
        : 20 // default L1 base offset

    // 0) Bazowy spread z profilu (conservative / aggressive)
    const rawBaseSpreadBps = this.makerSpreadBps
    const baseSpreadBps = this.applySpreadProfile(rawBaseSpreadBps)

    // Użyj baseSpreadBps zamiast baseL1OffsetBps dla obliczeń (lub połącz oba)
    // Dla L1 używamy baseL1OffsetBps jako bazowy offset, ale możemy też zastosować profil
    const baseL1OffsetWithProfile = this.applySpreadProfile(baseL1OffsetBps)

    // For transparency/logging we must use REAL position skew (actualSkew), not signal-adjusted inventorySkew.
    // Otherwise logs can show "inverted" skew adjustments when Nansen/Vision inject bias into inventorySkew.
    const skewAdjBidBps = this.gridManager!.getInventoryAdjustment(actualSkew, 'bid')
    const skewAdjAskBps = this.gridManager!.getInventoryAdjustment(actualSkew, 'ask')

    // Nansen factors
    const nansenBidFactor = nansenBias === 'long' ? config.tightenFactor : nansenBias === 'short' ? config.widenFactor : 1.0
    const nansenAskFactor = nansenBias === 'long' ? config.widenFactor : nansenBias === 'short' ? config.tightenFactor : 1.0

    // Behavioural risk factor (will be applied later, but we calculate it here for logging)
    // For now, we'll use 1.0 as default (will be updated after applyBehaviouralRiskToLayers)
    let behaviouralBidFactor = 1.0
    let behaviouralAskFactor = 1.0

    // Chase/volatility adjustments (if chase mode enabled)
    let chaseBidTicks = 0
    let chaseAskTicks = 0
    const tickBps = 1 // Approximate: 1 tick ≈ 1 bps (will be refined if needed)

    // 0) Base spread calculation (Profile + Adaptive + Vision Global)
    let currentBaseSpread = baseL1OffsetWithProfile;
    if (adaptive.spreadMult !== 1) currentBaseSpread *= adaptive.spreadMult;
    const visionSpreadMult = this.marketVision.getSpreadMultiplier(pair);
    if (visionSpreadMult !== 1.0) currentBaseSpread *= visionSpreadMult;

    // 0b) Nansen Pro: spread multiplier + kill switch per token
    let nansenSpreadMult = 1.0
    let nansenPause = false
    let nansenReason: string | undefined

    try {
      const guards = await this.getNansenGuardsForPair(pair)
      nansenSpreadMult = guards.spreadMult
      nansenPause = guards.pause
      nansenReason = guards.reason
    } catch (e: any) {
      this.notifier.warn(
        `⚠️ [NANSEN GUARD] ${pair} exception: ${e?.message || e}`
      )
    }

    // Kill switch – jeśli Nansen mówi STOP, nie kwotujemy tej pary
    if (nansenPause) {
      this.notifier.warn(
        `⏸️ [NANSEN KILL SWITCH] ${pair} paused: ${nansenReason ?? 'No reason'}`
      )
      return // wyjście z executeMultiLayerMM dla tej pary
    }

    // Doklejamy Nansen multiplier do globalnej bazy spreadu
    if (nansenSpreadMult !== 1.0) {
      currentBaseSpread *= nansenSpreadMult
      this.notifier.info(
        `🧠 [NANSEN SPREAD] ${pair} ×${nansenSpreadMult.toFixed(2)} (base=${baseL1OffsetWithProfile.toFixed(
          1
        )}bps → ${currentBaseSpread.toFixed(1)}bps)`
      )
    }

    // 1) Auto Spread Per Side (Inventory + Trend + Flash)
    let inventoryRatio = 0;
    if (capitalPerPair > 0) {
      const state = this.stateManager.getState().positions[pair];
      const posUsd = state ? parseFloat((state as any).positionValue || '0') : 0;
      inventoryRatio = Math.max(-1, Math.min(1, posUsd / capitalPerPair));
    }

    const analysis = this.marketVision.getPairAnalysis(pair);
    const trend4h = analysis?.trend4h;
    const trend15m = analysis?.trend15m;
    const visual = analysis?.visualAnalysis;
    const regime = (analysis as any)?.regime ?? 'n/a';

    // 👁️ Vision diagnostics for ZEC (Solana)
    if (pair === 'ZEC') {
      if (!visual) {
        this.notifier.info(
          `⚠️ [VISION ZEC] No visualAnalysis available – falling back to Nansen + quant only`
        );
      } else {
        const vScore =
          typeof visual.visualScore === 'number'
            ? visual.visualScore.toFixed(1)
            : 'n/a';
        const rScore =
          typeof (visual as any).riskScore === 'number'
            ? (visual as any).riskScore.toFixed(1)
            : 'n/a';
        this.notifier.info(
          `👁️ [VISION ZEC] regime=${regime} trend4h=${trend4h ?? 'n/a'} trend15m=${trend15m ?? 'n/a'} vScore=${vScore} risk=${rScore} squeeze=${(visual as any)?.squeezeRisk ?? 'n/a'}`
        );
      }
    }

    // Precompute current position in USD for trend-stop logic
    let zecPosUsd = 0;
    if (pair === 'ZEC') {
      try {
        const state = this.stateManager.getState();
        const pos = state?.positions?.[pair];
        if (pos && typeof (pos as any).positionValue === 'string') {
          zecPosUsd = parseFloat((pos as any).positionValue || '0');
        }
      } catch {
        zecPosUsd = 0;
      }
    }

    // Flag for trend-stop (used later to disable asks)
    let zecTrendStopShort = false;
    if (
      pair === 'ZEC' &&
      zecPosUsd < 0 &&
      trend4h === 'bull' &&
      trend15m === 'bull'
    ) {
      zecTrendStopShort = true;
      this.notifier.info(
        `🛑 [TREND STOP] ZEC/SOL strong uptrend (4h+15m) with short inventory ${zecPosUsd.toFixed(
          0
        )} USD → disabling new asks (reduce-only mode)`
      );
    }

    // Throttled Nansen risk score for ZEC (Solana) – cached for 15 minutes
    let zecNansenRiskScore: number | null = null;
    if (pair === 'ZEC') {
      try {
        const risk = await this.nansen.getThrottledTokenRiskScore(
          'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS',
          'solana'
        );
        zecNansenRiskScore = risk.score;
        this.notifier.info(
          `🛡️ [NANSEN RISK] ZEC/SOL score=${risk.score}/10 holder=${risk.components.holderRiskLevel} exch=${risk.components.exchangeFlowUsd.toFixed(
            0
          )} whale=${risk.components.whaleFlowUsd.toFixed(
            0
          )} sm=${risk.components.smartMoneyFlowUsd.toFixed(0)}`
        );
      } catch (e: any) {
        console.error(
          '[NANSEN RISK] ZEC/SOL lookup failed:',
          e?.message || e
        );
      }
    }

    const sideSpreads = computeSideAutoSpread({
      baseSpreadBps: currentBaseSpread,
      inventoryRatio,
      trend4h,
      trend15m,
      isFlashCrash: analysis?.isFlashCrash,
      visualTrend: visual?.visualTrend,
      visualScore: visual?.visualScore,
      riskScore: visual?.riskScore,
      squeezeRisk: visual?.squeezeRisk,
      breakoutRisk: visual?.breakoutRisk
    });

    // Log asymmetry if significant
    const avgSide = (sideSpreads.bidSpreadBps + sideSpreads.askSpreadBps) / 2;
    if (Math.abs(sideSpreads.bidSpreadBps - sideSpreads.askSpreadBps) > avgSide * 0.3) {
      this.notifier.info(
        `🧮 [AUTO SPREAD SIDE] ${pair} bid=${sideSpreads.bidSpreadBps.toFixed(1)}bps ask=${sideSpreads.askSpreadBps.toFixed(1)}bps ` +
        `(invRatio=${inventoryRatio.toFixed(2)}, trend4h=${analysis?.trend4h}, trend15m=${analysis?.trend15m})`
      );
    }

    let bidSpreadBps = sideSpreads.bidSpreadBps;
    let askSpreadBps = sideSpreads.askSpreadBps;

    // 🛡️ Nansen panic spread widen for ZEC
    if (pair === 'ZEC' && typeof zecNansenRiskScore === 'number') {
      if (zecNansenRiskScore >= 8) {
        bidSpreadBps *= 1.4;
        askSpreadBps *= 1.4;
        this.notifier.info(
          `🛡️ [NANSEN PANIC SPREAD] ZEC/SOL risk=${zecNansenRiskScore}/10 → spreads ×1.4`
        );
      } else if (zecNansenRiskScore >= 6) {
        bidSpreadBps *= 1.2;
        askSpreadBps *= 1.2;
        this.notifier.info(
          `🛡️ [NANSEN RISK] ZEC/SOL risk=${zecNansenRiskScore}/10 → spreads ×1.2`
        );
      }
    }

    // 🧨 Squeeze protection using Vision (only if visualAnalysis is present)
    if (pair === 'ZEC' && visual && (visual as any).squeezeRisk === 'high') {
      bidSpreadBps *= 1.3;
      askSpreadBps *= 1.3;
      this.notifier.info(
        `🧨 [SQUEEZE PROTECT] ZEC/SOL squeezeRisk=high → spreads ×1.3`
      );
    }

    // 🎯 INSTITUTIONAL BIAS & SKEW CALCULATION
    const advancedSkewBps = this.calculateAdvancedSkew(pair, inventorySkew, funding);
    let biasShiftBps = advancedSkewBps + whaleAlphaBps + fundingBiasBps;

    // ⚡ MODULE 1 & 2 INTEGRATION: Order Book Micro-Signals
    const bookSignals = this.analyzeOrderBook(pair);

    // 1. Imbalance Alpha: Shift price towards pressure
    if (Math.abs(bookSignals.imbalance) > 0.3) {
      const imbalanceShift = bookSignals.imbalance * 5; // Up to 5bps shift based on pressure
      biasShiftBps += imbalanceShift;
      this.notifier.info(`📊 [IMBALANCE] ${pair}: ${(bookSignals.imbalance * 100).toFixed(1)}% pressure → shift ${imbalanceShift > 0 ? '+' : ''}${imbalanceShift.toFixed(1)}bps`);
    }

    // 2. Wall Avoidance: Widen spread if a wall is pushing against us
    if (bookSignals.wallDetected) {
      adaptive.spreadMult *= 1.25;
      this.notifier.info(`🧱 [WALL DETECTED] ${pair}: ${bookSignals.wallSide.toUpperCase()} wall found → spread widened by 25%`);
    }

    // 🛡️ ADVANCED TOXIC FLOW PROTECTION
    // 1. VPIN Analysis
    if (liveTrading.vpinAnalyzers) {
      if (!liveTrading.vpinAnalyzers.has(pair)) {
        liveTrading.vpinAnalyzers.set(pair, new VPINAnalyzer());
      }
      const vpinInfo = liveTrading.vpinAnalyzers.get(pair)!.getToxicityLevel();
      if (vpinInfo.spreadMult > 1.0) {
        adaptive.spreadMult *= vpinInfo.spreadMult;
        this.notifier.info(`🧪 [VPIN TOXICITY] ${pair}: level=${vpinInfo.level} vpin=${vpinInfo.vpin.toFixed(2)} → spread ×${vpinInfo.spreadMult}`);
      }
    }

    // 2. Adverse Selection Analysis
    if (liveTrading.adverseTracker) {
      const l2 = liveTrading.l2BookCache.get(pair)
      const bestAskPx = l2?.levels?.[0]?.[0]?.[0]
      const bestBidPx = l2?.levels?.[1]?.[0]?.[0]
      const currentMid = bookSignals.imbalance > 0 ? Number(bestAskPx || 0) : Number(bestBidPx || 0)
      const adverseMult = liveTrading.adverseTracker.calculateAdverseSelectionScore(pair, currentMid || 0);
      if (adverseMult > 1.0) {
        adaptive.spreadMult *= adverseMult;
        this.notifier.warn(`⚠️ [ADVERSE SELECTION] ${pair}: Detecting toxic counterparty flow → spread ×${adverseMult}`);
      }
    }

    // Apply Bias to Spreads
    if (biasShiftBps !== 0) {
      bidSpreadBps += biasShiftBps;
      askSpreadBps -= biasShiftBps;

      if (Math.abs(biasShiftBps) > 4) {
        this.notifier.info(
          `🎯 [BIAS] ${pair} shift=${biasShiftBps.toFixed(1)}bps (FundBias=${(funding * 100 * 5).toFixed(1)}, Tactical=${(this.tacticalSignalBuffer.get(symbol) || 0).toFixed(1)})`
        );
      }
    }

    // 2) Nansen bias – asymetria (applied FIRST so gridMult includes Nansen factors)
    bidSpreadBps *= nansenBidFactor
    askSpreadBps *= nansenAskFactor

    // 🔧 FIX: Calculate gridMult AFTER Nansen factors, so grid layers follow the correct asymmetry
    // For SHORT bias: nansenAskFactor=0.7 (tight asks), nansenBidFactor=1.3 (wide bids)
    let gridBidMult = currentBaseSpread > 1e-9 ? bidSpreadBps / currentBaseSpread : 1.0;
    let gridAskMult = currentBaseSpread > 1e-9 ? askSpreadBps / currentBaseSpread : 1.0;

    // 🎯 UNHOLY TRINITY INTELLIGENT SPREAD CONTROL
    // Dynamic Volatility Trigger - expands spread during pumps to avoid getting rekt
    const unholyTrinity = ['FARTCOIN', 'VIRTUAL', 'LIT'];
    if (unholyTrinity.includes(pair)) {
      // 1. Check recent volatility from Oracle price history
      let isVolatile = false;
      let volatilityPct = 0;
      try {
        const priceHistory = oracleEngine.getPriceHistory(pair);
        if (priceHistory && priceHistory.length >= 5) {
          // Get last 5 price points (roughly 5 minutes if updated every minute)
          const recent = priceHistory.slice(-5);
          const prices = recent.map(p => p.price);
          const low = Math.min(...prices);
          const high = Math.max(...prices);
          volatilityPct = (high - low) / low;

          // If price moved more than 1.5% in last 5 points -> VOLATILITY SPIKE!
          if (volatilityPct > 0.015) {
            isVolatile = true;
          }
        }
      } catch (e) {
        // Fallback to normal mode if Oracle not available
      }

      if (isVolatile) {
        // 🚨 DEFENSE MODE (Volatility Spike) - expand grid to avoid pump trap
        gridAskMult *= 6.0;  // Wide spread (L1 ~1.2%, L8 ~10%)
        gridBidMult *= 6.0;
        if (this.tickCount % 10 === 0) {
          this.notifier.warn(`[DEFENSE] 🐡 ${pair} Volatility Spike! ${(volatilityPct * 100).toFixed(2)}% move → Grid 6x`);
        }
      } else {
        // 🟢 SNIPER MODE (Calm market) - tight spread for fills
        gridAskMult *= 2.0;
        gridBidMult *= 2.0;
      }
    }

    // 3) Behavioural risk (FOMO / knife) – tylko BUY side
    bidSpreadBps *= behaviouralBidFactor

    // 4) Chase / volatility – dodatkowe ticks
    bidSpreadBps += chaseBidTicks * tickBps
    askSpreadBps += chaseAskTicks * tickBps

    // 5) Ostateczny clamp na sensowny zakres (z per-pair limitami)
    const unclampedBid = bidSpreadBps
    const unclampedAsk = askSpreadBps
    const finalBidSpreadBps = this.clampSpreadBps(pair, bidSpreadBps)
    const finalAskSpreadBps = this.clampSpreadBps(pair, askSpreadBps)

    // Snapshot log – multi-layer
    const invSkewPct = inventorySkew * 100
    this.logSpreadSnapshot({
      pair,
      profile: this.config.spreadProfile,
      baseRaw: baseL1OffsetBps,
      baseProfiled: baseL1OffsetWithProfile,
      bidFinal: finalBidSpreadBps,
      askFinal: finalAskSpreadBps,
      invSkewPct,
      mode: 'multi-layer'
    })

    // Institutional Trade Permissions (Regime Gating)
    const permissions = this.marketVision!.getTradePermissions(pair);

    // 🛑 EMERGENCY MON GUARD (Hard Coded Safety)
    if (pair === 'MON') {
      const monState = this.stateManager.getState().positions['MON'];
      if (monState) {
        const val = Math.abs(parseFloat((monState as any).positionValue || '0'));
        if (val > 6000) {
          permissions.allowLongs = false;
          // Allow closing shorts if any
          if (permissions.reason) permissions.reason += ' | ';
          permissions.reason += `MON_HARD_CAP_EXCEEDED($${val.toFixed(0)})`;
          console.warn(`🛑 EMERGENCY GUARD: Blocking MON buys. Position $${val.toFixed(0)} > $6000`);
        }
      }
    }

    // 🛑 FORCE SHORT ONLY FOR UNHOLY TRINITY (FARTCOIN, VIRTUAL)
    // ALWAYS block bids AND force enable shorts - override REGIME restrictions
    // VIRTUAL was whipsawing (buying tops, selling bottoms) due to weak Oracle signal ~0
    // 🔧 FIX 2026-01-22: Allow longs when we have a SHORT position to reduce (position management)
    // 🧠 BUT: Skip this block if SignalEngine wants PURE_MM (both sides enabled)
    const signalEngineResultFso = getAutoEmergencyOverrideSync(pair);
    const isSignalEnginePureMmFso = signalEngineResultFso?.signalEngineOverride && signalEngineResultFso?.mode === MmMode.PURE_MM;

    // 🔧 FIX 2026-01-23: VIRTUAL uses HOLD_FOR_TP mode - no position reduction
    const HOLD_FOR_TP_PAIRS = ['VIRTUAL', 'LIT', 'FARTCOIN'];

    if ((pair === 'FARTCOIN' || pair === 'VIRTUAL') && !isSignalEnginePureMmFso) {
      // actualSkew is negative for SHORT positions (captured earlier before vision injection)
      const hasShortPosition = actualSkew < -0.05; // More than 5% of capital in shorts
      const isHoldForTp = HOLD_FOR_TP_PAIRS.includes(pair);

      if (hasShortPosition && !isHoldForTp) {
        // We have a SHORT position - allow LONGS to reduce it (take profit / reduce risk)
        // BUT NOT for HOLD_FOR_TP tokens - they keep shorts for TP
        permissions.allowLongs = true;
        permissions.allowShorts = true; // Keep shorts enabled too
        if (permissions.reason) permissions.reason += ' | ';
        permissions.reason += `${pair}_POSITION_REDUCE`;
        this.notifier.info(`[FORCE_SHORT_ONLY] ${pair}: SHORT ${(actualSkew * 100).toFixed(0)}% detected → BIDs ENABLED for position reduction`);
      } else if (hasShortPosition && isHoldForTp) {
        // 💎 HOLD_FOR_TP: Keep short, block longs, place asks for TP
        permissions.allowLongs = false;
        permissions.allowShorts = true;
        if (permissions.reason) permissions.reason += ' | ';
        permissions.reason += `${pair}_HOLD_SHORT_FOR_TP`;
        this.notifier.info(`💎 [HOLD_FOR_TP] ${pair}: Holding SHORT ${(actualSkew * 100).toFixed(0)}% for TP. BIDs BLOCKED, ASKs for TP.`);
      } else {
        // No significant SHORT position - block new longs (prevent whipsaw)
        permissions.allowLongs = false;
        permissions.allowShorts = true; // 🔓 Override REGIME - we MUST be able to short
        if (permissions.reason) permissions.reason += ' | ';
        permissions.reason += `${pair}_FORCE_SHORT_ONLY`;
        this.notifier.info(`[FORCE_SHORT_ONLY] ${pair}: ASK-only grid, BIDs blocked. Shorts ENABLED.`);
      }
    } else if ((pair === 'FARTCOIN' || pair === 'VIRTUAL') && isSignalEnginePureMmFso) {
      console.log(`🧠 [SIGNAL_ENGINE] ${pair}: PURE_MM mode → FORCE_SHORT_ONLY bypassed, both sides enabled`);
    }

    // 🎯 FOLLOW SM MODE: OVERRIDE REGIME permissions when SM alignment is required
    // This is EMERGENCY priority and should bypass all other regime restrictions
    // 🔧 FIX 2026-01-22: BUT always allow position reduction (close shorts/longs)
    if (overridesConfig?.followSmMode) {
      if (overridesConfig.followSmMode === 'FOLLOW_SM_LONG') {
        // Force allow longs, block shorts - we're following SM bullish signal
        // But allow shorts to close LONG positions
        const hasLongPosition = actualSkew > 0.05;
        permissions.allowLongs = true;
        permissions.allowShorts = hasLongPosition; // Allow shorts only to reduce longs
        permissions.reason = hasLongPosition
          ? 'FOLLOW_SM_LONG (position reduce enabled)'
          : 'FOLLOW_SM_LONG (EMERGENCY OVERRIDE)';
        this.notifier.warn(`🟢 [EMERGENCY] ${pair}: FOLLOW_SM_LONG overriding REGIME → allowLongs=TRUE${hasLongPosition ? ', allowShorts for reduce' : ''}`);
      } else if (overridesConfig.followSmMode === 'FOLLOW_SM_SHORT') {
        // Force allow shorts, block longs - we're following SM bearish signal
        // But allow longs to close SHORT positions (UNLESS HOLD_FOR_TP)
        const hasShortPosition = actualSkew < -0.05;
        const isHoldForTp = HOLD_FOR_TP_PAIRS.includes(pair);

        // 🔧 FIX 2026-01-23: HOLD_FOR_TP tokens keep shorts, no position reduction
        if (isHoldForTp && hasShortPosition) {
          permissions.allowLongs = false; // Block longs - hold short for TP
          permissions.allowShorts = true;
          permissions.reason = 'FOLLOW_SM_SHORT (HOLD_FOR_TP)';
          this.notifier.info(`💎 [FOLLOW_SM_SHORT] ${pair}: HOLD_FOR_TP mode - SHORT ${(actualSkew * 100).toFixed(0)}%, longs BLOCKED for TP`);
        } else {
          permissions.allowLongs = hasShortPosition; // Allow longs only to reduce shorts
          permissions.allowShorts = true;
          permissions.reason = hasShortPosition
            ? 'FOLLOW_SM_SHORT (position reduce enabled)'
            : 'FOLLOW_SM_SHORT (EMERGENCY OVERRIDE)';
          if (hasShortPosition) {
            this.notifier.info(`[FOLLOW_SM_SHORT] ${pair}: SHORT ${(actualSkew * 100).toFixed(0)}% → longs enabled for position reduction`);
          }
        }
      }
    }

    if (permissions.reason !== 'neutral_regime') {
      console.log(`🛡️  [REGIME] ${pair}: ${permissions.reason} (Longs: ${permissions.allowLongs}, Shorts: ${permissions.allowShorts})`);
    }

    // 🧠 SIGNAL ENGINE MASTER OVERRIDE - Bypass REGIME for PURE_MM mode
    // When SignalEngine says WAIT (no clear signal), allow BOTH sides for proper market making
    // This prevents REGIME from killing one side when SignalEngine wants neutral positioning
    const SIGNAL_ENGINE_TOKENS = ['LIT', 'VIRTUAL', 'FARTCOIN'];
    if (SIGNAL_ENGINE_TOKENS.includes(pair)) {
      // Get DYNAMIC SignalEngine result from SmAutoDetector (uses cached analysis)
      const signalEngineResult = getAutoEmergencyOverrideSync(pair);
      const isPureMmMode = signalEngineResult?.signalEngineOverride && signalEngineResult?.mode === MmMode.PURE_MM;

      // Check if mode is PURE_MM (SignalEngine said WAIT)
      // PURE_MM = no clear signal = allow both sides for market making
      if (isPureMmMode) {
        // 🎯 MASTER OVERRIDE: Force BOTH sides enabled for PURE_MM
        const prevLongs = permissions.allowLongs;
        const prevShorts = permissions.allowShorts;

        permissions.allowLongs = true;
        permissions.allowShorts = true;

        if (!prevLongs || !prevShorts) {
          console.log(`🧠 [SIGNAL_ENGINE_OVERRIDE] ${pair}: PURE_MM mode → FORCE BOTH SIDES (was Longs:${prevLongs} Shorts:${prevShorts})`);
          permissions.reason = 'SIGNAL_ENGINE_PURE_MM (MASTER OVERRIDE)';
        }
      }
    }

    // 🛑 REGIME ENFORCEMENT: Zero out multipliers when permissions block directions
    // This ensures sizeMultipliers match actual trading permissions (no hidden mismatches)
    // BUG FIX: Previously tuning could set bid×0.7 ask×1.2 but REGIME block both → should be bid×0 ask×0
    const prevBidMult = sizeMultipliers.bid;
    const prevAskMult = sizeMultipliers.ask;

    if (!permissions.allowLongs && sizeMultipliers.bid > 0) {
      sizeMultipliers.bid = 0;
    }
    if (!permissions.allowShorts && sizeMultipliers.ask > 0) {
      sizeMultipliers.ask = 0;
    }

    // Detect FLAT mode (both blocked) and log appropriately
    const isFlatMode = !permissions.allowLongs && !permissions.allowShorts;
    if (isFlatMode && (prevBidMult > 0 || prevAskMult > 0)) {
      console.log(`🔒 [FLAT MODE] ${pair}: REGIME blocks BOTH sides → bid×${prevBidMult.toFixed(2)}→0 ask×${prevAskMult.toFixed(2)}→0 | NO NEW ORDERS`);
    } else if (!permissions.allowLongs && prevBidMult > 0) {
      console.log(`🛑 [REGIME→MULT] ${pair}: bid×${prevBidMult.toFixed(2)} → bid×0 (Longs blocked)`);
    } else if (!permissions.allowShorts && prevAskMult > 0) {
      console.log(`🛑 [REGIME→MULT] ${pair}: ask×${prevAskMult.toFixed(2)} → ask×0 (Shorts blocked)`);
    }

    // Generate grid orders with Nansen bias awareness AND Institutional Permissions
    // Note: GridManager will apply its own clamp internally, but we log our calculation here
    // 🔍 DEBUG: Track FINAL capitalPerPair right before grid generation
    console.log(`[DEBUG GRID] ${pair}: capitalPerPair=$${capitalPerPair.toFixed(0)} midPrice=$${midPrice.toFixed(4)}`)

    // 🎯 FARTCOIN GRID EXPANSION (expand grid to allow orders to fit)
    // Problem: rebucket logic was zeroing out layers due to tight spread
    // Fix: widen the grid by increasing gridAskMult to 5.0x
    if (pair === 'FARTCOIN') {
      gridAskMult = Math.max(gridAskMult, 5.0);
      console.log(`[FARTCOIN GRID] Expanded: gridAskMult=${gridAskMult.toFixed(2)} (forced 5.0x min)`);
    }

    let gridOrders = this.gridManager!.generateGridOrders(
      pair,
      midPrice,
      capitalPerPair,
      0.001,
      inventorySkew,
      permissions,
      actualSkew,
      { bid: gridBidMult, ask: gridAskMult },
      sizeMultipliers
    )

    // 🛑 Apply ZEC trend-stop: in strong uptrend with short inventory, do not place new asks
    if (pair === 'ZEC' && zecTrendStopShort && Array.isArray(gridOrders)) {
      const originalAsks = gridOrders.filter((o: GridOrder) => o.side === 'ask').length
      if (originalAsks > 0) {
        gridOrders = gridOrders.filter((o: GridOrder) => o.side !== 'ask')
        this.notifier.info(
          `🛑 [TREND STOP APPLY] ZEC/SOL removed ${originalAsks} asks – bids only (reduce-short mode)`
        )
      }
    }

    // 🛑 EMERGENCY OVERRIDE: Remove bid orders when SM shorts are winning
    // ⚠️ BUT: If we have a SHORT position (actualSkew < -0.1), we NEED bids to reduce/close it!
    // NOTE: Use actualSkew (real position) not inventorySkew (modified by vision/signals)
    const hasShortPosition = actualSkew < -0.1

    // DEBUG: Log position check for key pairs
    // 🔧 FIX 2026-01-23: HOLD_FOR_TP tokens should NOT reduce positions
    const HOLD_FOR_TP_GRID = ['VIRTUAL', 'LIT', 'FARTCOIN']
    const isHoldForTpGrid = HOLD_FOR_TP_GRID.includes(pair)

    if ((pair === 'FARTCOIN' || pair === 'LIT' || pair === 'VIRTUAL') && sizeMultipliers.bid === 0) {
      console.log(`[DEBUG-POS] ${pair}: actualSkew=${(actualSkew * 100).toFixed(1)}% hasShort=${hasShortPosition} bidMult=${sizeMultipliers.bid} holdForTp=${isHoldForTpGrid}`)
    }

    // 💎 HOLD_FOR_TP: Remove ALL bids - we want to hold position for TP
    if (sizeMultipliers.bid === 0 && Array.isArray(gridOrders) && isHoldForTpGrid) {
      const originalBids = gridOrders.filter((o: GridOrder) => o.side === 'bid').length
      if (originalBids > 0) {
        gridOrders = gridOrders.filter((o: GridOrder) => o.side !== 'bid')
        this.notifier.info(
          `💎 [HOLD_FOR_TP] ${pair} removed ${originalBids} BIDS - holding SHORT for TP (actualSkew ${(actualSkew * 100).toFixed(0)}%)`
        )
      }
    } else if (sizeMultipliers.bid === 0 && Array.isArray(gridOrders) && !hasShortPosition) {
      const originalBids = gridOrders.filter((o: GridOrder) => o.side === 'bid').length
      if (originalBids > 0) {
        gridOrders = gridOrders.filter((o: GridOrder) => o.side !== 'bid')
        this.notifier.warn(
          `🛑 [EMERGENCY] ${pair} removed ${originalBids} BIDS - SM shorts winning, asks only`
        )
      }
    } else if (sizeMultipliers.bid === 0 && hasShortPosition && !isHoldForTpGrid) {
      this.notifier.info(`✅ [POSITION_REDUCE] ${pair} keeping BIDs despite bid×0 - need to reduce SHORT (actualSkew ${(actualSkew * 100).toFixed(0)}%)`)
    }

    // 🛑 Cancel existing bid orders on exchange when bid×0 (SEPARATE from grid filtering)
    // ⚠️ BUT: If we have a SHORT position, we NEED bids to reduce/close it!
    // 💎 HOLD_FOR_TP: Always cancel bids - we want to hold position
    if (sizeMultipliers.bid === 0 && this.trading instanceof LiveTrading && (isHoldForTpGrid || !hasShortPosition)) {
      try {
        const existingOrders = await this.trading.getOpenOrders(pair)
        const existingBids = existingOrders.filter((o: any) => o.side === 'B' || o.side === 'buy')
        for (const bid of existingBids) {
          await this.trading.cancelOrder(bid.oid?.toString() || bid.orderId?.toString())
          this.notifier.warn(`🛑 [BULL_TRAP] ${pair} cancelled existing BID order ${bid.oid || bid.orderId} @ $${bid.limitPx}`)
        }
      } catch (e: any) {
        // Silently ignore - order may have already filled or been cancelled
      }
    }

    // 🛑 EMERGENCY OVERRIDE: Remove ask orders when SM longs are winning
    // ⚠️ BUT: If we have a LONG position (actualSkew > 0.1), we NEED asks to reduce/close it!
    // NOTE: Use actualSkew (real position) not inventorySkew (modified by vision/signals)
    const hasLongPosition = actualSkew > 0.1
    if (sizeMultipliers.ask === 0 && Array.isArray(gridOrders) && !hasLongPosition) {
      const originalAsks = gridOrders.filter((o: GridOrder) => o.side === 'ask').length
      if (originalAsks > 0) {
        gridOrders = gridOrders.filter((o: GridOrder) => o.side !== 'ask')
        this.notifier.warn(
          `🛑 [EMERGENCY] ${pair} removed ${originalAsks} ASKS - SM longs winning, bids only`
        )
      }
    } else if (sizeMultipliers.ask === 0 && hasLongPosition) {
      this.notifier.info(`✅ [POSITION_REDUCE] ${pair} keeping ASKs despite ask×0 - need to reduce LONG (actualSkew ${(actualSkew * 100).toFixed(0)}%)`)
    }

    // 🛑 Cancel existing ask orders on exchange when ask×0 (SEPARATE from grid filtering)
    // ⚠️ BUT: If we have a LONG position, we NEED asks to reduce/close it!
    if (sizeMultipliers.ask === 0 && this.trading instanceof LiveTrading && !hasLongPosition) {
      try {
        const existingOrders = await this.trading.getOpenOrders(pair)
        const existingAsks = existingOrders.filter((o: any) => o.side === 'A' || o.side === 'sell')
        for (const ask of existingAsks) {
          await this.trading.cancelOrder(ask.oid?.toString() || ask.orderId?.toString())
          this.notifier.warn(`🛑 [BEAR_TRAP] ${pair} cancelled existing ASK order ${ask.oid || ask.orderId} @ $${ask.limitPx}`)
        }
      } catch (e: any) {
        // Silently ignore - order may have already filled or been cancelled
      }
    }

    const MIN_NOTIONAL = Number(process.env.MIN_NOTIONAL_USD ?? 10)
    // Ensure child orders meet min notional (especially for UNI which was getting ~$7 orders)
    const GLOBAL_CLIP = Math.max(Number(process.env.CLIP_USD ?? 15), MIN_NOTIONAL + 2) // At least $2 above min notional

    // Get instrument specs for proper rounding
    const specs = getInstrumentSpecs(pair)
    // Infer szDecimals from price using centralized helper
    const sizeDecimals = guessSzDecimals(midPrice)

    // Compute per-asset clip with round-up logic to guarantee notional floors
    const { clipUsd, coinStep, coinsRounded, usdRounded } = this.computePerAssetClip(
      pair,
      midPrice,
      GLOBAL_CLIP,
      MIN_NOTIONAL,
      specs,
      sizeDecimals
    )

    // Re-bucket children so each child is ≥ GLOBAL_CLIP and ≥ MIN_NOTIONAL
    // while keeping the total USD roughly the same.
    // NOTE: We use GLOBAL_CLIP here (not clipUsd) because clipUsd is the post-rounding
    // target used for verification. The rebucketing just needs to meet the min notional floor.
    const totalBefore = gridOrders.reduce((a, o) => a + (o.sizeUsd || 0), 0)
    gridOrders = normalizeChildNotionals(
      gridOrders,
      { targetUsd: GLOBAL_CLIP, minUsd: MIN_NOTIONAL }
    )
    let totalAfter = gridOrders.reduce((a, o) => a + (o.sizeUsd || 0), 0)

    if (this.positionRiskManager && gridOrders.length > 0) {
      const totalBidNotional = gridOrders
        .filter((o: GridOrder) => o.side === 'bid')
        .reduce((sum: number, o: GridOrder) => sum + (o.sizeUsd || 0), 0)
      const totalAskNotional = gridOrders
        .filter((o: GridOrder) => o.side === 'ask')
        .reduce((sum: number, o: GridOrder) => sum + (o.sizeUsd || 0), 0)

      const riskDecision = this.positionRiskManager.evaluate({
        token: pair,
        midPrice,
        positions: state.positions,
        position,
        totalBidNotional,
        totalAskNotional
      })

      const riskReason =
        riskDecision.reasons.length > 0 ? riskDecision.reasons.join(' | ') : 'exposure limit'

      // 🧠 SignalEngine PURE_MM bypass for position risk
      if (!riskDecision.allowBid && totalBidNotional > 0 && !isSignalEnginePureMmInv) {
        gridOrders = gridOrders.filter((o: GridOrder) => o.side !== 'bid')
        this.notifier.warn(`🛑 [POSITION RISK] ${pair} bids disabled: ${riskReason}`)
      } else if (!riskDecision.allowBid && isSignalEnginePureMmInv) {
        console.log(`🧠 [SIGNAL_ENGINE] ${pair}: PURE_MM mode → POSITION RISK bid block bypassed`)
      }
      if (!riskDecision.allowAsk && totalAskNotional > 0 && !isSignalEnginePureMmInv) {
        gridOrders = gridOrders.filter((o: GridOrder) => o.side !== 'ask')
        this.notifier.warn(`🛑 [POSITION RISK] ${pair} asks disabled: ${riskReason}`)
      } else if (!riskDecision.allowAsk && isSignalEnginePureMmInv) {
        console.log(`🧠 [SIGNAL_ENGINE] ${pair}: PURE_MM mode → POSITION RISK ask block bypassed`)
      }

      if (!riskDecision.allowBid || !riskDecision.allowAsk) {
        totalAfter = gridOrders.reduce((a, o) => a + (o.sizeUsd || 0), 0)
      }
    }

    this.notifier.info(
      `🏛️  ${pair} Multi-Layer: ${gridOrders.length} orders | Mid: $${midPrice.toFixed(4)} | ` +
      `Skew: ${(inventorySkew * 100).toFixed(1)}% | Rebucket: ${totalBefore.toFixed(2)}→${totalAfter.toFixed(2)} USD | ` +
      `child≥${clipUsd}`
    )

    // 🔍 Apply behavioural risk (anti-FOMO / anti-knife)
    const buyLayers = gridOrders.filter((o: GridOrder) => o.side === 'bid')
    const sellLayers = gridOrders.filter((o: GridOrder) => o.side === 'ask')

    // Calculate recent returns from price history (if available)
    // For now, we'll use a simple fallback - you can enhance this with actual price history tracking
    const recentReturns = {
      // TODO: Implement actual price history tracking for ret1m, ret5m, ret15m
      // For now, these will be undefined and behavioural risk will only trigger on orderbook stats
    }

    // Calculate orderbook stats (bid depth)
    // TODO: Enhance with actual orderbook depth tracking
    const orderbookStats = {
      // TODO: Implement actual orderbook depth tracking
      // For now, these will be undefined
    }

    const adjusted = applyBehaviouralRiskToLayers({
      mode: this.behaviouralRiskMode,
      pair,
      midPrice,
      buyLayers,
      sellLayers,
      recentReturns,
      orderbookStats,
    })

    // Update behavioural factors for logging (if FOMO was detected)
    if (adjusted.reason && adjusted.reason.includes('fomo')) {
      // Extract spreadBoost from reason or use default
      const spreadBoostMatch = adjusted.reason.match(/spreadBoost=([\d.]+)/)
      if (spreadBoostMatch) {
        behaviouralBidFactor = parseFloat(spreadBoostMatch[1])
      }
    }

    if (adjusted.suspendBuys) {
      this.notifier.warn(
        `🧠 BehaviouralRisk: suspending BUY quoting for ${pair} (${adjusted.reason || 'FOMO/knife'})`
      )
    } else if (adjusted.reason) {
      this.notifier.info(
        `🧠 BehaviouralRisk: ${pair} ${adjusted.reason}`
      )
    }

    // Recombine adjusted layers back into gridOrders
    gridOrders = [...adjusted.buyLayers, ...adjusted.sellLayers]

    // 📊 Log final spread with complete breakdown (after behavioural risk)
    // Recalculate for logging with updated behavioural factor
    const finalRawBidSpreadBps = baseL1OffsetWithProfile + skewAdjBidBps
    const finalRawBidAfterNansen = finalRawBidSpreadBps * nansenBidFactor
    const finalRawBidAfterBehavioural = finalRawBidAfterNansen * behaviouralBidFactor
    const finalRawBidAfterChase = finalRawBidAfterBehavioural + (chaseBidTicks * tickBps)
    const finalClampedBidSpreadBps = this.clampSpreadBps(pair, finalRawBidAfterChase)

    const finalRawAskSpreadBps = baseL1OffsetWithProfile + skewAdjAskBps
    const finalRawAskAfterNansen = finalRawAskSpreadBps * nansenAskFactor
    const finalRawAskAfterBehavioural = finalRawAskAfterNansen * behaviouralAskFactor
    const finalRawAskAfterChase = finalRawAskAfterBehavioural + (chaseAskTicks * tickBps)
    const finalClampedAskSpreadBps = this.clampSpreadBps(pair, finalRawAskAfterChase)

    this.notifier.info(
      `[SPREAD] ${pair} profile=${this.config.spreadProfile} ` +
      `L1 bid=${finalClampedBidSpreadBps.toFixed(1)}bps (raw=${finalRawBidAfterChase.toFixed(1)}bps) ` +
      `ask=${finalClampedAskSpreadBps.toFixed(1)}bps (raw=${finalRawAskAfterChase.toFixed(1)}bps) ` +
      `baseRaw=${baseL1OffsetBps}bps baseProfiled=${baseL1OffsetWithProfile.toFixed(1)}bps ` +
      `skewAdjBid=${skewAdjBidBps.toFixed(1)}bps skewAdjAsk=${skewAdjAskBps.toFixed(1)}bps ` +
      `nansenBid=${nansenBidFactor.toFixed(2)} nansenAsk=${nansenAskFactor.toFixed(2)} ` +
      `behaviouralBid=${behaviouralBidFactor.toFixed(2)} ` +
      `chaseTicksBid=${chaseBidTicks} chaseTicksAsk=${chaseAskTicks}`
    )

    // 🔍 Debug: pokaż aktualny multi-layer grid dla tej pary (max raz na 5 minut)
    const debugNow = Date.now()
    const last = this.lastGridDebugAt[pair] || 0

    if (!last || debugNow - last > 5 * 60 * 1000) {
      this.lastGridDebugAt[pair] = debugNow

      try {
        // Zakładamy, że gridOrders mają pola: side ('bid'/'ask'), price, sizeUsd
        const buys = gridOrders.filter((o: GridOrder) => o.side === 'bid')
        const sells = gridOrders.filter((o: GridOrder) => o.side === 'ask')

        const buyPrices = buys.map((o: GridOrder) => o.price).filter((x: number) => Number.isFinite(x))
        const sellPrices = sells.map((o: GridOrder) => o.price).filter((x: number) => Number.isFinite(x))

        const bestBid = buyPrices.length ? Math.max(...buyPrices) : NaN
        const bestAsk = sellPrices.length ? Math.min(...sellPrices) : NaN

        let midApprox: number | null = null
        if (Number.isFinite(bestBid) && Number.isFinite(bestAsk)) {
          midApprox = (bestBid + bestAsk) / 2
        } else if (Number.isFinite(midPrice)) {
          midApprox = midPrice
        }

        const buyNotional = buys.reduce((acc: number, o: GridOrder) => acc + (o.sizeUsd || 0), 0)
        const sellNotional = sells.reduce((acc: number, o: GridOrder) => acc + (o.sizeUsd || 0), 0)

        const buySpan =
          buyPrices.length
            ? `${Math.min(...buyPrices).toFixed(4)}→${Math.max(...buyPrices).toFixed(4)}`
            : 'n/a'

        const sellSpan =
          sellPrices.length
            ? `${Math.min(...sellPrices).toFixed(4)}→${Math.max(...sellPrices).toFixed(4)}`
            : 'n/a'

        const midStr = midApprox !== null ? midApprox.toFixed(4) : 'n/a'

        this.notifier.info(
          `📊 [ML-GRID] pair=${pair} mid≈${midStr} ` +
          `buyLevels=${buys.length} sellLevels=${sells.length} ` +
          `buyPx=${buySpan} sellPx=${sellSpan} ` +
          `buyNotional≈$${buyNotional.toFixed(2)} sellNotional≈$${sellNotional.toFixed(2)}`
        )
      } catch (e) {
        // Nie zabijaj bota, jeśli debug log się wywali
        console.warn(`[ML-GRID] debug log failed for ${pair}:`, e)
      }
    }

    // Cancel existing orders
    if (this.trading instanceof LiveTrading) {
      const existingOrders = await this.trading.getOpenOrders(pair)
      if (existingOrders.length > 0) {
        await this.trading.cancelPairOrders(pair)
      }
    }

    // Place grid orders
    for (const gridOrder of gridOrders) {
      const side = gridOrder.side === 'bid' ? 'buy' : 'sell'

      // Drop anything below min notional as a final safety
      if (gridOrder.sizeUsd + 1e-9 < MIN_NOTIONAL) {
        this.notifier.warn(`   drop < minNotional: $${gridOrder.sizeUsd.toFixed(2)} < $${MIN_NOTIONAL}`)
        continue
      }

      this.notifier.info(`   L${gridOrder.layer} ${side.toUpperCase()}: $${gridOrder.price.toFixed(4)} × ${gridOrder.units.toFixed(2)} ($${gridOrder.sizeUsd.toFixed(0)})`)

      await this.trading.placeOrder(
        pair,
        side,
        gridOrder.price,
        gridOrder.sizeUsd,  // placeOrder expects USD, it converts to units internally
        'limit'
      )
    }

    this.stateManager.recordExecution(true, Date.now() - startTime)
  }

  async executePairMM(pair: string, assetCtxs?: any[]) {
    // Route to multi-layer grid if enabled
    if (this.config.enableMultiLayer && this.gridManager) {
      return await this.executeMultiLayerMM(pair, assetCtxs)
    }

    // Fallback to regular MM
    return await this.executeRegularMM(pair, assetCtxs)
  }

  async executeRegularMM(pair: string, assetCtxs?: any[]) {
    const startTime = Date.now()

    if (this.alertManager?.shouldPauseTrading()) {
      const status = this.alertManager.getPauseStatus()
      if (!this._autoPauseLogAt || Date.now() - this._autoPauseLogAt > 60_000) {
        this._autoPauseLogAt = Date.now()
        const remainingMin = status.pausedUntil
          ? Math.ceil((status.pausedUntil.getTime() - Date.now()) / 60_000)
          : 0
        console.warn(
          `🛑 [AUTO-PAUSE] Trading suspended for ${pair} | ` +
          `Reason: ${status.reason} | Remaining: ${remainingMin} min`
        )
      }
      return
    }

    // Get current market data (use cached if provided)
    if (!assetCtxs) {
      const [meta, ctxs] = await this.api.getMetaAndAssetCtxs()
      assetCtxs = ctxs
    }
    const pairData = assetCtxs.find(ctx => ctx.coin === pair)

    if (!pairData) {
      this.notifier.warn(`⚠️  No data for ${pair}`)
      return
    }

    const midPrice = Number(pairData.midPx || 0)
    if (midPrice === 0) {
      this.notifier.warn(`⚠️  Invalid mid price for ${pair}`)
      return
    }
    if (pair === 'ZEC') {
      recordZecMidPrice(midPrice)
    }

    // ══════════════════════════════════════════════════════════════
    // 👻 SHADOW WATCH - Market Regime Detection (Background Mode)
    // ══════════════════════════════════════════════════════════════
    if (!this.shadowWatchers.has(pair)) {
      this.shadowWatchers.set(pair, createDefaultShadowWatch())
      console.log(`👻 [SHADOW] ${pair}: Initialized`)
    }

    const shadowWatch = this.shadowWatchers.get(pair)!
    shadowWatch.update(midPrice)

    if (shadowWatch.isReady()) {
      const analysis = shadowWatch.analyze()

      const now = Date.now()
      if (now - this.lastShadowLog > 5 * 60 * 1000) { // Log every 5 minutes
        if (analysis.confidence > 0.6) {
          console.log(`👻 [SHADOW] ${pair}: ${analysis.reason}`)
          console.log(`  Regime: ${analysis.regime}, Confidence: ${(analysis.confidence * 100).toFixed(0)}%`)
          console.log(`  Suggested Multipliers: Bid×${analysis.suggestedBidMultiplier.toFixed(2)} Ask×${analysis.suggestedAskMultiplier.toFixed(2)} Size×${analysis.suggestedSizeMultiplier.toFixed(2)}`)
        }
        this.lastShadowLog = now
      }
    } else {
      const stats = shadowWatch.getStats()
      const now = Date.now()
      if (now - this.lastShadowLog > 30 * 1000) { // Log every 30s during warmup
        console.log(`👻 [SHADOW] ${pair}: Warming up ${stats.dataPoints}/10`)
        this.lastShadowLog = now
      }
    }

    // ══════════════════════════════════════════════════════════════
    // 📊 EMA 200 TREND FILTER (Background Mode)
    // ══════════════════════════════════════════════════════════════
    if (!this.trendFilters.has(pair)) {
      this.trendFilters.set(pair, new TrendFilter())
      console.log(`📊 [TREND] ${pair}: Initialized`)
    }

    const trendFilter = this.trendFilters.get(pair)!
    trendFilter.update(midPrice)

    if (trendFilter.isReady()) {
      const trendStatus = trendFilter.getTrendStatus()

      const now = Date.now()
      if (now - this.lastTrendLog > 5 * 60 * 1000) { // Log every 5 minutes
        if (trendStatus.isBelowEMA) {
          console.log(`📊 [TREND] ${pair}: ⚠️ DOWNTREND - Price $${midPrice.toFixed(2)} < EMA200 $${trendStatus.ema200?.toFixed(2)}`)
          console.log(`  → Would block LONG positions in active mode`)
        } else {
          console.log(`📊 [TREND] ${pair}: ✅ UPTREND - Price $${midPrice.toFixed(2)} > EMA200 $${trendStatus.ema200?.toFixed(2)}`)
        }
        this.lastTrendLog = now
      }
    } else {
      const now = Date.now()
      if (now - this.lastTrendLog > 60 * 1000) { // Log every 60s during warmup
        console.log(`📊 [TREND] ${pair}: Collecting data (need 200 samples for EMA200)`)
        this.lastTrendLog = now
      }
    }

    const symbol = pair.split(/[-_]/)[0].toUpperCase()
    const nowDate = new Date()
    const globalDowntrend = isGlobalDowntrendActive()
    const adaptive = computeAdaptiveMultipliers(symbol, nowDate, globalDowntrend)
    if (adaptive.mode !== 'none') {
      this.notifier.info(
        `[RISK_ADAPT] ${pair} ${adaptive.mode === 'defensive' ? 'defensive mode' : 'weekend boost'} size×${adaptive.sizeMult.toFixed(2)} spread×${adaptive.spreadMult.toFixed(2)}`
      )
    }

    // ══════════════════════════════════════════════════════════════
    // Get REAL position from Hyperliquid (synced via fills)
    // ══════════════════════════════════════════════════════════════
    const state = this.stateManager.getState()
    const position = state.positions[pair]

    // 🛡️ SOFT SL enforcement (per-pair risk limits)
    if (position) {
      const positionValueUsd = position.size * midPrice
      const unrealizedPnlUsd = position.side === 'long'
        ? (midPrice - position.entryPrice) * position.size
        : (position.entryPrice - midPrice) * position.size

      const perPairOk = await this.enforcePerPairRisk(pair, unrealizedPnlUsd)
      if (!perPairOk) return // SL hit, position closed, skip this tick
    }

    // Calculate order size with tuning
    const adjustedOrderUsd = this.baseOrderUsd * this.tuning.orderUsdFactor

    // Use Kelly Criterion for position sizing (simplified)
    const kellySize = positionSizeUSD({
      winProb: 0.55,
      winRatio: 1.4,
      bankrollUsd: 20000
    })
    let orderSize = Math.min(adjustedOrderUsd, kellySize)
    orderSize *= adaptive.sizeMult

    // Calculate spread with tuning
    let adjustedSpread = this.makerSpreadBps * this.tuning.makerSpreadFactor
    adjustedSpread *= adaptive.spreadMult

    // 🛡️ Safety: Clamp to min/max bounds (same as multi-layer)
    const MIN_SPREAD_BPS = Number(process.env.MIN_FINAL_SPREAD_BPS ?? 8)
    const MAX_SPREAD_BPS = Number(process.env.MAX_FINAL_SPREAD_BPS ?? 140)
    let clampedSpread = Math.max(MIN_SPREAD_BPS, Math.min(MAX_SPREAD_BPS, adjustedSpread))

    // ══════════════════════════════════════════════════════════════
    // 🏛️ INSTITUTIONAL ORDER BOOK INTELLIGENCE
    // ══════════════════════════════════════════════════════════════
    if (this.config.enableMultiLayer) {
      // 1. DIVERGENCE MULTIPLIERS (from Golden Duo TIER 3)
      const divMults = this.getDivergenceMultipliers(pair)
      if (divMults.spreadMult !== 1.0) {
        clampedSpread = clampedSpread * divMults.spreadMult
        console.log(`🏛️ [DIVERGENCE] ${pair}: Spread ×${divMults.spreadMult.toFixed(2)}, Inv ×${divMults.inventoryMult.toFixed(2)}`)
      }

      // 2. ORDER BOOK INTELLIGENCE (Imbalance Alpha + Wall Avoidance)
      try {
        const obAnalysis = this.analyzeOrderBook(pair)
        if (obAnalysis) {
          // Imbalance Alpha: Widen spread when order book is heavily imbalanced
          // imbalance is -1 to +1, where positive = bid-heavy, negative = ask-heavy
          const absImbalance = Math.abs(obAnalysis.imbalance)
          if (absImbalance > 0.3) {
            const imbalanceMult = 1 + (absImbalance * 0.5) // Max 1.5x for 100% imbalance
            clampedSpread = clampedSpread * imbalanceMult
            console.log(`📊 [IMBALANCE] ${pair}: Imbalance ${(obAnalysis.imbalance * 100).toFixed(0)}% → Spread ×${imbalanceMult.toFixed(2)}`)
          }

          // Wall Avoidance: Log when large walls detected
          if (obAnalysis.wallDetected) {
            console.log(`🧱 [WALL] ${pair}: Large wall detected on ${obAnalysis.wallSide.toUpperCase()} side`)
          }
        }
      } catch (err) {
        // Silently ignore order book analysis errors
      }
    }

    // Re-clamp after adjustments
    clampedSpread = Math.max(MIN_SPREAD_BPS, Math.min(MAX_SPREAD_BPS, clampedSpread))

    const spreadFactor = clampedSpread / 10000

    // ══════════════════════════════════════════════════════════════
    // 🧠 GOLDEN DUO: Smart Money Alpha Integration
    // ══════════════════════════════════════════════════════════════

    // A. Fetch Golden Duo signals (cached for 60s)
    const gdSignal = await this.getGoldenDuoSignalForPair(pair)
    const rawPositionBias = gdSignal?.positionBias ?? 0
    const rawFlowSkew = gdSignal?.flowSkew ?? 0

    // 🕵️ SIGNAL VERIFICATION: Track & Validate Smart Money signals
    if (Math.abs(rawPositionBias) > 0.5) {
      this.signalVerifier.trackSignal(pair, rawPositionBias, midPrice)
    }

    // Update historical performance
    this.signalVerifier.updatePerformance(pair, midPrice)

    // Get confidence multiplier (0.2-1.0)
    const confidence = this.signalVerifier.getConfidence(pair)

    // Apply verification: Raw Signal × Confidence = Verified Signal
    const positionBias = rawPositionBias * confidence
    const flowSkew = rawFlowSkew * confidence

    // Log VERIFIED signals (not raw)
    if (rawPositionBias !== 0 || rawFlowSkew !== 0) {
      this.notifier.info(
        `[GOLDEN_VERIFIED] ${pair} | Raw Bias: ${rawPositionBias.toFixed(2)} → Verified: ${positionBias.toFixed(2)} (Conf: ${(confidence * 100).toFixed(0)}%) | Flow: ${flowSkew.toFixed(2)}`
      )
    }

    // B. RISK LAYER: Calculate Dynamic Inventory Limits (use VERIFIED bias)
    const baseMaxPos = Number(process.env.MAX_POSITION_USD || 10000)
    const { maxLong, maxShort } = this.calculateDynamicLimits(baseMaxPos, positionBias)

    // Log dynamic limits if they differ from base
    if (positionBias !== 0) {
      this.notifier.info(
        `[GOLDEN_DUO_RISK] ${pair} | Max Long: $${maxLong.toFixed(0)} | Max Short: $${maxShort.toFixed(0)}`
      )
    }

    // C. Check position limits before placing orders
    let allowBuy = true
    let allowSell = true

    if (position) {
      const currentPosSize = Number(position.size || 0)
      const currentPosValue = Math.abs(currentPosSize) * midPrice

      // If we have a Long position exceeding the Smart Money limit -> Block buys
      if (currentPosSize > 0 && currentPosValue >= maxLong) {
        allowBuy = false
        this.notifier.warn(
          `[GOLDEN_DUO_BLOCK] ${pair} Long position $${currentPosValue.toFixed(0)} >= limit $${maxLong.toFixed(0)} - blocking buys`
        )
      }

      // If we have a Short position exceeding the Smart Money limit -> Block sells
      if (currentPosSize < 0 && currentPosValue >= maxShort) {
        allowSell = false
        this.notifier.warn(
          `[GOLDEN_DUO_BLOCK] ${pair} Short position $${currentPosValue.toFixed(0)} >= limit $${maxShort.toFixed(0)} - blocking sells`
        )
      }
    }

    // D. EXECUTION LAYER: Calculate Alpha Shift (Front-running)
    const alphaShift = this.calculateAlphaShift(midPrice, spreadFactor, flowSkew)

    // Log alpha shift if significant (> $0.01)
    if (Math.abs(alphaShift) > 0.01) {
      this.notifier.info(
        `[GOLDEN_DUO_ALPHA] ${pair} Price shift: ${alphaShift > 0 ? '+' : ''}$${alphaShift.toFixed(4)} (flow=${flowSkew.toFixed(2)})`
      )
    }

    // E. Apply Smart Mid-Price
    const smartMidPrice = midPrice + alphaShift

    // Calculate bid/ask prices using Smart Mid-Price
    const bidPrice = smartMidPrice * (1 - spreadFactor)
    const askPrice = smartMidPrice * (1 + spreadFactor)

    // 📊 Log final spread for Regular MM (only if clamped)
    if (clampedSpread !== adjustedSpread) {
      this.notifier.info(
        `[SPREAD] ${pair} Regular MM: clamped ${adjustedSpread.toFixed(1)}bps → ${clampedSpread.toFixed(1)}bps ` +
        `(base=${this.makerSpreadBps}bps tuning=${(this.tuning.makerSpreadFactor * 100).toFixed(0)}%)`
      )
    }

    // ══════════════════════════════════════════════════════════════
    // PROPER MARKET MAKING - Place passive orders and let them fill
    // ══════════════════════════════════════════════════════════════

    // Check existing orders
    const existingOrders = this.trading instanceof LiveTrading
      ? await this.trading.getOpenOrders(pair)
      : []

    // ═══════════════════════════════════════════════════════════
    // CHASE MODE: Update orders when price moves significantly
    // ═══════════════════════════════════════════════════════════
    const CHASE_THRESHOLD = 0.05  // 5% - less aggressive (was 0.5%)
    let shouldCancelOrders = false

    if (existingOrders.length > 0) {
      for (const order of existingOrders) {
        const orderPrice = parseFloat(order.limitPx)

        // Check if order is stale based on mid price movement
        const priceDiffFromMid = Math.abs(midPrice - orderPrice) / midPrice

        // For BUY orders: check if we're too far below current bid price
        // For SELL orders: check if we're too far above current ask price
        let isOrderStale = priceDiffFromMid > CHASE_THRESHOLD

        if (order.side === 'B') {
          // BUY order - should be near bidPrice
          const diffFromBid = Math.abs(bidPrice - orderPrice) / bidPrice
          isOrderStale = isOrderStale || diffFromBid > CHASE_THRESHOLD
        } else {
          // SELL order - should be near askPrice
          const diffFromAsk = Math.abs(askPrice - orderPrice) / askPrice
          isOrderStale = isOrderStale || diffFromAsk > CHASE_THRESHOLD
        }

        if (isOrderStale) {
          shouldCancelOrders = true
          this.notifier.info(`   🏃 Chase mode: Order stale, will update (price moved ${(priceDiffFromMid * 100).toFixed(2)}%)`)
          break
        }
      }
    }

    // Check if we have both BID and ASK orders
    const hasBidOrder = existingOrders.some(o => o.side === 'B')
    const hasAskOrder = existingOrders.some(o => o.side === 'A')
    const hasBothOrders = hasBidOrder && hasAskOrder

    // ═══════════════════════════════════════════════════════════
    // OPTIMIZED: Use batchModify instead of cancel+place
    // This reduces API calls from 4 (cancel BID, cancel ASK, place BID, place ASK)
    // to 1 (modify 2 orders) = 4x faster! 🚀
    // ═══════════════════════════════════════════════════════════
    if (shouldCancelOrders && hasBothOrders && this.trading instanceof LiveTrading) {
      // Try batch modify ONLY if we have BOTH orders (much faster!)
      this.notifier.info(`   🔄 Attempting batch modify for ${pair} (BID=$${bidPrice.toFixed(4)}, ASK=$${askPrice.toFixed(4)})`)
      const modified = await this.trading.batchModifyOrders(pair, bidPrice, askPrice, orderSize)

      if (modified) {
        this.notifier.info(`   ⚡ Batch modified 2 orders (4x faster than cancel+place!)`)
        return // Orders updated, we're done!
      } else {
        // Fall back to cancel if modify fails
        this.notifier.info(`   ⚠️  Batch modify failed, falling back to cancel+place`)
        await this.trading.cancelPairOrders(pair)
      }
    } else if (shouldCancelOrders && hasBothOrders && !(this.trading instanceof LiveTrading)) {
      // Dry run mode - cancel and recreate
      await this.trading.cancelPairOrders(pair)
    } else if (existingOrders.length > 2 && this.trading instanceof LiveTrading) {
      // Too many orders (more than 2), cancel them
      await this.trading.cancelPairOrders(pair)
    }

    // If we have only 1 order and chase mode detected stale orders,
    // DON'T cancel! Just place the missing order to complete the pair.
    // This prevents the constant cancel loop where we never have both orders.

    // ═══════════════════════════════════════════════════════════════════
    // DUAL-SIDED MARKET MAKING - Place BOTH bid and ask simultaneously
    // ═══════════════════════════════════════════════════════════════════

    // Calculate current position exposure
    const currentPositionValue = position ? Math.abs(position.size) : 0
    const maxPositionSizeUsd = orderSize * 4  // Allow up to 4x base order size (MAX_POSITION_MULTIPLIER)

    // Determine if we can place each side based on position limits
    let canPlaceBid = !hasBidOrder && (!position || position.side !== 'short' || currentPositionValue < maxPositionSizeUsd)
    let canPlaceAsk = !hasAskOrder && (!position || position.side !== 'long' || currentPositionValue < maxPositionSizeUsd)

    // Apply Golden Duo Smart Money limits (override position limits if needed)
    if (!allowBuy) {
      canPlaceBid = false
    }
    if (!allowSell) {
      canPlaceAsk = false
    }

    // PLACE BID ORDER (buy side)
    if (canPlaceBid) {
      this.notifier.info(`📊 ${pair} MM: Placing BID $${bidPrice.toFixed(4)} | Spread: ${adjustedSpread}bps`)

      await this.trading.placeOrder(
        pair,
        'buy',
        bidPrice,
        orderSize,
        'limit'
      )
    } else if (!hasBidOrder) {
      if (!allowBuy) {
        this.notifier.info(`   ⏸️  BID skipped: Golden Duo Smart Money limit reached`)
      } else {
        this.notifier.info(`   ⏸️  BID skipped: Position limit reached ($${currentPositionValue.toFixed(0)} / $${maxPositionSizeUsd.toFixed(0)})`)
      }
    }

    // PLACE ASK ORDER (sell side)
    if (canPlaceAsk) {
      // If we have a long position, ensure we sell above entry for profit
      let targetAskPrice = askPrice
      if (position && position.side === 'long' && position.entryPrice > 0) {
        const minSellPrice = position.entryPrice * (1 + spreadFactor)
        targetAskPrice = Math.max(askPrice, minSellPrice)
        this.notifier.info(`📊 ${pair} MM: Placing ASK $${targetAskPrice.toFixed(4)} (entry: $${position.entryPrice.toFixed(4)})`)
      } else {
        this.notifier.info(`📊 ${pair} MM: Placing ASK $${targetAskPrice.toFixed(4)} | Spread: ${adjustedSpread}bps`)
      }

      await this.trading.placeOrder(
        pair,
        'sell',
        targetAskPrice,
        orderSize,
        'limit'
      )
    } else if (!hasAskOrder) {
      if (!allowSell) {
        this.notifier.info(`   ⏸️  ASK skipped: Golden Duo Smart Money limit reached`)
      } else {
        this.notifier.info(`   ⏸️  ASK skipped: Position limit reached ($${currentPositionValue.toFixed(0)} / $${maxPositionSizeUsd.toFixed(0)})`)
      }
    }

    // Positions are updated ONLY via syncPnLFromHyperliquid() in main loop
    this.stateManager.recordExecution(true, Date.now() - startTime)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Taker Order Strategy - Unlocks API rate limits
  // ───────────────────────────────────────────────────────────────────────────

  async executeTakerOrder() {
    const now = Date.now()

    // Check if it's time for a taker order
    if (now - this.lastTakerOrderTime < this.takerOrderIntervalMs) {
      return
    }

    this.notifier.info('⚡ Executing taker order to unlock rate limits...')

    try {
      // Pick the first active trading pair
      const pairs = this.rotation.getCurrentPairs()
      if (pairs.length === 0) {
        this.notifier.warn('   No active pairs for taker order')
        return
      }

      const pair = pairs[0]

      // Get current market price
      const [meta, assetCtxs] = await this.api.getMetaAndAssetCtxs()
      const pairData = assetCtxs.find(ctx => ctx.coin === pair)

      if (!pairData) {
        this.notifier.warn(`   No data for ${pair}`)
        return
      }

      const midPrice = Number(pairData.midPx || 0)
      if (midPrice === 0) {
        this.notifier.warn(`   Invalid mid price for ${pair}`)
        return
      }
      if (pair === 'ZEC') {
        recordZecMidPrice(midPrice)
      }

      // Place a taker order (market order with IOC)
      // Alternate between buy and sell to stay balanced
      const isBuy = Math.random() > 0.5

      this.notifier.info(`   ${isBuy ? '💚 BUY' : '💔 SELL'} ${pair} @ market (${this.takerOrderSizeUsd} USD)`)

      const result = await this.trading.placeOrder(
        pair,
        isBuy ? 'buy' : 'sell',
        midPrice,
        this.takerOrderSizeUsd,
        'market'  // Uses IOC for immediate fill
      )

      if (result.success) {
        this.notifier.info(`   ✅ Taker order executed successfully!`)
        this.notifier.info(`   📈 Rate limit unlocked: +$${this.takerOrderSizeUsd} volume`)
        this.lastTakerOrderTime = now
      } else {
        this.notifier.warn(`   ⚠️  Taker order failed`)
      }

    } catch (error) {
      this.notifier.error(`   Error executing taker order: ${error}`)
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ZEC DEFENSIVE MODE HELPERS
  // ───────────────────────────────────────────────────────────────────────────

  private applyZecDefensiveGuards(params: {
    side: 'buy' | 'sell'
    roundedPrice: number
    currentPosSz: number
    cetHour: number
  }): boolean {
    const { side, roundedPrice, currentPosSz, cetHour } = params

    if (side !== 'buy') {
      return true
    }

    const curPosSz = currentPosSz
    if (curPosSz <= 0) {
      return true
    }

    const curPosUsd = Math.abs(curPosSz) * Math.max(roundedPrice, 0)

    // Night defensive window (CET 0–7)
    const inNightWindow = cetHour >= 0 && cetHour < 7
    if (inNightWindow) {
      if (isZecNightUnwindOnly()) {
        console.warn(
          `[ZEC_DEFENSIVE] Night unwind-only: blocking BUY. curPosUsd=${curPosUsd.toFixed(2)} hour=${cetHour}`
        )
        return false
      }

      const nightMaxUsd = getZecNightMaxPosUsd()
      if (curPosUsd > nightMaxUsd) {
        console.warn(
          `[ZEC_DEFENSIVE] Night max exceeded: blocking BUY. curPosUsd=${curPosUsd.toFixed(2)} max=${nightMaxUsd.toFixed(2)} hour=${cetHour}`
        )
        return false
      }
    }

    // Downtrend defensive window
    if (isZecDowntrendActive()) {
      if (isZecDefensiveUnwindOnly()) {
        console.warn(
          `[ZEC_DEFENSIVE] Downtrend unwind-only: blocking BUY. curPosUsd=${curPosUsd.toFixed(2)} moveThreshold=${getZecDownMovePct()}%`
        )
        return false
      }

      const defensiveMaxUsd = getZecDefensiveMaxPosUsd()
      if (curPosUsd > defensiveMaxUsd) {
        console.warn(
          `[ZEC_DEFENSIVE] Downtrend cap reached: blocking BUY. curPosUsd=${curPosUsd.toFixed(2)} max=${defensiveMaxUsd.toFixed(2)}`
        )
        return false
      }
    }

    return true
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Status Logging
  // ───────────────────────────────────────────────────────────────────────────

  logStatus(supervisorResult: any) {
    const state = this.stateManager.getState()
    const stats = this.stateManager.getExecStats()

    const successRate = stats.lastN > 0
      ? (stats.success / stats.lastN * 100).toFixed(1)
      : '0.0'

    // Get Global Vision State
    const vision = this.marketVision.getGlobalState();
    const visionStr = `Vision: BTC=${vision.btcTrend} Regime=${vision.regime}`;

    this.notifier.info('─'.repeat(80))
    this.notifier.info(`📊 Status | Daily PnL: $${state.dailyPnl.toFixed(2)} | Total: $${state.totalPnl.toFixed(2)}`)
    this.notifier.info(`   Exec: ${successRate}% success (${stats.success}/${stats.lastN}) | Avg latency: ${stats.avgLatencyMs.toFixed(0)}ms`)
    this.notifier.info(`   Tuning: order=${(this.tuning.orderUsdFactor * 100).toFixed(0)}% | spread=${(this.tuning.makerSpreadFactor * 100).toFixed(0)}%`)
    this.notifier.info(`   Health: ${supervisorResult.healthEval.severity} | ${visionStr}`)

    // Log Toxic Flow Protection status (properties are on LiveTrading, not HyperliquidMMBot)
    const lt = this.trading as LiveTrading;
    const binanceConnected = lt.binanceAnchor?.isConnected() || false;
    const binancePrices = lt.binanceAnchor?.getPriceCount() || 0;
    const binanceStatus = binanceConnected ? (binancePrices > 0 ? '✅' : '⏳') : '❌';
    if (lt.vpinAnalyzers && lt.vpinAnalyzers.size > 0) {
      const vpinStatus = Array.from(lt.vpinAnalyzers.entries())
        .map(([pair, analyzer]) => {
          const info = analyzer.getToxicityLevel();
          return `${pair}:${(info.vpin * 100).toFixed(0)}%`;
        })
        .join(' ');
      this.notifier.info(`   🛡️ ToxicFlow: Binance=${binanceStatus}(${binancePrices}) | VPIN: ${vpinStatus}`);
    } else {
      this.notifier.info(`   🛡️ ToxicFlow: Binance=${binanceStatus}(${binancePrices}) | VPIN: awaiting (${lt.vpinAnalyzers?.size || 0})`);
    }

    // Log positions
    const posCount = Object.keys(state.positions).length
    if (posCount > 0) {
      this.notifier.info(`   Positions (${posCount}):`)
      for (const [pair, pos] of Object.entries(state.positions)) {
        this.notifier.info(`     ${pair}: ${pos.side} $${pos.size.toFixed(0)} @ $${pos.entryPrice.toFixed(4)}`)
      }
    }

    this.notifier.info('─'.repeat(80))
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Per-Pair Risk Management (Soft SL)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Get per-pair max loss from environment variables
   */
  private getPerPairMaxLossUsd(pair: string): number | null {
    const upper = pair.toUpperCase()
    const envKey = `${upper}_MAX_LOSS_PER_SIDE_USD`
    const value = process.env[envKey]
    if (value) {
      return Number(value)
    }
    // Fallback to default if not set
    return Number(process.env.DEFAULT_MAX_LOSS_PER_SIDE_USD || 100)
  }

  /**
   * Enforce per-pair risk limits (soft stop loss)
   * Returns false if position was closed due to SL hit
   */
  private async enforcePerPairRisk(pair: string, unrealizedPnlUsd: number): Promise<boolean> {
    const upper = pair.toUpperCase()
    let maxLoss = this.getPerPairMaxLossUsd(pair)

    if (!maxLoss || maxLoss <= 0) {
      return true // No limit set, allow trading
    }

    // 🧠 Nansen hook: adjust soft SL based on risk level
    if (this.nansenBias && this.nansenBias.isEnabled()) {
      const signal = this.nansenBias.getSignal(upper)
      if (signal) {
        if (signal.riskLevel === 'avoid') {
          maxLoss = maxLoss * 0.6  // 60% dla avoid (ostrzejsze)
          this.notifier.warn(
            `🧠 [NANSEN] ${upper} marked as AVOID → tightening soft SL to 60% (maxLoss=${maxLoss.toFixed(2)})`
          )
        } else if (signal.riskLevel === 'caution') {
          maxLoss = maxLoss * 0.8  // 80% dla caution
          this.notifier.info(
            `🧠 [NANSEN] ${upper} marked as CAUTION → tightening soft SL to 80% (maxLoss=${maxLoss.toFixed(2)})`
          )
        }
        // 'ok' → pełny limit (bez zmian)
      }
    }

    // Check if unrealized PnL exceeds limit
    if (unrealizedPnlUsd < -maxLoss) {
      this.notifier.warn(
        `[RISK] ❌ SOFT SL HIT on ${upper}: uPnL $${unrealizedPnlUsd.toFixed(2)} < -$${maxLoss.toFixed(2)}`
      )

      // Cancel all open orders for this pair
      if (this.trading instanceof LiveTrading) {
        try {
          await this.trading.cancelPairOrders(upper)
        } catch (err) {
          this.notifier.warn(`Failed to cancel orders for ${upper}: ${err}`)
        }
      }

      // Close position
      try {
        if (this.trading instanceof LiveTrading) {
          await (this.trading as LiveTrading).closePositionForPair(upper, 'soft_sl')
        }
      } catch (err) {
        this.notifier.error(`Failed to close position for ${upper}: ${err}`)
      }

      return false // Position closed
    }

    return true // OK, continue trading
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Utilities
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Calculate total equity (USDT + all crypto positions value)
   */
  private async calculateTotalEquity(): Promise<number> {
    try {
      const state = await this.api.getClearinghouseState(this.walletAddress)

      // Hyperliquid returns accountValue which includes:
      // - Cash (USDT equivalent)
      // - Unrealized PnL of all positions
      const marginSummary = state.marginSummary
      const totalUsd = Number(marginSummary.accountValue || 0)

      return totalUsd
    } catch (error) {
      console.error('[RISK] Error calculating total equity:', error)
      return 0
    }
  }

  /**
   * Calculate total inventory value (all open positions across all pairs)
   */
  private async getTotalInventoryValue(): Promise<number> {
    try {
      const state = await this.api.getClearinghouseState(this.walletAddress)

      let totalInventory = 0

      for (const pos of state.assetPositions) {
        const size = Math.abs(Number(pos.position.szi))
        const entryPrice = Number(pos.position.entryPx)
        const posValue = size * entryPrice
        totalInventory += posValue
      }

      return totalInventory
    } catch (error) {
      console.error('[RISK] Error calculating inventory value:', error)
      return 0
    }
  }

  /**
   * Emergency liquidation - market sell all positions
   */
  private async emergencyLiquidateAll(): Promise<void> {
    console.error('🚨 EMERGENCY LIQUIDATION - Selling all positions at market!')

    try {
      const state = await this.api.getClearinghouseState(this.walletAddress)
      const [, assetCtxs] = await this.api.getMetaAndAssetCtxs()

      for (const pos of state.assetPositions) {
        const size = Number(pos.position.szi)
        if (Math.abs(size) < 0.0001) continue

        const pair = pos.position.coin
        const side = size > 0 ? 'sell' : 'buy' // Close position
        const absSize = Math.abs(size)

        try {
          // `HyperliquidAPI` is read-only; execute via the live trading client.
          const ctx = assetCtxs.find((c: any) => c.coin === pair)
          const px = Number(ctx?.midPx || 0)
          const sizeUsd = px > 0 ? absSize * px : absSize
          await this.trading.placeOrder(pair, side as any, px, sizeUsd, 'market', true)
          console.log(`✅ Emergency liquidated ${pair}: ${side} ${absSize}`)
        } catch (error) {
          console.error(`❌ Failed to liquidate ${pair}:`, error)
        }
      }
    } catch (error) {
      console.error('❌ Emergency liquidation failed:', error)
    }
  }

  /**
   * Calculate and log PnL for all trading pairs (hourly report)
   */
  private async logHourlyPnL(): Promise<void> {
    try {
      const state = await this.api.getClearinghouseState(this.walletAddress)
      const [, assetCtxs] = await this.api.getMetaAndAssetCtxs()

      // Calculate per-pair PnL
      interface PairPnL {
        pair: string
        size: number
        entryPrice: number
        currentPrice: number
        positionValue: number
        unrealizedPnL: number
        unrealizedPnLPct: number
      }

      const pairPnLs: PairPnL[] = []
      let totalUnrealizedPnL = 0

      for (const pos of state.assetPositions) {
        const size = Number(pos.position.szi)
        if (Math.abs(size) < 0.0001) continue

        const pair = pos.position.coin
        const entryPrice = Number(pos.position.entryPx)

        // Get current mid price
        const assetCtx = assetCtxs.find((ctx) => ctx.coin === pair)
        const currentPrice = assetCtx ? Number(assetCtx.midPx) : entryPrice

        // Calculate unrealized PnL
        const positionValue = Math.abs(size) * currentPrice
        const costBasis = Math.abs(size) * entryPrice
        const unrealizedPnL = size > 0
          ? (currentPrice - entryPrice) * Math.abs(size)  // Long
          : (entryPrice - currentPrice) * Math.abs(size)  // Short

        const unrealizedPnLPct = (unrealizedPnL / costBasis) * 100

        pairPnLs.push({
          pair,
          size,
          entryPrice,
          currentPrice,
          positionValue,
          unrealizedPnL,
          unrealizedPnLPct
        })

        totalUnrealizedPnL += unrealizedPnL
      }

      // Get account value and cash
      const accountValue = Number(state.marginSummary.accountValue || 0)
      const withdrawable = Number(state.withdrawable || 0)

      // Log hourly PnL report
      console.log('\n═══════════════════════════════════════════════')
      console.log(`💰 HOURLY PnL REPORT (${new Date().toLocaleTimeString()})`)
      console.log('═══════════════════════════════════════════════')
      console.log(`Account Value: $${accountValue.toFixed(2)}`)
      console.log(`Withdrawable:  $${withdrawable.toFixed(2)}`)
      console.log(`Total Unrealized PnL: $${totalUnrealizedPnL.toFixed(2)}`)
      console.log('─────────────────────────────────────────────────')

      if (pairPnLs.length > 0) {
        console.log('Per-Pair Breakdown:')
        console.log('─────────────────────────────────────────────────')

        // Sort by unrealized PnL (biggest winners/losers first)
        pairPnLs.sort((a, b) => Math.abs(b.unrealizedPnL) - Math.abs(a.unrealizedPnL))

        for (const pnl of pairPnLs) {
          const side = pnl.size > 0 ? 'LONG' : 'SHORT'
          const pnlSign = pnl.unrealizedPnL >= 0 ? '📈' : '📉'
          console.log(`${pnlSign} ${pnl.pair.padEnd(8)} ${side.padEnd(6)} Size: ${Math.abs(pnl.size).toFixed(4)}`)
          console.log(`   Entry: $${pnl.entryPrice.toFixed(2)} → Current: $${pnl.currentPrice.toFixed(2)}`)
          console.log(`   PnL: $${pnl.unrealizedPnL.toFixed(2)} (${pnl.unrealizedPnLPct.toFixed(2)}%)`)
          console.log('─────────────────────────────────────────────────')
        }
      } else {
        console.log('No open positions')
        console.log('─────────────────────────────────────────────────')
      }

      console.log('═══════════════════════════════════════════════\n')

    } catch (error) {
      console.error('[PnL Report] Error calculating hourly PnL:', error)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INSTITUTIONAL ORDER BOOK INTELLIGENCE MODULES
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // MULTI-TIER WORKER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Initialize Multi-Tier Workers (call from constructor or initialize)
   */
  private initializeMultiTierWorkers(): void {
    // 1. TIER 2: TACTICAL WORKER (Every 5s) - Smart Money Trade Detection
    this.tacticalInterval = setInterval(() => {
      this.runTacticalWorker().catch(err =>
        this.notifier.warn(`[TACTICAL] Worker failed: ${err.message}`)
      );
    }, 5000);

    // 2. TIER 3: STRATEGIC WORKER (Every 1m) - Bias & Golden Duo Sync
    this.strategicInterval = setInterval(() => {
      this.syncGoldenDuo().catch(err =>
        this.notifier.warn(`[STRATEGIC] Golden Duo sync failed: ${err.message}`)
      );
    }, 60000);

    // Initial sync
    this.syncGoldenDuo().catch(() => { });

    this.notifier.info(`🚀 [MULTI-TIER] Institutional workers initialized (T2:5s, T3:1m)`);
  }

  /**
   * TIER 2: TACTICAL WORKER (Every 5s)
   * Detects real-time Smart Money trades and applies immediate Alpha Shift
   */
  private async runTacticalWorker(): Promise<void> {
    try {
      const proxyUrl = process.env.NANSEN_PROXY_URL || 'http://localhost:8081'
      const response = await fetch(`${proxyUrl}/api/latest_trades`)
      if (!response.ok) return;

      const { trades } = await response.json() as { trades: any[] };
      if (!Array.isArray(trades)) return;

      // Clear old buffer
      this.tacticalSignalBuffer.clear();

      // Look for significant trades from known whales
      const WHALE_WATCHLIST = [
        { name: 'Laurent Zeimes', address: '0x8def9f', tier: 2, weight: 0.9 },
        { name: 'muzzy.eth', address: '0xe4446d', tier: 2, weight: 0.85 },
        { name: 'SM_0xea6670', address: '0xea6670', tier: 3, weight: 0.7 },
        { name: 'SM_0x570b09', address: '0x570b09', tier: 3, weight: 0.65 },
      ];

      for (const trade of trades) {
        const whale = WHALE_WATCHLIST.find(w =>
          trade.address?.toLowerCase().includes(w.address.toLowerCase()) ||
          trade.trader?.toLowerCase().includes(w.name.toLowerCase())
        );

        if (whale) {
          const sideLower = trade.side?.toLowerCase() || '';
          const sideSign = (sideLower === 'buy' || sideLower === 'long') ? 1 : -1;
          const impact = 5 * (4 - whale.tier) * whale.weight * sideSign; // Up to 15bps shift

          const current = this.tacticalSignalBuffer.get(trade.symbol) || 0;
          this.tacticalSignalBuffer.set(trade.symbol, current + impact);

          if (Math.abs(impact) > 2) {
            this.notifier.info(`🎯 [TACTICAL] ${whale.name} ${trade.side} on ${trade.symbol} → Alpha Shift ${impact > 0 ? '+' : ''}${impact.toFixed(1)}bps`);
          }
        }
      }
    } catch (e) {
      // Silent tactical fail
    }
  }

  /**
   * TIER 3: STRATEGIC WORKER (Every 1m)
   * Syncs Golden Duo data from nansen-bridge and detects divergences
   */
  private async syncGoldenDuo(): Promise<void> {
    try {
      const proxyUrl = process.env.NANSEN_PROXY_URL || 'http://localhost:8081'
      const response = await fetch(`${proxyUrl}/api/golden_duo`)
      if (!response.ok) {
        return;
      }

      const data = await response.json() as Record<string, any>;

      // Update cache with divergence detection
      for (const [coin, v] of Object.entries(data)) {
        const smNet = v.sm_net_balance_usd || 0;
        const whaleNet = v.whale_net_balance_usd || 0;
        const smIsLong = smNet > 0;
        const whaleIsLong = whaleNet > 0;

        // Calculate divergence
        if (smIsLong !== whaleIsLong && (Math.abs(smNet) > 1_000_000 || Math.abs(whaleNet) > 1_000_000)) {
          const positionDiff = Math.abs(smNet - whaleNet);

          v.divergence_type = smIsLong ? 'sm_bull_whale_bear' : 'sm_bear_whale_bull';

          if (positionDiff > 100_000_000) {
            v.divergence_strength = 'extreme';
            v.divergence_spread_mult = 1.5;
            v.divergence_inventory_mult = 1.5;
          } else if (positionDiff > 50_000_000) {
            v.divergence_strength = 'strong';
            v.divergence_spread_mult = 1.4;
            v.divergence_inventory_mult = 1.4;
          } else if (positionDiff > 10_000_000) {
            v.divergence_strength = 'moderate';
            v.divergence_spread_mult = 1.3;
            v.divergence_inventory_mult = 1.3;
          } else {
            v.divergence_strength = 'weak';
            v.divergence_spread_mult = 1.15;
            v.divergence_inventory_mult = 1.15;
          }

          const emoji = v.divergence_strength === 'extreme' ? '🔥🔥' :
            v.divergence_strength === 'strong' ? '🔥' : '⚡';
          this.notifier.info(
            `${emoji} [DIVERGENCE ${v.divergence_strength.toUpperCase()}] ${coin}: ` +
            `SM ${smIsLong ? 'LONG' : 'SHORT'} $${(Math.abs(smNet) / 1e6).toFixed(1)}M vs ` +
            `Whale ${whaleIsLong ? 'LONG' : 'SHORT'} $${(Math.abs(whaleNet) / 1e6).toFixed(1)}M ` +
            `→ spread×${v.divergence_spread_mult} inv×${v.divergence_inventory_mult}`
          );
        } else {
          v.divergence_type = 'none';
          v.divergence_strength = 'none';
          v.divergence_spread_mult = 1.0;
          v.divergence_inventory_mult = 1.0;
        }

        this.goldenDuoData[coin] = v as GoldenDuoData;
      }

      const count = Object.keys(data).length;
      if (count > 0) {
        console.log(`[GoldenDuo] Synced ${count} coins from nansen-bridge`);
      }

      // 🚀 PRIORITY: Use AlphaEngine for real-time Smart Money data
      // Falls back to JSON file if AlphaEngine not running or has no data
      if (alphaEngineIntegration.getIsRunning() && !alphaEngineIntegration.isDataStale()) {
        const alphaCache = getAlphaEngineBiasCache()
        if (Object.keys(alphaCache.data).length > 0) {
          this.nansenBiasCache = alphaCache
          console.log(`[AlphaEngine] Using real-time SM data for ${Object.keys(alphaCache.data).length} coins`)
        } else {
          // AlphaEngine running but no data yet - use JSON fallback
          tryLoadNansenBiasIntoCache(this.nansenBiasCache, { logCoins: ['LIT', 'SUI', 'DOGE', 'ETH', 'SOL'] })
        }
      } else {
        // AlphaEngine not running or stale - use JSON fallback
        tryLoadNansenBiasIntoCache(this.nansenBiasCache, { logCoins: ['LIT', 'SUI', 'DOGE', 'ETH', 'SOL'] })
      }
    } catch (e) {
      // Silent fail
    }
  }

  /**
   * Get Golden Duo divergence multipliers for a pair
   */
  private getDivergenceMultipliers(pair: string): { spreadMult: number; inventoryMult: number } {
    const symbol = pair.replace('-PERP', '').replace('-USD', '');
    const data = this.goldenDuoData[symbol];

    if (data && data.divergence_spread_mult && data.divergence_spread_mult > 1.0) {
      return {
        spreadMult: data.divergence_spread_mult,
        inventoryMult: data.divergence_inventory_mult || 1.0
      };
    }

    return { spreadMult: 1.0, inventoryMult: 1.0 };
  }

  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // ============================================================
  // TELEMETRY SERVER HELPERS
  // ============================================================

  private getTelemetryPositions(): Array<{
    token: string
    side: 'LONG' | 'SHORT' | 'NONE'
    valueUsd: number
    distToTriggerPct: number | null
    distToStopPct: number | null
    severity: string
  }> {
    const positions: Array<{
      token: string
      side: 'LONG' | 'SHORT' | 'NONE'
      valueUsd: number
      distToTriggerPct: number | null
      distToStopPct: number | null
      severity: string
    }> = []

    try {
      // Get positions from state manager
      const state = this.stateManager?.getState()
      if (!state?.positions) return positions

      for (const [pair, pos] of Object.entries(state.positions)) {
        // Read tuning from NANSEN_TOKENS (DynamicConfigManager updates this directly)
        const tuning = NANSEN_TOKENS[pair]?.tuning
        const size = pos.size ?? 0
        const entryPrice = pos.entryPrice ?? 0
        // Estimate mark price from entry (we don't have live price here)
        const valueUsd = Math.abs(size * entryPrice)

        let distToTrigger: number | null = null
        let distToStop: number | null = null

        if (tuning?.squeezeTriggerPrice && entryPrice > 0) {
          distToTrigger = Math.abs((tuning.squeezeTriggerPrice - entryPrice) / entryPrice * 100)
        }
        if (tuning?.stopLossPrice && entryPrice > 0) {
          distToStop = Math.abs((entryPrice - tuning.stopLossPrice) / entryPrice * 100)
        }

        positions.push({
          token: pair,
          side: size > 0 ? 'LONG' : size < 0 ? 'SHORT' : 'NONE',
          valueUsd,
          distToTriggerPct: distToTrigger,
          distToStopPct: distToStop,
          severity: tuning?.smConflictSeverity ?? 'NONE'
        })
      }
    } catch {
      // Silently ignore errors
    }

    return positions
  }

  private getTelemetryPerformance(): {
    dailyPnl: number
    totalPnl: number
    successRate: number
  } {
    try {
      const state = this.stateManager?.getState()
      const execStats = state?.execStats
      const successRate = execStats
        ? (execStats.success / Math.max(1, execStats.success + execStats.fail)) * 100
        : 0

      return {
        dailyPnl: state?.dailyPnl ?? 0,
        totalPnl: state?.totalPnl ?? 0,
        successRate
      }
    } catch {
      return { dailyPnl: 0, totalPnl: 0, successRate: 0 }
    }
  }

  private getTelemetryContrarian(): {
    activeTokens: string[]
    smConflicts: Record<string, string>
  } {
    const activeTokens: string[] = []
    const smConflicts: Record<string, string> = {}

    try {
      for (const [token, data] of Object.entries(NANSEN_TOKENS)) {
        const tuning = data?.tuning
        if (tuning?.smConflictSeverity && tuning.smConflictSeverity !== 'NONE') {
          activeTokens.push(token)

          // Try to get SM position from smart_money_data.json
          try {
            const fs = require('fs')
            const smData = JSON.parse(fs.readFileSync('/tmp/smart_money_data.json', 'utf8'))
            const entry = smData?.data?.[token]
            if (entry) {
              const longs = entry.current_longs_usd ?? 0
              const shorts = entry.current_shorts_usd ?? 0
              const net = longs - shorts
              const side = net > 0 ? 'LONG' : 'SHORT'
              const millions = Math.abs(net) / 1_000_000
              smConflicts[token] = `$${millions.toFixed(1)}M ${side}`
            }
          } catch {
            smConflicts[token] = tuning.smConflictSeverity
          }
        }
      }
    } catch {
      // Silently ignore errors
    }

    return { activeTokens, smConflicts }
  }

  private getTelemetryShadow(): {
    enabled: boolean
    activeAdjustments: number
    activeSignals: number
    tokenSentiment: Record<string, { longs: number; shorts: number; consensus: string }>
  } | null {
    try {
      const lt = this.trading as LiveTrading
      if (!lt?.shadowTrading) return null

      const status = lt.shadowTrading.getStatus()
      const tokenSentiment: Record<string, { longs: number; shorts: number; consensus: string }> = {}

      // Get sentiment for tracked tokens
      for (const token of ['DOGE', 'SUI', 'LIT']) {
        const sentiment = lt.shadowTrading.getTokenSentiment(token)
        tokenSentiment[token] = {
          longs: sentiment.longCount,
          shorts: sentiment.shortCount,
          consensus: sentiment.consensus
        }
      }

      return {
        enabled: status.enabled,
        activeAdjustments: status.activeAdjustments.length,
        activeSignals: status.signalSummary.activeSignals,
        tokenSentiment
      }
    } catch {
      return null
    }
  }

  private getTelemetrySmartSignals(): Record<
    string,
    {
      type: string
      direction: 'long' | 'short' | 'neutral'
      confidence: number
      reasons: string[]
      warnings: string[]
      onChainDivergence?: {
        detected: boolean
        whaleNetFlow: number
        cexNetFlow: number
        freshWalletInflow: number
        divergenceType?: string
        warning?: string
      }
    }
  > {
    const summary: Record<string, any> = {}
    try {
      for (const [token, cfg] of Object.entries(NANSEN_TOKENS)) {
        const tuning = cfg.tuning
        if (!tuning?.smSignalType) continue
        summary[token] = {
          type: tuning.smSignalType,
          direction: tuning.smSignalDirection ?? 'neutral',
          confidence: tuning.smSignalConfidence ?? 0,
          reasons: tuning.smSignalReasons ?? [],
          warnings: tuning.smSignalWarnings ?? [],
          onChainDivergence: tuning.onChainDivergence
        }
      }
    } catch {
      // ignore telemetry errors
    }
    return summary
  }

  private getTelemetryWatchdog(): {
    lastFillTimestamp: number
    idleMs: number
    maxIdleMs: number
    triggered: boolean
  } | null {
    if (!this.lastFillTimestamp) {
      return null
    }

    const idleMs = Date.now() - this.lastFillTimestamp
    return {
      lastFillTimestamp: this.lastFillTimestamp,
      idleMs,
      maxIdleMs: this.fillWatchdogMaxIdleMs,
      triggered: idleMs >= this.fillWatchdogMaxIdleMs
    }
  }

  private getTelemetryPositionRisk():
    | {
      status: PositionRiskStatus
      exposure?: {
        totalExposureUsd: number
        totalLimitUsd: number
        utilizationPct: number
        pendingBidUsd: number
        pendingAskUsd: number
        byToken: Record<string, number>
        timestamp: string
      }
    }
    | null {
    if (!this.positionRiskManager) {
      return null
    }

    const status = this.positionRiskManager.getStatus()
    const snapshot = this.positionRiskManager.getExposureSnapshot()

    return {
      status,
      exposure: snapshot
        ? {
          totalExposureUsd: snapshot.totalExposureUsd,
          totalLimitUsd: snapshot.totalLimitUsd,
          utilizationPct:
            snapshot.totalLimitUsd > 0
              ? Number(((snapshot.totalExposureUsd / snapshot.totalLimitUsd) * 100).toFixed(2))
              : 0,
          pendingBidUsd: snapshot.pendingBidUsd,
          pendingAskUsd: snapshot.pendingAskUsd,
          byToken: snapshot.byToken,
          timestamp: new Date(snapshot.timestamp).toISOString()
        }
        : undefined
    }
  }

  private getTelemetryPositionProtector(): Record<string, {
    side: 'long' | 'short'
    entryPrice: number
    highestPrice: number
    lowestPrice: number
    trailingActive: boolean
    ageMs: number
  }> | null {
    if (!this.positionProtector) {
      return null
    }
    const status = this.positionProtector.getStatus()
    return Object.keys(status).length > 0 ? status : null
  }

  private initializeShadowTrading(): void {
    if (!(this.trading instanceof LiveTrading)) {
      return
    }

    const lt = this.trading as LiveTrading
    const status = lt.shadowTrading.getStatus()
    if (!status.enabled) {
      this.notifier.info('🔮 Shadow trading module disabled')
      return
    }

    this.shadowAlertIntegration = new ShadowAlertIntegration(this.alertManager)
    this.shadowTradesUrl = process.env.SHADOW_TRADING_TRADES_URL || 'http://127.0.0.1:8081/api/latest_trades'
    this.shadowPollIntervalMs = Number(process.env.SHADOW_TRADING_POLL_MS || 30_000)
    this.shadowConsensusIntervalMs = Number(process.env.SHADOW_TRADING_CONSENSUS_MS || 5 * 60 * 1000)
    this.shadowFetchTimeoutMs = Number(process.env.SHADOW_TRADING_FETCH_TIMEOUT_MS || 5_000)

    this.notifier.info(
      `🔮 Shadow trading enabled (feed=${this.shadowTradesUrl}, poll=${Math.round(this.shadowPollIntervalMs / 1000)}s, consensus=${Math.round(this.shadowConsensusIntervalMs / 1000)}s)`
    )

    // Initial poll
    this.pollShadowTrades().catch((err) => {
      this.notifier.warn(`🔮 [SHADOW] Initial trade poll failed: ${(err as Error).message}`)
    })

    this.shadowTradePoller = setInterval(() => {
      this.pollShadowTrades().catch((err) => {
        this.notifier.warn(`🔮 [SHADOW] Trade poll failed: ${(err as Error).message}`)
      })
    }, this.shadowPollIntervalMs)

    this.shadowConsensusTimer = setInterval(() => {
      this.runShadowConsensusSweep()
    }, this.shadowConsensusIntervalMs)
  }

  private async pollShadowTrades(): Promise<void> {
    if (!this.shadowTradesUrl || !(this.trading instanceof LiveTrading)) {
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.shadowFetchTimeoutMs)

    try {
      const response = await fetch(this.shadowTradesUrl, { signal: controller.signal })
      clearTimeout(timeout)

      if (!response.ok) {
        this.notifier.warn(`🔮 [SHADOW] Trade feed error: HTTP ${response.status}`)
        return
      }

      const payload: any = await response.json()
      const trades: any[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.trades)
          ? payload.trades
          : []

      if (trades.length === 0) {
        return
      }

      const lt = this.trading as LiveTrading
      const emittedSignals: TradeSignal[] = []

      for (const raw of trades) {
        const mapped = this.mapShadowTrade(raw)
        if (!mapped) continue

        const key = this.makeShadowTradeKey(mapped)
        if (this.processedShadowTradeSet.has(key)) {
          continue
        }
        this.rememberShadowTrade(key)

        const signal = lt.shadowTrading.processTrade(mapped)
        if (signal) {
          emittedSignals.push(signal)
        }
      }

      if (emittedSignals.length && this.shadowAlertIntegration) {
        emittedSignals.forEach((signal) => this.shadowAlertIntegration?.processSignal(signal))
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        this.notifier.warn(`🔮 [SHADOW] Trade poll failed: ${(err as Error).message}`)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private runShadowConsensusSweep(): void {
    if (!(this.trading instanceof LiveTrading)) {
      return
    }
    if (!this.shadowAlertIntegration) {
      return
    }

    try {
      const lt = this.trading as LiveTrading
      const signals = lt.shadowTrading.checkAllConsensusSignals()
      if (signals.length === 0) {
        return
      }
      signals.forEach((signal) => this.shadowAlertIntegration?.processSignal(signal))
    } catch (err) {
      this.notifier.warn(`🔮 [SHADOW] Consensus sweep failed: ${(err as Error).message}`)
    }
  }

  private mapShadowTrade(raw: any): NansenTrade | null {
    try {
      const token = (raw.token || raw.symbol || raw.pair)?.toString().toUpperCase()
      if (!token) return null

      const sideRaw = (raw.side || raw.direction || '').toString().toLowerCase()
      const actionRaw = (raw.action || raw.type || '').toString().toLowerCase()
      const traderAddress = (raw.traderAddress || raw.trader || raw.address || '').toString().toLowerCase()
      if (!traderAddress) return null

      const traderLabel = (raw.traderLabel || raw.label || raw.tag || traderAddress).toString()
      const valueUsd = Number(raw.valueUsd ?? raw.notionalUsd ?? raw.usdValue ?? raw.sizeUsd ?? 0)
      if (!Number.isFinite(valueUsd) || valueUsd <= 0) return null
      const priceUsd = Number(raw.priceUsd ?? raw.price ?? raw.fillPrice ?? 0)
      const size = Number(raw.size ?? raw.quantity ?? raw.amount ?? 0)

      const side: 'Long' | 'Short' = sideRaw === 'short' ? 'Short' : 'Long'
      const action: 'Open' | 'Close' | 'Add' | 'Reduce' =
        actionRaw === 'close'
          ? 'Close'
          : actionRaw === 'reduce'
            ? 'Reduce'
            : actionRaw === 'add'
              ? 'Add'
              : 'Open'

      const timestamp = raw.timestamp
        ? new Date(raw.timestamp).toISOString()
        : new Date().toISOString()

      const trade: NansenTrade = {
        timestamp,
        traderAddress,
        traderLabel,
        token,
        side,
        action,
        valueUsd,
        priceUsd: Number.isFinite(priceUsd) ? priceUsd : 0,
        size: Number.isFinite(size) ? size : 0
      }

      return trade
    } catch {
      return null
    }
  }

  private makeShadowTradeKey(trade: NansenTrade): string {
    return `${trade.timestamp}_${trade.traderAddress}_${trade.token}_${trade.action}_${Math.round(trade.valueUsd)}`
  }

  private rememberShadowTrade(key: string): void {
    this.processedShadowTradeSet.add(key)
    this.processedShadowTradeKeys.push(key)
    const MAX_KEYS = 1000
    if (this.processedShadowTradeKeys.length > MAX_KEYS) {
      const stale = this.processedShadowTradeKeys.splice(0, this.processedShadowTradeKeys.length - MAX_KEYS)
      stale.forEach((k) => this.processedShadowTradeSet.delete(k))
    }
  }

  private checkFillWatchdog(): void {
    if (this.fillWatchdogMaxIdleMs <= 0) return
    if (this.alertManager?.getPauseStatus().isPaused) return
    if (!this.lastFillTimestamp) return

    const idleMs = Date.now() - this.lastFillTimestamp
    if (idleMs < this.fillWatchdogMaxIdleMs) return
    if (Date.now() - this.lastFillWatchdogAlertAt < this.fillWatchdogCooldownMs) return

    this.lastFillWatchdogAlertAt = Date.now()
    const idleHours = idleMs / 3_600_000
    const message =
      `🕒 [WATCHDOG] No fills detected for ${idleHours.toFixed(1)}h (threshold ${(this.fillWatchdogMaxIdleMs / 3_600_000).toFixed(1)}h). ` +
      `Verify liquidity, orders, and data feeds.`

    this.notifier.warn(message)

    if (this.alertManager) {
      this.alertManager.pushAlert({
        id: crypto.randomUUID(),
        timestamp: new Date(),
        token: 'SYSTEM',
        category: AlertCategory.ERROR,
        severity: AlertSeverity.WARNING,
        title: 'Fill watchdog triggered',
        message,
        data: {
          idleHours: Number(idleHours.toFixed(2))
        },
        acknowledged: false,
        actions: []
      })
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const bot = new HyperliquidMMBot()

  // Initialize live trading if not in dry run mode
  await bot.initialize()

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...')
    getNansenProAPI().cleanup()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...')
    getNansenProAPI().cleanup()
    process.exit(0)
  })

  // Start bot
  await bot.mainLoop()
}

// Run
main().catch(async (error) => {
  console.error('[FATAL] Unhandled error in main():', {
    timestamp: new Date().toISOString(),
    error: error instanceof Error ? (error.stack || error.message) : String(error)
  })

  try {
    await sendSystemAlert(
      `💥 MM-Bot fatal error in main loop\n` +
      `Error: ${error instanceof Error ? error.message : String(error)}\n` +
      `Stack: ${error instanceof Error && error.stack ? error.stack.split('\n').slice(0, 3).join('\n') : 'N/A'}\n` +
      `Timestamp: ${new Date().toISOString()}`
    )
  } catch (e) {
    console.error('[FATAL] Failed to send system alert', e)
  }

  process.exit(1)
})
