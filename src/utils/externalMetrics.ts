import fs from "fs"
import path from "path"
import type { TopGuardContext } from "./topGuards.js"

function getRuntimeDir(): string {
  const fromEnv = process.env.MDE_RUNTIME_DIR
  if (fromEnv) return path.resolve(fromEnv)
  return path.join(process.cwd(), "runtime")
}

export function loadExternalMetricsForPair(pair: string): Partial<TopGuardContext> {
  const sym = pair.toUpperCase()
  const file = path.join(getRuntimeDir(), `market_metrics_${sym}.json`)

  try {
    const raw = fs.readFileSync(file, "utf8")
    const j = JSON.parse(raw)

    const midPx = typeof j.midPx === "number" ? j.midPx : undefined
    const ret1m = typeof j.ret1m === "number" ? j.ret1m : undefined
    const ret5m = typeof j.ret5m === "number" ? j.ret5m : undefined
    const rsi5m = typeof j.rsi5m === "number" ? j.rsi5m : undefined
    const high24h = typeof j.high24h === "number" ? j.high24h : undefined

    const ctx: Partial<TopGuardContext> = {
      midPx,
      ret1m,
      ret5m,
      rsi5m,
      localHigh24h: high24h,
    }

    return ctx
  } catch {
    return {}
  }
}
