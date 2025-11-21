#!/usr/bin/env -S npx tsx
import * as hl from "@nktkas/hyperliquid"
import { ethers } from "ethers"
import { config } from "dotenv"
import path from "path"

config({ path: path.resolve(process.cwd(), ".env") })

function roundToTickSize(price: number, tickSize: number): string {
  return (Math.round(price / tickSize) * tickSize).toFixed(8)
}

async function main() {
  const coins = process.argv.slice(2)
  if (coins.length === 0) {
    console.error("Usage: npx tsx scripts/force-close.ts COIN [COIN...]")
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

  // Get asset contexts
  const meta = await infoClient.meta()
  const assetMap = new Map(meta.universe.map((u, idx) => [u.name, { index: idx, szDecimals: u.szDecimals }]))

  for (const coin of coins) {
    try {
      console.log(`[${coin}] Checking position...`)
      
      const assetInfo = assetMap.get(coin)
      if (!assetInfo) {
        console.error(`[${coin}] asset not found in universe`)
        continue
      }

      const state = await infoClient.clearinghouseState({ user: wallet.address })
      const positions = state?.assetPositions ?? []
      const pos = positions.find((p: any) => p.position?.coin?.toUpperCase() === coin.toUpperCase())
      
      if (!pos || !pos.position || Math.abs(Number(pos.position.szi)) < 0.0001) {
        console.log(`[${coin}] no open position`)
        continue
      }

      const szi = Number(pos.position.szi)
      const isLong = szi > 0
      const size = Math.abs(szi).toFixed(assetInfo.szDecimals)

      // Cancel all orders first
      try {
        await exchClient.cancelAllOrders({ asset: assetInfo.index })
        console.log(`[${coin}] cancelled all orders`)
      } catch {}

      // Get mid price
      const allMids = await infoClient.allMids()
      const midPrice = Number(allMids[coin] || 0)
      
      if (!midPrice) {
        console.error(`[${coin}] cannot get mid price`)
        continue
      }

      // Use market order (no price, IOC will match best available)
      const result = await exchClient.order({
        orders: [{
          a: assetInfo.index,
          b: !isLong,
          p: (isLong ? midPrice * 0.95 : midPrice * 1.05).toFixed(1),
          s: size,
          r: true,
          t: { limit: { tif: "Ioc" } }
        }],
        grouping: "na"
      })

      console.log(`[${coin}] close submitted sz=${size} reduceOnly IOC`)
      console.log(`[${coin}] result:`, JSON.stringify(result, null, 2))
    } catch (e: any) {
      console.error(`[${coin}] close failed: ${e?.message || e}`)
      process.exitCode = 2
    }
  }
}

main()
