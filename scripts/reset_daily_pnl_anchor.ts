#!/usr/bin/env ts-node
/**
 * Helper script to reset the local daily PnL counter using a fresh anchor from Hyperliquid.
 *
 * Usage:
 *   npx tsx scripts/reset_daily_pnl_anchor.ts
 *
 * Requirements:
 *   - PRIVATE_KEY must be set in the environment (same one used by the bot)
 *   - data/bot_state.json must exist
 *   - Network access to Hyperliquid (same as the bot)
 */

import 'dotenv/config'

import fs from 'fs'
import path from 'path'
import { ethers } from 'ethers'
import * as hl from '@nktkas/hyperliquid'

async function fetchRawDailyPnlUsd(infoClient: hl.InfoClient, walletAddress: string): Promise<{ rawDaily: number; fillsConsidered: number }> {
  const fills = await infoClient.userFills({ user: walletAddress })

  if (!fills || fills.length === 0) {
    return { rawDaily: 0, fillsConsidered: 0 }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  let rawDaily = 0
  let fillsConsidered = 0

  for (const fill of fills) {
    const fillTime = new Date(fill.time)
    if (fillTime < today) continue

    const closedPnl = parseFloat(fill.closedPnl || '0')
    const fee = parseFloat(fill.fee || '0')
    const netPnl = closedPnl + fee

    rawDaily += netPnl
    fillsConsidered += 1
  }

  return { rawDaily, fillsConsidered }
}

async function main() {
  if (process.env.DRY_RUN === 'true') {
    throw new Error('reset_daily_pnl_anchor: not supported in DRY_RUN mode. Set DRY_RUN=false.')
  }

  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error('reset_daily_pnl_anchor: PRIVATE_KEY is required to derive wallet address.')
  }

  const wallet = new ethers.Wallet(privateKey)
  const walletAddress = wallet.address

  const infoClient = new hl.InfoClient({
    transport: new hl.HttpTransport()
  })

  console.log(`🔄 Fetching raw daily PnL for ${walletAddress} ...`)
  const { rawDaily, fillsConsidered } = await fetchRawDailyPnlUsd(infoClient, walletAddress)
  console.log(`   ↳ rawDailyPnL=${rawDaily.toFixed(2)} USD from ${fillsConsidered} fills today`)

  const dataDir = path.join(process.cwd(), 'data')
  const statePath = path.join(dataDir, 'bot_state.json')
  if (!fs.existsSync(statePath)) {
    throw new Error(`reset_daily_pnl_anchor: state file not found at ${statePath}`)
  }

  const lockPath = path.join(dataDir, '.bot_state.lock')
  let lockFd: number | null = null

  const acquireLock = () => {
    try {
      lockFd = fs.openSync(lockPath, 'wx')
    } catch (err: any) {
      if (err && err.code === 'EEXIST') {
        throw new Error('reset_daily_pnl_anchor: state file is locked by another process.')
      }
      throw err
    }
  }

  const releaseLock = () => {
    if (lockFd !== null) {
      fs.closeSync(lockFd)
      fs.unlinkSync(lockPath)
      lockFd = null
    }
  }

  acquireLock()

  try {
    const backupPath = `${statePath}.backup_${new Date().toISOString().replace(/[:.]/g, '-')}`
    fs.copyFileSync(statePath, backupPath)
    console.log(`🗂️  Backup created at ${backupPath}`)

    const stateRaw = fs.readFileSync(statePath, 'utf8')
    const state = JSON.parse(stateRaw)

    state.dailyPnlAnchorUsd = rawDaily
    state.dailyPnl = 0
    state.lastResetDate = new Date().toISOString().slice(0, 10)

    fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
    console.log(`✅ Anchor set to $${rawDaily.toFixed(2)}. Effective daily PnL reset to $0.00.`)
  } finally {
    releaseLock()
  }
}

main().catch((err) => {
  console.error('reset_daily_pnl_anchor failed:', err)
  process.exit(1)
})

