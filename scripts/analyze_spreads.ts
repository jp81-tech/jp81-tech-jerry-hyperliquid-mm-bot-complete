/**
 * Analyze Spreads - Diagnostic Tool
 *
 * Finds real spread usage from bot logs and compares with config
 */

import { execSync } from "child_process"
import { readFileSync, existsSync } from "fs"

const BOT_DIR = "/root/hyperliquid-mm-bot-complete"

interface SpreadLog {
  symbol: string
  spread: number
  multiplier: number
  global: number
  timestamp?: string
}

// Find logs with target emoji
function findSpreadLogs(): SpreadLog[] {
  const logs: SpreadLog[] = []

  // Try multiple log locations
  const logLocations = [
    "/root/.pm2/logs/hyperliquid-mm-out.log",
    "/root/.pm2/logs/mm-bot-out.log",
    `${BOT_DIR}/bot.log`,
    `${BOT_DIR}/runtime/bot.log`
  ]

  for (const logPath of logLocations) {
    if (existsSync(logPath) === false) continue

    try {
      const content = execSync(`tail -500 "${logPath}" 2>/dev/null`, { encoding: "utf-8" })
      const lines = content.split("\n")

      for (const line of lines) {
        // Match: target symbol spread override: 21 bps (multiplier: 0.60x, global: 35 bps)
        const match = line.match(/🎯\s+([A-Z0-9_-]+)\s+spread override:\s+([0-9.]+)\s+bps\s+\(multiplier:\s+([0-9.]+)x,\s+global:\s+([0-9.]+)\s+bps\)/)

        if (match) {
          const [_, symbol, spread, multiplier, global] = match

          // Extract timestamp if available
          const tsMatch = line.match(/\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\]]*)\]/)

          logs.push({
            symbol: symbol.replace(/-PERP$/, ""),
            spread: parseFloat(spread),
            multiplier: parseFloat(multiplier),
            global: parseFloat(global),
            timestamp: tsMatch ? tsMatch[1] : undefined
          })
        }
      }
    } catch (e) {
      // Skip unreadable logs
    }
  }

  return logs
}

// Get config from .env
function getEnvConfig(): { global: number, overrides: Record<string, number> } {
  const envPath = `${BOT_DIR}/.env`
  if (existsSync(envPath) === false) {
    return { global: 35, overrides: {} }
  }

  const content = readFileSync(envPath, "utf-8")
  const lines = content.split("\n")

  let global = 35
  const overrides: Record<string, number> = {}

  for (const line of lines) {
    const globalMatch = line.match(/^MAKER_SPREAD_BPS=(\d+)/)
    if (globalMatch) {
      global = parseInt(globalMatch[1])
    }

    const overrideMatch = line.match(/^SPREAD_OVERRIDE_([A-Z0-9]+)=(\d+)/)
    if (overrideMatch) {
      overrides[overrideMatch[1]] = parseInt(overrideMatch[2])
    }
  }

  return { global, overrides }
}

// Get active pairs from open orders
function getActivePairs(): string[] {
  try {
    const output = execSync(
      `cd ${BOT_DIR} && npx tsx scripts/check-all-orders.ts 2>/dev/null`,
      { encoding: "utf-8" }
    )

    const symbols = new Set<string>()
    const lines = output.split("\n")

    for (const line of lines) {
      const match = line.match(/^\s+([A-Z0-9]+)\s+\|/)
      if (match) {
        symbols.add(match[1])
      }
    }

    return Array.from(symbols).sort()
  } catch {
    return []
  }
}

