#!/usr/bin/env -S npx tsx
import * as hl from "@nktkas/hyperliquid"
import { ethers } from "ethers"
import { config } from "dotenv"
import path from "path"

config({ path: path.resolve(process.cwd(), ".env") })

async function main() {
  const coins = process.argv.slice(2) || ["BTC", "HMSTR", "BOME"]
  
  const pk = process.env.PRIVATE_KEY
  if (!pk) {
    console.error("❌ PRIVATE_KEY not set")
    process.exit(1)
  }

  const wallet = new ethers.Wallet(pk)
  const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })
  const exchClient = new hl.ExchangeClient({ wallet: pk, transport: new hl.HttpTransport() })

  const meta = await infoClient.meta()
  const allMids = await infoClient.allMids()

  for (const coin of coins) {
    try {
      const assetIdx = meta.universe.findIndex(u => u.name === coin)
      if (assetIdx < 0) continue

      const assetInfo = meta.universe[assetIdx]
      const mid = Number(allMids[coin] || 0)
      
      if (!mid) continue

      // Price 1% above mid
      const sellPrice = (mid * 1.01).toFixed(6)
      
      // Small size (~$10 notional)
      const size = (10 / (mid * 1.01)).toFixed(assetInfo.szDecimals)

      const result = await exchClient.order({
        orders: [{
          asset: coin,
          isBuy: false,
          sz: size,
          limitPx: sellPrice,
          orderType: { limit: { tif: "Gtc" } },
          reduceOnly: false,
          cloid: `seed_sell_${coin}_${Date.now()}`
        }]
      })

      console.log(`[${coin}] ✅ SELL ${size} @ $${sellPrice}`)
    } catch (e: any) {
      console.log(`[${coin}] ❌ ${e.message || e}`)
    }
  }
}

main()
