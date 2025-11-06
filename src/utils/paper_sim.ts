import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
type SimConfig = { pair: string; startPrice: number; steps: number; stepMs: number; baseOrderUsd: number; spreadBps: number; driftPct?: number; volatilityPct?: number; };
type SimState = { t: number; mid: number; invUsd: number; cashUsd: number; feesUsd: number; trades: number; };

function randn(): number { let u=0,v=0; while(u===0)u=Math.random(); while(v===0)v=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }

export async function runSimulation(cfg: SimConfig) {
  const outCsv = path.resolve(__dirname, '../../data/paper_sim.csv');
  fs.writeFileSync(outCsv, 't,mid,buyPx,sellPx,side,qty,sizeUsd,feeUsd,cashUsd,invUsd,pnlUsd\n');
  const st: SimState = { t: Date.now(), mid: cfg.startPrice, invUsd: 0, cashUsd: 0, feesUsd: 0, trades: 0 };
  const takerFeeBps = Number(process.env.SIM_TAKER_FEE_BPS || 5);
  for (let i=0;i<cfg.steps;i++){
    const drift=(cfg.driftPct??0)*st.mid;
    const noise=(cfg.volatilityPct??0.004)*st.mid*randn();
    st.mid=Math.max(0.01, st.mid+drift+noise);
    const buyPx=st.mid*(1-(cfg.spreadBps/2)/10000);
    const sellPx=st.mid*(1+(cfg.spreadBps/2)/10000);
    const side = (i%2===0)?'BUY':'SELL' as const;
    const sizeUsd=cfg.baseOrderUsd;
    const qty=sizeUsd/(side==='BUY'?buyPx:sellPx);
    const feeUsd=sizeUsd*(takerFeeBps/10000);
    st.feesUsd+=feeUsd;
    if(side==='BUY'){ st.invUsd+=sizeUsd; st.cashUsd-=sizeUsd+feeUsd; }
    else { st.invUsd-=sizeUsd; st.cashUsd+=sizeUsd-feeUsd; }
    const pnlUsd=st.cashUsd + st.invUsd*(st.mid/cfg.startPrice - 1);
    fs.appendFileSync(outCsv, `${st.t+i*cfg.stepMs},${st.mid.toFixed(6)},${buyPx.toFixed(6)},${sellPx.toFixed(6)},${side},${qty.toFixed(6)},${sizeUsd.toFixed(2)},${feeUsd.toFixed(4)},${st.cashUsd.toFixed(2)},${st.invUsd.toFixed(2)},${pnlUsd.toFixed(2)}\n`);
    await new Promise(r=>setTimeout(r,1));
  }
  const summary={finalMid:st.mid,cashUsd:st.cashUsd,invUsd:st.invUsd,feesUsd:st.feesUsd,trades:st.trades};
  fs.writeFileSync(path.resolve(__dirname,'../../data/paper_sim_summary.json'), JSON.stringify(summary,null,2));
  console.log('Simulation complete:', summary);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSimulation({
    pair: process.env.SIM_PAIR || 'WIF-USD',
    startPrice: Number(process.env.SIM_START || 2.5),
    steps: Number(process.env.SIM_STEPS || 200),
    stepMs: Number(process.env.SIM_STEP_MS || 1000),
    baseOrderUsd: Number(process.env.SIM_ORDER_USD || 150),
    spreadBps: Number(process.env.SIM_SPREAD_BPS || 12),
    driftPct: Number(process.env.SIM_DRIFT || 0.000),
    volatilityPct: Number(process.env.SIM_VOL || 0.006)
  }).catch(console.error);
}
