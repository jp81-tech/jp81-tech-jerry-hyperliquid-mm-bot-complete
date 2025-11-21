#!/usr/bin/env -S npx tsx
import * as hl from "@nktkas/hyperliquid"
import { ethers } from "ethers"
import { config } from "dotenv"
import path from "path"

config({ path: path.resolve(process.cwd(), ".env") })

async function main() {
  const coin = "XPL"
  
  const pk = process.env.PRIVATE_KEY
  if (!pk) {
    console.error("❌ PRIVATE_KEY not set")
    process.exit(1)
  }

  const wallet = new ethers.Wallet(pk)
  const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })
  const exchClient = new hl.ExchangeClient({ wallet: pk, transport: new hl.HttpTransport() })

  const meta = await infoClient.meta()
  const assetInfo = meta.universe.find(u => u.name === coin)
  const assetIndex = meta.universe.findIndex(u => u.name === coin)
  
  if (!assetInfo) {
    console.error(`Asset ${coin} not found`)
    process.exit(1)
  }

  const state = await infoClient.clearinghouseState({ user: wallet.address })
  const positions = state?.assetPositions ?? []
  const pos = positions.find((p: any) => p.position?.coin === coin)
  
  if (!pos || !pos.position) {
    console.log("No XPL position")
    process.exit(0)
  }

  const szi = Number(pos.position.szi)
  const size = Math.abs(szi).toFixed(assetInfo.szDecimals)

  console.log(`Closing XPL LONG ${size}`)

  // Cancel orders
  try {
    await exchClient.cancelAllOrders({ asset: assetIndex })
  } catch {}

  // Get mid
  const allMids = await infoClient.allMids()
  const mid = Number(allMids[coin])
  
  // Very aggressive price (50% below mid for instant fill)
  const px = (mid * 0.5).toFixed(6)

  const result = await exchClient.order({
    orders: [{
      a: assetIndex,
      b: false,
      p: px,
      s: size,
      r: true,
      t: { limit: { tif: "Ioc" } }
    }],
    grouping: "na"
  })

  console.log("Result:", JSON.stringify(result, null, 2))
}

main()
