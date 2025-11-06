#!/usr/bin/env -S npx tsx
import * as hl from "@nktkas/hyperliquid"
import { ethers } from "ethers"
import { config } from "dotenv"
import path from "path"

config({ path: path.resolve(process.cwd(), ".env") })

async function closePosition(coin: string) {
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

  console.log(`🔴 Found ${coin} position: ${isLong ? 'LONG' : 'SHORT'} ${size}`)
  console.log(`📤 Closing with reduce-only ${isLong ? 'SELL' : 'BUY'} market order...`)

  try {
    const result = await exchClient.order({
      orders: [{
        asset: coin,
        isBuy: !isLong,
        sz: size,
        limitPx: isLong ? "0.01" : "999999",
        orderType: { limit: { tif: "Ioc" } },
        reduceOnly: true,
        cloid: `close_${coin}_${Date.now()}`
      }]
    })
    console.log(`✅ Closed ${coin}:`, JSON.stringify(result))
  } catch (e: any) {
    console.error(`❌ Error:`, e.message)
    process.exit(1)
  }
}

const coin = process.argv[2] || "ETH"
closePosition(coin)
