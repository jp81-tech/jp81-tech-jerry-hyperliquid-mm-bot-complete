#!/usr/bin/env -S npx tsx
import * as hl from '@nktkas/hyperliquid'
import { ethers } from 'ethers'
import { config } from 'dotenv'
config();

async function main() {
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!)
  const info = new hl.InfoClient({ transport: new hl.HttpTransport() })
  
  const state = await info.clearinghouseState({ user: wallet.address })
  
  console.log('📊 Account State:')
  console.log('  Account Value:', state.marginSummary.accountValue)
  console.log('  Total Raw USD:', state.marginSummary.totalRawUsd)
  console.log('  Total Margin Used:', state.marginSummary.totalMarginUsed)
  console.log('  Withdrawable:', state.withdrawable)
  console.log()
  console.log('💰 Cross Margin:')
  console.log('  Account Value:', state.crossMarginSummary.accountValue)
  console.log('  Total Raw USD:', state.crossMarginSummary.totalRawUsd)
  console.log('  Total Margin Used:', state.crossMarginSummary.totalMarginUsed)
}

main().catch(console.error)
