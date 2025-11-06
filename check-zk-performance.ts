/**
 * ZK Multi-Layer Grid Performance Tracker
 *
 * Fetches ZK-specific metrics from Hyperliquid API
 */

import { ethers } from 'ethers'

const HL_REST_URL = process.env.HL_REST_URL || 'https://api.hyperliquid.xyz'
const PRIVATE_KEY = process.env.PRIVATE_KEY!

async function getZKPerformance() {
  // Get wallet address
  const wallet = new ethers.Wallet(PRIVATE_KEY)
  const address = wallet.address

  console.log(`\n📊 ZK Multi-Layer Grid Performance\n${'='.repeat(50)}`)
  console.log(`Wallet: ${address}\n`)

  try {
    // Get user state (positions + fills)
    const userStateRes = await fetch(`${HL_REST_URL}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'clearinghouseState',
        user: address
      })
    })

    const userState = await userStateRes.json()

    // Get metadata for symbol info
    const metaRes = await fetch(`${HL_REST_URL}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'meta' })
    })
    const meta = await metaRes.json()

    // Find ZK position
    const zkPosition = userState.assetPositions.find((pos: any) => {
      const coin = meta.universe[pos.position.coin].name
      return coin === 'ZK'
    })

    if (!zkPosition) {
      console.log('❌ No ZK position found')
      return
    }

    const pos = zkPosition.position
    const coin = meta.universe[pos.coin].name
    const szi = parseFloat(pos.szi)
    const entryPx = parseFloat(pos.entryPx || '0')
    const positionValue = parseFloat(pos.positionValue)
    const unrealizedPnl = parseFloat(pos.unrealizedPnl)
    const returnOnEquity = parseFloat(pos.returnOnEquity) * 100

    console.log(`🪙  Symbol: ${coin}`)
    console.log(`📈 Position Size: ${szi.toFixed(2)} units`)
    console.log(`💰 Position Value: $${positionValue.toFixed(2)}`)
    console.log(`🎯 Entry Price: $${entryPx.toFixed(4)}`)
    console.log(`\n💵 Unrealized PnL: $${unrealizedPnl.toFixed(2)}`)
    console.log(`📊 ROE: ${returnOnEquity.toFixed(2)}%`)

    // Get recent fills for ZK
    const fillsRes = await fetch(`${HL_REST_URL}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'userFills',
        user: address
      })
    })

    const fills = await fillsRes.json()
    const zkFills = fills.filter((fill: any) => fill.coin === coin)

    // Calculate stats from recent fills (last 24h)
    const now = Date.now()
    const oneDayAgo = now - 24 * 60 * 60 * 1000
    const recentFills = zkFills.filter((fill: any) => fill.time > oneDayAgo)

    const totalFills = recentFills.length
    const buyFills = recentFills.filter((f: any) => f.side === 'B').length
    const sellFills = recentFills.filter((f: any) => f.side === 'A').length

    // Calculate realized PnL from fills
    let realizedPnl = 0
    for (const fill of recentFills) {
      if (fill.closedPnl) {
        realizedPnl += parseFloat(fill.closedPnl)
      }
    }

    console.log(`\n📋 Last 24h Trading Activity:`)
    console.log(`   Total Fills: ${totalFills}`)
    console.log(`   Buy Fills: ${buyFills}`)
    console.log(`   Sell Fills: ${sellFills}`)
    console.log(`   Realized PnL (24h): $${realizedPnl.toFixed(2)}`)

    // Calculate fill rate (rough estimate based on 90s intervals)
    const cyclesPerDay = (24 * 60 * 60) / 90  // ~960 cycles/day
    const ordersPerCycle = 12  // 12 orders per cycle for multi-layer
    const totalOrdersPossible = cyclesPerDay * ordersPerCycle
    const fillRate = (totalFills / totalOrdersPossible) * 100

    console.log(`   Estimated Fill Rate: ${fillRate.toFixed(2)}%`)

    // Total PnL
    const totalPnl = unrealizedPnl + realizedPnl
    console.log(`\n💎 Total ZK PnL: $${totalPnl.toFixed(2)}`)

    // Multi-layer specific metrics
    console.log(`\n🏛️  Multi-Layer Grid Status:`)
    console.log(`   Active Layers: L1-L3 (±20, ±30, ±45 bps)`)
    console.log(`   Parking Layers: L4-L5 (±65, ±90 bps)`)
    console.log(`   Orders/Cycle: 12 (6 bids + 6 asks)`)
    console.log(`   Inventory Skew: ${((szi / positionValue) * 100).toFixed(1)}%`)

  } catch (error: any) {
    console.error('❌ Error fetching ZK performance:', error.message)
  }
}

// Run
getZKPerformance()
