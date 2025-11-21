/**
 * Risk Management Adapter - Phase 1: Shadow Mode
 *
 * This module logs "what would happen" if risk limits were enforced,
 * without actually interfering with trading.
 */

import fs from "fs"
import path from "path"

// ──────────────────────────────────────────────────────────────
// 1️⃣ Config loading from environment
// ──────────────────────────────────────────────────────────────

export interface RiskShadowConfig {
  enabled: boolean
  logPath: string
  maxLossPerSideUsd: Record<string, number> // pair -> limit
  defaultMaxLossUsd: number
}

export function loadRiskShadowConfig(): RiskShadowConfig {
  const enabled = process.env.RISK_SHADOW_ENABLED === "true"
  const logPath = process.env.RISK_SHADOW_LOG_PATH || "/root/hyperliquid-mm-bot-complete/data/risk_shadow.log"

  // Per-pair overrides
  const perPair: Record<string, number> = {}
  for (const key of Object.keys(process.env)) {
    const match = key.match(/^RISK_SHADOW_(.+)_MAX_LOSS_USD$/)
    if (match) {
      const pair = match[1]
      const val = parseFloat(process.env[key] || "0")
      if (val > 0) perPair[pair] = val
    }
  }

  const defaultMax = parseFloat(process.env.RISK_SHADOW_DEFAULT_MAX_LOSS_USD || "20")

  return {
    enabled,
    logPath,
    maxLossPerSideUsd: perPair,
    defaultMaxLossUsd: defaultMax,
  }
}

// ──────────────────────────────────────────────────────────────
// 2️⃣ Shadow evaluation function
// ──────────────────────────────────────────────────────────────

export interface PositionSnapshot {
  pair: string
  side: "buy" | "sell" | "flat"
  sizeAbs: number
  entryPx: number
  markPx: number
  unrealizedPnl: number
}

/**
 * Evaluate risk in shadow mode:
 * - Check if position exceeds loss limits
 * - Log to file what action would be taken
 * - Return false (never actually closes position in shadow mode)
 */
export function evaluateRiskShadow(
  pos: PositionSnapshot,
  config: RiskShadowConfig
): boolean {
  if (!config.enabled) return false
  if (pos.side === "flat") return false

  const limit = config.maxLossPerSideUsd[pos.pair] || config.defaultMaxLossUsd
  const wouldTrigger = pos.unrealizedPnl <= -limit

  if (wouldTrigger) {
    const logEntry = {
      ts: new Date().toISOString(),
      pair: pos.pair,
      side: pos.side,
      sizeAbs: pos.sizeAbs,
      entryPx: pos.entryPx,
      markPx: pos.markPx,
      unrealizedPnl: pos.unrealizedPnl.toFixed(2),
      limit: limit.toFixed(2),
      action: "WOULD_CLOSE",
      mode: "SHADOW",
    }

    try {
      const logLine = JSON.stringify(logEntry) + "\n"
      fs.appendFileSync(config.logPath, logLine, "utf-8")
    } catch (err) {
      console.warn(`[RISK_SHADOW] Failed to write log: ${err}`)
    }
  }

  return false // Shadow mode NEVER actually closes
}

// ──────────────────────────────────────────────────────────────
// 3️⃣ Helper: Convert API position to PositionSnapshot
// ──────────────────────────────────────────────────────────────

export function toPositionSnapshot(apiPos: any): PositionSnapshot | null {
  if (!apiPos || !apiPos.position) return null

  const coin = apiPos.position.coin
  const szi = parseFloat(apiPos.position.szi || "0")
  const entryPx = parseFloat(apiPos.position.entryPx || "0")
  const markPx = parseFloat(apiPos.position.positionValue || "0") / Math.abs(szi)
  const unrealizedPnl = parseFloat(apiPos.position.unrealizedPnl || "0")

  if (Math.abs(szi) < 1e-6) {
    return {
      pair: coin,
      side: "flat",
      sizeAbs: 0,
      entryPx: 0,
      markPx: 0,
      unrealizedPnl: 0,
    }
  }

  const side: "buy" | "sell" = szi > 0 ? "buy" : "sell"

  return {
    pair: coin,
    side,
    sizeAbs: Math.abs(szi),
    entryPx,
    markPx,
    unrealizedPnl,
  }
}
