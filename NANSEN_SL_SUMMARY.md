# 🛡️ Nansen Stop Loss - Podsumowanie Wczorajszych Zmian

## 📋 **Co Zostało Zrobione**

### **1. Nansen Conflict Stop Loss - Zaawansowane Funkcje**

#### ✅ **Conflict Severity Score (0-10)**
**Funkcja:** `calculateConflictSeverity()`
- Base conflict: +3
- Bias strength: +0.5-5 (zależnie od boost)
- Loss percentage: +2-3 (zależnie od % straty)
- Breach multiple: +1-2 (jak daleko przekroczył threshold)
- **Bias flip detection: +2 (flip) / +3 (multiple flips)**

**Efekt:** System ocenia konflikt na skali 0-10, co pozwala na różne reakcje w zależności od zagrożenia.

---

#### ✅ **Tiered Close (High/Medium/Low)**
**Funkcja:** `checkNansenConflictStopLoss()` zwraca decision object

| Severity | Akcja | Cooldown |
|----------|-------|----------|
| **HIGH (≥8)** | Full close 100% | 60 min |
| **MEDIUM (≥5)** | Partial close 60% | 45 min |
| **LOW (≥3)** | Reduce exposure 30% | 30 min |

**Efekt:** Nie wszystkie konflikty wymagają pełnego zamknięcia - system dostosowuje reakcję do poziomu zagrożenia.

---

#### ✅ **Cost-Benefit Check**
**Funkcja:** `shouldExecuteClose()`
- Oblicza close cost (slippage 0.2% + fees 0.05%)
- Oblicza potential risk (bias points × 1% per point)
- **Skip** jeśli position < $200 i close cost > $5
- **Skip** jeśli risk/cost ratio < 2x
- **Force close** jeśli severity ≥ 8 (ignoruje cost)

**Efekt:** System nie zamyka małych pozycji, jeśli koszt zamknięcia jest wyższy niż potencjalna strata.

---

#### ✅ **Bias Flip Detection**
**Funkcja:** `trackBiasForPosition()`
- Trackuje historię bias dla każdej pozycji
- Wykrywa flips (long → short lub short → long)
- Zwiększa severity o +2 dla flip, +3 dla multiple flips
- Automatycznie czyści tracking po full close

**Efekt:** System wykrywa niestabilność rynku (bias się zmienia) i reaguje ostrzej.

---

#### ✅ **Partial Close Support**
**Funkcja:** `closePositionForPair()` z parametrem `percent`
- Obsługuje partial close (30%, 60%, 100%)
- Automatycznie oblicza `closeSize = size × (percent / 100)`
- Działa z reduce-only orders

**Efekt:** Możliwość stopniowego zmniejszania ekspozycji zamiast pełnego zamknięcia.

---

### **2. Nansen Bias Service - Filtr/Bias Engine**

#### ✅ **Nowy Plik:** `src/nansenBias.ts`
**Funkcjonalność:**
- `NansenBiasService` - główna klasa
- `refreshForSymbols()` - pobiera sygnały dla listy symboli
- `getSignal()` - zwraca sygnał dla symbolu
- `getRotationCandidates()` - filtruje i sortuje pary do rotacji
- `isTokenToxic()` - sprawdza czy token jest toksyczny

**Progi ryzyka:**
- **ZEC**: avoid jeśli flow7d <= 0 LUB fw < 40; ok tylko gdy flow7d >= +5M
- **UNI**: avoid jeśli flow7d <= -2M LUB sell >= 40%; ok jeśli flow7d >= 0 AND flow24h >= -1M AND fw >= 45
- **VIRTUAL**: avoid jeśli flow7d <= -2M AND fw < 30; ok jeśli flow7d >= +2M AND flow24h >= -1M AND fw >= 50

**Rotation Score:**
- Bazowy score (0-70) z 4 metryk
- Cap po riskLevel (caution → max 35, avoid → 0)
- Per-token boosty (UNI +5, VIRTUAL +8, ZEC cap 25)

---

### **3. Integracja z Soft SL**

#### ✅ **Hook w `enforcePerPairRisk()`**
```typescript
// 🧠 Nansen hook: adjust soft SL based on risk level
if (this.nansenBias && this.nansenBias.isEnabled()) {
  const signal = this.nansenBias.getSignal(upper)
  if (signal) {
    if (signal.riskLevel === 'avoid') {
      maxLoss = maxLoss * 0.6  // 60% dla avoid (ostrzejsze)
    } else if (signal.riskLevel === 'caution') {
      maxLoss = maxLoss * 0.8  // 80% dla caution
    }
    // 'ok' → pełny limit (bez zmian)
  }
}
```

**Efekt:**
- **ZEC** (często avoid): maxLoss = 120 × 0.6 = **72 USD** (bardzo ciasny)
- **UNI/VIRTUAL** (często ok): maxLoss = 170 × 1.0 = **170 USD** (normalny oddech)

---

### **4. Ulepszenia Bezpieczeństwa**

