#!/usr/bin/env -S npx tsx
import { config } from 'dotenv';
import path from 'path';
import fs from 'fs';
import * as hl from '@nktkas/hyperliquid';

config({ path: path.resolve(process.cwd(), 'src/.env') });

type MarketStats = {
  pair: string;
  realizedVol5m: number;
  spreadBps: number;
  topDepthUsd: number;
  takerFeeBps: number;
  smartFlow?: number;
  trades1h?: number;
};

async function main() {
  const info = new hl.InfoClient({ transport: new hl.HttpTransport() });
  
  const meta = await info.meta();
  const pairs = meta.universe.map(u => u.name);
  
  const stats: MarketStats[] = [];
  
  for (const pair of pairs) {
    try {
      const l2 = await info.l2Book({ coin: pair });
      const levels = l2?.levels || [];
      
      if (levels.length === 0 || !levels[0]) continue;
      
      const bidPx = levels[0][0]?.px ? Number(levels[0][0].px) : 0;
      const askPx = levels[0][1]?.px ? Number(levels[0][1].px) : 0;
      
      if (!bidPx || !askPx || bidPx <= 0 || askPx <= 0) continue;
      
      const mid = (bidPx + askPx) / 2;
      const spread = ((askPx - bidPx) / mid) * 10000;
      
      const bidSz = levels[0][0]?.sz ? Number(levels[0][0].sz) : 0;
      const askSz = levels[0][1]?.sz ? Number(levels[0][1].sz) : 0;
      const depth = (bidSz * bidPx + askSz * askPx) / 2;
      
      stats.push({
        pair,
        realizedVol5m: 0.015,
        spreadBps: Math.round(spread * 10) / 10,
        topDepthUsd: Math.round(depth),
        takerFeeBps: 6,
        smartFlow: 0.05,
        trades1h: 100
      });
    } catch (e) {
      continue;
    }
  }
  
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync('reports/rotator_stats.json', JSON.stringify(stats, null, 2));
  
  console.log(`fetch_market_stats: collected ${stats.length} pairs`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
