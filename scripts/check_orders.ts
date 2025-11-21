import * as hl from "@nktkas/hyperliquid";
import "dotenv/config";

async function main() {
  const transport = new hl.HttpTransport();
  const info = new hl.InfoClient({ transport });
  
  const walletAddr = process.env.WALLET_ADDRESS || "";
  const orders = await info.openOrders({ user: walletAddr });
  
  console.log("Open orders:");
  for (const o of orders?.openOrders || []) {
    const side = o.side || (o.isBuy ? "buy" : "sell");
    console.log(`  ${o.coin} ${side.toUpperCase()} ${o.sz} @ ${o.limitPx}`);
  }
}

main();