#### ✅ **Zmiana `placeOrder` na `closePositionForPair`**
- **Problem:** `placeOrder` może nie być reduce-only
- **Rozwiązanie:** Używa `closePositionForPair` z reason="nansen_conflict" (reduce-only, bezpieczniejsze)

#### ✅ **Weryfikacja zamknięcia pozycji**
- Po `closePositionForPair` czeka 2s
- Sprawdza czy pozycja faktycznie została zamknięta
- Jeśli nie → retry

#### ✅ **Retry logic z exponential backoff**
- 3 próby zamknięcia
- Exponential backoff: 1s, 2s, 3s
- Weryfikacja po każdej próbie

#### ✅ **Cooldown po Nansen conflict close**
- Po udanym zamknięciu ustawia cooldown (domyślnie 30 min)
- W `checkNansenConflictStopLoss` sprawdza cooldown przed sprawdzaniem conflict
- Jeśli w cooldownie → skip conflict check

#### ✅ **Zapobieganie duplicate close attempts**
- Flaga `nansenConflictClosingInProgress` zapobiega wielokrotnym próbom
- Sprawdza czy pozycja jest już w trakcie zamykania

#### ✅ **Slack alerts**
- Alert po udanym zamknięciu
- Critical alert jeśli zamknięcie się nie powiedzie po 3 próbach

---

## 📊 **Przykładowe Logi**

### **Bias Flip Detection:**
```
🔄 [BIAS FLIP] ZEC: LONG → SHORT (flip #1)
```

### **Cost-Benefit Check:**
```
[COST-BENEFIT] ZEC: Approved - Risk $62.50 > 2x cost $3.11
```

### **Tiered Close:**
```
🛑 [NANSEN CONFLICT] Closing 60% on ZEC - MEDIUM severity (7.2/10): Bias -5.00, uPnL -21.50 | BIAS FLIP #1
```

### **Enhanced Logging:**
```
✅ ZEC position closed successfully after Nansen conflict SL | close_price=45.2340 | actual_pnl=-21.50 | close_cost=0.45 | duration=2h 15min
```

### **Cooldown:**
```
⏸ ZEC in Nansen conflict cooldown (MEDIUM) for 45 minutes
```

---

## 🎯 **Główne Pliki Zmodyfikowane**

1. **`src/mm_hl.ts`**
   - `checkNansenConflictStopLoss()` - zwraca decision object zamiast boolean
   - `calculateConflictSeverity()` - oblicza severity 0-10
   - `trackBiasForPosition()` - wykrywa bias flips
   - `shouldExecuteClose()` - cost-benefit check
   - `enforcePerPairRisk()` - hook do Nansen risk levels
   - `closePositionForPair()` - obsługa partial close

2. **`src/nansenBias.ts`** (NOWY PLIK)
   - `NansenBiasService` - główna klasa
   - `computeRiskLevel()` - progi ryzyka dla ZEC/UNI/VIRTUAL
   - `computeRotationScore()` - scoring 0-100 z boostami

3. **Dokumentacja:**
   - `NANSEN_ADVANCED_FEATURES.md` - opis 5 głównych funkcji
   - `NANSEN_CONFLICT_IMPROVEMENTS.md` - ulepszenia bezpieczeństwa
   - `NANSEN_BIAS_SYSTEM_COMPLETE.md` - kompletna dokumentacja systemu
   - `NANSEN_CONFLICT_ANALYSIS.md` - analiza trigger logic

---

## ✅ **Status Implementacji**

### **Zaawansowane Funkcje:**
- ✅ Conflict Severity Score (0-10)
- ✅ Tiered Close (High/Medium/Low)
- ✅ Cost-Benefit Check
- ✅ Bias Flip Detection
- ✅ Partial Close Support

### **Ulepszenia Bezpieczeństwa:**
- ✅ placeOrder → closePositionForPair
- ✅ Weryfikacja zamknięcia
- ✅ Retry logic z exponential backoff
- ✅ Cooldown po conflict close
- ✅ Zapobieganie duplicate close
- ✅ Slack alerts

### **Integracja:**
- ✅ Nansen Bias Service (filtr/bias engine)
- ✅ Hook do soft SL (mnożniki: avoid=60%, caution=80%, ok=100%)
- ✅ Integracja z rotacją (filtrowanie i sortowanie)

---

## 🚀 **Efekt Końcowy**

**Przed:**
- ZEC mógł uróść do 20k notional
- Soft SL był taki sam dla wszystkich par
- Brak wykrywania bias flips
- Pełne zamknięcia zawsze (nawet dla małych konfliktów)

**Po:**
- ZEC wykluczony z rotacji (risk=avoid, score=0)
- Soft SL dostosowany do risk level (ZEC: 72-96 USD, UNI/VIRTUAL: 102-170 USD)
- Wykrywanie bias flips zwiększa severity
- Tiered close (30%, 60%, 100%) w zależności od severity
- Cost-benefit check zapobiega niepotrzebnym zamknięciom

**Gotowe do produkcji!** 🎉

