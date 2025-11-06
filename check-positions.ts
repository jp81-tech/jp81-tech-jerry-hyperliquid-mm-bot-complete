#!/usr/bin/env npx tsx
/**
 * Check current positions on Hyperliquid
 */

import { ethers } from 'ethers'

const PRIVATE_KEY = process.env.PRIVATE_KEY
if (!PRIVATE_KEY) {
  console.error('❌ PRIVATE_KEY not set')
  process.exit(1)
}

const wallet = new ethers.Wallet(PRIVATE_KEY)

async function checkPositions() {
  console.log('🔍 Sprawdzam pozycje...\n')
  console.log(`Wallet: ${wallet.address}\n`)

  const response = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'clearinghouseState',
      user: wallet.address
    })
  })

  const userState = await response.json()

  const positions = userState.assetPositions.filter((p: any) => {
    const size = parseFloat(p.position.szi)
    return Math.abs(size) > 0.0001
  })

  if (positions.length === 0) {
    console.log('✅ Brak otwartych pozycji')
    return
  }

  console.log(`📊 Otwarte pozycje: ${positions.length}\n`)
  console.log('═══════════════════════════════════════════════════════════')

  let totalUnrealizedPnl = 0

  for (const pos of positions) {
    const coin = pos.position.coin
    const size = parseFloat(pos.position.szi)
    const entryPrice = parseFloat(pos.position.entryPx)
    const unrealizedPnl = parseFloat(pos.position.unrealizedPnl)
    const leverage = parseFloat(pos.position.leverage.value)
    const marginUsed = parseFloat(pos.position.marginUsed)
    const side = size > 0 ? 'LONG' : 'SHORT'
    const sizeAbs = Math.abs(size)

    totalUnrealizedPnl += unrealizedPnl

    console.log(`\n${coin} | ${side}`)
    console.log(`  Size:          ${sizeAbs.toFixed(4)} coins`)
    console.log(`  Entry:         $${entryPrice}`)
    console.log(`  Leverage:      ${leverage}x`)
    console.log(`  Margin Used:   $${marginUsed}`)
    console.log(`  Unrealized PnL: ${unrealizedPnl >= 0 ? '+' : ''}$${unrealizedPnl.toFixed(2)}`)
  }

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log(`\n💰 Total Unrealized PnL: ${totalUnrealizedPnl >= 0 ? '+' : ''}$${totalUnrealizedPnl.toFixed(2)}\n`)
}

checkPositions().catch(console.error)
