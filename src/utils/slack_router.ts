import https from "https"
import { URL } from "url"

type SlackAlertKind = "risk" | "shadow" | "system" | "performance" | "default"

const riskWebhook = process.env.SLACK_WEBHOOK_RISK || process.env.SLACK_WEBHOOK_URL || ""
const shadowWebhook = process.env.SLACK_WEBHOOK_SHADOW || process.env.SLACK_WEBHOOK_URL || ""
const systemWebhook = process.env.SLACK_WEBHOOK_SYSTEM || process.env.SLACK_WEBHOOK_URL || ""
const perfWebhook = process.env.SLACK_WEBHOOK_PERF || process.env.SLACK_WEBHOOK_URL || ""

function resolveWebhook(kind: SlackAlertKind): string | null {
  if (kind === "risk") return riskWebhook || null
  if (kind === "shadow") return shadowWebhook || null
  if (kind === "system") return systemWebhook || null
  if (kind === "performance") return perfWebhook || null
  if (process.env.SLACK_WEBHOOK_URL) return process.env.SLACK_WEBHOOK_URL
  return null
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
              const err = new Error(
                `Slack webhook error: status=${res.statusCode} body=${text}`,
              )
              reject(err)
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

export async function sendSlackText(
  text: string,
  kind: SlackAlertKind = "default",
): Promise<void> {
  const webhook = resolveWebhook(kind)
  if (!webhook) {
    console.warn(`[slack_router] No webhook configured for kind=${kind}, text="${text.slice(0, 80)}"`)
    return
  }
  await postJson(webhook, { text })
}

export async function sendSlackPayload(
  payload: unknown,
  kind: SlackAlertKind = "default",
): Promise<void> {
  const webhook = resolveWebhook(kind)
  if (!webhook) {
    console.warn("[slack_router] No webhook configured for kind=" + kind)
    return
  }
  await postJson(webhook, payload)
}

export async function sendRiskAlert(text: string): Promise<void> {
  await sendSlackText(text, "risk")
}

export async function sendShadowAlert(text: string): Promise<void> {
  await sendSlackText(text, "shadow")
}

export async function sendSystemAlert(text: string): Promise<void> {
  await sendSlackText(text, "system")
}

export async function sendPerformanceAlert(text: string): Promise<void> {
  await sendSlackText(text, "performance")
}
export { SlackAlertKind }

