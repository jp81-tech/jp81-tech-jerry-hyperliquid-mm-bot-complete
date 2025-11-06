#!/usr/bin/env -S npx tsx
import fs from "fs"
import path from "path"
import * as hl from "@nktkas/hyperliquid"
import { ethers } from "ethers"
import { config } from "dotenv"

config({ path: path.resolve(process.cwd(), ".env") })

const pk = process.env.PRIVATE_KEY
if (!pk) { 
  console.error("PRIVATE_KEY missing")
  process.exit(1)
}

const activePath = path.resolve(process.cwd(), "runtime/active_pairs.json")
const activeData = JSON.parse(fs.readFileSync(activePath, "utf8"))
const activePairs = activeData.pairs as string[]

const wallet = new ethers.Wallet(pk)
const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })
const exchClient = new hl.ExchangeClient({ wallet: pk, transport: new hl.HttpTransport() })

;(async () => {
  const addr = wallet.address
  
  // Fetch meta universe to get asset indices
  const meta = await infoClient.meta()
  const assetMap = new Map<string, number>()
  meta.universe.forEach((market, index) => {
    assetMap.set(market.name, index)
  })
  
  const openOrders = await infoClient.openOrders({ user: addr })
  
  const toCancel: Array<{ coin: string; oid: number; assetIndex: number }> = []
  
  for (const order of openOrders) {
    const coin = order.coin
    if (!activePairs.includes(coin)) {
      const assetIndex = assetMap.get(coin)
      if (assetIndex !== undefined) {
        toCancel.push({ coin, oid: order.oid, assetIndex })
      }
    }
  }
  
  if (toCancel.length === 0) {
    console.log("✅ OK: no non-active open orders")
    return
  }
  
  console.log(`🧹 Found ${toCancel.length} orders outside active pairs, canceling...`)
  
  for (const { coin, oid, assetIndex } of toCancel) {
    try {
      await exchClient.cancel({
        cancels: [{
          a: assetIndex,
          o: oid
        }]
      })
      console.log(`✅ Canceled ${coin} oid=${oid}`)
    } catch (e: any) {
      console.log(`⚠️  Skip ${coin} oid=${oid} reason=${e?.message || e}`)
    }
  }
})()
