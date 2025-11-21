/**
 * Risk Monitor for Hyperliquid MM Bot (with Cooldown & Persistent RED Alert)
 *
 * Monitors:
 * - Account leverage (total notional / equity)
 * - Per-pair concentration (% of equity)
 * - Free equity ratio (margin buffer)
 * - Nansen signal quality correlation
 *
 * Safety Features:
 * - 15-min cooldown between auto-close calls (configurable)
 * - Persistent RED alert if mode stays RED > 20 min
 * - Full Slack reporting with risk snapshot
 */

import { config } from 'dotenv'
config()

import * as hl from '@nktkas/hyperliquid'
import { ethers } from 'ethers'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

// Environment configuration
const MAX_ACCOUNT_LEVERAGE = Number(process.env.MAX_ACCOUNT_LEVERAGE || '2.0')
const MAX_PAIR_EQUITY_FRACTION = Number(process.env.MAX_PAIR_EQUITY_FRACTION || '0.25')
const MIN_FREE_EQUITY_RATIO = Number(process.env.MIN_FREE_EQUITY_RATIO || '0.30')
const AUTO_CLOSE_COOLDOWN_MINUTES = Number(process.env.AUTO_CLOSE_COOLDOWN_MINUTES || '15')
const PERSISTENT_RED_ALERT_MINUTES = Number(process.env.PERSISTENT_RED_ALERT_MINUTES || '20')

// Load wallet from .env
const PRIVATE_KEY = process.env.PRIVATE_KEY
const WALLET_ADDRESS = process.env.WALLET_ADDRESS
if (!PRIVATE_KEY || !WALLET_ADDRESS) {
  console.error('❌ PRIVATE_KEY and WALLET_ADDRESS required in .env')
  process.exit(1)
}

interface RiskMetrics {
  timestamp: string
  equity: number
  totalNotional: number
  totalMarginUsed: number
  freeEquity: number
  freeEquityRatio: number
  accountLeverage: number
  perPairNotional: Record<string, number>
  maxPair: string | null
  maxPairFraction: number
  riskScore: number
  mode: 'GREEN' | 'YELLOW' | 'RED'
  nansenQuality?: {
    strongWinRate4h: number
    strongWinRate24h: number
    avgReturn24h: number
  }
}

/**
 * Load Nansen signal stats if available
 */
function loadNansenQuality(): RiskMetrics['nansenQuality'] | undefined {
  try {
    const statsPath = path.join(process.cwd(), 'runtime', 'nansen_signal_stats.json')
    if (!fs.existsSync(statsPath)) return undefined

    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'))

    return {
      strongWinRate4h: stats.strongWinRate4h || 0,
      strongWinRate24h: stats.strongWinRate24h || 0,
      avgReturn24h: stats.strongAvgReturn24h || 0,
    }
  } catch (err) {
    return undefined
  }
}

/**
 * Compute risk metrics from user state
 */
async function computeRiskMetrics(): Promise<RiskMetrics> {
  const wallet = new ethers.Wallet(PRIVATE_KEY)
  const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })

  // Get user state
  const userState = await infoClient.clearinghouseState({ user: wallet.address })

  const equity = parseFloat(userState.marginSummary.accountValue)
  const totalMarginUsed = parseFloat(userState.marginSummary.totalMarginUsed)
  const totalNotional = parseFloat(userState.marginSummary.totalNtlPos)

  const accountLeverage = equity > 0 ? totalNotional / equity : 0
  const freeEquity = equity - totalMarginUsed
  const freeEquityRatio = equity > 0 ? freeEquity / equity : 0

  // Per-pair notional
  const perPairNotional: Record<string, number> = {}
  for (const assetPos of userState.assetPositions || []) {
    const pos = assetPos.position
    if (!pos) continue

    const notional = Math.abs(parseFloat(pos.positionValue || '0'))
    if (notional < 0.01) continue

    perPairNotional[pos.coin] = notional
  }

  // Find max concentration
  let maxPairFraction = 0
  let maxPair: string | null = null
  for (const [coin, ntl] of Object.entries(perPairNotional)) {
    const frac = equity > 0 ? ntl / equity : 0
    if (frac > maxPairFraction) {
      maxPairFraction = frac
      maxPair = coin
    }
  }

  // Calculate risk score
  const leverageComponent =
    MAX_ACCOUNT_LEVERAGE > 0 ? accountLeverage / MAX_ACCOUNT_LEVERAGE : 0
  const pairComponent =
    MAX_PAIR_EQUITY_FRACTION > 0 ? maxPairFraction / MAX_PAIR_EQUITY_FRACTION : 0
  const freeEquityNorm =
    MIN_FREE_EQUITY_RATIO > 0 ? freeEquityRatio / MIN_FREE_EQUITY_RATIO : 1
  const freeEquityComponent = freeEquityNorm >= 1 ? 0 : 1 - freeEquityNorm

  let riskScore = 0.5 * leverageComponent + 0.3 * pairComponent + 0.2 * freeEquityComponent

  // Adjust for Nansen quality
  const nansenQuality = loadNansenQuality()
  if (nansenQuality) {
    // If Nansen quality is poor, increase risk score
    if (nansenQuality.strongWinRate4h < 55) {
      riskScore += 0.2 // Penalty for poor Nansen quality
    }
  }

  const mode: RiskMetrics['mode'] =
    riskScore < 0.7 ? 'GREEN' : riskScore < 1.0 ? 'YELLOW' : 'RED'

  return {
    timestamp: new Date().toISOString(),
    equity,
    totalNotional,
    totalMarginUsed,
    freeEquity,
    freeEquityRatio,
    accountLeverage,
    perPairNotional,
    maxPair,
    maxPairFraction,
    riskScore,
    mode,
    nansenQuality,
  }
}

