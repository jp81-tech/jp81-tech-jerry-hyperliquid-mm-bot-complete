import * as fs from 'fs'
import axios from 'axios'
import type { BreakoutConfig } from './config.js'
import type { ActivePosition, BreakoutState, DonchianChannel } from './types.js'
import { BreakoutDataEngine } from './BreakoutDataEngine.js'
import { BreakoutSignalEngine } from './BreakoutSignalEngine.js'
import { BreakoutRiskEngine } from './BreakoutRiskEngine.js'
import { BreakoutOrderEngine } from './BreakoutOrderEngine.js'

const STATE_FILE = '/tmp/breakout_bot_state.json'

export class BreakoutBot {
  private config: BreakoutConfig
  private data: BreakoutDataEngine
  private signals: BreakoutSignalEngine
  private risk: BreakoutRiskEngine
  private orders: BreakoutOrderEngine
  private state: BreakoutState
  private tickCount = 0
  private walletAddress = ''

  constructor(config: BreakoutConfig) {
    this.config = config
    this.data = new BreakoutDataEngine(config)
    this.signals = new BreakoutSignalEngine(config)
    this.risk = new BreakoutRiskEngine(config)
    this.orders = new BreakoutOrderEngine(config)
    this.state = this.loadState()
  }

  async start() {
    console.log('═══════════════════════════════════════════')
    console.log('  DONCHIAN BREAKOUT BOT')
    console.log(`  Mode: ${this.config.dryRun ? '🧪 DRY RUN' : '💰 LIVE'}`)
    console.log(`  Tokens: ${this.config.tokens.join(', ')}`)
    console.log(`  Donchian: ${this.config.donchianPeriod} | EMA: ${this.config.emaPeriod}`)
    console.log(`  Risk: ${this.config.riskPct}% per trade | Max pos: ${this.config.maxPositions}`)
    console.log(`  TP: ${this.config.tpRMultiplier}R | Vol confirm: ${this.config.volumeConfirmMult}x`)
    console.log(`  Tick: ${this.config.tickSec}s | Leverage: ${this.config.defaultLeverage}x`)
    console.log('═══════════════════════════════════════════')

    // Resolve wallet address from private key (dry-run uses placeholder)
    if (this.config.privateKey) {
      try {
        const { ethers } = await import('ethers')
        const wallet = new ethers.Wallet(this.config.privateKey)
        this.walletAddress = wallet.address
        console.log(`Wallet: ${this.walletAddress}`)
      } catch {
        console.error('Invalid BREAKOUT_PRIVATE_KEY')
        if (!this.config.dryRun) process.exit(1)
      }
    }

    if (!this.walletAddress && !this.config.dryRun) {
      console.error('BREAKOUT_PRIVATE_KEY required for --live mode')
      process.exit(1)
    }

    // Initialize order engine (loads asset metadata, sets leverage)
    await this.orders.init()

    // Fetch initial equity
    if (this.walletAddress) {
      const equity = await this.data.fetchAccountValue(this.walletAddress)
      if (equity > 0) {
        this.risk.setInitialEquity(equity)
        console.log(`Equity: $${equity.toFixed(2)}`)
      }
    }

    console.log(`\nStarting tick loop (${this.config.tickSec}s interval)...\n`)

    // Initial tick
    await this.tick()

    // Loop
    setInterval(() => this.tick().catch(e => {
      console.error(`[TICK ERROR] ${e.message}`)
    }), this.config.tickSec * 1000)
  }

