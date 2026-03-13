export interface BreakoutCandle {
  t: number    // open time ms
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface DonchianChannel {
  upper: number   // highest high over N periods
  lower: number   // lowest low over N periods
  mid: number     // (upper + lower) / 2
}

export interface BreakoutSignal {
  token: string
  side: 'LONG' | 'SHORT'
  entryPrice: number
  slPrice: number        // opposite Donchian band
  tpPrice: number        // entry + R × tpMultiplier
  riskR: number          // distance entry → SL
  donchian: DonchianChannel
  ema200: number
  volumeRatio: number    // breakout vol / avg vol
  timestamp: number
}

export interface ActivePosition {
  token: string
  side: 'LONG' | 'SHORT'
  entryPrice: number
  size: number           // signed (negative = short)
  valueUsd: number
  slPrice: number        // trailing SL
  tpPrice: number
  entryTime: number
  peakPnlPct: number    // for trailing
  signal: BreakoutSignal
}

export interface BreakoutState {
  positions: Record<string, ActivePosition>
  dailyPnl: number
  dailyPnlResetTime: number
  totalPnl: number
  tradesTotal: number
  tradesWon: number
  startTime: number
}
