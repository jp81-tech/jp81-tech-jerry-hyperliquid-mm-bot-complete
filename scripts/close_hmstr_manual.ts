import { Exchange } from '@nktkas/hyperliquid';

async function closePosition() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY not set');
  }

  const exchange = new Exchange({ privateKey, testnet: false });
  
  // Get current position
  const positions = await exchange.getPositions();
  const hmstr = positions.find(p => p.coin === 'HMSTR');
  
  if (!hmstr) {
    console.log('✅ No HMSTR position found');
    return;
  }
  
  const size = parseFloat(hmstr.szi);
  console.log(`📊 Current HMSTR position: ${size}`);
  
  if (size < 0) {
    // SHORT position, need to BUY to close
    const closeSize = Math.abs(size);
    console.log(`🔨 Placing LONG market order for ${closeSize} to close SHORT`);
    
    const result = await exchange.placeOrder({
      coin: 'HMSTR',
      is_buy: true,
      sz: closeSize,
      limit_px: 0, // market order
      order_type: { limit: { tif: 'Ioc' } },
      reduce_only: true
    });
    
    console.log('✅ Close order result:', JSON.stringify(result, null, 2));
  } else {
    console.log('ℹ️  Position is LONG, not SHORT - no action needed');
  }
}

closePosition().catch(console.error);
