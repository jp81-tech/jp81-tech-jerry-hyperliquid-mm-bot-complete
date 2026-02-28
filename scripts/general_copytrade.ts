#!/usr/bin/env npx tsx
/**
 * general_copytrade.ts — Copy-Trading Bot: Cień Generała v3
 *
 * Monitoruje pozycje Generała (0xa31211...) co 30s i kopiuje je
 * proporcjonalnie na naszym koncie.
 *
 * Architektura:
 *   vip_spy.py (30s) → /tmp/vip_spy_state.json → ten skrypt → HL API (ordery)
 *
 * Tryby:
 *   --dry-run    Tylko logi, zero orderów (domyślnie WŁĄCZONY)
 *   --live       Rzeczywiste ordery na Hyperliquid
 *
 * PM2:
 *   pm2 start scripts/general_copytrade.ts --name copy-general --interpreter "npx" --interpreter_args "tsx" -- --live
 *
 * Env:
 *   COPY_PRIVATE_KEY    — klucz prywatny konta kopiującego (wymagany w --live)
 *   COPY_CAPITAL_USD    — kapitał na copy-trading (domyślnie $2000)
 *   COPY_MAX_PER_PAIR   — max pozycja per pair (domyślnie $500)
 *   COPY_LEVERAGE       — leverage (domyślnie 3)
 *   COPY_POLL_SEC       — interwał pollowania (domyślnie 30)
 *   COPY_MIN_VALUE_USD  — min wartość pozycji Generała żeby kopiować (domyślnie $10000)
 *   COPY_SCALING_MODE   — "fixed" lub "proportional" (domyślnie "fixed")
 *   COPY_BLOCKED_COINS  — coiny zablokowane (np. "BTC,ETH")
 *   TELEGRAM_BOT_TOKEN  — token bota Telegram (opcjonalny)
 *   TELEGRAM_CHAT_ID    — chat ID (opcjonalny)
 */

import * as hl from '@nktkas/hyperliquid'
import { ethers } from 'ethers'
import * as fs from 'fs'
import * as path from 'path'
import axios from 'axios'

// ============================================================
// TYPES
// ============================================================

interface GeneralPosition {
  size: number          // signed (negative = short)
  side: 'SHORT' | 'LONG'
  entry_px: number
  position_value: number
  unrealized_pnl: number
  leverage: number | string
}

interface CopyState {
  /** Pozycje Generała z ostatniego ticka */
  generalPositions: Record<string, GeneralPosition>
  /** Nasze aktywne kopie (coin → nasz target side) */
  activeCopies: Record<string, { side: 'buy' | 'sell', entryTime: number, generalEntry: number, baseline?: boolean }>
  /** Statystyki */
  stats: {
    ordersPlaced: number
    ordersFailed: number
    positionsOpened: number
    positionsClosed: number
    startTime: number
  }
}

interface CopyConfig {
  dryRun: boolean
  capitalUsd: number
  maxPerPairUsd: number
  leverage: number
  pollSec: number
  minGeneralValueUsd: number
  scalingMode: 'fixed' | 'proportional'
  blockedCoins: string[]
  privateKey: string
  telegramToken: string
  telegramChatId: string
}

// ============================================================
// CONSTANTS
// ============================================================

const GENERAL_ADDRESS = '0xa312114b5795dff9b8db50474dd57701aa78ad1e'
const VIP_STATE_FILE = '/tmp/vip_spy_state.json'
const COPY_STATE_FILE = '/tmp/copy_general_state.json'
const HL_API_URL = 'https://api.hyperliquid.xyz/info'

// Slippage for IOC orders (market-like)
const IOC_SLIPPAGE_BPS = 30  // 0.30% slippage allowance

// ============================================================
// CONFIG
// ============================================================

