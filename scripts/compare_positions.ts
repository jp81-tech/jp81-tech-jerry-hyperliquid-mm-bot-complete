#!/usr/bin/env -S npx tsx
import * as hl from '@nktkas/hyperliquid'
import { ethers } from 'ethers'
import { config } from 'dotenv'
import path from 'path'

async function main() {
  config({ path: path.resolve(process.cwd(), '.env') })
  
  const pk = process.env.PRIVATE_KEY
  const wallet = new ethers.Wallet(pk)
  const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })
  
  const chState = await infoClient.clearinghouseState({ user: wallet.address })
  const positions = chState?.assetPositions ?? []
  
  console.log('\n📊 ALL POSITIONS - Notional Value Comparison\n')
  console.log('Coin     | Side  | Size           | Entry Px    | Notional @ Entry | Current PnL')
  console.log('---------|-------|----------------|-------------|------------------|-------------')
  
  const posData = []
  
  for (const p of positions) {
    const coin = p.position.coin
    const szi = Number(p.position.szi)
    if (Math.abs(szi) < 1e-12) continue
    
    const side = szi > 0 ? 'LONG' : 'SHORT'
    const entryPx = parseFloat(p.position.entryPx || '0')
    const notionalAtEntry = Math.abs(szi * entryPx)
    const unrealizedPnl = parseFloat(p.position.unrealizedPnl)
    
    posData.push({
      coin,
      side,
      szi: Math.abs(szi),
      entryPx,
      notionalAtEntry,
      unrealizedPnl
    })
  }
  
  // Sort by notional value at entry (descending)
  posData.sort((a, b) => b.notionalAtEntry - a.notionalAtEntry)
  
  for (const pos of posData) {
    const sizeStr = pos.szi.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const entryStr = pos.entryPx.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
    const notionalStr = pos.notionalAtEntry.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const pnlStr = pos.unrealizedPnl >= 0 ? '+' + pos.unrealizedPnl.toFixed(2) : pos.unrealizedPnl.toFixed(2)
    
    console.log(`${pos.coin.padEnd(8)} | ${pos.side.padEnd(5)} | ${sizeStr.padStart(14)} | ${entryStr.padStart(11)} | ${notionalStr.padStart(16)} | ${pnlStr.padStart(11)}`)
  }
  
  console.log()
  console.log('🔍 Analysis:')
  console.log(`   Largest position by entry value: ${posData[0].coin} ($${posData[0].notionalAtEntry.toFixed(0)})`)
  console.log(`   Smallest position by entry value: ${posData[posData.length-1].coin} ($${posData[posData.length-1].notionalAtEntry.toFixed(0)})`)
  
  const totalNotional = posData.reduce((sum, p) => sum + p.notionalAtEntry, 0)
  const zecPct = (posData.find(p => p.coin === 'ZEC')?.notionalAtEntry || 0) / totalNotional * 100
  
  console.log(`   Total capital deployed at entry: $${totalNotional.toFixed(0)}`)
  console.log(`   ZEC as % of total: ${zecPct.toFixed(1)}%`)
}

main()
