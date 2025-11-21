/**
 * Comprehensive Daily Report to Slack
 *
 * Combines:
 * - Risk metrics (leverage, concentration, free equity)
 * - Nansen signal accuracy stats
 * - Bot performance (PnL, positions, health)
 * - Recommendations
 */

import fs from 'fs'
import path from 'path'

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK

interface RiskMetrics {
  timestamp: string
  equity: number
  totalNotional: number
  accountLeverage: number
  maxPair: string | null
  maxPairFraction: number
  freeEquityRatio: number
  riskScore: number
  mode: 'GREEN' | 'YELLOW' | 'RED'
  nansenQuality?: {
    strongWinRate4h: number
    strongWinRate24h: number
    avgReturn24h: number
  }
}

interface SignalStats {
  period: string
  totalSignals: number
  strongSignals: number
  softSignals: number
  strongWinRate4h: number
  strongWinRate24h: number
  strongAvgReturn4h: number
  strongAvgReturn24h: number
  topAccuratePairs: Array<{ pair: string; winRate24h: number }>
}

/**
 * Load latest risk metrics
 */
function loadRiskMetrics(): RiskMetrics | null {
  try {
    const riskPath = path.join(process.cwd(), 'runtime', 'risk_metrics.json')
    if (!fs.existsSync(riskPath)) return null

    const history: RiskMetrics[] = JSON.parse(fs.readFileSync(riskPath, 'utf8'))
    return history[history.length - 1] || null
  } catch (err) {
    return null
  }
}

/**
 * Load Nansen signal stats
 */
function loadSignalStats(): SignalStats | null {
  try {
    const statsPath = path.join(process.cwd(), 'runtime', 'nansen_signal_stats.json')
    if (!fs.existsSync(statsPath)) return null

    return JSON.parse(fs.readFileSync(statsPath, 'utf8'))
  } catch (err) {
    return null
  }
}

/**
 * Build comprehensive Slack message
 */
function buildSlackMessage(risk: RiskMetrics | null, nansenStats: SignalStats | null): string {
  const now = new Date().toISOString().split('T')[0]

  let message = `📊 *Daily MM Bot Report - ${now}*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`

  // Risk Section
  if (risk) {
    const modeEmoji = risk.mode === 'GREEN' ? '🟢' : risk.mode === 'YELLOW' ? '🟡' : '🔴'

    message += `\n${modeEmoji} *Risk Status: ${risk.mode}*\n`
    message += `• Equity: $${risk.equity.toFixed(2)}\n`
    message += `• Leverage: ${risk.accountLeverage.toFixed(2)}x\n`
    message += `• Max Pair: ${risk.maxPair || 'none'} (${(risk.maxPairFraction * 100).toFixed(1)}%)\n`
    message += `• Free Equity: ${(risk.freeEquityRatio * 100).toFixed(1)}%\n`
    message += `• Risk Score: ${risk.riskScore.toFixed(2)}\n`

    if (risk.mode === 'YELLOW') {
      message += `\n⚠️  *Action Required*: Reduce new position sizes\n`
    } else if (risk.mode === 'RED') {
      message += `\n🚨 *URGENT*: Stop new positions, reduce leverage\n`
    }
  } else {
    message += `\n⚠️  Risk metrics not available\n`
  }

  // Nansen Signal Accuracy Section
  if (nansenStats) {
    message += `\n\n🧭 *Nansen Signal Accuracy*\n`
    message += `• Total Signals: ${nansenStats.totalSignals} (${nansenStats.strongSignals} strong, ${nansenStats.softSignals} soft)\n`
    message += `\n*Strong Signals:*\n`

    const strong4hEmoji =
      nansenStats.strongWinRate4h >= 70 ? '🔥' : nansenStats.strongWinRate4h >= 55 ? '✅' : '⚠️'
    const strong24hEmoji =
      nansenStats.strongWinRate24h >= 65
        ? '🔥'
        : nansenStats.strongWinRate24h >= 55
          ? '✅'
          : '⚠️'

    message += `${strong4hEmoji} 4h Win Rate: *${nansenStats.strongWinRate4h.toFixed(1)}%*\n`
    message += `${strong24hEmoji} 24h Win Rate: *${nansenStats.strongWinRate24h.toFixed(1)}%*\n`
    message += `📈 Avg 4h Return: ${nansenStats.strongAvgReturn4h > 0 ? '+' : ''}${nansenStats.strongAvgReturn4h.toFixed(2)}%\n`
    message += `📈 Avg 24h Return: ${nansenStats.strongAvgReturn24h > 0 ? '+' : ''}${nansenStats.strongAvgReturn24h.toFixed(2)}%\n`

    if (nansenStats.topAccuratePairs.length > 0) {
      message += `\n*Top Accurate Pairs (24h):*\n`
      nansenStats.topAccuratePairs.slice(0, 5).forEach((p, i) => {
        message += `${i + 1}. ${p.pair}: ${p.winRate24h.toFixed(1)}%\n`
      })
    }

    // Quality assessment
    if (nansenStats.strongWinRate4h < 55) {
      message += `\n⚠️  *Warning*: Nansen quality below threshold (${nansenStats.strongWinRate4h.toFixed(1)}% < 55%)\n`
      message += `💡 Recommendation: Reduce Nansen-based exposure\n`
    } else if (nansenStats.strongWinRate4h >= 70) {
      message += `\n🔥 *Excellent*: Strong Nansen performance\n`
      message += `💡 Recommendation: Can increase exposure on strong signals\n`
    }
  } else {
    message += `\n\n🧭 *Nansen Signal Accuracy*\n`
    message += `⚠️  Not enough data yet (need 1h+ for first results)\n`
  }

  // Combined Recommendation
  message += `\n\n💡 *Overall Recommendation:*\n`

  if (risk && nansenStats) {
    if (risk.mode === 'RED') {
      message += `🚨 DEFENSIVE MODE\n`
      message += `• Stop opening new positions\n`
      message += `• Close weakest positions\n`
      message += `• Target leverage < ${risk.accountLeverage.toFixed(1)}x\n`
    } else if (risk.mode === 'YELLOW') {
      message += `⚠️  CAUTION MODE\n`
      message += `• Reduce new position sizes by 30-50%\n`
      message += `• Focus on high-conviction (Nansen strong) only\n`
    } else if (nansenStats.strongWinRate4h >= 70) {
      message += `✅ NORMAL/AGGRESSIVE MODE\n`
      message += `• Normal operations\n`
      message += `• Strong Nansen quality - can increase exposure\n`
    } else {
      message += `✅ NORMAL MODE\n`
      message += `• Continue normal operations\n`
      message += `• Monitor Nansen quality\n`
    }
  } else if (risk) {
    if (risk.mode !== 'GREEN') {
      message += `⚠️  Risk controls active - reduce exposure\n`
    } else {
      message += `✅ Normal operations\n`
    }
  }

  message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
  message += `_Last updated: ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC_`

  return message
}

/**
 * Send report to Slack
 */
async function sendSlackReport() {
  if (!SLACK_WEBHOOK) {
    console.error('❌ SLACK_WEBHOOK not configured')
    process.exit(1)
  }

  const risk = loadRiskMetrics()
  const nansenStats = loadSignalStats()

  const message = buildSlackMessage(risk, nansenStats)

  console.log('📤 Sending comprehensive report to Slack...\n')
  console.log(message)

  try {
    const response = await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    })

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status} ${response.statusText}`)
    }

    console.log('\n✅ Report sent successfully')
  } catch (err) {
    console.error('❌ Failed to send Slack report:', err)
    process.exit(1)
  }
}

sendSlackReport().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
