#!/usr/bin/env -S npx tsx
/**
 * AUTO-BEAR MONITOR
 *
 * Automatically switches to bear mode when market conditions deteriorate:
 * - 3 out of 5 top confluence pairs drop >5% in 1h
 * - Daily PnL approaches loss limit (>80% of MAX_DAILY_LOSS_USD)
 * - Account drawdown >10% from recent high
 *
 * Run via cron every 5-15 minutes
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const BASE_DIR = '/root/hyperliquid-mm-bot-complete'
const STATE_FILE = join(BASE_DIR, 'runtime/auto_bear_state.json')
const ENV_FILE = join(BASE_DIR, '.env')

interface BearState {
  mode: 'normal' | 'bear'
  lastCheck: string
  accountHighWater: number
  priceSnapshot: Record<string, number>
  switchCount: number
  lastSwitchTime?: string
}

// ════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════

function loadState(): BearState {
  if (!existsSync(STATE_FILE)) {
    return {
      mode: 'normal',
      lastCheck: new Date().toISOString(),
      accountHighWater: 0,
      priceSnapshot: {},
      switchCount: 0
    }
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
}

function saveState(state: BearState) {
  const dir = join(BASE_DIR, 'runtime')
  execSync(`mkdir -p ${dir}`)
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function getCurrentMode(): 'normal' | 'bear' {
  const envContent = readFileSync(ENV_FILE, 'utf-8')
  return envContent.includes('BEAR_MODE=1') ? 'bear' : 'normal'
}

function switchToBear() {
  console.log('🐻 [AUTO-BEAR] Switching to BEAR mode...')
  execSync('cp .env .env.backup_auto_bear_$(date +%F_%H-%M)', { cwd: BASE_DIR, shell: '/bin/bash' })
  execSync('cp .env.bear .env', { cwd: BASE_DIR })
  execSync('pm2 restart hyperliquid-mm --update-env')

  // Slack notification
  const webhook = process.env.SLACK_WEBHOOK
  if (webhook) {
    const msg = '🐻 AUTO-BEAR ACTIVATED: Market conditions deteriorated, switching to defensive mode'
    try {
      execSync(`curl -sS -X POST -H "Content-Type: application/json" --data '{"text":"${msg}"}' "${webhook}"`, { shell: '/bin/bash' })
    } catch {}
  }
}

function switchToNormal() {
  console.log('✅ [AUTO-BEAR] Switching back to NORMAL mode...')
  const backups = execSync('ls -t .env.backup_auto_bear_* 2>/dev/null || true', {
    cwd: BASE_DIR,
    encoding: 'utf-8',
    shell: '/bin/bash'
  }).trim().split('\n')

  if (backups[0]) {
    execSync(`cp ${backups[0]} .env`, { cwd: BASE_DIR })
    execSync('pm2 restart hyperliquid-mm --update-env')

    const webhook = process.env.SLACK_WEBHOOK
    if (webhook) {
      const msg = '✅ AUTO-BEAR DEACTIVATED: Market recovered, returning to normal mode'
      try {
        execSync(`curl -sS -X POST -H "Content-Type: application/json" --data '{"text":"${msg}"}' "${webhook}"`, { shell: '/bin/bash' })
      } catch {}
    }
  }
}

function getMidPrice(coin: string): number | null {
  try {
    const output = execSync(
      `npx tsx scripts/get_mid_price.ts ${coin} 2>/dev/null`,
      { cwd: BASE_DIR, encoding: 'utf-8' }
    )
    const match = output.match(/(\d+\.?\d*)/)
    return match ? parseFloat(match[1]) : null
  } catch {
    return null
  }
}

function getActivePairs(): string[] {
  try {
    const rotationFile = join(BASE_DIR, 'runtime/active_pairs.json')
    if (!existsSync(rotationFile)) return []

    const data = JSON.parse(readFileSync(rotationFile, 'utf-8'))
    return data.pairs || []
  } catch {
    return []
  }
}

function getAccountValue(): number {
  try {
    const output = execSync(
      'npx tsx scripts/check_account.ts 2>/dev/null',
      { cwd: BASE_DIR, encoding: 'utf-8' }
    )
    const match = output.match(/Account Value:\s*(\d+\.?\d*)/)
    return match ? parseFloat(match[1]) : 0
  } catch {
    return 0
  }
}

function getDailyPnL(): number {
  try {
    const logFile = '/root/.pm2/logs/mm-bot-out.log'
    const output = execSync(
      `tail -200 ${logFile} | grep "Daily PnL" | tail -1`,
      { encoding: 'utf-8', shell: '/bin/bash' }
    )
    const match = output.match(/Daily PnL:\s*\$(-?\d+\.?\d*)/)
    return match ? parseFloat(match[1]) : 0
  } catch {
    return 0
  }
}

// ════════════════════════════════════════════════════════════════════
// BEAR CONDITION CHECKS
// ════════════════════════════════════════════════════════════════════

function checkPriceDrops(state: BearState): boolean {
  const pairs = getActivePairs().slice(0, 5) // Top 5
  if (pairs.length < 3) return false

  let dropsCount = 0
  const newSnapshot: Record<string, number> = {}

  for (const pair of pairs) {
    const currentPrice = getMidPrice(pair)
    if (!currentPrice) continue

    newSnapshot[pair] = currentPrice

    const previousPrice = state.priceSnapshot[pair]
    if (previousPrice) {
      const changePercent = ((currentPrice - previousPrice) / previousPrice) * 100

      if (changePercent < -5) {
        console.log(`  ⚠️  ${pair}: ${changePercent.toFixed(2)}% (drop >5%)`)
        dropsCount++
      }
    }
  }

  // Update snapshot
  state.priceSnapshot = newSnapshot

  return dropsCount >= 3
}

function checkDailyLossLimit(): boolean {
  const maxLoss = Number(process.env.MAX_DAILY_LOSS_USD || 300)
  const currentPnL = getDailyPnL()

  if (currentPnL < 0 && Math.abs(currentPnL) > maxLoss * 0.8) {
    console.log(`  ⚠️  Daily PnL: $${currentPnL.toFixed(2)} (>${(maxLoss * 0.8).toFixed(0)} = 80% of limit)`)
    return true
  }

  return false
}

function checkDrawdown(state: BearState): boolean {
  const accountValue = getAccountValue()
  if (!accountValue) return false

  // Update high water mark
  if (accountValue > state.accountHighWater) {
    state.accountHighWater = accountValue
  }

  const drawdown = ((state.accountHighWater - accountValue) / state.accountHighWater) * 100

  if (drawdown > 10) {
    console.log(`  ⚠️  Drawdown: ${drawdown.toFixed(2)}% from high $${state.accountHighWater.toFixed(0)}`)
    return true
  }

  return false
}

function checkRecovery(state: BearState): boolean {
  const pairs = getActivePairs().slice(0, 5)
  if (pairs.length < 3) return false

  let recoveryCount = 0

  for (const pair of pairs) {
    const currentPrice = getMidPrice(pair)
    if (!currentPrice) continue

    const previousPrice = state.priceSnapshot[pair]
    if (previousPrice) {
      const changePercent = ((currentPrice - previousPrice) / previousPrice) * 100

      if (changePercent > 2) { // 2% recovery
        recoveryCount++
      }
    }
  }

  // Need 4/5 pairs recovering
  return recoveryCount >= 4
}

// ════════════════════════════════════════════════════════════════════
// MAIN LOGIC
// ════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n[AUTO-BEAR] Check started: ${new Date().toISOString()}`)

  const state = loadState()
  const currentMode = getCurrentMode()
  state.mode = currentMode

  console.log(`Current mode: ${currentMode.toUpperCase()}`)

  if (currentMode === 'normal') {
    // Check if we should switch to bear
    console.log('\nChecking bear conditions...')

    const priceDrops = checkPriceDrops(state)
    const lossLimit = checkDailyLossLimit()
    const drawdown = checkDrawdown(state)

    const bearConditions = [priceDrops, lossLimit, drawdown].filter(Boolean).length

    console.log(`\nBear conditions met: ${bearConditions}/3`)

    if (bearConditions >= 2) {
      console.log('\n🚨 Multiple bear conditions detected!')
      switchToBear()
      state.mode = 'bear'
      state.switchCount++
      state.lastSwitchTime = new Date().toISOString()
    } else {
      console.log('✅ Market conditions acceptable, staying in normal mode')
    }

  } else {
    // In bear mode, check if we can return to normal
    console.log('\nChecking recovery conditions...')

    const dailyPnL = getDailyPnL()
    const recovery = checkRecovery(state)

    const canRecover = dailyPnL > -50 && recovery

    console.log(`Daily PnL: $${dailyPnL.toFixed(2)}`)
    console.log(`Price recovery: ${recovery}`)

    if (canRecover) {
      console.log('\n📈 Market recovered, returning to normal mode')
      switchToNormal()
      state.mode = 'normal'
      state.switchCount++
      state.lastSwitchTime = new Date().toISOString()
    } else {
      console.log('⚠️  Staying in bear mode (market not fully recovered)')
    }
  }

  state.lastCheck = new Date().toISOString()
  saveState(state)

  console.log(`\n[AUTO-BEAR] Check complete\n`)
}

main().catch(console.error)
