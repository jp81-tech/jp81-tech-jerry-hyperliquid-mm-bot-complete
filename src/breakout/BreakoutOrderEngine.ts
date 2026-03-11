import type { BreakoutConfig } from './config.js'

/**
 * Phase 1: Dry-run only — logs orders without executing.
 * Phase 2 will add real order execution via @nktkas/hyperliquid SDK.
 */
export class BreakoutOrderEngine {
  private config: BreakoutConfig

  constructor(config: BreakoutConfig) {
    this.config = config
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

    // Phase 2: real execution
    console.log(`💰 [LIVE] ENTRY ${side} ${token} | $${sizeUsd.toFixed(0)} — NOT IMPLEMENTED YET`)
    return false
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

    console.log(`💰 [LIVE] EXIT ${reason} ${token} — NOT IMPLEMENTED YET`)
    return false
  }
}
