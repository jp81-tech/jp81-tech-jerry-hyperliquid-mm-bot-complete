import * as fs from "fs"
import * as path from "path"

const ENV_PATH = path.join(process.cwd(), ".env")
const LOG_PATH = process.env.BOT_LOG_PATH || path.join(process.cwd(), "bot.log")

const LOG_RE = /🎯 ([A-Z0-9_]+) spread override: ([0-9.]+) bps \(multiplier: ([0-9.]+)x, global: ([0-9.]+) bps\)/

interface EnvOverride {
  symbol: string
  spread: number
}

interface LogSpread {
  symbol: string
  spread: number
  multiplier: number
  global: number
  line: string
}

function loadEnvOverrides(): Map<string, EnvOverride> {
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(`.env not found at ${ENV_PATH}`)
  }

  const text = fs.readFileSync(ENV_PATH, "utf8")
  const lines = text.split(/\r?\n/)
  const overrides = new Map<string, EnvOverride>()

  for (const line of lines) {
    if (!line.startsWith("SPREAD_OVERRIDE_")) continue
    const eqIdx = line.indexOf("=")
    if (eqIdx === -1) continue

    const key = line.slice(0, eqIdx).trim()
    const value = line.slice(eqIdx + 1).trim().split(/\s+/)[0]
    const symbol = key.replace("SPREAD_OVERRIDE_", "").toUpperCase()
    const spread = Number(value)

    if (!Number.isFinite(spread)) continue
    overrides.set(symbol, { symbol, spread })
  }

  return overrides
}

function loadLogSpreads(): Map<string, LogSpread> {
  if (!fs.existsSync(LOG_PATH)) {
    throw new Error(`Log file not found at ${LOG_PATH}`)
  }

  const text = fs.readFileSync(LOG_PATH, "utf8")
  const lines = text.split(/\r?\n/)
  const spreads = new Map<string, LogSpread>()

  for (const line of lines) {
    const m = line.match(LOG_RE)
    if (!m) continue

    const [, symbol, spreadStr, multStr, globalStr] = m
    const spread = Number(spreadStr)
    const multiplier = Number(multStr)
    const global = Number(globalStr)

    if (!Number.isFinite(spread)) continue

    spreads.set(symbol, {
      symbol,
      spread,
      multiplier,
      global,
      line
    })
  }

  return spreads
}

function main() {
  try {
    const envOverrides = loadEnvOverrides()
    const logSpreads = loadLogSpreads()
    const allSymbols = new Set<string>()

    for (const s of envOverrides.keys()) allSymbols.add(s)
    for (const s of logSpreads.keys()) allSymbols.add(s)

    if (allSymbols.size === 0) {
      console.log("No symbols found in .env or log.")
      return
    }

    const mismatches: string[] = []
    const lines: string[] = []

    lines.push("📊 Spread Mismatch Check")
    lines.push("")
    lines.push(
      [
        "SYMBOL".padEnd(8),
        "ENV".padStart(6),
        "LOG".padStart(6),
        "DIFF".padStart(7),
        "GLOBAL".padStart(7),
        "MULT".padStart(7),
        "STATUS".padStart(10)
      ].join(" ")
    )

    for (const symbol of Array.from(allSymbols).sort()) {
      const env = envOverrides.get(symbol)
      const log = logSpreads.get(symbol)

      const envSpread = env?.spread ?? NaN
      const logSpread = log?.spread ?? NaN

      let status = "OK"
      let diffStr = ""
      let diff = 0

      if (!Number.isFinite(envSpread) && !Number.isFinite(logSpread)) {
        status = "NO_DATA"
      } else if (!Number.isFinite(envSpread)) {
        status = "ENV_MISSING"
      } else if (!Number.isFinite(logSpread)) {
        status = "LOG_MISSING"
      } else {
        diff = logSpread - envSpread
        diffStr = diff.toFixed(2)
        const absDiff = Math.abs(diff)

        if (absDiff > 0.1) {
          status = "MISMATCH"
          mismatches.push(
            `${symbol}: env=${envSpread} bps, log=${logSpread} bps (diff=${diff.toFixed(2)})`
          )
        } else {
          status = "MATCH"
        }
      }

      const row = [
        symbol.padEnd(8),
        Number.isFinite(envSpread) ? envSpread.toFixed(2).padStart(6) : "  -   ",
        Number.isFinite(logSpread) ? logSpread.toFixed(2).padStart(6) : "  -   ",
        diffStr.padStart(7),
        log && Number.isFinite(log.global) ? log.global.toFixed(2).padStart(7) : "  -   ",
        log && Number.isFinite(log.multiplier) ? log.multiplier.toFixed(2).padStart(7) : "  -   ",
        status.padStart(10)
      ].join(" ")

      lines.push(row)
    }

    console.log(lines.join("\n"))

    if (mismatches.length > 0) {
      console.log("")
      console.log("⚠️ Detected mismatches:")
      for (const m of mismatches) {
        console.log("- " + m)
      }
      process.exitCode = 1
    } else {
      console.log("")
      console.log("✅ ENV and LOG spreads match for all symbols.")
    }
  } catch (err) {
    console.error("Error in check_spread_mismatch:", err)
    process.exitCode = 2
  }
}

main()
