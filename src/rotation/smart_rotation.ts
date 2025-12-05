export type NansenBias = 'bull' | 'bear' | 'neutral' | 'unknown'
export type NansenWhaleRisk = 'low' | 'medium' | 'high' | 'unknown'

export interface PairAnalysisLite {
  symbol: string
  trendScore: number      // 0..1 – price action / vision trend
  volumeScore: number     // 0..1 – relative volume / activity
  riskScore: number       // 0..1 – 0 = safe, 1 = very risky

  // Optional Nansen inputs – jeśli brak, są ignorowane
  nansenBias?: NansenBias             // bull / bear / neutral / unknown
  nansenScore?: number                // 0..100 – Smart Money / netflow score
  nansenWhaleRisk?: NansenWhaleRisk   // low / medium / high / unknown
}

export interface RankedPair extends PairAnalysisLite {
  score: number
}

/**
 * SmartRotationEngine – bierze lekkie analizy par (PairAnalysisLite)
 * i zwraca posortowaną listę z polem `score`, przycinając do maxActive.
 *
 * Konstruktor przyjmuje dowolne argumenty (..._args), żeby nie psuć
 * istniejących wywołań typu `new SmartRotationEngine(config, notifier...)`.
 */
export class SmartRotationEngine {
  // Akceptujemy dowolny podpis konstruktora dla pełnej kompatybilności runtime
  constructor(..._args: any[]) {}

  /**
   * Rankuje pary i zwraca TOP `maxActive` z najwyższym wynikiem.
   */
  rankPairs(pairs: PairAnalysisLite[], maxActive: number): RankedPair[] {
    if (!pairs || pairs.length === 0 || maxActive <= 0) {
      return []
    }

    const ranked: RankedPair[] = pairs.map((p) => {
      const trend = this.clamp01(p.trendScore)
      const vol = this.clamp01(p.volumeScore)
      const risk = this.clamp01(p.riskScore)

      let score = 0

      // ── core: trend + volume + (1 - risk) ───────────────────────────────
      score += trend * 0.4
      score += vol * 0.3
      score += (1 - risk) * 0.3

      // ── Nansen bias (kierunek Smart Money) ──────────────────────────────
      const bias = p.nansenBias ?? 'unknown'
      if (bias === 'bull') {
        score += 0.25
      } else if (bias === 'bear') {
        score -= 0.35
      }

      // ── Nansen numeric score 0–100 (np. Smart Money Score / netflow) ────
      if (typeof p.nansenScore === 'number' && Number.isFinite(p.nansenScore)) {
        const ns = Math.max(0, Math.min(100, p.nansenScore))
        // mocny, ale nie dominuje całości
        score += (ns / 100) * 0.4
      }

      // ── Whale risk – aktywnie unikaj pomp & zrzutów ─────────────────────
      const whale = p.nansenWhaleRisk ?? 'unknown'
      if (whale === 'high') {
        score -= 0.8   // praktycznie „prawie hard ban”
      } else if (whale === 'medium') {
        score -= 0.3
      }

      return { ...p, score }
    })

    // Sortujemy malejąco po score i przycinamy do maxActive
    ranked.sort((a, b) => b.score - a.score)
    return ranked.slice(0, maxActive)
  }

  private clamp01(x: number | undefined): number {
    const v = Number(x)
    if (!Number.isFinite(v)) return 0
    if (v < 0) return 0
    if (v > 1) return 1
    return v
  }
}
