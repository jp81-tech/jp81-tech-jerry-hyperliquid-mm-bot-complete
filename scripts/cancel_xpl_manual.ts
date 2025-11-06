#!/usr/bin/env -S npx tsx
import { Hyperliquid } from 'hyperliquid';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), 'src/.env') });

const pk = process.env.PRIVATE_KEY;
if (!pk) throw new Error('PRIVATE_KEY not found');

const sdk = new Hyperliquid({ privateKey: pk, testnet: false });

const oids = [224301746471, 224301694026];

(async () => {
  for (const oid of oids) {
    try {
      console.log(`Canceling ${oid}...`);
      await sdk.cancel({ oid });
      await new Promise(r => setTimeout(r, 300));
      console.log(`  ✅ Done`);
    } catch (e: any) {
      console.log(`  ❌ ${e.message}`);
    }
  }
})();
