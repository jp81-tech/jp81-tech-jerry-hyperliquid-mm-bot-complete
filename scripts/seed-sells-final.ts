#!/usr/bin/env -S npx tsx
import * as hl from "@nktkas/hyperliquid"
import { ethers } from "ethers"
import { config } from "dotenv"
import path from "path"

config({ path: path.resolve(process.cwd(), ".env") })

async function main() {
  const coins = process.argv.slice(2)
  if (coins.length === 0) {
    console.log("Usage: npx tsx scripts/seed-sells-final.ts COIN [COIN...]")
    process.exit(1)
  }

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
      if (assetIdx < 0) {
        console.log(`[${coin}] not found`)
        continue
      }

      const assetInfo = meta.universe[assetIdx]
      const mid = Number(allMids[coin] || 0)
      
      if (!mid) {
        console.log(`[${coin}] no mid price`)
        continue
      }

      // Price 1% above mid, rounded properly
      const sellPriceNum = mid * 1.01
      const sellPrice = sellPriceNum.toFixed(Math.max(2, 8 - Math.floor(Math.log10(sellPriceNum))))
      
      // Small size
      const sizeNum = 10 / sellPriceNum
      const size = sizeNum.toFixed(assetInfo.szDecimals)

      const result = await exchClient.order({
        orders: [{
          a: assetIdx,
          b: false,
          p: sellPrice,
          s: size,
          r: false,
          t: { limit: { tif: "Gtc" } }
        }],
        grouping: "na"
      })

      console.log(`[${coin}] ✅ SELL ${size} @ $${sellPrice} (mid=$${mid})`)
    } catch (e: any) {
      console.log(`[${coin}] ❌ ${e.message || e}`)
    }
  }
}

main()
