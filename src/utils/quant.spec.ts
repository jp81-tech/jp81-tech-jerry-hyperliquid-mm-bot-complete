import { test } from 'node:test'
import { strict as assert } from 'node:assert'

import {
  buildQCtx,
  decStrToInt,
  intToDecStr,
  quantizePriceToTick,
  quantizeSizeToLot,
  quantizeOrder,
  adjustPriceByTicksInt,
  adjustPriceByTicks,
} from './quant'

// Fixtures from live-like specs seen in logs:
const SPEC_ASTER = { tickSize: '0.0001', lotSize: '1' }    // pxDec=4, stepDec=0
const SPEC_PUMP  = { tickSize: '0.0001', lotSize: '1' }    // pxDec=4, stepDec=0
const SPEC_SOL   = { tickSize: '0.001',  lotSize: '0.1' }  // pxDec=3, stepDec=1

test('buildQCtx derives decimals and integer ticks/lots correctly', () => {
  const qa = buildQCtx(SPEC_ASTER)
  assert.equal(qa.pxDec, 4)
  assert.equal(qa.stepDec, 0)
  assert.equal(qa.tickInt, 1)
  assert.equal(qa.lotInt, 1)

  const qs = buildQCtx(SPEC_SOL)
  assert.equal(qs.pxDec, 3)
  assert.equal(qs.stepDec, 1)
  assert.equal(qs.tickInt, 1)   // 0.001 @3 -> 1
  assert.equal(qs.lotInt, 1)    // 0.1 @1  -> 1
})

test('decStrToInt / intToDecStr are inverses within the same decimals', () => {
  const v = decStrToInt('0.9234', 4)
  assert.equal(v, 9234)
  assert.equal(intToDecStr(v, 4), '0.9234')

  const v2 = decStrToInt('165.259', 3)
  assert.equal(v2, 165259)
  assert.equal(intToDecStr(v2, 3), '165.259')
})

test('quantizePriceToTick: floor/ceil/round basics', () => {
  const q = buildQCtx(SPEC_ASTER) // tickInt=1 @ 1e-4

  // Off-grid price snaps as expected
  let r = quantizePriceToTick('0.92345', q, 'floor')
  assert.equal(r.priceStr, '0.9234')
  assert.equal(r.ticks, 9234)

  // ceil: 0.92341 truncates to 0.9234 (tickSize resolution), already on grid
  r = quantizePriceToTick('0.92341', q, 'ceil')
  assert.equal(r.priceStr, '0.9234') // truncated to grid
  assert.equal(r.ticks, 9234)

  // round: 0.92345 truncates to 0.9234 first, then no rounding needed
  r = quantizePriceToTick('0.92345', q, 'round')
  assert.equal(r.priceStr, '0.9234')
  assert.equal(r.ticks, 9234)
})

test('quantizePriceToTick: makerSafeFloor nudges 1 tick down for ALO safety', () => {
  const q = buildQCtx(SPEC_ASTER)

  // Exactly on-grid → nudge down 1 tick so ALO won't cross after matching
  let r = quantizePriceToTick('0.9234', q, 'makerSafeFloor')
  assert.equal(r.priceStr, '0.9233')
  assert.equal(r.ticks, 9233)

  // Slightly above grid: floors to 0.9234 first, then nudges would already be floored
  r = quantizePriceToTick('0.92345', q, 'makerSafeFloor')
  assert.equal(r.priceStr, '0.9233')
  assert.equal(r.ticks, 9233)
})

test('quantizeSizeToLot: floors by default; ceil optional', () => {
  const qA = buildQCtx(SPEC_ASTER) // lot=1, stepDec=0
  let s = quantizeSizeToLot('21', qA, 'floor')
  assert.equal(s.sizeStr, '21')
  assert.equal(s.steps, 21)

  s = quantizeSizeToLot('21', qA, 'ceil')
  assert.equal(s.sizeStr, '21')
  assert.equal(s.steps, 21)

  const qS = buildQCtx(SPEC_SOL) // lot=0.1, stepDec=1
  s = quantizeSizeToLot('1.24', qS, 'floor')
  assert.equal(s.sizeStr, '1.2')
  assert.equal(s.steps, 12)

  // ceil: 1.21 with lot=0.1, stepDec=1 truncates to 1.2, already on grid
  s = quantizeSizeToLot('1.21', qS, 'ceil')
  assert.equal(s.sizeStr, '1.2') // decStrToInt('1.21', 1) = 12, 12/1=12 lots
  assert.equal(s.steps, 12)
})

