/**
 * RiskManager - Hard Stop Protection dla Market Maker Bot
 *
 * Chroni kapitał przed katastroficznymi stratami poprzez:
 * - Daily drawdown limit (np. 3% straty = HALT)
 * - Inventory limit (np. 60% kapitału w krypto = REDUCE_ONLY)
 * - Hard price stop (opcjonalnie - cena poniżej progu = HALT)
 *
 * KRYTYCZNE: Ten moduł działa PRZED behaviouralGuard - jest to ostatnia linia obrony
 */

export interface RiskConfig {
  maxDailyDrawdownPct: number;  // np. 0.03 (3% straty dziennie = stop)
  maxInventoryPct: number;      // np. 0.60 (60% portfolio w coinie = reduce only)
  hardStopPrice?: number;       // Cena poniżej której uciekamy (opcjonalne)
  emergencyLiquidateThreshold?: number; // np. 0.05 (5% straty = liquidate all)
}

export enum RiskAction {
  CONTINUE = 'CONTINUE',          // Normalny trading
  REDUCE_ONLY = 'REDUCE_ONLY',    // Tylko sprzedaż (ask), brak kupna (bid)
  HALT = 'HALT',                  // Stop bota, anuluj wszystko
  EMERGENCY_LIQUIDATE = 'LIQUIDATE' // Panika: sprzedaj wszystko po markecie
}

export interface RiskCheckResult {
  action: RiskAction;
  reason: string;
  severity: 'info' | 'warning' | 'critical';
  inventoryRatio?: number;
  currentDrawdown?: number;
}

export class RiskManager {
  private initialEquity: number;
  private config: RiskConfig;
  private isShutdown: boolean = false;
  private sessionStartTime: number;
  private highWaterMark: number;

  constructor(initialEquity: number, config: RiskConfig) {
    this.initialEquity = initialEquity;
    this.highWaterMark = initialEquity;
    this.config = config;
    this.sessionStartTime = Date.now();

    console.log('[RISK_MANAGER] 🛡️ Initialized with:');
    console.log(`  Initial Equity: $${initialEquity.toFixed(2)}`);
    console.log(`  Max Daily Drawdown: ${(config.maxDailyDrawdownPct * 100).toFixed(1)}%`);
    console.log(`  Max Inventory: ${(config.maxInventoryPct * 100).toFixed(0)}%`);
    if (config.hardStopPrice) {
      console.log(`  Hard Stop Price: $${config.hardStopPrice}`);
    }
  }

