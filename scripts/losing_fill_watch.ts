import * as fs from "fs"; import * as path from "path"; import { config as dotenv } from "dotenv";
dotenv({ path: path.resolve(process.cwd(),"src/.env") });
const hook=(process.env.SLACK_WEBHOOK_URL||process.env.DISCORD_WEBHOOK_URL||"").trim();
function post(t:string){ if(!hook) return; const p=hook.includes("discord")?{content:t}:{text:t};
fetch(hook,{method:"POST",headers:{ "Content-Type":"application/json" },body:JSON.stringify(p)});
}
function pct(x:number,y:number){ return y? (100*x/y):0 }
function q(p:number,a:number[]){ if(a.length===0) return 0; const b=[...a].sort((x,y)=>x-y);
const i=Math.max(0,Math.min(b.length-1,Math.floor(p*(b.length-1)))); return b[i]
}
(async()=>{
  const { spawnSync } = await import("node:child_process");
  const hours=process.argv[2]?Number(process.argv[2]):2; const bin=path.resolve("scripts/perfill_bypair.ts");
  const r=spawnSync("npx",["tsx",bin,String(hours),"0.25"],{encoding:"utf8"});
  const out=r.stdout||""; const blocks=out.split(/^\s*━━━ /m).slice(1);
  let alerts:string[]=[];
  for(const b of blocks){
    const head=b.split("\n")[0]||""; const pair=head.split(/\s+/)[0]?.trim()||"";;
    const m=b.match(/fills=(\d+)\s+sum=([-\d.]+)/); const f=m?Number(m[1]):0;
    const pcts=b.match(/<0=([\d.]+)%/); const losing=pcts?Number(pcts[1]):0;
    const q25=b.match(/p25=([-\d.]+)/); const p25=q25?Number(q25[1]):0;
    if(f>=80 && (losing>30 || p25<-0.40)) alerts.push(`🚨 ${pair} weak fills: losing=${losing.toFixed(1)}% p25=${p25.toFixed(2)} fills=${f}`);
  }
  if(alerts.length) { post(alerts.join("\n")); console.log(alerts.join("\n")) } else { console.log("ok") }
})();