  private async tick() {
    this.tickCount++
    const isStatusTick = this.tickCount % 20 === 1  // every ~5 min at 15s ticks

    // 1. Fetch mid prices
    const mids = await this.data.fetchMidPrices()
    if (Object.keys(mids).length === 0) {
      console.warn('[TICK] Failed to fetch mid prices, skipping')
      return
    }

    // 2. Fetch equity for risk checks
    let equity = 0
    if (this.walletAddress) {
      equity = await this.data.fetchAccountValue(this.walletAddress)
      this.risk.setInitialEquity(equity)
    } else {
      equity = 1000  // dry-run placeholder
    }

    // 3. Check existing positions for SL/TP
    await this.checkPositions(mids)

    // 4. Scan each token for breakout signals
    for (const token of this.config.tokens) {
      const mid = mids[token]
      if (!mid) {
        if (isStatusTick) console.log(`[SCAN] ${token}: no price data`)
        continue
      }

      // Fetch candles
      const candles1m = await this.data.fetchCandles(token, '1m', this.config.donchianPeriod + 5)
      const candles5m = await this.data.fetchCandles(token, '5m', this.config.emaPeriod + 10)

      if (candles1m.length < this.config.donchianPeriod + 2) {
        if (isStatusTick) console.log(`[SCAN] ${token}: insufficient 1m candles (${candles1m.length})`)
        continue
      }

      // Compute indicators
      const donchian = this.data.computeDonchian(candles1m, this.config.donchianPeriod)
      const ema200 = this.data.computeEMA(candles5m, this.config.emaPeriod)

      if (!donchian || !ema200) {
        if (isStatusTick) console.log(`[SCAN] ${token}: insufficient data for indicators`)
        continue
      }

      // Update trailing SL for existing position
      if (this.state.positions[token]) {
        this.updateTrailing(token, donchian, mid)
      }

      // Status log
      if (isStatusTick) {
        const trendDir = mid > ema200 ? 'BULL' : 'BEAR'
        const distUpper = ((donchian.upper - mid) / mid * 100).toFixed(3)
        const distLower = ((mid - donchian.lower) / mid * 100).toFixed(3)
        const pos = this.state.positions[token]
        const posStr = pos ? `${pos.side} $${pos.valueUsd.toFixed(0)}` : 'FLAT'
        console.log(
          `📊 [STATUS] ${token}: $${mid.toPrecision(6)} | ` +
          `DC[${donchian.lower.toPrecision(5)}-${donchian.upper.toPrecision(5)}] ` +
          `↑${distUpper}% ↓${distLower}% | ` +
          `EMA200=$${ema200.toPrecision(6)} ${trendDir} | ${posStr}`
        )
      }

      // Check for breakout signal (only if no position in this token)
      if (!this.state.positions[token]) {
        const signal = this.signals.checkBreakout(token, candles1m, donchian, ema200, mid)
        if (signal) {
          const sizing = this.risk.calculateSize(signal, equity, this.state)

          if (sizing.allowed) {
            console.log(
              `\n🔔 [BREAKOUT] ${signal.side} ${token} @ $${mid.toPrecision(6)} ` +
              `| SL $${signal.slPrice.toPrecision(6)} | TP $${signal.tpPrice.toPrecision(6)} ` +
              `| R=$${signal.riskR.toPrecision(4)} (${this.config.tpRMultiplier}R) ` +
              `| Vol ${signal.volumeRatio.toFixed(1)}x | Size $${sizing.sizeUsd.toFixed(0)} ` +
              `| ${sizing.reason}`
            )

            const ok = await this.orders.placeEntry(
              token, signal.side, sizing.sizeUsd, mid, sizing.leverage
            )

            if (ok) {
              this.state.positions[token] = {
                token,
                side: signal.side,
                entryPrice: mid,
                size: signal.side === 'LONG' ? sizing.sizeUsd / mid : -(sizing.sizeUsd / mid),
                valueUsd: sizing.sizeUsd,
                slPrice: signal.slPrice,
                tpPrice: signal.tpPrice,
                entryTime: Date.now(),
                peakPnlPct: 0,
                signal,
              }
              this.state.tradesTotal++
              this.saveState()
              await this.sendDiscord(
                `🔔 **BREAKOUT ${signal.side}** ${token}`,
                `Entry: $${mid.toPrecision(6)}\nSL: $${signal.slPrice.toPrecision(6)}\n` +
                `TP: $${signal.tpPrice.toPrecision(6)}\nSize: $${sizing.sizeUsd.toFixed(0)}\n` +
                `R = $${signal.riskR.toPrecision(4)} | Vol ${signal.volumeRatio.toFixed(1)}x`,
                signal.side === 'LONG' ? 0x00ff00 : 0xff0000,
              )
            }
          } else {
            console.log(
              `⏭️ [BLOCKED] ${signal.side} ${token} — ${sizing.reason}`
            )
          }
        }
      }
    }

    // 5. Periodic summary
    if (isStatusTick) {
      const posCount = Object.keys(this.state.positions).length
      this.risk.checkDailyReset(this.state)
      console.log(
        `\n📈 [SUMMARY] tick=${this.tickCount} | positions=${posCount}/${this.config.maxPositions} ` +
        `| dailyPnL=$${this.state.dailyPnl.toFixed(2)} | totalPnL=$${this.state.totalPnl.toFixed(2)} ` +
        `| trades=${this.state.tradesTotal} (W${this.state.tradesWon}) ` +
        `| equity=$${equity.toFixed(0)}\n`
      )
    }
  }

