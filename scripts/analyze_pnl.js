
const fs = require('fs');
const path = require('path');

const stateFile = path.join(__dirname, '../data/bot_state.json');

try {
  const data = fs.readFileSync(stateFile, 'utf8');
  const state = JSON.parse(data);
  const trades = state.trades || [];

  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000);

  // Filter for last hour
  const recentTrades = trades.filter(t => t.ts >= oneHourAgo);

  console.log(`Analyzing trades from the last hour (since ${new Date(oneHourAgo).toISOString()})...`);
  console.log(`Total trades found in state: ${trades.length}`);
  console.log(`Recent trades: ${recentTrades.length}`);

  if (recentTrades.length === 0) {
    console.log("No trades found in the last hour.");

    // Check if there are ANY trades from today to be helpful
    const todayStart = new Date();
    todayStart.setHours(0,0,0,0);
    const todayTrades = trades.filter(t => t.ts >= todayStart.getTime());
    console.log(`Trades today (${todayStart.toISOString()}): ${todayTrades.length}`);
    if (todayTrades.length > 0) {
        analyzeTrades(todayTrades, "Today's Trades");
    }
  } else {
    analyzeTrades(recentTrades, "Last Hour Trades");
  }

} catch (err) {
  console.error("Error reading/parsing state file:", err);
}

function analyzeTrades(tradeList, label) {
  const byPair = {};
  let totalPnl = 0;

  tradeList.forEach(t => {
    if (!byPair[t.pair]) {
      byPair[t.pair] = { pnl: 0, fees: 0, count: 0, volume: 0 };
    }
    const pnl = t.pnl || 0;
    const notional = t.price * t.size; // approximate

    byPair[t.pair].pnl += pnl;
    byPair[t.pair].count++;
    byPair[t.pair].volume += notional;
    totalPnl += pnl;
  });

  console.log(`\n=== ${label} Analysis ===`);
  console.table(Object.entries(byPair).map(([pair, stats]) => ({
    Pair: pair,
    "PnL ($)": stats.pnl.toFixed(4),
    "Trades": stats.count,
    "Vol ($)": stats.volume.toFixed(2)
  })));

  console.log(`\nTotal PnL: $${totalPnl.toFixed(4)}`);
}



