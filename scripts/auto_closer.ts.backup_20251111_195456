#!/usr/bin/env -S npx tsx
/**
 * Auto-closer with DRY_RUN support
 * - DRY_RUN=1  → nie wysyła orderów, tylko loguje co by zrobił
 * - VERBOSE=1  → bardziej szczegółowe logi krok po kroku
 */

import fs from "fs"
import path from "path"
import * as hl from "@nktkas/hyperliquid"
import { ethers } from "ethers"
import { config } from "dotenv"

// Załaduj .env
config({ path: path.resolve(process.cwd(), ".env") })

const DRY_RUN = String(process.env.DRY_RUN ?? "").toLowerCase() === "1" || String(process.env.DRY_RUN ?? "").toLowerCase() === "true"
const VERBOSE = String(process.env.VERBOSE ?? "").toLowerCase() === "1" || String(process.env.VERBOSE ?? "").toLowerCase() === "true"

const LOG = path.join(process.cwd(), "runtime/auto_closer.log")
function log(line: string) {
  const ts = new Date().toISOString()
  const msg = `${ts} [AUTO-CLOSER] ${line}\n`
  fs.appendFileSync(LOG, msg)
  if (VERBOSE) process.stdout.write(msg)
}

// Generate cloid in correct hex format (128-bit)
function generateCloid(coin: string): string {
  const timestamp = Date.now()
  const random = Math.floor(Math.random() * 0xFFFFFFFF)
  return `0x${timestamp.toString(16).padStart(16, '0')}${random.toString(16).padStart(16, '0')}`
}

// Hardcoded instrument specs (from chase.ts)
const INSTRUMENT_SPECS: Record<string, { tickSize: number, lotSize: number }> = {
  'BTC': { tickSize: 1, lotSize: 0.001 },
  'ETH': { tickSize: 0.1, lotSize: 0.01 },
  'SOL': { tickSize: 0.001, lotSize: 0.1 },
  'HYPE': { tickSize: 0.001, lotSize: 0.1 },
  'VIRTUAL': { tickSize: 0.0001, lotSize: 1 },
  'ZK': { tickSize: 0.000001, lotSize: 1 },
  'ZEC': { tickSize: 0.01, lotSize: 0.01 },
  'TRUMP': { tickSize: 0.001, lotSize: 0.1 },
  'FARTCOIN': { tickSize: 0.0001, lotSize: 1 },
  'TAO': { tickSize: 0.1, lotSize: 0.01 },
  'XPL': { tickSize: 0.001, lotSize: 1 },
  'ASTER': { tickSize: 0.00001, lotSize: 1 },
  'HMSTR': { tickSize: 0.0001, lotSize: 1 },
  'BOME': { tickSize: 0.0001, lotSize: 1 },
  'NOT': { tickSize: 0.0001, lotSize: 1 },
  'KPEPE': { tickSize: 0.00001, lotSize: 1 }
}

// Round price to tick size
function roundToTickSize(price: number, tickSize: number): string {
  const rounded = Math.round(price / tickSize) * tickSize
  const decimals = Math.max(0, -Math.floor(Math.log10(tickSize)))
  return rounded.toFixed(decimals)
}

// Round size to lot size
function roundToLotSize(size: number, lotSize: number): string {
  const rounded = Math.floor(size / lotSize) * lotSize
  const decimals = Math.max(0, -Math.floor(Math.log10(lotSize)))
  return rounded.toFixed(decimals)
}

async function main() {
  const denyCoins = (process.env.ACTIVE_PAIRS_DENYLIST ?? "XPL,ASTER")
    .split(",")
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)

  const pk = process.env.PRIVATE_KEY
  if (!pk) {
    log("❌ fatal: PRIVATE_KEY not set")
    process.exit(1)
  }

  const wallet = new ethers.Wallet(pk)
  const walletAddress = await wallet.getAddress()

  log(`Start (wallet ${walletAddress}, deny ${denyCoins.join(",")})${DRY_RUN ? " [DRY_RUN]" : ""}${VERBOSE ? " [VERBOSE]" : ""}`)

  const infoClient = new hl.InfoClient({
    transport: new hl.HttpTransport()
  })
  const exchClient = new hl.ExchangeClient({
    wallet: pk,
    transport: new hl.HttpTransport()
  })

  // Fetch meta universe to get asset indices
  const meta = await infoClient.meta()
  const assetMap = new Map<string, number>()
  
  meta.universe.forEach((market, index) => {
    assetMap.set(market.name, index)
  })

  const chState = await infoClient.clearinghouseState({ user: walletAddress })
  const positions = (chState?.assetPositions ?? []) as Array<{
    position: { coin: string; szi: string | number }
  }>

  if (!positions.length) {
    log("✅ OK: no open positions")
    return
  }

  // Fetch all market prices
  const allMids = await infoClient.allMids()

  let anyDeny = false
  for (const p of positions) {
    const coin = String(p.position?.coin ?? "").toUpperCase()
    if (!denyCoins.includes(coin)) continue

    const szi = Number(p.position?.szi ?? 0)
    if (!szi || Math.abs(szi) < 1e-12) continue

    anyDeny = true
    const absSz = Math.abs(szi)

    log(`🔴 DENY POSITION: ${coin} size=${szi} (abs=${absSz})`)

    if (DRY_RUN) {
      log(`🧪 DRY_RUN: would send reduce-only ${szi > 0 ? "SELL" : "BUY"} market for ${absSz} ${coin}`)
      continue
    }

    // Get asset index
    const assetIndex = assetMap.get(coin)
    if (assetIndex === undefined) {
      log(`❌ Asset ${coin} not found in universe`)
      continue
    }

    // Get specs (use hardcoded or default)
    const specs = INSTRUMENT_SPECS[coin] || { tickSize: 0.001, lotSize: 0.1 }

    // Get current market price
    const midPrice = Number(allMids[coin])
    if (!midPrice || isNaN(midPrice)) {
      log(`❌ No market price for ${coin}`)
      continue
    }

    const isBuy = szi < 0
    // Use aggressive price: +10% for buy (to ensure fill), -10% for sell
    const aggressivePrice = isBuy ? midPrice * 1.10 : midPrice * 0.90
    const priceStr = roundToTickSize(aggressivePrice, specs.tickSize)
    const sizeStr = roundToLotSize(absSz, specs.lotSize)
    
    const cloid = generateCloid(coin)
    
    try {
      log(`📤 Closing: ${isBuy ? "BUY" : "SELL"} reduce-only market ${sizeStr} ${coin} @${priceStr} (mid=${midPrice}, tick=${specs.tickSize}, asset=${assetIndex})`)
      
      // Use correct SDK format
      const orderRequest = {
        orders: [{
          a: assetIndex,                          // asset index
          b: isBuy,                                // isBuy boolean
          p: priceStr,                             // limit price (aggressive for IOC)
          s: sizeStr,                              // size as string
          r: true,                                 // reduceOnly
          t: { limit: { tif: "Ioc" } },           // time in force (IOC = immediate or cancel)
          c: cloid                                 // client order ID (hex)
        }],
        grouping: "na"
      }
      
      const res = await exchClient.order(orderRequest)
      log(`✅ Closed ${coin}: ${JSON.stringify(res)}`)
    } catch (e: any) {
      log(`❌ close error ${coin}: ${e?.message ?? String(e)}`)
    }
  }

  if (!anyDeny) {
    log("✅ OK: no deny positions")
  }
}

main().catch(e => {
  log(`❌ Fatal: ${e?.message ?? String(e)}`)
  process.exit(1)
})
