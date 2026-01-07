/**
 * Shadow Watch - Wykrywanie Trendu Bocznego (Sideways/Ranging Market)
 *
 * Market Maker zarabia w trendzie bocznym, traci w trendzie kierunkowym.
 * Ten moduł wykrywa kiedy rynek jest w "Golden Zone" (sideways) i sugeruje
 * agresywniejsze parametry tradingu.
 *
 * Wykrywa 3 reżimy rynkowe:
 * 1. SIDEWAYS - Cena oscyluje w wąskim zakresie (✅ IDEAL dla MM)
 * 2. TRENDING - Wyraźny trend w górę lub w dół (⚠️ DANGER dla MM)
 * 3. NEUTRAL - Ani sideways, ani silny trend (⚙️ NORMAL trading)
 */

export enum MarketRegime {
  SIDEWAYS = 'SIDEWAYS',    // Trend boczny - MM zarabia
  TRENDING = 'TRENDING',    // Trend kierunkowy - MM traci
  NEUTRAL = 'NEUTRAL'       // Normalny rynek
}

export interface ShadowWatchResult {
  regime: MarketRegime
  confidence: number        // 0-1, jak pewny jest wykryty reżim
  volatility: number        // Zmienność rynku (0-1)
  rangePercent: number      // Szerokość zakresu cenowego w %

  // Sugerowane modyfikatory dla MM
  suggestedBidMultiplier: number   // 0.8 = węższe spready (aggressive)
  suggestedAskMultiplier: number   // 1.2 = szersze spready (defensive)
  suggestedSizeMultiplier: number  // 1.2 = większe zlecenia

  reason: string
}

export interface ShadowWatchConfig {
  sidewaysThreshold: number     // np. 0.003 (0.3%) - max zmiana ceny dla sideways
  trendingThreshold: number     // np. 0.015 (1.5%) - min zmiana ceny dla trendu
  lookbackPeriod: number        // np. 15 - ile minut analizować
  minDataPoints: number         // np. 10 - minimalna ilość próbek
}

export class ShadowWatch {
  private priceHistory: Array<{ price: number; timestamp: number }> = []
  private config: ShadowWatchConfig

  constructor(config?: Partial<ShadowWatchConfig>) {
    this.config = {
      sidewaysThreshold: 0.003,      // 0.3% - jeśli zmiana mniejsza = sideways
      trendingThreshold: 0.015,      // 1.5% - jeśli zmiana większa = trending
      lookbackPeriod: 15,            // 15 minut
      minDataPoints: 10,             // minimum 10 próbek do analizy
      ...config
    }
  }

  /**
   * Dodaj nową cenę do historii
   */
  public update(price: number): void {
    const now = Date.now()

    this.priceHistory.push({
      price,
      timestamp: now
    })

    // Usuń stare dane (starsze niż lookbackPeriod)
    const cutoffTime = now - this.config.lookbackPeriod * 60 * 1000
    this.priceHistory = this.priceHistory.filter(p => p.timestamp >= cutoffTime)
  }

  /**
   * Analizuj rynek i wykryj reżim
   */
  public analyze(): ShadowWatchResult {
    // Sprawdź czy mamy wystarczająco danych
    if (this.priceHistory.length < this.config.minDataPoints) {
      return this.createNeutralResult('Insufficient data for analysis')
    }

    const prices = this.priceHistory.map(p => p.price)
    const currentPrice = prices[prices.length - 1]
    const oldestPrice = prices[0]

    // 1. Oblicz zmianę ceny w okresie lookback
    const priceChange = (currentPrice - oldestPrice) / oldestPrice
    const priceChangeAbs = Math.abs(priceChange)

    // 2. Oblicz volatility (standardowe odchylenie / średnia)
    const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / prices.length
    const stdDev = Math.sqrt(variance)
    const volatility = stdDev / avgPrice

    // 3. Oblicz range (max-min / avg)
    const maxPrice = Math.max(...prices)
    const minPrice = Math.min(...prices)
    const rangePercent = (maxPrice - minPrice) / avgPrice

    // 4. Wykryj reżim

    // SIDEWAYS: Niska zmiana ceny + niska volatility
    if (priceChangeAbs < this.config.sidewaysThreshold &&
        volatility < this.config.sidewaysThreshold * 1.5) {

      const confidence = 1 - (priceChangeAbs / this.config.sidewaysThreshold)

      return {
        regime: MarketRegime.SIDEWAYS,
        confidence: Math.min(confidence, 0.95),
        volatility,
        rangePercent,

        // 🦀 SIDEWAYS MODE: Agresywne parametry
        suggestedBidMultiplier: 0.8,  // Węże spready (16 BPS zamiast 20)
        suggestedAskMultiplier: 0.8,  // Węże spready po obu stronach
        suggestedSizeMultiplier: 1.2, // Większe zlecenia (bezpieczny rynek)

        reason: `🦀 SIDEWAYS: Price stable (${(priceChangeAbs * 100).toFixed(2)}% in ${this.config.lookbackPeriod}min). Safe to be aggressive.`
      }
    }

    // TRENDING: Wysoka zmiana ceny
    if (priceChangeAbs >= this.config.trendingThreshold) {

      const confidence = Math.min(priceChangeAbs / this.config.trendingThreshold, 1.0)
      const direction = priceChange > 0 ? 'UP' : 'DOWN'

      return {
        regime: MarketRegime.TRENDING,
        confidence,
        volatility,
        rangePercent,

        // 📈/📉 TRENDING MODE: Defensywne parametry
        suggestedBidMultiplier: 1.5,  // Szersze spready (ochrona)
        suggestedAskMultiplier: 1.5,  // Szersze spready
        suggestedSizeMultiplier: 0.7, // Mniejsze zlecenia (ryzyko)

        reason: `📈 TRENDING ${direction}: Price moved ${(priceChangeAbs * 100).toFixed(2)}% in ${this.config.lookbackPeriod}min. Reduce exposure.`
      }
    }

    // NEUTRAL: Ani sideways, ani trending
    const confidence = 0.5

    return {
      regime: MarketRegime.NEUTRAL,
      confidence,
      volatility,
      rangePercent,

      // ⚙️ NEUTRAL MODE: Standardowe parametry
      suggestedBidMultiplier: 1.0,
      suggestedAskMultiplier: 1.0,
      suggestedSizeMultiplier: 1.0,

      reason: `⚙️ NEUTRAL: Normal market conditions. Price change ${(priceChangeAbs * 100).toFixed(2)}% in ${this.config.lookbackPeriod}min.`
    }
  }

