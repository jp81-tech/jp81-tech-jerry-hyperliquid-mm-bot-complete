import { promises as fsp } from 'fs'
import path from 'path'
import { CoinTuning, NANSEN_TOKENS } from '../signals/market_vision.js'
import { ConsoleNotifier } from '../utils/notifier.js'
import { HyperliquidMarketData } from './market_data.js'
import { TelemetryCollector } from '../telemetry/TelemetryCollector.js'
import { AlertManager } from '../alerts/AlertManager.js'
import { TelemetrySnapshot } from '../types/telemetry.js'

type SmartMoneyEntry = {
  bias?: number
  flow?: number
  trend?: string
  trend_strength?: string
  momentum?: number
  velocity?: number
  flow_change_7d?: number
  current_longs_usd?: number
  current_shorts_usd?: number
  longs_upnl?: number
  shorts_upnl?: number
  top_traders_pnl?: string
  signal?: string
  marketData?: HyperliquidMarketData | null
}

type SmartMoneyFile = {
  timestamp: string
  data: Record<string, SmartMoneyEntry>
}

type BiasDirection = 'LONG' | 'SHORT' | 'NEUTRAL'

// ============================================================
// SM CONFLICT DETECTION (Contrarian Squeeze Play)
// ============================================================

type SMConflictSeverity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

interface SMConflictAlert {
  token: string
  botSide: 'long' | 'short' | 'neutral'
  smSide: 'long' | 'short' | 'neutral'
  smNetPositionUsd: number
  conflictSeverity: SMConflictSeverity
  recommendation: string
  contrarian: {
    bidMultiplier: number
    askMultiplier: number
    maxInventoryMultiplier: number
    squeezeTriggerPrice?: number  // Price at which to close all positions
    stopLossPrice?: number        // Hard stop loss
  }
}

// Contrarian config per token (squeeze play thresholds)
const CONTRARIAN_CONFIG: Record<string, {
  squeezeTriggerPct: number   // % above current price to trigger squeeze exit
  stopLossPct: number         // % below entry to trigger stop loss
  maxInventoryUsd: number     // Max position size in USD for contrarian play
}> = {
  DOGE: {
    squeezeTriggerPct: 0.15,    // +15% = squeeze trigger
    stopLossPct: 0.10,          // -10% = stop loss
    maxInventoryUsd: 1500
  },
  SUI: {
    squeezeTriggerPct: 0.12,    // +12% = squeeze trigger
    stopLossPct: 0.10,          // -10% = stop loss
    maxInventoryUsd: 2000
  },
  LIT: {
    squeezeTriggerPct: 0.15,    // +15% = squeeze trigger
    stopLossPct: 0.12,          // -12% = stop loss (more volatile)
    maxInventoryUsd: 2000
  }
}

// ============================================================
// EMERGENCY OVERRIDE - When SM shorts are WINNING, don't fight them!
// Updated: 2026-01-10 based on live SM PnL analysis
// ============================================================
interface EmergencyOverride {
  bidEnabled: boolean        // Allow placing bids (buying)
  askEnabled: boolean        // Allow placing asks (selling)
  bidMultiplier: number      // Bid size multiplier (0 = no bids)
  askMultiplier: number      // Ask size multiplier
  maxInventoryUsd: number    // Override max inventory
  reason: string             // Why this override is active
}

const EMERGENCY_OVERRIDES: Record<string, EmergencyOverride> = {
  // DOGE: SM shorts +$190k profit, longs underwater - STOP BUYING
  DOGE: {
    bidEnabled: false,
    askEnabled: true,
    bidMultiplier: 0,
    askMultiplier: 1.05,
    maxInventoryUsd: 300,
    reason: 'SM shorts +$190k profit - FOLLOW SM, no longs'
  },
  // SUI: SM shorts +$788k profit - STOP BUYING
  SUI: {
    bidEnabled: false,
    askEnabled: true,
    bidMultiplier: 0,
    askMultiplier: 1.05,
    maxInventoryUsd: 300,
    reason: 'SM shorts +$788k profit - FOLLOW SM, no longs'
  },
  // LIT: Mixed signals - 0x61ceef started longing, but main short near breakeven
  LIT: {
    bidEnabled: true,
    askEnabled: true,
    bidMultiplier: 0.3,      // Very cautious bids
    askMultiplier: 1.0,
    maxInventoryUsd: 400,
    reason: 'SM mixed - 0x61ceef longing but main short on breakeven'
  }
}

