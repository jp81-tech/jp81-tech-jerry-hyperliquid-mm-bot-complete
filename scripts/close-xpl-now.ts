#!/usr/bin/env -S npx tsx
import * as hl from "@nktkas/hyperliquid"
import { ethers } from "ethers"
import { config } from "dotenv"
import path from "path"

config({ path: path.resolve(process.cwd(), ".env") })

async function main() {
  const pk = process.env.PRIVATE_KEY
  if (!pk) { console.error("❌ PRIVATE_KEY not set"); process.exit(1) }

  const wallet = new ethers.Wallet(pk)
  const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })
  const exchClient = new hl.ExchangeClient({ wallet: pk, transport: new hl.HttpTransport() })

  const coin = "XPL"
  const meta = await infoClient.meta()
  const assetIndex = meta.universe.findIndex(u => u.name === coin)
  const assetInfo = meta.universe[assetIndex]
  
  const state = await infoClient.clearinghouseState({ user: wallet.address })
  const pos = state?.assetPositions?.find((p: any) => p.position?.coin === coin)
  
  if (!pos) { console.log("No XPL position"); return }

  const size = Math.abs(Number(pos.position.szi)).toFixed(assetInfo.szDecimals)
  
  try { await exchClient.cancelAllOrders({ asset: assetIndex }) } catch {}

  const allMids = await infoClient.allMids()
  const mid = Number(allMids[coin])
  
  // 5% below mid, rounded to 0.0001
  const px = (Math.floor(mid * 0.95 * 10000) / 10000).toFixed(4)

  console.log(`Closing XPL ${size} @ ${px} (mid=${mid})`)

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

  console.log("✅ Result:", JSON.stringify(result, null, 2))
}

main()