/**
 * Get recommended actions based on risk level
 */
function getRecommendedActions(metrics: RiskMetrics): string[] {
  const actions: string[] = []

  if (metrics.mode === 'RED') {
    actions.push('🚨 STOP opening new positions')
    actions.push('🔴 Close weakest positions (lowest conviction)')

    if (metrics.accountLeverage > MAX_ACCOUNT_LEVERAGE) {
      actions.push(
        `⚠️  Reduce leverage: ${metrics.accountLeverage.toFixed(2)}x → ${MAX_ACCOUNT_LEVERAGE}x`
      )
    }

    if (metrics.maxPairFraction > MAX_PAIR_EQUITY_FRACTION && metrics.maxPair) {
      actions.push(
        `⚠️  Reduce ${metrics.maxPair} concentration: ${(metrics.maxPairFraction * 100).toFixed(1)}% → ${(MAX_PAIR_EQUITY_FRACTION * 100).toFixed(1)}%`
      )
    }
  } else if (metrics.mode === 'YELLOW') {
    actions.push('⚠️  Caution: reduce new position sizes')

    if (metrics.freeEquityRatio < MIN_FREE_EQUITY_RATIO) {
      actions.push(
        `💰 Free equity low: ${(metrics.freeEquityRatio * 100).toFixed(1)}% (target: ${(MIN_FREE_EQUITY_RATIO * 100).toFixed(1)}%)`
      )
    }
  } else {
    actions.push('✅ Normal operations')
  }

  // Nansen-specific warnings
  if (metrics.nansenQuality) {
    if (metrics.nansenQuality.strongWinRate4h < 55) {
      actions.push(
        `📊 Nansen quality poor: ${metrics.nansenQuality.strongWinRate4h.toFixed(1)}% 4h win rate`
      )
      actions.push('💡 Consider reducing Nansen-based exposure')
    }
  }

  return actions
}

/**
 * Save risk metrics to file
 */
function saveRiskMetrics(metrics: RiskMetrics) {
  const riskPath = path.join(process.cwd(), 'runtime', 'risk_metrics.json')

  // Load history (keep last 100 entries)
  let history: RiskMetrics[] = []
  try {
    if (fs.existsSync(riskPath)) {
      history = JSON.parse(fs.readFileSync(riskPath, 'utf8'))
    }
  } catch (err) {
    // Ignore
  }

  history.push(metrics)
  if (history.length > 100) {
    history = history.slice(-100)
  }

  fs.writeFileSync(riskPath, JSON.stringify(history, null, 2))
}

/**
 * Print risk report
 */