function detectSMConflict(
  token: string,
  targetInventory: number,      // >0 = bot wants long, <0 = bot wants short
  smNetPositionUsd: number,     // >0 = SM is long, <0 = SM is short
  currentPrice?: number
): SMConflictAlert {
  const botSide: 'long' | 'short' | 'neutral' =
    targetInventory > 0.05 ? 'long' : targetInventory < -0.05 ? 'short' : 'neutral'
  const smSide: 'long' | 'short' | 'neutral' =
    smNetPositionUsd > 10000 ? 'long' : smNetPositionUsd < -10000 ? 'short' : 'neutral'

  // No conflict if aligned or neutral
  const isConflict = botSide !== 'neutral' && smSide !== 'neutral' && botSide !== smSide

  if (!isConflict) {
    return {
      token,
      botSide,
      smSide,
      smNetPositionUsd,
      conflictSeverity: 'NONE',
      recommendation: 'Aligned with SM or neutral - proceed normally',
      contrarian: {
        bidMultiplier: 1.0,
        askMultiplier: 1.0,
        maxInventoryMultiplier: 1.0
      }
    }
  }

  // Calculate severity based on SM position size
  const absSmPosition = Math.abs(smNetPositionUsd)
  let severity: SMConflictSeverity
  let recommendation: string
  let bidMult: number
  let askMult: number
  let invMult: number

  // CONTRARIAN STRATEGY: We're going AGAINST SM
  // - Smaller position sizes (reduced inventory)
  // - Wider spreads on the side we're accumulating
  // - Tighter spreads on the side we'd exit (to profit from squeeze)

  if (absSmPosition > 1_000_000) {
    severity = 'CRITICAL'
    recommendation = `🎲 CONTRARIAN CRITICAL: SM has $${(absSmPosition/1e6).toFixed(1)}M ${smSide}. Playing squeeze with TINY size.`
    bidMult = botSide === 'long' ? 0.40 : 1.20   // Very far bids if accumulating long
    askMult = botSide === 'long' ? 1.20 : 0.40   // Wide asks to profit from spike
    invMult = 0.25  // Only 25% of normal inventory
  } else if (absSmPosition > 500_000) {
    severity = 'HIGH'
    recommendation = `🎲 CONTRARIAN HIGH: SM ${smSide} $${(absSmPosition/1e3).toFixed(0)}k. Conservative squeeze play.`
    bidMult = botSide === 'long' ? 0.50 : 1.15
    askMult = botSide === 'long' ? 1.15 : 0.50
    invMult = 0.40
  } else if (absSmPosition > 100_000) {
    severity = 'MEDIUM'
    recommendation = `🎲 CONTRARIAN: SM ${smSide} $${(absSmPosition/1e3).toFixed(0)}k. Moderate squeeze play.`
    bidMult = botSide === 'long' ? 0.65 : 1.08
    askMult = botSide === 'long' ? 1.08 : 0.65
    invMult = 0.60
  } else {
    severity = 'LOW'
    recommendation = 'Minor SM conflict - standard approach'
    bidMult = botSide === 'long' ? 0.80 : 1.05
    askMult = botSide === 'long' ? 1.05 : 0.80
    invMult = 0.80
  }

  // Calculate squeeze trigger and stop loss prices
  const config = CONTRARIAN_CONFIG[token]
  let squeezeTriggerPrice: number | undefined
  let stopLossPrice: number | undefined

  if (currentPrice && config) {
    if (botSide === 'long') {
      squeezeTriggerPrice = currentPrice * (1 + config.squeezeTriggerPct)
      stopLossPrice = currentPrice * (1 - config.stopLossPct)
    } else if (botSide === 'short') {
      squeezeTriggerPrice = currentPrice * (1 - config.squeezeTriggerPct)
      stopLossPrice = currentPrice * (1 + config.stopLossPct)
    }
  }

  return {
    token,
    botSide,
    smSide,
    smNetPositionUsd,
    conflictSeverity: severity,
    recommendation,
    contrarian: {
      bidMultiplier: bidMult,
      askMultiplier: askMult,
      maxInventoryMultiplier: invMult,
      squeezeTriggerPrice,
      stopLossPrice
    }
  }
}

export type DynamicConfigManagerOptions = {
  tokens: string[]
  dataPath?: string
  intervalMs?: number
  notifier?: ConsoleNotifier
  marketDataProvider?: (token: string) => Promise<HyperliquidMarketData | null>
  telemetryCollector?: TelemetryCollector
  alertManager?: AlertManager
}

const DEFAULT_TUNING: CoinTuning = {
  enabled: true,
  baseSpreadBps: 15,
  minSpreadBps: 10,
  maxSpreadBps: 40,
  smFlowSpreadMult: 1.0,
  smPositionSpreadMult: 1.0,
  baseOrderSizeUsd: 500,
  maxPositionUsd: 10_000,
  smSignalSkew: 0,
  inventorySkewMult: 1.5,
  maxLeverage: 1,
  stopLossPct: 0.05,
  bidSizeMultiplier: 1.0,
  askSizeMultiplier: 1.0,
  capitalMultiplier: 1.0,
  targetInventory: 0
}

