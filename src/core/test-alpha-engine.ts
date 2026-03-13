/**
 * Test script for AlphaExtractionEngine
 * Run: npx tsx src/core/test-alpha-engine.ts
 */

import {
  AlphaExtractionEngine,
  TradeSequenceDetector,
  SignalAggregator,
  type TradeSequence,
  type TradingCommand,
} from './AlphaExtractionEngine'
import { determineTradingMode, type TradingModeResult } from './logic/SmartMoneyAnalyzer'

console.log('='.repeat(60))
console.log('AlphaExtractionEngine Test Suite')
console.log('='.repeat(60))
console.log()

// ============================================================
// Test 1: TradeSequenceDetector
// ============================================================
console.log('Test 1: TradeSequenceDetector')
const detector = new TradeSequenceDetector()

// Simulate whale position changes
const mockPositions = new Map()
mockPositions.set('0xb317d2bc2d3d2df5fa441b5bae0ab9d8b07283ae', {
  positions: [
    {
      coin: 'BTC',
      side: 'Long' as const,
      size: 10,
      entryPrice: 100000,
      unrealizedPnl: 50000,
      liquidationPrice: 80000,
      leverage: 10,
      positionValue: 1000000,
    }
  ],
  accountValue: 5000000,
  timestamp: new Date().toISOString(),
})

// First detection (establishes baseline)
let sequences = detector.detectSequences(mockPositions, 'BTC')
console.log(`   Initial scan: ${sequences.length} sequences (expected: 1 - LARGE_POSITION_OPENED)`)

// Simulate position close
mockPositions.set('0xb317d2bc2d3d2df5fa441b5bae0ab9d8b07283ae', {
  positions: [], // Position closed!
  accountValue: 5500000,
  timestamp: new Date().toISOString(),
})

sequences = detector.detectSequences(mockPositions, 'BTC')
console.log(`   After position close: ${sequences.length} sequences`)
if (sequences.length > 0) {
  const seq = sequences[0]
  console.log(`   - Type: ${seq.type}`)
  console.log(`   - Whale: ${seq.whaleName}`)
  console.log(`   - Signal Strength: ${seq.signalStrength}%`)
  console.log(`   - Suggested Action: ${seq.suggestedAction}`)
}
console.log()

// ============================================================
// Test 2: SignalAggregator
// ============================================================
console.log('Test 2: SignalAggregator')
const aggregator = new SignalAggregator()

// Test case 1: Strong SHORT signal
const shortMode: TradingModeResult = {
  mode: 'FOLLOW_SM_SHORT',
  confidence: 85,
  reason: 'SM SHORT dominant and winning',
  maxPositionMultiplier: 0.75,
  positionRatio: 3.0,
  pnlRatio: 10.0,
  longValueUsd: 50000000,
  shortValueUsd: 150000000,
  longPnlUsd: 1000000,
  shortPnlUsd: 15000000,
}

let command = aggregator.generateCommand('BTC', shortMode, [])
console.log(`   Case 1: Strong SHORT signal (no sequence)`)
console.log(`   - Action: ${command.action}`)
console.log(`   - Urgency: ${command.urgency}`)
console.log(`   - Confidence: ${command.confidence}%`)
console.log(`   - Bypass Delay: ${command.bypassDelay}`)
console.log()

// Test case 2: SHORT signal + confirming sequence
const confirmingSequence: TradeSequence = {
  type: 'CONVICTION_TRADER_EXIT',
  coin: 'BTC',
  whaleAddress: '0xb317d2',
  whaleName: 'Bitcoin OG',
  details: {
    previousSize: 10,
    previousSide: 'Long',
    changeUsd: -1000000,
    changePct: -100,
    unrealizedPnl: -50000, // Exiting at loss = panic
  },
  timestamp: new Date(),
  signalStrength: 90,
  suggestedAction: 'FOLLOW',
}

command = aggregator.generateCommand('BTC', shortMode, [confirmingSequence])
console.log(`   Case 2: SHORT signal + whale exiting long at loss`)
console.log(`   - Action: ${command.action}`)
console.log(`   - Urgency: ${command.urgency}`)
console.log(`   - Confidence: ${command.confidence}% (boosted from 85%)`)
console.log(`   - Bypass Delay: ${command.bypassDelay}`)
console.log()

// Test case 3: Squeeze timeout
const squeezeMode: TradingModeResult = {
  mode: 'NEUTRAL',
  confidence: 0,
  reason: 'SQUEEZE TIMEOUT: 14h in CONTRARIAN_LONG - no squeeze, exiting!',
  maxPositionMultiplier: 0,
  positionRatio: 3.0,
  pnlRatio: 0.5,
  longValueUsd: 20000000,
  shortValueUsd: 100000000,
  longPnlUsd: 2000000,
  shortPnlUsd: -5000000,
  squeezeFailed: true,
}

command = aggregator.generateCommand('BTC', squeezeMode, [])
console.log(`   Case 3: Squeeze timeout (squeezeFailed=true)`)
console.log(`   - Action: ${command.action}`)
console.log(`   - Urgency: ${command.urgency}`)
console.log(`   - Bypass Delay: ${command.bypassDelay}`)
console.log(`   - Reason: ${command.reason.slice(0, 60)}...`)
console.log()

// Test case 4: Direction flip sequence
const flipSequence: TradeSequence = {
  type: 'WHALE_FLIPPING_DIRECTION',
  coin: 'ETH',
  whaleAddress: '0x9eec98',
  whaleName: 'SM Active 9eec98',
  details: {
    previousSize: 1000,
    newSize: 800,
    previousSide: 'Long',
    newSide: 'Short',
    changeUsd: 5000000,
  },
  timestamp: new Date(),
  signalStrength: 92,
  suggestedAction: 'FOLLOW',
}

