import fs from 'fs';

const state = JSON.parse(fs.readFileSync('data/bot_state.json', 'utf8'));
const trades = state.trades || [];

// Target window: 00:30 - 07:00 Dec 1 2025
// We need to be careful with timezone. Assuming user means local time.
// Let's print trades with readable timestamps to manual verify.

// Get trades from last 24h to be safe
const now = Date.now();
const oneDay = 24 * 60 * 60 * 1000;
const recentTrades = trades.filter(t => t.ts > (now - oneDay));

console.log(`Total trades: ${trades.length}`);
console.log(`Recent trades (last 24h): ${recentTrades.length}`);

if (recentTrades.length > 0) {
    console.log("Sample of recent trades:");
    recentTrades.slice(-20).forEach(t => {
        console.log(`${new Date(t.ts).toISOString()} ${t.pair} ${t.side} ${t.size} @ ${t.price} PnL: ${t.pnl}`);
    });
} else {
    console.log("No recent trades found.");
    // Print last trade anyway
    if (trades.length > 0) {
        const last = trades[trades.length - 1];
        console.log(`Last trade: ${new Date(last.ts).toISOString()} ${last.pair}`);
    }
}

