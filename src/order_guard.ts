import { ExchangeClient, InfoClient, HttpTransport } from "@nktkas/hyperliquid"
import fs from "fs"
import path from "path"

const ROOT = process.cwd()
const EFFECTIVE_FILE = path.join(ROOT, "runtime", "effective_active_pairs.json")

function readEffective(): Set<string> {
  try {
    const j = JSON.parse(fs.readFileSync(EFFECTIVE_FILE, "utf8"))
    const arr = Array.isArray(j.pairs) ? j.pairs : []
    return new Set(arr.map((x: any) => String(x).toUpperCase()))
  } catch {
    return new Set<string>()
  }
}

let eff = readEffective()
let effTs = Date.now()
function refreshEffective() {
  const now = Date.now()
  if (now - effTs > 20000) {
    eff = readEffective()
    effTs = now
  }
}

let metaCache: any = null
let infoClient: InfoClient | null = null
async function getMeta(): Promise<any> {
  if (metaCache) return metaCache
  infoClient = new InfoClient({ transport: new HttpTransport() })
  metaCache = await infoClient.meta()
  return metaCache
}

function nameFor(meta: any, orderItem: any): string | null {
  if (typeof orderItem?.a === "number") return meta?.universe?.[orderItem.a]?.name || null
  if (typeof orderItem?.coin === "string") return orderItem.coin.toUpperCase()
  return null
}

function tickForIdx(meta: any, a: number): number {
  try {
    const u = meta.universe[a]
    const pxDec = u.pxDecimals ?? 4
    return Math.pow(10, -pxDec)
  } catch { return 0 }
}

function roundToTick(px: number, tick: number) {
  if (!isFinite(px) || !isFinite(tick) || tick <= 0) return px
  return Math.round(px / tick) * tick
}

async function maybeFixMarketReduceOnly(orderItem: any): Promise<any> {
  if (!orderItem?.r) return orderItem
  const t = orderItem.t || {}
  if (!("market" in t)) return orderItem
  const meta = await getMeta()
  const coin = nameFor(meta, orderItem)
  if (!coin || !infoClient) return orderItem
  const mid = await infoClient.mid({ coin })
  const a = typeof orderItem.a === "number" ? orderItem.a : meta.universe.findIndex((u: any) => u.name === coin)
  const tick = tickForIdx(meta, a)
  const isBuy = !!orderItem.b
  const pxRaw = isBuy ? mid * 1.02 : mid * 0.98
  const px = tick > 0 ? roundToTick(pxRaw, tick) : pxRaw
  return { ...orderItem, p: String(px), t: { limit: { tif: "Ioc" } } }
}

export async function installOrderGuard() {
  const anyEC: any = ExchangeClient as any
  if (!anyEC || anyEC.__orderWrapped) return
  const orig = anyEC.prototype.order
  anyEC.prototype.order = async function(payload: any) {
    refreshEffective()
    const meta = await getMeta()
    const items = Array.isArray(payload?.orders) ? payload.orders : []
    const fixed: any[] = []
    for (const it of items) {
      let coin: string | null = null
      if (meta) coin = nameFor(meta, it)
      if (!coin && typeof it?.coin === "string") coin = it.coin.toUpperCase()
      if (coin && eff.size > 0 && !eff.has(coin)) {
        console.error(`[ORDER_GUARD] blocked coin=${coin} not in effective_active_pairs`)
        continue
      }
      let out = it
      if (it?.r && it?.t && "market" in it.t) {
        try { out = await maybeFixMarketReduceOnly(it) } catch {}
      }
      fixed.push(out)
    }
    if (fixed.length === 0) return { status: "blocked", reason: "no orders after guard" }
    const guarded = { ...payload, orders: fixed }
    return await orig.call(this, guarded)
  }
  anyEC.__orderWrapped = true
  console.log("[ORDER_GUARD] ExchangeClient.order wrapped")
}