  private async checkPositions(mids: Record<string, number>) {
    for (const [token, pos] of Object.entries(this.state.positions)) {
      const mid = mids[token]
      if (!mid) continue

      const exitReason = this.risk.checkExit(mid, pos)
      if (!exitReason) continue

      // Calculate PnL
      const pnlPct = pos.side === 'LONG'
        ? (mid - pos.entryPrice) / pos.entryPrice * 100
        : (pos.entryPrice - mid) / pos.entryPrice * 100
      const pnlUsd = pos.valueUsd * pnlPct / 100
      const holdMin = ((Date.now() - pos.entryTime) / 60_000).toFixed(1)

      const emoji = exitReason === 'TP' ? '🎯' : '🛑'
      console.log(
        `\n${emoji} [${exitReason}] ${token} ${pos.side} | PnL: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% ` +
        `($${pnlUsd >= 0 ? '+' : ''}${pnlUsd.toFixed(2)}) | held ${holdMin}min ` +
        `| entry $${pos.entryPrice.toPrecision(6)} → exit $${mid.toPrecision(6)}`
      )

      await this.orders.placeExit(token, pos.side, pos.valueUsd, mid, exitReason)

      // Update state
      this.state.dailyPnl += pnlUsd
      this.state.totalPnl += pnlUsd
      if (pnlUsd > 0) this.state.tradesWon++
      delete this.state.positions[token]
      this.saveState()

      const color = exitReason === 'TP' ? 0x00ff00 : 0xff4444
      await this.sendDiscord(
        `${emoji} **${exitReason}** ${token} ${pos.side}`,
        `PnL: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% ($${pnlUsd >= 0 ? '+' : ''}${pnlUsd.toFixed(2)})\n` +
        `Entry: $${pos.entryPrice.toPrecision(6)}\nExit: $${mid.toPrecision(6)}\n` +
        `Held: ${holdMin} min`,
        color,
      )
    }
  }

  private updateTrailing(token: string, donchian: DonchianChannel, midPrice: number) {
    const pos = this.state.positions[token]
    if (!pos) return

    const oldSL = pos.slPrice
    const newSL = this.risk.updateTrailingSL(pos.side, oldSL, donchian.upper, donchian.lower)

    if (newSL !== oldSL) {
      pos.slPrice = newSL
      const dir = pos.side === 'LONG' ? '↑' : '↓'
      console.log(
        `🔄 [TRAIL] ${token}: SL ${dir} $${oldSL.toPrecision(6)} → $${newSL.toPrecision(6)}`
      )
    }

    // Track peak PnL
    const pnlPct = pos.side === 'LONG'
      ? (midPrice - pos.entryPrice) / pos.entryPrice * 100
      : (pos.entryPrice - midPrice) / pos.entryPrice * 100
    if (pnlPct > pos.peakPnlPct) {
      pos.peakPnlPct = pnlPct
    }
  }

  // ── State persistence ──────────────────────────────────────

  private loadState(): BreakoutState {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
        console.log(`[STATE] Loaded from ${STATE_FILE} (${Object.keys(data.positions || {}).length} positions)`)
        return data
      }
    } catch {
      console.warn('[STATE] Failed to load, starting fresh')
    }
    return {
      positions: {},
      dailyPnl: 0,
      dailyPnlResetTime: Date.now(),
      totalPnl: 0,
      tradesTotal: 0,
      tradesWon: 0,
      startTime: Date.now(),
    }
  }

  private saveState() {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2))
    } catch {
      // non-critical
    }
  }

  // ── Discord ────────────────────────────────────────────────

  private async sendDiscord(title: string, description: string, color: number) {
    if (!this.config.discordWebhookUrl) return
    try {
      await axios.post(this.config.discordWebhookUrl, {
        embeds: [{
          title,
          description,
          color,
          footer: { text: `Breakout Bot | ${this.config.dryRun ? 'DRY RUN' : 'LIVE'}` },
          timestamp: new Date().toISOString(),
        }]
      }, { timeout: 5000 })
    } catch {
      // silent
    }
  }
}