  /**
   * Helper: Utwórz domyślny wynik NEUTRAL
   */
  private createNeutralResult(reason: string): ShadowWatchResult {
    return {
      regime: MarketRegime.NEUTRAL,
      confidence: 0,
      volatility: 0,
      rangePercent: 0,
      suggestedBidMultiplier: 1.0,
      suggestedAskMultiplier: 1.0,
      suggestedSizeMultiplier: 1.0,
      reason
    }
  }

  /**
   * Sprawdź czy jesteśmy w SIDEWAYS (Golden Zone dla MM)
   */
  public isSideways(): boolean {
    const result = this.analyze()
    return result.regime === MarketRegime.SIDEWAYS && result.confidence > 0.6
  }

  /**
   * Sprawdź czy jesteśmy w TRENDING (Danger Zone dla MM)
   */
  public isTrending(): boolean {
    const result = this.analyze()
    return result.regime === MarketRegime.TRENDING && result.confidence > 0.6
  }

  /**
   * Wyczyść historię (np. przy zmianie pary)
   */
  public reset(): void {
    this.priceHistory = []
  }

  /**
   * Pobierz aktualną konfigurację
   */
  public getConfig(): ShadowWatchConfig {
    return { ...this.config }
  }

  /**
   * Zaktualizuj konfigurację
   */
  public updateConfig(newConfig: Partial<ShadowWatchConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig
    }
  }

  /**
   * Sprawdź czy mamy wystarczająco danych
   */
  public isReady(): boolean {
    return this.priceHistory.length >= this.config.minDataPoints
  }

  /**
   * Pobierz statystyki historii
   */
  public getStats(): {
    dataPoints: number
    oldestTimestamp: number | null
    newestTimestamp: number | null
    timeRangeMinutes: number
  } {
    if (this.priceHistory.length === 0) {
      return {
        dataPoints: 0,
        oldestTimestamp: null,
        newestTimestamp: null,
        timeRangeMinutes: 0
      }
    }

    const oldest = this.priceHistory[0].timestamp
    const newest = this.priceHistory[this.priceHistory.length - 1].timestamp
    const timeRangeMinutes = (newest - oldest) / 60000

    return {
      dataPoints: this.priceHistory.length,
      oldestTimestamp: oldest,
      newestTimestamp: newest,
      timeRangeMinutes
    }
  }
}

/**
 * Helper: Utwórz Shadow Watch z domyślną konfiguracją
 */
export function createDefaultShadowWatch(): ShadowWatch {
  return new ShadowWatch({
    sidewaysThreshold: 0.003,   // 0.3% - bardzo wąski zakres
    trendingThreshold: 0.015,   // 1.5% - wyraźny trend
    lookbackPeriod: 15,         // 15 minut analizy
    minDataPoints: 10           // minimum 10 próbek
  })
}

/**
 * Helper: Utwórz Shadow Watch z konfiguracją AGGRESSIVE (dla scalperów)
 */
export function createAggressiveShadowWatch(): ShadowWatch {
  return new ShadowWatch({
    sidewaysThreshold: 0.002,   // 0.2% - jeszcze węższy zakres
    trendingThreshold: 0.01,    // 1.0% - szybciej wykrywa trendy
    lookbackPeriod: 10,         // 10 minut (szybsza reakcja)
    minDataPoints: 8
  })
}

/**
 * Helper: Utwórz Shadow Watch z konfiguracją CONSERVATIVE (dla bezpieczeństwa)
 */
export function createConservativeShadowWatch(): ShadowWatch {
  return new ShadowWatch({
    sidewaysThreshold: 0.005,   // 0.5% - szerszy zakres
    trendingThreshold: 0.02,    // 2.0% - trudniej wykrywa trendy
    lookbackPeriod: 20,         // 20 minut (wolniejsza reakcja)
    minDataPoints: 15
  })
}
