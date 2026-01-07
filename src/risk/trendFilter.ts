/**
 * Trend Filter (EMA 200) - Ochrona przed tradingiem przeciwko trendowi
 *
 * Market Maker NIE MOŻE grać Longów, gdy cena jest poniżej EMA 200 (downtrend)
 *
 * Przykład użycia:
 * ```
 * const trendFilter = new TrendFilter();
 * trendFilter.update(currentPrice);
 *
 * if (trendFilter.isBelowEMA200()) {
 *   console.log('⚠️ DOWNTREND - Block Long positions');
 *   // Nie otwieraj nowych Longów
 * }
 * ```
 */

export interface TrendFilterResult {
  currentPrice: number
  ema200: number | null
  isBelowEMA: boolean
  reason: string
}

export class TrendFilter {
  private prices: number[] = []
  private ema200: number | null = null
  private readonly EMA_PERIOD = 200
  private readonly SMOOTHING = 2

  /**
   * Dodaj nową cenę do historii i przelicz EMA 200
   */
  public update(price: number): void {
    this.prices.push(price)

    // Utrzymuj tylko ostatnie 200+ cen (dla dokładności EMA)
    if (this.prices.length > this.EMA_PERIOD + 50) {
      this.prices.shift()
    }

    // Oblicz EMA 200 jeśli mamy wystarczająco dużo danych
    if (this.prices.length >= this.EMA_PERIOD) {
      this.ema200 = this.calculateEMA(this.prices, this.EMA_PERIOD)
    }
  }

  /**
   * Sprawdź czy cena jest poniżej EMA 200 (downtrend)
   */
  public isBelowEMA200(): boolean {
    if (this.ema200 === null || this.prices.length === 0) {
      return false // Jeśli nie ma jeszcze EMA, nie blokuj
    }

    const currentPrice = this.prices[this.prices.length - 1]
    return currentPrice < this.ema200
  }

  /**
   * Zwróć szczegółowy status trendu
   */
  public getTrendStatus(): TrendFilterResult {
    const currentPrice = this.prices.length > 0 ? this.prices[this.prices.length - 1] : 0
    const isBelowEMA = this.isBelowEMA200()

    let reason = ''
    if (this.ema200 === null) {
      reason = 'EMA 200 not ready (need more data)'
    } else if (isBelowEMA) {
      reason = `⚠️ DOWNTREND: Price $${currentPrice.toFixed(2)} < EMA200 $${this.ema200.toFixed(2)} - BLOCK LONGS`
    } else {
      reason = `✅ UPTREND: Price $${currentPrice.toFixed(2)} > EMA200 $${this.ema200.toFixed(2)} - Longs allowed`
    }

    return {
      currentPrice,
      ema200: this.ema200,
      isBelowEMA,
      reason
    }
  }

  /**
   * Oblicz Exponential Moving Average (EMA)
   *
   * Formula:
   * EMA(t) = Price(t) * k + EMA(t-1) * (1 - k)
   * gdzie k = 2 / (period + 1)
   */
  private calculateEMA(data: number[], period: number): number {
    if (data.length < period) {
      return 0
    }

    // Krok 1: Oblicz SMA dla pierwszych `period` wartości
    const firstValues = data.slice(0, period)
    let sma = firstValues.reduce((sum, val) => sum + val, 0) / period

    // Krok 2: Zastosuj EMA dla pozostałych wartości
    const multiplier = this.SMOOTHING / (period + 1)
    let ema = sma

    for (let i = period; i < data.length; i++) {
      ema = data[i] * multiplier + ema * (1 - multiplier)
    }

    return ema
  }

  /**
   * Reset historii (np. przy zmianie pary tradingowej)
   */
  public reset(): void {
    this.prices = []
    this.ema200 = null
  }

  /**
   * Zwróć aktualną wartość EMA 200
   */
  public getEMA200(): number | null {
    return this.ema200
  }

  /**
   * Sprawdź czy EMA jest gotowa (czy mamy wystarczająco danych)
   */
  public isReady(): boolean {
    return this.ema200 !== null
  }
}

/**
 * Helper: Szybka inicjalizacja z historycznymi cenami
 */
export function createTrendFilterWithHistory(historicalPrices: number[]): TrendFilter {
  const filter = new TrendFilter()

  for (const price of historicalPrices) {
    filter.update(price)
  }

  return filter
}
