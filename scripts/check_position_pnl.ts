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
  
  // Get all current mid prices
  const allMids = await infoClient.allMids()
  const meta = await infoClient.meta()
  
  console.log('\n📊 POSITION DISTRIBUTION WITH PNL\n')
  console.log('Coin     | Side  | Size           | Entry Px    | Mark Px     | Notional USD | Unrealized PNL')
  console.log('---------|-------|----------------|-------------|-------------|--------------|---------------')
  
  let totalNotional = 0
  let totalUnrealizedPnl = 0
  
  for (const p of positions) {
    const coin = p.position.coin
    const szi = Number(p.position.szi)
    if (Math.abs(szi) < 1e-12) continue
    
    const side = szi > 0 ? 'LONG' : 'SHORT'
    const entryPx = parseFloat(p.position.entryPx || '0')
    const unrealizedPnl = parseFloat(p.position.unrealizedPnl)
    
    // Find market price
    const assetIndex = meta.universe.findIndex(u => u.name === coin)
    const markPrice = assetIndex >= 0 ? parseFloat(allMids[assetIndex] || '0') : 0
    
    const notional = Math.abs(szi * markPrice)
    totalNotional += notional
    totalUnrealizedPnl += unrealizedPnl
    
    const sizeStr = Math.abs(szi).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const entryStr = entryPx.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
    const markStr = markPrice.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
    const notionalStr = notional.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const pnlStr = unrealizedPnl >= 0 ? '+' + unrealizedPnl.toFixed(2) : unrealizedPnl.toFixed(2)
    
    console.log(`${coin.padEnd(8)} | ${side.padEnd(5)} | ${sizeStr.padStart(14)} | ${entryStr.padStart(11)} | ${markStr.padStart(11)} | ${notionalStr.padStart(12)} | ${pnlStr.padStart(14)}`)
  }
  
  console.log('---------|-------|----------------|-------------|-------------|--------------|---------------')
  const totalPnlStr = totalUnrealizedPnl >= 0 ? '+' + totalUnrealizedPnl.toFixed(2) : totalUnrealizedPnl.toFixed(2)
  console.log(`${'TOTAL'.padEnd(8)} | ${' '.padEnd(5)} | ${' '.padStart(14)} | ${' '.padStart(11)} | ${' '.padStart(11)} | ${totalNotional.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(12)} | ${totalPnlStr.padStart(14)}`)
  
  console.log(`\n💰 Total Capital Deployed: \$${totalNotional.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`📈 Total Unrealized PnL: \$${totalPnlStr}`)
  console.log(`📍 Number of Positions: ${positions.filter(p => Math.abs(Number(p.position.szi)) > 1e-12).length}`)
  console.log(`💵 Account Value: \$${parseFloat(chState.marginSummary.accountValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
}

main()