function printRiskReport(metrics: RiskMetrics) {
  const modeEmoji = {
    GREEN: '🟢',
    YELLOW: '🟡',
    RED: '🔴',
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`${modeEmoji[metrics.mode]} Risk Monitor - ${metrics.mode} MODE`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Timestamp: ${metrics.timestamp}`)
  console.log(``)
  console.log(`💰 Account Metrics:`)
  console.log(
    `   Equity: $${metrics.equity.toFixed(2)} | Margin Used: $${metrics.totalMarginUsed.toFixed(2)}`
  )
  console.log(
    `   Free Equity: $${metrics.freeEquity.toFixed(2)} (${(metrics.freeEquityRatio * 100).toFixed(1)}%)`
  )
  console.log(``)
  console.log(`📊 Risk Metrics:`)
  console.log(
    `   Account Leverage: ${metrics.accountLeverage.toFixed(2)}x / ${MAX_ACCOUNT_LEVERAGE}x`
  )
  console.log(
    `   Max Pair: ${metrics.maxPair || 'none'} (${(metrics.maxPairFraction * 100).toFixed(1)}% / ${(MAX_PAIR_EQUITY_FRACTION * 100).toFixed(1)}%)`
  )
  console.log(`   Risk Score: ${metrics.riskScore.toFixed(2)}`)

  if (metrics.nansenQuality) {
    console.log(``)
    console.log(`🧭 Nansen Quality:`)
    console.log(
      `   4h Win Rate: ${metrics.nansenQuality.strongWinRate4h.toFixed(1)}%`
    )
    console.log(
      `   24h Win Rate: ${metrics.nansenQuality.strongWinRate24h.toFixed(1)}%`
    )
    console.log(
      `   Avg 24h Return: ${metrics.nansenQuality.avgReturn24h > 0 ? '+' : ''}${metrics.nansenQuality.avgReturn24h.toFixed(2)}%`
    )
  }

  console.log(``)
  console.log(`🎯 Recommended Actions:`)
  const actions = getRecommendedActions(metrics)
  actions.forEach((action) => console.log(`   ${action}`))
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

/**
 * Send risk alert to Slack if needed
 */
async function sendSlackAlert(metrics: RiskMetrics) {
  const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK
  if (!SLACK_WEBHOOK) return

  // Only send on YELLOW or RED
  if (metrics.mode === 'GREEN') return

  const modeEmoji = metrics.mode === 'RED' ? '🔴' : '🟡'
  const actions = getRecommendedActions(metrics)

  const message = `${modeEmoji} *Risk Alert - ${metrics.mode} MODE*

*Account:*
• Equity: $${metrics.equity.toFixed(2)}
• Leverage: ${metrics.accountLeverage.toFixed(2)}x / ${MAX_ACCOUNT_LEVERAGE}x
• Max Pair: ${metrics.maxPair || 'none'} (${(metrics.maxPairFraction * 100).toFixed(1)}%)
• Free Equity: ${(metrics.freeEquityRatio * 100).toFixed(1)}%
• Risk Score: ${metrics.riskScore.toFixed(2)}

*Actions:*
${actions.map((a) => `• ${a}`).join('\n')}

_${metrics.timestamp}_`

  try {
    await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    })
  } catch (err) {
    console.error('Failed to send Slack alert:', err)
  }
}

/**
 * Check and track persistent RED mode
 */
function checkPersistentRed(metrics: RiskMetrics): { isPersistent: boolean; minutesInRed: number } {
  const persistentRedPath = path.join(process.cwd(), 'runtime', 'persistent_red.json')

  if (metrics.mode !== 'RED') {
    // Clear persistent RED tracking if we're no longer RED
    if (fs.existsSync(persistentRedPath)) {
      fs.unlinkSync(persistentRedPath)
    }
    return { isPersistent: false, minutesInRed: 0 }
  }

  // We're in RED mode - check how long
  const now = Date.now()
  let firstRedTimestamp = now

  if (fs.existsSync(persistentRedPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(persistentRedPath, 'utf8'))
      firstRedTimestamp = data.firstRedTimestamp || now
    } catch (err) {
      console.warn('⚠️  Failed to read persistent_red.json:', err)
    }
  } else {
    // First time entering RED - record it
    fs.writeFileSync(
      persistentRedPath,
      JSON.stringify({
        firstRedTimestamp: now,
        firstRedMetrics: {
          riskScore: metrics.riskScore,
          leverage: metrics.accountLeverage,
          maxPair: metrics.maxPair,
        },
      }, null, 2)
    )
  }

  const minutesInRed = (now - firstRedTimestamp) / 60000
  const isPersistent = minutesInRed >= PERSISTENT_RED_ALERT_MINUTES

  return { isPersistent, minutesInRed }
}

/**
 * Send persistent RED alert to Slack
 */
async function sendPersistentRedAlert(metrics: RiskMetrics, minutesInRed: number) {
  const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK
  if (!SLACK_WEBHOOK) return

  const message = `🚨🚨🚨 *PERSISTENT RED MODE - MANUAL INTERVENTION REQUIRED* 🚨🚨🚨

⏰ *Risk has been RED for ${Math.floor(minutesInRed)} minutes*

*Current Risk Snapshot:*
• Risk Score: ${metrics.riskScore.toFixed(2)} (threshold: 1.0)
• Account Leverage: ${metrics.accountLeverage.toFixed(2)}x / ${MAX_ACCOUNT_LEVERAGE}x
• Max Pair: ${metrics.maxPair || 'none'} (${(metrics.maxPairFraction * 100).toFixed(1)}% of equity)
• Free Equity: ${(metrics.freeEquityRatio * 100).toFixed(1)}%
• Total Equity: $${metrics.equity.toFixed(2)}

*What's Happening:*
• Auto-closer has been triggered (if cooldown allows)
• Risk remains elevated despite automated actions
• System is preventing new position opens

*Action Required:*
👉 Review open positions manually
👉 Consider closing largest / weakest positions
👉 Check if market conditions require position adjustments
👉 Verify auto_closer is functioning correctly

_Alert threshold: ${PERSISTENT_RED_ALERT_MINUTES} minutes_
_Current time: ${metrics.timestamp}_`

  try {
    await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    })
    console.log('📨 Persistent RED alert sent to Slack')
  } catch (err) {
    console.error('❌ Failed to send persistent RED alert:', err)
  }
}

/**
 * Trigger auto-closer if in RED mode and enabled (with cooldown protection)
 */
async function triggerAutoCloseIfNeeded(metrics: RiskMetrics) {
  const ENABLE_AUTO_CLOSE = process.env.ENABLE_AUTO_CLOSE_ON_RED === 'true'

  if (metrics.mode !== 'RED') return
  if (!ENABLE_AUTO_CLOSE) {
    console.log('⚠️  RED mode detected but ENABLE_AUTO_CLOSE_ON_RED is not enabled')
    return
  }

  // Check cooldown
  const cooldownPath = path.join(process.cwd(), 'runtime', 'last_auto_close.json')
  const now = Date.now()
  let lastClose = 0

  if (fs.existsSync(cooldownPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(cooldownPath, 'utf8'))
      if (data && typeof data.last_ts === 'number') {
        lastClose = data.last_ts
      }
    } catch (err) {
      console.warn('⚠️  Failed to read last_auto_close.json:', err)
    }
  }

  const minutesSince = lastClose ? (now - lastClose) / 60000 : Number.POSITIVE_INFINITY

  if (minutesSince < AUTO_CLOSE_COOLDOWN_MINUTES) {
    console.log(
      `🕒 Auto-close cooldown active (${minutesSince.toFixed(1)} min since last, min=${AUTO_CLOSE_COOLDOWN_MINUTES}). Skipping.`
    )
    return
  }

  console.log('🚨 RED MODE - Cooldown passed, triggering auto-closer...')

  try {
    execSync('npx tsx scripts/auto_closer.ts', {
      cwd: process.cwd(),
      stdio: 'inherit',
    })

    // Save timestamp and metrics of auto-close
    fs.writeFileSync(
      cooldownPath,
      JSON.stringify({
        last_ts: now,
        riskScore: metrics.riskScore,
        leverage: metrics.accountLeverage,
        maxPair: metrics.maxPair,
        maxPairFraction: metrics.maxPairFraction,
      }, null, 2)
    )

    console.log('✅ Auto-closer executed successfully, cooldown started')
  } catch (err: any) {
    console.error('❌ Auto-closer failed:', err?.message ?? err)
  }
}

/**
 * Main entry point
 */
async function main() {
  try {
    console.log('🔍 Computing risk metrics...')
    const metrics = await computeRiskMetrics()

    printRiskReport(metrics)
    saveRiskMetrics(metrics)

    // Check for persistent RED condition
    const { isPersistent, minutesInRed } = checkPersistentRed(metrics)
    if (isPersistent) {
      console.warn(`⚠️  PERSISTENT RED: ${Math.floor(minutesInRed)} minutes in RED mode`)
      await sendPersistentRedAlert(metrics, minutesInRed)
    }

    // Trigger auto-close if needed (with cooldown)
    await triggerAutoCloseIfNeeded(metrics)

    // Send regular alert
    await sendSlackAlert(metrics)

    // Exit with status code based on risk level
    process.exit(metrics.mode === 'RED' ? 2 : metrics.mode === 'YELLOW' ? 1 : 0)
  } catch (error: any) {
    console.error('❌ Risk monitor error:', error?.message ?? error)
    process.exit(1)
  }
}

main()
