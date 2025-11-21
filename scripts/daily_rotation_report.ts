#!/usr/bin/env -S npx tsx
/**
 * DAILY ROTATION REPORT
 *
 * Generuje codzienny raport dla par z rotacji zawierający:
 * - Volume 24h USD
 * - Liczba aktywnych traderów
 * - Base score (płynność/volatility)
 * - Nansen signal (boost)
 * - Obliczony spread w bps (10-40 bps range)
 * - Override spreads (jeśli są)
 */

import { execSync } from "child_process"
import { writeFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"

const REPORTS_DIR = "/root/hyperliquid-mm-bot-complete/reports"
const MIN_SPREAD_BPS = 10
const MAX_SPREAD_BPS = 40

interface TokenMetrics {
  symbol: string
  timestamp: string

  // Market data
  price: number
  volume24h: number
  activeTraders: number

  // Scores
  baseScore: number
  nansenBoost: number
  totalScore: number

  // Nansen signal
  nansenSide: "BUYING" | "SELLING" | "NEUTRAL"
  nansenVolume: string

  // Spread calculation
  calculatedSpreadBps: number
  overrideSpreadBps?: number
  finalSpreadBps: number

  // Position info
  hasPosition: boolean
  positionSide?: "LONG" | "SHORT"
  positionSize?: number
  positionNotionalUsd?: number

  // Rotation status
  inRotation: boolean
  rotationRank?: number
  isConfluence: boolean
}

// ════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════════

function calculateSpread(
  volume24h: number,
  activeTraders: number,
  baseScore: number,
  nansenBoost: number
): number {
  // Normalizacja parametrów (0-1)
  const volumeScore = Math.min(volume24h / 20_000_000, 1) // $20M = max
  const traderScore = Math.min(activeTraders / 5000, 1) // 5000 = max
  const baseScoreNorm = Math.min(baseScore / 40, 1) // 40 = max base score
  const nansenScore = Math.min(nansenBoost / 3, 1) // +3 = max boost

  // Wagi
  const weights = {
    volume: 0.35,
    traders: 0.25,
    base: 0.30,
    nansen: 0.10
  }

  // Composite score (0-1)
  const composite =
    volumeScore * weights.volume +
    traderScore * weights.traders +
    baseScoreNorm * weights.base +
    nansenScore * weights.nansen

  // Im wyższy composite, tym węższy spread (odwrotna zależność)
  // composite = 1.0 → MIN_SPREAD_BPS
  // composite = 0.0 → MAX_SPREAD_BPS
  const spread = MAX_SPREAD_BPS - (composite * (MAX_SPREAD_BPS - MIN_SPREAD_BPS))

  return Math.round(spread)
}

function getNansenData(symbol: string): any {
  try {
    const logs = execSync(
      `tail -2000 /root/.pm2/logs/mm-bot-out.log | grep "Nansen.*${symbol}:" | tail -1`,
      { encoding: "utf-8" }
    ).trim()

    const match = logs.match(
      /\[Nansen\] ([A-Z0-9]+): base=([\d.]+), nansen=\+([\d.]+), total=([\d.]+) \| (🟢|🔴) (BUYING|SELLING) \$([\d.]+[KM]) \| ([\d]+) traders/
    )

    if (match) {
      return {
        baseScore: parseFloat(match[2]),
        nansenBoost: parseFloat(match[3]),
        totalScore: parseFloat(match[4]),
        side: match[6] as "BUYING" | "SELLING",
        volume: match[7],
        traders: parseInt(match[8])
      }
    }
  } catch {}

  return null
}

function getMarketData(symbol: string): any {
  try {
    const allMids = execSync(
      'curl -s https://api.hyperliquid.xyz/info -X POST -H "Content-Type: application/json" -d "{\\"type\\":\\"allMids\\"}"',
      { encoding: "utf-8" }
    )
    const mids = JSON.parse(allMids)
    return { price: parseFloat(mids[symbol] || "0") }
  } catch {
    return { price: 0 }
  }
}

function getPosition(symbol: string): any {
  try {
    const positions = execSync(
      "npx tsx /root/hyperliquid-mm-bot-complete/scripts/check_positions.ts 2>/dev/null",
      { encoding: "utf-8" }
    )

    const match = positions.match(new RegExp(`${symbol}:\\s+(LONG|SHORT)\\s+([\\d,.-]+)`))
    if (match) {
      return {
        side: match[1],
        size: parseFloat(match[2].replace(/,/g, ""))
      }
    }
  } catch {}

  return null
}

function getRotationPairs(): string[] {
  try {
    const logs = execSync(
      "tail -500 /root/.pm2/logs/mm-bot-out.log | grep optimal | tail -1",
      { encoding: "utf-8" }
    ).trim()

    const match = logs.match(/optimal: (.+)/)
    if (match) {
      return match[1].split(",").map(s => s.trim())
    }
  } catch {}

  return []
}

function getSpreadOverride(symbol: string): number | undefined {
  // Sprawdź czy jest override w .env
  try {
    const env = execSync("cat /root/hyperliquid-mm-bot-complete/.env", { encoding: "utf-8" })
    const match = env.match(new RegExp(`SPREAD_OVERRIDE_${symbol}=(\\d+)`))
    if (match) {
      return parseInt(match[1])
    }
  } catch {}

  return undefined
}

// ════════════════════════════════════════════════════════════════════
// MAIN REPORT GENERATION
// ════════════════════════════════════════════════════════════════════

async function generateReport(): Promise<void> {
  console.log("\n📊 Generating Daily Rotation Report...")
  console.log("=" .repeat(80))

  const timestamp = new Date().toISOString()
  const dateStr = new Date().toISOString().split("T")[0]

  // Get rotation pairs
  const rotationPairs = getRotationPairs()
  console.log(`\n✓ Rotation pairs: ${rotationPairs.join(", ")}`)

  // Get all tokens from Nansen logs
  const nansenLogs = execSync(
    "tail -2000 /root/.pm2/logs/mm-bot-out.log | grep 'Nansen.*base=' | tail -20",
    { encoding: "utf-8" }
  )

  const tokensSet = new Set<string>()
  for (const line of nansenLogs.split("\n")) {
    const match = line.match(/\[Nansen\] ([A-Z0-9]+):/)
    if (match) tokensSet.add(match[1])
  }

  const tokens = Array.from(tokensSet)
  console.log(`✓ Found ${tokens.length} tokens with Nansen data`)

  // Collect metrics for each token
  const metrics: TokenMetrics[] = []

  for (const symbol of tokens) {
    const nansen = getNansenData(symbol)
    if (!nansen) continue

    const market = getMarketData(symbol)
    const position = getPosition(symbol)
    const overrideSpread = getSpreadOverride(symbol)
    const inRotation = rotationPairs.includes(symbol)
    const rotationRank = inRotation ? rotationPairs.indexOf(symbol) + 1 : undefined

    // Calculate spread
    const calculatedSpread = calculateSpread(
      nansen.traders * 1000, // Approximate volume from traders
      nansen.traders,
      nansen.baseScore,
      nansen.nansenBoost
    )

    const finalSpread = overrideSpread ?? calculatedSpread

    const metric: TokenMetrics = {
      symbol,
      timestamp,

      price: market.price,
      volume24h: nansen.traders * 1000, // Approximate
      activeTraders: nansen.traders,

      baseScore: nansen.baseScore,
      nansenBoost: nansen.nansenBoost,
      totalScore: nansen.totalScore,

      nansenSide: nansen.side,
      nansenVolume: nansen.volume,

      calculatedSpreadBps: calculatedSpread,
      overrideSpreadBps: overrideSpread,
      finalSpreadBps: finalSpread,

      hasPosition: !!position,
      positionSide: position?.side,
      positionSize: position?.size,
      positionNotionalUsd: position ? Math.abs(position.size * market.price) : undefined,

      inRotation,
      rotationRank,
      isConfluence: inRotation && nansen.side === "BUYING"
    }

    metrics.push(metric)
  }

  // Sort by total score (descending)
  metrics.sort((a, b) => b.totalScore - a.totalScore)

  console.log(`✓ Collected metrics for ${metrics.length} tokens\n`)

  // ════════════════════════════════════════════════════════════════════
  // GENERATE REPORT
  // ════════════════════════════════════════════════════════════════════

  let report = ""

  report += "# DAILY ROTATION REPORT\n"
  report += `Generated: ${timestamp}\n`
  report += `Date: ${dateStr}\n`
  report += "\n"
  report += "## Current Rotation\n"
  report += `Pairs: ${rotationPairs.join(", ")}\n`
  report += "\n"
  report += "## Token Metrics\n"
  report += "\n"
  report += "| Token | Score | Base | Nansen | Side | Volume | Traders | Spread | Override | Final | Pos | Rot |\n"
  report += "|-------|-------|------|--------|------|--------|---------|--------|----------|-------|-----|-----|\n"

  for (const m of metrics) {
    const override = m.overrideSpreadBps ? `${m.overrideSpreadBps}` : "-"
    const pos = m.hasPosition ? `${m.positionSide} $${(m.positionNotionalUsd || 0).toFixed(0)}` : "-"
    const rot = m.inRotation ? `#${m.rotationRank}` : "-"
    const conf = m.isConfluence ? "✅" : ""

    report += `| ${m.symbol.padEnd(6)} | ${m.totalScore.toFixed(1).padStart(5)} | ${m.baseScore.toFixed(1).padStart(4)} | +${m.nansenBoost.toFixed(2)} | ${m.nansenSide === "BUYING" ? "🟢 BUY" : "🔴 SELL"} | ${m.nansenVolume.padStart(6)} | ${m.activeTraders.toString().padStart(7)} | ${m.calculatedSpreadBps.toString().padStart(6)} | ${override.padStart(8)} | ${m.finalSpreadBps.toString().padStart(5)} | ${pos.padEnd(11)} | ${rot.padEnd(3)} ${conf} |\n`
  }

  report += "\n"
  report += "## Spread Calculation Details\n"
  report += "\n"
  report += `Range: ${MIN_SPREAD_BPS}-${MAX_SPREAD_BPS} bps\n`
  report += "Weights:\n"
  report += "- Volume 24h: 35%\n"
  report += "- Active Traders: 25%\n"
  report += "- Base Score: 30%\n"
  report += "- Nansen Boost: 10%\n"
  report += "\n"
  report += "Formula: Higher composite score → Tighter spread\n"
  report += "- Best metrics → ~10 bps\n"
  report += "- Worst metrics → ~40 bps\n"
  report += "\n"
  report += "## Confluence Tokens (Rotation + Nansen BUYING)\n"
  report += "\n"

  const confluenceTokens = metrics.filter(m => m.isConfluence)
  if (confluenceTokens.length > 0) {
    report += "These tokens get 2.0x capital boost:\n\n"
    for (const m of confluenceTokens) {
      report += `- **${m.symbol}**: Score ${m.totalScore.toFixed(2)}, ${m.nansenVolume} buying, ${m.activeTraders} traders\n`
    }
  } else {
    report += "None\n"
  }

  report += "\n"
  report += "## Position Summary\n"
  report += "\n"

  const positionTokens = metrics.filter(m => m.hasPosition)
  if (positionTokens.length > 0) {
    let totalNotional = 0
    for (const m of positionTokens) {
      totalNotional += m.positionNotionalUsd || 0
      report += `- **${m.symbol}**: ${m.positionSide} ${m.positionSize?.toFixed(2)} = $${(m.positionNotionalUsd || 0).toFixed(2)}\n`
    }
    report += `\nTotal deployed: $${totalNotional.toFixed(2)}\n`
  } else {
    report += "No active positions\n"
  }

  // ════════════════════════════════════════════════════════════════════
  // SAVE JSON & MARKDOWN
  // ════════════════════════════════════════════════════════════════════

  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true })
  }

  // Save JSON
  const jsonPath = join(REPORTS_DIR, `rotation_report_${dateStr}.json`)
  writeFileSync(jsonPath, JSON.stringify(metrics, null, 2))
  console.log(`✓ JSON saved: ${jsonPath}`)

  // Save Markdown
  const mdPath = join(REPORTS_DIR, `rotation_report_${dateStr}.md`)
  writeFileSync(mdPath, report)
  console.log(`✓ Markdown saved: ${mdPath}`)

  // Save latest
  const latestJsonPath = join(REPORTS_DIR, "latest_rotation_report.json")
  const latestMdPath = join(REPORTS_DIR, "latest_rotation_report.md")
  writeFileSync(latestJsonPath, JSON.stringify(metrics, null, 2))
  writeFileSync(latestMdPath, report)
  console.log(`✓ Latest reports updated`)

  // Print summary
  console.log("\n" + "=".repeat(80))
  console.log("\n📊 SUMMARY\n")
  console.log(`Tokens analyzed: ${metrics.length}`)
  console.log(`In rotation: ${metrics.filter(m => m.inRotation).length}`)
  console.log(`Confluence: ${confluenceTokens.length}`)
  console.log(`Active positions: ${positionTokens.length}`)
  console.log("\n" + report)
}

generateReport().catch(console.error)
