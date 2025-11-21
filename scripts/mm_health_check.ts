/**
 * MM Bot Health Check
 *
 * Quick overview of:
 * - Risk metrics (score, mode, leverage, free equity)
 * - Nansen signal quality
 * - Open positions
 * - Trend sparkline
 */

import { config } from 'dotenv'
config()

import * as hl from '@nktkas/hyperliquid'
import { ethers } from 'ethers'
import fs from 'fs'
import path from 'path'

const PRIVATE_KEY = process.env.PRIVATE_KEY
const WALLET_ADDRESS = process.env.WALLET_ADDRESS

if (!PRIVATE_KEY || !WALLET_ADDRESS) {
  console.error('❌ PRIVATE_KEY and WALLET_ADDRESS required in .env')
  process.exit(1)
}

const RUNTIME_DIR = path.join(process.cwd(), 'runtime')
const RISK_METRICS_PATH = path.join(RUNTIME_DIR, 'risk_metrics.json')
const NANSEN_STATS_PATH = path.join(RUNTIME_DIR, 'nansen_signal_stats.json')

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
}

interface NansenStats {
  strongWinRate4h: number
  strongWinRate24h: number
  strongAvgReturn24h: number
  softWinRate4h: number
  softWinRate24h: number
  totalSignals: number
  strongSignals: number
}

function loadRiskMetrics(): RiskMetrics | null {
  try {
    if (!fs.existsSync(RISK_METRICS_PATH)) return null
    const data = JSON.parse(fs.readFileSync(RISK_METRICS_PATH, 'utf8'))

    // If array, get latest
    if (Array.isArray(data)) {
      return data.length > 0 ? data[data.length - 1] : null
    }
    return data as RiskMetrics
  } catch (err) {
    console.warn('⚠️  Failed to load risk metrics:', err)
    return null
  }
}

function loadRiskHistory(): RiskMetrics[] {
  try {
    if (!fs.existsSync(RISK_METRICS_PATH)) return []
    const data = JSON.parse(fs.readFileSync(RISK_METRICS_PATH, 'utf8'))
    return Array.isArray(data) ? data : [data]
  } catch (err) {
    return []
  }
}

function loadNansenStats(): NansenStats | null {
  try {
    if (!fs.existsSync(NANSEN_STATS_PATH)) return null
    return JSON.parse(fs.readFileSync(NANSEN_STATS_PATH, 'utf8')) as NansenStats
  } catch (err) {
    console.warn('⚠️  Failed to load Nansen stats:', err)
    return null
  }
}

function buildSparkline(scores: number[]): string {
  if (scores.length === 0) return ''

  const recent = scores.slice(-5) // Last 5 points
  const min = Math.min(...recent)
  const max = Math.max(...recent)
  const chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

  if (max === min) {
    return chars[Math.floor(chars.length / 2)].repeat(recent.length)
  }

  return recent
    .map((s) => {
      const norm = (s - min) / (max - min)
      const idx = Math.min(chars.length - 1, Math.max(0, Math.floor(norm * chars.length)))
      return chars[idx]
    })
    .join('')
}

function getModeEmoji(mode: string): string {
  switch (mode) {
    case 'GREEN': return '🟢'
    case 'YELLOW': return '🟡'
    case 'RED': return '🟥'
    default: return '⚪'
  }
}

function getOpenPositionsFromRisk(risk: RiskMetrics | null): Array<{ coin: string; value: number }> {
  if (!risk || !risk.perPairNotional) return []

  return Object.entries(risk.perPairNotional)
    .map(([coin, value]) => ({ coin, value }))
    .filter((p) => p.value > 10) // Filter out tiny positions
    .sort((a, b) => b.value - a.value)
}

async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🏥 MM Bot Health Check')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // Risk metrics
  const risk = loadRiskMetrics()
  const history = loadRiskHistory()

  if (risk) {
    const emoji = getModeEmoji(risk.mode)
    const sparkline = history.length > 0 ? buildSparkline(history.map(h => h.riskScore)) : ''

    console.log(`${emoji} Risk: ${risk.mode} (score: ${risk.riskScore.toFixed(2)}) ${sparkline}`)
    console.log(`💰 Equity: $${risk.equity.toFixed(0)} | Leverage: ${risk.accountLeverage.toFixed(2)}x`)
    console.log(`📊 Free Equity: ${(risk.freeEquityRatio * 100).toFixed(1)}%`)
    console.log(`🎯 Max Position: ${risk.maxPair || 'none'} ${(risk.maxPairFraction * 100).toFixed(1)}%`)
  } else {
    console.log('⚠️  No risk metrics available')
  }

  console.log('')

  // Nansen stats
  const nansen = loadNansenStats()
  if (nansen) {
    console.log('🧭 Nansen Quality:')
    console.log(`   Total Signals: ${nansen.totalSignals} (${nansen.strongSignals} strong)`)
    console.log(`   4h Win Rate: ${nansen.strongWinRate4h.toFixed(1)}%`)
    console.log(`   24h Win Rate: ${nansen.strongWinRate24h.toFixed(1)}%`)
    console.log(`   Avg 24h Return: ${nansen.strongAvgReturn24h > 0 ? '+' : ''}${nansen.strongAvgReturn24h.toFixed(2)}%`)
  } else {
    console.log('🧭 Nansen Quality: No data')
  }

  console.log('')

  // Open positions
  const positions = getOpenPositionsFromRisk(risk)

  if (positions.length > 0) {
    console.log(`📍 Open Positions: ${positions.length}`)
    positions.forEach((p) => {
      console.log(`   ${p.coin}: $${p.value.toFixed(0)}`)
    })
  } else {
    console.log('📍 No open positions')
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

main().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
