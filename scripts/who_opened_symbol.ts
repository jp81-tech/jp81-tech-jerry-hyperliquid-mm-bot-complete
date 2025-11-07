#!/usr/bin/env -S npx tsx
import 'dotenv/config';

const sym = (process.argv[2] || '').toUpperCase();
const hours = Number(process.argv[3] || 48);
if (!sym) { console.error('usage: npx tsx scripts/who_opened_symbol.ts <SYMBOL> [HOURS]'); process.exit(2); }

function pickClient(mod: any) {
  return mod?.HLClient || mod?.Client || mod?.default?.HLClient || mod?.default?.Client;
}

(async () => {
  let mod: any;
  try { mod = await import('@nktkas/hyperliquid'); } catch (e) { console.error('import error', e); process.exit(1); }
  const Client = pickClient(mod);
  if (!Client) { console.error('no HL client export'); process.exit(1); }

  const env = process.env.HL_ENV || 'mainnet';
  const hl = new Client(env);
  const sinceMs = Date.now() - hours * 60 * 60 * 1000;

  let fills: any[] = [];
  if (typeof (hl as any).getMyFills === 'function') {
    fills = await (hl as any).getMyFills({ sinceMs });
  } else if (typeof (hl as any).getFills === 'function') {
    const owner = process.env.WALLET_ADDRESS;
    fills = await (hl as any).getFills({ sinceMs, owner });
  } else {
    console.error('no fills method'); process.exit(1);
  }

  const fx = (r: any) => ({
    ts: r.timestamp || r.time || 0,
    side: (r.side || r.direction || '').toString().toUpperCase(),
    price: Number(r.px ?? r.price ?? r.avgPrice ?? r.fillPrice ?? 0),
    size: Number(r.sz ?? r.size ?? r.qty ?? 0),
    liq: (r.liquidity === 'M' || r.maker === true) ? 'M' : (r.liquidity === 'T' || r.taker === true) ? 'T' : '',
    cid: (r.clientId || r.orderId || r.id || r.source || 'unknown').toString(),
    sym: (r.symbol || r.pair || '').toUpperCase(),
  });

  const rows = (fills || []).map(fx).filter(r => r.sym === sym);
  const tot = rows.reduce((a,r)=>a + (r.price * r.size), 0);
  const mak = rows.filter(r=>r.liq==='M').reduce((a,r)=>a + (r.price * r.size), 0);
  const tak = rows.filter(r=>r.liq==='T').reduce((a,r)=>a + (r.price * r.size), 0);

  const byCid = new Map<string, {notional:number, cnt:number, maker:number, taker:number}>();
  for (const r of rows) {
    const v = byCid.get(r.cid) || {notional:0, cnt:0, maker:0, taker:0};
    v.notional += (r.price * r.size);
    v.cnt += 1;
    if (r.liq === 'M') v.maker += 1;
    if (r.liq === 'T') v.taker += 1;
    byCid.set(r.cid, v);
  }

  const top = Array.from(byCid.entries()).sort((a,b)=>b[1].notional - a[1].notional);

  console.log(`SYMBOL=${sym} HOURS=${hours}`);
  console.log(`FILLS=${rows.length} NOTIONAL_TOTAL=${tot.toFixed(2)} MAKER_NOTIONAL=${mak.toFixed(2)} TAKER_NOTIONAL=${tak.toFixed(2)}`);
  console.log('TOP CONTRIBUTORS:');
  console.log('clientId/orderId                         fills  maker  taker  notional');
  console.log('---------------------------------------  -----  -----  -----  -----------');
  for (const [cid, v] of top.slice(0, 20)) {
    const id = cid.padEnd(39).slice(0,39);
    const line = `${id}  ${String(v.cnt).padStart(5)}  ${String(v.maker).padStart(5)}  ${String(v.taker).padStart(5)}  ${v.notional.toFixed(2).padStart(11)}`;
    console.log(line);
  }
})();
