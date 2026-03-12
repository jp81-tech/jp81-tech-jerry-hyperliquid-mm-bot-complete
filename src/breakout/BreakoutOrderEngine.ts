import * as hl from '@nktkas/hyperliquid'
import axios from 'axios'
import type { BreakoutConfig } from './config.js'

const HL_API_URL = 'https://api.hyperliquid.xyz/info'

/**
 * Breakout order engine — dry-run logging + live execution via @nktkas/hyperliquid SDK.
 */
export class BreakoutOrderEngine {
  private config: BreakoutConfig
  private exchClient: hl.ExchangeClient | null = null
  private assetMap = new Map<string, number>()
  private szDecMap = new Map<string, number>()
  private leverageSet = new Set<string>()

  constructor(config: BreakoutConfig) {
    this.config = config
  }

  /**
   * Initialize SDK client, load asset metadata, set leverage.
   * Must be called before any live order placement.
   */
  async init(): Promise<void> {
    if (this.config.dryRun) return

    if (!this.config.privateKey) {
      throw new Error('BREAKOUT_PRIVATE_KEY required for live mode')
    }

    // Initialize exchange client
    this.exchClient = new hl.ExchangeClient({
      wallet: this.config.privateKey,
      transport: new hl.HttpTransport(),
    })

    // Load asset metadata (indices + szDecimals)
    try {
      const resp = await axios.post(HL_API_URL, { type: 'meta' }, { timeout: 10000 })
      const universe = resp.data?.universe || []
      universe.forEach((market: any, index: number) => {
        this.assetMap.set(market.name, index)
        this.szDecMap.set(market.name, market.szDecimals || 0)
      })
      console.log(`[ORDER_ENGINE] Asset map: ${this.assetMap.size} perps loaded`)
    } catch (e: any) {
      throw new Error(`Failed to load asset metadata: ${e?.message || e}`)
    }

    // Set leverage for configured tokens
    for (const token of this.config.tokens) {
      await this.ensureLeverage(token, this.config.defaultLeverage)
    }
  }

  private async ensureLeverage(token: string, leverage: number): Promise<void> {
    if (!this.exchClient || this.leverageSet.has(token)) return
    const idx = this.assetMap.get(token)
    if (idx === undefined) return
    try {
      await this.exchClient.updateLeverage({ asset: idx, isCross: true, leverage })
      this.leverageSet.add(token)
      console.log(`[ORDER_ENGINE] Set ${token} leverage to ${leverage}x cross`)
    } catch {
      // Some tokens may not support the requested leverage level
    }
  }

  async placeEntry(
    token: string,
    side: 'LONG' | 'SHORT',
    sizeUsd: number,
    midPrice: number,
    leverage: number,
  ): Promise<boolean> {
    const slippageMult = side === 'LONG'
      ? 1 + this.config.iocSlippageBps / 10_000
      : 1 - this.config.iocSlippageBps / 10_000
    const limitPrice = midPrice * slippageMult

    if (this.config.dryRun) {
      console.log(
        `🧪 [DRY] ENTRY ${side} ${token} | $${sizeUsd.toFixed(0)} @ ${limitPrice.toPrecision(6)} ` +
        `| ${leverage}x lev | slippage ${this.config.iocSlippageBps}bps`
      )
      return true
    }

    // Ensure leverage is set
    await this.ensureLeverage(token, leverage)

    const orderSide: 'buy' | 'sell' = side === 'LONG' ? 'buy' : 'sell'
    return this.executeOrder(token, orderSide, sizeUsd, midPrice, limitPrice, false)
  }

  async placeExit(
    token: string,
    side: 'LONG' | 'SHORT',
    sizeUsd: number,
    midPrice: number,
    reason: 'SL' | 'TP' | 'MANUAL',
  ): Promise<boolean> {
    const closeSide = side === 'LONG' ? 'SHORT' : 'LONG'
    const slippageMult = closeSide === 'LONG'
      ? 1 + this.config.iocSlippageBps / 10_000
      : 1 - this.config.iocSlippageBps / 10_000
    const limitPrice = midPrice * slippageMult

    if (this.config.dryRun) {
      console.log(
        `🧪 [DRY] EXIT ${reason} ${token} | close ${side} $${sizeUsd.toFixed(0)} ` +
        `@ ${limitPrice.toPrecision(6)}`
      )
      return true
    }

    const orderSide: 'buy' | 'sell' = closeSide === 'LONG' ? 'buy' : 'sell'
    return this.executeOrder(token, orderSide, sizeUsd, midPrice, limitPrice, true)
  }

  private async executeOrder(
    token: string,
    side: 'buy' | 'sell',
    sizeUsd: number,
    midPrice: number,
    limitPrice: number,
    reduceOnly: boolean,
  ): Promise<boolean> {
    if (!this.exchClient) {
      console.error(`[ORDER_ENGINE] No exchange client — cannot place ${side} ${token}`)
      return false
    }

    const assetIndex = this.assetMap.get(token)
    if (assetIndex === undefined) {
      console.error(`[ORDER_ENGINE] Asset ${token} not found in mapping`)
      return false
    }

    // Calculate size in coins and quantize
    const sizeCoins = sizeUsd / midPrice
    const szDec = this.szDecMap.get(token) || 0
    const step = Math.pow(10, -szDec)
    const quantizedSize = Math.max(step, Math.round(sizeCoins / step) * step)

    // Price quantization (5 significant figures)
    const priceStr = limitPrice.toPrecision(5)

    try {
      const result = await this.exchClient.order({
        orders: [{
          a: assetIndex,
          b: side === 'buy',
          p: priceStr,
          s: quantizedSize.toFixed(szDec),
          r: reduceOnly,
          t: { limit: { tif: 'Ioc' } }
        }],
        grouping: 'na',
      })

      // Check result
      const statuses = (result as any)?.response?.data?.statuses
      if (statuses?.[0]?.error) {
        console.error(`[ORDER_ENGINE] ${side.toUpperCase()} ${token} FAILED: ${statuses[0].error}`)
        return false
      }

      console.log(
        `💰 [LIVE] ${side.toUpperCase()} ${token} ${quantizedSize.toFixed(szDec)} @ ${priceStr} ` +
        `(~$${sizeUsd.toFixed(0)}) ${reduceOnly ? '[REDUCE_ONLY]' : ''}`
      )
      return true
    } catch (e: any) {
      console.error(`[ORDER_ENGINE] ${side.toUpperCase()} ${token} exception: ${e?.message || e}`)
      return false
    }
  }
}
