#!/usr/bin/env -S npx tsx
import * as hl from '@nktkas/hyperliquid'
import { ethers } from 'ethers'
import { config } from 'dotenv'
import path from 'path'
import fs from 'fs'

interface PositionSnapshot {
  symbol: string
  side: 'long' | 'short'
  size: number
  entryPx: number
  markPx: number
  unrealizedPnlUsd?: number
  roePct?: number
}

interface AccountSnapshot {
  equityUsd: number
  dailyPnlUsd?: number
  dailyFundingUsd?: number
  timestamp: string
  positions: PositionSnapshot[]
}

async function main() {
  config({ path: path.resolve(process.cwd(), '.env') })

  const pk = process.env.PRIVATE_KEY
  if (!pk) {
    console.error('PRIVATE_KEY not set in .env')
    process.exit(1)
  }

  const wallet = new ethers.Wallet(pk)
  const address = wallet.address

  console.log(`Fetching account state for ${address}...`)

  const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })

  try {
    const state = await infoClient.clearinghouseState({ user: address })

    const equity = parseFloat(state.marginSummary.accountValue || '0')

    // Extract positions
    const positions: PositionSnapshot[] = []

    if (state.assetPositions && state.assetPositions.length > 0) {
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

        positions.push({
          symbol,
          side,
          size: Math.abs(size),
          entryPx,
          markPx,
          unrealizedPnlUsd: unrealizedPnl,
          roePct: returnOnEquity * 100
        })
      }
    }

    // Calculate totals
    const totalUnrealized = positions.reduce((sum, p) => sum + (p.unrealizedPnlUsd || 0), 0)

    const snapshot: AccountSnapshot = {
      equityUsd: equity,
      dailyPnlUsd: undefined, // Could be calculated from historical snapshots
      dailyFundingUsd: undefined, // Could be extracted from funding history
      timestamp: new Date().toISOString(),
      positions
    }

    // Save to runtime/account_snapshot.json
    const runtimeDir = path.join(process.cwd(), 'runtime')
    if (!fs.existsSync(runtimeDir)) {
      fs.mkdirSync(runtimeDir, { recursive: true })
    }

    const snapshotPath = path.join(runtimeDir, 'account_snapshot.json')
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8')

    console.log(`✅ Account snapshot saved to ${snapshotPath}`)
    console.log(`   Equity: $${equity.toFixed(2)}`)
    console.log(`   Positions: ${positions.length}`)
    console.log(`   Total Unrealized PnL: $${totalUnrealized.toFixed(2)}`)

  } catch (error: any) {
    console.error('Failed to fetch account state:', error.message || error)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Fatal error in dump_account_snapshot:', err)
  process.exit(1)
})
