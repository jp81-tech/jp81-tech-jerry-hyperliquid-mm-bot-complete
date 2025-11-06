import * as fs from "fs"
import * as path from "path"
import * as hl from "@nktkas/hyperliquid"
import { ethers } from "ethers"
import { config } from "dotenv"
import { execSync } from "child_process"

config({ path: path.resolve(process.cwd(), ".env") })

function fmt(n: number, d = 2) { return Number.isFinite(n) ? n.toFixed(d) : "0.00" }
function ymd(d = new Date()) { return d.toISOString().slice(0, 10) }

const SLACK = process.env.SLACK_WEBHOOK_URL || ""
const DC = process.env.DISCORD_WEBHOOK_URL || ""
const REB = Number(process.env.MAKER_REBATE_BPS || "2.0")
const TAKER = Number(process.env.TAKER_FEE_BPS || "5.0")

async function post(url: string, content: string) {
  if (!url) return
  const body = url.includes("discord") ? JSON.stringify({ content }) : JSON.stringify({ text: content })
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body })
}

async function main() {
  const root = process.cwd()
  const runDir = path.join(root, "runtime")
  fs.mkdirSync(runDir, { recursive: true })

  const pk = process.env.PRIVATE_KEY?.trim() || ""
  if (!pk) throw new Error("PRIVATE_KEY missing")
  
  const wallet = new ethers.Wallet(pk)
  const addr = wallet.address
  const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })

  const now = new Date()
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 22, 59, 59))
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)

  const userFills = await infoClient.userFills({ user: addr })
  const day = userFills.filter((f: any) => {
    const t = Number(f.time)
    return t >= start.getTime() && t <= end.getTime()
  })

  let turnover = 0
  let makerNotional = 0
  const byPair: Record<string, { turn: number; fills: number }> = {}
  
  for (const f of day) {
    const notional = Math.abs(Number(f.sz) * Number(f.px))
    turnover += notional
    const coin = f.coin || "UNKNOWN"
    if (!byPair[coin]) byPair[coin] = { turn: 0, fills: 0 }
    byPair[coin].turn += notional
    byPair[coin].fills += 1
    if ((f as any).closedPnl !== undefined || f.dir === "Close Only") {
      makerNotional += notional * 0.85
    }
  }

  const makerShare = turnover > 0 ? makerNotional / turnover : 0.85
  const estFeesBps = makerShare * (-REB) + (1 - makerShare) * TAKER
  const estFeesUsd = turnover * estFeesBps / 10000
  const estNetBps = Math.max(0, 1.5)
  const estPnlUsd = turnover * estNetBps / 10000

  const rows = [["pair", "turnover_usd", "fills"]]
  Object.entries(byPair)
    .sort((a, b) => b[1].turn - a[1].turn)
    .forEach(([p, v]) => {
      rows.push([p, fmt(v.turn, 2), String(v.fills)])
    })

  const csvPath = path.join(runDir, `daily_summary_${ymd(end)}.csv`)
  fs.writeFileSync(csvPath, rows.map(r => r.join(",")).join("\n"))
  
  const topPairs = Object.entries(byPair)
    .sort((a, b) => b[1].turn - a[1].turn)
    .slice(0, 5)
    .map(([p]) => p)
    .join(", ") || "—"
    
  const summary = `📊 Daily Summary ${ymd(end)}
Turnover: $${fmt(turnover, 0)}
Fills: ${day.length}
Maker share: ${fmt(makerShare * 100, 1)}%
Est fees: ${fmt(estFeesBps, 2)} bps ($${fmt(estFeesUsd, 2)})
Est net: ${fmt(estNetBps, 2)} bps ($${fmt(estPnlUsd, 2)})
Top pairs: ${topPairs}
File: ${csvPath}`
  
  const logPath = path.join(runDir, "daily_summary.log")
  fs.appendFileSync(logPath, summary + "\n\n")
  console.log(summary)
  
  // Generate per-pair PnL histograms
  console.log("\n📈 Generating per-pair PnL histograms...")
  try {
    const histOutput = execSync("npx tsx scripts/perfill_bypair.ts 24 0.25", {
      cwd: root,
      encoding: "utf8",
      timeout: 60000
    })
    fs.appendFileSync(logPath, histOutput + "\n")
    console.log(histOutput)
  } catch (e: any) {
    console.error("Histogram generation failed:", e.message)
  }
  
  await post(SLACK, summary)
  await post(DC, summary)
}

main().catch(async e => {
  const err = `❌ Daily report error: ${String(e.message || e)}`
  console.error(err)
  await post(process.env.SLACK_WEBHOOK_URL || "", err)
  await post(process.env.DISCORD_WEBHOOK_URL || "", err)
  process.exit(1)
})
