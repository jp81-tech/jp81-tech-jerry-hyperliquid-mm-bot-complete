import https from "https"
import { URL } from "url"

const discordWebhook = process.env.DISCORD_WEBHOOK_URL || ""
const discordWebhooks = [
  discordWebhook,
  process.env.DISCORD_WEBHOOK_URL_2 || "",
].filter(u => u.length > 0)

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
