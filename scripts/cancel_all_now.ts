#!/usr/bin/env -S npx tsx
import * as hl from "@nktkas/hyperliquid";
import { ethers } from "ethers";

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    console.error("❌ PRIVATE_KEY not set");
    process.exit(1);
  }

  const wallet = new ethers.Wallet(pk);
  const sdk = new hl.Hyperliquid({ 
    walletClient: wallet,
    testnet: false 
  });

  console.log("🔨 Canceling ALL open orders for:", wallet.address);
  try {
    const result = await sdk.exchange.cancelAllOrders();
    console.log("✅ Result:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
