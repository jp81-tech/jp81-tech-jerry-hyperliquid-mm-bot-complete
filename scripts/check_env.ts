#!/usr/bin/env ts-node

import fs from 'fs'
import path from 'path'
import 'dotenv/config'

type Issue = {
  level: 'error' | 'warn'
  message: string
}

const REQUIRED_STRINGS = ['PRIVATE_KEY', 'ACTIVE_PAIRS']
const REQUIRED_NUMBERS = ['MAX_DAILY_LOSS_USD', 'BASE_ORDER_USD', 'MAKER_SPREAD_BPS', 'CLIP_USD', 'MIN_NOTIONAL_USD']

function validatePrivateKey(value: string | undefined): Issue[] {
  if (!value) return [{ level: 'error', message: 'PRIVATE_KEY jest pusty.' }]
  if (!value.startsWith('0x') || value.length !== 66) {
    return [{ level: 'warn', message: 'PRIVATE_KEY wygląda podejrzanie (spodziewany format 0x + 64 znaki).' }]
  }
  return []
}

function validateActivePairs(value: string | undefined): Issue[] {
  if (!value) return [{ level: 'error', message: 'ACTIVE_PAIRS nie jest ustawione.' }]
  const pairs = value.split(',').map((p) => p.trim()).filter(Boolean)
  if (pairs.length === 0) {
    return [{ level: 'error', message: 'ACTIVE_PAIRS jest puste po trimowaniu.' }]
  }
  return []
}

function validateNumbers(env: NodeJS.ProcessEnv, keys: string[]): Issue[] {
  const issues: Issue[] = []
  for (const key of keys) {
    const raw = env[key]
    if (raw === undefined) {
      issues.push({ level: 'error', message: `${key} nie jest ustawione.` })
      continue
    }
    const num = Number(raw)
    if (!Number.isFinite(num)) {
      issues.push({ level: 'error', message: `${key} nie jest liczbą (wartość: ${raw}).` })
    } else if (num < 0) {
      issues.push({ level: 'warn', message: `${key} ma wartość ujemną (${num}).` })
    }
  }
  return issues
}

function checkEnvFileExists(): void {
  const envPath = path.join(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) {
    throw new Error('.env nie znaleziony w katalogu roboczym.')
  }
}

function loadEnv(): void {
  const envPath = path.join(process.cwd(), '.env')
  const result = require('dotenv').config({ path: envPath })
  if (result.error) {
    throw result.error
  }
}

function main() {
  checkEnvFileExists()
  loadEnv()

  const issues: Issue[] = []

  issues.push(...validatePrivateKey(process.env.PRIVATE_KEY))
  issues.push(...validateActivePairs(process.env.ACTIVE_PAIRS))
  issues.push(...validateNumbers(process.env, REQUIRED_NUMBERS))

  const dailyCap = process.env.DAILY_NOTIONAL_CAP_USD
  if (dailyCap && Number(dailyCap) < 20000) {
    issues.push({ level: 'warn', message: 'DAILY_NOTIONAL_CAP_USD wydaje się bardzo niskie.' })
  }

  if (issues.length === 0) {
    console.log('✅ .env wygląda poprawnie.')
    return
  }

  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warn')

  if (errors.length) {
    console.error('❌ Znaleziono błędy:')
    errors.forEach((err) => console.error(`   - ${err.message}`))
  }
  if (warnings.length) {
    console.warn('⚠️ Ostrzeżenia:')
    warnings.forEach((warn) => console.warn(`   - ${warn.message}`))
  }

  if (errors.length) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('check_env.ts failed:', err)
  process.exit(1)
})

