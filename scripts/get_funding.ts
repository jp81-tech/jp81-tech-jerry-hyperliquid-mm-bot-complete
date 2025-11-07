#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import fetch from 'node-fetch'

const sym = (process.argv[2] || '').toUpperCase()
if (!sym) { console.error('usage: npx tsx scripts/get_funding.ts <SYMBOL>'); process.exit(2) }

type AnyObj = Record<string, any>

async function getMeta(): Promise<AnyObj> {
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'meta' })
  })
  if (!res.ok) throw new Error('meta fetch failed')
  return res.json() as any
}

;(async () => {
  const meta = await getMeta()
  const uni = meta?.universe || []
  const ctxs = meta?.assetCtxs || meta?.perpAssetCtxs || []
  let fundingBps = 0
  let coin = uni.find((u: AnyObj) => (u.name||'').toUpperCase() === sym)
  if (!coin && Array.isArray(uni)) coin = uni.find((u: AnyObj) => (u?.perp?.name||'').toUpperCase() === sym)
  const ctx = ctxs.find((c: AnyObj) => (c.coin||c.name||'').toUpperCase() === sym)
  const cand = [
    coin?.perp?.fundingRate,
    coin?.fundingRate,
    ctx?.fundingRate,
    ctx?.nextFundingRate,
    ctx?.funding?.rate,
    ctx?.funding?.nextRate
  ].map((x: any) => Number(x)).filter((x: any) => Number.isFinite(x))
  if (cand.length) {
    const r = cand[0]
    fundingBps = Math.abs(r) < 1 ? r*10000 : r
  }
  const out = { symbol: sym, fundingBps }
  console.log(JSON.stringify(out))
})().catch(e => { console.error('err', String(e)); process.exit(1) })
