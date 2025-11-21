#!/usr/bin/env -S npx tsx
import "dotenv/config"
import { sendPerformanceAlert } from "../src/utils/slack_router.js"

async function main() {
  console.log("ENV check:", {
    SLACK_WEBHOOK_PERF: process.env.SLACK_WEBHOOK_PERF ? "SET" : "NOT SET",
    SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL ? "SET" : "NOT SET"
  })
  
  await sendPerformanceAlert(
    "📊 Test PERFORMANCE alert from test_perf.ts\n" +
    "This is a test of reports & metrics channel"
  )
  console.log("✅ Sent test PERFORMANCE alert to #mm-performance channel")
}

main().catch((err) => {
  console.error("❌ Failed to send test PERFORMANCE alert", err)
  process.exit(1)
})
