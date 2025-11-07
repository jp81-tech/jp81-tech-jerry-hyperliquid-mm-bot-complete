#!/usr/bin/env -S npx tsx
/**
 * Test confluence with LIVE rotation data and updated config
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

// Mock copy trading signals (example - bot will fetch real ones)
const copySignals: CopyTradingSignal[] = [
  { token_symbol: 'HMSTR', side: 'SHORT', confidence: 85, trader_count: 5, reason: 'Example' },
  { token_symbol: 'kSHIB', side: 'LONG', confidence: 70, trader_count: 4, reason: 'Example' }
]

// UPDATED configuration
const config = {
  baseOrderUsd: 200,        // Increased from 100
  totalCapital: 9600,       // 80% of $12k
  minPairAllocation: 100,   // Decreased from 150
  maxConfluenceBoost: 2.0,
  copyBoostWeight: 0.4,
  rotationBoostWeight: 0.3
}

console.log('🧪 Testing Confluence with UPDATED Config')
console.log('=' .repeat(60))
console.log('\n📊 ROTATION PAIRS (TOP 6):')
rotationPairs.forEach((p, i) => {
  console.log(`  ${i+1}. ${p.pair}: score=${p.score}`)
})

console.log(`\n🔥 COPY SIGNALS (EXAMPLE): ${copySignals.length}`)
copySignals.forEach((s, i) => {
  console.log(`  ${i+1}. ${s.token_symbol}: ${s.side} ${s.confidence}% (${s.trader_count} traders)`)
})

console.log(`\n⚙️  Configuration:`)
console.log(`  Base order: $${config.baseOrderUsd} (was $100)`)
console.log(`  Total capital: $${config.totalCapital} (80% of account)`)
console.log(`  Min allocation: $${config.minPairAllocation} (was $150)`)
console.log(`  Max boost: ${config.maxConfluenceBoost}x`)

// Run confluence analysis
const result = getFinalPairsWithAllocation(rotationPairs, copySignals, config)

console.log(`\n✅ FINAL RESULT`)
console.log(`Selected ${result.length} pairs for trading`)
console.log(`Total allocated: $${result.reduce((s, c) => s + c.finalAllocation, 0).toFixed(0)}`)