/**
 * Dynamically adjusts NANSEN_TOKENS tuning parameters using smart_money_data.json
 */
export class DynamicConfigManager {
  private readonly tokens: string[]
  private readonly dataPaths: string[]
  private readonly intervalMs: number
  private readonly notifier: ConsoleNotifier
  private readonly baseTuning: Map<string, CoinTuning>
  private timer: NodeJS.Timeout | null = null
  private refreshing = false
  private readonly marketDataProvider?: (token: string) => Promise<HyperliquidMarketData | null>
  private readonly telemetryCollector?: TelemetryCollector
  private readonly alertManager?: AlertManager

  constructor(options: DynamicConfigManagerOptions) {
    this.tokens = options.tokens
    const fallbackPaths = [
      options.dataPath,
      path.join(process.cwd(), 'runtime', 'smart_money_data.json'),
      path.join(process.cwd(), 'smart_money_data.json'),
      '/tmp/smart_money_data.json'
    ].filter((p): p is string => Boolean(p))
    this.dataPaths = Array.from(new Set(fallbackPaths))
    this.intervalMs = options.intervalMs ?? 5 * 60 * 1000
    this.notifier = options.notifier ?? new ConsoleNotifier()
    this.baseTuning = new Map()
    this.marketDataProvider = options.marketDataProvider
    this.telemetryCollector = options.telemetryCollector
    this.alertManager = options.alertManager

    for (const token of this.tokens) {
      const base = NANSEN_TOKENS[token]?.tuning
      this.baseTuning.set(token, base ? { ...base } : { ...DEFAULT_TUNING })
    }
  }

  start(): void {
    if (this.timer || this.tokens.length === 0) {
      return
    }
    void this.refresh()
    this.timer = setInterval(() => {
      void this.refresh()
    }, this.intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getTrackedTokens(): string[] {
    return [...this.tokens]
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const file = await this.loadSmartMoneyFile()
      if (!file) return

      for (const token of this.tokens) {
        const entry = file.data[token]
        if (!entry) continue
        await this.applyTuningForToken(token, entry)
      }
    } catch (err: any) {
      this.notifier.warn(`[DynamicConfig] refresh failed: ${err?.message || err}`)
    } finally {
      this.refreshing = false
    }
  }

  private async loadSmartMoneyFile(): Promise<SmartMoneyFile | null> {
    for (const candidate of this.dataPaths) {
      try {
        const raw = await fsp.readFile(candidate, 'utf8')
        const json = JSON.parse(raw)
        if (!json?.data || typeof json.data !== 'object') {
          continue
        }
        return json as SmartMoneyFile
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          this.notifier.warn(`[DynamicConfig] Unable to read ${candidate}: ${err?.message || err}`)
        }
      }
    }
    return null
  }

  private async applyTuningForToken(token: string, entry: SmartMoneyEntry): Promise<void> {
    const base = this.baseTuning.get(token) ?? DEFAULT_TUNING
    const current = NANSEN_TOKENS[token]?.tuning ?? { ...base }

    const marketData = this.marketDataProvider ? await this.marketDataProvider(token) : null
    const next = this.deriveTuning(token, base, entry, marketData)
    const hasChanged = this.hasMeaningfulChange(current, next)
    if (!hasChanged) {
      return
    }

    NANSEN_TOKENS[token] = {
      ...(NANSEN_TOKENS[token] || { chain: 'hyperliquid', address: token }),
      tuning: next
    }

    const snapshot = this.buildSnapshot(token, entry, marketData, next)
    if (snapshot) {
      this.telemetryCollector?.recordSnapshot(snapshot)
      this.alertManager?.evaluateSnapshot(snapshot)
      this.telemetryCollector?.recordDiagnostics({
        timestamp: new Date(),
        token,
        event: 'CONFIG_UPDATE',
        level: 'INFO',
        message: 'Dynamic tuning applied',
        context: { baseSpread: next.baseSpreadBps, baseOrderSize: next.baseOrderSizeUsd }
      })
    }

    this.notifier.info(
      `[DynamicConfig] ${token} spread ${current.baseSpreadBps}→${next.baseSpreadBps}bps ` +
        `size bid×${(next.bidSizeMultiplier ?? 1).toFixed(2)} ask×${(next.askSizeMultiplier ?? 1).toFixed(2)} ` +
        `cap×${(next.capitalMultiplier ?? 1).toFixed(2)} inv=${(next.targetInventory ?? 0).toFixed(2)}`
    )
  }

