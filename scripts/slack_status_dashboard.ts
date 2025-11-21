#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import * as hl from '@nktkas/hyperliquid'
import { ethers } from 'ethers'
import fs from 'fs'
import path from 'path'
import https from 'https'

type BiasStrength = 'strong' | 'soft' | 'neutral'
type Direction = 'long' | 'short' | 'neutral'

interface NansenBiasEntry {
  boost: number
  direction: Direction
  biasStrength: BiasStrength
  buySellPressure?: number
  updatedAt?: string
}

interface NansenBiasFile {
  [symbol: string]: NansenBiasEntry
}

interface PositionSnapshot {
  symbol: string
  side: 'long' | 'short'
  size: number
  entryPx: number
  markPx: number
  unrealizedPnlUsd?: number
  roePct?: number
  bias?: NansenBiasEntry
}

interface AccountSnapshot {
  equityUsd: number
  dailyPnlUsd?: number
  dailyFundingUsd?: number
  timestamp: string
  positions: PositionSnapshot[]
}

// Simple HTTPS POST without extra deps
function postToSlack(webhookUrl: string, payload: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload), 'utf8')
    const url = new URL(webhookUrl)

    const options: https.RequestOptions = {
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }

    const req = https.request(options, res => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        resolve()
      } else {
        reject(new Error('Slack webhook returned status ' + res.statusCode))
      }
    })

    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function safeReadJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch (err) {
    console.error('Failed to read JSON ' + filePath + ':', err)
    return null
  }
}

function formatUsd(v?: number): string {
  if (v === undefined || Number.isNaN(v)) return 'n/a'
  const sign = v >= 0 ? '+' : '-'
  const abs = Math.abs(v)
  return sign + '$' + abs.toFixed(2)
}

function formatPct(v?: number): string {
  if (v === undefined || Number.isNaN(v)) return 'n/a'
  const sign = v >= 0 ? '+' : ''
  return sign + v.toFixed(2) + '%'
}

function classifyAlert(equityUsd?: number, dailyPnlUsd?: number) {
  const panicEquityStop = Number(process.env.PANIC_EQUITY_STOP ?? '16000')
  const dailyPnlStop = Number(process.env.DAILY_PNL_STOP ?? '-200')

  const alerts: string[] = []
  let level: 'ok' | 'warning' | 'danger' = 'ok'

  if (equityUsd !== undefined && equityUsd < panicEquityStop) {
    alerts.push('Equity below panic stop (' + formatUsd(equityUsd) + ' < $' + panicEquityStop + ')')
    level = 'danger'
  }

  if (dailyPnlUsd !== undefined && dailyPnlUsd <= dailyPnlStop) {
    alerts.push('Daily PnL below limit (' + formatUsd(dailyPnlUsd) + ' <= $' + dailyPnlStop + ')')
    level = level === 'danger' ? 'danger' : 'warning'
  }

  return { level, alerts }
}

