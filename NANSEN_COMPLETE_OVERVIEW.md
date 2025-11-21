# 🧠 Nansen - Kompletny Przegląd Wszystkich Komponentów

## 📁 **Struktura Plików**

### **1. Kod Źródłowy (TypeScript)**

#### **`src/nansenBias.ts`** - Główny Serwis
**Funkcjonalność:** Nansen Bias Service - filtr/bias engine dla MM bota
- `NansenBiasService` - główna klasa
- `refreshForSymbols()` - pobiera sygnały dla listy symboli
- `getSignal()` - zwraca sygnał dla symbolu
- `getRotationCandidates()` - filtruje i sortuje pary do rotacji
- `isTokenToxic()` - sprawdza czy token jest toksyczny
- `computeRiskLevel()` - progi ryzyka dla ZEC/UNI/VIRTUAL
- `computeRotationScore()` - scoring 0-100 z boostami

**Kluczowe funkcje:**
- Risk Level: `'ok' | 'caution' | 'avoid'`
- Rotation Score: 0-100 (z boostami: UNI +5, VIRTUAL +8, ZEC cap 25)
- Progi per token (ZEC/UNI/VIRTUAL)

---

#### **`src/integrations/nansen_pro.ts`** - Nansen Pro API
**Funkcjonalność:** Integracja z Nansen Pro API
- `getNansenProAPI()` - główna funkcja
- `getSmartMoneyNetflows()` - smart money netflows
- `getFlowIntelligence()` - flow intelligence (exchange flows, fresh wallets)
- `analyzeTokenRisk()` - analiza ryzyka tokena (holder concentration)
- `NansenFlowIntelligence` - interface dla danych flow

**Endpoints:**
- `/tgm/flow-intelligence` - flow intelligence
- `/tgm/holders` - holder concentration
- `/smart-money/netflows` - smart money netflows (fallback)

---

#### **`src/integrations/nansen_scoring.ts`** - Nansen Scoring
**Funkcjonalność:** Scoring tokenów z Nansen dla Hyperliquid
- `getNansenHyperliquidAPI()` - główna funkcja
- `getPerpScreener()` - perp screener dla Hyperliquid
- `NansenHyperliquidToken` - interface dla danych tokena

**Dane:**
- `trader_count` - liczba traderów
- `volume_24h` - volume 24h
- `liquidity` - płynność
- `smart_money_netflow` - smart money netflow

---

#### **`src/signals/nansen_adapter.ts`** - Adapter Sygnałów
**Funkcjonalność:** Adapter między Nansen API a systemem sygnałów bota

---

### **2. Integracja w Głównym Bocie**

#### **`src/mm_hl.ts`** - Integracja Nansen
**Główne funkcje:**
- `checkNansenConflictStopLoss()` - Nansen Conflict Stop Loss
- `calculateConflictSeverity()` - oblicza severity 0-10
- `trackBiasForPosition()` - wykrywa bias flips
- `shouldExecuteClose()` - cost-benefit check
- `enforcePerPairRisk()` - hook do Nansen risk levels (soft SL)
- `getNansenBiasForPair()` - pobiera bias dla pary
- `checkNansenConflicts()` - globalna funkcja sprawdzająca konflikty

**Zmienne klasowe:**
- `nansenBias: NansenBiasService` - instancja serwisu
- `nansenBiasCache` - cache dla bias danych
- `nansenConflictCooldownUntil: Map<string, number>` - cooldowny
- `nansenConflictClosingInProgress: Set<string>` - flagi zamykania
- `nansenConflictStats: Map<string, {...}>` - statystyki
- `positionBiasHistory: Map<string, {...}>` - historia bias dla pozycji

---

### **3. Dokumentacja**

#### **Główne Dokumenty:**

