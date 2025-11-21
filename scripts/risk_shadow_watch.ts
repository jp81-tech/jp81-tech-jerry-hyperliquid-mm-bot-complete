#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import * as hl from '@nktkas/hyperliquid'
import { ethers } from 'ethers'
import { sendShadowAlert, sendRiskAlert } from '../src/utils/slack_router.js'

type PositionSide = 'long' | 'short'

type SimplePosition = {
  coin: string
  size: number
  entryPx: number
  markPx: number
  side: PositionSide
  unrealizedPnlUsd: number
}

type ShadowBreach = {
  pair: string
  side: PositionSide
  size: number
  entryPx: number
  markPx: number
  unrealizedPnlUsd: number
  limitUsd: number
  multiple: number
}

async function getOpenPositionsFromApi(): Promise<SimplePosition[]> {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY not found in .env')
  
  const wallet = new ethers.Wallet(pk)
  const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })
  
  const chState = await infoClient.clearinghouseState({ user: wallet.address })
  const positions = chState?.assetPositions ?? []
  
  const allMids = await infoClient.allMids()
  const meta = await infoClient.meta()
  
  const result: SimplePosition[] = []
  
  for (const p of positions) {
    const coin = p.position.coin
    const szi = Number(p.position.szi)
    if (Math.abs(szi) < 1e-12) continue
    
    const side: PositionSide = szi > 0 ? 'long' : 'short'
    const entryPx = parseFloat(p.position.entryPx || '0')
    const unrealizedPnl = parseFloat(p.position.unrealizedPnl)
    
    const assetIndex = meta.universe.findIndex(u => u.name === coin)
    const markPrice = assetIndex >= 0 ? parseFloat(allMids[assetIndex] || '0') : 0
    
    result.push({
      coin,
      size: Math.abs(szi),
      entryPx,
      markPx: markPrice,
      side,
      unrealizedPnlUsd: unrealizedPnl,
    })
  }
  
  return result
}

function loadShadowConfig() {
  const enabled = process.env.RISK_SHADOW_ENABLED === 'true'
  const logPath = process.env.RISK_SHADOW_LOG_PATH
    || '/root/hyperliquid-mm-bot-complete/data/risk_shadow.log'

  const defaultMax = Number(process.env.RISK_SHADOW_DEFAULT_MAX_LOSS_USD || '20')
  const zecMax = Number(process.env.RISK_SHADOW_ZEC_MAX_LOSS_USD || defaultMax)
  const uniMax = Number(process.env.RISK_SHADOW_UNI_MAX_LOSS_USD || defaultMax)

  return {
    enabled,
    logPath,
    perPair: {
      ZEC: zecMax,
      UNI: uniMax,
    } as Record<string, number>,
    defaultMax,
  }
}

function ensureLogDir(logPath: string) {
  const dir = path.dirname(logPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function getLimitForPair(cfg: ReturnType<typeof loadShadowConfig>, pair: string): number {
  const key = pair.toUpperCase()
  return cfg.perPair[key] ?? cfg.defaultMax
}

async function main() {
  const cfg = loadShadowConfig()

  if (!cfg.enabled) {
    console.log('[RISK_SHADOW] disabled via RISK_SHADOW_ENABLED=false')
    return
  }

  ensureLogDir(cfg.logPath)

  let positions: SimplePosition[]
  try {
    positions = await getOpenPositionsFromApi()
  } catch (err) {
    console.error('[RISK_SHADOW] failed to load positions', err)
    return
  }

  if (!positions.length) {
    console.log('[RISK_SHADOW] no open positions')
    return
  }

  const now = new Date().toISOString()
  const lines: string[] = []
  const breaches: ShadowBreach[] = []

  for (const pos of positions) {
    const pair = pos.coin
    const limit = getLimitForPair(cfg, pair)
    const loss = pos.unrealizedPnlUsd

    if (!Number.isFinite(loss)) continue
    if (loss >= 0) continue

    if (loss <= -limit) {
      const multiple = Math.abs(loss) / limit
      
      const entry = {
        ts: now,
        pair,
        side: pos.side,
        size: pos.size,
        entryPx: pos.entryPx,
        markPx: pos.markPx,
        unrealizedPnlUsd: loss,
        limitUsd: limit,
        source: 'watcher',
      }
      lines.push(JSON.stringify(entry))
      
      // Collect for summary alert
      breaches.push({
        pair,
        side: pos.side,
        size: pos.size,
        entryPx: pos.entryPx,
        markPx: pos.markPx,
        unrealizedPnlUsd: loss,
        limitUsd: limit,
        multiple,
      })
    }
  }

  if (!lines.length) {
    console.log('[RISK_SHADOW] no positions beyond thresholds')
    return
  }

  try {
    fs.appendFileSync(cfg.logPath, lines.join('\n') + '\n', { encoding: 'utf8' })
    console.log(`[RISK_SHADOW] logged ${lines.length} events to ${cfg.logPath}`)
  } catch (err) {
    console.error('[RISK_SHADOW] failed to append log file', err)
  }
  
  // Send summary Slack alerts
  if (breaches.length > 0) {
    // Sort by severity (multiple)
    breaches.sort((a, b) => b.multiple - a.multiple)
    const worst = breaches[0]
    const top3 = breaches.slice(0, 3)

    const emoji = (side: PositionSide) => side === 'long' ? '📈' : '📉'
    
    const summary = top3
      .map(b => 
        `${emoji(b.side)} ${b.pair} ${b.side}: $${b.unrealizedPnlUsd.toFixed(2)} ` +
        `(limit: $${b.limitUsd}, ${b.multiple.toFixed(1)}x)`
      )
      .join('\n')

    // Always send to SHADOW channel for awareness
    try {
      await sendShadowAlert(
        `Shadow Mode: ${breaches.length} breach(es) detected\n\n` +
        `Worst: ${worst.pair} ${worst.multiple.toFixed(1)}x limit\n\n` +
        `Top 3:\n${summary}\n\n` +
        `Time: ${now}`
      )
      console.log('[RISK_SHADOW] sent summary alert to #mm-shadow')
    } catch (e) {
      console.error('[RISK_SHADOW] failed to send shadow alert', e)
    }

    // Escalate to RISK channel if >= 2x limit
    if (worst.multiple >= 2.0) {
      try {
        await sendRiskAlert(
          `🚨 SEVERE Shadow Breach: ${worst.pair}\n\n` +
          `${emoji(worst.side)} ${worst.side.toUpperCase()}\n` +
          `Unrealized PnL: $${worst.unrealizedPnlUsd.toFixed(2)}\n` +
          `Size: ${worst.size.toFixed(2)} @ $${worst.entryPx.toFixed(2)}\n` +
          `Mark: $${worst.markPx.toFixed(2)}\n` +
          `Limit: $${worst.limitUsd} (${worst.multiple.toFixed(1)}x breach!)\n\n` +
          `⚠️ Shadow mode = monitoring only, no auto-close\n` +
          `Time: ${now}`
        )
        console.log('[RISK_SHADOW] escalated to #mm-risk')
      } catch (e) {
        console.error('[RISK_SHADOW] failed to send risk alert', e)
      }
    }
  }
}

main().catch((err) => {
  console.error('[RISK_SHADOW] fatal error in watcher', err)
  process.exit(1)
})
