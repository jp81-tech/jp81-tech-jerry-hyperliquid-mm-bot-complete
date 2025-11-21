#!/usr/bin/env -S npx tsx
/**
 * Pair Scoring Framework for MM Bot
 * 
 * Evaluates trading pairs using 5 key metrics:
 * 1. PPK - Profit Per 1000 submits
 * 2. Fill Rate - Quality of spreads
 * 3. PVU - Profit per Volatility Unit
 * 4. PFE - Profit per Fee efficiency
 * 5. Max Drawdown - Intraday risk
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

interface PairMetrics {
  pair: string;
  submits: number;
  fills: number;
  fillRate: number;
  pnl: number;
  ppk: number; // Profit Per 1000 submits
  maxDrawdown: number;
  riskEvents: number;
  score: number;
}

const LOOKBACK_HOURS = 10;
const PAIRS = ["ZEC", "UNI"];

function getSubmitCount(pair: string): number {
  try {
    const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
    const cmd = `journalctl -u mm-bot.service --since "${since}" --no-pager 2>/dev/null | grep -c "submit: pair=${pair}" || echo 0`;
    const result = execSync(cmd, { encoding: "utf8" }).trim();
    return parseInt(result) || 0;
  } catch (err) {
    return 0;
  }
}

function getFillCount(): number {
  try {
    const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
    const cmd = `journalctl -u mm-bot.service --since "${since}" --no-pager 2>/dev/null | grep -oE "Synced [0-9]+ new fills" | awk '{sum+=\$2} END{print sum+0}'`;
    const result = execSync(cmd, { encoding: "utf8" }).trim();
    return parseInt(result) || 0;
  } catch (err) {
    return 0;
  }
}

function getPnLFromLogs(): number {
  try {
    const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
    // Fixed: Use awk to split by $ and sum the second field
    const cmd = `journalctl -u mm-bot.service --since "${since}" --no-pager 2>/dev/null | grep "Synced.*new fills" | awk -F"\\$" '{sum+=\$2} END{print sum+0}'`;
    const result = execSync(cmd, { encoding: "utf8" }).trim();
    return parseFloat(result) || 0;
  } catch (err) {
    return 0;
  }
}

function getMaxDrawdown(pair: string): number {
  try {
    const shadowLogPath = "data/risk_shadow.log";
    if (!fs.existsSync(shadowLogPath)) return 0;
    
    const since = Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000;
    const lines = fs.readFileSync(shadowLogPath, "utf8").split("\n");
    
    let maxDrawdown = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        const ts = new Date(data.ts).getTime();
        if (ts < since) continue;
        if (data.pair !== pair) continue;
        
        const upnl = parseFloat(data.unrealizedPnlUsd);
        if (upnl < maxDrawdown) {
          maxDrawdown = upnl;
        }
      } catch (e) {
        // Skip invalid lines
      }
    }
    
    return Math.abs(maxDrawdown);
  } catch (err) {
    return 0;
  }
}

function getRiskEventCount(pair: string): number {
  try {
    const shadowLogPath = "data/risk_shadow.log";
    if (!fs.existsSync(shadowLogPath)) return 0;
    
    const since = Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000;
    const lines = fs.readFileSync(shadowLogPath, "utf8").split("\n");
    
    let count = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        const ts = new Date(data.ts).getTime();
        if (ts < since) continue;
        if (data.pair !== pair) continue;
        count++;
      } catch (e) {
        // Skip invalid lines
      }
    }
    
    return count;
  } catch (err) {
    return 0;
  }
}

function calculateScore(metrics: Omit<PairMetrics, "score">): number {
  // Scoring weights:
  // PPK: 40% (most important)
  // Fill Rate: 20%
  // Max Drawdown: 25% (risk is critical)
  // Risk Events: 15%
  
  let score = 0;
  
  // PPK score (0-40 points)
  if (metrics.ppk > 50) score += 40;
  else if (metrics.ppk > 30) score += 35;
  else if (metrics.ppk > 15) score += 25;
  else if (metrics.ppk > 5) score += 10;
  
  // Fill rate score (0-20 points)
  if (metrics.fillRate >= 20 && metrics.fillRate <= 35) score += 20;
  else if (metrics.fillRate >= 15 && metrics.fillRate <= 40) score += 15;
  else if (metrics.fillRate >= 10) score += 10;
  
  // Max drawdown score (0-25 points) - lower is better
  if (metrics.maxDrawdown < 30) score += 25;
  else if (metrics.maxDrawdown < 50) score += 20;
  else if (metrics.maxDrawdown < 100) score += 10;
  else if (metrics.maxDrawdown < 200) score += 5;
  
  // Risk events score (0-15 points) - lower is better
  const riskEventsPerHour = metrics.riskEvents / LOOKBACK_HOURS;
  if (riskEventsPerHour < 0.5) score += 15;
  else if (riskEventsPerHour < 1) score += 10;
  else if (riskEventsPerHour < 2) score += 5;
  
  return Math.round(score);
}

function getRating(score: number): { symbol: string; text: string; recommendations: string[] } {
  if (score >= 70) {
    return {
      symbol: "✅",
      text: "EXCELLENT - Keep trading",
      recommendations: []
    };
  } else if (score >= 50) {
    return {
      symbol: "👍",
      text: "GOOD - Solid performer",
      recommendations: []
    };
  } else if (score >= 30) {
    return {
      symbol: "⚠️",
      text: "MARGINAL - Monitor closely",
      recommendations: []
    };
  } else {
    return {
      symbol: "❌",
      text: "POOR - Consider replacing this pair",
      recommendations: []
    };
  }
}

// Main execution
async function main() {
  console.log("\n💰 Pair Scoring Framework - 10h Lookback\n");
  
  const totalPnl = getPnLFromLogs();
  const totalFills = getFillCount();
  
  // Calculate total submits across all pairs
  const totalSubmits = PAIRS.reduce((sum, p) => sum + getSubmitCount(p), 0);
  
  // Calculate global fill rate (accurate across all pairs)
  const globalFillRate = totalSubmits > 0 ? (totalFills / totalSubmits) * 100 : 0;
  
  console.log(`💰 Total PnL (10h): $${totalPnl.toFixed(2)}`);
  console.log(`📥 Total Fills: ${totalFills}`);
  console.log(`📊 Total Submits: ${totalSubmits}`);
  console.log(`📈 Global Fill Rate: ${globalFillRate.toFixed(1)}%`);
  console.log("");
  
  const results: PairMetrics[] = [];
  
  for (const pair of PAIRS) {
    const submits = getSubmitCount(pair);
    const maxDrawdown = getMaxDrawdown(pair);
    const riskEvents = getRiskEventCount(pair);
    
    // Estimate fills per pair based on proportion of submits
    const pairShare = totalSubmits > 0 ? submits / totalSubmits : 0;
    const fills = Math.round(totalFills * pairShare);
    
    // Estimate PnL per pair based on proportion of submits
    const pnl = totalPnl * pairShare;
    
    // Use global fill rate for all pairs (more accurate)
    const fillRate = globalFillRate;
    const ppk = submits > 0 ? (pnl / submits) * 1000 : 0;
    
    const metricsWithoutScore: Omit<PairMetrics, "score"> = {
      pair,
      submits,
      fills,
      fillRate,
      pnl,
      ppk,
      maxDrawdown,
      riskEvents
    };
    
    const score = calculateScore(metricsWithoutScore);
    
    results.push({ ...metricsWithoutScore, score });
  }
  
  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  
  // Display results
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│                    PAIR RANKING                             │");
  console.log("├──────┬─────────┬──────────┬──────┬──────┬─────────┬────────┤");
  console.log("│ Pair │ Submits │ Fill %   │ PPK  │ Draw │ Risks   │ SCORE  │");
  console.log("├──────┼─────────┼──────────┼──────┼──────┼─────────┼────────┤");
  
  for (const r of results) {
    const pairPad = r.pair.padEnd(4);
    const submitsPad = r.submits.toString().padStart(7);
    const fillRatePad = `${r.fillRate.toFixed(1)}%`.padStart(8);
    const ppkPad = r.ppk.toFixed(0).padStart(4);
    const drawPad = r.maxDrawdown.toFixed(0).padStart(4);
    const risksPad = r.riskEvents.toString().padStart(7);
    const scorePad = r.score.toString().padStart(6);
    
    console.log(`│    ${pairPad} │ ${submitsPad} │ ${fillRatePad} │ ${ppkPad} │ ${drawPad} │ ${risksPad} │ ${scorePad} │`);
  }
  
  console.log("└──────┴─────────┴──────────┴──────┴──────┴─────────┴────────┘");
  console.log("");
  
  console.log("📌 RECOMMENDATIONS:\n");
  for (const r of results) {
    const rating = getRating(r.score);
    console.log(`${r.pair}:`);
    console.log(`  ${rating.symbol} ${rating.text}`);
    
    if (r.ppk < 10) console.log("  ⚠️  Low profitability (PPK: " + r.ppk.toFixed(0) + ")");
    if (r.fillRate < 15 || r.fillRate > 40) console.log(`  ⚠️  Suboptimal fill rate (${r.fillRate.toFixed(1)}%)`);
    if (r.maxDrawdown > 100) console.log(`  ⚠️  High drawdown risk ($${r.maxDrawdown.toFixed(0)})`);
    if (r.riskEvents > 50) console.log(`  ⚠️  Frequent risk events (${r.riskEvents})`);
    
    console.log("");
  }
  // Print capital allocation recommendations
  printCapitalAllocationSummary(results);
}

main().catch(console.error);

/**
 * Capital Allocation Decision Logic
 */
