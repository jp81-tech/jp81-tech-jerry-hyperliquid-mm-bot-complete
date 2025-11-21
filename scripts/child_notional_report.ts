import * as fs from 'fs'
import * as path from 'path'

type Stats = {
  count: number
  notionals: number[]
}

function parseNotional(line: string): { pair: string; notional: number } | null {
  const m = line.match(/submit: pair=([A-Z0-9_\-]+).*?notional=([0-9]+\.[0-9]+)/)
  if (!m) return null
  const pair = m[1]
  const notional = parseFloat(m[2])
  if (!isFinite(notional)) return null
  return { pair, notional }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  if (lower === upper) return sorted[lower]
  const frac = idx - lower
  return sorted[lower] + (sorted[upper] - sorted[lower]) * frac
}

function main() {
  const logPath = path.join(process.cwd(), 'bot.log')
  if (!fs.existsSync(logPath)) {
    console.error('bot.log not found')
    process.exit(1)
  }

  const raw = fs.readFileSync(logPath, 'utf8')
  const lines = raw.split('\n')

  const perPair: Record<string, Stats> = {}

  for (const line of lines) {
    if (!line.includes('DEBUG submit:')) continue
    const parsed = parseNotional(line)
    if (!parsed) continue
    const { pair, notional } = parsed
    if (!perPair[pair]) {
      perPair[pair] = { count: 0, notionals: [] }
    }
    perPair[pair].count += 1
    perPair[pair].notionals.push(notional)
  }

  const pairs = Object.keys(perPair)
  if (pairs.length === 0) {
    console.log('Brak danych DEBUG submit z notional w bot.log')
    return
  }

  console.log('Child notional report (na podstawie bot.log)')
  console.log('--------------------------------------------------')

  for (const pair of pairs.sort()) {
    const stats = perPair[pair]
    const arr = stats.notionals.sort((a, b) => a - b)
    const count = stats.count

    if (count === 0) continue

    const min = arr[0]
    const max = arr[arr.length - 1]
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length

    const p25 = percentile(arr, 25)
    const p50 = percentile(arr, 50)
    const p75 = percentile(arr, 75)
    const p90 = percentile(arr, 90)

    console.log(`\nPair: ${pair}`)
    console.log(`  Count: ${count}`)
    console.log(`  Min:   ${min.toFixed(2)} USD`)
    console.log(`  P25:   ${p25.toFixed(2)} USD`)
    console.log(`  Median:${p50.toFixed(2)} USD`)
    console.log(`  P75:   ${p75.toFixed(2)} USD`)
    console.log(`  P90:   ${p90.toFixed(2)} USD`)
    console.log(`  Max:   ${max.toFixed(2)} USD`)
    console.log(`  Avg:   ${avg.toFixed(2)} USD`)
  }

  console.log('\nGotowe ✅')
}

main()
