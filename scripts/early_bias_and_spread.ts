#!/usr/bin/env -S npx tsx
import { config } from "dotenv";
import path from "path";
import fs from "fs";

config({ path: path.resolve(process.cwd(), "src/.env") });

const PCT = (x:number, base:number)=> (base===0?0:(x/base*100));

const E = {
  EARLY_BIAS_ENABLE: (process.env.EARLY_BIAS_ENABLE||"true")==="true",
  EBPS1: Number(process.env.EARLY_BIAS_UNREAL_BPS||"-25"),
  EBPS2: Number(process.env.EARLY_BIAS_UNREAL_BPS2||"-35"),
  EINV:  Number(process.env.EARLY_BIAS_MIN_INV_PCT||"30"),
  K1:    Number(process.env.EARLY_BIAS_INV_SKEW_K1||"1.0"),
  K2:    Number(process.env.EARLY_BIAS_INV_SKEW_K2||"1.5"),
  DB1:   Number(process.env.EARLY_BIAS_DRIFT_BPS1||"10"),
  DB2:   Number(process.env.EARLY_BIAS_DRIFT_BPS2||"15"),

  DYN_SPREAD_ENABLE: (process.env.DYN_SPREAD_ENABLE||"true")==="true",
  DS1_BPS: Number(process.env.DYN_SPREAD_STEP1_UNREAL_BPS||"-25"),
  DS1_ADD: Number(process.env.DYN_SPREAD_STEP1_ADD_BPS||"2"),
  DS2_BPS: Number(process.env.DYN_SPREAD_STEP2_UNREAL_BPS||"-40"),
  DS2_ADD: Number(process.env.DYN_SPREAD_STEP2_ADD_BPS||"3"),

  MAKER_FLOOR: Number(process.env.MAKER_SPREAD_BPS||"16"),
  INVENTORY_CAP_USD_PER_PAIR: Number(process.env.INVENTORY_CAP_USD_PER_PAIR||process.env.INVENTORY_CAP_USD||"800")
};

const WEBHOOK = (process.env.SLACK_WEBHOOK_URL||process.env.DISCORD_WEBHOOK_URL||"").trim();

async function post(msg:string){
  if(!WEBHOOK) return;
  const isDiscord = WEBHOOK.includes("discord");
  const payload = isDiscord ? {content: msg} : {text: msg};
  await fetch(WEBHOOK, {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  }).catch(()=>{});
}

function writeRuntimeKV(k:string, v:string){
  const f="runtime/overrides.env";
  const line=`${k}=${v}\n`;
  let txt="";
  try{ txt=fs.readFileSync(f,"utf8"); }catch{}
  const re=new RegExp(`^${k}=.*`,"m");
  if(re.test(txt)) txt=txt.replace(re, `${k}=${v}`);
  else txt+=line;
  fs.mkdirSync("runtime",{recursive:true});
  fs.writeFileSync(f, txt);
}

async function main(){
  if(!E.EARLY_BIAS_ENABLE && !E.DYN_SPREAD_ENABLE) return;

  const apiUrl = "https://api.hyperliquid.xyz/info";
  const wallet = process.env.WALLET_ADDRESS || "";
  if(!wallet) {
    console.error("❌ WALLET_ADDRESS not found in .env");
    return;
  }

  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      type: "clearinghouseState",
      user: wallet
    })
  });

  const data = await resp.json();
  const positions = data.assetPositions || [];

  let actions:string[] = [];
  for(const p of positions){
    const sym = p.position.coin.toUpperCase();
    const sz = parseFloat(p.position.szi || "0");
    if(sz === 0) continue;

    const posVal = parseFloat(p.position.positionValue || "0");
    const notional = Math.abs(posVal);
    const invPct = PCT(notional, E.INVENTORY_CAP_USD_PER_PAIR||1);
    const unrealUsd = parseFloat(p.position.unrealizedPnl || "0");
    const unrealBps = (notional>0)? (unrealUsd/notional*10000):0;

    let invK = Number(process.env.INV_SKEW_K||"0.7");
    let drift = Number(process.env.DRIFT_SKEW_BPS||"5");
    let floor = E.MAKER_FLOOR;

    if(E.EARLY_BIAS_ENABLE && invPct>=E.EINV){
      if(unrealBps<=E.EBPS2){ invK=E.K2; drift=E.DB2; actions.push(`bias2:${sym}`); }
      else if(unrealBps<=E.EBPS1){ invK=E.K1; drift=E.DB1; actions.push(`bias1:${sym}`); }
    }

    if(E.DYN_SPREAD_ENABLE){
      if(unrealBps<=E.DS2_BPS) { floor = Math.max(floor, E.MAKER_FLOOR + E.DS2_ADD); actions.push(`spread2:${sym}`); }
      else if(unrealBps<=E.DS1_BPS) { floor = Math.max(floor, E.MAKER_FLOOR + E.DS1_ADD); actions.push(`spread1:${sym}`); }
    }

    writeRuntimeKV("INV_SKEW_K", String(invK));
    writeRuntimeKV("DRIFT_SKEW_BPS", String(drift));
    writeRuntimeKV("MAKER_SPREAD_BPS", String(floor));
  }

  if(actions.length){
    await post(`⚙️ EarlyBias+DynSpread applied: ${actions.join(", ")}`);
    try{
      const a = fs.readFileSync("runtime/overrides.env","utf8").trim();
      const b = fs.readFileSync("src/.env","utf8");
      let out = b;
      for(const line of a.split("\n")){
        if(!line) continue;
        const [k,v]=line.split("=");
        const re=new RegExp(`^${k}=.*`,"m");
        if(re.test(out)) out = out.replace(re, `${k}=${v}`);
        else out += `\n${k}=${v}`;
      }
      fs.writeFileSync("src/.env", out);
    }catch{}
  }
}

main().catch((e)=>{ console.error(e); });
