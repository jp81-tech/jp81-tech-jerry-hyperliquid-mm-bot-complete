import 'dotenv/config'
import fs from 'fs'
import path from 'path'

type MarketStats = {
  pair: string
  realizedVol5m: number
  spreadBps: number
  topDepthUsd: number
  takerFeeBps: number
  smartFlow?: number
  trades1h?: number
}

type Ranked = { pair: string, score: number, raw?: any }

const CONFIG_PATH = process.env.ROTATOR_CONFIG_PATH ?? 'rotator.config.json'
const STATS_PATH  = process.env.ROTATOR_STATS_PATH  ?? 'reports/rotator_stats.json'
const OUT_PATH    = process.env.ROTATOR_OUT_PATH    ?? 'runtime/active_pairs.json'
const TOP_N       = Number(process.env.ROTATE_TOP_N ?? 6)
const EVERY_SEC   = Number(process.env.ROTATE_EVERY_SEC ?? 60)

function loadJSON<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function zscore(xs: number[]) {
  const m = xs.reduce((a,b)=>a+b,0)/Math.max(1,xs.length)
  const v = xs.reduce((a,b)=>a+(b-m)*(b-m),0)/Math.max(1,xs.length)
  const s = Math.sqrt(v)
  return xs.map(x => s === 0 ? 0 : (x - m)/s)
}

function scoreSimple(stats: MarketStats[], cfg: any): Ranked[] {
  const volZ   = zscore(stats.map(s=>s.realizedVol5m))
  const sprZ   = zscore(stats.map(s=>s.spreadBps))
  const depthZ = zscore(stats.map(s=>s.topDepthUsd))
  const feeZ   = zscore(stats.map(s=>s.takerFeeBps))
  const flowZ  = zscore(stats.map(s=>s.smartFlow ?? 0))
  const W = cfg.weights
  return stats.map((s,i)=>({
    pair: s.pair,
    score: W.w_vol*volZ[i] - W.w_spread*sprZ[i] + W.w_depth*depthZ[i] + W.w_flow*flowZ[i] - W.w_fee*feeZ[i],
    raw: { vol:s.realizedVol5m, spr:s.spreadBps, depth:s.topDepthUsd, fee:s.takerFeeBps, flow:s.smartFlow ?? 0 }
  })).sort((a,b)=>b.score-a.score)
}

function filter(stats: MarketStats[], cfg: any) {
  const F = cfg.filters
  const denylist = new Set(F.denylist || [])
  return stats.filter(s =>
    !denylist.has(s.pair) &&
    s.topDepthUsd >= F.min_depth_usd &&
    s.spreadBps   <= F.max_spread_bps &&
    (s.trades1h ?? 0) >= (F.min_trades_5m ?? 0)
  )
}

function runOnce() {
  if (!fs.existsSync(CONFIG_PATH) || !fs.existsSync(STATS_PATH)) return
  const cfg = loadJSON<any>(CONFIG_PATH)
  const all = loadJSON<MarketStats[]>(STATS_PATH)
  const cand = filter(all, cfg)
  if (cand.length === 0) return
  const ranked = scoreSimple(cand, cfg)
  const selected = ranked.slice(0, TOP_N).map(r => r.pair)
  const out = { pairs: selected, ranked, ts: new Date().toISOString() }
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2))
  console.log(`rotation_evt=selected pairs=${selected.join(',')} topN=${TOP_N}`)
}

runOnce()