  /**
   * Główna funkcja sprawdzająca stan ryzyka
   * Wywołuj to PRZED każdym cyklem market making
   */
  public checkHealth(
    currentEquity: number,
    inventoryValue: number,
    currentPrice: number
  ): RiskCheckResult {

    // CRITICAL: Jeśli już shutdown, nie pozwalaj na restart
    if (this.isShutdown) {
      return {
        action: RiskAction.HALT,
        reason: 'Bot already shutdown by previous risk trigger',
        severity: 'critical'
      };
    }

    // Update high water mark
    if (currentEquity > this.highWaterMark) {
      this.highWaterMark = currentEquity;
    }

    // === 1. EMERGENCY LIQUIDATION (5% loss from high water mark) ===
    if (this.config.emergencyLiquidateThreshold) {
      const drawdownFromPeak = (this.highWaterMark - currentEquity) / this.highWaterMark;
      if (drawdownFromPeak >= this.config.emergencyLiquidateThreshold) {
        this.isShutdown = true;
        return {
          action: RiskAction.EMERGENCY_LIQUIDATE,
          reason: `🚨 EMERGENCY: Drawdown from peak ${(drawdownFromPeak * 100).toFixed(2)}% exceeded ${(this.config.emergencyLiquidateThreshold * 100).toFixed(1)}% threshold. LIQUIDATING ALL POSITIONS.`,
          severity: 'critical',
          currentDrawdown: drawdownFromPeak
        };
      }
    }

    // === 2. HARD STOP: Daily Drawdown Limit ===
    const drawdown = (this.initialEquity - currentEquity) / this.initialEquity;

    if (drawdown >= this.config.maxDailyDrawdownPct) {
      this.isShutdown = true;
      return {
        action: RiskAction.HALT,
        reason: `🛑 CRITICAL: Max daily drawdown reached! Lost ${(drawdown * 100).toFixed(2)}% (limit: ${(this.config.maxDailyDrawdownPct * 100).toFixed(1)}%). Session equity: $${this.initialEquity.toFixed(2)} → $${currentEquity.toFixed(2)}`,
        severity: 'critical',
        currentDrawdown: drawdown
      };
    }

    // === 3. CRASH PROTECTION: Hard Price Stop ===
    if (this.config.hardStopPrice && currentPrice < this.config.hardStopPrice) {
      this.isShutdown = true;
      return {
        action: RiskAction.HALT,
        reason: `🛑 CRITICAL: Price $${currentPrice.toFixed(2)} below hard stop level $${this.config.hardStopPrice.toFixed(2)}. Market crash detected.`,
        severity: 'critical'
      };
    }

    // === 4. INVENTORY LIMIT: Reduce Only Mode ===
    // Jeśli masz więcej niż X% kapitału w krypto → przestań kupować
    const inventoryRatio = currentEquity > 0 ? inventoryValue / currentEquity : 0;

    if (inventoryRatio > this.config.maxInventoryPct) {
      return {
        action: RiskAction.REDUCE_ONLY,
        reason: `⚠️ Inventory too heavy: ${(inventoryRatio * 100).toFixed(1)}% of equity (limit: ${(this.config.maxInventoryPct * 100).toFixed(0)}%). Switching to REDUCE_ONLY mode (sells only).`,
        severity: 'warning',
        inventoryRatio
      };
    }

    // === 5. WARNING: Approaching Limits ===
    const drawdownWarningThreshold = this.config.maxDailyDrawdownPct * 0.7; // 70% of limit
    if (drawdown >= drawdownWarningThreshold) {
      return {
        action: RiskAction.CONTINUE,
        reason: `⚠️ WARNING: Approaching daily loss limit. Current: ${(drawdown * 100).toFixed(2)}%, Limit: ${(this.config.maxDailyDrawdownPct * 100).toFixed(1)}%`,
        severity: 'warning',
        currentDrawdown: drawdown
      };
    }

    const inventoryWarningThreshold = this.config.maxInventoryPct * 0.8; // 80% of limit
    if (inventoryRatio >= inventoryWarningThreshold) {
      return {
        action: RiskAction.CONTINUE,
        reason: `⚠️ WARNING: Inventory approaching limit. Current: ${(inventoryRatio * 100).toFixed(1)}%, Limit: ${(this.config.maxInventoryPct * 100).toFixed(0)}%`,
        severity: 'warning',
        inventoryRatio
      };
    }

    // === 6. ALL CLEAR ===
    return {
      action: RiskAction.CONTINUE,
      reason: `✅ Risk check passed. Drawdown: ${(drawdown * 100).toFixed(2)}%, Inventory: ${(inventoryRatio * 100).toFixed(1)}%`,
      severity: 'info',
      inventoryRatio,
      currentDrawdown: drawdown
    };
  }

  /**
   * Reset daily counters (wywołaj o północy lub na początku sesji)
   */
  public resetDailyCounters(currentEquity: number): void {
    this.initialEquity = currentEquity;
    this.highWaterMark = currentEquity;
    this.isShutdown = false;
    this.sessionStartTime = Date.now();
    console.log(`[RISK_MANAGER] Daily reset. New baseline: $${currentEquity.toFixed(2)}`);
  }

  /**
   * Sprawdź czy bot jest w shutdown mode
   */
  public isHalted(): boolean {
    return this.isShutdown;
  }

  /**
   * Force shutdown (emergency override)
   */
  public forceShutdown(reason: string): void {
    this.isShutdown = true;
    console.error(`[RISK_MANAGER] FORCE SHUTDOWN: ${reason}`);
  }

  /**
   * Get current session stats
   */
  public getSessionStats(currentEquity: number): {
    sessionDurationMin: number;
    initialEquity: number;
    currentEquity: number;
    pnlUsd: number;
    pnlPct: number;
    highWaterMark: number;
    maxDrawdownPct: number;
  } {
    const sessionDurationMin = (Date.now() - this.sessionStartTime) / 60000;
    const pnlUsd = currentEquity - this.initialEquity;
    const pnlPct = (pnlUsd / this.initialEquity) * 100;
    const maxDrawdownPct = ((this.highWaterMark - currentEquity) / this.highWaterMark) * 100;

    return {
      sessionDurationMin,
      initialEquity: this.initialEquity,
      currentEquity,
      pnlUsd,
      pnlPct,
      highWaterMark: this.highWaterMark,
      maxDrawdownPct
    };
  }
}

/**
 * Helper: Create default risk config for conservative MM bot
 */
export function createConservativeRiskConfig(): RiskConfig {
  return {
    maxDailyDrawdownPct: 0.03,  // 3% daily loss = stop
    maxInventoryPct: 0.30,      // 30% in crypto = reduce only (ZMNIEJSZONE z 60%)
    emergencyLiquidateThreshold: 0.05 // 5% loss from peak = liquidate
  };
}

/**
 * Helper: Create aggressive risk config (for testing or high-risk appetite)
 */
export function createAggressiveRiskConfig(): RiskConfig {
  return {
    maxDailyDrawdownPct: 0.05,  // 5% daily loss
    maxInventoryPct: 0.75,      // 75% in crypto
    emergencyLiquidateThreshold: 0.08 // 8% loss from peak
  };
}
