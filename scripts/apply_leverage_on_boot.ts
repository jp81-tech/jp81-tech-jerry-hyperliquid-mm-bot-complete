import dotenv from "dotenv";
dotenv.config();
import { ExchangeClient, InfoClient } from "@nktkas/hyperliquid";
import fs from "fs";

async function run() {
  const key = (process.env.PRIVATE_KEY || "").trim();
  if (!key) process.exit(0);
  const lev = Number(process.env.LEVERAGE || "2");
  if (!lev || lev < 1) process.exit(0);

  const f = "runtime/active_pairs.json";
  const pairs = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f,"utf8")).pairs||[]) : [];
  if (!pairs.length) process.exit(0);

  const info = new InfoClient("https://api.hyperliquid.xyz");
  const ex = new ExchangeClient("https://api.hyperliquid.xyz", key);
  const meta = await info.meta();
  const symToIdx = new Map<string, number>();
  meta.universe.forEach((u: any, i: number) => symToIdx.set(u.name.toUpperCase(), i));

  for (const s of pairs) {
    const idx = symToIdx.get(s.toUpperCase());
    if (idx === undefined) continue;
    try { await ex.updateLeverage({ asset: idx, isCross: false, leverage: BigInt(lev) }); }
    catch {}
  }
}
run();