1. **`NANSEN_BIAS_SYSTEM_COMPLETE.md`** - Kompletna dokumentacja systemu
   - Jakie dane bierzemy z Nansena
   - Dokładne progi ryzyka (ZEC/UNI/VIRTUAL)
   - Jak działa computeRotationScore()
   - Soft SL hook
   - Macierz decyzji
   - Przykłady rotacji

2. **`NANSEN_SL_SUMMARY.md`** - Podsumowanie Nansen Stop Loss
   - 5 zaawansowanych funkcji
   - Integracja z soft SL
   - Ulepszenia bezpieczeństwa

3. **`NANSEN_ADVANCED_FEATURES.md`** - Zaawansowane funkcje
   - Conflict Severity Score
   - Tiered Close
   - Cost-Benefit Check
   - Bias Flip Detection
   - Partial Close Support

4. **`NANSEN_CONFLICT_IMPROVEMENTS.md`** - Ulepszenia bezpieczeństwa
   - placeOrder → closePositionForPair
   - Weryfikacja zamknięcia
   - Retry logic
   - Cooldown

5. **`NANSEN_CONFLICT_ANALYSIS.md`** - Analiza trigger logic
   - Co powoduje konflikt
   - Jak działa trigger
   - Przykłady

6. **`NANSEN_LOGIC_VERIFICATION.md`** - Weryfikacja logiki
   - Sprawdzenie danych
   - Per-token rules
   - Fallback mechanism

---

### **4. Konfiguracja (.env)**

```bash
# Nansen Smart Money Integration
NANSEN_API_KEY=URDtas8ung2gOI3QToDmPuHQP6VaWb5U
NANSEN_ENABLED=true
NANSEN_WEIGHT=0.35

# Nansen Bias Service (Filter/Bias Engine)
NANSEN_ENABLED=true
NANSEN_MIN_FRESH_WALLET_SCORE_FOR_ROTATION=50
NANSEN_MIN_SMART_FLOW_7D_USD=-1000000
NANSEN_MAX_TOP_HOLDER_SELL_PCT=0.30
NANSEN_BAD_FLOW_24H_USD=-1000000
NANSEN_GOOD_FLOW_24H_USD=1000000
NANSEN_REFRESH_INTERVAL_MS=900000   # 15 minut

# Nansen Conflict Protection
NANSEN_CONFLICT_CHECK_ENABLED=true
NANSEN_STRONG_CONTRA_HARD_CLOSE_USD=10
NANSEN_STRONG_CONTRA_MAX_LOSS_USD=25
NANSEN_STRONG_CONTRA_MAX_HOURS=3
NANSEN_CONFLICT_COOLDOWN_MINUTES=30
NANSEN_CONFLICT_COOLDOWN_MINUTES_SEVERE=60
NANSEN_CONFLICT_SEVERE_THRESHOLD_MULTIPLE=1.5
```

---

### **5. Testy**

#### **Pliki Testowe:**
- `test-nansen.ts` - podstawowy test API
- `test-nansen-pro-api.ts` - test Nansen Pro API
- `test-nansen-api-quick.ts` - szybki test
- `test-nansen-endpoints-debug.ts` - debug endpointów
- `test-nansen-formats.ts` - test formatów danych
- `test-nansen-token-address.ts` - test adresów tokenów
- `test-nansen-simple.ts` - prosty test
- `test-all-nansen-endpoints.ts` - test wszystkich endpointów

---

### **6. Skrypty**

#### **`scripts/nansen_signal_tracker.ts`**
**Funkcjonalność:** Tracking sygnałów Nansen

#### **`scripts/send_nansen_stats_slack.ts`**
**Funkcjonalność:** Wysyłanie statystyk Nansen do Slack

#### **`scripts/nansen_tracking_daemon.sh`**
**Funkcjonalność:** Daemon do trackingu Nansen

---

## 🎯 **Główne Komponenty Systemu**

### **A. Nansen Bias Service (Filtr/Bias Engine)**

**Cel:** Filtrowanie i priorytetyzacja tokenów do rotacji

