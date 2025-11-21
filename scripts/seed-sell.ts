import { Exchange } from "@hyperliquid-dex/sdk";

async function main() {
  const coins = process.argv.slice(2);
  if (coins.length === 0) {
    console.error("Usage: npx tsx scripts/seed-sell.ts COIN [COIN...]");
    process.exit(1);
  }

  const env = process.env.ENV_FILE || ".env";
  require("dotenv").config({ path: env });

  const ex = new Exchange({ baseUrl: process.env.HL_BASE_URL || "https://api.hyperliquid.xyz" });

  for (const coin of coins) {
    try {
      const mid = await ex.info.midPx(coin);
      const px = (Number(mid) * 1.003).toString();
      const sz = process.env.SEED_SELL_SZ || "10";
      await ex.place({
        coin,
        isBuy: false,
        sz,
        limitPx: px,
        orderType: { t: "limit" },
        reduceOnly: false,
        cloid: `SEED_SELL_${coin}_${Date.now()}`
      });
      console.log(`[${coin}] seeded SELL px=${px} sz=${sz}`);
    } catch (e: any) {
      console.error(`[${coin}] seed sell failed: ${coin} ${e?.message || e}`);
      process.exitCode = 2;
    }
  }
}

main();
