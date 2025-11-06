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
  const exchClient = new hl.ExchangeClient({ wallet: pk, transport: new hl.HttpTransport() })

  console.log(`🗑️  Force canceling ALL orders for: ${wallet.address}\n`)

  const orders = await infoClient.openOrders({ user: wallet.address })

  if (!orders || orders.length === 0) {
    console.log("✅ No open orders")
    return
  }

  console.log(`Found ${orders.length} orders, canceling...\n`)

  for (const order of orders) {
    try {
      console.log(`  Canceling ${order.coin} OID ${order.oid}...`)
      const result = await exchClient.cancel({
        cancels: [{ a: 0, o: order.oid }]
      })
      console.log(`  ✅ Result: ${result?.status || 'unknown'}`)
    } catch (e: any) {
      console.log(`  ❌ Error: ${e.message}`)
    }
  }

  console.log("\n✅ Done")
}

main()
