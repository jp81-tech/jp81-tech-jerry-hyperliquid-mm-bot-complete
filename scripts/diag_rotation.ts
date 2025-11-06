import fs from "fs";
import path from "path";
import { config as dotenv } from "dotenv";
dotenv({ path: path.resolve(process.cwd(), "src/.env") });

type ActivePairs = { pairs: string[]; ranked?: { pair: string; score?: number }[]; ts?: string };
const apath = path.resolve(process.cwd(), "runtime/active_pairs.json");
const has = fs.existsSync(apath) ? JSON.parse(fs.readFileSync(apath,"utf8")) as ActivePairs : {pairs:[]};

const deny = (process.env.ACTIVE_PAIRS_DENYLIST||"").split(",").map(s=>s.trim()).filter(Boolean);
const minVolPct = Number(process.env.MIN_VOLATILITY_PCT||"0");
const minFillsH = Number(process.env.ROTATION_MIN_FILLS_PER_HOUR||"0");
const ts = has.ts || "n/a";

function mockPairStats(p:string){
  return {
    pair: p,
    volatilityPct: 5,
    fillsPerHour: 50,
    marketOpen: true,
    paused:false
  };
}

type Verdict = { pair:string; ok:boolean; reasons:string[] };
const verdicts: Verdict[] = [];

for(const p of has.pairs){
  const v: Verdict = { pair:p, ok:true, reasons:[] };
  if(deny.includes(p)){ v.ok=false; v.reasons.push("denylist"); }
  const st = mockPairStats(p);
  if(!st.marketOpen || st.paused){ v.ok=false; v.reasons.push("market_closed_or_paused"); }
  if(st.volatilityPct < minVolPct){ v.ok=false; v.reasons.push(`volatility<${minVolPct}%`); }
  if(st.fillsPerHour < minFillsH){ v.ok=false; v.reasons.push(`fillsPerHour<${minFillsH}`); }
  verdicts.push(v);
}

const final = verdicts.filter(v=>v.ok).map(v=>v.pair);

console.log("=== DIAG ROTATION ===");
console.log("timestamp:", ts);
console.log("input_pairs:", has.pairs.join(",")||"(none)");
console.log("denylist:", deny.join(",")||"(empty)");
console.log("thresholds:", { minVolPct, minFillsH });
for(const v of verdicts){
  console.log(`pair=${v.pair} ok=${v.ok} reasons=${v.reasons.join("|")||"(none)"}`);
}
console.log("final_pairs:", final.join(",")||"(none)");
