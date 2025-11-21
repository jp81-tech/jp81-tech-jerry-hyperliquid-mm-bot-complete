/**
 * Send Nansen Signal Accuracy Report to Slack
 *
 * Reads stats from runtime/nansen_signal_stats.json and sends
 * formatted daily report to Slack webhook.
 */

import fs from 'fs'
import path from 'path'

interface SignalStats {
  period: string
  totalSignals: number
  strongSignals: number
  softSignals: number
  strongWinRate1h: number
  strongWinRate4h: number
  strongWinRate12h: number
  strongWinRate24h: number
  softWinRate1h: number
  softWinRate4h: number
  softWinRate12h: number
  softWinRate24h: number
  strongAvgReturn4h: number
  strongAvgReturn24h: number
  softAvgReturn4h: number
  softAvgReturn24h: number
  topAccuratePairs: Array<{ pair: string; winRate24h: number }>
  lastUpdated: string
}

const STATS_FILE = path.join(process.cwd(), 'runtime', 'nansen_signal_stats.json')
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK

async function sendSlackReport() {
  if (!SLACK_WEBHOOK) {
    console.error('❌ SLACK_WEBHOOK not configured')
    process.exit(1)
  }

  // Load stats
  if (!fs.existsSync(STATS_FILE)) {
    console.error('❌ Stats file not found:', STATS_FILE)
    console.error('Run: npx tsx scripts/nansen_signal_tracker.ts update')
    process.exit(1)
  }

  const stats: SignalStats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'))

  // Build Slack message
  const message = buildSlackMessage(stats)

  // Send to Slack
  try {
    const response = await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    })

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status} ${response.statusText}`)
    }

    console.log('✅ Nansen stats report sent to Slack')
  } catch (err) {
    console.error('❌ Failed to send Slack message:', err)
    process.exit(1)
  }
}

function buildSlackMessage(stats: SignalStats): string {
  const strong4hEmoji = stats.strongWinRate4h >= 70 ? '🔥' : stats.strongWinRate4h >= 55 ? '✅' : '⚠️'
  const strong24hEmoji =
    stats.strongWinRate24h >= 65 ? '🔥' : stats.strongWinRate24h >= 55 ? '✅' : '⚠️'
  const soft4hEmoji = stats.softWinRate4h >= 60 ? '✅' : stats.softWinRate4h >= 50 ? '💡' : '⚠️'
  const soft24hEmoji = stats.softWinRate24h >= 60 ? '✅' : stats.softWinRate24h >= 50 ? '💡' : '⚠️'

  const topPairsText =
    stats.topAccuratePairs.length > 0
      ? stats.topAccuratePairs.map((p) => `• ${p.pair} (${p.winRate24h.toFixed(1)}%)`).join('\n')
      : '• No data yet'

  return `📊 *Nansen Signal Accuracy Report*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Period:* ${stats.period}
*Total signals:* ${stats.totalSignals} (${stats.strongSignals} strong, ${stats.softSignals} soft)

🔥 *Strong signals* (boost ≥ 2.0):
${strong4hEmoji} 4h win rate: *${stats.strongWinRate4h.toFixed(1)}%*
${strong24hEmoji} 24h win rate: *${stats.strongWinRate24h.toFixed(1)}%*
Avg 4h return: ${stats.strongAvgReturn4h > 0 ? '+' : ''}${stats.strongAvgReturn4h.toFixed(2)}%
Avg 24h return: ${stats.strongAvgReturn24h > 0 ? '+' : ''}${stats.strongAvgReturn24h.toFixed(2)}%

💡 *Soft signals* (boost < 2.0):
${soft4hEmoji} 4h win rate: ${stats.softWinRate4h.toFixed(1)}%
${soft24hEmoji} 24h win rate: ${stats.softWinRate24h.toFixed(1)}%
Avg 4h return: ${stats.softAvgReturn4h > 0 ? '+' : ''}${stats.softAvgReturn4h.toFixed(2)}%
Avg 24h return: ${stats.softAvgReturn24h > 0 ? '+' : ''}${stats.softAvgReturn24h.toFixed(2)}%

🎯 *Top accurate pairs (24h):*
${topPairsText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
_Last updated: ${new Date(stats.lastUpdated).toLocaleString('en-US', { timeZone: 'UTC' })} UTC_`
}

sendSlackReport().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