  private deriveTuning(token: string, base: CoinTuning, entry: SmartMoneyEntry, marketData?: HyperliquidMarketData | null): CoinTuning {
    const biasRatio = this.clamp(typeof entry.bias === 'number' ? entry.bias : 0.5, 0, 1)
    const dominance = Math.abs(0.5 - biasRatio) // 0 .. 0.5
    const dominanceScale = dominance * 2 // 0..1
    const direction: BiasDirection =
      biasRatio < 0.48 ? 'SHORT' : biasRatio > 0.52 ? 'LONG' : 'NEUTRAL'
    const directionSign = direction === 'SHORT' ? 1 : direction === 'LONG' ? -1 : 0

    let baseSpread = base.baseSpreadBps ?? DEFAULT_TUNING.baseSpreadBps
    // Strong dominance → allow tighter quoting but increase risk buffers
    baseSpread -= Math.round((dominanceScale - 0.2) * 5) // e.g. dominance 0.4 => -1 spread

    // Trend-driven adjustments
    const trend = entry.trend || 'unknown'
    if (trend === 'increasing_shorts' && directionSign > 0) {
      baseSpread += 1 // shorts adding into trend -> widen slightly
    } else if (trend === 'increasing_longs' && directionSign < 0) {
      baseSpread += 1
    }

    // Large 7d flow swings widen spread
    const flowChange = entry.flow_change_7d ?? 0
    if (Math.abs(flowChange) > 3_000_000) {
      baseSpread += 2
    } else if (Math.abs(flowChange) > 1_000_000) {
      baseSpread += 1
    }

    const minSpread = Math.max(
      base.minSpreadBps ?? DEFAULT_TUNING.minSpreadBps,
      Math.round((baseSpread * 0.6))
    )
    const maxSpread = Math.max(
      base.maxSpreadBps ?? DEFAULT_TUNING.maxSpreadBps,
      minSpread + 10
    )

    baseSpread = this.clamp(Math.round(baseSpread), minSpread, maxSpread - 2)

    // Signal skew pushes inventory bias toward Smart Money direction
    const smSignalSkew = this.clamp(directionSign * dominanceScale * 0.8, -0.45, 0.45)
    const inventorySkewMult = this.clamp(
      (base.inventorySkewMult ?? DEFAULT_TUNING.inventorySkewMult) + dominanceScale * 0.8,
      1.2,
      3.0
    )

    // Spread multipliers increase when flows are aggressive
    const flowIntensity = Math.min(1.5, Math.abs(flowChange) / 2_000_000)
    const smFlowSpreadMult =
      Math.max(1.0, (base.smFlowSpreadMult ?? 1.0) + flowIntensity * 0.15)
    const smPositionSpreadMult =
      Math.max(1.0, (base.smPositionSpreadMult ?? 1.0) + dominanceScale * 0.2)

    const { bid: biasBidMult, ask: biasAskMult } = this.getBiasSizeMultipliers(biasRatio)
    const trendFactor = this.getTrendAggression(direction, flowChange, entry.trend)
    const squeezeAnalysis = this.getSqueezeAnalysis(direction, entry)
    const marketAdjust = this.calculateMarketAdjustments(marketData)
    const fundingAdjust = this.calculateFundingAdjustment(direction, marketData)
    const flowInventoryBias = this.getFlowInventoryBias(entry.flow)

    baseSpread *= marketAdjust.spreadMultiplier

    // Apply squeeze factor to capital
    const baseCapitalMult = trendFactor * squeezeAnalysis.capitalFactor * marketAdjust.capitalMultiplier
    const capitalMultiplier = this.clamp(baseCapitalMult, 0.25, 2.0)

    // Apply squeeze factors to bid/ask sizing (KEY CHANGE for squeeze protection)
    const bidSizeMultiplier = this.clamp(
      biasBidMult * fundingAdjust.bidMultiplier * marketAdjust.bidSizeMultiplier * squeezeAnalysis.bidFactor,
      0.2,
      2.5
    )
    const askSizeMultiplier = this.clamp(
      biasAskMult * fundingAdjust.askMultiplier * marketAdjust.askSizeMultiplier * squeezeAnalysis.askFactor,
      0.2,
      2.5
    )

    // Emit squeeze alert if risk detected
    if (squeezeAnalysis.isSqueezeRisk && squeezeAnalysis.riskLevel !== 'none') {
      const squeezeType = direction === 'SHORT' ? 'SHORT SQUEEZE' : 'LONG SQUEEZE'
      const severity = squeezeAnalysis.riskLevel === 'critical' ? 'CRITICAL' :
                       squeezeAnalysis.riskLevel === 'high' ? 'HIGH' : 'WARNING'
      this.notifier.warn(
        `🔥 [${severity}] ${squeezeType} RISK on ${token} ` +
        `| Underwater: $${Math.abs(squeezeAnalysis.underwaterAmount / 1_000_000).toFixed(2)}M ` +
        `| Bid×${squeezeAnalysis.bidFactor.toFixed(2)} Ask×${squeezeAnalysis.askFactor.toFixed(2)} ` +
        `| SM: ${entry.signal || 'n/a'} | Dir: ${direction}`
      )
    }

    // Calculate preliminary target inventory
    let targetInventory = this.clamp(
      directionSign * dominanceScale * 0.6 + fundingAdjust.inventoryBias + flowInventoryBias,
      -0.6,
      0.6
    )

    // ============================================================
    // SM CONFLICT DETECTION (CONTRARIAN SQUEEZE PLAY)
    // ============================================================
    const smLongsUsd = entry.current_longs_usd ?? 0
    const smShortsUsd = entry.current_shorts_usd ?? 0
    const smNetPositionUsd = smLongsUsd - smShortsUsd  // >0 = SM net long, <0 = SM net short

    const currentPrice = marketData?.markPrice
    const smConflict = detectSMConflict(token, targetInventory, smNetPositionUsd, currentPrice)

    // Apply contrarian adjustments
    let finalBidMult = bidSizeMultiplier
    let finalAskMult = askSizeMultiplier
    let finalCapitalMult = capitalMultiplier
    let finalMaxPosition = base.maxPositionUsd ?? DEFAULT_TUNING.maxPositionUsd

    if (smConflict.conflictSeverity !== 'NONE') {
      // Apply contrarian multipliers
      finalBidMult = this.clamp(
        bidSizeMultiplier * smConflict.contrarian.bidMultiplier,
        0.2,
        2.5
      )
      finalAskMult = this.clamp(
        askSizeMultiplier * smConflict.contrarian.askMultiplier,
        0.2,
        2.5
      )
      finalCapitalMult = this.clamp(
        capitalMultiplier * smConflict.contrarian.maxInventoryMultiplier,
        0.15,
        2.0
      )

      // Apply contrarian max inventory from config
      const contrarianConfig = CONTRARIAN_CONFIG[token]
      if (contrarianConfig) {
        finalMaxPosition = Math.min(finalMaxPosition, contrarianConfig.maxInventoryUsd)
      }

      // Additional defensive clamp for LIT during CRITICAL conflicts
      if (
        token === 'LIT' &&
        smConflict.conflictSeverity === 'CRITICAL'
      ) {
        finalBidMult = Math.min(finalBidMult, 0.2) // keep bids tiny
        finalAskMult = Math.max(finalAskMult, 1.2)
        finalMaxPosition = Math.min(finalMaxPosition, 500)
        targetInventory = 0 // stay flat, no deepening long
        this.notifier.warn(
          `🚫 [CONTRARIAN] LIT critical SM conflict - forcing defensive mode (max $500 inventory, targetInventory=0)`
        )
      }

      // Log contrarian alert
      this.notifier.warn(
        `🎲 [CONTRARIAN] ${token} | ${smConflict.recommendation} ` +
        `| Final Bid×${finalBidMult.toFixed(2)} Ask×${finalAskMult.toFixed(2)} ` +
        `| MaxPos: $${finalMaxPosition.toFixed(0)} ` +
        `| SqueezeTrigger: ${smConflict.contrarian.squeezeTriggerPrice ? '$' + smConflict.contrarian.squeezeTriggerPrice.toFixed(4) : 'n/a'} ` +
        `| StopLoss: ${smConflict.contrarian.stopLossPrice ? '$' + smConflict.contrarian.stopLossPrice.toFixed(4) : 'n/a'}`
      )
    }

    // ============================================================
    // EMERGENCY OVERRIDE - Apply when SM is WINNING
    // This takes precedence over contrarian logic
    // ============================================================
    const emergencyOverride = EMERGENCY_OVERRIDES[token]
    if (emergencyOverride) {
      // Apply emergency multipliers
      if (!emergencyOverride.bidEnabled) {
        finalBidMult = 0  // Completely disable bids
      } else {
        finalBidMult = Math.min(finalBidMult, emergencyOverride.bidMultiplier)
      }

      if (!emergencyOverride.askEnabled) {
        finalAskMult = 0
      } else {
        finalAskMult = Math.max(finalAskMult, emergencyOverride.askMultiplier)
      }

      // Apply stricter max inventory
      finalMaxPosition = Math.min(finalMaxPosition, emergencyOverride.maxInventoryUsd)

      // Force neutral/defensive inventory target
      targetInventory = 0

      this.notifier.warn(
        `🛑 [EMERGENCY] ${token} | ${emergencyOverride.reason} | ` +
        `Bid×${finalBidMult.toFixed(2)} Ask×${finalAskMult.toFixed(2)} MaxPos: $${finalMaxPosition}`
      )
    }

    const baseOrderSource = base.baseOrderSizeUsd ?? DEFAULT_TUNING.baseOrderSizeUsd
    const baseOrderSizeUsd = this.clamp(
      baseOrderSource * finalCapitalMult,
      50,
      finalMaxPosition
    )

    return {
      ...base,
      enabled: true,
      baseSpreadBps: baseSpread,
      minSpreadBps: minSpread,
      maxSpreadBps: maxSpread,
      smFlowSpreadMult,
      smPositionSpreadMult,
      smSignalSkew,
      inventorySkewMult,
      baseOrderSizeUsd,
      maxPositionUsd: finalMaxPosition,
      maxLeverage: base.maxLeverage ?? DEFAULT_TUNING.maxLeverage,
      stopLossPct: base.stopLossPct ?? DEFAULT_TUNING.stopLossPct,
      bidSizeMultiplier: finalBidMult,
      askSizeMultiplier: finalAskMult,
      capitalMultiplier: finalCapitalMult,
      targetInventory,
      // Contrarian squeeze play fields (for mm_hl.ts to use)
      squeezeTriggerPrice: smConflict.contrarian.squeezeTriggerPrice,
      stopLossPrice: smConflict.contrarian.stopLossPrice,
      smConflictSeverity: smConflict.conflictSeverity
    } as CoinTuning
  }

