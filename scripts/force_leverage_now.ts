#!/usr/bin/env -S npx tsx
import * as hl from '@nktkas/hyperliquid'
import { ethers } from 'ethers'
import { config } from 'dotenv'
import path from 'path'
import fs from 'fs'

async function main() {
  config({ path: path.resolve(process.cwd(), '.env') })

  const pk = process.env.PRIVATE_KEY
  if (!pk) { console.error("PRIVATE_KEY missing"); process.exit(1); }

  const wallet = new ethers.Wallet(pk)
  const transport = new hl.HttpTransport()
  const infoClient = new hl.InfoClient({ transport })
  const exchClient = new hl.ExchangeClient({ transport, wallet })

  const f = "runtime/active_pairs.json"
  const pairs = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f,"utf8")).pairs||[]) : []
  if (!pairs.length) { console.log("No pairs found"); return; }

  const lev = Number(process.env.LEVERAGE || "1")
  console.log(`🔧 Setting leverage to ${lev}x for pairs: ${pairs.join(", ")}`)

  const meta = await infoClient.meta()
  const symToIdx = new Map<string, number>()
  meta.universe.forEach((u: any, i: number) => symToIdx.set(u.name.toUpperCase(), i))

  for (const s of pairs) {
    const idx = symToIdx.get(s.toUpperCase())
    if (idx === undefined) {
      console.log(`⚠️  Skip ${s} (not found in universe)`)
      continue
    }
    try {
      await exchClient.updateLeverage({ asset: idx, isCross: false, leverage: lev })
      console.log(`✅ Set ${s} to ${lev}x (isolated)`)
      await new Promise(r => setTimeout(r, 500))
    } catch (err: any) {
      console.error(`❌ Failed ${s}: ${err.message}`)
    }
  }
}

main().catch(console.error)
