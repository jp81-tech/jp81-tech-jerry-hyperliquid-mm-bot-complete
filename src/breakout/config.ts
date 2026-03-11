export interface BreakoutConfig {
  dryRun: boolean
  privateKey: string
  tokens: string[]

  // Strategy
  donchianPeriod: number       // lookback for Donchian (1m candles)
  emaPeriod: number            // EMA trend filter (5m candles)
  volumeConfirmMult: number    // breakout vol must be > X × avg
  tpRMultiplier: number        // TP = entry ± R × this

  // Risk
  riskPct: number              // % of equity risked per trade
  maxPositions: number
  maxDailyLossPct: number
  maxDrawdownPct: number
  defaultLeverage: number

  // Execution
  tickSec: number
  iocSlippageBps: number

  // Discord
  discordWebhookUrl: string
}

export function loadConfig(): BreakoutConfig {
  const args = process.argv.slice(2)
  const isLive = args.includes('--live')

  const tokensStr = process.env.BREAKOUT_TOKENS || 'BTC,ETH,SOL,HYPE'
  const tokens = tokensStr.split(',').map(s => s.trim()).filter(Boolean)

  return {
    dryRun: !isLive,
    privateKey: process.env.BREAKOUT_PRIVATE_KEY || '',
    tokens,

    donchianPeriod: int('BREAKOUT_DONCHIAN_PERIOD', 20),
    emaPeriod: int('BREAKOUT_EMA_PERIOD', 200),
    volumeConfirmMult: float('BREAKOUT_VOLUME_MULT', 1.5),
    tpRMultiplier: float('BREAKOUT_TP_R_MULT', 3.0),

    riskPct: float('BREAKOUT_RISK_PCT', 1.0),
    maxPositions: int('BREAKOUT_MAX_POSITIONS', 3),
    maxDailyLossPct: float('BREAKOUT_MAX_DAILY_LOSS_PCT', 3.0),
    maxDrawdownPct: float('BREAKOUT_MAX_DRAWDOWN_PCT', 10.0),
    defaultLeverage: int('BREAKOUT_DEFAULT_LEVERAGE', 5),

    tickSec: int('BREAKOUT_TICK_SEC', 15),
    iocSlippageBps: int('BREAKOUT_IOC_SLIPPAGE_BPS', 20),

    discordWebhookUrl: process.env.DISCORD_BREAKOUT_WEBHOOK || process.env.DISCORD_WEBHOOK_URL || '',
  }
}

function int(key: string, def: number): number {
  return parseInt(process.env[key] || String(def), 10)
}

function float(key: string, def: number): number {
  return parseFloat(process.env[key] || String(def))
}