  private hasMeaningfulChange(current: CoinTuning, next: CoinTuning): boolean {
    return (
      Math.abs(current.baseSpreadBps - next.baseSpreadBps) >= 1 ||
      Math.abs(current.minSpreadBps - next.minSpreadBps) >= 1 ||
      Math.abs(current.maxSpreadBps - next.maxSpreadBps) >= 1 ||
      Math.abs(current.smSignalSkew - next.smSignalSkew) >= 0.05 ||
      Math.abs(current.inventorySkewMult - next.inventorySkewMult) >= 0.1 ||
      Math.abs((current.bidSizeMultiplier ?? 1) - (next.bidSizeMultiplier ?? 1)) >= 0.1 ||
      Math.abs((current.askSizeMultiplier ?? 1) - (next.askSizeMultiplier ?? 1)) >= 0.1 ||
      Math.abs((current.capitalMultiplier ?? 1) - (next.capitalMultiplier ?? 1)) >= 0.1 ||
      Math.abs(current.baseOrderSizeUsd - next.baseOrderSizeUsd) >= 50
    )
  }

  private getBiasSizeMultipliers(biasRatio: number): { bid: number; ask: number } {
    if (biasRatio <= 0.1) return { bid: 0.4, ask: 1.6 }
    if (biasRatio <= 0.2) return { bid: 0.6, ask: 1.4 }
    if (biasRatio <= 0.4) return { bid: 0.8, ask: 1.2 }
    if (biasRatio <= 0.6) return { bid: 1.0, ask: 1.0 }
    if (biasRatio <= 0.8) return { bid: 1.2, ask: 0.8 }
    if (biasRatio <= 0.9) return { bid: 1.4, ask: 0.6 }
    return { bid: 1.6, ask: 0.4 }
  }

