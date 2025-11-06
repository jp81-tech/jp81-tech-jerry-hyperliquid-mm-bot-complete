import * as fs from "fs";
import * as path from "path";
import { config as dotenv } from "dotenv";
dotenv({ path: path.resolve(process.cwd(), "src/.env") });

import * as hl from "@nktkas/hyperliquid";
import { ethers } from "ethers";

type Fill = {
  time: number;
  pair: string;
  side: string;
  px: number;
  sz: number;
  pnl: number;
  fee: number;
  maker: boolean;
};

const SLACK = (process.env.SLACK_WEBHOOK_URL || "").trim();
const DC = (process.env.DISCORD_WEBHOOK_URL || "").trim();

async function post(msg: string) {
  const hook = SLACK || DC;
  if (!hook) return;
  const payload = hook.includes("discord")
    ? JSON.stringify({ content: msg })
    : JSON.stringify({ text: msg });
  try {
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
  } catch (e) {
    // ignore
  }
}

function quantiles(arr: number[], qs: number[]) {
  const a = [...arr].sort((x, y) => x - y);
  const pct: Record<string, number> = {};
  for (const q of qs) {
    const i = Math.max(0, Math.min(a.length - 1, Math.floor(q * (a.length - 1))));
    pct[(q * 100).toFixed(0)] = a.length ? a[i] : 0;
  }
  return pct;
}

function asciiHist(values: number[], binSize = 0.25, binsLeft = 12, binsRight = 12) {
  const min = -binsLeft * binSize;
  const max = binsRight * binSize;
  const bins: number[] = new Array(binsLeft + binsRight).fill(0);

  for (const v of values) {
    const clamped = Math.max(min, Math.min(max - 1e-9, v));
    const idx = Math.floor((clamped - min) / binSize);
    if (idx >= 0 && idx < bins.length) bins[idx]++;
  }

  const maxCnt = bins.reduce((m, x) => Math.max(m, x), 0) || 1;
  let out = "";

  for (let i = 0; i < bins.length; i++) {
    const from = min + i * binSize;
    const to = from + binSize;
    const bar = "█".repeat(Math.round(20 * bins[i] / maxCnt));
    const label = (from.toFixed(2) + ".." + to.toFixed(2)).padStart(13);
    out += label + " | " + bar + " " + bins[i] + "\n";
  }

  return out;
}

async function getFillsSince(msFrom: number): Promise<Fill[]> {
  const pk = process.env.PRIVATE_KEY?.trim() || "";
  const wallet = new ethers.Wallet(pk);
  const addr = wallet.address.toLowerCase();

  const info = new hl.InfoClient({ transport: new hl.HttpTransport() });
  const allFills: any[] = await info.userFills({ user: addr });

  const fills: Fill[] = [];
  for (const f of allFills) {
    const tms = Number(f.time);
    if (tms < msFrom) continue;

    const pnl = Number(f.closedPnl || 0);
    const fee = Number(f.feeUsd || 0);
    const netPnl = pnl - Math.abs(fee);

    fills.push({
      time: tms,
      pair: f.coin || "",
      side: f.side || "",
      px: Number(f.px),
      sz: Math.abs(Number(f.sz)),
      pnl: netPnl,
      fee: fee,
      maker: (f.dir || "").includes("Maker"),
    });
  }

  return fills;
}

function toCsvLine(f: Fill) {
  const d = new Date(f.time).toISOString();
  return d + "," + f.pair + "," + f.side + "," + f.px.toFixed(6) + "," +
         f.sz.toFixed(8) + "," + f.pnl.toFixed(6) + "," + (f.maker ? "M" : "T");
}

async function main() {
  const hours = Number(process.argv[2] || "6");
  const bin = Number(process.argv[3] || "0.25");
  const now = Date.now();
  const from = now - hours * 3600_000;

  const fills = await getFillsSince(from);

  if (!fills.length) {
    console.log("No fills in last " + hours + "h.");
    process.exit(0);
  }

  const perFillPnl = fills.map(f => f.pnl);

  const ts = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "_");
  const outCsv = path.resolve(process.cwd(), "runtime/perfill_pnl_" + ts + ".csv");

  fs.mkdirSync(path.dirname(outCsv), { recursive: true });
  fs.writeFileSync(
    outCsv,
    "time_iso,pair,side,price,size,net_pnl,maker\n" + fills.map(f => toCsvLine(f)).join("\n")
  );

  const n = perFillPnl.length;
  const sum = perFillPnl.reduce((a, b) => a + b, 0);
  const avg = sum / n;
  const pcts = quantiles(perFillPnl, [0.05, 0.25, 0.5, 0.75, 0.95]);
  const negRate = (perFillPnl.filter(x => x < 0).length / n) * 100;

  const hist = asciiHist(perFillPnl, bin, 12, 12);

  const header =
    "=== Per-Fill PnL Histogram (last " + hours + "h) ===\n" +
    "fills=" + n + "  sum=" + sum.toFixed(2) + "  avg=" + avg.toFixed(4) + "  <0=" + negRate.toFixed(1) + "%\n" +
    "p5=" + (pcts["5"] || 0).toFixed(4) + "  p25=" + (pcts["25"] || 0).toFixed(4) +
    "  p50=" + (pcts["50"] || 0).toFixed(4) + "  p75=" + (pcts["75"] || 0).toFixed(4) +
    "  p95=" + (pcts["95"] || 0).toFixed(4) + "\n" +
    "bin=" + bin.toFixed(2) + " USDC   csv=" + path.basename(outCsv) + "\n";

  console.log(header + hist);

  const msg =
    "📊 Per-Fill PnL (last " + hours + "h)\n" +
    "fills=" + n + " sum=" + sum.toFixed(2) + " avg=" + avg.toFixed(4) + " <0=" + negRate.toFixed(1) + "%\n" +
    "p50=" + (pcts["50"] || 0).toFixed(3) + " p95=" + (pcts["95"] || 0).toFixed(3) +
    " csv=" + path.basename(outCsv);

  await post(msg);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