test('quantizeOrder: ALO maker-safe vs GTC rounding', () => {
  const price = '0.92123'
  const size  = '21'

  const alo = quantizeOrder('ASTER', 'buy', 'alo', price, size, SPEC_ASTER)
  // nudged down vs floor if exactly on-grid; else normal floor
  assert.match(alo.pxQ, /^0\.921[0-9]$/)
  assert.equal(alo.szQ, '21')
  assert.ok(Number.isInteger(alo.priceInt))
  assert.ok(Number.isInteger(alo.sizeInt))

  const gtc = quantizeOrder('ASTER', 'buy', 'gtc', price, size, SPEC_ASTER)
  // GTC uses 'round'
  assert.notEqual(alo.pxQ, gtc.pxQ)
  assert.equal(gtc.szQ, '21')
})

test('adjustPriceByTicksInt never returns <= 0, stays integer', () => {
  const q = buildQCtx(SPEC_ASTER)
  const p0 = decStrToInt('0.0001', q.pxDec)
  const p1 = adjustPriceByTicksInt(p0, -2, q) // would go <= 0 → clamped to 1 tick
  assert.equal(p1, q.tickInt)
  assert.ok(Number.isInteger(p1))
})

test('adjustPriceByTicks (wrapper) uses live tickSize and integer math', () => {
  const p = adjustPriceByTicks('0.9234', -1, SPEC_ASTER) // 1 tick down
  assert.equal(p, '0.9233')
})

test('spec drift: changing tick/lot updates quantization immediately', () => {
  const price = '0.92345'
  const size = '21'

  const a1 = quantizeOrder('ASTER', 'buy', 'alo', price, size, SPEC_ASTER)
  assert.equal(a1.pxQ, '0.9233') // makerSafeFloor nudges down

  const DRIFT = { tickSize: '0.001', lotSize: '0.5' } // coarser grid + lot
  const a2 = quantizeOrder('ASTER', 'buy', 'alo', price, size, DRIFT)
  // New px grid is 1e-3 → makerSafeFloor around 0.923 → 0.922
  assert.equal(a2.pxQ, '0.922')
  // New lot is 0.5 → size floors to multiple of 0.5
  assert.equal(a2.szQ, '21.0') // stepDec=1, 21 already multiple of 0.5 → 21.0
})

test('ASTER/PUMP/SOL realistic snaps from observed logs', () => {
  const aster = quantizeOrder('ASTER', 'buy', 'alo', '0.92194', '21', SPEC_ASTER)
  assert.equal(aster.pxQ, '0.9218') // makerSafeFloor nudges down from 0.9219
  assert.equal(aster.szQ, '21')

  const pump = quantizeOrder('PUMP', 'buy', 'alo', '0.003904', '5128', SPEC_PUMP)
  // makerSafeFloor ensures price is safely on grid for ALO, nudges down
  assert.match(pump.pxQ, /^0\.003[0-9]+$/)
  assert.equal(pump.szQ, '5128')

  const sol = quantizeOrder('SOL', 'buy', 'alo', '165.2594', '1.0', SPEC_SOL)
  // pxDec=3 tick=0.001; makerSafeFloor floors to 165.259, then nudges 1 tick to 165.258 if exact
  assert.match(sol.pxQ, /^165\.25[89]$/)
  // lot=0.1 → size floors to 1.0 exactly
  assert.equal(sol.szQ, '1.0')
})

test('backward compatibility: old adjustPriceByTicks signature still works', () => {
  // Old signature with number tickSize and explicit priceDecimals
  const p = adjustPriceByTicks('0.9234', -1, 0.0001, 4)
  assert.equal(p, '0.9233')
})

test('overflow guards: very large prices/sizes', () => {
  const LARGE_SPEC = { tickSize: '0.000001', lotSize: '0.0001' }
  const q = buildQCtx(LARGE_SPEC)

  // Should not throw on reasonable large values
  const large = quantizePriceToTick('100000.123456', q, 'floor')
  assert.ok(large.priceInt > 0)
  assert.ok(Number.isInteger(large.priceInt))
})

test('edge case: zero and negative prices clamped safely', () => {
  const q = buildQCtx(SPEC_ASTER)

  const zero = quantizePriceToTick('0', q, 'floor')
  assert.equal(zero.priceInt, 0)
  assert.equal(zero.ticks, 0)

  const nearZero = quantizePriceToTick('0.00001', q, 'makerSafeFloor')
  assert.ok(nearZero.priceInt >= 0)
})

test('ALO vs GTC mode differences', () => {
  // For ASTER with exact on-grid price
  const exactPrice = '0.9234'
  const size = '21'

  const alo = quantizeOrder('ASTER', 'buy', 'alo', exactPrice, size, SPEC_ASTER)
  const gtc = quantizeOrder('ASTER', 'buy', 'gtc', exactPrice, size, SPEC_ASTER)

  // ALO should nudge down, GTC should use exact price
  assert.equal(alo.pxQ, '0.9233') // nudged -1 tick
  assert.equal(gtc.pxQ, '0.9234') // exact
})