  private getTrendAggression(direction: BiasDirection, flowChange: number, trend?: string): number {
    let factor = 1.0
    if (direction === 'SHORT') {
      if (flowChange > 500_000) factor *= 0.6 // Shorts closing
      else if (flowChange < -500_000) factor *= 1.15 // Shorts adding
      if (trend === 'increasing_shorts') factor *= 1.1
      if (trend === 'increasing_longs') factor *= 0.8
    } else if (direction === 'LONG') {
      if (flowChange < -500_000) factor *= 0.6 // Longs closing
      else if (flowChange > 500_000) factor *= 1.15
      if (trend === 'increasing_longs') factor *= 1.1
      if (trend === 'increasing_shorts') factor *= 0.8
    } else {
      if (Math.abs(flowChange) > 1_000_000) {
        factor *= 1.1
      }
    }
    if (trend && trend.toLowerCase().includes('pivot')) {
      factor *= 1.2
    }
    return this.clamp(factor, 0.3, 1.5)
  }

  /**
   * Enhanced squeeze detection with separate bid/ask adjustments and alert flags
   */
  private getSqueezeFactor(direction: BiasDirection, entry: SmartMoneyEntry): number {
    const { capitalFactor } = this.getSqueezeAnalysis(direction, entry)
    return capitalFactor
  }

