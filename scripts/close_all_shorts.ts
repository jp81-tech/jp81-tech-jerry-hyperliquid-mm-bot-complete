#!/usr/bin/env -S npx tsx
import * as hl from '@nktkas/hyperliquid';
import { ethers } from 'ethers';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env') });

const pk = process.env.HYPERLIQUID_PRIVATE_KEY!;
const wallet = new ethers.Wallet(pk);

const infoClient = new hl.InfoClient({ url: 'https://api.hyperliquid.xyz' });
const exchangeClient = new hl.ExchangeClient({  
  walletClient: new hl.WalletClient(wallet.privateKey),
  url: 'https://api.hyperliquid.xyz',
  transport: new hl.HttpTransport()
});

async function closePosition(coin: string, size: number) {
  const mids = await infoClient.allMids();
  const mid = parseFloat(mids.find((m: any) => m.coin === coin)?.mid || '0');
  
  if (mid === 0) {
    console.log(`❌ No mid price for ${coin}`);
    return;
  }
  
  const buyPrice = (mid * 1.003).toFixed(4);
  console.log(`Closing ${coin} SHORT ${size} @ ${buyPrice} (mid=${mid})`);
  
  const result = await exchangeClient.order({
    coin,
    is_buy: true,
    sz: size,
    limit_px: parseFloat(buyPrice),
    order_type: { limit: { tif: 'Ioc' } },
    reduce_only: true
  }, 'na');
  
  console.log(`✅ Result: ${JSON.stringify(result).substring(0, 200)}`);
}

(async () => {
  await closePosition('BOME', 87500);
  await new Promise(r => setTimeout(r, 500));
  await closePosition('HMSTR', 3733312);
})();
