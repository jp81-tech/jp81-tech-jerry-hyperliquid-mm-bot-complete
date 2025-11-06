import * as hl from "@nktkas/hyperliquid"
import { ethers } from "ethers"
import { config } from "dotenv"
import path from "path"

config({ path: path.resolve(process.cwd(), ".env") })

const SLACK = process.env.SLACK_WEBHOOK_URL || ""
const DC = process.env.DISCORD_WEBHOOK_URL || ""
const REB = Number(process.env.MAKER_REBATE_BPS || "2.0")
const TAKER = Number(process.env.TAKER_FEE_BPS || "5.0")
const NET_TARGET = Number(process.env.NET_BPS_TARGET || "1.5")
const MIN_TURN = Number(process.env.ALERTS_MIN_TURNOVER_USD || "5000")
const MIN_FILL_H = Number(process.env.ALERTS_MIN_FILL_RATE_PER_H || "20")

async function post(url: string, content: string) {
  if (!url) return
  const body = url.includes("discord") ? JSON.stringify({ content }) : JSON.stringify({ text: content })
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body })
}

function fmt(n: number, d = 2) { return Number.isFinite(n) ? n.toFixed(d) : "0.00" }

async function main() {
  const pk = process.env.PRIVATE_KEY?.trim() || ""
  if (!pk) throw new Error("PRIVATE_KEY missing")
  
  const wallet = new ethers.Wallet(pk)
  const addr = wallet.address
  const infoClient = new hl.InfoClient({ transport: new hl.HttpTransport() })

  const now = Date.now()
  const sinceMs = now - 60 * 60 * 1000

  const userFills = await infoClient.userFills({ user: addr })
  const last = userFills.filter((f: any) => Number(f.time) >= sinceMs)

  let turn = 0
  let buys = 0
  let sells = 0
  let makerNotional = 0
  const pairs = new Set<string>()
  
  for (const f of last) {
    const notional = Math.abs(Number(f.sz) * Number(f.px))
    turn += notional
    if (f.side === "B") buys++
    else sells++
    if (f.coin) pairs.add(f.coin)
    if ((f as any).closedPnl !== undefined || f.dir === "Close Only") {
      makerNotional += notional * 0.85
    }
  }
  
  const count = last.length
  const fillRateH = count
  const estMakerShare = turn > 0 ? makerNotional / turn : 0.85
  const estFeeBps = estMakerShare * (-REB) + (1 - estMakerShare) * TAKER
  const estNetBps = NET_TARGET
  
  const status = turn >= MIN_TURN && fillRateH >= MIN_FILL_H ? "✅ OK" : "⚠️  LOW ACTIVITY"
  const pairsList = Array.from(pairs).join(", ") || "—"
  
  const msg = `⚡ MM Alerts (60m)
Turnover: $${fmt(turn, 0)}
Fills: ${count} (${fmt(fillRateH, 0)}/h)  Buy:${buys} Sell:${sells}
Pairs: ${pairsList}
Est fees bps: ${fmt(estFeeBps)}  Net bps target: ${fmt(estNetBps)}
Status: ${status}`

  console.log(msg)
  await post(SLACK, msg)
  await post(DC, msg)
}

main().catch(async e => {
  const err = `❌ Alerts error: ${String(e.message || e)}`
  console.error(err)
  await post(SLACK, err)
  await post(DC, err)
  process.exit(1)
})