type AllocationTier = "REJECT" | "SMALL" | "CANDIDATE" | "CORE";

type AllocationDecision = {
  pair: string;
  tier: AllocationTier;
  minPct: number;
  maxPct: number;
  reasons: string[];
};

function decideAllocationForPair(stats: PairMetrics): AllocationDecision {
  const reasons: string[] = [];

  const ppk = stats.ppk;
  const fill = stats.fillRate;
  const dd = stats.maxDrawdown;
  const risk = stats.riskEvents;

  // Auto-reject - too risky / unprofitable
  if (ppk < 20) {
    reasons.push(`PPK too low (${ppk.toFixed(1)} < 20)`);
    return { pair: stats.pair, tier: "REJECT", minPct: 0, maxPct: 0, reasons };
  }
  if (fill < 8) {
    reasons.push(`Fill% too low (${fill.toFixed(1)}% < 8%)`);
    return { pair: stats.pair, tier: "REJECT", minPct: 0, maxPct: 0, reasons };
  }
  if (fill > 40) {
    reasons.push(`Fill% too high (${fill.toFixed(1)}% > 40%) - acting as taker`);
    return { pair: stats.pair, tier: "REJECT", minPct: 0, maxPct: 0, reasons };
  }
  if (dd > 400 && ppk <= 50) {
    reasons.push(`Drawdown too high ($${dd.toFixed(0)} > 400) with weak PPK (${ppk.toFixed(1)} ≤ 50)`);
    return { pair: stats.pair, tier: "REJECT", minPct: 0, maxPct: 0, reasons };
  }

  // CORE - money printer
  if (ppk > 50 && dd < 200 && risk < 30) {
    reasons.push(
      `High PPK (${ppk.toFixed(1)} > 50)`,
      `Low drawdown ($${dd.toFixed(0)} < 200)`,
      `Low risk events (${risk} < 30)`
    );
    return { pair: stats.pair, tier: "CORE", minPct: 35, maxPct: 50, reasons };
  }

  // CANDIDATE - healthy but not perfect
  if (ppk > 50 && dd < 400) {
    reasons.push(
      `Good PPK (${ppk.toFixed(1)} > 50)`,
      `Acceptable drawdown ($${dd.toFixed(0)} < 400)`
    );
    return { pair: stats.pair, tier: "CANDIDATE", minPct: 20, maxPct: 30, reasons };
  }

  // SMALL_SIZE - borderline / high-beta
  reasons.push(
    `Borderline profile (PPK=${ppk.toFixed(1)}, DD=$${dd.toFixed(0)}, risk=${risk})`
  );
  return { pair: stats.pair, tier: "SMALL", minPct: 10, maxPct: 15, reasons };
}

