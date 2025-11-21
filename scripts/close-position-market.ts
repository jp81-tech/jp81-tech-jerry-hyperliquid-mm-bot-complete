#!/usr/bin/env -S npx tsx
import * as hl from "@nktkas/hyperliquid"
import { ethers } from "ethers"
import { config } from "dotenv"
import path from "path"

config({ path: path.resolve(process.cwd(), ".env") })

async function closePositionMarket(coin: string) {
  const pk = process.env.PRIVATE_KEY
  if (!pk) {
    console.error("❌ PRIVATE_KEY not set")
    process.exit(1)
  }

  const wallet = new ethers.Wallet(pk)
  const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })
  const exchClient = new hl.ExchangeClient({ wallet: pk, transport: new hl.HttpTransport() })

  console.log(`🔍 Checking position for ${coin}...`)

  const state = await infoClient.clearinghouseState({ user: wallet.address })
  const positions = state?.assetPositions ?? []
  
  const pos = positions.find((p: any) => p.position?.coin?.toUpperCase() === coin.toUpperCase())
  
  if (!pos) {
    console.log(`✅ No ${coin} position found`)
    return
  }

  const szi = Number(pos.position.szi)
  if (!szi || Math.abs(szi) < 0.0001) {
    console.log(`✅ ${coin} position is zero`)
    return
  }

  const isLong = szi > 0
  const size = Math.abs(szi)

  // Get current mid price
  const allMids = await infoClient.allMids()
  const midPrice = Number(allMids[coin] || 0)
  
  if (!midPrice) {
    console.error(`❌ Cannot get mid price for ${coin}`)
    process.exit(1)
  }

  // Calculate limit price with 5% slippage
  const slippage = 0.05
  const limitPrice = isLong 
    ? midPrice * (1 - slippage)  // SELL: below mid
    : midPrice * (1 + slippage)  // BUY: above mid

  console.log(`🔴 Found ${coin} position: ${isLong ? 'LONG' : 'SHORT'} ${size}`)
  console.log(`📊 Mid price: $${midPrice}, Limit: $${limitPrice.toFixed(6)}`)
  console.log(`📤 Closing with reduce-only ${isLong ? 'SELL' : 'BUY'} limit order (5% slippage)...`)

  try {
    const result = await exchClient.order({
      orders: [{
        asset: coin,
        isBuy: !isLong,
        sz: size,
        limitPx: limitPrice.toFixed(6),
        orderType: { limit: { tif: "Ioc" } },
        reduceOnly: true,
        cloid: `close_market_${coin}_${Date.now()}`
      }]
    })
    console.log(`✅ Close order sent:`, JSON.stringify(result, null, 2))
  } catch (e: any) {
    console.error(`❌ Error:`, e.message)
    process.exit(1)
  }
}

const coin = process.argv[2] || "ETH"
closePositionMarket(coin)
