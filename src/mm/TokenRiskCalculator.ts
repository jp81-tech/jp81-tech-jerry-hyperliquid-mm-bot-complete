/**
 * TokenRiskCalculator - Dynamic Leverage & Vision SL
 *
 * Combined strategy for the Autonomous Fund Manager:
 * - Leverage: base from SM conviction, scaled down by volatility
 * - Stop Loss: ATR-based, adapts to each token's "breathing room"
 *
 * Named TokenRiskCalculator (not RiskManager) to avoid collision
 * with the portfolio-level RiskManager in src/risk/RiskManager.ts
 * which handles drawdown limits and inventory caps.
 *
 * Created: 2026-02-03
 */

export interface TokenRiskProfile {
  symbol: string
  volatility: number       // Daily volatility (e.g., 0.05 for 5%)
  confidence: number       // Smart Money Confidence (0-100)
  current_price: number    // Current price
  atr_value?: number       // Optional: ATR from candles (if available)
}

export class TokenRiskCalculator {

  /**
   * Dynamic Leverage (Combined Strategy)
   * Balances conviction (attack) vs volatility (defense).
   *
   * Examples (with estimateDailyVolatility):
   *   BTC (vol~4.5%, conf=85%) -> 4x
   *   SOL (vol~4.5%, conf=70%) -> 3x
   *   LIT (vol~7.2%, conf=90%) -> 3x
   *   VIRTUAL (vol~12.5%, conf=80%) -> 1x
   *   FARTCOIN (vol~12.5%, conf=95%) -> 1x
   */
  public static calculateLeverage(profile: TokenRiskProfile): number {
    const MAX_LEV = 5
    const TARGET_VOL = 0.05  // Calibrated for ~5% daily vol assets

    // Factor A: Conviction (0.5x - 1.0x)
    const convictionFactor = Math.max(profile.confidence, 50) / 100

    // Factor B: Volatility Dampener (reduces leverage on memecoins)
    // If vol = 20% (0.20), factor = 0.25 (i.e., 1/4 leverage)
    const volatilityFactor = TARGET_VOL / Math.max(profile.volatility, 0.01)

    const rawLev = MAX_LEV * convictionFactor * volatilityFactor

    // Clamp: Min 1x, Max 5x
    return Math.min(Math.max(Math.floor(rawLev), 1), MAX_LEV)
  }

  // Majors get tighter caps (lower volatility, more liquid)
  private static readonly MAJOR_TOKENS = ['BTC', 'ETH', 'SOL', 'BNB']

  private static getHardStopPct(symbol: string): number {
    return this.MAJOR_TOKENS.includes(symbol.toUpperCase()) ? 0.07 : 0.12
  }

  /**
   * Vision SL (ATR-based)
   * Calculates stop loss price dynamically adapted to token's noise level.
   * Uses estimated ATR from daily volatility if real ATR not available.
   *
   * ATR_MULTIPLIER = 1.5 (tightened from 2.5 — swing trading with SM confirmation)
   * Hard Stop: 7% majors (BTC/ETH/SOL/BNB), 12% alts/memes
   *
   * @param direction - LONG or SHORT
   * @param profile - Token risk profile
   * @param entryPrice - Entry price of the position
   * @returns Stop loss price
   */
  public static calculateVisionStopLoss(
    direction: 'LONG' | 'SHORT',
    profile: TokenRiskProfile,
    entryPrice: number
  ): number {
    const ATR_MULTIPLIER = 1.5

    // Estimate ATR from daily volatility if real ATR not available
    // ATR ~ Price x Volatility
    const estimatedATR = profile.atr_value || (entryPrice * profile.volatility)
    const buffer = estimatedATR * ATR_MULTIPLIER

    let stopPrice: number

    if (direction === 'SHORT') {
      stopPrice = entryPrice + buffer  // SL above entry
    } else {
      stopPrice = entryPrice - buffer  // SL below entry
    }

    // Smart cap: 7% for majors, 12% for alts
    const hardStopPct = this.getHardStopPct(profile.symbol)
    const hardStopDist = entryPrice * hardStopPct

    if (direction === 'SHORT') {
      return Math.min(stopPrice, entryPrice + hardStopDist)
    } else {
      return Math.max(stopPrice, entryPrice - hardStopDist)
    }
  }

  /**
   * Convenience: Calculate SL as a percentage of entry price.
   * Returns a value like 0.067 (= 6.7%).
   * Useful when entry price isn't known yet (SmAutoDetector).
   *
   * Examples (ATR_MULT=1.5):
   *   BTC (vol~4.5%) -> 6.75% SL (cap 7%)
   *   SOL (vol~4.5%) -> 6.75% SL (cap 7%)
   *   LIT (vol~7.2%) -> 10.8% SL (cap 12%)
   *   FARTCOIN (vol~12.5%) -> 12.0% SL (capped)
   *   VIRTUAL (vol~12.5%) -> 12.0% SL (capped)
   */
  public static calculateVisionSlPercent(volatility: number, symbol: string = ''): number {
    const ATR_MULTIPLIER = 1.5
    const hardStopPct = this.getHardStopPct(symbol)

    const slPct = volatility * ATR_MULTIPLIER
    return Math.min(slPct, hardStopPct)
  }

  /**
   * Risk-Based Position Sizing
   * Normalizes position sizes so dollar risk is equal regardless of token volatility.
   *
   * Formula: maxPosition = (accountEquity × riskPerTradePct) / visionSlPct
   *
   * Examples (equity=$8000, risk=5%):
   *   SOL  (SL 11.3%) -> $3,540  (risk = $400)
   *   LIT  (SL 15.0%) -> $2,667  (risk = $400)
   *
   * @param accountEquity - Current account equity in USD
   * @param visionSlPct - Vision SL as decimal (e.g. 0.15 for 15%)
   * @param riskPerTradePct - Fraction of equity to risk per trade (default 0.05 = 5%)
   * @returns Maximum position size in USD
   */
  public static calculateRiskBasedMaxPosition(
    accountEquity: number,
    visionSlPct: number,
    riskPerTradePct: number = 0.05
  ): number {
    if (visionSlPct <= 0 || accountEquity <= 0) return Infinity
    return (accountEquity * riskPerTradePct) / visionSlPct
  }
}
