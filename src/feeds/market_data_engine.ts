import fetch from "node-fetch"
import fs from "fs"
import path from "path"

type OhlcCandle = [number, string, string, string, string, string, string, number]

interface Metrics {
  ts: number
  midPx: number | null
  ret1m: number | null
  ret5m: number | null
  rsi5m: number | null
  high24h: number | null
}

function envNum(key: string, def: number): number {
  const v = process.env[key]
  if (!v) return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

function getRuntimeDir(): string {
  const fromEnv = process.env.MDE_RUNTIME_DIR
  if (fromEnv) return path.resolve(fromEnv)
  return path.join(process.cwd(), "runtime")
}

async function fetchOhlc(pair: string): Promise<OhlcCandle[]> {
  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=1`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Kraken OHLC error ${res.status}`)
  }
  const json: any = await res.json()
  if (json.error && json.error.length > 0) {
    throw new Error(`Kraken OHLC error: ${json.error.join(",")}`)
  }
  const key = Object.keys(json.result).find((k) => k !== "last")
  if (!key) return []
  return json.result[key] as OhlcCandle[]
}

async function fetchTicker(pair: string): Promise<{ mid: number | null; high24h: number | null }> {
  const url = `https://api.kraken.com/0/public/Ticker?pair=${pair}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Kraken Ticker error ${res.status}`)
  }
  const json: any = await res.json()
  if (json.error && json.error.length > 0) {
    throw new Error(`Kraken Ticker error: ${json.error.join(",")}`)
  }
  const key = Object.keys(json.result)[0]
  if (!key) return { mid: null, high24h: null }
  const t = json.result[key]
  const ask = Number(t.a?.[0] ?? NaN)
  const bid = Number(t.b?.[0] ?? NaN)
  const high24 = Number(t.h?.[1] ?? NaN)
  const mid = Number.isFinite(ask) && Number.isFinite(bid) ? (ask + bid) / 2 : null
  return { mid, high24h: Number.isFinite(high24) ? high24 : null }
}

function calcRet(closes: number[], minutes: number): number | null {
  if (closes.length <= minutes) return null
  const last = closes[closes.length - 1]
  const prev = closes[closes.length - 1 - minutes]
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) return null
  return last / prev - 1
}

function calcRsi(closes: number[], period: number): number | null {
  if (closes.length <= period) return null
  let gains = 0
  let losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff
    else losses -= diff
  }
  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

async function buildMetrics(symbol: string, krakenPair: string): Promise<Metrics> {
  const ohlc = await fetchOhlc(krakenPair)
  if (!ohlc || ohlc.length < 6) {
    return {
      ts: Date.now(),
      midPx: null,
      ret1m: null,
      ret5m: null,
      rsi5m: null,
      high24h: null,
    }
  }

  const closes = ohlc.map((c) => Number(c[4])).filter((x) => Number.isFinite(x))
  const ret1m = calcRet(closes, 1)
  const ret5m = calcRet(closes, 5)
  const rsi5m = calcRsi(closes, 14)

  const ticker = await fetchTicker(krakenPair)

  return {
    ts: Date.now(),
    midPx: ticker.mid,
    ret1m,
    ret5m,
    rsi5m,
    high24h: ticker.high24h,
  }
}

function writeMetrics(symbol: string, m: Metrics) {
  const dir = getRuntimeDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const file = path.join(dir, `market_metrics_${symbol.toUpperCase()}.json`)
  fs.writeFileSync(file, JSON.stringify(m), "utf8")
}

async function loop() {
  const uniPair = process.env.MDE_UNI_PAIR || "UNIUSD"
  const zecPair = process.env.MDE_ZEC_PAIR || "ZECUSD"
  const pollSec = envNum("MDE_POLL_SEC", 10)

  console.log(`Starting MarketDataEngine (Kraken): UNI=${uniPair}, ZEC=${zecPair}, poll=${pollSec}s`)
  while (true) {
    const start = Date.now()
    try {
      const [uni, zec] = await Promise.all([
        buildMetrics("UNI", uniPair),
        buildMetrics("ZEC", zecPair),
      ])

      writeMetrics("UNI", uni)
      writeMetrics("ZEC", zec)

      console.log(
        `MDE tick: UNI ret1m=${uni.ret1m?.toFixed(4)} ret5m=${uni.ret5m?.toFixed(
          4,
        )} rsi5m=${uni.rsi5m?.toFixed(1)} | ZEC ret1m=${zec.ret1m?.toFixed(
          4,
        )} ret5m=${zec.ret5m?.toFixed(4)} rsi5m=${zec.rsi5m?.toFixed(1)}`,
      )
    } catch (err: any) {
      console.error("MDE error:", err?.message || String(err))
    }

    const elapsed = (Date.now() - start) / 1000
    const sleepMs = Math.max(1000, pollSec * 1000 - elapsed * 1000)
    await new Promise((resolve) => setTimeout(resolve, sleepMs))
  }
}

loop().catch((e) => {
  console.error("Fatal MDE error:", e)
  process.exit(1)
})