function loadConfig(): CopyConfig {
  const args = process.argv.slice(2)
  const isLive = args.includes('--live')

  const blockedStr = process.env.COPY_BLOCKED_COINS || ''
  const blockedCoins = blockedStr ? blockedStr.split(',').map(s => s.trim()).filter(Boolean) : []

  return {
    dryRun: !isLive,
    capitalUsd: parseFloat(process.env.COPY_CAPITAL_USD || '2000'),
    maxPerPairUsd: parseFloat(process.env.COPY_MAX_PER_PAIR || '500'),
    leverage: parseInt(process.env.COPY_LEVERAGE || '3', 10),
    pollSec: parseInt(process.env.COPY_POLL_SEC || '30', 10),
    minGeneralValueUsd: parseFloat(process.env.COPY_MIN_VALUE_USD || '10000'),
    scalingMode: (process.env.COPY_SCALING_MODE || 'fixed') as 'fixed' | 'proportional',
    blockedCoins,
    privateKey: process.env.COPY_PRIVATE_KEY || '',
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  }
}

// ============================================================
// LOGGING
// ============================================================

function log(msg: string, level: string = 'INFO') {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const prefix: Record<string, string> = {
    INFO: 'ℹ️',
    TRADE: '💰',
    ALERT: '🚨',
    COPY: '📋',
    CLOSE: '🔒',
    SKIP: '⏭️',
    ERROR: '❌',
    DRY: '🧪',
  }
  console.log(`[${ts}] ${prefix[level] || '•'} [${level}] ${msg}`)
}

// ============================================================
// TELEGRAM
// ============================================================

async function sendTelegram(config: CopyConfig, message: string) {
  if (!config.telegramToken || !config.telegramChatId) return
  try {
    await axios.post(
      `https://api.telegram.org/bot${config.telegramToken}/sendMessage`,
      {
        chat_id: config.telegramChatId,
        text: message,
        parse_mode: 'Markdown',
      },
      { timeout: 10000 }
    )
  } catch (e) {
    // Silent fail for telegram
  }
}

// ============================================================
// DATA FETCHING
// ============================================================

function readVipState(): Record<string, GeneralPosition> | null {
  try {
    if (!fs.existsSync(VIP_STATE_FILE)) return null
    const data = JSON.parse(fs.readFileSync(VIP_STATE_FILE, 'utf8'))
    return data[GENERAL_ADDRESS] || null
  } catch {
    return null
  }
}

async function fetchMidPrices(): Promise<Record<string, number>> {
  try {
    const resp = await axios.post(HL_API_URL, { type: 'allMids' }, { timeout: 10000 })
    const mids: Record<string, number> = {}
    for (const [coin, px] of Object.entries(resp.data as Record<string, string>)) {
      mids[coin] = parseFloat(px)
    }
    return mids
  } catch {
    return {}
  }
}

/** Fetch mid price for xyz: coins via l2Book (allMids doesn't include xyz dex) */
async function fetchXyzMidPrice(coin: string): Promise<number | null> {
  try {
    const resp = await axios.post(HL_API_URL, { type: 'l2Book', coin }, { timeout: 10000 })
    const levels = resp.data?.levels || [[], []]
    const bid = levels[0]?.[0]?.px ? parseFloat(levels[0][0].px) : 0
    const ask = levels[1]?.[0]?.px ? parseFloat(levels[1][0].px) : 0
    if (bid > 0 && ask > 0) return (bid + ask) / 2
    if (bid > 0) return bid
    if (ask > 0) return ask
    return null
  } catch {
    return null
  }
}