function printCapitalAllocationSummary(pairs: PairMetrics[]): void {
  console.log("");
  console.log("💼 CAPITAL ALLOCATION SUGGESTION");
  console.log("");

  const decisions = pairs.map(decideAllocationForPair);

  console.log("┌────────┬────────────┬──────────────┬─────────────────────────────────┐");
  console.log("│ Pair   │ Tier       │ Capital %    │ Key reasons                     │");
  console.log("├────────┼────────────┼──────────────┼─────────────────────────────────┤");
  
  for (const d of decisions) {
    const range =
      d.minPct === 0 && d.maxPct === 0
        ? "0%      "
        : `${d.minPct.toFixed(0)}–${d.maxPct.toFixed(0)}%`.padEnd(8);
    
    const tierLabel =
      d.tier === "CORE"
        ? "CORE      "
        : d.tier === "CANDIDATE"
        ? "CANDIDATE "
        : d.tier === "SMALL"
        ? "SMALL     "
        : "REJECT    ";

    const reason = d.reasons[0] || "";
    const reasonTrunc = reason.length > 33 ? reason.substring(0, 30) + "..." : reason.padEnd(33);
    
    console.log(
      `│ ${d.pair.padEnd(6)} │ ${tierLabel} │ ${range}     │ ${reasonTrunc}│`
    );
  }
  
  console.log("└────────┴────────────┴──────────────┴─────────────────────────────────┘");
  console.log("");
  
  // Portfolio composition summary
  const coreCount = decisions.filter(d => d.tier === "CORE").length;
  const candidateCount = decisions.filter(d => d.tier === "CANDIDATE").length;
  const smallCount = decisions.filter(d => d.tier === "SMALL").length;
  const rejectCount = decisions.filter(d => d.tier === "REJECT").length;
  
  console.log("📊 PORTFOLIO COMPOSITION:");
  console.log(`   ✅ CORE pairs (35-50% each): ${coreCount}`);
  console.log(`   👍 CANDIDATE pairs (20-30% each): ${candidateCount}`);
  console.log(`   ⚠️  SMALL pairs (10-15% each): ${smallCount}`);
  console.log(`   ❌ REJECTED pairs: ${rejectCount}`);
  console.log("");
  
  if (coreCount + candidateCount + smallCount < 3) {
    console.log("💡 Consider testing additional pairs to diversify portfolio");
    console.log("");
  }
}
