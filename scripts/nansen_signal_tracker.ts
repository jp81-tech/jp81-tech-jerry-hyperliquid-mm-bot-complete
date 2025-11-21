/**
 * Nansen Signal Tracker
 *
 * Tracks Nansen bias signals over time and measures their accuracy
 * by comparing predicted direction with actual price movement.
 *
 * Data flow:
 * 1. Snapshot bias signals with current price
 * 2. Track price changes after 1h/4h/12h/24h
 * 3. Calculate win rates and average returns
 * 4. Store results in runtime/nansen_signal_stats.json
 */

import * as hl from '@nktkas/hyperliquid'
import fs from 'fs'
import path from 'path'

interface NansenBiasEntry {
  direction: 'long' | 'short' | 'neutral'
  boost: number
  biasStrength: 'strong' | 'soft' | 'neutral'
  confidence?: number
  updatedAt?: string
}

interface SignalSnapshot {
  pair: string
  timestamp: string
  timestampMs: number
  biasDir: 'long' | 'short' | 'neutral'
  boost: number
  biasStrength: 'strong' | 'soft' | 'neutral'
  priceAtSignal: number
  // Filled later by tracking daemon
  priceAfter1h?: number
  priceAfter4h?: number
  priceAfter12h?: number
  priceAfter24h?: number
  // Calculated fields
  return1h?: number
  return4h?: number
  return12h?: number
  return24h?: number
  isCorrect1h?: boolean
  isCorrect4h?: boolean
  isCorrect12h?: boolean
  isCorrect24h?: boolean
}

interface SignalStats {
  period: string // e.g., "2025-11-09"
  totalSignals: number
  strongSignals: number
  softSignals: number
  strongWinRate1h: number
  strongWinRate4h: number
  strongWinRate12h: number
  strongWinRate24h: number
  softWinRate1h: number
  softWinRate4h: number
  softWinRate12h: number
  softWinRate24h: number
  strongAvgReturn4h: number
  strongAvgReturn24h: number
  softAvgReturn4h: number
  softAvgReturn24h: number
  topAccuratePairs: Array<{ pair: string; winRate24h: number }>
  lastUpdated: string
}

const RUNTIME_DIR = path.join(process.cwd(), 'runtime')
const SNAPSHOTS_FILE = path.join(RUNTIME_DIR, 'nansen_signal_snapshots.json')
const STATS_FILE = path.join(RUNTIME_DIR, 'nansen_signal_stats.json')
const BIAS_FILE = path.join(RUNTIME_DIR, 'nansen_bias.json')

/**
 * Load existing snapshots or return empty array
 */
function loadSnapshots(): SignalSnapshot[] {
  try {
    if (fs.existsSync(SNAPSHOTS_FILE)) {
      return JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, 'utf8'))
    }
  } catch (err) {
    console.error('Failed to load snapshots:', err)
  }
  return []
}

/**
 * Save snapshots to disk
 */
function saveSnapshots(snapshots: SignalSnapshot[]): void {
  fs.writeFileSync(SNAPSHOTS_FILE, JSON.stringify(snapshots, null, 2))
}

/**
 * Get current market price for a pair
 */
async function getMarketPrice(
  infoClient: hl.InfoClient,
  pair: string
): Promise<number | null> {
  try {
    const allMids = await infoClient.allMids()
    const midPriceStr = allMids[pair]
    if (!midPriceStr) return null

    return parseFloat(midPriceStr)
  } catch (err) {
    console.error(`Failed to get price for ${pair}:`, err)
    return null
  }
}

/**
 * Create snapshots from current Nansen bias data
 */
