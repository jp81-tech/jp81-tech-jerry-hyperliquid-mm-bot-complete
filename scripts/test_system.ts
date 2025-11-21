#!/usr/bin/env -S npx tsx
import "dotenv/config"
import { sendSystemAlert } from "../src/utils/slack_router.js"

async function main() {
  console.log("ENV check:", {
    SLACK_WEBHOOK_SYSTEM: process.env.SLACK_WEBHOOK_SYSTEM ? "SET" : "NOT SET",
    SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL ? "SET" : "NOT SET"
  })
  
  await sendSystemAlert(
    "🛑 Test SYSTEM alert from test_system.ts\n" +
    "This is a test of infrastructure monitoring"
  )
  console.log("✅ Sent test SYSTEM alert to #mm-system channel")
}

main().catch((err) => {
  console.error("❌ Failed to send test SYSTEM alert", err)
  process.exit(1)
})
