#!/usr/bin/env node
/**
 * Generate Spread Overrides + Nansen Bias Lock Data
 *
 * Collects real-time metrics from Nansen API and:
 * 1. Calculates optimal spreads for each token
 * 2. Generates nansen_bias.json with directional bias for risk management
 */

import 'dotenv/config'
import path from "path"
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs"
import { calculateSpreadForPair, type PairMetrics, type SpreadConfig, type SpreadOverrides } from "../src/spreadCalculator.js"
import { NansenHyperliquidAPI } from "../src/integrations/nansen_scoring.js"

const BASE_DIR = process.env.GEN_SPREAD_BASE_DIR || path.resolve(process.cwd())

// Load configuration
const configPath = `${BASE_DIR}/spread_config.json`
const overridesPath = `${BASE_DIR}/manual_spread_overrides.json`

const config: SpreadConfig = JSON.parse(readFileSync(configPath, "utf-8"))
const manualOverrides: SpreadOverrides = existsSync(overridesPath)
  ? JSON.parse(readFileSync(overridesPath, "utf-8"))
  : {}

// Get Nansen data directly from API
async function getNansenMetricsFromAPI(): Promise<Map<string, any>> {
  const nansen = new NansenHyperliquidAPI(process.env.NANSEN_API_KEY)
  
  if (!nansen.isEnabled()) {
    console.error("# ⚠️  Nansen API key not found - spread generation disabled")
    return new Map()
  }

  try {
    // Fetch top 100 tokens by buy/sell pressure
    const tokens = await nansen.getPerpScreener({ 
      limit: 100, 
      sortBy: 'buy_sell_pressure' 
    })

    if (tokens.length === 0) {
      console.error("# ⚠️  No Nansen data returned from API")
      return new Map()
    }

    const metrics = new Map()
    const nansenWeight = parseFloat(process.env.NANSEN_WEIGHT || '0.35')

    for (const token of tokens) {
      // Calculate Nansen boost using same logic as nansen_scoring.ts
      const nansenScore = nansen.getTokenScore(token)
      const nansenBoost = nansenScore * nansenWeight
      
      // Base score - we don't have volatility score here, so use volume/traders as proxy
      const volumeScore = Math.log10(1 + token.volume) * 0.5
      const tradersScore = Math.log10(1 + token.trader_count) * 0.5
      const baseScore = volumeScore + tradersScore

      metrics.set(token.token_symbol, {
        symbol: token.token_symbol,
        baseScore,
        nansenBoost,
        totalScore: baseScore + nansenBoost,
        volumeUsd24h: token.volume,
        activeTraders: token.trader_count,
        buySellPressure: token.buy_sell_pressure,
        side: token.buy_sell_pressure > 0 ? 'BUYING' : 'SELLING'
      })
    }

    console.error(`# ✅ Fetched ${metrics.size} tokens from Nansen API`)
    return metrics

  } catch (error: any) {
    console.error(`# ❌ Failed to fetch Nansen data:`, error.message)
    return new Map()
  }
}

async function main() {
  const nansenMetrics = await getNansenMetricsFromAPI()

  if (nansenMetrics.size === 0) {
    console.error("# ⚠️  No Nansen data available")
    console.error("# Keeping previous spread overrides")
    console.error("# Check NANSEN_API_KEY and network connectivity")
    process.exit(0)  // Graceful exit - keep old spreads
  }

  console.log("# Dynamic Spread Overrides (Nansen API)")
  console.log(`# Generated: ${new Date().toISOString()}`)
  console.log(`# Tokens: ${nansenMetrics.size}`)
  console.log("")
  console.log("# Add these to .env and restart bot:")
  console.log("")

  const spreads: Array<{symbol: string, spread: number, reason: string}> = []
  const biasData: Record<string, { boost: number; direction: string; biasStrength: 'strong' | 'soft' | 'neutral'; buySellPressure: number; updatedAt: string }> = {}

  for (const [symbol, data] of nansenMetrics) {
    const metrics: PairMetrics = {
      token: symbol,
      volumeUsd24h: data.volumeUsd24h,
      activeTraders: data.activeTraders,
      baseScore: data.baseScore,
      nansenBoost: data.nansenBoost
    }

    const spread = calculateSpreadForPair(metrics, config, manualOverrides)

    let reason = "calculated"
    if (manualOverrides[symbol]) {
      reason = `manual override`
    } else if (data.nansenBoost >= 2.0) {
      reason = `confluence (Nansen +${data.nansenBoost.toFixed(2)})`
    }

    spreads.push({ symbol, spread, reason })

    // 🔥 NEW: Build bias data for risk management with strength layers
    // Store ALL signals (boost >= 1.0), classify by strength
    if (Math.abs(data.nansenBoost) >= 1.0) {
      const absBoost = Math.abs(data.nansenBoost)
      let direction: 'long' | 'short' | 'neutral'
      let biasStrength: 'strong' | 'soft' | 'neutral'

      // Classify by boost magnitude
      if (absBoost >= 2.0) {
        // STRONG bias: aggressive directional positioning
        direction = data.side === 'BUYING' ? 'long' : 'short'
        biasStrength = 'strong'
      } else if (absBoost >= 1.0) {
        // SOFT bias: gentle directional preference
        direction = data.side === 'BUYING' ? 'long' : 'short'
        biasStrength = 'soft'
      } else {
        // NEUTRAL: should not reach here due to if condition, but for safety
        direction = 'neutral'
        biasStrength = 'neutral'
      }

      biasData[symbol] = {
        boost: parseFloat(data.nansenBoost.toFixed(2)),
        direction,
        biasStrength,  // ← NEW FIELD
        buySellPressure: parseFloat(data.buySellPressure.toFixed(4)),
        updatedAt: new Date().toISOString()
      }
    }
  }

  // Sort by spread (tightest first)
  spreads.sort((a, b) => a.spread - b.spread)

  for (const {symbol, spread, reason} of spreads) {
    console.log(`SPREAD_OVERRIDE_${symbol}=${spread}  # ${reason}`)
  }

  console.log("")
  console.log(`# Spread range: ${config.minSpreadBps}-${config.maxSpreadBps} bps`)
  console.log(`# Weights: Vol=${config.volumeWeight} Traders=${config.tradersWeight} Base=${config.baseScoreWeight} Nansen=${config.nansenWeight}`)
  console.log(`# Source: Nansen API (direct fetch, no log parsing)`)

  // 🔥 NEW: Write bias data to JSON file
  const biasPath = `${BASE_DIR}/runtime/nansen_bias.json`
  const biasDir = path.dirname(biasPath)

  if (!existsSync(biasDir)) {
    mkdirSync(biasDir, { recursive: true })
  }

  writeFileSync(biasPath, JSON.stringify(biasData, null, 2), 'utf-8')

  // Count signals by strength
  const strongCount = Object.values(biasData).filter((b: any) => b.biasStrength === 'strong').length
  const softCount = Object.values(biasData).filter((b: any) => b.biasStrength === 'soft').length

  console.error(`# ✅ Written Nansen bias data to ${biasPath}`)
  console.error(`#    Strong signals: ${strongCount}, Soft signals: ${softCount}, Total: ${Object.keys(biasData).length}`)
}

main().catch(console.error)
