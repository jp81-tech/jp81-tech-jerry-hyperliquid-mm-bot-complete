import { applySpecOverrides } from '../src/utils/spec_overrides.js'

// Minimal mock: simulate spec provider JSON your bot uses
const pair = 'SOL'
const baseSpec = { tickSize: '0.001', lotSize: '0.1' } // will be overridden to 0.01/0.1 by ENV
const finalSpec = applySpecOverrides(pair, baseSpec)

// Choose an example mid; we only care about integer mapping and pxDec
const mid = 160.49
const tick = Number(finalSpec.tickSize)
const lot  = Number(finalSpec.lotSize)

// Convert to ints like your quantizer
const pxDec = String(tick).includes('.') ? String(tick).split('.')[1].length : 0
const stepDec = String(lot).includes('.') ? String(lot).split('.')[1].length : 0
const priceInt = Math.round(mid * Math.pow(10, pxDec))
const size = 0.2
const sizeInt = Math.round(size * Math.pow(10, stepDec))

console.log(JSON.stringify({ pair, override: finalSpec, pxDec, stepDec, priceInt, size, sizeInt }, null, 2))
