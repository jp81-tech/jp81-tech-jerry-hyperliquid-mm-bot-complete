#!/usr/bin/env -S npx tsx
/**
 * Test script for confluence-based capital allocation
 */

import {
  getFinalPairsWithAllocation,
  type CopyTradingSignal,
  type RotationScore
} from '../src/selection/confluence.js'

// Mock rotation pairs (top 6 from rotation daemon)
const rotationPairs: RotationScore[] = [
  { pair: 'kPEPE', score: 95, volatility24h: 12.5 },
  { pair: 'POPCAT', score: 88, volatility24h: 11.2 },
  { pair: 'WIF', score: 82, volatility24h: 10.1 },
  { pair: 'BONK', score: 76, volatility24h: 9.8 },
  { pair: 'MOODENG', score: 71, volatility24h: 9.2 },
  { pair: 'GOAT', score: 68, volatility24h: 8.9 }
]

// Mock copy trading signals (some overlap with rotation)
const copySignals: CopyTradingSignal[] = [
  { token_symbol: 'kPEPE', side: 'LONG', confidence: 85, trader_count: 5, reason: '5 top traders long' },
  { token_symbol: 'CHILLGUY', side: 'LONG', confidence: 75, trader_count: 4, reason: '4 top traders long' },
  { token_symbol: 'WIF', side: 'SHORT', confidence: 70, trader_count: 3, reason: '3 top traders short' }
]

// Test configuration
const config = {
  baseOrderUsd: 100,
  totalCapital: 12000,
  minPairAllocation: 150,
  maxConfluenceBoost: 2.0,
  copyBoostWeight: 0.4,
  rotationBoostWeight: 0.3
}

console.log('🧪 Testing Confluence Analysis')
console.log('=' .repeat(60))
console.log('\n📊 INPUT DATA:')
console.log(`\nRotation pairs (${rotationPairs.length}):`)
rotationPairs.forEach((p, i) => {
  console.log(`  ${i+1}. ${p.pair}: score=${p.score}, vol=${p.volatility24h}%`)
})

console.log(`\nCopy trading signals (${copySignals.length}):`)
copySignals.forEach((s, i) => {
  console.log(`  ${i+1}. ${s.token_symbol}: ${s.side} ${s.confidence}% (${s.trader_count} traders)`)
})

console.log(`\nConfiguration:`)
console.log(`  Base order: $${config.baseOrderUsd}`)
console.log(`  Total capital: $${config.totalCapital}`)
console.log(`  Min allocation: $${config.minPairAllocation}`)
console.log(`  Max boost: ${config.maxConfluenceBoost}x`)
console.log(`  Copy weight: ${config.copyBoostWeight}`)
console.log(`  Rotation weight: ${config.rotationBoostWeight}`)

// Run confluence analysis
const result = getFinalPairsWithAllocation(rotationPairs, copySignals, config)

console.log('\n✅ TEST COMPLETE')
console.log(`\nExpected behaviors:`)
console.log(`  ⭐ kPEPE should have HIGH priority (confluence: rotation + copy)`)
console.log(`  ⭐ WIF should have HIGH priority (confluence: rotation + copy)`)
console.log(`     CHILLGUY should have MEDIUM priority (copy only)`)
console.log(`     POPCAT should have HIGH priority (rotation only, top score)`)
console.log(`     Other rotation pairs should have varying priorities`)
console.log(`\nTotal allocated: $${result.reduce((s, c) => s + c.finalAllocation, 0).toFixed(0)} / $${config.totalCapital}`)
