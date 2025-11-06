import fs from "fs";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

async function setLeverage(symbol: string, lev: number) {
  const base = "https://api.hyperliquid.xyz";
  const body = {
    type: "accountLeverage",
    coin: symbol,
    leverage: lev
  };
  const res = await fetch(base + "/setLeverage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function main() {
  const defaultLev = Number(process.env.DEFAULT_LEVERAGE || "1");
  const allow = process.env.ALLOW_USER_LEVERAGE === "1";
  if (!allow) {
    console.log("❌ ALLOW_USER_LEVERAGE disabled in .env");
    process.exit(0);
  }

  const pairsFile = "runtime/active_pairs.json";
  if (!fs.existsSync(pairsFile)) {
    console.error("⚠️ No active_pairs.json found");
    process.exit(0);
  }

  const { pairs } = JSON.parse(fs.readFileSync(pairsFile, "utf8"));
  if (!pairs?.length) {
    console.log("⚠️ No pairs defined");
    return;
  }

  for (const symbol of pairs) {
    try {
      await setLeverage(symbol, defaultLev);
      console.log(`✅ Set leverage=${defaultLev}x for ${symbol}`);
    } catch (e: any) {
      console.error(`⚠️ Failed to set leverage for ${symbol}:`, e.message);
    }
  }
}

main().then(() => process.exit(0));
