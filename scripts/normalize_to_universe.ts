import * as hl from "@nktkas/hyperliquid";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

async function main() {
  const transport = new hl.HttpTransport();
  const info = new hl.InfoClient({ transport });
  const meta = await info.meta();
  
  // Build a map of lowercase -> correct case
  const caseMap: Record<string, string> = {};
  for (const u of meta.universe) {
    caseMap[u.name.toLowerCase()] = u.name;
  }
  
  // Read merged pairs
  const mergedPath = join(process.cwd(), "runtime", ".merged");
  const pairs = readFileSync(mergedPath, "utf8")
    .split("\n")
    .map(p => p.trim())
    .filter(p => p.length > 0);
  
  // Normalize to universe case
  const normalized = pairs.map(p => {
    const lower = p.toLowerCase();
    return caseMap[lower] || p.toUpperCase();
  });
  
  // Remove duplicates
  const unique = Array.from(new Set(normalized));
  
  writeFileSync(mergedPath, unique.join("\n") + "\n");
  console.log("Normalized:", unique.join(" "));
}

main();