async function captureSignalSnapshots(): Promise<void> {
  console.log('📸 Capturing Nansen signal snapshots...')

  // Load current biases
  if (!fs.existsSync(BIAS_FILE)) {
    console.log('⚠️  No bias file found, skipping snapshot')
    return
  }

  const biases: Record<string, NansenBiasEntry> = JSON.parse(
    fs.readFileSync(BIAS_FILE, 'utf8')
  )

  const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })
  const snapshots = loadSnapshots()
  const now = Date.now()
  const timestamp = new Date().toISOString()

  let captured = 0

  for (const [pair, bias] of Object.entries(biases)) {
    // Only snapshot strong and soft signals (skip neutral)
    if (bias.biasStrength === 'neutral') continue

    // Check if we already have a recent snapshot for this pair
    const recentSnapshot = snapshots.find(
      (s) =>
        s.pair === pair &&
        s.biasDir === bias.direction &&
        now - s.timestampMs < 60 * 60 * 1000 // within 1 hour
    )

    if (recentSnapshot) {
      continue // Skip duplicate snapshots
    }

    // Get current market price
    const price = await getMarketPrice(infoClient, pair)
    if (!price) {
      console.log(`⚠️  Could not get price for ${pair}, skipping`)
      continue
    }

    // Create snapshot
    const snapshot: SignalSnapshot = {
      pair,
      timestamp,
      timestampMs: now,
      biasDir: bias.direction,
      boost: bias.boost,
      biasStrength: bias.biasStrength,
      priceAtSignal: price,
    }

    snapshots.push(snapshot)
    captured++
    console.log(
      `✅ Captured ${pair}: ${bias.direction.toUpperCase()} +${bias.boost.toFixed(2)} @ $${price.toFixed(4)}`
    )
  }

  // Keep only last 7 days of snapshots
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
  const filtered = snapshots.filter((s) => s.timestampMs > sevenDaysAgo)

  saveSnapshots(filtered)
  console.log(`📊 Captured ${captured} new snapshots, total: ${filtered.length}`)
}

/**
 * Update price tracking for existing snapshots
 */
async function updatePriceTracking(): Promise<void> {
  console.log('🔄 Updating price tracking...')

  const snapshots = loadSnapshots()
  if (snapshots.length === 0) {
    console.log('⚠️  No snapshots to track')
    return
  }

  const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })
  const now = Date.now()
  let updated = 0

  for (const snapshot of snapshots) {
    const ageMs = now - snapshot.timestampMs
    const ageHours = ageMs / (1000 * 60 * 60)

    // Skip if already fully tracked
    if (
      snapshot.priceAfter1h &&
      snapshot.priceAfter4h &&
      snapshot.priceAfter12h &&
      snapshot.priceAfter24h
    ) {
      continue
    }

    // Get current price
    const currentPrice = await getMarketPrice(infoClient, snapshot.pair)
    if (!currentPrice) continue

    // Update based on age
    if (ageHours >= 1 && !snapshot.priceAfter1h) {
      snapshot.priceAfter1h = currentPrice
      snapshot.return1h = ((currentPrice - snapshot.priceAtSignal) / snapshot.priceAtSignal) * 100

      // Check correctness
      const sign = snapshot.biasDir === 'long' ? 1 : snapshot.biasDir === 'short' ? -1 : 0
      snapshot.isCorrect1h = (currentPrice - snapshot.priceAtSignal) * sign > 0

      updated++
      console.log(`✅ 1h: ${snapshot.pair} ${snapshot.return1h.toFixed(2)}%`)
    }

    if (ageHours >= 4 && !snapshot.priceAfter4h) {
      snapshot.priceAfter4h = currentPrice
      snapshot.return4h = ((currentPrice - snapshot.priceAtSignal) / snapshot.priceAtSignal) * 100

      const sign = snapshot.biasDir === 'long' ? 1 : snapshot.biasDir === 'short' ? -1 : 0
      snapshot.isCorrect4h = (currentPrice - snapshot.priceAtSignal) * sign > 0

      updated++
      console.log(`✅ 4h: ${snapshot.pair} ${snapshot.return4h.toFixed(2)}%`)
    }

    if (ageHours >= 12 && !snapshot.priceAfter12h) {
      snapshot.priceAfter12h = currentPrice
      snapshot.return12h = ((currentPrice - snapshot.priceAtSignal) / snapshot.priceAtSignal) * 100

      const sign = snapshot.biasDir === 'long' ? 1 : snapshot.biasDir === 'short' ? -1 : 0
      snapshot.isCorrect12h = (currentPrice - snapshot.priceAtSignal) * sign > 0

      updated++
      console.log(`✅ 12h: ${snapshot.pair} ${snapshot.return12h.toFixed(2)}%`)
    }

    if (ageHours >= 24 && !snapshot.priceAfter24h) {
      snapshot.priceAfter24h = currentPrice
      snapshot.return24h = ((currentPrice - snapshot.priceAtSignal) / snapshot.priceAtSignal) * 100

      const sign = snapshot.biasDir === 'long' ? 1 : snapshot.biasDir === 'short' ? -1 : 0
      snapshot.isCorrect24h = (currentPrice - snapshot.priceAtSignal) * sign > 0

      updated++
      console.log(`✅ 24h: ${snapshot.pair} ${snapshot.return24h.toFixed(2)}%`)
    }
  }

  saveSnapshots(snapshots)
  console.log(`🔄 Updated ${updated} price points`)
}

