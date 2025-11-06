import * as hl from "@nktkas/hyperliquid";
import { ethers } from "ethers";
import { config } from "dotenv";
import path from "path";

config({ path: path.resolve(process.cwd(), "src/.env") });

const pk = process.env.PRIVATE_KEY?.trim() || "";
const wallet = new ethers.Wallet(pk);
const addr = wallet.address.toLowerCase();
const HOURS = parseInt(process.argv[2] || "12", 10);
const SINCE = Date.now() - HOURS*60*60*1000;

function toCET(tsMs:number){ return new Date(tsMs).toLocaleString("pl-PL",{timeZone:"Europe/Zurich"}) }

(async () => {
  const info = new hl.InfoClient({ transport: new hl.HttpTransport() });

  const fills = await info.userFills({ user: addr });
  const recent = fills.filter((f:any) =>
    Number(f.time) >= SINCE && f.coin === "ZEC"
  );

  let realized = 0;
  let fees = 0;
  let takerNotional = 0, makerNotional = 0;

  console.log("=== ZEC FILLS (ostatnie", HOURS, "h) ===");
  for (const f of recent) {
    const ts = Number(f.time);
    const side = f.side;
    const px = Number(f.px);
    const sz = Math.abs(Number(f.sz));
    const notional = px * sz;
    const fee = Number(f.feeUsd || 0);
    const pnl = Number(f.closedPnl || 0);
    const dir = f.dir || "";
    const liq = dir.includes("Taker") ? "taker" : "maker";

    realized += pnl;
    fees += fee;
    if (liq === "taker") takerNotional += notional; else makerNotional += notional;

    console.log(`${toCET(ts)}  ${side.padEnd(5)}  px=${px.toFixed(2).padStart(8)}  sz=${sz.toFixed(4).padStart(8)}  notional=${notional.toFixed(2).padStart(10)}  fee=${fee.toFixed(4)}  pnl=${pnl.toFixed(4).padStart(8)}  ${liq}`);
  }

  console.log("\n--- PODSUMOWANIE (ZEC) ---");
  console.log("Realized PnL:", realized.toFixed(2), "USDC");
  console.log("Fees total :", fees.toFixed(2), "USDC");
  console.log("Maker notional:", makerNotional.toFixed(2), "USDC");
  console.log("Taker notional:", takerNotional.toFixed(2), "USDC");
  console.log("Fills count:", recent.length);

  const userState = await info.userState({ user: addr });
  const pos = (userState.assetPositions || []).find((p:any) => p.position.coin === "ZEC");
  if (pos && pos.position) {
    const sz = Number(pos.position.szi);
    const entry = Number(pos.position.entryPx);
    console.log("Open position now:", sz, "ZEC @", entry);
  } else {
    console.log("Open position now: none");
  }
})();
