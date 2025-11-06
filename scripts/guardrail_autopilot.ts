#!/usr/bin/env -S npx tsx
import { config } from "dotenv";
import path from "path";
import fs from "fs";

config({ path: path.resolve(process.cwd(), "src/.env") });

const HOOK = (process.env.SLACK_WEBHOOK_URL||process.env.DISCORD_WEBHOOK_URL||"").trim();
const CAP = Number(process.env.INVENTORY_CAP_USD_PER_PAIR||process.env.INVENTORY_CAP_USD||"800");
const COOL = Number(process.env.SOFT_TAKER_COOLDOWN_SEC||"120");
const SOFT_PCT = Number(process.env.SOFT_TAKER_PCT||"0.12");
const SOFT_MAX = Number(process.env.SOFT_TAKER_MAX_USD||"200");

const F_RUNTIME = "runtime/alerts.log";
const STATE: Record<string,number> = {};  // cooldown per symbol

async function post(msg:string){
  if(!HOOK) return;
  const payload = HOOK.includes("discord") ? {content: msg} : {text: msg};
  try{ 
    await fetch(HOOK,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    }); 
  }catch{}
}

type Breach = { sym:string, notional:number, unreal_bps:number };

function parseLast(): Breach[] {
  try{
    if(!fs.existsSync(F_RUNTIME)) return [];
    const txt = fs.readFileSync(F_RUNTIME,"utf8");
    const blocks = txt.split(/🚨 GUARDRAIL BREACH /).slice(1);
    const out: Breach[] = [];
    for(const b of blocks){
      const lines = b.split("\n");
      const sym = lines[0].trim().split(/\s/)[0].toUpperCase();
      let notional = 0;
      let unreal_bps = 0;
      
      for(const line of lines) {
        const nMatch = line.match(/Notional:\s+([\d\.,]+)\s*USD/i);
        if(nMatch) notional = Number(nMatch[1].replace(/[, ]/g,""));
        
        // Try to find bps in format "Unreal PnL ... bps" or similar
        const bpsMatch = line.match(/Unreal PnL[^\d]*([-\d\.]+)\s*bps/i);
        if(bpsMatch) unreal_bps = Number(bpsMatch[1].replace(/[, ]/g,""));
      }
      
      if(sym && notional>0) out.push({ sym, notional, unreal_bps });
    }
    return out.slice(-10); // last 10
  }catch{ return []; }
}

async function main(){
  const breaches = parseLast();
  if(breaches.length === 0) {
    console.log("autopilot: no breaches found");
    return;
  }
  
  const now = Math.floor(Date.now()/1000);
  
  for(const b of breaches){
    // Cooldown check
    if(STATE[b.sym] && now-STATE[b.sym] < COOL) continue;
    
    // PANIC threshold: -200 bps = close 100%
    if(b.unreal_bps <= -200){
      STATE[b.sym]=now;
      await post(`🧨 AUTO-EXIT 100% ${b.sym} (unreal=${b.unreal_bps.toFixed(2)} bps <= -200)`);
      console.log(`autopilot: would exit 100% ${b.sym}`);
      continue;
    }
    
    // WARNING threshold: -100 bps = reduce 50%
    if(b.unreal_bps <= -100){
      STATE[b.sym]=now;
      await post(`⚠️ AUTO-REDUCE 50% ${b.sym} (unreal=${b.unreal_bps.toFixed(2)} bps <= -100)`);
      console.log(`autopilot: would reduce 50% ${b.sym}`);
      continue;
    }
    
    // SOFT threshold: -35 bps & > cap = soft hedge
    if(b.unreal_bps <= -35 && b.notional > CAP){
      const want = Math.min(b.notional*SOFT_PCT, SOFT_MAX);
      STATE[b.sym]=now;
      await post(`🩹 SOFT-HEDGE ${b.sym} ≈${want.toFixed(0)} USD (unreal=${b.unreal_bps.toFixed(2)} bps <= -35 & > cap)`);
      console.log(`autopilot: would soft-hedge ${b.sym} $${want.toFixed(0)}`);
      continue;
    }
  }
}

main().catch((e)=>{
  console.error("autopilot error:", e);
});