const neutralMode: TradingModeResult = {
  mode: 'NEUTRAL',
  confidence: 40,
  reason: 'Mixed SM signals',
  maxPositionMultiplier: 0.25,
  positionRatio: 1.2,
  pnlRatio: 1.5,
  longValueUsd: 80000000,
  shortValueUsd: 100000000,
  longPnlUsd: 5000000,
  shortPnlUsd: 7000000,
}

command = aggregator.generateCommand('ETH', neutralMode, [flipSequence])
console.log(`   Case 4: Neutral mode + direction flip sequence`)
console.log(`   - Action: ${command.action} (sequence override!)`)
console.log(`   - Urgency: ${command.urgency}`)
console.log(`   - Confidence: ${command.confidence}%`)
console.log(`   - Bypass Delay: ${command.bypassDelay}`)
console.log(`   - Reason: ${command.reason.slice(0, 70)}...`)
console.log()

// ============================================================
// Test 3: AlphaExtractionEngine (Integration)
// ============================================================
console.log('Test 3: AlphaExtractionEngine Integration')
const engine = new AlphaExtractionEngine()

// Set up event listeners
let immediateSignalReceived = false
let updateReceived = false

engine.on('immediate_signal', (cmd: TradingCommand) => {
  immediateSignalReceived = true
  console.log(`   [EVENT] immediate_signal: ${cmd.coin} ${cmd.action}`)
})

engine.on('sequence_detected', (seq: TradeSequence) => {
  console.log(`   [EVENT] sequence_detected: ${seq.type} for ${seq.coin}`)
})

engine.on('update', (data: any) => {
  updateReceived = true
  console.log(`   [EVENT] update: ${Object.keys(data.commands).length} commands, ${data.sequences.length} sequences`)
})

console.log('   Running single update cycle...')
const startTime = Date.now()

try {
  const result = await engine.update()
  const elapsed = Date.now() - startTime

  console.log(`   Update completed in ${elapsed}ms`)
  console.log(`   Commands generated: ${result.commands.size}`)
  console.log(`   Sequences detected: ${result.sequences.length}`)
  console.log()

  // Show sample commands
  console.log('   Sample commands:')
  let count = 0
  result.commands.forEach((cmd, coin) => {
    if (count < 5) {
      console.log(`   - ${coin}: ${cmd.action} (${cmd.confidence}% conf, ${cmd.urgency} urgency)`)
      count++
    }
  })
  console.log()

  // Show high-priority sequences
  if (result.sequences.length > 0) {
    console.log('   Detected sequences:')
    for (const seq of result.sequences.slice(0, 5)) {
      console.log(`   - ${seq.coin}: ${seq.type} by ${seq.whaleName} (${seq.signalStrength}%)`)
    }
  }
} catch (error) {
  console.log(`   Error during update: ${error}`)
}

console.log()

// ============================================================
// Test 4: Urgency Logic
// ============================================================
console.log('Test 4: Urgency Logic Verification')

// IMMEDIATE: Direction flip
const immediateCmd = aggregator.generateCommand('BTC', neutralMode, [flipSequence])
console.log(`   Direction flip → Urgency: ${immediateCmd.urgency} (expected: IMMEDIATE)`)

// HIGH: Strong confidence
const highMode: TradingModeResult = { ...shortMode, confidence: 90 }
const highCmd = aggregator.generateCommand('BTC', highMode, [])
console.log(`   90% confidence → Urgency: ${highCmd.urgency} (expected: HIGH)`)

// NORMAL: Medium confidence
const normalMode: TradingModeResult = { ...shortMode, confidence: 70 }
const normalCmd = aggregator.generateCommand('BTC', normalMode, [])
console.log(`   70% confidence → Urgency: ${normalCmd.urgency} (expected: NORMAL)`)

// LOW: Low confidence
const lowMode: TradingModeResult = { ...shortMode, confidence: 40 }
const lowCmd = aggregator.generateCommand('BTC', lowMode, [])
console.log(`   40% confidence → Urgency: ${lowCmd.urgency} (expected: LOW)`)

console.log()

// ============================================================
// Summary
// ============================================================
console.log('='.repeat(60))
console.log('AlphaExtractionEngine Test Summary')
console.log('='.repeat(60))
console.log()
console.log('Components implemented:')
console.log('  1. TradeSequenceDetector - Front-running pattern detection')
console.log('     - WHALE_CLOSING_POSITION')
console.log('     - WHALE_REDUCING_SIZE')
console.log('     - WHALE_FLIPPING_DIRECTION')
console.log('     - MULTI_WHALE_SAME_MOVE')
console.log('     - LARGE_POSITION_OPENED')
console.log('     - CONVICTION_TRADER_EXIT')
console.log('     - FUND_REBALANCE')
console.log()
console.log('  2. SignalAggregator - Command generation')
console.log('     - Combines trading mode + sequence signals')
console.log('     - Calculates urgency (IMMEDIATE/HIGH/NORMAL/LOW)')
console.log('     - Determines bypassDelay for fast execution')
console.log()
console.log('  3. AlphaExtractionEngine - Main orchestration')
console.log('     - Initializes NansenFeed')
console.log('     - Runs periodic updates')
console.log('     - Emits events: immediate_signal, sequence_detected, update')
console.log('     - Tracks squeeze duration for CONTRARIAN modes')
console.log()
console.log('Event-driven architecture:')
console.log('  - immediate_signal: Bypass standard delays, execute NOW')
console.log('  - sequence_detected: Log for analysis')
console.log('  - update: Full command set for all coins')
console.log()
console.log('='.repeat(60))

// Cleanup
engine.stop()
