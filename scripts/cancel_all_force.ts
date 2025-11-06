import * as hl from '@nktkas/hyperliquid';
import { ethers } from 'ethers';

async function cancelAll() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('PRIVATE_KEY not set');
  
  const wallet = new ethers.Wallet(pk);
  const walletAddress = await wallet.getAddress();
  
  const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() });
  const exchClient = new hl.ExchangeClient({ wallet: pk, transport: new hl.HttpTransport() });
  
  // Get meta for asset indices
  const meta = await infoClient.meta();
  const assetMap = new Map<string, number>();
  meta.universe.forEach((market, index) => {
    assetMap.set(market.name, index);
  });
  
  // Get all open orders
  const orders = await infoClient.openOrders({ user: walletAddress });
  console.log(`Found ${orders.length} open orders`);
  
  for (const order of orders) {
    const coin = order.coin;
    const oid = order.oid;
    const assetIndex = assetMap.get(coin);
    
    if (assetIndex === undefined) {
      console.log(`Skip ${coin} - no asset index`);
      continue;
    }
    
    try {
      const result = await exchClient.cancel({
        cancels: [{ a: assetIndex, o: oid }]
      });
      console.log(`✅ Canceled ${coin} OID ${oid}`);
    } catch (e) {
      console.log(`❌ Failed ${coin} OID ${oid}: ${e}`);
    }
  }
  
  console.log('✅ All done');
}

cancelAll().catch(console.error);
