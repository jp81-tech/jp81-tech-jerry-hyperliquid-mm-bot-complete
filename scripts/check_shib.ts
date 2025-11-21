import * as hl from "@nktkas/hyperliquid";
import "dotenv/config";

async function main() {
  const transport = new hl.HttpTransport();
  const info = new hl.InfoClient({ transport });
  const meta = await info.meta();
  
  const shibCoins = meta.universe.filter(u => 
    u.name.toLowerCase().includes("shib")
  );
  
  console.log("SHIB-related coins in universe:");
  shibCoins.forEach(c => console.log(`  ${c.name}`));
  
  // Also check kSHIB variations
  const variants = ["kSHIB", "KSHIB", "kshib", "kShib"];
  for (const v of variants) {
    const found = meta.universe.find(u => u.name === v);
    if (found) console.log(`Found: ${v}`);
  }
}

main();
