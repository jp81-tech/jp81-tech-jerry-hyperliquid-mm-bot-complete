import "dotenv/config"
import fs from "fs"
import path from "path"

type MarketStats = {
  pair: string
  realizedVol5m: number
  spreadBps: number
  topDepthUsd: number
  takerFeeBps: number
  smartFlow?: number
  trades1h?: number
}

type RotatorConfig = {
  weights: { w_vol:number, w_spread:number, w_depth:number, w_flow:number, w_fee:number }
  filters: { min_depth_usd:number, max_spread_bps:number, min_trades_5m:number }
  topN: number
}

function loadConfig(): RotatorConfig {
  const p = path.resolve(process.cwd(), process.env.ROTATOR_CONFIG_PATH ?? "rotator.config.json")
  return JSON.parse(fs.readFileSync(p, "utf8"))
}

function zScore(arr:number[]) {
  const m = arr.reduce((a,b)=>a+b,0)/Math.max(1,arr.length)
  const s = Math.sqrt(arr.reduce((a,b)=>a+(b-m)*(b-m),0)/Math.max(1,arr.length))
  return arr.map(v => s===0 ? 0 : (v-m)/s)
}

function simpleScore(stats: MarketStats[], cfg: RotatorConfig) {
  const volZ   = zScore(stats.map(s=>s.realizedVol5m))
  const sprZ   = zScore(stats.map(s=>s.spreadBps))
  const depthZ = zScore(stats.map(s=>s.topDepthUsd))
  const feeZ   = zScore(stats.map(s=>s.takerFeeBps))
  const flowZ  = zScore(stats.map(s=>s.smartFlow ?? 0))
  
  return stats.map((s,i)=>({
    pair: s.pair,
    score:
      cfg.weights.w_vol   * volZ[i]   +
    (- cfg.weights.w_spread)* sprZ[i]  +
      cfg.weights.w_depth * depthZ[i]  +
      cfg.weights.w_flow  * flowZ[i]   +
    (- cfg.weights.w_fee)  * feeZ[i],
    raw: { vol:s.realizedVol5m, spr:s.spreadBps, depth:s.topDepthUsd, fee:s.takerFeeBps, flow:s.smartFlow ?? 0 }
  })).sort((a,b)=>b.score-a.score)
}

const statsPath = process.env.ROTATOR_STATS_PATH ?? "reports/rotator_stats.json"
if (!fs.existsSync(statsPath)) {
  console.error(`stats_missing path=${statsPath}`)
  console.error("Create reports/rotator_stats.json with an array of MarketStats to score.")
  process.exit(2)
}

const stats: MarketStats[] = JSON.parse(fs.readFileSync(statsPath,"utf8"))
const cfg = loadConfig()

const filtered = stats.filter(s =>
  s.topDepthUsd >= cfg.filters.min_depth_usd &&
  s.spreadBps   <= cfg.filters.max_spread_bps &&
  (s.trades1h ?? 0) >= cfg.filters.min_trades_5m
)

if (filtered.length === 0) {
  console.error("no_candidates_after_filters")
  process.exit(3)
}

const ranked = simpleScore(filtered, cfg)
const topN = Number(process.env.ROTATE_TOP_N ?? cfg.topN ?? 3)
const selected = ranked.slice(0, topN)

console.log("rotation_evt=score_dump total=%d", ranked.length)
for (const r of ranked) {
  const raw = r.raw ?? {}
  console.log(`rotation_evt=score pair=${r.pair} score=${r.score.toFixed(4)} rv5m=${raw.vol ?? "?"} spr_bps=${raw.spr ?? "?"} depth=${raw.depth ?? "?"} fee_bps=${raw.fee ?? "?"} flow=${raw.flow ?? "?"}`)
}
console.log("rotation_evt=selected pairs=%s topN=%d", selected.map(s=>s.pair).join(","), topN)