async function fetchOurPositions(
  infoClient: hl.InfoClient,
  walletAddress: string
): Promise<Record<string, { size: number; entryPx: number; value: number; pnl: number }>> {
  const positions: Record<string, { size: number; entryPx: number; value: number; pnl: number }> = {}

  // Standard perps
  try {
    const state = await infoClient.clearinghouseState({ user: walletAddress })
    for (const p of state.assetPositions) {
      const pos = p.position
      const size = parseFloat(String(pos.szi))
      if (Math.abs(size) > 0.0001) {
        positions[pos.coin] = {
          size,
          entryPx: parseFloat(String(pos.entryPx)),
          value: Math.abs(parseFloat(String(pos.positionValue))),
          pnl: parseFloat(String(pos.unrealizedPnl)),
        }
      }
    }
  } catch (e) {
    log(`Fetch our perp positions failed: ${e}`, 'ERROR')
  }

  // xyz dex positions (GOLD, TSLA, etc.)
  try {
    const resp = await axios.post(HL_API_URL, {
      type: 'clearinghouseState', user: walletAddress, dex: 'xyz'
    }, { timeout: 10000 })
    const data = resp.data
    if (data?.assetPositions) {
      for (const p of data.assetPositions) {
        const pos = p.position
        const size = parseFloat(String(pos.szi))
        if (Math.abs(size) > 0.0001) {
          positions[pos.coin] = {
            size,
            entryPx: parseFloat(String(pos.entryPx)),
            value: Math.abs(parseFloat(String(pos.positionValue))),
            pnl: parseFloat(String(pos.unrealizedPnl)),
          }
        }
      }
    }
  } catch (e) {
    log(`Fetch our xyz positions failed: ${e}`, 'ERROR')
  }

  return positions
}

// ============================================================
// COPY STATE MANAGEMENT
// ============================================================

function loadCopyState(): CopyState {
  try {
    if (fs.existsSync(COPY_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(COPY_STATE_FILE, 'utf8'))
    }
  } catch { /* ignore */ }
  return {
    generalPositions: {},
    activeCopies: {},
    stats: {
      ordersPlaced: 0,
      ordersFailed: 0,
      positionsOpened: 0,
      positionsClosed: 0,
      startTime: 0,
    },
  }
}

function saveCopyState(state: CopyState) {
  try {
    fs.writeFileSync(COPY_STATE_FILE, JSON.stringify(state, null, 2))
  } catch { /* ignore */ }
}

// ============================================================
// ORDER SIZING
// ============================================================

function calculateCopySize(
  config: CopyConfig,
  generalValue: number,
  midPrice: number,
  ourCurrentValue: number
): number {
  // Max we can allocate to this pair
  const maxAlloc = config.maxPerPairUsd - ourCurrentValue
  if (maxAlloc <= 0) return 0

  let targetUsd: number
  if (config.scalingMode === 'proportional') {
    // Scale proportionally to Generał's portfolio weight
    // Generał typically has $5M+ total — we scale to our capital
    const generalEstimatedTotal = 5_000_000
    const weight = Math.min(generalValue / generalEstimatedTotal, 0.30)  // cap 30%
    targetUsd = config.capitalUsd * weight
  } else {
    // Fixed: use maxPerPairUsd for all qualifying positions
    targetUsd = config.maxPerPairUsd
  }

  // Clamp
  targetUsd = Math.min(targetUsd, maxAlloc, config.maxPerPairUsd)
  targetUsd = Math.max(targetUsd, 20)  // Min $20 (HL minimum)

  return targetUsd
}

// ============================================================
// ORDER EXECUTION
// ============================================================

