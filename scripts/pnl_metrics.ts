#!/usr/bin/env ts-node
/**
 * Quick PnL metrics from log (quant_evt=fill) with a time window.
 *
 * Usage:
 *   npx tsx scripts/pnl_metrics.ts --file bot.log --hours 24
 *   npx tsx scripts/pnl_metrics.ts --file bot.log --since 2025-12-03T00:00:00Z
 */

import fs from 'fs'
import readline from 'readline'
import path from 'path'

type PairStats = {
  fills: number
  pnl: number
  notional: number
  fee: number
  wins: number
  losses: number
}

const args = process.argv.slice(2)

function getArg(name: string, fallback?: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && i + 1 < args.length) return args[i + 1]
    if (args[i].startsWith(`--${name}=`)) return args[i].split('=')[1]
  }
  return fallback
}

const file = getArg('file', 'bot.log')!
const hoursArg = getArg('hours')
const sinceArg = getArg('since')

let sinceTs: number | null = null
if (sinceArg) {
  const d = Date.parse(sinceArg)
  if (!Number.isNaN(d)) sinceTs = d
}
if (hoursArg && !sinceTs) {
  const h = Number(hoursArg)
  if (Number.isFinite(h) && h > 0) {
    sinceTs = Date.now() - h * 3600 * 1000
  }
}

const stats: Record<string, PairStats> = {}
let totalFills = 0

async function main() {
  const filePath = path.resolve(file)
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`)
    process.exit(1)
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity
  })

  for await (const line of rl) {
    if (!line.includes('quant_evt=fill')) continue

    // Parse timestamp (ts or tms)
    let tsMs: number | null = null
    const tsMatch = line.match(/ts=([0-9T:\-\.Z]+)/)
    if (tsMatch) {
      const parsed = Date.parse(tsMatch[1])
      if (!Number.isNaN(parsed)) tsMs = parsed
    }
    const tmsMatch = line.match(/tms=([0-9]+)/)
    if (!tsMs && tmsMatch) {
      const parsed = Number(tmsMatch[1])
      if (Number.isFinite(parsed)) tsMs = parsed
    }

    if (sinceTs && tsMs && tsMs < sinceTs) continue

    const pair = extract(line, 'pair')
    if (!pair) continue

    const pnl = Number(extract(line, 'pnl') ?? extract(line, 'closedPnl') ?? 0)
    const notional = Number(extract(line, 'notional') ?? 0)
    const fee = Number(extract(line, 'fee') ?? 0)

    if (!stats[pair]) {
      stats[pair] = { fills: 0, pnl: 0, notional: 0, fee: 0, wins: 0, losses: 0 }
    }
    const ps = stats[pair]
    ps.fills += 1
    ps.pnl += pnl
    ps.notional += notional
    ps.fee += fee
    if (pnl > 0) ps.wins += 1
    else if (pnl < 0) ps.losses += 1
    totalFills += 1
  }

  printReport()
}

function extract(line: string, key: string): string | null {
  const m = line.match(new RegExp(`${key}=([^\\s]+)`))
  return m ? m[1] : null
}

function printReport() {
  const pairs = Object.keys(stats)
  if (pairs.length === 0) {
    console.log('⚠️  No fills found in the selected window.')
    return
  }

  console.log(
    `📊 PnL metrics from ${sinceTs ? new Date(sinceTs).toISOString() : 'beginning'} (fills=${totalFills})\n`
  )
  console.log(
    'PAIR       | FILLS |   PnL ($) |  Edge/1M |   Notional |  Win% | Fee ($)'
  )
  console.log(
    '-----------------------------------------------------------------------'
  )

  let totalPnl = 0
  let totalNotional = 0

  pairs.sort().forEach(pair => {
    const ps = stats[pair]
    totalPnl += ps.pnl
    totalNotional += ps.notional
    const edgePer1M = ps.notional > 0 ? (ps.pnl / ps.notional) * 1_000_000 : 0
    const winPct =
      ps.fills > 0 ? ((ps.wins / ps.fills) * 100).toFixed(1) + '%' : 'n/a'

    console.log(
      `${pair.padEnd(10)}| ${ps.fills.toString().padStart(5)} | ${ps.pnl
        .toFixed(2)
        .padStart(9)} | ${edgePer1M.toFixed(2).padStart(9)} | ${ps.notional
        .toFixed(2)
        .padStart(10)} | ${winPct.padStart(5)} | ${ps.fee.toFixed(2).padStart(7)}`
    )
  })

  const totalEdge = totalNotional > 0 ? (totalPnl / totalNotional) * 1_000_000 : 0
  console.log('-----------------------------------------------------------------------')
  console.log(
    `TOTAL      | ${totalFills
      .toString()
      .padStart(5)} | ${totalPnl.toFixed(2).padStart(9)} | ${totalEdge
      .toFixed(2)
      .padStart(9)} | ${totalNotional.toFixed(2).padStart(10)} |`
  )
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})

