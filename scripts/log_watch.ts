import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { sendRiskAlert } from "../src/utils/slack_router"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const LOG_PATH = path.join(__dirname, "..", "bot.log")
const MAX_BYTES = 200_000

async function main(): Promise<void> {
  if (!fs.existsSync(LOG_PATH)) {
    console.warn("[LOG_WATCH] bot.log not found")
    return
  }

  const stat = fs.statSync(LOG_PATH)
  const size = stat.size
  const start = size > MAX_BYTES ? size - MAX_BYTES : 0
  const length = size - start

  const fd = fs.openSync(LOG_PATH, "r")
  const buf = Buffer.alloc(length)
  fs.readSync(fd, buf, 0, length, start)
  fs.closeSync(fd)

  const lines = buf.toString("utf8").split("\n")
  let invCount = 0
  let unwindCount = 0
  let errorCount = 0

  for (const line of lines) {
    if (!line) continue
    if (line.includes("INVENTORY_GUARD")) invCount++
    if (line.includes("UNWIND_MODE")) unwindCount++
    if (/(ERROR|Error|Exception)/.test(line)) errorCount++
  }

  const messages: string[] = []
  if (invCount > 50) {
    messages.push(`INVENTORY_GUARD seen ${invCount} times in last log chunk`)
  }
  if (unwindCount > 50) {
    messages.push(`UNWIND_MODE spam: ${unwindCount} lines in last log chunk`)
  }
  if (errorCount > 0) {
    messages.push(`Errors/Exceptions detected: ${errorCount} lines`)
  }

  if (messages.length > 0) {
    const payload = "📈 LOG WATCH\n" + messages.map(m => `• ${m}`).join("\n")
    await sendRiskAlert(payload)
    console.log("[LOG_WATCH] Alert sent")
  } else {
    console.log("[LOG_WATCH] No anomalies")
  }
}

main().catch(err => {
  console.error("[LOG_WATCH] Failed:", err)
})

