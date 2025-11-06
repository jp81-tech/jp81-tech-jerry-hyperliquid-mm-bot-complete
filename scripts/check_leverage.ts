#!/usr/bin/env -S npx tsx
import * as hl from '@nktkas/hyperliquid'
import { ethers } from 'ethers'
import { config } from 'dotenv'
config();

async function main() {
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY)
  const info = new hl.InfoClient({ transport: new hl.HttpTransport() })

  const state = await info.clearinghouseState({ user: wallet.address })

  console.log('📊 Current leverage per position:')
  state.assetPositions?.forEach(p => {
    if (Math.abs(Number(p.position.szi)) > 0.001) {
      console.log(`  ${p.position.coin}: ${p.position.leverage.value}x (${p.position.leverage.type})`)
    }
  })
}

main().catch(console.error)
