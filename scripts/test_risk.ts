#!/usr/bin/env -S npx tsx
import "dotenv/config"
import { sendRiskAlert } from "../src/utils/slack_router.js"

async function main() {
  console.log("ENV check:", {
    SLACK_WEBHOOK_RISK: process.env.SLACK_WEBHOOK_RISK ? "SET" : "NOT SET",
    SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL ? "SET" : "NOT SET"
  })
  
  await sendRiskAlert("🔴 Test RISK alert from test_risk.ts", {
    title: "TEST RISK CHANNEL",
    details: { 
      test: "This is a test alert",
      ts: new Date().toISOString() 
    },
  })
  console.log("✅ Sent test RISK alert to #mm-risk channel")
}

main().catch((err) => {
  console.error("❌ Failed to send test RISK alert", err)
  process.exit(1)
})
