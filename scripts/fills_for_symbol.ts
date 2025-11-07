#!/usr/bin/env -S npx tsx
import 'dotenv/config';

const sym = (process.argv[2] || '').toUpperCase();
const hours = Number(process.argv[3] || 24);
if (!sym) { console.error('usage: npx tsx scripts/fills_for_symbol.ts <SYMBOL> [HOURS]'); process.exit(2); }

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

  const rows = (fills || [])
    .filter((f: any) => ((f?.symbol || f?.pair || '').toUpperCase() === sym))
    .sort((a: any, b: any) => (a.timestamp || a.time || 0) - (b.timestamp || b.time || 0));

  const t = (n: number) => new Date(n).toISOString().replace('T',' ').replace('Z','');
  const n6 = (v: any) => (typeof v === 'number' ? v.toFixed(6) : String(v||''));
  const priceOf = (r: any) => r.px ?? r.price ?? r.avgPrice ?? r.fillPrice ?? 0;
  const sizeOf  = (r: any) => r.sz ?? r.size ?? r.qty ?? 0;

  console.log(`SYMBOL=${sym} HOURS=${hours} MATCHES=${rows.length}`);
  console.log('time                 side  price        size         notional     liq  clientId/orderId');
  console.log('-------------------  ----  -----------  -----------  -----------  ---  ----------------');

  for (const r of rows) {
    const ts = r.timestamp || r.time || r.t || 0;
    const side = String(r.side || r.direction || '').padEnd(4);
    const px = n6(priceOf(r)).padStart(11);
    const sz = n6(sizeOf(r)).padStart(11);
    const notional = (() => {
      const p = Number(priceOf(r)); const s = Number(sizeOf(r));
      return (isFinite(p*s) ? (p*s).toFixed(2) : '').padStart(11);
    })();
    const liq = ((r.liquidity === 'M' || r.maker === true) ? 'M' : (r.liquidity === 'T' || r.taker === true) ? 'T' : '').padEnd(3);
    const cid = (r.clientId || r.orderId || r.id || r.source || '').toString();
    console.log(`${t(ts)}  ${side} ${px}  ${sz}  ${notional}  ${liq}  ${cid}`);
  }
})();
