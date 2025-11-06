#!/usr/bin/env -S npx tsx
import * as hl from "@nktkas/hyperliquid"
import { ethers } from "ethers"
import { config } from "dotenv"
import path from "path"

config({ path: path.resolve(process.cwd(), ".env") })

async function main() {
  const pk = process.env.PRIVATE_KEY
  if (!pk) {
    console.error("❌ PRIVATE_KEY not set")
    process.exit(1)
  }

  const wallet = new ethers.Wallet(pk)
  const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })

  console.log(`🔍 Checking open orders for wallet: ${wallet.address}\n`)

  const orders = await infoClient.openOrders({ user: wallet.address })

  if (!orders || orders.length === 0) {
    console.log("✅ No open orders")
    return
  }

  console.log(`📋 Found ${orders.length} open orders:\n`)

  for (const order of orders) {
    const age = Date.now() - (order.timestamp || 0)
    const ageMin = Math.floor(age / 60000)
    console.log(`  ${order.coin} | ${order.side} ${order.sz} @ ${order.limitPx} | Age: ${ageMin}min | OID: ${order.oid}`)
  }
}

main()
