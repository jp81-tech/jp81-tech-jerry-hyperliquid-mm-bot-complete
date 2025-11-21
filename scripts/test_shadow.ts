#!/usr/bin/env -S npx tsx
import "dotenv/config"
import { sendShadowAlert } from "../src/utils/slack_router.js"

async function main() {
  console.log("ENV check:", {
    SLACK_WEBHOOK_SHADOW: process.env.SLACK_WEBHOOK_SHADOW ? "SET" : "NOT SET",
    SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL ? "SET" : "NOT SET"
  })
  
  await sendShadowAlert(
    "👻 Test SHADOW alert from test_shadow.ts\n" +
    "This is a test of risk monitoring (non-critical)"
  )
  console.log("✅ Sent test SHADOW alert to #mm-shadow channel")
}

main().catch((err) => {
  console.error("❌ Failed to send test SHADOW alert", err)
  process.exit(1)
})