**Dane wejściowe:**
- Flow Intelligence (smart money flows, exchange flows)
- Holders (top holder concentration, smart money holders)
- Perp Screener (trader count, volume, liquidity)

**Dane wyjściowe:**
- `riskLevel`: `'ok' | 'caution' | 'avoid'`
- `rotationScore`: 0-100

**Progi per token:**
- **ZEC**: avoid jeśli flow7d <= 0 LUB fw < 40; ok tylko gdy flow7d >= +5M
- **UNI**: avoid jeśli flow7d <= -2M LUB sell >= 40%; ok jeśli flow7d >= 0 AND flow24h >= -1M AND fw >= 45
- **VIRTUAL**: avoid jeśli flow7d <= -2M AND fw < 30; ok jeśli flow7d >= +2M AND flow24h >= -1M AND fw >= 50

---

### **B. Nansen Conflict Stop Loss**

**Cel:** Zamykanie pozycji przeciwko silnemu Nansen bias

**Funkcje:**
1. **Conflict Severity Score (0-10)**
   - Base conflict: +3
   - Bias strength: +0.5-5
   - Loss percentage: +2-3
   - Breach multiple: +1-2
   - Bias flip: +2/+3

2. **Tiered Close**
   - HIGH (≥8): 100% close, 60min cooldown
   - MEDIUM (≥5): 60% close, 45min cooldown
   - LOW (≥3): 30% close, 30min cooldown

3. **Cost-Benefit Check**
   - Skip jeśli position < $200 i close cost > $5
   - Skip jeśli risk/cost ratio < 2x
   - Force close jeśli severity ≥ 8

4. **Bias Flip Detection**
   - Wykrywa zmiany bias (long ↔ short)
   - Zwiększa severity o +2/+3

5. **Partial Close Support**
   - Obsługa zamknięć częściowych (30%, 60%, 100%)

---

### **C. Integracja z Soft SL**

**Hook w `enforcePerPairRisk()`:**
```typescript
if (signal.riskLevel === 'avoid') {
  maxLoss = maxLoss * 0.6  // 60% dla avoid
} else if (signal.riskLevel === 'caution') {
  maxLoss = maxLoss * 0.8  // 80% dla caution
}
// 'ok' → pełny limit (100%)
```

**Efekt:**
- **ZEC** (często avoid): maxLoss = 120 × 0.6 = **72 USD**
- **UNI/VIRTUAL** (często ok): maxLoss = 170 × 1.0 = **170 USD**

---

### **D. Integracja z Rotacją**

**W `rotateIfNeeded()`:**
1. Volatility rotation → top pairs
2. Nansen refresh → `refreshForSymbols()`
3. Nansen filtering → `getRotationCandidates()` (filtruje avoid, sortuje po score)
4. Final rotation → top 3 po Nansen score

**Efekt:**
- ZEC wykluczony z rotacji (risk=avoid, score=0)
- UNI/VIRTUAL priorytetyzowane (boosty +5/+8)

---

## 📊 **Przepływ Danych**

```
1. Volatility Rotation
   ↓
2. Nansen Refresh (nansenBias.refreshForSymbols())
   ├─→ getFlowIntelligence() (nansen_pro.ts)
   ├─→ analyzeTokenRisk() (nansen_pro.ts)
   └─→ getPerpScreener() (nansen_scoring.ts)
   ↓
3. Compute Risk Level (computeRiskLevel())
   ├─→ ZEC: avoid/caution/ok
   ├─→ UNI: avoid/caution/ok
   └─→ VIRTUAL: avoid/caution/ok
   ↓
4. Compute Rotation Score (computeRotationScore())
   ├─→ Bazowy score (0-70)
   ├─→ Cap po riskLevel
   └─→ Per-token boosty
   ↓
5. Filter & Sort (getRotationCandidates())
   ├─→ Filtruje avoid (score=0)
   └─→ Sortuje po rotationScore DESC
   ↓
6. Final Rotation (top 3)
   ↓
7. Soft SL Hook (enforcePerPairRisk())
   └─→ Adjust maxLoss based on riskLevel
   ↓
8. Nansen Conflict Check (checkNansenConflictStopLoss())
   ├─→ Calculate severity
   ├─→ Cost-benefit check
   ├─→ Bias flip detection
   └─→ Tiered close
```

