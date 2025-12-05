import * as hl from '@nktkas/hyperliquid'
import 'dotenv/config'
import { ethers } from 'ethers'
import fs from 'fs'
import path from 'path'
import { HyperliquidAPI } from './api/hyperliquid.js'
import { applyBehaviouralRiskToLayers, type BehaviouralRiskMode } from './behaviouralRisk.js'
import { CopyTradingSignal, getNansenProAPI } from './integrations/nansen_pro.js'
import { isPairBlockedByLiquidity, loadLiquidityFlags } from './liquidityFlags.js'
import { computeSideAutoSpread } from './risk/auto_spread.js'
import {
  SmartRotationEngine,
  type NansenWhaleRisk,
  type PairAnalysisLite
} from './rotation/smart_rotation.js'
import { MarketVisionService, NANSEN_TOKENS } from './signals/market_vision.js'
import { Supervisor, SupervisorHooks } from './supervisor/index.js'
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
// INSTITUTIONAL SIZE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

type InstitutionalSizeConfig = {
  minUsd: number           // twarde minimum notional (np. min notional HL + buffer)
  targetUsd: number        // docelowy rozmiar pojedynczego childa
  maxUsd: number           // hard cap per order
  maxUsdAbs?: number       // dodatkowy absolutny limit (np. 800$ dla ZEC)
}