  private getSqueezeAnalysis(direction: BiasDirection, entry: SmartMoneyEntry): {
    capitalFactor: number
    bidFactor: number
    askFactor: number
    isSqueezeRisk: boolean
    riskLevel: 'none' | 'moderate' | 'high' | 'critical'
    underwaterAmount: number
  } {
    const longsUpnl = entry.longs_upnl ?? 0
    const shortsUpnl = entry.shorts_upnl ?? 0
    let capitalFactor = 1.0
    let bidFactor = 1.0
    let askFactor = 1.0
    let isSqueezeRisk = false
    let riskLevel: 'none' | 'moderate' | 'high' | 'critical' = 'none'
    let underwaterAmount = 0

    if (direction === 'SHORT') {
      underwaterAmount = Math.min(0, shortsUpnl)

      // Shorts underwater = potential SHORT SQUEEZE
      if (shortsUpnl < -1_500_000) {
        capitalFactor *= 0.35
        bidFactor *= 0.50    // ↓↓ Very conservative bids (don't accumulate into squeeze)
        askFactor *= 1.10    // ↑ Slightly wider asks (profit from volatility)
        isSqueezeRisk = true
        riskLevel = 'critical'
      } else if (shortsUpnl < -1_000_000) {
        capitalFactor *= 0.5
        bidFactor *= 0.60    // ↓ Conservative bids
        askFactor *= 1.05
        isSqueezeRisk = true
        riskLevel = 'high'
      } else if (shortsUpnl < -500_000) {
        capitalFactor *= 0.6
        bidFactor *= 0.75    // ↓ Moderate bid reduction
        isSqueezeRisk = true
        riskLevel = 'moderate'
      } else if (shortsUpnl > 400_000) {
        capitalFactor *= 1.1  // Shorts winning, more confidence
        bidFactor *= 1.1
      }

      // Additional factor if longs are winning (shorts getting squeezed)
      if (entry.top_traders_pnl === 'longs_winning') {
        capitalFactor *= 0.85
        bidFactor *= 0.85
        if (!isSqueezeRisk) {
          isSqueezeRisk = true
          riskLevel = 'moderate'
        }
      }
    } else if (direction === 'LONG') {
      underwaterAmount = Math.min(0, longsUpnl)

      // Longs underwater = potential LONG SQUEEZE (dump)
      if (longsUpnl < -1_500_000) {
        capitalFactor *= 0.4
        askFactor *= 0.50    // ↓↓ Very conservative asks
        bidFactor *= 1.10    // ↑ Slightly aggressive bids (buy the dip)
        isSqueezeRisk = true
        riskLevel = 'critical'
      } else if (longsUpnl < -1_000_000) {
        capitalFactor *= 0.5
        askFactor *= 0.60
        isSqueezeRisk = true
        riskLevel = 'high'
      } else if (longsUpnl < -500_000) {
        capitalFactor *= 0.6
        askFactor *= 0.75
        isSqueezeRisk = true
        riskLevel = 'moderate'
      } else if (longsUpnl > 400_000) {
        capitalFactor *= 1.1
        askFactor *= 1.1
      }

      if (entry.top_traders_pnl === 'shorts_winning') {
        capitalFactor *= 0.85
        askFactor *= 0.85
        if (!isSqueezeRisk) {
          isSqueezeRisk = true
          riskLevel = 'moderate'
        }
      }
    }

    return {
      capitalFactor: this.clamp(capitalFactor, 0.3, 1.4),
      bidFactor: this.clamp(bidFactor, 0.4, 1.3),
      askFactor: this.clamp(askFactor, 0.4, 1.3),
      isSqueezeRisk,
      riskLevel,
      underwaterAmount
    }
  }

  private calculateMarketAdjustments(marketData?: HyperliquidMarketData | null) {
    if (!marketData) {
      return { spreadMultiplier: 1.0, capitalMultiplier: 1.0, bidSizeMultiplier: 1.0, askSizeMultiplier: 1.0 }
    }
    const pctMove = Math.abs(marketData.priceChangePct24h || 0)
    let spreadMult = 1.0
    let capitalMult = 1.0
    let bidMult = 1.0
    let askMult = 1.0
    if (pctMove > 10) {
      spreadMult *= 2.5
      capitalMult *= 0.4
      bidMult *= 0.6
      askMult *= 0.6
    } else if (pctMove > 5) {
      spreadMult *= 1.8
      capitalMult *= 0.6
      bidMult *= 0.7
      askMult *= 0.7
    } else if (pctMove > 3) {
      spreadMult *= 1.4
      capitalMult *= 0.75
    } else if (pctMove < 1) {
      spreadMult *= 0.95
      capitalMult *= 1.1
    }

    const volToOi = marketData.volumeToOiRatio || 0
    if (volToOi > 1.5) {
      capitalMult *= 1.15
    } else if (volToOi < 0.5) {
      capitalMult *= 0.85
    }

    return {
      spreadMultiplier: this.clamp(spreadMult, 0.6, 3.0),
      capitalMultiplier: this.clamp(capitalMult, 0.25, 2.0),
      bidSizeMultiplier: this.clamp(bidMult, 0.2, 1.5),
      askSizeMultiplier: this.clamp(askMult, 0.2, 1.5)
    }
  }

