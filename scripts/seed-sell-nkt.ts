import * as hl from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import "dotenv/config";

async function main() {
  const coins = process.argv.slice(2);
  if (coins.length === 0) { 
    console.error("Usage: npx tsx scripts/seed-sell-nkt.ts COIN [COIN...]"); 
    process.exit(1); 
  }

  const pk = process.env.HL_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) { 
    console.error("PRIVATE_KEY not set"); 
    process.exit(2); 
  }

  const wallet = privateKeyToAccount(pk as `0x${string}`);
  const http = new hl.HttpTransport();
  const info = new hl.InfoClient({ transport: http });
  const ex = new hl.ExchangeClient({ wallet, transport: http });

  const meta = await info.meta();
  const allMids = await info.allMids();

  for (const coin of coins) {
    try {
      const assetIdx = meta.universe.findIndex((c) => c.name === coin);
      if (assetIdx < 0) {
        console.error(`[${coin}] asset not found`);
        continue;
      }

      const assetInfo = meta.universe[assetIdx];
      const midPrice = allMids[coin];
      
      if (!midPrice) {
        console.error(`[${coin}] no mid price`);
        continue;
      }

      // Price: 0.5% above mid, rounded to price decimals
      const pxNum = Number(midPrice) * 1.005;
      const px = pxNum.toFixed(8); // Use 8 decimals for precision

      // Size: small notional (~$10)
      const notional = 10;
      const sz = (notional / pxNum).toFixed(assetInfo.szDecimals);

      await ex.order({
        orders: [{
          a: assetIdx,
          b: false,
          p: px,
          s: sz,
          r: false,
          t: { limit: { tif: "Gtc" } }
        }],
        grouping: "na"
      });

      console.log(`[${coin}] ✅ SELL order: ${sz} @ $${px} (mid=$${midPrice}, ~$${notional})`);
    } catch (e:any) {
      console.error(`[${coin}] ❌ failed: ${e?.message || e}`);
      process.exitCode = 2;
    }
  }
}
main();
