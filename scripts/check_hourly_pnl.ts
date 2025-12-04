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

  console.log(`📊 Analyzing ${trades.length} trades for hourly PnL...\n`);

  const hourlyPnL: Record<string, number> = {};
  const hourlyVolume: Record<string, number> = {};
  const hourlyTrades: Record<string, number> = {};

  trades.forEach((t: any) => {
    if (!t.pnl && t.pnl !== 0) return; // Skip trades without PnL info (e.g. open orders)

    const date = new Date(t.ts);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`;

    hourlyPnL[key] = (hourlyPnL[key] || 0) + (t.pnl || 0);
    hourlyVolume[key] = (hourlyVolume[key] || 0) + (t.price * t.size);
    hourlyTrades[key] = (hourlyTrades[key] || 0) + 1;
  });

  const sortedKeys = Object.keys(hourlyPnL).sort();

  // Show last 24 hours
  const recentKeys = sortedKeys.slice(-24);

  console.log('🕒 Hour (Local)    | 💰 PnL ($) | 📉 Vol ($) | 🔢 Trades');
  console.log('───────────────────────────────────────────────────────');

  let totalPnL = 0;
  let totalVol = 0;
  let totalCount = 0;

  recentKeys.forEach(key => {
    const pnl = hourlyPnL[key];
    const vol = hourlyVolume[key];
    const count = hourlyTrades[key];

    totalPnL += pnl;
    totalVol += vol;
    totalCount += count;

    const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
    const pnlColor = pnl >= 0 ? '\x1b[32m' : '\x1b[31m'; // Green or Red
    const reset = '\x1b[0m';

    console.log(`${key} | ${pnlColor}${pnlStr.padStart(10)}${reset} | ${vol.toFixed(0).padStart(8)} | ${count.toString().padStart(7)}`);
  });

  console.log('───────────────────────────────────────────────────────');
  const totalPnlStr = totalPnL >= 0 ? `+$${totalPnL.toFixed(2)}` : `-$${Math.abs(totalPnL).toFixed(2)}`;
  console.log(`Σ  Last ${recentKeys.length}h      | ${totalPnL >= 0 ? '\x1b[32m' : '\x1b[31m'}${totalPnlStr.padStart(10)}\x1b[0m | ${totalVol.toFixed(0).padStart(8)} | ${totalCount.toString().padStart(7)}`);

} catch (error) {
  console.error('Error reading state:', error);
}



