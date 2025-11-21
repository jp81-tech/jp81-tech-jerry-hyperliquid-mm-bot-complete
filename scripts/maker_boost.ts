import * as hl from "@nktkas/hyperliquid";
import { readFileSync } from "fs";
import { join } from "path";
import "dotenv/config";

type Meta = Awaited<ReturnType<hl.InfoClient["meta"]>>;

function qSize(sz: number, lot: number, szDec: number) {
  const steps = Math.max(1, Math.floor(sz / lot));
  const s = steps * lot;
  return parseFloat(s.toFixed(szDec));
}

function roundToTick(px: number, tick: number) {
  if (!isFinite(px) || tick <= 0) return px;
  return Math.round(px / tick) * tick;
}

async function placeLayeredOrders(
  ex: hl.ExchangeClient,
  info: hl.InfoClient,
  meta: Meta,
  coin: string,
  walletAddr: string
) {
  const uIdx = meta.universe.findIndex(u => u.name === coin);
  if (uIdx < 0) {
    console.log(`[${coin}] skip: not in universe`);
    return;
  }
  const u = meta.universe[uIdx];
  const lot = Math.pow(10, -(u.szDecimals ?? 3));
  const tick = Math.pow(10, -(u.pxDecimals ?? 2));

  // Get mid price
  const l2 = await info.l2Book({ coin });
  if (!l2 || !l2.levels || l2.levels.length < 2) {
    console.log(`[${coin}] skip: no l2 data`);
    return;
  }

  let bestAsk = l2.levels[0]?.[0] ? parseFloat(l2.levels[0][0].px) : 0;
  let bestBid = l2.levels[1]?.[0] ? parseFloat(l2.levels[1][0].px) : 0;
  let mid = (bestAsk > 0 && bestBid > 0) ? (bestAsk + bestBid) / 2 : Math.max(bestAsk, bestBid);

  // Fallback to allMids
  if (!isFinite(mid) || mid <= 0) {
    try {
      const allMids = await info.allMids();
      const coinMid = allMids?.[coin];
      if (coinMid && isFinite(parseFloat(coinMid)) && parseFloat(coinMid) > 0) {
        mid = parseFloat(coinMid);
      }
    } catch (e) {}
  }

  if (!isFinite(mid) || mid <= 0) {
    console.log(`[${coin}] skip: no mid after fallback`);
    return;
  }

  // Config
  const makerNotional = parseFloat(process.env.MAKER_ORDER_NOTIONAL_USD || "175");
  const bps1 = parseFloat(process.env.MAKER_BPS || "10");
  const bps2 = parseFloat(process.env.MAKER_BPS_SECOND || "25");
  const maxPerSide = parseInt(process.env.MAKER_MAX_ORDERS_PER_SIDE || "1", 10);

  // Check existing orders
  const oo = await info.openOrders({ user: walletAddr }).catch(() => null);
  const mine = (oo?.openOrders || []).filter((o: any) => o.coin === coin);
  const mineBids = mine.filter((o: any) => o.side === "buy" || o.isBuy === true).length;
  const mineAsks = mine.filter((o: any) => o.side === "sell" || o.isBuy === false).length;

  // Place orders
  const layers = [
    { side: "buy", spread: bps1, current: mineBids },
    { side: "sell", spread: bps1, current: mineAsks },
    { side: "buy", spread: bps2, current: mineBids },
    { side: "sell", spread: bps2, current: mineAsks }
  ];

  for (const layer of layers) {
    if (layer.current >= maxPerSide) continue;

    const isBuy = layer.side === "buy";
    const pxRaw = isBuy ? mid * (1 - layer.spread / 10000) : mid * (1 + layer.spread / 10000);
    let px = roundToTick(pxRaw, tick);

    // SAFETY: Skip if price is negative or zero
    if (!isFinite(px) || px <= 0) {
      console.log(`[${coin}] skip ${layer.side} layer: invalid price`);
      continue;
    }

    // Ensure proper tick spacing
    if (isBuy && bestBid > 0 && px >= bestBid) px = bestBid - tick;
    if (!isBuy && bestAsk > 0 && px <= bestAsk) px = bestAsk + tick;

    // SAFETY: Check price deviation from mid (max 50% away)
    const deviation = Math.abs((px - mid) / mid);
    if (deviation > 0.5) {
      console.log(`[${coin}] skip ${layer.side} layer: price too far from mid (${(deviation*100).toFixed(1)}%)`);
      continue;
    }

    const szRaw = makerNotional / px;
    const sz = qSize(szRaw, lot, u.szDecimals ?? 3);

    if (!isFinite(sz) || sz <= 0) {
      console.log(`[${coin}] skip ${layer.side} layer: size<=0`);
      continue;
    }

    const payload: hl.OrderRequest = {
      action: "Order",
      orders: [{
        a: uIdx,
        s: String(sz),
        p: String(px),
        b: isBuy,
        t: { limit: { tif: "Alo" } },
        r: false
      }]
    };

    try {
      const res = await ex.order(payload);
      const ok = (res as any)?.status === "ok" || (res as any)?.status === "accepted";
      console.log(`[${coin}] ${layer.side.toUpperCase()} @${px} sz=${sz} bps=${layer.spread} status=${ok ? "ok" : "err"}`);
      await new Promise(r => setTimeout(r, 100)); // Anti-spam delay
    } catch (e: any) {
      if (e.response?.status === 422) {
        console.log(`[${coin}] skip ${layer.side}: 422 (duplicate)`);
      } else {
        console.log(`[${coin}] error ${layer.side}: ${e.message || e}`);
      }
    }
  }
}

async function main() {
  // Kill-switch check
  const enabled = process.env.MAKER_BOOST_ENABLED || "1";
  if (enabled !== "1" && enabled !== "true") {
    console.log("⏸️  MAKER_BOOST_ENABLED=0, exiting");
    return;
  }

  const transport = new hl.HttpTransport();
  const info = new hl.InfoClient({ transport });
  const meta = await info.meta();
  const ex = new hl.ExchangeClient({
    wallet: process.env.HL_PK || process.env.PRIVATE_KEY || "",
    transport
  });

  const walletAddr = process.env.WALLET_ADDRESS || process.env.WALLET_ADDR || process.env.HL_WALLET || "";

  const effPath = join(process.cwd(), "runtime/effective_active_pairs.json");
  const eff = JSON.parse(readFileSync(effPath, "utf8"));
  const coins: string[] = (eff?.pairs || []).map((x: string) => String(x));

  for (const c of coins) {
    try {
      await placeLayeredOrders(ex, info, meta, c, walletAddr);
    } catch (e) {
      console.log(`[${c}] error`, e);
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
