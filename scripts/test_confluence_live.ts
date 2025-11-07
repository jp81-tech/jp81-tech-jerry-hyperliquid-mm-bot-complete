#!/usr/bin/env -S npx tsx
/**
 * Test confluence with LIVE rotation data
 */

import {
  getFinalPairsWithAllocation,
  type CopyTradingSignal,
  type RotationScore
} from '../src/selection/confluence.js'

// LIVE rotation pairs from daemon
const rotationPairs: RotationScore[] = [
  { pair: 'HMSTR', score: 100, volatility24h: undefined },
  { pair: 'kSHIB', score: 90, volatility24h: undefined },
  { pair: 'BOME', score: 80, volatility24h: undefined },
  { pair: 'ZEC', score: 70, volatility24h: undefined },
  { pair: 'TURBO', score: 60, volatility24h: undefined },
  { pair: 'UMA', score: 50, volatility24h: undefined }
]

// Mock copy trading signals (bot will fetch real ones)
const copySignals: CopyTradingSignal[] = []

// LIVE configuration from .env
const config = {
  baseOrderUsd: 100,
  totalCapital: 9600,  // 80% of $12k
  minPairAllocation: 150,
  maxConfluenceBoost: 2.0,
  copyBoostWeight: 0.4,
  rotationBoostWeight: 0.3
}

console.log('🧪 Testing Confluence with LIVE Rotation Data')
console.log('=' .repeat(60))
console.log('\n📊 ROTATION PAIRS (TOP 6):')
rotationPairs.forEach((p, i) => {
  console.log(`  ${i+1}. ${p.pair}: score=${p.score}`)
})

console.log(`\n📋 COPY SIGNALS: ${copySignals.length} (none yet - bot will fetch real data)`)

console.log(`\n⚙️  Configuration:`)
console.log(`  Base order: $${config.baseOrderUsd}`)
console.log(`  Total capital: $${config.totalCapital} (80% of account)`)
console.log(`  Min allocation: $${config.minPairAllocation}`)
console.log(`  Max boost: ${config.maxConfluenceBoost}x`)

// Run confluence analysis
const result = getFinalPairsWithAllocation(rotationPairs, copySignals, config)

console.log(`\n✅ FINAL RESULT`)
console.log(`Selected ${result.length} pairs for trading`)
console.log(`Total allocated: $${result.reduce((s, c) => s + c.finalAllocation, 0).toFixed(0)}`)
