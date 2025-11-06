import { HyperliquidExchangeClient } from '@nktkas/hyperliquid';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('No PRIVATE_KEY');

  const client = new HyperliquidExchangeClient(pk, false, 'https://api.hyperliquid.xyz');

  console.log('🔄 Closing NEAR and HYPE...');

  // NEAR
  try {
    await client.order({
      orders: [{
        asset: 'NEAR',
        isBuy: false,
        limitPx: 0,
        sz: 27.2,
        orderType: { limit: { tif: 'Ioc' } },
        reduceOnly: true
      }],
      grouping: 'na'
    });
    console.log('✅ NEAR closed');
  } catch (e: any) { console.log('⚠️ NEAR:', e.message); }

  await new Promise(r => setTimeout(r, 2000));

  // HYPE
  try {
    await client.order({
      orders: [{
        asset: 'HYPE',
        isBuy: false,
        limitPx: 0,
        sz: 77.62,
        orderType: { limit: { tif: 'Ioc' } },
        reduceOnly: true
      }],
      grouping: 'na'
    });
    console.log('✅ HYPE closed');
  } catch (e: any) { console.log('⚠️ HYPE:', e.message); }
}

main().catch(console.error);
