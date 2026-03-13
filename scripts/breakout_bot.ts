#!/usr/bin/env npx tsx
import { config as dotenvConfig } from 'dotenv'
dotenvConfig()

import { loadConfig } from '../src/breakout/config.js'
import { BreakoutBot } from '../src/breakout/BreakoutBot.js'

const config = loadConfig()
const bot = new BreakoutBot(config)
bot.start().catch(e => {
  console.error(`[FATAL] ${e.message}`)
  process.exit(1)
})
