#!/usr/bin/env -S npx tsx

const WALLET = process.env.WALLET_ADDRESS || "0xF4620F6fb51FA2fdF3464e0b5b8186D14bC902fe";
const CLIP_USD = 35;

async function main() {
  const apiUrl = "https://api.hyperliquid.xyz/info";
  
  // Get user fills (last 100)
  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "userFills",
      user: WALLET
    })
  });

  const fills = await resp.json();
  
  if (!Array.isArray(fills) || fills.length === 0) {
    console.log("❌ No fills found");
    return;
  }

  console.log(`\n🔍 PATCH 2 VERIFICATION - Size Recalculation Check\n`);
  console.log(`Target CLIP_USD: ${CLIP_USD}`);
  console.log(`Analyzing last ${Math.min(fills.length, 50)} fills...\n`);

  const recentFills = fills.slice(0, 50);
  const results: { notional: number; deviation: number; coin: string; px: string; sz: string; time: string }[] = [];

  for (const fill of recentFills) {
    const coin = fill.coin;
    const px = parseFloat(fill.px);
    const sz = parseFloat(fill.sz);
    const notional = px * sz;
    const deviation = ((notional - CLIP_USD) / CLIP_USD) * 100;
    const time = new Date(parseInt(fill.time)).toISOString().substring(11, 19);
    
    results.push({ notional, deviation, coin, px: fill.px, sz: fill.sz, time });
  }

  // Statistics
  const deviations = results.map(r => Math.abs(r.deviation));
  const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  const maxDeviation = Math.max(...deviations);
  const exactOrders = results.filter(r => Math.abs(r.deviation) < 0.1).length;

  console.log(`📊 STATISTICS:\n`);
  console.log(`   Total orders analyzed: ${results.length}`);
  console.log(`   Exact ${CLIP_USD} USD (±0.1%): ${exactOrders}/${results.length} (${(exactOrders/results.length*100).toFixed(1)}%)`);
  console.log(`   Average deviation: ${avgDeviation.toFixed(3)}%`);
  console.log(`   Max deviation: ${maxDeviation.toFixed(3)}%`);
  
  console.log(`\n📋 SAMPLE (first 15 orders):\n`);
  for (let i = 0; i < Math.min(15, results.length); i++) {
    const r = results[i];
    const sign = r.deviation >= 0 ? "+" : "";
    console.log(`   ${r.time} | ${r.coin.padEnd(6)} | ${r.sz.padStart(10)} × ${r.px.padStart(12)} = $${r.notional.toFixed(2).padStart(6)} (${sign}${r.deviation.toFixed(2)}%)`);
  }

  console.log(`\n`);
  
  if (avgDeviation < 0.5 && exactOrders > results.length * 0.9) {
    console.log(`✅ PATCH 2 STATUS: ALREADY IMPLEMENTED`);
    console.log(`   Evidence: ${(exactOrders/results.length*100).toFixed(1)}% exact orders, avg deviation ${avgDeviation.toFixed(3)}%`);
    console.log(`   Bot correctly recalculates size after price quantization.`);
  } else {
    console.log(`❌ PATCH 2 STATUS: MISSING`);
    console.log(`   Evidence: Only ${(exactOrders/results.length*100).toFixed(1)}% exact orders, avg deviation ${avgDeviation.toFixed(3)}%`);
    console.log(`   Bot does NOT recalculate size properly - patch needed.`);
    console.log(`   Estimated daily loss: $${(avgDeviation/100 * CLIP_USD * 480).toFixed(2)}/day`);
  }
}

main().catch(console.error);
