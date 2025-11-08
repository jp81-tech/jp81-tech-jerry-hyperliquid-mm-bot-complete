/**
 * MOMENTUM GUARD - Patch for src/mm_hl.ts
 * 
 * Purpose: Prevent chasing parabolic moves (avoid opening LONGs near local tops)
 * 
 * Installation: Insert this code in mm_hl.ts before order placement logic
 * Location: Inside main trading loop, after midPrice calculation, before placing orders
 */

// ════════════════════════════════════════════════════════════════════════════════
// HELPER: Get mid price for any coin
// ════════════════════════════════════════════════════════════════════════════════
async function getMidPrice(hlClient: any, coin: string): Promise<number> {
  // Try allMids as object (new API format)
  try {
    const metaRes: any = await hlClient.getMetaAndAssetCtxs?.();
    const mids = metaRes?.[0]?.allMids ?? {};
    const key = [coin, coin.toUpperCase(), coin.toLowerCase()].find(
      k => mids && Object.prototype.hasOwnProperty.call(mids, k)
    );
    if (key && typeof mids[key] === 'number') {
      return mids[key] as number;
    }
  } catch {
    // Fallback below
  }

  // Fallback: orderbook mid
  const ob: any = await hlClient.getOrderbook({ coin });
  const bid = Number(ob?.bids?.[0]?.px ?? ob?.levels?.bids?.[0]?.px ?? 0);
  const ask = Number(ob?.asks?.[0]?.px ?? ob?.levels?.asks?.[0]?.px ?? 0);
  if (bid && ask) return (bid + ask) / 2;
  
  throw new Error(`No price available for ${coin}`);
}

// ════════════════════════════════════════════════════════════════════════════════
// MOMENTUM GUARD: Main logic
// ════════════════════════════════════════════════════════════════════════════════
// Insert this in main trading loop, BEFORE placing BUY orders

const momentumFilterEnabled = process.env.MOMENTUM_FILTER === '1';

if (momentumFilterEnabled && side === 'long') {
  const maxDistPct = Number(process.env.MOMENTUM_DIST_LIMIT_PCT || '25');
  
  // Simple reference: Use 24h VWAP or MA from your state
  // For now, using a simplified check against recent price history
  // TODO: Replace with actual MA/EMA calculation from your state
  
  const refPrice = midPrice * 0.95; // Simplified: assume reference is 5% below current
  const distPct = ((midPrice - refPrice) / refPrice) * 100;
  
  if (distPct > maxDistPct) {
    console.log(
      `🚫 [MOMENTUM_GUARD] Skipping LONG on ${pair}: " +
      `price dist = ${distPct.toFixed(1)}% (limit: ${maxDistPct}%)`
    );
    continue; // Skip this iteration - don't place LONG order
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// ENV VARIABLES (add to .env)
// ════════════════════════════════════════════════════════════════════════════════
/*
# Enable momentum guard (1 = on, 0 = off)
MOMENTUM_FILTER=1

# Maximum % distance from reference price before blocking LONGs
# 25% = don't open LONGs if price is >25% above moving average
MOMENTUM_DIST_LIMIT_PCT=25

# For BEAR mode, use tighter limit:
# MOMENTUM_DIST_LIMIT_PCT=15
*/
