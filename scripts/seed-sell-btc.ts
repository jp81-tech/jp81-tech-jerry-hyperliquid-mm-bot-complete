import * as hl from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import "dotenv/config";

async function main() {
  const pk = (process.env.HL_PRIVATE_KEY || process.env.PRIVATE_KEY) as `0x${string}` | undefined;
  if (!pk) { console.error("Set PRIVATE_KEY"); process.exit(2); }

  const wallet = privateKeyToAccount(pk);
  const transport = new hl.HttpTransport();
  const info = new hl.InfoClient({ transport });
  const ex = new hl.ExchangeClient({ wallet, transport });

  const meta = await info.meta();
  const mids = await info.allMids();

  const coin = "BTC";
  const btcIdx = meta.universe.findIndex(u => u.name === coin);
  if (btcIdx < 0) throw new Error("BTC not found");

  const mid = Number((mids as any)[coin]);
  if (!isFinite(mid) || mid <= 0) throw new Error("no mid for BTC");

  // BTC tick size is 1.0
  const tick = 1.0;
  const targetNotional = 150;

  const rawPx = mid * 1.005; // 0.5% above mid  
  const px = Math.round(rawPx / tick) * tick;
  
  const rawSz = Math.max(0.001, targetNotional / px);
  const sz = rawSz.toFixed(3);

  console.log(`BTC: mid=${mid}, px=${px}, sz=${sz}, notional=$${(Number(sz) * px).toFixed(2)}`);

  const res = await ex.order({
    orders: [{ 
      a: btcIdx, 
      b: false, 
      p: px.toString(), 
      s: sz, 
      r: false, 
      t: { limit: { tif: "Gtc" } } 
    }],
    grouping: "na",
  });

  console.log(`✅ [BTC] SELL seeded px=${px} sz=${sz} status: ${(res as any).status}`);
}

main();