async function main() {
  console.log("🔍 Analyzing Spread Usage\n")
  console.log("═".repeat(80))

  // 1. Get config
  const config = getEnvConfig()
  console.log("\n📋 Configuration:")
  console.log(`   Global spread: ${config.global} bps`)
  console.log(`   Overrides defined: ${Object.keys(config.overrides).length}`)

  if (Object.keys(config.overrides).length > 0) {
    console.log("\n   Configured overrides:")
    for (const [symbol, spread] of Object.entries(config.overrides).sort()) {
      const mult = (spread / config.global).toFixed(2)
      console.log(`     ${symbol.padEnd(10)} ${spread} bps  (${mult}× global)`)
    }
  }

  // 2. Find real usage in logs
  console.log("\n" + "═".repeat(80))
  console.log("\n🎯 Real Usage From Bot Logs:\n")

  const spreadLogs = findSpreadLogs()

  if (spreadLogs.length === 0) {
    console.log("   ⚠️  No spread override logs found")
    console.log("   Searched locations:")
    console.log("     - /root/.pm2/logs/hyperliquid-mm-out.log")
    console.log("     - /root/.pm2/logs/mm-bot-out.log")
    console.log("     - /root/hyperliquid-mm-bot-complete/bot.log")
    console.log("\n   Possible reasons:")
    console.log("     1. Bot hasn't logged spreads yet (wait for next MM cycle)")
    console.log("     2. Logs rotated and cleared")
    console.log("     3. Bot not using overrides (check mm_hl.ts getSpreadForPair)")
  } else {
    // Group by symbol and get latest
    const latestBySymbol = new Map<string, SpreadLog>()
    for (const log of spreadLogs) {
      latestBySymbol.set(log.symbol, log)
    }

    console.log("Symbol     | Spread | Multiplier | Global | Status")
    console.log("-----------|--------|------------|--------|------------------")

    for (const [symbol, log] of Array.from(latestBySymbol.entries()).sort()) {
      const configSpread = config.overrides[symbol]
      const status = configSpread === log.spread ? "✅ Match" : `⚠️  Config=${configSpread}`

      console.log(
        `${symbol.padEnd(10)} | ${log.spread.toString().padEnd(6)} | ${log.multiplier.toFixed(2).padEnd(10)} | ${log.global.toString().padEnd(6)} | ${status}`
      )
    }

    console.log(`\n   Total logged: ${spreadLogs.length} entries`)
    console.log(`   Unique symbols: ${latestBySymbol.size}`)
  }

  // 3. Active pairs
  console.log("\n" + "═".repeat(80))
  console.log("\n📊 Active Trading Pairs:\n")

  const activePairs = getActivePairs()

  if (activePairs.length === 0) {
    console.log("   ⚠️  Could not retrieve active pairs")
  } else {
    console.log("Symbol     | Expected Spread | Source")
    console.log("-----------|-----------------|------------------")

    for (const symbol of activePairs) {
      const override = config.overrides[symbol]
      const spread = override || config.global
      const source = override ? `🎯 Override` : `📊 Global (${config.global})`

      console.log(`${symbol.padEnd(10)} | ${spread.toString().padEnd(15)} | ${source}`)
    }

    const withOverrides = activePairs.filter(s => config.overrides[s]).length
    const withGlobal = activePairs.length - withOverrides

    console.log(`\n   Total active: ${activePairs.length}`)
    console.log(`   With overrides: ${withOverrides}`)
    console.log(`   Using global: ${withGlobal}`)
  }

  // 4. Safety summary
  console.log("\n" + "═".repeat(80))

  const configPath = `${BOT_DIR}/spread_config.json`
  if (existsSync(configPath)) {
    const spreadConfig = JSON.parse(readFileSync(configPath, "utf-8"))

    console.log("\n🛡️  Safety Floors:\n")
    console.log(`   Absolute minimum: ${spreadConfig.minSpreadBps} bps`)
    console.log(`   Relative minimum: ${Math.round(spreadConfig.defaultSpreadBps * (spreadConfig.minMultiplier || 0.6))} bps (${spreadConfig.minMultiplier || 0.6}× global)`)
    console.log(`   Maximum allowed: ${spreadConfig.maxSpreadBps} bps`)
  }

  console.log("\n" + "═".repeat(80) + "\n")
}

main().catch(console.error)
