#!/usr/bin/env -S npx tsx
import { ExchangeClient, InfoClient, HttpTransport } from '@nktkas/hyperliquid';
import { ethers } from 'ethers';
import { config } from 'dotenv';
import fs from 'fs';

config();

async function run() {
  const key = (process.env.PRIVATE_KEY || '').trim();
  if (!key) process.exit(0);
  const lev = Number(process.env.LEVERAGE || '1');
  if (!lev || lev < 1) process.exit(0);

  const f = 'runtime/active_pairs.json';
  const pairs = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')).pairs || []) : [];
  if (!pairs.length) process.exit(0);

  const wallet = new ethers.Wallet(key);
  const transport = new HttpTransport();
  const info = new InfoClient({ transport });
  const ex = new ExchangeClient({ transport, wallet });

  const meta = await info.meta();
  const symToIdx = new Map<string, number>();
  meta.universe.forEach((u: any, i: number) => symToIdx.set(u.name.toUpperCase(), i));

  for (const s of pairs) {
    const idx = symToIdx.get(s.toUpperCase());
    if (idx === undefined) continue;
    try {
      await ex.updateLeverage({ asset: idx, isCross: false, leverage: lev });
    } catch {}
  }
}

run();
