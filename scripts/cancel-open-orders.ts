#!/usr/bin/env -S npx tsx
import * as hl from '@nktkas/hyperliquid';
import { ethers } from 'ethers';

async function cancelOpenOrders(coin: string) {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ PRIVATE_KEY not set');
    process.exit(1);
  }

  // Initialize clients
  const exchClient = new hl.ExchangeClient({
    wallet: privateKey,
    transport: new hl.HttpTransport()
  });

  const infoClient = new hl.InfoClient({
    transport: new hl.HttpTransport()
  });

  // Derive wallet address
  const wallet = new ethers.Wallet(privateKey);
  const walletAddress = wallet.address;

  console.log(`🔍 Checking open orders for ${coin} (wallet: ${walletAddress})...`);

  try {
    // Fetch open orders
    const orders = await infoClient.openOrders({ user: walletAddress });

    if (!orders || orders.length === 0) {
      console.log(`✅ No open orders at all`);
      return;
    }

    const coinOrders = orders.filter((o: any) => o.coin === coin);

    if (coinOrders.length === 0) {
      console.log(`✅ No open orders for ${coin}`);
      return;
    }

    console.log(`⚠️  Found ${coinOrders.length} open orders for ${coin}:`);
    for (const order of coinOrders) {
      console.log(`  - ${order.side} ${order.sz} @ ${order.limitPx} (oid: ${order.oid})`);
    }

    // Cancel all orders for this coin
    console.log(`🔨 Canceling ${coinOrders.length} orders...`);

    let successCount = 0;
    for (const order of coinOrders) {
      try {
        const result = await exchClient.cancel({
          cancels: [{ a: 0, o: order.oid }],
        });

        if (result && result.status === 'ok') {
          console.log(`  ✅ Canceled order ${order.oid}`);
          successCount++;
        } else {
          console.error(`  ❌ Failed to cancel order ${order.oid}:`, result);
        }
      } catch (err: any) {
        // Check if order was already canceled/filled
        if (err.message && (err.message.includes('already canceled') || err.message.includes('filled'))) {
          console.log(`  ℹ️  Order ${order.oid} already canceled or filled`);
          successCount++;
        } else {
          console.error(`  ❌ Error canceling order ${order.oid}:`, err.message || err);
        }
      }
    }

    console.log(`✅ Processed ${successCount}/${coinOrders.length} ${coin} orders`);
  } catch (err) {
    console.error(`❌ Fatal error:`, err);
    process.exit(1);
  }
}

const coin = process.argv[2];
if (!coin) {
  console.error('Usage: cancel-open-orders.ts <COIN>');
  process.exit(1);
}

cancelOpenOrders(coin);
