#!/usr/bin/env -S npx tsx
import * as hl from "@nktkas/hyperliquid"
import { ethers } from "ethers"
import { config } from "dotenv"
import path from "path"

config({ path: path.resolve(process.cwd(), ".env") })

async function main() {
  const pk = process.env.PRIVATE_KEY!
  const wallet = new ethers.Wallet(pk)
  const exchClient = new hl.ExchangeClient({ wallet: pk, transport: new hl.HttpTransport() })
  const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })

  console.log("🔍 Checking ETH position...")
  
  const state = await infoClient.clearinghouseState({ user: wallet.address })
  const pos = state?.assetPositions?.find((p: any) => p.position?.coin === "ETH")
  
  if (!pos) {
    console.log("✅ No ETH position")
    return
  }

  const size = Math.abs(Number(pos.position.szi))
  console.log(`🔴 Closing ETH LONG ${size} coins via reduce-only market...`)

  // Market sell via extreme low limit + IOC + reduce-only
  const result = await exchClient.order({
    orders: [{
      a: 0, // asset index (0 for perpetuals)
      b: false, // SELL
      p: "1", // extreme low price = market
      s: size.toString(),
      r: true, // reduce-only
      t: { limit: { tif: "Ioc" } },
      c: `close_ETH_${Date.now()}`
    }]
  })
  
  console.log("✅ Result:", JSON.stringify(result, null, 2))
}

main().catch(e => {
  console.error("❌", e.message)
  process.exit(1)
})