/**
 * Calculate statistics from snapshots
 */
function calculateStats(): SignalStats | null {
  console.log('📊 Calculating statistics...')

  const snapshots = loadSnapshots()
  if (snapshots.length === 0) {
    console.log('⚠️  No snapshots available for stats')
    return null
  }

  // Filter to last 24h for daily stats
  const now = Date.now()
  const last24h = snapshots.filter((s) => now - s.timestampMs < 24 * 60 * 60 * 1000)

  const strong = last24h.filter((s) => s.biasStrength === 'strong')
  const soft = last24h.filter((s) => s.biasStrength === 'soft')

  // Calculate win rates
  const strongWin1h = strong.filter((s) => s.isCorrect1h === true).length
  const strongWin4h = strong.filter((s) => s.isCorrect4h === true).length
  const strongWin12h = strong.filter((s) => s.isCorrect12h === true).length
  const strongWin24h = strong.filter((s) => s.isCorrect24h === true).length

  const softWin1h = soft.filter((s) => s.isCorrect1h === true).length
  const softWin4h = soft.filter((s) => s.isCorrect4h === true).length
  const softWin12h = soft.filter((s) => s.isCorrect12h === true).length
  const softWin24h = soft.filter((s) => s.isCorrect24h === true).length

  // Calculate average returns
  const strongReturns4h = strong.filter((s) => s.return4h !== undefined).map((s) => s.return4h!)
  const strongReturns24h = strong.filter((s) => s.return24h !== undefined).map((s) => s.return24h!)
  const softReturns4h = soft.filter((s) => s.return4h !== undefined).map((s) => s.return4h!)
  const softReturns24h = soft.filter((s) => s.return24h !== undefined).map((s) => s.return24h!)

  const avgStrong4h =
    strongReturns4h.length > 0
      ? strongReturns4h.reduce((a, b) => a + b, 0) / strongReturns4h.length
      : 0
  const avgStrong24h =
    strongReturns24h.length > 0
      ? strongReturns24h.reduce((a, b) => a + b, 0) / strongReturns24h.length
      : 0
  const avgSoft4h =
    softReturns4h.length > 0 ? softReturns4h.reduce((a, b) => a + b, 0) / softReturns4h.length : 0
  const avgSoft24h =
    softReturns24h.length > 0
      ? softReturns24h.reduce((a, b) => a + b, 0) / softReturns24h.length
      : 0

  // Top accurate pairs (by 24h win rate)
  const pairStats = new Map<string, { correct: number; total: number }>()
  for (const s of last24h) {
    if (s.isCorrect24h === undefined) continue
    const existing = pairStats.get(s.pair) || { correct: 0, total: 0 }
    existing.total++
    if (s.isCorrect24h) existing.correct++
    pairStats.set(s.pair, existing)
  }

  const topPairs = Array.from(pairStats.entries())
    .map(([pair, stats]) => ({
      pair,
      winRate24h: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
    }))
    .filter((p) => p.winRate24h > 0)
    .sort((a, b) => b.winRate24h - a.winRate24h)
    .slice(0, 5)

  const stats: SignalStats = {
    period: new Date().toISOString().split('T')[0],
    totalSignals: last24h.length,
    strongSignals: strong.length,
    softSignals: soft.length,
    strongWinRate1h:
      strong.filter((s) => s.isCorrect1h !== undefined).length > 0
        ? (strongWin1h / strong.filter((s) => s.isCorrect1h !== undefined).length) * 100
        : 0,
    strongWinRate4h:
      strong.filter((s) => s.isCorrect4h !== undefined).length > 0
        ? (strongWin4h / strong.filter((s) => s.isCorrect4h !== undefined).length) * 100
        : 0,
    strongWinRate12h:
      strong.filter((s) => s.isCorrect12h !== undefined).length > 0
        ? (strongWin12h / strong.filter((s) => s.isCorrect12h !== undefined).length) * 100
        : 0,
    strongWinRate24h:
      strong.filter((s) => s.isCorrect24h !== undefined).length > 0
        ? (strongWin24h / strong.filter((s) => s.isCorrect24h !== undefined).length) * 100
        : 0,
    softWinRate1h:
      soft.filter((s) => s.isCorrect1h !== undefined).length > 0
        ? (softWin1h / soft.filter((s) => s.isCorrect1h !== undefined).length) * 100
        : 0,
    softWinRate4h:
      soft.filter((s) => s.isCorrect4h !== undefined).length > 0
        ? (softWin4h / soft.filter((s) => s.isCorrect4h !== undefined).length) * 100
        : 0,
    softWinRate12h:
      soft.filter((s) => s.isCorrect12h !== undefined).length > 0
        ? (softWin12h / soft.filter((s) => s.isCorrect12h !== undefined).length) * 100
        : 0,
    softWinRate24h:
      soft.filter((s) => s.isCorrect24h !== undefined).length > 0
        ? (softWin24h / soft.filter((s) => s.isCorrect24h !== undefined).length) * 100
        : 0,
    strongAvgReturn4h: avgStrong4h,
    strongAvgReturn24h: avgStrong24h,
    softAvgReturn4h: avgSoft4h,
    softAvgReturn24h: avgSoft24h,
    topAccuratePairs: topPairs,
    lastUpdated: new Date().toISOString(),
  }

  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2))
  console.log('✅ Stats saved to', STATS_FILE)

  return stats
}

