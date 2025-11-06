#!/usr/bin/env -S npx tsx
import { config } from "dotenv";
import path from "path";
import fs from "fs";

config({ path: path.resolve(process.cwd(), "src/.env") });

const ENABLE = (process.env.SOFT_TAKER_ENABLE||"true")==="true";
const PCT = Number(process.env.SOFT_TAKER_PCT||"0.12");
const MAX_USD = Number(process.env.SOFT_TAKER_MAX_USD||"200");
const COOLDOWN = Number(process.env.SOFT_TAKER_COOLDOWN_SEC||"120");

const STATE_FILE = "runtime/soft_taker_state.json";

function loadState(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state: Record<string, number>) {
  fs.mkdirSync("runtime", { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function post(msg:string){
  const hook=(process.env.SLACK_WEBHOOK_URL||process.env.DISCORD_WEBHOOK_URL||"").trim();
  if(!hook) return;
  const isDiscord = hook.includes("discord");
  const payload = isDiscord ? {content: msg} : {text: msg};
  await fetch(hook, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) }).catch(()=>{});
}

async function main(){
  if(!ENABLE) return;

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

  // Get mids
  const midsResp = await fetch(apiUrl, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ type: "allMids" })
  });
  const mids = await midsResp.json();

  const state = loadState();
  const now = Math.floor(Date.now()/1000);

  for(const p of positions){
    const sym = p.position.coin.toUpperCase();
    const mid = Number(mids[sym]||0);
    if(!mid||mid<=0) continue;

    const last = state[sym]||0;
    if(now-last<COOLDOWN) continue;

    const sz = parseFloat(p.position.szi || "0");
    if(sz===0) continue;

    const posVal = parseFloat(p.position.positionValue || "0");
    const notional = Math.abs(posVal);
    const unrealUsd = parseFloat(p.position.unrealizedPnl || "0");
    const unrealBps = (notional>0)? (unrealUsd/notional*10000):0;

    const threshold = Number(process.env.EARLY_BIAS_UNREAL_BPS||"-25");
    if(unrealBps > threshold) continue;

    let targetUsd = Math.min(notional*PCT, MAX_USD);
    if(targetUsd < mid*0.5) continue;

    const reduceSz = targetUsd/mid;
    const side = sz>0 ? "sell" : "buy";

    console.log(`🩹 Would soft-taker hedge ${sym} ${side.toUpperCase()} ${reduceSz.toFixed(4)} @~${mid.toFixed(4)} (≈$${targetUsd.toFixed(2)})`);
    console.log(`   Reason: unrealBps=${unrealBps.toFixed(2)} < ${threshold}`);

    state[sym] = now;
    saveState(state);

    await post(`🩹 Soft taker hedge ${sym} ${side.toUpperCase()} ${reduceSz.toFixed(4)} @~${mid.toFixed(4)} (≈$${targetUsd.toFixed(2)})`);

    // NOTE: Actual order placement disabled for safety - implement with your SDK
    // Example: await placeReduceOnlyOrder(sym, side, reduceSz, mid * (side === "buy" ? 1.02 : 0.98));
  }
}

main().catch((e)=>{ console.error(e); });
