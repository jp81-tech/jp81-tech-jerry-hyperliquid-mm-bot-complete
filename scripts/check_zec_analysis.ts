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
  
  // Get position details
  const chState = await infoClient.clearinghouseState({ user: wallet.address })
  const zecPosition = chState?.assetPositions.find(p => p.position.coin === 'ZEC')
  
  if (!zecPosition) {
    console.log('No ZEC position found')
    return
  }
  
  // Get current price
  const meta = await infoClient.meta()
  const allMids = await infoClient.allMids()
  const assetIndex = meta.universe.findIndex(u => u.name === 'ZEC')
  const currentPrice = assetIndex >= 0 ? parseFloat(allMids[assetIndex]) : 0
  
  const szi = Number(zecPosition.position.szi)
  const entryPx = parseFloat(zecPosition.position.entryPx || '0')
  const unrealizedPnl = parseFloat(zecPosition.position.unrealizedPnl)
  const notional = Math.abs(szi * currentPrice)
  
  console.log('\n🔍 ZEC Position Analysis\n')
  console.log('Position Details:')
  console.log(`  Side: ${szi > 0 ? 'LONG' : 'SHORT'}`)
  console.log(`  Size: ${Math.abs(szi).toFixed(2)}`)
  console.log(`  Entry Price: $${entryPx.toFixed(2)}`)
  console.log(`  Current Price: $${currentPrice.toFixed(2)}`)
  console.log(`  Price Change: ${((currentPrice - entryPx) / entryPx * 100).toFixed(2)}%`)
  console.log(`  Notional Value: $${notional.toFixed(2)}`)
  console.log(`  Unrealized PnL: $${unrealizedPnl.toFixed(2)}`)
  console.log()
  console.log('Analysis:')
  const priceMove = entryPx - currentPrice
  const pctMove = (priceMove / entryPx * 100)
  console.log(`  ZEC dropped $${priceMove.toFixed(2)} (${pctMove.toFixed(2)}%) from entry`)
  console.log(`  Loss per coin: $${(unrealizedPnl / Math.abs(szi)).toFixed(2)}`)
}

main()
