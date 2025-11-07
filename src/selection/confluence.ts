/**
 * Confluence-based capital allocation
 * Combines rotation scoring with copy-trading signals for intelligent sizing
 */

export interface CopyTradingSignal {
  token_symbol: string
  side: 'LONG' | 'SHORT'
  confidence: number
  trader_count: number
  avg_entry_price?: number
  total_position_usd?: number
  reason?: string
}

export interface RotationScore {
  pair: string
  score: number
  volatility24h?: number
}

export interface ConfluenceAnalysis {
  pair: string
  rotationScore?: number      // 0-100 (normalized)
  copyConfidence?: number      // 0-100
  confluenceBoost: number      // 1.0 - 2.0 (multiplier)
  finalAllocation: number      // USD
  priority: 'high' | 'medium' | 'low'
  sources: Array<'rotation' | 'copy'>
  side?: 'LONG' | 'SHORT'      // From copy signal if present
}

export interface ConfluenceConfig {
  baseOrderUsd: number
  totalCapital: number
  minPairAllocation: number
  maxConfluenceBoost: number
  copyBoostWeight: number
  rotationBoostWeight: number
}

/**
 * Analyze confluence between rotation and copy-trading signals
 */
export function analyzeConfluence(
  rotationPairs: RotationScore[],
  copySignals: CopyTradingSignal[],
  config: ConfluenceConfig
): ConfluenceAnalysis[] {

  const analysis: Map<string, ConfluenceAnalysis> = new Map()

  // 1. Normalize rotation scores to 0-100
  const maxRotScore = rotationPairs.length > 0
    ? Math.max(...rotationPairs.map(p => p.score))
    : 1

  rotationPairs.forEach(({pair, score}) => {
    const normalized = (score / maxRotScore) * 100

    // Calculate rotation-only boost (1.0 - 1.3x)
    const rotBoost = 1 + (normalized / 100) * config.rotationBoostWeight

    analysis.set(pair, {
      pair,
      rotationScore: normalized,
      confluenceBoost: rotBoost,
      finalAllocation: config.baseOrderUsd * rotBoost,
      priority: normalized > 70 ? 'high' : normalized > 50 ? 'medium' : 'low',
      sources: ['rotation']
    })
  })

  // 2. Add/merge copy trading signals
  copySignals.forEach(signal => {
    const existing = analysis.get(signal.token_symbol)

    if (existing) {
      // CONFLUENCE! Both sources agree
      existing.copyConfidence = signal.confidence
      existing.sources.push('copy')
      existing.side = signal.side

      // Calculate combined boost
      const copyBoost = 1 + (signal.confidence / 100) * config.copyBoostWeight
      const rotBoost = 1 + (existing.rotationScore! / 100) * config.rotationBoostWeight

      // Confluence = sum of boosts (max limited)
      existing.confluenceBoost = Math.min(
        copyBoost + rotBoost - 1,  // -1 because both start at 1.0
        config.maxConfluenceBoost
      )

      existing.finalAllocation = config.baseOrderUsd * existing.confluenceBoost
      existing.priority = 'high'  // Always high priority for confluence

    } else {
      // Copy-only signal
      const copyBoost = 1 + (signal.confidence / 100) * config.copyBoostWeight

      analysis.set(signal.token_symbol, {
        pair: signal.token_symbol,
        copyConfidence: signal.confidence,
        confluenceBoost: copyBoost,
        finalAllocation: config.baseOrderUsd * copyBoost,
        priority: signal.confidence >= 80 ? 'high' : 'medium',
        sources: ['copy'],
        side: signal.side
      })
    }
  })

  return Array.from(analysis.values())
}

/**
 * Allocate capital across pairs with smart scaling
 */
export function allocateCapital(
  confluence: ConfluenceAnalysis[],
  config: ConfluenceConfig
): ConfluenceAnalysis[] {

  // 1. Sort by priority then boost
  const sorted = [...confluence].sort((a, b) => {
    const priorityOrder = {high: 3, medium: 2, low: 1}
    const diff = priorityOrder[b.priority] - priorityOrder[a.priority]
    if (diff !== 0) return diff
    return b.confluenceBoost - a.confluenceBoost
  })

  // 2. Calculate total desired allocation
  const totalDesired = sorted.reduce((sum, c) => sum + c.finalAllocation, 0)

  // 3. Scale down if exceeds total capital
  if (totalDesired > config.totalCapital) {
    const scaleFactor = config.totalCapital / totalDesired
    sorted.forEach(c => {
      c.finalAllocation *= scaleFactor
    })
  }

  // 4. Filter viable pairs (above minimum)
  const viable = sorted.filter(c => c.finalAllocation >= config.minPairAllocation)

  // 5. Redistribute freed capital to top performers
  const removed = sorted.filter(c => c.finalAllocation < config.minPairAllocation)
  if (removed.length > 0 && viable.length > 0) {
    const freedCapital = removed.reduce((sum, c) => sum + c.finalAllocation, 0)
    const topPairs = viable.slice(0, Math.min(3, viable.length))  // Top 3 get bonus
    const bonusPerPair = freedCapital / topPairs.length

    topPairs.forEach(c => {
      c.finalAllocation = Math.min(
        c.finalAllocation + bonusPerPair,
        config.baseOrderUsd * config.maxConfluenceBoost  // Respect max boost
      )
    })
  }

  return viable
}

/**
 * Get final trading pairs with allocated capital
 */
export function getFinalPairsWithAllocation(
  rotationPairs: RotationScore[],
  copySignals: CopyTradingSignal[],
  config: ConfluenceConfig
): ConfluenceAnalysis[] {

  // 1. Analyze confluence
  const confluence = analyzeConfluence(rotationPairs, copySignals, config)

  // 2. Allocate capital
  const allocated = allocateCapital(confluence, config)

  // 3. Log summary
  const sep = '='.repeat(60)
  console.log(`\n${sep}`)
  console.log('📊 CONFLUENCE ANALYSIS SUMMARY')
  console.log(sep)
  console.log(`Total pairs analyzed: ${confluence.length}`)
  console.log(`Final pairs selected: ${allocated.length}`)
  console.log(`Total capital allocated: $${allocated.reduce((s, c) => s + c.finalAllocation, 0).toFixed(0)}`)
  console.log(`Capital limit: $${config.totalCapital}`)
  console.log('')

  allocated.forEach((c, i) => {
    const sources = c.sources.join('+').toUpperCase()
    const confluenceMark = c.sources.length > 1 ? '⭐' : '  '
    const side = c.side ? ` (${c.side})` : ''

    console.log(
      `${i+1}. ${confluenceMark} ${c.pair.padEnd(8)} ` +
      `$${c.finalAllocation.toFixed(0).padStart(4)} ` +
      `${c.confluenceBoost.toFixed(2)}x ` +
      `[${sources}]${side} ` +
      `(rot:${c.rotationScore?.toFixed(0) || '-'} copy:${c.copyConfidence || '-'})`
    )
  })
  console.log(`${sep}\n`)

  return allocated
}
