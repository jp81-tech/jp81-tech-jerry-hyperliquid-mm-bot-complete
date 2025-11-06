import { config as dotenv } from "dotenv";
import path from "path";
dotenv({ path: path.resolve(process.cwd(), "src/.env") });
import fs from "fs";
import { execSync } from "child_process";

function envNum(k:string, d:number=0){ const v = process.env[k]; return v ? Number(v) : d }
function envBool(k:string){ return (process.env[k]||"").toLowerCase()==="true" }

type Order = { pair:string, side:string, price:number, size:number }
function parseCheckAllOrders(out:string): Order[] {
  const lines = out.split("\n").filter(l=>l.includes("|"));
  const rows: Order[] = [];
  for(const l of lines){
    const parts = l.split("|").map(s=>s.trim());
    if(parts.length<4) continue;
    const pair = parts[0];
    const side = parts[1];
    rows.push({ pair, side, price:0, size:0 });
  }
  return rows;
}

async function main(){
  const ts = new Date().toISOString();
  const activePairsPath = path.join(process.cwd(),"runtime","active_pairs.json");
  let inputPairs: string[] = [];
  try{
    const j = JSON.parse(fs.readFileSync(activePairsPath,"utf8"));
    inputPairs = (j.pairs||[]).map((x:string)=>String(x));
  }catch{}

  let raw = "";
  try{
    raw = execSync("npx tsx scripts/check-all-orders.ts",{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
  }catch(e:any){
    raw = String(e?.stdout||"");
  }
  const orders = parseCheckAllOrders(raw);
  const byPair: Record<string,Order[]> = {};
  for(const o of orders){
    if(!byPair[o.pair]) byPair[o.pair]=[];
    byPair[o.pair].push(o);
  }

  const ACTIVE_LAYERS = envNum("ACTIVE_LAYERS",4);
  const LAYER_OFFSETS_BPS = (process.env.LAYER_OFFSETS_BPS||"").split(",").map(x=>Number(x.trim())).filter(x=>!Number.isNaN(x));
  const CLIP_USD = envNum("CLIP_USD",60);
  const MIN_LAYER_NOTIONAL_USD = envNum("MIN_LAYER_NOTIONAL_USD",20);
  const MAKER_SPREAD_BPS_MIN = envNum("MAKER_SPREAD_BPS_MIN",0);
  const MAKER_SPREAD_BPS_MAX = envNum("MAKER_SPREAD_BPS_MAX",0);
  const ENABLE_MULTI_LAYER = envBool("ENABLE_MULTI_LAYER");
  const ENABLE_QUOTE_CHASE = envBool("ENABLE_QUOTE_CHASE");
  const INVENTORY_SKEW_K = envNum("INVENTORY_SKEW_K",0);
  const DRIFT_SKEW_BPS = envNum("DRIFT_SKEW_BPS",0);

  const pairs = inputPairs.length ? inputPairs : Object.keys(byPair);
  const lines: string[] = [];
  for(const p of pairs){
    const os = byPair[p]||[];
    const layers = os.length;
    const buys = os.filter(o=>o.side.toLowerCase().includes("b")).length;
    const sells = os.filter(o=>o.side.toLowerCase().includes("a")||o.side.toLowerCase().includes("s")).length;
    const msg = [
      `cfg_evt=pair_config`,
      `ts=${ts}`,
      `pair=${p}`,
      `layers=${layers}`,
      `buys=${buys}`,
      `sells=${sells}`,
      `activeLayersTarget=${ACTIVE_LAYERS}`,
      `offsetsBps=${LAYER_OFFSETS_BPS.join("/")||"n/a"}`,
      `clipUsd=${CLIP_USD}`,
      `minLayerNotionalUsd=${MIN_LAYER_NOTIONAL_USD}`,
      `makerFloorBps=${MAKER_SPREAD_BPS_MIN}`,
      `makerCeilBps=${MAKER_SPREAD_BPS_MAX}`,
      `multiLayer=${ENABLE_MULTI_LAYER?1:0}`,
      `quoteChase=${ENABLE_QUOTE_CHASE?1:0}`,
      `invSkewK=${INVENTORY_SKEW_K}`,
      `driftSkewBps=${DRIFT_SKEW_BPS}`
    ].join(" ");
    lines.push(msg);
  }

  const outPath = path.join(process.cwd(),"runtime","pair_config.log");
  fs.mkdirSync(path.dirname(outPath),{recursive:true});
  fs.appendFileSync(outPath, lines.join("\n")+"\n", "utf8");
  console.log(lines.join("\n"));
}
main().catch(e=>{ console.error(e); process.exit(1) });
