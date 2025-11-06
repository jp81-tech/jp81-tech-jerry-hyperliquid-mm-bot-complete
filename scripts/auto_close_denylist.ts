#!/usr/bin/env -S TS_NODE_TRANSPILE_ONLY=1 node --loader ts-node/esm
import https from "https";

function rpc(path: string, body: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: "api.hyperliquid.xyz", path, method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = ""; res.on("data", (c) => (data += c)); res.on("end", () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      }
    );
    req.on("error", reject); req.write(JSON.stringify(body)); req.end();
  });
}

async function main() {
  const deny = (process.env.ACTIVE_PAIRS_DENYLIST || "").split(",").map(s => s.trim()).filter(Boolean);
  if (deny.length === 0) return;

  const acct = await rpc("/info", { type: "clearinghouseState", user: process.env.PUBLIC_ADDRESS });
  const positions: any[] = (acct?.assetPositions || []).filter((p: any) => p && p.position && parseFloat(p.position.szi) \!== 0);

  for (const p of positions) {
    const sym = p.asset;
    if (\!deny.includes(sym)) continue;
    const sz = Math.abs(parseFloat(p.position.szi));
    if (sz === 0) continue;

    const side = parseFloat(p.position.szi) > 0 ? "sell" : "buy";
    console.log(`AUTO_CLOSE ${sym} size=${sz} side=${side}`);

    // market reduce-only close via UI-simulated order; replace with your bot's order path if needed
    // Here we only print the intent to avoid signature logic in this minimal script.
    // If you want a signing close, I can wire it to your existing signing path.
  }
}

main().catch(e => { console.error(e); process.exit(1); });
