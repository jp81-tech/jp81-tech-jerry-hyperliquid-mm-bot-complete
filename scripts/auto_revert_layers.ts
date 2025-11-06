#!/usr/bin/env -S npx tsx
import { config } from "dotenv";
import path from "path";
import fs from "fs";

config({ path: path.resolve(process.cwd(), "src/.env") });

const TARGET_NOTIONAL = Number(process.env.AUTO_REVERT_THRESHOLD_USD || "900");
const NORMAL_LAYERS = process.env.NORMAL_ACTIVE_LAYERS || "4";
const NORMAL_CAP = process.env.NORMAL_CAP_USD || (process.env.INVENTORY_CAP_USD_PER_PAIR||"800");

async function main(){
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

  let maxNotional = 0;
  for(const p of positions){
    const sz = parseFloat(p.position.szi || "0");
    if(sz === 0) continue;
    const sym = p.position.coin.toUpperCase();
    const mid = Number(mids[sym]||0);
    const notional = Math.abs(sz) * mid;
    maxNotional = Math.max(maxNotional, notional);
  }

  console.log(`auto_revert: max_notional=${maxNotional.toFixed(2)} threshold=${TARGET_NOTIONAL}`);

  if(maxNotional < TARGET_NOTIONAL){
    // Check if we need to revert
    let env = fs.readFileSync("src/.env","utf8");
    const currentLayers = env.match(/^ACTIVE_LAYERS=(\d+)/m);
    const currentCap = env.match(/^INVENTORY_CAP_USD_PER_PAIR=(\d+)/m);
    
    let changed = false;
    
    if(currentLayers && currentLayers[1] !== NORMAL_LAYERS) {
      env = env.replace(/^ACTIVE_LAYERS=.*/m, `ACTIVE_LAYERS=${NORMAL_LAYERS}`);
      changed = true;
      console.log(`auto_revert: reverting ACTIVE_LAYERS to ${NORMAL_LAYERS}`);
    }
    
    if(currentCap && currentCap[1] !== NORMAL_CAP) {
      env = env.replace(/^INVENTORY_CAP_USD_PER_PAIR=.*/m, `INVENTORY_CAP_USD_PER_PAIR=${NORMAL_CAP}`);
      changed = true;
      console.log(`auto_revert: reverting INVENTORY_CAP_USD_PER_PAIR to ${NORMAL_CAP}`);
    }
    
    if(changed) {
      fs.writeFileSync("src/.env", env);
      fs.copyFileSync("src/.env",".env");
      console.log("auto_revert: reverted settings to normal, restart bot with: pm2 restart hyperliquid-mm --update-env");
    } else {
      console.log("auto_revert: already at normal settings");
    }
  } else {
    console.log("auto_revert: exposure still above threshold, no revert");
  }
}

main().catch((e)=>{
  console.error("auto_revert error:", e);
});