  private calculateFundingAdjustment(direction: BiasDirection, marketData?: HyperliquidMarketData | null) {
    const funding = marketData?.fundingRateAnnualized ?? 0
    let inventoryBias = 0
    let bidMultiplier = 1.0
    let askMultiplier = 1.0
    if (funding < -20) {
      // shorts paid -> lean short
      inventoryBias += 0.1
      askMultiplier *= 1.1
    } else if (funding > 20) {
      inventoryBias -= 0.1
      bidMultiplier *= 1.1
    }
    if (direction === 'SHORT' && funding < -40) {
      inventoryBias += 0.05
    }
    if (direction === 'LONG' && funding > 40) {
      inventoryBias -= 0.05
    }
    return { inventoryBias, bidMultiplier, askMultiplier }
  }

  private getFlowInventoryBias(flow?: number): number {
    if (!flow) return 0
    if (flow > 2_000_000) return -0.1
    if (flow > 500_000) return -0.05
    if (flow < -2_000_000) return 0.1
    if (flow < -500_000) return 0.05
    return 0
  }

  private buildSnapshot(
    token: string,
    entry: SmartMoneyEntry,
    marketData: HyperliquidMarketData | null,
    tuning: CoinTuning
  ) {
    if (!this.telemetryCollector && !this.alertManager) return null
    const conflict = detectSMConflict(
      token,
      tuning.targetInventory ?? 0,
      (entry.current_longs_usd ?? 0) - (entry.current_shorts_usd ?? 0),
      marketData?.markPrice
    )
    const snapshot = {
      timestamp: new Date(),
      token,
      smartMoney: {
        totalLongsUsd: entry.current_longs_usd ?? 0,
        totalShortsUsd: entry.current_shorts_usd ?? 0,
        biasRatio: typeof entry.bias === 'number' ? entry.bias : 0.5,
        netPositionUsd: (entry.current_longs_usd ?? 0) - (entry.current_shorts_usd ?? 0),
        numLongTraders: entry.momentum ?? 0,
        numShortTraders: entry.velocity ?? 0,
        topWhaleAddress: entry.signal,
        topWhalePositionUsd: entry.flow_change_7d,
        topWhaleUnrealizedPnl: entry.shorts_upnl ?? 0,
        concentrationRisk: entry.trend_strength === 'strong' ? 0.9 : entry.trend_strength === 'moderate' ? 0.7 : 0.4
      },
      flow: {
        balanceChange7d: entry.flow_change_7d ?? 0,
        trend: entry.trend,
        isPivot: entry.trend === 'pivot'
      },
      market: {
        markPrice: marketData?.markPrice,
        priceChangePct24h: marketData?.priceChangePct24h,
        volume24h: marketData?.volume24h,
        openInterest: marketData?.openInterest,
        fundingRateAnnualized: marketData?.fundingRateAnnualized
      },
      bot: {
        currentInventory: 0,
        targetInventory: tuning.targetInventory ?? 0,
        capitalMultiplier: tuning.capitalMultiplier ?? 1
      },
      config: {
        baseSpreadBps: tuning.baseSpreadBps,
        minSpreadBps: tuning.minSpreadBps,
        maxSpreadBps: tuning.maxSpreadBps,
        baseOrderSizeUsd: tuning.baseOrderSizeUsd,
        bidSizeMultiplier: tuning.bidSizeMultiplier ?? 1,
        askSizeMultiplier: tuning.askSizeMultiplier ?? 1
      },
      signals: [],
      contrarian:
        conflict.conflictSeverity !== 'NONE'
          ? {
              severity: conflict.conflictSeverity,
              smNetPositionUsd: conflict.smNetPositionUsd,
              botSide: conflict.botSide,
              smSide: conflict.smSide,
              squeezeTriggerPrice: conflict.contrarian.squeezeTriggerPrice,
              stopLossPrice: conflict.contrarian.stopLossPrice
            }
          : undefined
    } as const
    return snapshot
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
  }
}


