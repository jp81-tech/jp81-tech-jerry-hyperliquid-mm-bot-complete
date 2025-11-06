#!/usr/bin/env -S npx tsx
import { InfoClient, HttpTransport } from "@nktkas/hyperliquid";

async function main() {
  const info = new InfoClient({ transport: new HttpTransport() });
  const meta = await info.meta();
  
  const pepe = meta.universe.filter(u => u.name.toUpperCase().includes("PEPE"));
  console.log("PEPE symbols found:");
  pepe.forEach(u => console.log("  -", u.name));
  
  console.log("\nTop 10 by index:");
  meta.universe.slice(0, 20).forEach((u, i) => console.log(`  ${i}: ${u.name}`));
}

main().catch(console.error);