/**
 * Print stats summary
 */
function printStats(stats: SignalStats): void {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📊 Nansen Signal Accuracy Report')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Period: ${stats.period}`)
  console.log(`Total signals: ${stats.totalSignals} (${stats.strongSignals} strong, ${stats.softSignals} soft)`)
  console.log('')
  console.log('🔥 Strong signals (boost ≥ 2.0):')
  console.log(`   1h win rate:  ${stats.strongWinRate1h.toFixed(1)}%`)
  console.log(`   4h win rate:  ${stats.strongWinRate4h.toFixed(1)}%`)
  console.log(`   12h win rate: ${stats.strongWinRate12h.toFixed(1)}%`)
  console.log(`   24h win rate: ${stats.strongWinRate24h.toFixed(1)}%`)
  console.log(`   Avg 4h return:  ${stats.strongAvgReturn4h > 0 ? '+' : ''}${stats.strongAvgReturn4h.toFixed(2)}%`)
  console.log(`   Avg 24h return: ${stats.strongAvgReturn24h > 0 ? '+' : ''}${stats.strongAvgReturn24h.toFixed(2)}%`)
  console.log('')
  console.log('💡 Soft signals (boost < 2.0):')
  console.log(`   1h win rate:  ${stats.softWinRate1h.toFixed(1)}%`)
  console.log(`   4h win rate:  ${stats.softWinRate4h.toFixed(1)}%`)
  console.log(`   12h win rate: ${stats.softWinRate12h.toFixed(1)}%`)
  console.log(`   24h win rate: ${stats.softWinRate24h.toFixed(1)}%`)
  console.log(`   Avg 4h return:  ${stats.softAvgReturn4h > 0 ? '+' : ''}${stats.softAvgReturn4h.toFixed(2)}%`)
  console.log(`   Avg 24h return: ${stats.softAvgReturn24h > 0 ? '+' : ''}${stats.softAvgReturn24h.toFixed(2)}%`)
  console.log('')
  console.log('🎯 Top accurate pairs (24h):')
  stats.topAccuratePairs.forEach((p, i) => {
    console.log(`   ${i + 1}. ${p.pair}: ${p.winRate24h.toFixed(1)}%`)
  })
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2)
  const command = args[0] || 'update'

  switch (command) {
    case 'snapshot':
      await captureSignalSnapshots()
      break

    case 'track':
      await updatePriceTracking()
      break

    case 'stats':
      const stats = calculateStats()
      if (stats) printStats(stats)
      break

    case 'update':
      // Full update cycle
      await captureSignalSnapshots()
      await updatePriceTracking()
      const updatedStats = calculateStats()
      if (updatedStats) printStats(updatedStats)
      break

    default:
      console.log('Usage:')
      console.log('  npx tsx scripts/nansen_signal_tracker.ts snapshot  - Capture new signal snapshots')
      console.log('  npx tsx scripts/nansen_signal_tracker.ts track     - Update price tracking')
      console.log('  npx tsx scripts/nansen_signal_tracker.ts stats     - Calculate and print stats')
      console.log('  npx tsx scripts/nansen_signal_tracker.ts update    - Do all of the above')
  }
}

main().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