---

## 🔍 **Kluczowe Funkcje w Kodzie**

### **`src/nansenBias.ts`**

```typescript
class NansenBiasService {
  // Główne metody
  async refreshForSymbols(symbols: string[]): Promise<Map<string, NansenTokenSignal>>
  getSignal(symbol: string): NansenTokenSignal | undefined
  getRotationCandidates(allSymbols: string[]): string[]
  isTokenToxic(symbol: string): boolean
  
  // Prywatne metody
  private async fetchSignalForSymbol(symbol: string): Promise<NansenTokenSignal>
  private computeRiskLevel(m: NansenMetrics): NansenRiskLevel
  private computeRotationScore(m: NansenMetrics, risk: NansenRiskLevel): number
}
```

### **`src/mm_hl.ts`**

```typescript
class HyperliquidMMBot {
  // Nansen Bias Service
  private nansenBias: NansenBiasService
  
  // Nansen Conflict Stop Loss
  private async checkNansenConflictStopLoss(...): Promise<{action, severity, percent, reason, cooldown} | null>
  private calculateConflictSeverity(...): number
  private trackBiasForPosition(...): {isFlip, flipCount, ...}
  private shouldExecuteClose(...): boolean
  
  // Integracja
  private getNansenBiasForPair(pair: string): NansenBias
  private async enforcePerPairRisk(pair: string, unrealizedPnlUsd: number): Promise<boolean>
  private async checkNansenConflicts(): Promise<void>
}
```

---

## 📈 **Statystyki Implementacji**

### **Pliki Kodu:**
- `src/nansenBias.ts` - 526 linii
- `src/integrations/nansen_pro.ts` - ~300 linii
- `src/integrations/nansen_scoring.ts` - ~200 linii
- `src/mm_hl.ts` - integracja Nansen: ~500 linii

### **Dokumentacja:**
- 22 pliki markdown
- ~5000+ linii dokumentacji

### **Testy:**
- 8 plików testowych
- Pokrycie: API endpoints, formaty danych, adresy tokenów

---

## ✅ **Status Implementacji**

### **Gotowe:**
- ✅ Nansen Bias Service (filtr/bias engine)
- ✅ Nansen Conflict Stop Loss (5 zaawansowanych funkcji)
- ✅ Integracja z soft SL (mnożniki risk level)
- ✅ Integracja z rotacją (filtrowanie i sortowanie)
- ✅ Ulepszenia bezpieczeństwa (retry, cooldown, weryfikacja)
- ✅ Dokumentacja (kompletna)

### **W Użyciu:**
- ✅ Progi ryzyka dla ZEC/UNI/VIRTUAL
- ✅ Rotation Score z boostami
- ✅ Soft SL hook
- ✅ Conflict Stop Loss z tiered close

---

## 🎯 **Podsumowanie**

**Nansen w tym bocie to:**
1. **Filtr/Bias Engine** - nie kierownica bota, tylko dodatkowa warstwa
2. **Conflict Stop Loss** - zamyka pozycje przeciwko silnemu bias
3. **Soft SL Adjustment** - zaostrza soft SL dla toksycznych tokenów
4. **Rotation Filtering** - wyklucza toksyczne tokeny z rotacji

**Efekt:**
- ZEC wykluczony z rotacji (risk=avoid, score=0)
- UNI/VIRTUAL priorytetyzowane (boosty +5/+8)
- Soft SL dostosowany do risk level (ZEC: 72-96 USD, UNI/VIRTUAL: 102-170 USD)
- Conflict Stop Loss chroni przed dużymi stratami

**Gotowe do produkcji!** 🚀