async function placeOrder(
  exchClient: hl.ExchangeClient,
  assetMap: Map<string, number>,
  szDecMap: Map<string, number>,
  coin: string,
  side: 'buy' | 'sell',
  sizeUsd: number,
  midPrice: number,
  reduceOnly: boolean = false,
  config: CopyConfig
): Promise<boolean> {
  const assetIndex = assetMap.get(coin)
  if (assetIndex === undefined) {
    log(`Asset ${coin} not found in mapping`, 'ERROR')
    return false
  }

  // Apply slippage for IOC
  const slippageMult = side === 'buy' ? (1 + IOC_SLIPPAGE_BPS / 10000) : (1 - IOC_SLIPPAGE_BPS / 10000)
  const orderPrice = midPrice * slippageMult

  // Calculate size in coins
  const sizeCoins = sizeUsd / midPrice
  const szDec = szDecMap.get(coin) || 0
  const step = Math.pow(10, -szDec)
  const quantizedSize = Math.max(step, Math.round(sizeCoins / step) * step)

  // Price quantization (6 significant figures)
  const priceSigFigs = 5
  const priceStr = orderPrice.toPrecision(priceSigFigs)

  if (config.dryRun) {
    log(`DRY RUN: ${side.toUpperCase()} ${coin} ${quantizedSize.toFixed(szDec)} coins (~$${sizeUsd.toFixed(0)}) @ ${priceStr} ${reduceOnly ? '[REDUCE_ONLY]' : ''}`, 'DRY')
    return true
  }

  try {
    const result = await exchClient.order({
      orders: [{
        a: assetIndex,
        b: side === 'buy',
        p: priceStr,
        s: quantizedSize.toFixed(szDec),
        r: reduceOnly,
        t: { limit: { tif: 'Ioc' } },
        c: `copy_${coin}_${Date.now().toString(16)}`
      }],
      grouping: 'na',
    })

    // Check result
    const statuses = (result as any)?.response?.data?.statuses
    if (statuses?.[0]?.error) {
      log(`Order ${side} ${coin} FAILED: ${statuses[0].error}`, 'ERROR')
      return false
    }

    log(`ORDER OK: ${side.toUpperCase()} ${coin} ${quantizedSize.toFixed(szDec)} @ ${priceStr} (~$${sizeUsd.toFixed(0)}) ${reduceOnly ? '[REDUCE_ONLY]' : ''}`, 'TRADE')
    return true
  } catch (e: any) {
    log(`Order ${side} ${coin} exception: ${e?.message || e}`, 'ERROR')
    return false
  }
}

// ============================================================
// MAIN COPY LOGIC
// ============================================================

