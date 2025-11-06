import fs from "fs";
import dotenv from "dotenv";
dotenv.config();
import { ExchangeClient, InfoClient, HttpTransport } from "@nktkas/hyperliquid";
import { ethers } from "ethers";

async function sleep(ms:number){ return new Promise(r=>setTimeout(r,ms)); }

async function main(){
  const key = (process.env.PRIVATE_KEY || "").trim();
  if(!key){ console.log("no PRIVATE_KEY"); return; }
  
  const wallet = new ethers.Wallet(key);
  const transport = new HttpTransport();
  const info = new InfoClient({ transport });
  const ex = new ExchangeClient({ transport, wallet });
  
  const targetLev = Number(process.env.LEVERAGE || "1");
  const pairsPath = "runtime/active_pairs.json";
  const pairs = fs.existsSync(pairsPath) ? JSON.parse(fs.readFileSync(pairsPath,"utf8")).pairs ?? [] : [];

  if(!pairs.length){ console.log("no pairs"); return; }

  for(;;){
    try{
      const s = await info.clearinghouseState({ user: wallet.address });
      const open = (s.assetPositions||[]).some(p => Math.abs(Number(p.position?.szi||0)) > 0);
      if(!open){
        console.log(`flat, applying leverage=${targetLev}x to ${pairs.join(",")}`);
        const meta = await info.meta();
        const symToIdx = new Map<string, number>();
        meta.universe.forEach((u: any, i: number) => symToIdx.set(u.name.toUpperCase(), i));
        
        for(const sym of pairs){
          const idx = symToIdx.get(sym.toUpperCase());
          if(idx === undefined) continue;
          try{
            await ex.updateLeverage({ asset: idx, isCross: false, leverage: targetLev });
            console.log(`✅ set ${sym} ${targetLev}x (isolated)`);
          }catch(e:any){
            console.log(`❌ fail ${sym}: ${e?.message||e}`);
          }
        }
        return;
      }
      console.log("positions open, retry in 15s...");
    }catch(e:any){
      console.log(`probe error: ${e?.message||e}`);
    }
    await sleep(15000);
  }
}
main().catch(e=>{ console.error(e); process.exit(1); });
