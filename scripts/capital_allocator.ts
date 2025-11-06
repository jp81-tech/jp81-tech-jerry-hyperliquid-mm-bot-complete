#!/usr/bin/env -S npx tsx
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

interface AllocationLog {
  timestamp: string;
  totalCapital: number;
  pairsCount: number;
  perPairAllocation: number;
  pairs: Array<{
    symbol: string;
    allocation: number;
    percentage: number;
  }>;
}

async function main() {
  const capital = Number(process.env.CAPITAL_USD || process.env.MAX_POSITION_USD || 12000);
  const pairsPath = "runtime/active_pairs.json";
  
  if (!fs.existsSync(pairsPath)) {
    console.log("⚠️  No active_pairs.json found");
    return;
  }

  const pairsData = JSON.parse(fs.readFileSync(pairsPath, "utf8"));
  const pairs: string[] = pairsData.pairs || [];
  
  if (pairs.length === 0) {
    console.log("⚠️  No pairs in active_pairs.json");
    return;
  }

  const perPairAllocation = capital / pairs.length;
  
  const allocation: AllocationLog = {
    timestamp: new Date().toISOString(),
    totalCapital: capital,
    pairsCount: pairs.length,
    perPairAllocation: Math.floor(perPairAllocation),
    pairs: pairs.map(symbol => ({
      symbol,
      allocation: Math.floor(perPairAllocation),
      percentage: (100 / pairs.length)
    }))
  };

  // Save to JSON for programmatic access
  fs.writeFileSync(
    "runtime/capital_allocation.json",
    JSON.stringify(allocation, null, 2)
  );

  // Append to log for history
  const logLine = `${allocation.timestamp} | Capital: $${capital} | Pairs: ${pairs.length} | Per-pair: $${Math.floor(perPairAllocation)} | ${pairs.join(", ")}\n`;
  fs.appendFileSync("runtime/capital_allocation.log", logLine);

  console.log("💰 Capital Allocation:");
  console.log(`   Total: $${capital.toLocaleString()}`);
  console.log(`   Pairs: ${pairs.length}`);
  console.log(`   Per-pair: $${Math.floor(perPairAllocation).toLocaleString()} (${(100/pairs.length).toFixed(1)}%)`);
  console.log("");
  allocation.pairs.forEach(p => {
    console.log(`   ${p.symbol.padEnd(8)} → $${p.allocation.toLocaleString()}`);
  });
}

main().catch(console.error);
