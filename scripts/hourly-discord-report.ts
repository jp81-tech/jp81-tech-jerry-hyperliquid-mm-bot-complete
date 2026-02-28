#!/usr/bin/env -S npx tsx
import * as hl from '@nktkas/hyperliquid';
import { config } from 'dotenv';
import { fetchAllFillsByTime } from '../src/utils/paginated_fills.js';

config();

const TOKENS = ['kPEPE'];

async function main() {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('DISCORD_WEBHOOK_URL not set');
    process.exit(1);
  }

  const walletAddress = process.env.ACCOUNT_ADDRESS || process.env.PUBLIC_ADDRESS;
  if (!walletAddress) {
    console.error('ACCOUNT_ADDRESS or PUBLIC_ADDRESS not set');
    process.exit(1);
  }

  const user = walletAddress.toLowerCase() as `0x${string}`;
  const transport = new hl.HttpTransport();
  const info = new hl.InfoClient({ transport });

  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const timeStr = new Date(now).toISOString().slice(11, 16) + ' UTC';

  // Fetch all data in parallel
  const [fills, orders, state] = await Promise.all([
    fetchAllFillsByTime(user, oneHourAgo, now),
    info.openOrders({ user }),
    info.clearinghouseState({ user }),
  ]);

  // Build position map: coin -> position data
  const posMap = new Map<string, { szi: string; entryPx: string; unrealizedPnl: string }>();
  for (const ap of state.assetPositions) {
    const p = ap.position;
    if (parseFloat(p.szi) !== 0) {
      posMap.set(p.coin, { szi: p.szi, entryPx: p.entryPx, unrealizedPnl: p.unrealizedPnl });
    }
  }

  // Build per-token report
  const lines: string[] = [];

  for (const token of TOKENS) {
    const tokenFills = fills.filter(f => f.coin === token);
    const buys = tokenFills.filter(f => f.side === 'B').length;
    const sells = tokenFills.filter(f => f.side === 'A').length;

    // PnL from fills
    let grossPnl = 0;
    let totalFees = 0;
    for (const f of tokenFills) {
      grossPnl += parseFloat(f.closedPnl);
      totalFees += parseFloat(f.fee);
    }
    const netPnl = grossPnl - totalFees;

    // Open orders
    const tokenOrders = orders.filter(o => o.coin === token);
    const bids = tokenOrders.filter(o => o.side === 'B').length;
    const asks = tokenOrders.filter(o => o.side === 'A').length;

    // Position
    const pos = posMap.get(token);

    lines.push(`**${token}**: ${tokenFills.length} fills (${buys} BUY, ${sells} SELL)`);

    if (pos) {
      const size = parseFloat(pos.szi);
      const side = size > 0 ? 'LONG' : 'SHORT';
      const absSize = Math.abs(size);
      const entry = parseFloat(pos.entryPx);
      const uPnl = parseFloat(pos.unrealizedPnl);
      lines.push(`  Position: ${side} ${absSize} @ $${fmtPrice(entry)} | uPnl: ${fmtUsd(uPnl)}`);
    } else {
      lines.push(`  Position: FLAT`);
    }

    lines.push(`  Orders: ${bids} bid, ${asks} ask`);
    lines.push(`  PnL: ${fmtUsd(grossPnl)} gross | ${fmtUsd(-totalFees)} fees | ${fmtUsd(netPnl)} net`);
    lines.push('');
  }

  // Account summary
  const equity = parseFloat(state.marginSummary.accountValue);
  let totalUPnl = 0;
  for (const ap of state.assetPositions) {
    totalUPnl += parseFloat(ap.position.unrealizedPnl);
  }

  const report = [
    `**MM Bot -- Hourly Report (${timeStr})**`,
    '```',
    ...lines.map(l => l.replace(/\*\*/g, '')),
    `Equity: $${equity.toFixed(0)} | uPnl: ${fmtUsd(totalUPnl)}`,
    '```',
  ].join('\n');

  console.log(report);

  // Send to Discord
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: report }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Discord webhook failed (${res.status}): ${body}`);
    process.exit(1);
  }

  console.log('Sent to Discord');
}

function fmtUsd(val: number): string {
  const sign = val >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(val).toFixed(2)}`;
}

function fmtPrice(px: number): string {
  if (px < 0.01) return px.toPrecision(4);
  if (px < 1) return px.toFixed(4);
  return px.toFixed(4);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