async function processTick(
  config: CopyConfig,
  state: CopyState,
  exchClient: hl.ExchangeClient | null,
  infoClient: hl.InfoClient,
  assetMap: Map<string, number>,
  szDecMap: Map<string, number>,
  walletAddress: string,
) {
  // 1. Read Generał's positions from vip_spy state
  const generalPos = readVipState()
  if (!generalPos) {
    log('No vip_spy state or no Generał data — skipping', 'SKIP')
    return
  }

  // 2. Fetch mid prices
  const mids = await fetchMidPrices()
  if (Object.keys(mids).length === 0) {
    log('Failed to fetch mid prices — skipping', 'ERROR')
    return
  }

  // 2b. Fetch mid prices for xyz: coins (not in allMids)
  for (const coin of Object.keys(generalPos)) {
    if (coin.startsWith('xyz:') && !mids[coin]) {
      const xyzMid = await fetchXyzMidPrice(coin)
      if (xyzMid) mids[coin] = xyzMid
    }
  }

  // 3. Fetch our current positions
  const ourPositions = await fetchOurPositions(infoClient, walletAddress)

  // 4. Determine what Generał has vs what we have
  const prevGeneralCoins = new Set(Object.keys(state.generalPositions))
  const currentGeneralCoins = new Set(Object.keys(generalPos))

  // 5. Detect CLOSED positions (Generał had it, now doesn't)
  for (const coin of prevGeneralCoins) {
    if (!currentGeneralCoins.has(coin) && state.activeCopies[coin]) {
      const copyEntry = state.activeCopies[coin]

      // Baseline positions: Generał closed an old position we never actually copied
      if (copyEntry.baseline) {
        log(`🔒 Generał zamknął ${coin} (baseline — nie mamy kopii)`, 'CLOSE')
        delete state.activeCopies[coin]
        continue
      }

      const ourPos = ourPositions[coin]
      if (ourPos && Math.abs(ourPos.size) > 0.0001) {
        const closeSide = ourPos.size > 0 ? 'sell' : 'buy'
        const mid = mids[coin]
        if (!mid) continue

        log(`🔒 CLOSE: Generał zamknął ${coin} — zamykamy naszą pozycję ($${ourPos.value.toFixed(0)}, PnL $${ourPos.pnl.toFixed(2)})`, 'CLOSE')

        const ok = exchClient ? await placeOrder(
          exchClient, assetMap, szDecMap, coin, closeSide,
          ourPos.value, mid, true, config
        ) : false

        if (ok || config.dryRun) {
          state.stats.positionsClosed++
          delete state.activeCopies[coin]

          await sendTelegram(config,
            `🔒 *COPY CLOSE*\n${coin} — Generał zamknął\nNasz PnL: $${ourPos.pnl.toFixed(2)}`
          )
        }
      } else {
        delete state.activeCopies[coin]
      }
    }
  }

  // 6. Detect FLIPPED positions (Generał changed side)
  for (const coin of currentGeneralCoins) {
    if (!prevGeneralCoins.has(coin)) continue  // new position, handle below
    const prev = state.generalPositions[coin]
    const curr = generalPos[coin]
    if (!prev || !curr) continue

    if (prev.side !== curr.side) {
      const copyEntry = state.activeCopies[coin]
      const wasBaseline = copyEntry?.baseline

      log(`🔄 FLIP: Generał flipnął ${coin} ${prev.side} → ${curr.side}${wasBaseline ? ' (baseline → now tracking as new)' : ''}`, 'ALERT')

      // Close our position first (skip if baseline — we don't have a real copy)
      if (!wasBaseline) {
        const ourPos = ourPositions[coin]
        if (ourPos && Math.abs(ourPos.size) > 0.0001) {
          const closeSide = ourPos.size > 0 ? 'sell' : 'buy'
          const mid = mids[coin]
          if (mid && exchClient) {
            await placeOrder(exchClient, assetMap, szDecMap, coin, closeSide, ourPos.value, mid, true, config)
            state.stats.positionsClosed++
          }
        }
      }

      // Remove old entry — the NEW flipped position will be opened in section 7
      delete state.activeCopies[coin]

      await sendTelegram(config,
        `🔄 *COPY FLIP*\n${coin}: ${prev.side} → ${curr.side}\nGenerał value: $${curr.position_value.toFixed(0)}`
      )
    }
  }

  // 7. Detect NEW positions (Generał opened, we don't have copy)
  for (const [coin, gPos] of Object.entries(generalPos)) {
    if (config.blockedCoins.includes(coin)) continue
    if (gPos.position_value < config.minGeneralValueUsd) continue

    const mid = mids[coin]
    if (!mid) continue

    // Already have a copy?
    const ourPos = ourPositions[coin]
    const hasCopy = state.activeCopies[coin]

    if (!hasCopy) {
      // New copy opportunity
      const ourValue = ourPos?.value || 0
      const copySize = calculateCopySize(config, gPos.position_value, mid, ourValue)

      if (copySize < 20) {
        continue  // Too small
      }

      const copySide: 'buy' | 'sell' = gPos.side === 'LONG' ? 'buy' : 'sell'

      log(`📋 COPY: Generał ma ${coin} ${gPos.side} $${gPos.position_value.toFixed(0)} (uPnL $${gPos.unrealized_pnl.toFixed(0)}) → kopiujemy $${copySize.toFixed(0)}`, 'COPY')

      const ok = exchClient ? await placeOrder(
        exchClient, assetMap, szDecMap, coin, copySide,
        copySize, mid, false, config
      ) : config.dryRun

      if (ok) {
        state.stats.ordersPlaced++
        state.stats.positionsOpened++
        state.activeCopies[coin] = {
          side: copySide,
          entryTime: Date.now(),
          generalEntry: gPos.entry_px,
        }

        await sendTelegram(config,
          `📋 *COPY OPEN*\n${coin} ${gPos.side}\n` +
          `Generał: $${gPos.position_value.toFixed(0)} (uPnL $${gPos.unrealized_pnl.toFixed(0)})\n` +
          `My copy: $${copySize.toFixed(0)} @ ${mid.toPrecision(5)}`
        )
      } else {
        state.stats.ordersFailed++
      }
    }
  }

  // 8. Check for SIZE changes (Generał significantly reduced → we reduce proportionally)
  for (const [coin, gPos] of Object.entries(generalPos)) {
    const prevGPos = state.generalPositions[coin]
    if (!prevGPos || !state.activeCopies[coin]) continue
    if (state.activeCopies[coin].baseline) continue  // Skip baseline positions

    const prevValue = prevGPos.position_value
    const newValue = gPos.position_value
    if (prevValue === 0) continue

    const changePct = (newValue - prevValue) / prevValue * 100

    // Generał reduced by >20% → we reduce proportionally
    if (changePct < -20) {
      const ourPos = ourPositions[coin]
      if (!ourPos || Math.abs(ourPos.size) < 0.0001) continue

      const reductionPct = Math.abs(changePct) / 100
      const reduceUsd = ourPos.value * reductionPct
      const mid = mids[coin]
      if (!mid || reduceUsd < 20) continue

      const closeSide = ourPos.size > 0 ? 'sell' : 'buy'

      log(`📉 REDUCE: Generał zredukował ${coin} o ${changePct.toFixed(1)}% → redukujemy $${reduceUsd.toFixed(0)}`, 'COPY')

      if (exchClient) {
        await placeOrder(exchClient, assetMap, szDecMap, coin, closeSide, reduceUsd, mid, true, config)
      }
    }
  }

  // 9. Update state
  state.generalPositions = generalPos
  saveCopyState(state)
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const config = loadConfig()

  log('═'.repeat(60))
  log(`COPY-TRADING BOT: Cień Generała v3`)
  log('═'.repeat(60))
  log(`Mode:          ${config.dryRun ? '🧪 DRY RUN (no orders)' : '🔴 LIVE TRADING'}`)
  log(`Capital:       $${config.capitalUsd.toLocaleString()}`)
  log(`Max/pair:      $${config.maxPerPairUsd.toLocaleString()}`)
  log(`Leverage:      ${config.leverage}x`)
  log(`Poll interval: ${config.pollSec}s`)
  log(`Min Generał value: $${config.minGeneralValueUsd.toLocaleString()}`)
  log(`Scaling:       ${config.scalingMode}`)
  log(`Blocked coins: ${config.blockedCoins.length > 0 ? config.blockedCoins.join(', ') : '(none)'}`)
  log(`Telegram:      ${config.telegramToken ? 'ON' : 'OFF'}`)
  log(`Target:        Generał (${GENERAL_ADDRESS.slice(0, 10)}...)`)
  log('═'.repeat(60))

  // Validate
  if (!config.dryRun && !config.privateKey) {
    log('COPY_PRIVATE_KEY is required for --live mode!', 'ERROR')
    process.exit(1)
  }

  // Initialize SDK
  let exchClient: hl.ExchangeClient | null = null
  const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })
  let walletAddress = ''

  if (!config.dryRun) {
    exchClient = new hl.ExchangeClient({
      wallet: config.privateKey,
      transport: new hl.HttpTransport(),
    })
    walletAddress = new ethers.Wallet(config.privateKey).address
    log(`Wallet: ${walletAddress}`)
  } else {
    walletAddress = '0x0000000000000000000000000000000000000000'
    log('DRY RUN — no wallet needed')
  }

  // Build asset map
  log('Building asset map...')
  const assetMap = new Map<string, number>()
  const szDecMap = new Map<string, number>()

  try {
    const resp = await axios.post(HL_API_URL, { type: 'meta' }, { timeout: 10000 })
    const meta = resp.data
    const universe = meta.universe || []
    universe.forEach((market: any, index: number) => {
      assetMap.set(market.name, index)
      szDecMap.set(market.name, market.szDecimals || 0)
    })
    log(`Asset map: ${assetMap.size} standard perps loaded`)
  } catch (e) {
    log(`Failed to load asset metadata: ${e}`, 'ERROR')
    process.exit(1)
  }

  // Load xyz dex assets (GOLD, TSLA, etc.) — offset 110000
  // API returns names with xyz: prefix already (e.g. "xyz:GOLD")
  try {
    const resp = await axios.post(HL_API_URL, { type: 'meta', dex: 'xyz' }, { timeout: 10000 })
    const meta = resp.data
    const universe = meta.universe || []
    const XYZ_OFFSET = 110000
    universe.forEach((market: any, index: number) => {
      assetMap.set(market.name, XYZ_OFFSET + index)
      szDecMap.set(market.name, market.szDecimals || 0)
    })
    log(`Asset map: +${universe.length} xyz dex pairs loaded (total: ${assetMap.size})`)
  } catch (e) {
    log(`Failed to load xyz dex metadata (non-fatal): ${e}`, 'ERROR')
  }

  // Set leverage for common coins (if live)
  if (exchClient && config.leverage > 1) {
    const commonCoins = ['BTC', 'ETH', 'SOL', 'HYPE', 'LIT', 'FARTCOIN', 'PUMP', 'ASTER', 'kPEPE', 'DOGE', 'SUI', 'XRP']
    for (const coin of commonCoins) {
      const idx = assetMap.get(coin)
      if (idx === undefined) continue
      try {
        await exchClient.updateLeverage({ asset: idx, isCross: true, leverage: config.leverage })
      } catch { /* some coins may not support the leverage level */ }
    }
    // xyz dex coins: onlyIsolated, max leverage varies
    const xyzCoins = [{ name: 'xyz:GOLD', leverage: 2 }]
    for (const xyzCoin of xyzCoins) {
      const idx = assetMap.get(xyzCoin.name)
      if (idx === undefined) continue
      try {
        await exchClient.updateLeverage({ asset: idx, isCross: false, leverage: xyzCoin.leverage })
        log(`Set ${xyzCoin.name} leverage to ${xyzCoin.leverage}x isolated`)
      } catch { /* xyz coin may not be available */ }
    }
    log(`Leverage set to ${config.leverage}x for common coins`)
  }

  // Load state
  const state = loadCopyState()
  const isFirstStart = state.stats.startTime === 0
  if (isFirstStart) state.stats.startTime = Date.now()

  // Show Generał's current positions
  const genPos = readVipState()
  if (genPos) {
    log(`Generał's current positions:`)
    for (const [coin, pos] of Object.entries(genPos).sort((a, b) => b[1].position_value - a[1].position_value)) {
      log(`  ${coin}: ${pos.side} $${pos.position_value.toFixed(0)} (uPnL $${pos.unrealized_pnl.toFixed(0)}, entry $${pos.entry_px.toFixed(4)})`)
    }

    // On first start: seed baseline — mark existing positions as "already known"
    // so processTick doesn't try to copy them (they're old, entered weeks ago)
    if (isFirstStart && Object.keys(state.generalPositions).length === 0) {
      state.generalPositions = genPos
      // Mark all existing positions as acknowledged (baseline)
      for (const [coin, pos] of Object.entries(genPos)) {
        state.activeCopies[coin] = {
          side: pos.side === 'LONG' ? 'buy' : 'sell',
          entryTime: Date.now(),
          generalEntry: pos.entry_px,
          baseline: true,  // Flag: this was a pre-existing position, not actually copied
        }
      }
      saveCopyState(state)
      log(`Baseline saved — ${Object.keys(genPos).length} existing positions marked as known`)
      log('Only NEW positions from now on will be copied.')
    }
  } else {
    log('No vip_spy state found — waiting for first update...', 'SKIP')
  }

  log('')
  log('Monitoring started. Waiting for changes...')

  // Main loop
  let tick = 0
  while (true) {
    try {
      await processTick(config, state, exchClient, infoClient, assetMap, szDecMap, walletAddress)

      tick++
      // Status every 5 minutes
      if (tick % Math.floor(300 / config.pollSec) === 0) {
        const uptime = ((Date.now() - state.stats.startTime) / 3600000).toFixed(1)
        const copies = Object.keys(state.activeCopies).length
        log(`STATUS: ${copies} active copies | ${state.stats.positionsOpened} opened, ${state.stats.positionsClosed} closed | uptime ${uptime}h`)
      }
    } catch (e: any) {
      log(`Tick error: ${e?.message || e}`, 'ERROR')
    }

    await new Promise(resolve => setTimeout(resolve, config.pollSec * 1000))
  }
}

main().catch(e => {
  log(`Fatal: ${e}`, 'ERROR')
  process.exit(1)
})
