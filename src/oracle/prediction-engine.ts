/**
 * Oracle Prediction Engine - Main orchestration for price predictions
 *
 * Integrates:
 * - Price data from Hyperliquid API
 * - Smart Money flow from NansenFeed
 * - Signal calculations from signals.ts
 * - Accuracy tracking
 */

import { EventEmitter } from 'events'
import axios from 'axios'
import type {
  OracleSignal,
  Prediction,
  PredictionAccuracy,
  PredictionHorizon,
  PricePoint,
  TimeSeries,
  OracleState,
  OracleConfig,
  DEFAULT_ORACLE_CONFIG,
  OHLCVCandle,
} from './types.js'
import {
  generateOracleSignal,
  calculateLinearRegression,
  calculateWeightedRegression,
} from './signals.js'
import { nansenFeed, TRACKED_COINS, type AggregatedCoinData } from '../core/data/NansenFeed.js'

// ============================================================
// CONSTANTS
// ============================================================

const HL_API_URL = 'https://api.hyperliquid.xyz/info'

/** Horizon to milliseconds mapping */
const HORIZON_MS: Record<PredictionHorizon, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
}

// ============================================================
// ORACLE PREDICTION ENGINE
// ============================================================

export class OraclePredictionEngine extends EventEmitter {
  private config: OracleConfig
  private state: OracleState
  private updateTimer: NodeJS.Timeout | null = null

  // Data caches
  private priceCache: Map<string, PricePoint[]> = new Map()
  private smFlowCache: Map<string, { timestamp: number; flow: number }[]> = new Map()

  // Pending predictions for accuracy tracking
  private pendingPredictions: Prediction[] = []

  // allMids cache — single fetch serves all coins
  private allMidsCache: Record<string, string> | null = null
  private allMidsCacheTime: number = 0
  private static ALLMIDS_CACHE_TTL = 5_000 // 5 seconds

  constructor(config: Partial<OracleConfig> = {}) {
    super()

    this.config = {
      updateIntervalMs: config.updateIntervalMs ?? 60_000,
      regressionPeriod: config.regressionPeriod ?? 20,
      momentumPeriod: config.momentumPeriod ?? 14,
      minDataPoints: config.minDataPoints ?? 10,
      predictionHorizons: config.predictionHorizons ?? ['15m', '1h', '4h'],
      smWeightFactor: config.smWeightFactor ?? 0.4,
      trackAccuracy: config.trackAccuracy ?? true,
    }

    this.state = {
      isRunning: false,
      lastUpdate: null,
      trackedCoins: [...TRACKED_COINS],
      signals: new Map(),
      predictions: new Map(),
      accuracy: new Map(),
      errors: [],
    }
  }

  // ============================================================
  // LIFECYCLE
  // ============================================================

  /**
   * Start the prediction engine
   */
  async start(): Promise<void> {
    if (this.state.isRunning) {
      console.log('[Oracle] Already running')
      return
    }

    console.log('[Oracle] Starting prediction engine...')
    this.state.isRunning = true

    // Initial update
    await this.update()

    // Start periodic updates
    this.updateTimer = setInterval(() => {
      this.update().catch(err => {
        console.error('[Oracle] Update error:', err)
        this.state.errors.push(`${new Date().toISOString()}: ${err.message}`)
      })
    }, this.config.updateIntervalMs)

    console.log(`[Oracle] Started with ${this.config.updateIntervalMs}ms interval`)
    this.emit('started')
  }

