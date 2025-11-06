import { InfoClient, HttpTransport } from "@nktkas/hyperliquid";
import { ethers } from "ethers";
import { config } from "dotenv";
config();

async function main() {
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  const info = new InfoClient({ transport: new HttpTransport() });
  
  const state = await info.clearinghouseState({ user: wallet.address });
  
  console.log("📊 Position Values:");
  
  const nonZero = state.assetPositions?.filter(p => Math.abs(Number(p.position.szi)) > 0.001) || [];
  
  let totalValue = 0;
  nonZero.forEach(p => {
    const size = Number(p.position.szi);
    const direction = size > 0 ? "LONG" : "SHORT";
    const value = Math.abs(size * Number(p.position.entryPx));
    totalValue += value;
    console.log(`  ${p.position.coin.padEnd(8)} ${direction.padEnd(6)} ${Math.abs(size).toFixed(0).padStart(12)} @ $${p.position.entryPx.padEnd(8)} = $${value.toFixed(2).padStart(10)}`);
  });
  
  console.log(`\n  TOTAL VALUE: $${totalValue.toFixed(2)}`);
  console.log(`  Account Balance: $${Number(state.marginSummary.accountValue).toFixed(2)}`);
}

main().catch(console.error);