function buildSlackPayload(
  equity: number,
  positions: PositionSnapshot[],
  biases: NansenBiasFile | null
): any {
  const now = new Date()
  const tsStr = now.toISOString().replace('T', ' ').replace(/\..+/, ' UTC')

  const dailyPnl = undefined // TODO: calculate from historical snapshots
  const dailyFunding = undefined // TODO: extract from funding history

  const { level, alerts } = classifyAlert(equity, dailyPnl)

  const statusEmoji =
    level === 'danger' ? '🔴' :
    level === 'warning' ? '🟠' :
    '🟢'

  // Positions summary (top 6 by notional)
  const sortedPositions = positions.slice().sort((a, b) => {
    const na = a.size * a.markPx
    const nb = b.size * b.markPx
    return nb - na
  })

  const topPositions = sortedPositions.slice(0, 6)

  const positionsLines = topPositions.length
    ? topPositions.map(p => {
        const notional = p.size * p.markPx
        const sideEmoji = p.side === 'long' ? '🟩' : '🟥'
        const roe = p.roePct !== undefined ? ' | ROE: ' + formatPct(p.roePct) : ''
        const upnl = p.unrealizedPnlUsd !== undefined ? ' | uPnL: ' + formatUsd(p.unrealizedPnlUsd) : ''

        // Add bias info
        let biasStr = ''
        if (p.bias) {
          const b = p.bias
          const dirEmoji = b.direction === 'long' ? '🟢' : b.direction === 'short' ? '🔴' : '⚪'
          const strengthEmoji = b.biasStrength === 'strong' ? '🔥' : b.biasStrength === 'soft' ? '✨' : ''
          biasStr = ' | Bias: ' + dirEmoji + strengthEmoji + ' ' + b.direction.toUpperCase() + ' +' + b.boost.toFixed(2)
        }

        return sideEmoji + ' *' + p.symbol + '* ' + p.side.toUpperCase() + ' · sz=' + p.size.toFixed(2) + ' · notional=$' + notional.toFixed(2) + roe + upnl + biasStr
      }).join('\n')
    : '_No open positions_'

  // Bias summary – top 5 by |boost|
  let biasLines = '_No Nansen bias data_'
  if (biases && Object.keys(biases).length > 0) {
    const entries = Object.entries(biases)
      .map(([symbol, data]) => ({ symbol, ...data }))
      .sort((a, b) => Math.abs(b.boost) - Math.abs(a.boost))

    const top = entries.slice(0, 5)
    biasLines = top.map(b => {
      const dirEmoji =
        b.direction === 'long' ? '🟢' :
        b.direction === 'short' ? '🔴' :
        '⚪'
      const strengthEmoji =
        b.biasStrength === 'strong' ? '🔥' :
        b.biasStrength === 'soft' ? '✨' :
        ''
      return dirEmoji + strengthEmoji + ' *' + b.symbol + '* ' + b.direction.toUpperCase() + ' · boost=' + b.boost.toFixed(2) + ' · strength=' + b.biasStrength
    }).join('\n')
  }

  const alertText = alerts.length
    ? alerts.map(a => '• ' + a).join('\n')
    : '✅ No hard risk limits breached'

  const totalUpnl = positions.reduce((sum, p) => sum + (p.unrealizedPnlUsd || 0), 0)

  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: statusEmoji + ' MM Bot Status – Hyperliquid',
        emoji: true
      }
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Last updated: *' + tsStr + '*'
        }
      ]
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: '*Equity*\n' + formatUsd(equity)
        },
        {
          type: 'mrkdwn',
          text: '*Total uPnL*\n' + formatUsd(totalUpnl)
        },
        {
          type: 'mrkdwn',
          text: '*Daily PnL*\n' + formatUsd(dailyPnl)
        },
        {
          type: 'mrkdwn',
          text: '*Open Positions*\n' + positions.length
        }
      ]
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*📊 Top Positions*'
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: positionsLines
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*🧭 Top Nansen Bias*'
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: biasLines
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*🚨 Alerts*'
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: alertText
      }
    }
  ]

  return { blocks }
}

async function main() {
  const webhook = process.env.SLACK_WEBHOOK
  if (!webhook || webhook === 'CHANGE_ME_SLACK_WEBHOOK_URL') {
    console.error('SLACK_WEBHOOK not set or still CHANGE_ME_*. Set it in .env first.')
    process.exit(1)
  }

  const pk = process.env.PRIVATE_KEY
  if (!pk) {
    console.error('PRIVATE_KEY not set in .env')
    process.exit(1)
  }

  const wallet = new ethers.Wallet(pk)
  const address = wallet.address

  console.log('🔍 Fetching account state for ' + address + '...')

  const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })

  try {
    const state = await infoClient.clearinghouseState({ user: address })

    const equity = parseFloat(state.marginSummary.accountValue || '0')

    // Extract positions
    const positions: PositionSnapshot[] = []

    if (state.assetPositions && state.assetPositions.length > 0) {
      // Load Nansen bias data
      const botDir = process.cwd()
      const biasPath = path.join(botDir, 'runtime', 'nansen_bias.json')
      const biases = safeReadJson<NansenBiasFile>(biasPath)

      for (const ap of state.assetPositions) {
        const pos = ap.position
        if (!pos) continue

        const size = parseFloat(pos.szi)
        if (Math.abs(size) < 1e-6) continue

        const symbol = pos.coin
        const side: 'long' | 'short' = size > 0 ? 'long' : 'short'
        const entryPx = parseFloat(pos.entryPx || '0')
        const posValue = parseFloat(pos.positionValue || '0')
        const markPx = Math.abs(size) > 0 ? Math.abs(posValue) / Math.abs(size) : 0
        const unrealizedPnl = parseFloat(pos.unrealizedPnl || '0')
        const returnOnEquity = parseFloat(pos.returnOnEquity || '0')

        const bias = biases ? biases[symbol] : undefined

        positions.push({
          symbol,
          side,
          size: Math.abs(size),
          entryPx,
          markPx,
          unrealizedPnlUsd: unrealizedPnl,
          roePct: returnOnEquity * 100,
          bias
        })
      }
    }

    // Load bias data for top bias section
    const botDir = process.cwd()
    const biasPath = path.join(botDir, 'runtime', 'nansen_bias.json')
    const biases = safeReadJson<NansenBiasFile>(biasPath)

    const payload = buildSlackPayload(equity, positions, biases)

    console.log('📤 Sending status to Slack...')
    await postToSlack(webhook, payload)
    console.log('✅ Slack status sent.')

  } catch (error: any) {
    console.error('Failed to fetch account state:', error.message || error)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Fatal error in slack_status_dashboard:', err)
  process.exit(1)
})
