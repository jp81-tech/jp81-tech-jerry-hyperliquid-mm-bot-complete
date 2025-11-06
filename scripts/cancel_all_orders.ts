import { ExchangeClient, InfoClient, HttpTransport } from "@nktkas/hyperliquid";
import { config } from "dotenv";
import { ethers } from "ethers";
config();

async function main() {
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  const transport = new HttpTransport();
  const info = new InfoClient({ transport });
  const ex = new ExchangeClient({ transport, wallet });
  
  const orders = await info.openOrders({ user: wallet.address });
  
  if (orders.length === 0) {
    console.log("✅ No open orders");
    return;
  }
  
  console.log(`🔨 Canceling ${orders.length} orders...`);
  
  const cancels = orders.map((o: any) => ({ a: 0, o: o.oid }));
  
  const result = await ex.cancel({ cancels });
  console.log(`✅ Result:`, result);
}

main().catch(console.error);
