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
  
  console.log('\n📊 Current positions:')
  if (positions.length === 0) {
    console.log('  No open positions')
  } else {
    for (const p of positions) {
      const coin = p.position.coin
      const szi = Number(p.position.szi)
      if (Math.abs(szi) > 1e-12) {
        console.log(`  ${coin}: ${szi > 0 ? 'LONG' : 'SHORT'} ${Math.abs(szi)}`)
      }
    }
  }
}

main()
