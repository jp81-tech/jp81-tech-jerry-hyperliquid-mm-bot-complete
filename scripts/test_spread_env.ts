#!/usr/bin/env -S npx tsx
import 'dotenv/config'

console.log('=== Testing SPREAD_OVERRIDE environment variables ===')
console.log('MAKER_SPREAD_BPS:', process.env.MAKER_SPREAD_BPS)
console.log('SPREAD_OVERRIDE_TAO:', process.env.SPREAD_OVERRIDE_TAO)
console.log('SPREAD_OVERRIDE_ZEC:', process.env.SPREAD_OVERRIDE_ZEC)
console.log('SPREAD_OVERRIDE_VIRTUAL:', process.env.SPREAD_OVERRIDE_VIRTUAL)
console.log('SPREAD_OVERRIDE_ASTER:', process.env.SPREAD_OVERRIDE_ASTER)

const overrides = Object.keys(process.env).filter(k => k.startsWith('SPREAD_OVERRIDE_'))
console.log('\nAll SPREAD_OVERRIDE_* variables found:', overrides.length)
for (const key of overrides) {
  console.log(`  ${key}=${process.env[key]}`)
}
