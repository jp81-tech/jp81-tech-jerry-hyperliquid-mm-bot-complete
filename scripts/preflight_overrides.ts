import 'dotenv/config'
import { applySpecOverrides } from '../src/utils/spec_overrides.js'

type Spec = { tickSize: string|number, lotSize: string|number }

function getOverridePairs(): string[] {
  const keys = Object.keys(process.env)
  const pairs = new Set<string>()
  for (const k of keys) {
    const m = k.match(/^SPEC_OVERRIDE_([A-Z0-9]+)_(TICK|LOT)$/)
    if (m) pairs.add(m[1])
  }
  return [...pairs].sort()
}

function envTick(pair: string): string | undefined {
  return process.env[`SPEC_OVERRIDE_${pair}_TICK`]
}
function envLot(pair: string): string | undefined {
  return process.env[`SPEC_OVERRIDE_${pair}_LOT`]
}

function toStr(x: string|number|undefined): string|undefined {
  if (x === undefined) return undefined
  return typeof x === 'number' ? x.toString() : x
}

let failed = 0
for (const pair of getOverridePairs()) {
  const wantedTick = envTick(pair)
  const wantedLot  = envLot(pair)
  const base: Spec = { tickSize: '0.001', lotSize: '1' }
  const final = applySpecOverrides(pair, { tickSize: base.tickSize, lotSize: base.lotSize })
  const gotTick = toStr(final.tickSize)
  const gotLot  = toStr(final.lotSize)
  const okTick = wantedTick ? (gotTick === wantedTick) : true
  const okLot  = wantedLot  ? (gotLot  === wantedLot)  : true
  const status = okTick && okLot ? 'OK' : 'FAIL'
  console.log(`override_check pair=${pair} tick=${gotTick}/${wantedTick ?? '-'} lot=${gotLot}/${wantedLot ?? '-'} status=${status}`)
  if (!okTick || !okLot) failed++
}
if (failed > 0) {
  console.error(`override_check_result failed=${failed}`)
  process.exit(1)
}
console.log('override_check_result ok')