const INSTITUTIONAL_SIZE_CONFIG: Record<string, InstitutionalSizeConfig> = {
  // duże, drogie coiny – chcemy małe liczby coinów, ale sensowne USD
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
  FARTCOIN: envNumber("FARTCOIN_MAX_POSITION_USD", 5000)
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
      // Fetch all fills from Hyperliquid
      const fills = await infoClient.userFills({ user: walletAddress })

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
  private l2BookCache: Map<string, L2BookUpdate> = new Map()  // Cache latest L2 book data

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

  // Per-process sequence counter for disambiguating concurrent attempts
  private seq: number = 0

  // Daily notional tracking (per coin, per day)
  private dailyNotionalByPair: Map<string, number> = new Map()
  private dailyNotionalDay: string | null = null

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
   * Formula: Math.floor(size * 10^szDecimals) / 10^szDecimals
   * This prevents 422 errors from Hyperliquid API
   */
  private roundToSzDecimals(size: number, szDecimals: number): number {
    if (szDecimals === 0) {
      return Math.floor(size)
    }
    const multiplier = Math.pow(10, szDecimals)
    return Math.floor(size * multiplier) / multiplier
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
    if (enableWebSocket && this.chaseConfig) {
      try {
        this.websocket = new HyperliquidWebSocket()
        await this.websocket.connect()
        console.log('✅ WebSocket connected for real-time data')
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
        console.log(`📊 Subscribed to L2 book: ${pair}`)
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

      // Infer szDecimals from price using centralized helper (unless valid map value exists)
      const inferredSizeDecimals = guessSzDecimals(roundedPrice)
      const mapValue = this.assetDecimals.get(pair)
      const sizeDecimals = (mapValue !== undefined && mapValue > 0) ? mapValue : inferredSizeDecimals

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
   */
  async cancelAllOrders(): Promise<void> {
    try {
      const orders = await this.infoClient.openOrders({ user: this.walletAddress })

      if (!orders || orders.length === 0) {
        console.log('No open orders to cancel')
        return
      }

      console.log(`Canceling ${orders.length} open orders...`)

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

      console.log('All orders canceled')
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

// Bias configuration per strength level
type BiasConfig = {
  boostAmount: number      // Inventory skew adjustment
  maxContraSkew: number    // Max position against bias
  contraPnlLimit: number   // Stop-loss USD for contra positions
  tightenFactor: number    // Multiplier for favorable side spreads
  widenFactor: number      // Multiplier for unfavorable side spreads
}

const BIAS_CONFIGS: Record<string, BiasConfig> = {
  'strong': {
    boostAmount: 0.40,      // 40% push toward bias direction
    maxContraSkew: 0.25,    // Max 25% position against bias
    contraPnlLimit: -20,    // Close contra positions at -$20
    tightenFactor: 0.7,     // 30% tighter on favorable side
    widenFactor: 1.3        // 30% wider on unfavorable side
  },
  'soft': {
    boostAmount: 0.15,      // 15% gentle push toward bias
    maxContraSkew: 0.40,    // Max 40% position against bias (more freedom)
    contraPnlLimit: -50,    // Close contra positions at -$50
    tightenFactor: 0.9,     // 10% tighter on favorable side
    widenFactor: 1.1        // 10% wider on unfavorable side
  },
  'neutral': {
    boostAmount: 0,         // No directional push
    maxContraSkew: 1.0,     // Full freedom (100% either direction)
    contraPnlLimit: -700,   // Standard daily limit
    tightenFactor: 1.0,     // Symmetric spreads
    widenFactor: 1.0
  }
}

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

  private intervalSec: number
  private baseOrderUsd: number
  private makerSpreadBps: number
  private rotationIntervalSec: number
  private maxDailyLossUsd: number
  private lastRotationTime: number = 0

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
    data: Record<string, { boost: number; direction: string; biasStrength: string; buySellPressure: number; updatedAt: string }>
  } = { lastLoad: 0, data: {} }

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
    ZEC: { min: 35, max: 180 },     // Increased min spread further (sideways market, reducing churn)
    HYPE: { min: 15, max: 140 },    // More aggressive on HYPE
    VIRTUAL: { min: 18, max: 170 }  // Kept as is (was profitable)
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

  constructor() {
    this.api = new HyperliquidAPI()
    this.infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })
    this.rotation = new VolatilityRotation({
      minVolatility: Number(process.env.MIN_VOLATILITY_PCT || 2.0),
      rotationThreshold: 1.5
    })
    this.marketVision = new MarketVisionService(this.api)
    this.stateManager = new StateManager()
    this.notifier = new ConsoleNotifier()
    this.nansen = getNansenProAPI()
    this.orderReporter = new OrderReporter(this.notifier)

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
    this.intervalSec = Number(process.env.MM_INTERVAL_SEC || 15)
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
      this.notifier.info(`      Max hold time: ${this.nansenStrongContraMaxHours}h`)
    }
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

      // AUTOMATIC CLEANUP ON STARTUP (optional via SKIP_STARTUP_CLEANUP env var)
      const skipCleanup = process.env.SKIP_STARTUP_CLEANUP === 'true'

      if (skipCleanup) {
        this.notifier.info('⏭️  Skipping startup cleanup - keeping existing positions')
      } else {
        this.notifier.info('🧹 Cleaning up: canceling all open orders and closing positions...')
        try {
          await (this.trading as LiveTrading).cancelAllOrders()
          this.notifier.info('   ✅ All orders canceled')

          await (this.trading as LiveTrading).closeAllPositions()
          this.notifier.info('   ✅ All positions closed')

          this.notifier.info('✅ Cleanup complete - starting with clean slate')
        } catch (error) {
          this.notifier.error(`❌ Cleanup failed: ${error}`)
          throw new Error('Failed to cleanup on startup')
        }
      }
    } else {
      this.notifier.info('✅ Paper trading ready')
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

        // 🛑 LIQUIDITY GUARD: Cancel orders on blocked pairs
        await this.cancelAllOnBlockedPairs();

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
        await this.applyRotationPairs(activePairs)

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

        // Sleep
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

      try {
        const symbol = pair.split('/')[0].toUpperCase()
        const config = NANSEN_TOKENS[symbol]
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
      } catch (e) {
        // ignore
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

      const a: PairAnalysisLite = {
        symbol: pair,
        trendScore,
        volumeScore: 0.5, // Default volume score
        riskScore,
        nansenBias,
        nansenScore,
        nansenWhaleRisk
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
          `bias=${r.nansenBias}, whale=${r.nansenWhaleRisk})`
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

      // 2) Refresh Nansen signals for these symbols (if enabled)
      if (this.nansenBias.isEnabled()) {
        await this.nansenBias.refreshForSymbols(candidatePairs)

        // Log Nansen signals
        for (const pair of candidatePairs) {
          const signal = this.nansenBias.getSignal(pair)
          if (signal) {
            this.notifier.info(
              `🧠 [NANSEN] ${pair}: risk=${signal.riskLevel}, score=${signal.rotationScore.toFixed(0)}, ` +
              `flow24h=$${(signal.smartFlow24hUsd / 1000000).toFixed(2)}M, fresh=${signal.freshWalletScore.toFixed(0)}`
            )
          }
        }
      }

      // 3) Filter and sort by Nansen rotation score (if enabled)
      const orderedByNansen = this.nansenBias.isEnabled()
        ? this.nansenBias.getRotationCandidates(candidatePairs)
        : candidatePairs

      // 4) Target size and check if rotation is needed (compare with current pairs)
      const targetCount = Math.min(
        MAX_ACTIVE_PAIRS,
        Number(process.env.ROTATION_TARGET_COUNT || 3)
      )

      const currentPairs = this.rotation.getCurrentPairs()
      const hasOverflow = currentPairs.length > targetCount

      // Check for overdue pairs (time-based rotation enforce)
      const maxHoldMs = this.getMaxRotationHoldMs()
      const overduePairs = currentPairs.filter(p => this.isRotationOverdue(p))

      if (overduePairs.length > 0) {
        this.notifier.warn(
          `[ROTATION] Overdue pairs detected: ${overduePairs.join(
            ','
          )} (maxHoldHours=${(maxHoldMs / 3600000).toFixed(1)})`
        )
      }

      const shouldRotate =
        currentPairs.length === 0 ||
        orderedByNansen.length === 0 ||
        !orderedByNansen.every((p: string) => currentPairs.includes(p)) ||
        orderedByNansen[0] !== currentPairs[0] ||
        overduePairs.length > 0 ||
        hasOverflow // Force rotation if any pair is overdue or we exceed max

      if (hasOverflow) {
        this.notifier.warn(
          `[ROTATION] Active pairs=${currentPairs.length} exceed target=${targetCount} – forcing trim`
        )
      }

      if (shouldRotate) {
        // Fresh candidates sorted by rotationScore
        const freshCandidates = orderedByNansen.slice(0, targetCount * 2) // Get more candidates than needed

        // Start with current pairs, but remove overdue ones first
        let nextPairs = [...currentPairs]
        nextPairs = nextPairs.filter(p => !overduePairs.includes(p))

        // Add new candidates until we reach targetCount
        for (const sym of freshCandidates) {
          if (nextPairs.length >= targetCount) break
          if (!nextPairs.includes(sym)) {
            nextPairs.push(sym)
          }
        }

        // If we still have less than targetCount (e.g., not enough candidates),
        // we can allow one overdue pair back to avoid having too few pairs
        if (nextPairs.length < targetCount && overduePairs.length > 0) {
          for (const p of overduePairs) {
            if (!nextPairs.includes(p)) {
              nextPairs.push(p)
              if (nextPairs.length >= targetCount) break
            }
          }
        }

        // Update rotation state with time-limit aware pairs
        const newPairs = nextPairs.slice(0, targetCount) // Ensure we don't exceed targetCount

        this.notifier.info(`✅ Rotated to: ${newPairs.join(', ')}`)
        this.notifier.info(`   Reason: Nansen-filtered rotation`)

        // Log top pairs with scores
        for (let i = 0; i < newPairs.length && i < topPairs.length; i++) {
          const pair = newPairs[i]
          const volScore = topPairs.find(s => s.pair === pair)
          const nansenSignal = this.nansenBias.getSignal(pair)

          if (volScore) {
            const nansenInfo = nansenSignal
              ? ` | Nansen: ${nansenSignal.riskLevel} (${nansenSignal.rotationScore.toFixed(0)})`
              : ''
            this.notifier.info(
              `   ${i + 1}. ${pair}: vol=${volScore.volatility24h.toFixed(2)}%, score=${volScore.score.toFixed(2)}${nansenInfo}`
            )
          }
        }

        // Update rotation state manually (since we're bypassing rotation.rotate())
        // We'll need to update the rotation state directly
        const rotationState = (this.rotation as any).state
        if (rotationState) {
          rotationState.currentPairs = newPairs
          rotationState.lastUpdate = Date.now()
            ; (this.rotation as any).saveState()
        }

        // Mark pairs as entered rotation and clean up removed pairs
        for (const p of newPairs) {
          if (!this.rotationSince[p]) {
            this.markRotationEntered(p)
          }
        }

        // Clean up pairs that were removed from rotation
        for (const old of Object.keys(this.rotationSince)) {
          if (!newPairs.includes(old)) {
            delete this.rotationSince[old]
          }
        }

        // Set leverage for new pairs (LIVE mode only)
        if (!this.isDryRun && this.trading instanceof LiveTrading) {
          const targetLeverage = Number(process.env.LEVERAGE || 1)
          this.notifier.info(`🔧 Setting ${targetLeverage}x leverage for new pairs...`)

          for (const pair of newPairs) {
            try {
              await (this.trading as LiveTrading).setLeverage(pair, targetLeverage)
            } catch (error) {
              this.notifier.warn(`   Failed to set leverage for ${pair}: ${error}`)
            }
          }
        }

        // Close positions in pairs we're rotating out of
        await this.closeOldPositions(newPairs)

        this.lastRotationTime = now
      } else {
        this.notifier.info(`✓ Current pairs still optimal: ${orderedByNansen.slice(0, 3).join(', ')}`)
        this.lastRotationTime = now
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
    } catch (error) {
      this.notifier.warn(`Failed to get position pairs: ${error}`)
      return []
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

      const infoClient = (this.trading as any).infoClient
      const walletAddress = (this.trading as any).walletAddress

      if (!infoClient || typeof infoClient.clearinghouseState !== 'function') {
        return
      }

      const userState = await infoClient.clearinghouseState({ user: walletAddress })
      if (!userState || !userState.assetPositions) {
        return
      }

      // Load Nansen bias data
      const biasPath = path.join(process.cwd(), 'runtime', 'nansen_bias.json')
      let biases: Record<string, any> = {}
      try {
        if (fs.existsSync(biasPath)) {
          biases = JSON.parse(fs.readFileSync(biasPath, 'utf8'))
        }
      } catch (err) {
        return
      }

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
  private async applyRotationPairs(rotatedPairs: string[]): Promise<void> {
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
    } catch (error: any) {
      this.notifier.error(`❌ applyRotationPairs failed: ${error?.message ?? error}`)
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
    const [meta, assetCtxs] = await this.api.getMetaAndAssetCtxs()

    // Identify legacy pairs (positions not in top 3)
    const legacyPairs = pairs.filter(p => !activePairs.includes(p))

    if (legacyPairs.length > 0) {
      this.notifier.info(`📦 Legacy positions: ${legacyPairs.join(', ')} - continuing market-making`)
    }

    // ⚡ OPTIMIZED: Execute all pairs in parallel with shared market data
    // Both active and legacy pairs get full market-making (limit orders)
    await Promise.all(
      pairs.map(async (pair) => {
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
      const now = Date.now()

      // Reload bias data every 60 seconds
      if (now - this.nansenBiasCache.lastLoad > 60_000) {
        const biasPath = path.join(process.cwd(), 'runtime', 'nansen_bias.json')
        if (fs.existsSync(biasPath)) {
          const raw = fs.readFileSync(biasPath, 'utf-8')
          this.nansenBiasCache.data = JSON.parse(raw)
          this.nansenBiasCache.lastLoad = now
        }
      }

      const entry = this.nansenBiasCache.data[symbol]
      if (!entry) return 'neutral'

      // Only act on strong signals (boost >= 2.0)
      if (Math.abs(entry.boost) < 2.0) return 'neutral'

      return entry.direction === 'long'
        ? 'long'
        : entry.direction === 'short'
          ? 'short'
          : 'neutral'
    } catch (error) {
      // Fail gracefully - if bias file doesn't exist or has errors, return neutral
      return 'neutral'
    }
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
    const maxBps = Math.max(Math.min(perPair.max, 500), minBps + 1)

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
      // 3) Global clamps i logi diagnostyczne
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

  async executeMultiLayerMM(pair: string, assetCtxs?: any[]) {
    // 🔍 LIQUIDITY CHECK (Anti-Rug Pull)
    const liqFlags = loadLiquidityFlags();
    if (isPairBlockedByLiquidity(pair, liqFlags)) {
      console.warn(`[LIQUIDITY BLOCK] ${pair} is blocked due to CRITICAL/RUG risk!`);
      return; // Stop processing this pair
    }

    const startTime = Date.now()

    // Only trade specific symbol in test mode - if empty, enable for all pairs
    const testSymbol = process.env.MULTI_LAYER_TEST_SYMBOL
    if (testSymbol && pair !== testSymbol) {
      // Use regular MM for non-test pairs without disabling gridManager
      return await this.executeRegularMM(pair, assetCtxs)
    }

    // Get current market data
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
    const funding = Number(pairData.funding || 0)
    if (midPrice === 0) {
      this.notifier.warn(`⚠️  Invalid mid price for ${pair}`)
      return
    }
    if (pair === 'ZEC') {
      recordZecMidPrice(midPrice)
    }

    // Get position and calculate inventory skew
    const state = this.stateManager.getState()
    const position = state.positions[pair]

    // 🛑 HARD STOP for MON (Emergency Guard)
    if (pair === 'MON') {
      const monPos = position ? parseFloat((position as any).positionValue || '0') : 0;
      if (monPos > 6000) {
        console.warn(`[EMERGENCY_GUARD] MON position $${monPos.toFixed(2)} > $6000. FORCING NO BIDS.`);
        // Force disable longs for this iteration
        // We need to pass this restriction to generateGridOrders via permissions
      }
    }

    const capitalBase = Number(process.env.ROTATION_TARGET_PER_PAIR_USD || this.baseOrderUsd * 20) // Default: 20× baseOrderUsd if not set
    const symbol = pair.split(/[-_]/)[0].toUpperCase()
    const currentDate = new Date()
    const globalDowntrend = isGlobalDowntrendActive()
    const adaptive = computeAdaptiveMultipliers(symbol, currentDate, globalDowntrend)

    // 🔥 FUNDING STRESS TEST (New from Python logic)
    // High funding (>0.03%) = High volatility/imbalance expected -> Widen spread
    if (Math.abs(funding) > 0.0003) {
      adaptive.spreadMult *= 1.5
      this.notifier.info(`🔥 [HIGH FUNDING] ${pair} funding=${(funding * 100).toFixed(4)}% -> spreadMult x1.5`)
    } else if (Math.abs(funding) > 0.0001) {
      adaptive.spreadMult *= 1.2
    }

    if (adaptive.mode !== 'none') {
      this.notifier.info(
        `[RISK_ADAPT] ${pair} ${adaptive.mode === 'defensive' ? 'defensive mode' : 'weekend boost'} size×${adaptive.sizeMult.toFixed(2)} spread×${adaptive.spreadMult.toFixed(2)}`
      )
    }
    let capitalPerPair = capitalBase * adaptive.sizeMult

    // 🔧 APPY TUNING OVERRIDES
    const overridesConfig = NANSEN_TOKENS[symbol]?.tuning
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

    if (nansenBias === 'long') {
      // Strong bullish bias
      const originalSkew = inventorySkew

      // 1. Actively push toward long positions (deepening)
      inventorySkew = Math.min(1, inventorySkew + BIAS_BOOST)

      // 2. But prevent excessive short positions (safety)
      if (inventorySkew < -MAX_CONTRA_SKEW) {
        inventorySkew = -MAX_CONTRA_SKEW
      }

      if (originalSkew !== inventorySkew) {
        this.notifier.info(
          `🧭 Bias boost: ${(originalSkew * 100).toFixed(1)}% → ${(inventorySkew * 100).toFixed(1)}% ` +
          `(Nansen LONG bias +${BIAS_BOOST * 100}% boost${inventorySkew === -MAX_CONTRA_SKEW ? ', clamped at -25%' : ''})`
        )
      }
    }

    if (nansenBias === 'short') {
      // Strong bearish bias
      const originalSkew = inventorySkew

      // 1. Actively push toward short positions (deepening)
      inventorySkew = Math.max(-1, inventorySkew - BIAS_BOOST)

      // 2. But prevent excessive long positions (safety)
      if (inventorySkew > MAX_CONTRA_SKEW) {
        inventorySkew = MAX_CONTRA_SKEW
      }

      if (originalSkew !== inventorySkew) {
        this.notifier.info(
          `🧭 Bias boost: ${(originalSkew * 100).toFixed(1)}% → ${(inventorySkew * 100).toFixed(1)}% ` +
          `(Nansen SHORT bias -${BIAS_BOOST * 100}% boost${inventorySkew === MAX_CONTRA_SKEW ? ', clamped at +25%' : ''})`
        )
      }
    }

    // 📊 Calculate L1 spread breakdown BEFORE generating orders (for detailed logging)
    const baseL1OffsetBps = 20 // L1 base offset from GridManager

    // 0) Bazowy spread z profilu (conservative / aggressive)
    const rawBaseSpreadBps = this.makerSpreadBps
    const baseSpreadBps = this.applySpreadProfile(rawBaseSpreadBps)

    // Użyj baseSpreadBps zamiast baseL1OffsetBps dla obliczeń (lub połącz oba)
    // Dla L1 używamy baseL1OffsetBps jako bazowy offset, ale możemy też zastosować profil
    const baseL1OffsetWithProfile = this.applySpreadProfile(baseL1OffsetBps)

    const skewAdjBidBps = this.gridManager!.getInventoryAdjustment(inventorySkew, 'bid')
    const skewAdjAskBps = this.gridManager!.getInventoryAdjustment(inventorySkew, 'ask')

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

    // 🎯 GLOBAL BIAS CALCULATION (Trend + Tuning + Funding)
    // Unified logic for all pairs, replacing the old ZEC-specific block
    let biasShiftBps = 0;

    // 1. ZEC Specific Trend Logic (Legacy/Proven)
    if (pair === 'ZEC') {
      if (trend4h === 'bull' && trend15m === 'bull') {
        biasShiftBps = -3;
      } else if (trend4h === 'bear' && trend15m === 'bear') {
        biasShiftBps = 3;
      }
    }

    // 2. Nansen/Tuning Config Bias
    const tuningConfig = NANSEN_TOKENS[symbol]?.tuning
    if (tuningConfig && tuningConfig.smSignalSkew !== 0) {
      // smSignalSkew < 0 -> Bearish -> Positive biasShiftBps (shift quotes UP/AWAY)
      // -0.25 -> +5bps bias
      biasShiftBps -= (tuningConfig.smSignalSkew * 20)
    }

    // 3. 🔥 FUNDING RATE BIAS (Arbitrage)
    // High positive funding -> Crowded Longs -> We want to be Short (to earn funding) -> Shift quotes UP (easier sell, harder buy)
    // High negative funding -> Crowded Shorts -> We want to be Long -> Shift quotes DOWN
    const f = funding || 0;
    let fundingBiasBps = 0;
    if (f > 0.0005) fundingBiasBps = 10;      // > 0.05% hourly (~400% APY) -> Sell Aggressively
    else if (f > 0.0002) fundingBiasBps = 5;  // > 0.02% hourly
    else if (f < -0.0005) fundingBiasBps = -10;
    else if (f < -0.0002) fundingBiasBps = -5;

    biasShiftBps += fundingBiasBps;

    // Apply Bias to Spreads
    if (biasShiftBps !== 0) {
      bidSpreadBps += biasShiftBps;
      askSpreadBps -= biasShiftBps;

      if (Math.abs(biasShiftBps) > 4) {
        this.notifier.info(
          `🎯 [BIAS] ${pair} shift=${biasShiftBps.toFixed(1)}bps (FundBias=${fundingBiasBps}, Tuning=${tuningConfig?.smSignalSkew ?? 0})`
        );
      }
    }

    // Calculate Multipliers for GridManager (so deep layers follow the asymmetry)
    const gridBidMult = currentBaseSpread > 1e-9 ? bidSpreadBps / currentBaseSpread : 1.0;
    const gridAskMult = currentBaseSpread > 1e-9 ? askSpreadBps / currentBaseSpread : 1.0;

    // 2) Nansen bias – asymetria
    bidSpreadBps *= nansenBidFactor
    askSpreadBps *= nansenAskFactor

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

    if (permissions.reason !== 'neutral_regime') {
      console.log(`🛡️  [REGIME] ${pair}: ${permissions.reason} (Longs: ${permissions.allowLongs}, Shorts: ${permissions.allowShorts})`);
    }

    // Generate grid orders with Nansen bias awareness AND Institutional Permissions
    // Note: GridManager will apply its own clamp internally, but we log our calculation here
    let gridOrders = this.gridManager!.generateGridOrders(
      pair,
      midPrice,
      capitalPerPair,
      0.001,
      inventorySkew,
      permissions,
      actualSkew,
      { bid: gridBidMult, ask: gridAskMult }
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
    const totalAfter = gridOrders.reduce((a, o) => a + (o.sizeUsd || 0), 0)

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
    const clampedSpread = Math.max(MIN_SPREAD_BPS, Math.min(MAX_SPREAD_BPS, adjustedSpread))

    const spreadFactor = clampedSpread / 10000

    // Calculate bid/ask prices
    const bidPrice = midPrice * (1 - spreadFactor)
    const askPrice = midPrice * (1 + spreadFactor)

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
    const canPlaceBid = !hasBidOrder && (!position || position.side !== 'short' || currentPositionValue < maxPositionSizeUsd)
    const canPlaceAsk = !hasAskOrder && (!position || position.side !== 'long' || currentPositionValue < maxPositionSizeUsd)

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
      this.notifier.info(`   ⏸️  BID skipped: Position limit reached ($${currentPositionValue.toFixed(0)} / $${maxPositionSizeUsd.toFixed(0)})`)
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
      this.notifier.info(`   ⏸️  ASK skipped: Position limit reached ($${currentPositionValue.toFixed(0)} / $${maxPositionSizeUsd.toFixed(0)})`)
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

  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 2000))
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
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...')
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
