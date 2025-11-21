const fs = require("fs");
const path = require("path");

let hl;
try { hl = require("@nktkas/hyperliquid"); } catch(e) { hl = null; }

const ROOT = process.cwd();
const EFFECTIVE_FILE = path.join(ROOT, "runtime", "effective_active_pairs.json");

function readEffective() {
  try {
    const j = JSON.parse(fs.readFileSync(EFFECTIVE_FILE, "utf8"));
    const arr = Array.isArray(j.pairs) ? j.pairs : [];
    return new Set(arr.map(x => String(x).toUpperCase()));
  } catch {
    return new Set();
  }
}

let eff = readEffective();
let effTs = Date.now();
function refreshEffective() {
  const now = Date.now();
  if (now - effTs > 20_000) {
    eff = readEffective();
    effTs = now;
  }
}

let metaCache = null;
let infoClient = null;
async function getMeta() {
  if (!hl) return null;
  if (metaCache) return metaCache;
  if (!infoClient) infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() });
  metaCache = await infoClient.meta();
  return metaCache;
}

function tickForIdx(meta, a) {
  try {
    const u = meta.universe[a];
    const pxDec = u.pxDecimals ?? 4;
    return Math.pow(10, -pxDec);
  } catch { return 0; }
}

function nameFor(meta, orderItem) {
  if (typeof orderItem?.a === "number") {
    return meta?.universe?.[orderItem.a]?.name || null;
  }
  if (typeof orderItem?.coin === "string") {
    return orderItem.coin.toUpperCase();
  }
  return null;
}

function roundToTick(px, tick) {
  if (!isFinite(px) || !isFinite(tick) || tick <= 0) return px;
  return Math.round(px / tick) * tick;
}

async function maybeFixMarketReduceOnly(orderItem) {
  if (!hl) return orderItem;
  if (!orderItem || !orderItem.r) return orderItem;
  const t = orderItem.t || {};
  if (!("market" in t)) return orderItem;

  const meta = await getMeta();
  const coin = nameFor(meta, orderItem);
  if (!coin) return orderItem;

  const mid = await infoClient.mid({ coin });
  const a = orderItem.a ?? meta.universe.findIndex(u => u.name === coin);
  const tick = tickForIdx(meta, a);
  const isBuy = !!orderItem.b;

  const pxRaw = isBuy ? mid * 1.02 : mid * 0.98;
  const px = tick > 0 ? roundToTick(pxRaw, tick) : pxRaw;

  return {
    ...orderItem,
    p: String(px),
    t: { limit: { tif: "Ioc" } },
  };
}

function wrapExchangeOrder(ExchangeClient) {
  if (!ExchangeClient || ExchangeClient.__orderWrapped) return;
  const orig = ExchangeClient.prototype.order;

  ExchangeClient.prototype.order = async function(payload) {
    try {
      refreshEffective();
      const meta = hl ? await getMeta() : null;

      const items = Array.isArray(payload?.orders) ? payload.orders : [];
      const fixed = [];
      for (const it of items) {
        let coin = null;
        if (meta) coin = nameFor(meta, it);
        if (!coin && typeof it?.coin === "string") coin = it.coin.toUpperCase();

        if (coin && eff.size > 0 && !eff.has(coin)) {
          const msg = `[ORDER_GUARD] blocked coin=${coin} not in effective_active_pairs`;
          console.error(msg);
          continue;
        }

        let out = it;
        if (it?.r && it?.t && "market" in it.t) {
          try { out = await maybeFixMarketReduceOnly(it); } catch {}
        }
        fixed.push(out);
      }

      if (fixed.length === 0) {
        return { status: "blocked", reason: "no orders after guard" };
      }

      const guardedPayload = { ...payload, orders: fixed };
      return await orig.call(this, guardedPayload);
    } catch (e) {
      return await orig.call(this, payload);
    }
  };

  ExchangeClient.__orderWrapped = true;
}

try {
  if (hl && hl.ExchangeClient) {
    wrapExchangeOrder(hl.ExchangeClient);
    console.log("[ORDER_GUARD] ExchangeClient.order wrapped");
  } else {
    console.log("[ORDER_GUARD] hyperliquid SDK not found or missing ExchangeClient");
  }
} catch (e) {
  console.error("[ORDER_GUARD] init error", e);
}
