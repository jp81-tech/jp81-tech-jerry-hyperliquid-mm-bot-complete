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
  
  console.log('🔍 Debug API Response for ZEC\n')
  
  // 1. Get meta info
  console.log('1. Fetching meta...')
  const meta = await infoClient.meta()
  console.log('Meta type:', typeof meta)
  console.log('Meta keys:', Object.keys(meta))
  
  const zecMeta = meta.universe.find(u => u.name === 'ZEC')
  console.log('\nZEC in meta:', zecMeta)
  const zecIndex = meta.universe.findIndex(u => u.name === 'ZEC')
  console.log('ZEC index:', zecIndex)
  
  // 2. Get all mids
  console.log('\n2. Fetching allMids...')
  const allMids = await infoClient.allMids()
  console.log('AllMids type:', typeof allMids)
  console.log('AllMids is array:', Array.isArray(allMids))
  console.log('AllMids length:', allMids?.length)
  console.log('AllMids[0]:', allMids?.[0])
  console.log('AllMids[1]:', allMids?.[1])
  
  if (zecIndex >= 0) {
    console.log(`\nAllMids[ZEC index ${zecIndex}]:`, allMids?.[zecIndex])
    console.log('Type:', typeof allMids?.[zecIndex])
  }
  
  // 3. Try alternative - get orderbook
  console.log('\n3. Trying l2Book for ZEC...')
  try {
    const l2 = await infoClient.l2Book({ coin: 'ZEC' })
    console.log('L2 Book levels:', l2.levels)
    if (l2.levels?.[0]?.length > 0) {
      const bestBid = l2.levels[0][0]
      const bestAsk = l2.levels[1][0]
      console.log('Best bid:', bestBid)
      console.log('Best ask:', bestAsk)
      if (bestBid?.px && bestAsk?.px) {
        const mid = (parseFloat(bestBid.px) + parseFloat(bestAsk.px)) / 2
        console.log('Calculated mid:', mid)
      }
    }
  } catch (err) {
    console.log('L2 error:', err.message)
  }
  
  // 4. Check position data
  console.log('\n4. Position data...')
  const chState = await infoClient.clearinghouseState({ user: wallet.address })
  const zecPos = chState?.assetPositions.find(p => p.position.coin === 'ZEC')
  console.log('ZEC position object:', JSON.stringify(zecPos, null, 2))
}

main()
