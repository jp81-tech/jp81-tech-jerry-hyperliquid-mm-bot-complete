import { execSync } from "node:child_process"
import { config as dotenv } from "dotenv"; dotenv()
const hook=(process.env.SLACK_WEBHOOK_URL||process.env.DISCORD_WEBHOOK_URL||"").trim()
const BPS=Number(process.env.PANIC_UNREAL_BPS||"35")
const EXEC=(process.env.PANIC_TAKER_EXECUTE||"false")==="true"
const MAX_USD=Number(process.env.PANIC_MAX_REDUCTION_USD||"200")

function post(msg:string){
  if(!hook) return
  const payload = hook.includes("discord") ? `{"content":${JSON.stringify(msg)}}` : `{"text":${JSON.stringify(msg)}}`
  try{ execSync(`curl -s -X POST -H "Content-Type: application/json" -d '${payload.replace(/'/g,"'\\''")}' "${hook}"`, {stdio:"ignore"}) }catch{}
}
function midPx(pair:string):number{
  try{
    const out = execSync(`npx tsx scripts/check-all-orders.ts 2>/dev/null | grep "^${pair}|" | head -1 | awk -F"|" "{print \\"$3\\"}"`,{encoding:"utf8"}).trim()
    const n = Number(out)
    if(Number.isFinite(n)) return n
  }catch{}
  return NaN
}
function positions():Array<{pair:string, side:string, px:number, sz:number, notional:number}>{
  try{
    const out = execSync("npx tsx scripts/check_positions.ts 2>/dev/null", {encoding:"utf8"})
    const rows = out.split("\n").map(l=>l.trim()).filter(Boolean)
    const res:Array<any>=[]
    for(const r of rows){
      const m = r.split(/\s+/)
      if(m.length<4) continue
      const pair=m[0], side=m[1]
      const notional=Number(m[2])
      const px=Number(m[3])
      const sz = notional && px ? notional/px : 0
      res.push({pair, side, px, sz, notional})
    }
    return res
  }catch{ return [] }
}
function main(){
  const pos = positions()
  const breaches:string[]=[]
  for(const p of pos){
    const m = midPx(p.pair)
    if(!Number.isFinite(m) || m<=0 || p.sz===0) continue
    const dir = p.side.toLowerCase()==="long" ? -1 : 1
    const delta = ((m - p.px) / p.px) * 10000 * dir
    if(delta <= -BPS){
      breaches.push(`${p.pair}: unreal=${delta.toFixed(1)}bps px=${p.px.toFixed(6)} mid=${m.toFixed(6)} notional=${p.notional.toFixed(2)}`)
      if(EXEC && p.notional>0){
        const reduce = Math.min(p.notional, MAX_USD)
        try{
          execSync(`node scripts/taker_exit.js ${p.pair} ${reduce}`, {stdio:"ignore"})
          post(`⚠️ Panic taker EXEC ${p.pair} reduce ${reduce} @ mid≈${m.toFixed(6)}`)
        }catch{}
      }
    }
  }
  if(breaches.length){
    post(`🧯 Panic Watch ${new Date().toISOString()}\n`+breaches.join("\n"))
  }
}
main()