  /**
   * Stop the prediction engine
   */
  stop(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = null
    }
    this.state.isRunning = false
    console.log('[Oracle] Stopped')
    this.emit('stopped')
  }

  // ============================================================
  // DATA FETCHING
  // ============================================================

  /**
   * Fetch OHLCV candles from Hyperliquid
   */
  async fetchOHLCV(
    coin: string,
    interval: string = '15m',
    limit: number = 100
  ): Promise<OHLCVCandle[]> {
    try {
      const payload = {
        type: 'candleSnapshot',
        req: {
          coin,
          interval,
          startTime: Date.now() - limit * 15 * 60 * 1000, // Rough estimate
          endTime: Date.now(),
        },
      }

      const response = await axios.post(HL_API_URL, payload, { timeout: 10000 })
      const candles = response.data || []

      return candles.map((c: any) => ({
        timestamp: c.t,
        open: parseFloat(c.o),
        high: parseFloat(c.h),
        low: parseFloat(c.l),
        close: parseFloat(c.c),
        volume: parseFloat(c.v),
      }))
    } catch (error) {
      console.error(`[Oracle] Error fetching OHLCV for ${coin}:`, error)
      return []
    }
  }

  /**
   * Fetch all mid prices (cached for 5s — single fetch serves all coins)
   */
  private async fetchAllMids(): Promise<Record<string, string>> {
    const now = Date.now()
    if (this.allMidsCache && now - this.allMidsCacheTime < OraclePredictionEngine.ALLMIDS_CACHE_TTL) {
      return this.allMidsCache
    }
    try {
      const response = await axios.post(HL_API_URL, { type: 'allMids' }, { timeout: 5000 })
      this.allMidsCache = response.data as Record<string, string>
      this.allMidsCacheTime = now
      return this.allMidsCache
    } catch (error) {
      console.error('[Oracle] Error fetching allMids:', error)
      return this.allMidsCache || {}
    }
  }

  /**
   * Get current price for a coin (uses cached allMids)
   */
  async fetchCurrentPrice(coin: string): Promise<number | null> {
    const mids = await this.fetchAllMids()
    return mids[coin] ? parseFloat(mids[coin]) : null
  }

  /**
   * Update price cache with latest data
   */
  private async updatePriceCache(coin: string): Promise<void> {
    const candles = await this.fetchOHLCV(coin, '5m', 50)

    if (candles.length === 0) return

    const prices: PricePoint[] = candles.map(c => ({
      timestamp: c.timestamp,
      price: c.close,
      volume: c.volume,
    }))

    // Add SM flow data if available
    const aggregated = nansenFeed.getAggregatedData()
    const coinData = aggregated[coin]
    if (coinData) {
      const flow = coinData.longs - coinData.shorts
      // Add flow to latest price point
      if (prices.length > 0) {
        prices[prices.length - 1].smFlow = flow
      }
    }

    this.priceCache.set(coin, prices)
  }

  /**
   * Update SM flow cache
   */
  private updateSMFlowCache(coin: string, aggregated: Record<string, AggregatedCoinData>): void {
    const coinData = aggregated[coin]
    if (!coinData) return

    const flow = coinData.longs - coinData.shorts
    const existing = this.smFlowCache.get(coin) || []

    existing.push({
      timestamp: Date.now(),
      flow,
    })

    // Keep last 100 data points
    if (existing.length > 100) {
      existing.shift()
    }

    this.smFlowCache.set(coin, existing)
  }

  // ============================================================
  // PREDICTION GENERATION
  // ============================================================

  /**
   * Generate prediction for a coin and horizon
   */
  generatePrediction(
    coin: string,
    horizon: PredictionHorizon,
    signal: OracleSignal,
    currentPrice: number
  ): Prediction {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + HORIZON_MS[horizon])

    // Calculate predicted price change based on signal score and regression
    const regressionChange = (signal.regression.prediction - currentPrice) / currentPrice

    // Scale prediction by horizon (longer = more change expected)
    const horizonScale: Record<PredictionHorizon, number> = {
      '5m': 0.2,
      '15m': 0.4,
      '1h': 0.7,
      '4h': 1.0,
      '1d': 1.5,
    }

    const baseChange = regressionChange * horizonScale[horizon]

    // Adjust by signal score (stronger signal = more confident in direction)
    const scoreMultiplier = 1 + Math.abs(signal.score) / 200
    const predictedChange = baseChange * scoreMultiplier

    // Calculate confidence based on signal confidence and r²
    const confidence = Math.round(
      (signal.confidence * 0.5) +
      (signal.regression.r2 * 100 * 0.3) +
      (signal.regression.confidence * 0.2)
    )

    const predictedPrice = currentPrice * (1 + predictedChange)

    const direction: 'up' | 'down' | 'sideways' =
      predictedChange > 0.001 ? 'up' :
      predictedChange < -0.001 ? 'down' : 'sideways'

    return {
      coin,
      horizon,
      currentPrice,
      predictedPrice,
      predictedChange: predictedChange * 100,
      confidence: Math.min(100, Math.max(0, confidence)),
      direction,
      factors: {
        regressionWeight: 0.5,
        smWeight: this.config.smWeightFactor,
        momentumWeight: 0.5 - this.config.smWeightFactor,
      },
      timestamp: now,
      expiresAt,
    }
  }

  // ============================================================
  // ACCURACY TRACKING
  // ============================================================

  /**
   * Check expired predictions and update accuracy
   */
  private async checkPredictionAccuracy(): Promise<void> {
    if (!this.config.trackAccuracy) return

    const now = Date.now()
    const expired = this.pendingPredictions.filter(p => p.expiresAt.getTime() <= now)

    // Pre-fetch all mids once for the batch
    const mids = await this.fetchAllMids()
    for (const prediction of expired) {
      const actualPrice = mids[prediction.coin] ? parseFloat(mids[prediction.coin]) : null
      if (actualPrice === null) continue

      // Calculate actual change
      const actualChange = (actualPrice - prediction.currentPrice) / prediction.currentPrice * 100

      // Check if direction was correct
      const predictedUp = prediction.predictedChange > 0
      const actualUp = actualChange > 0
      const correct = predictedUp === actualUp

      // Calculate error
      const error = Math.abs(prediction.predictedChange - actualChange)

      // Update accuracy stats
      const key = `${prediction.coin}_${prediction.horizon}`
      const existing = this.state.accuracy.get(key) || []

      let stats = existing.find(a => a.horizon === prediction.horizon)
      if (!stats) {
        stats = {
          coin: prediction.coin,
          horizon: prediction.horizon,
          totalPredictions: 0,
          correctDirection: 0,
          avgError: 0,
          avgConfidence: 0,
          winRate: 0,
          lastUpdate: new Date(),
        }
        existing.push(stats)
      }

      // Update stats
      const n = stats.totalPredictions
      stats.totalPredictions++
      stats.correctDirection += correct ? 1 : 0
      stats.avgError = (stats.avgError * n + error) / (n + 1)
      stats.avgConfidence = (stats.avgConfidence * n + prediction.confidence) / (n + 1)
      stats.winRate = stats.correctDirection / stats.totalPredictions * 100
      stats.lastUpdate = new Date()

      this.state.accuracy.set(key, existing)

      // Log result
      const emoji = correct ? '✅' : '❌'
      console.log(`[Oracle] ${emoji} ${prediction.coin} ${prediction.horizon}: Predicted ${prediction.predictedChange.toFixed(2)}%, Actual ${actualChange.toFixed(2)}%`)
    }

    // Remove expired predictions
    this.pendingPredictions = this.pendingPredictions.filter(
      p => p.expiresAt.getTime() > now
    )
  }

  // ============================================================
  // MAIN UPDATE CYCLE
  // ============================================================

  /**
   * Main update cycle
   */
  async update(): Promise<void> {
    const startTime = Date.now()
    console.log('[Oracle] Update cycle starting...')

    // Check prediction accuracy first
    await this.checkPredictionAccuracy()

    // Get SM data
    const aggregated = nansenFeed.getAggregatedData()

    // Process each coin
    for (const coin of this.state.trackedCoins) {
      try {
        // Update caches
        await this.updatePriceCache(coin)
        this.updateSMFlowCache(coin, aggregated)

        // Get cached data
        const prices = this.priceCache.get(coin) || []
        const smFlows = this.smFlowCache.get(coin) || []

        if (prices.length < this.config.minDataPoints) {
          continue
        }

        // Generate signal
        const signal = generateOracleSignal(coin, prices, smFlows, this.config)
        if (!signal) continue

        this.state.signals.set(coin, signal)

        // Generate predictions for each horizon
        const currentPrice = prices[prices.length - 1].price
        const predictions: Prediction[] = []

        for (const horizon of this.config.predictionHorizons) {
          const prediction = this.generatePrediction(coin, horizon, signal, currentPrice)
          predictions.push(prediction)

          // Add to pending for accuracy tracking
          if (this.config.trackAccuracy) {
            this.pendingPredictions.push(prediction)
          }
        }

        this.state.predictions.set(coin, predictions)

        // Emit signal event
        this.emit('signal', signal)

      } catch (error) {
        console.error(`[Oracle] Error processing ${coin}:`, error)
      }

      // Small delay between coins
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    this.state.lastUpdate = new Date()

    const elapsed = Date.now() - startTime
    console.log(`[Oracle] Update complete in ${elapsed}ms`)

    this.emit('update', {
      signals: Object.fromEntries(this.state.signals),
      predictions: Object.fromEntries(this.state.predictions),
      timestamp: new Date(),
    })
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  /**
   * Get signal for a coin
   */
  getSignal(coin: string): OracleSignal | undefined {
    return this.state.signals.get(coin)
  }

  /**
   * Get all signals
   */
  getAllSignals(): Map<string, OracleSignal> {
    return this.state.signals
  }

  /**
   * Get predictions for a coin
   */
  getPredictions(coin: string): Prediction[] {
    return this.state.predictions.get(coin) || []
  }

  /**
   * Get accuracy stats for a coin
   */
  getAccuracy(coin: string): PredictionAccuracy[] {
    return this.state.accuracy.get(coin) || []
  }

  /**
   * Get overall accuracy stats
   */
  getOverallAccuracy(): {
    totalPredictions: number
    avgWinRate: number
    avgError: number
  } {
    let total = 0
    let winRateSum = 0
    let errorSum = 0
    let count = 0

    this.state.accuracy.forEach(stats => {
      for (const s of stats) {
        total += s.totalPredictions
        winRateSum += s.winRate
        errorSum += s.avgError
        count++
      }
    })

    return {
      totalPredictions: total,
      avgWinRate: count > 0 ? winRateSum / count : 0,
      avgError: count > 0 ? errorSum / count : 0,
    }
  }

  /**
   * Get engine state
   */
  getState(): OracleState {
    return this.state
  }

  /**
   * Check if engine is running
   */
  isRunning(): boolean {
    return this.state.isRunning
  }

  /**
   * Get price cache for visualization
   */
  getPriceHistory(coin: string): PricePoint[] {
    return this.priceCache.get(coin) || []
  }

  /**
   * Get SM flow history for visualization
   */
  getSMFlowHistory(coin: string): { timestamp: number; flow: number }[] {
    return this.smFlowCache.get(coin) || []
  }

  /**
   * Add a coin to track
   */
  addCoin(coin: string): void {
    if (!this.state.trackedCoins.includes(coin)) {
      this.state.trackedCoins.push(coin)
      console.log(`[Oracle] Added ${coin} to tracking`)
    }
  }

  /**
   * Remove a coin from tracking
   */
  removeCoin(coin: string): void {
    const index = this.state.trackedCoins.indexOf(coin)
    if (index !== -1) {
      this.state.trackedCoins.splice(index, 1)
      this.state.signals.delete(coin)
      this.state.predictions.delete(coin)
      this.priceCache.delete(coin)
      this.smFlowCache.delete(coin)
      console.log(`[Oracle] Removed ${coin} from tracking`)
    }
  }
}

// ============================================================
// SINGLETON EXPORT
// ============================================================

export const oracleEngine = new OraclePredictionEngine()
