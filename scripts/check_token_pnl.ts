import fs from 'fs';
import path from 'path';

const STATE_FILE = path.join(process.cwd(), 'data/bot_state.json');

try {
  if (!fs.existsSync(STATE_FILE)) {
    console.error('❌ No bot state file found at', STATE_FILE);
    process.exit(1);
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const trades = state.trades || [];

  if (trades.length === 0) {
    console.log('⚠️  No trades recorded yet.');
    process.exit(0);
  }

  // Filter trades from the last few hours (since approx 16:00 when changes were applied)
  // Assuming 16:00 local time as the start of "new settings" based on previous PnL check
  const now = new Date();
  // Look back 2 hours to cover the recent period
  const lookbackMs = 2 * 60 * 60 * 1000;
  const cutoffTime = Date.now() - lookbackMs;

  const recentTrades = trades.filter((t: any) => t.ts >= cutoffTime && (t.pnl || t.pnl === 0));

  console.log(`📊 Analyzing per-token PnL for the last 2 hours (${recentTrades.length} trades)...\n`);

  const tokenStats: Record<string, { pnl: number, vol: number, count: number }> = {};

  recentTrades.forEach((t: any) => {
    const pair = t.pair;
    if (!tokenStats[pair]) {
      tokenStats[pair] = { pnl: 0, vol: 0, count: 0 };
    }
    tokenStats[pair].pnl += (t.pnl || 0);
    tokenStats[pair].vol += (t.price * t.size);
    tokenStats[pair].count += 1;
  });

  console.log('🪙 Token          | 💰 PnL ($) | 📉 Vol ($) | 🔢 Trades');
  console.log('───────────────────────────────────────────────────────');

  let totalPnL = 0;
  let totalVol = 0;
  let totalCount = 0;

  // Sort by PnL descending
  const sortedTokens = Object.keys(tokenStats).sort((a, b) => tokenStats[b].pnl - tokenStats[a].pnl);

  sortedTokens.forEach(pair => {
    const stats = tokenStats[pair];
    totalPnL += stats.pnl;
    totalVol += stats.vol;
    totalCount += stats.count;

    const pnlStr = stats.pnl >= 0 ? `+$${stats.pnl.toFixed(2)}` : `-$${Math.abs(stats.pnl).toFixed(2)}`;
    const pnlColor = stats.pnl >= 0 ? '\x1b[32m' : '\x1b[31m'; // Green or Red
    const reset = '\x1b[0m';

    console.log(`${pair.padEnd(15)} | ${pnlColor}${pnlStr.padStart(10)}${reset} | ${stats.vol.toFixed(0).padStart(8)} | ${stats.count.toString().padStart(7)}`);
  });

  console.log('───────────────────────────────────────────────────────');
  const totalPnlStr = totalPnL >= 0 ? `+$${totalPnL.toFixed(2)}` : `-$${Math.abs(totalPnL).toFixed(2)}`;
  console.log(`Σ  TOTAL           | ${totalPnL >= 0 ? '\x1b[32m' : '\x1b[31m'}${totalPnlStr.padStart(10)}\x1b[0m | ${totalVol.toFixed(0).padStart(8)} | ${totalCount.toString().padStart(7)}`);

} catch (error) {
  console.error('Error reading state:', error);
}



