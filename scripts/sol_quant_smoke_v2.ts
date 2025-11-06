// Explicitly load .env before importing the override function
import { config } from 'dotenv'
config() // Load .env into process.env

import { applySpecOverrides } from '../src/utils/spec_overrides.js'

console.log('ENV SPEC_OVERRIDE_SOL_TICK:', process.env.SPEC_OVERRIDE_SOL_TICK)
console.log('ENV SPEC_OVERRIDE_SOL_LOT:', process.env.SPEC_OVERRIDE_SOL_LOT)

const pair = 'SOL'
const baseSpec = { tickSize: '0.001', lotSize: '0.1' }
const finalSpec = applySpecOverrides(pair, baseSpec)

const mid = 160.49
const tick = Number(finalSpec.tickSize)
const lot  = Number(finalSpec.lotSize)

const pxDec = String(tick).includes('.') ? String(tick).split('.')[1].length : 0
const stepDec = String(lot).includes('.') ? String(lot).split('.')[1].length : 0
const priceInt = Math.round(mid * Math.pow(10, pxDec))
const size = 0.2
const sizeInt = Math.round(size * Math.pow(10, stepDec))

console.log(JSON.stringify({ pair, override: finalSpec, pxDec, stepDec, priceInt, size, sizeInt }, null, 2))
