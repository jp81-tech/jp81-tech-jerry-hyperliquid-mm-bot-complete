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
  recent_high?: number     // Resistance level (24h high or 4h structure)
  recent_low?: number      // Support level (24h low or 4h structure)
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
   * 🐍 THE ANACONDA - Adaptive Trailing Stop Loss
   *
   * Tightens the SL as profit increases:
   *   Phase BREATHE (pnl < 5%):  SL = entry ± 1.5 ATR (standard room)
   *   Phase PROTECT (pnl 5-10%): SL trails from current price ± 1.0 ATR
   *   Phase TRAIL   (pnl 10-15%):SL trails from current price ± 0.75 ATR
   *   Phase LOCK    (pnl > 15%): SL trails from current price ± 0.5 ATR
   *
   * Breakeven guard: once pnl > 3%, SL cannot be worse than entry.
   * Hard caps: 7% majors, 12% alts (measured from entry, always enforced).
   *
   * @param direction - LONG or SHORT
   * @param profile - Token risk profile (must include current_price for trailing)
   * @param entryPrice - Entry price of the position
   * @param pnlPct - Current unrealized PnL as decimal (e.g., 0.10 = 10%). Default 0.
   * @returns Stop loss price
   */
  public static calculateVisionStopLoss(
    direction: 'LONG' | 'SHORT',
    profile: TokenRiskProfile,
    entryPrice: number,
    pnlPct: number = 0
  ): number {
    // 🐍 Phase-based ATR multiplier
    let atrMult: number
    if (pnlPct > 0.15) {
      atrMult = 0.5    // LOCK: very tight, protect big profits
    } else if (pnlPct > 0.10) {
      atrMult = 0.75   // TRAIL: tight trailing
    } else if (pnlPct > 0.05) {
      atrMult = 1.0    // PROTECT: moderate, breakeven secured
    } else {
      atrMult = 1.5    // BREATHE: standard breathing room
    }

    // Estimate ATR from daily volatility if real ATR not available
    const estimatedATR = profile.atr_value || (entryPrice * profile.volatility)
    const buffer = estimatedATR * atrMult

    // Anchor: trail from current price when in profit, else from entry
    const anchorPrice = (pnlPct > 0.05) ? profile.current_price : entryPrice

    let stopPrice: number
    if (direction === 'SHORT') {
      stopPrice = anchorPrice + buffer  // SL above anchor
    } else {
      stopPrice = anchorPrice - buffer  // SL below anchor
    }

    // 🛡️ STRUCTURE AWARENESS: Move SL behind support/resistance
    // Prevents stop-loss hunting at obvious levels
    const STRUCTURE_BUFFER = 0.005 // 0.5% margin beyond the wall

    if (direction === 'SHORT' && profile.recent_high) {
      const smartStop = profile.recent_high * (1 + STRUCTURE_BUFFER)
      const distFromEntry = (smartStop - entryPrice) / entryPrice
      // Only snap to structure if it's within 10% of entry and would improve SL
      if (stopPrice < smartStop && distFromEntry < 0.10 && distFromEntry > 0) {
        stopPrice = smartStop
      }
    } else if (direction === 'LONG' && profile.recent_low) {
      const smartStop = profile.recent_low * (1 - STRUCTURE_BUFFER)
      const distFromEntry = (entryPrice - smartStop) / entryPrice
      if (stopPrice > smartStop && distFromEntry < 0.10 && distFromEntry > 0) {
        stopPrice = smartStop
      }
    }

    // Smart cap: hard limit from entry (7% majors, 12% alts)
    const hardStopPct = this.getHardStopPct(profile.symbol)

    if (direction === 'SHORT') {
      let finalSl = Math.min(stopPrice, entryPrice + entryPrice * hardStopPct)
      // Breakeven guard: if profit > 3%, SL cannot be above entry
      if (pnlPct > 0.03) {
        finalSl = Math.min(finalSl, entryPrice * 0.999) // slightly below entry (fees)
      }
      return finalSl
    } else {
      let finalSl = Math.max(stopPrice, entryPrice - entryPrice * hardStopPct)
      // Breakeven guard: if profit > 3%, SL cannot be below entry
      if (pnlPct > 0.03) {
        finalSl = Math.max(finalSl, entryPrice * 1.001) // slightly above entry (fees)
      }
      return finalSl
    }
  }

  /**
   * Get the Anaconda phase name for logging.
   */
  public static getAnacondaPhase(pnlPct: number): string {
    if (pnlPct > 0.15) return 'LOCK'
    if (pnlPct > 0.10) return 'TRAIL'
    if (pnlPct > 0.05) return 'PROTECT'
    return 'BREATHE'
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
