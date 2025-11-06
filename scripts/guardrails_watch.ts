import * as hl from "@nktkas/hyperliquid";
import { ethers } from "ethers";
import { config } from "dotenv";
import path from "path";
import fs from "fs";

config({ path: path.resolve(process.cwd(), "src/.env") });

const SLACK = process.env.SLACK_WEBHOOK_URL || "";
const DC = process.env.DISCORD_WEBHOOK_URL || "";
const GLOBAL_POS_CAP = Number(process.env.MAX_POSITION_USD_PER_PAIR || "1000");
const GLOBAL_INV_CAP = Number(process.env.INVENTORY_CAP_USD_PER_PAIR || "800");

async function post(url: string, content: string) {
  if (!url) return;
  const body = url.includes("discord")
    ? JSON.stringify({ content })
    : JSON.stringify({ text: content });
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } catch (e) {
    console.error("Webhook error:", e);
  }
}

function envNum(k: string, d: number = 0) {
  const v = process.env[k];
  return v ? Number(v) : d;
}

function toCET(tsMs: number) {
  return new Date(tsMs).toLocaleString("pl-PL", {
    timeZone: "Europe/Zurich",
  });
}

async function main() {
  const pk = process.env.PRIVATE_KEY?.trim() || "";
  const wallet = new ethers.Wallet(pk);
  const addr = wallet.address.toLowerCase();

  const info = new hl.InfoClient({ transport: new hl.HttpTransport() });
  const state = await info.clearinghouseState({ user: addr });

  const positions = state.assetPositions || [];
  const breaches: string[] = [];
  const ts = toCET(Date.now());

  for (const pos of positions) {
    const coin = pos.position.coin;
    const sz = Number(pos.position.szi);
    const unrealPnl = Number(pos.position.unrealizedPnl);
    const entryPx = Number(pos.position.entryPx);
    const notional = Math.abs(sz * entryPx);

    const pairPosCap = envNum(coin + "_MAX_POSITION_USD", GLOBAL_POS_CAP);
    const pairInvCap = envNum(coin + "_INVENTORY_CAP_USD", GLOBAL_INV_CAP);

    let breach = false;
    let reasons: string[] = [];

    if (notional > pairPosCap) {
      breach = true;
      reasons.push(
        "Position " + notional.toFixed(0) + " > cap " + pairPosCap.toFixed(0)
      );
    }

    if (notional > pairInvCap) {
      breach = true;
      reasons.push(
        "Inventory " + notional.toFixed(0) + " > cap " + pairInvCap.toFixed(0)
      );
    }

    const panicBps = envNum("PANIC_TAKER_AT_UNREAL_BPS", 35);
    if (notional > 0) {
      const unrealBps = (unrealPnl / notional) * 10000;
      if (unrealBps < -panicBps) {
        breach = true;
        reasons.push(
          "Unreal PnL " + unrealBps.toFixed(1) + " bps < panic -" + panicBps
        );
      }
    }

    if (breach) {
      const msg = "🚨 GUARDRAIL BREACH " + coin + "\n" +
        ts + "\n" +
        "Size: " + sz.toFixed(4) + "\n" +
        "Notional: " + notional.toFixed(0) + " USD\n" +
        "Unreal PnL: " + unrealPnl.toFixed(2) + " USD\n" +
        "Entry: " + entryPx.toFixed(2) + "\n" +
        "Reasons: " + reasons.join(", ");

      breaches.push(msg);
      console.log(msg);
    }

    const logLine = "guardrails_evt=check ts=" + new Date().toISOString() +
      " pair=" + coin +
      " notional=" + notional.toFixed(0) +
      " posCap=" + pairPosCap +
      " invCap=" + pairInvCap +
      " unrealPnl=" + unrealPnl.toFixed(2) +
      " breach=" + breach;

    const logPath = path.join(process.cwd(), "runtime", "guardrails.log");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, logLine + "\n", "utf8");
  }

  if (breaches.length > 0) {
    const alert = breaches.join("\n\n");
    await post(SLACK, alert);
    await post(DC, alert);
  } else {
    console.log(
      "guardrails_evt=ok ts=" + new Date().toISOString() +
      " positions=" + positions.length +
      " breaches=0"
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
