import https from "https"
import { URL } from "url"

// S/R embeds go to all webhooks (legacy behavior)
const discordWebhook = process.env.DISCORD_WEBHOOK_URL || ""
const discordWebhooks = [
  discordWebhook,
  process.env.DISCORD_WEBHOOK_URL_2 || "",
].filter(u => u.length > 0)

// Bot alerts go ONLY to webhook 2 (new channel)
const alertWebhook = process.env.DISCORD_WEBHOOK_URL_2 || ""

// Throttle: max 1 alert per key per THROTTLE_MS
const THROTTLE_MS = 5 * 60 * 1000 // 5 minutes
const lastSent = new Map<string, number>()

function throttleKey(msg: string): string {
  // Extract pattern: "[EMERGENCY] VIRTUAL removed" → "EMERGENCY_VIRTUAL"
  // "[WATCHDOG] No fills" → "WATCHDOG"
  // "BREAKOUT kPEPE" → "BREAKOUT_kPEPE"
  const bracketMatch = msg.match(/\[([A-Z_]+)\]/)
  const tokenMatch = msg.match(/\b(kPEPE|VIRTUAL|LIT|FARTCOIN|HYPE)\b/)
  const key = (bracketMatch?.[1] ?? 'GENERIC') + '_' + (tokenMatch?.[1] ?? 'ALL')
  return key
}

function shouldSend(msg: string): boolean {
  const key = throttleKey(msg)
  const now = Date.now()
  const last = lastSent.get(key) ?? 0
  if (now - last < THROTTLE_MS) return false
  lastSent.set(key, now)
  return true
}

function postJson(webhookUrl: string, body: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(webhookUrl)
      const data = Buffer.from(JSON.stringify(body), "utf8")

      const req = https.request(
        {
          method: "POST",
          hostname: url.hostname,
          path: url.pathname + url.search,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": data.length.toString(),
          },
        },
        res => {
          const chunks: Buffer[] = []
          res.on("data", c => chunks.push(c))
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve()
            } else {
              const text = Buffer.concat(chunks).toString("utf8")
              reject(new Error(`Discord webhook error: status=${res.statusCode} body=${text}`))
            }
          })
        },
      )

      req.on("error", reject)
      req.write(data)
      req.end()
    } catch (e) {
      reject(e)
    }
  })
}

/**
 * Send a throttled alert to the alert channel (webhook 2 only).
 * Max 1 per alert type per token per 5 minutes.
 */
export async function sendDiscordAlert(content: string): Promise<void> {
  if (!alertWebhook) return
  if (!shouldSend(content)) return
  try {
    await postJson(alertWebhook, { content })
  } catch (e) {
    console.error(`[discord_alert] Failed:`, e)
  }
}

/** Send message to all configured webhooks (no throttle) */
export async function sendDiscordMessage(content: string): Promise<void> {
  if (discordWebhooks.length === 0) {
    console.warn(`[discord_notifier] No DISCORD_WEBHOOK_URL configured`)
    return
  }
  await Promise.allSettled(
    discordWebhooks.map(url => postJson(url, { content }).catch(e =>
      console.error(`[discord_notifier] Failed to send to ${url.slice(-20)}:`, e)
    ))
  )
}

/** Send embed to all configured webhooks (no throttle) */
export async function sendDiscordEmbed(embed: {
  title?: string
  description?: string
  color?: number
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  footer?: { text: string }
  timestamp?: string
}): Promise<void> {
  if (discordWebhooks.length === 0) {
    console.warn(`[discord_notifier] No DISCORD_WEBHOOK_URL configured`)
    return
  }
  await Promise.allSettled(
    discordWebhooks.map(url => postJson(url, { embeds: [embed] }).catch(e =>
      console.error(`[discord_notifier] Failed to send embed to ${url.slice(-20)}:`, e)
    ))
  )
}
