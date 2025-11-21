# 🧠 Nansen Bias System - Kompletna Dokumentacja

## 📊 **1. Jakie Dane Bierzemy z Nansena dla Tokenu**

Dla każdego symbolu (np. ZEC, UNI, VIRTUAL) `NansenBiasService` wyciąga:

### **A. Flow Intelligence:**
- `smart_money_flow_usd` (24h) → `smartFlow24hUsd`
- `smartFlow7dUsd = smartFlow24hUsd * 7` (proxy dla 7D)
- `exchange_flow_usd` → część `freshWalletScore`:
  - **Negatywny** (outflow z CEX) = accumulation = bullish → +punkty ✅
  - **Pozytywny** (inflow na CEX) = distribution = bearish → -punkty ❌

### **B. Holders:**
- `top10Concentration` → `topHolderSellPct = top10Concentration / 100`
- `smartMoneyHolders` → część `freshWalletScore` (50% weight)

### **C. Perp Screener (backup):**
- `trader_count` → część `freshWalletScore` (70% weight) gdy brak danych z Flow/Holders

### **Wynik:**
- `riskLevel` ∈ { 'ok', 'caution', 'avoid' }
- `rotationScore` ∈ [0, 100]

---

## 🎯 **2. Dokładne Progi Ryzyka - computeRiskLevel()**

### **🔹 ZEC**

**Logika (intencja: "domyślnie podejrzany"):**

```typescript
if (flow7d <= 0 || fw < 40) {
  riskLevel = 'avoid'
} else if (flow7d >= 5_000_000) {
  riskLevel = 'ok'
} else {
  riskLevel = 'caution'
}
```

**Interpretacja:**
- **avoid:**
  - 7d smart money flow ≤ 0 **ALBO**
  - freshWalletScore < 40
  - → praktycznie większość realnych przypadków teraz
- **ok:**
  - tylko jeśli 7d smart money flow ≥ +5M
  - → musi być naprawdę brutalne, pozytywne flow
- **reszta → caution**

---

### **🔹 UNI**

```typescript
if (flow7d <= -2_000_000 || topHolderSellPct >= 0.40) {
  riskLevel = 'avoid'
} else if (flow7d >= 0 && flow24h >= -1_000_000 && fw >= 45) {
  riskLevel = 'ok'
} else {
  riskLevel = 'caution'
}
```

**Interpretacja:**
- **ok**, jeśli:
  - 7d smart money flow ≥ 0 (nie uciekają),
  - 24h flow nie jest bardzo krwawy (≥ -1M),
  - freshWalletScore ≥ 45 (jakiś sensowny napływ / aktywność)
- **avoid:**
  - flow7d ≤ -2M **albo**
  - topHolderSellPct > 40% (top holderzy wywalają)
- **w innym przypadku → caution**

---

### **🔹 VIRTUAL**

```typescript
if (flow7d >= 2_000_000 && flow24h >= -1_000_000 && fw >= 50) {
  riskLevel = 'ok'
} else if (flow7d <= -2_000_000 && fw < 30) {
  riskLevel = 'avoid'   // sensowny twardy próg
} else {
  riskLevel = 'caution'
}
```

**Interpretacja:**
- **ok**, jeśli:
  - 7d smart money flow ≥ +2M,
  - 24h nie jest mega czerwony (≥ -1M),
  - freshWalletScore ≥ 50 (dużo nowych / aktywnych)
- **avoid**, gdy:
  - mocno negatywne 7d flow ≤ -2M **i**
  - fw < 30 (śmierć zainteresowania)
- **W pozostałych przypadkach: caution**

---

## 📈 **3. computeRotationScore() - Jak Powstaje Wynik 0–100**

### **Schemat (bazowy):**

**1. Bazowy score (0–70) z:**
- **7d flow**: -5M → 0, +10M → +30
- **24h flow**: -3M → -5, +3M → +5
- **Fresh wallets**: 0–100 → 0–20
- **Top holder sell**: 0–60% → 0...-15

**2. Cap po riskLevel:**

```typescript
if (riskLevel === 'caution') {
  baseScore = Math.min(baseScore, 35)
}
if (riskLevel === 'avoid') {
  baseScore = 0
}
```

**3. Boosty / capy per token:**

```typescript
if (symbol === 'UNI')      baseScore += 5
if (symbol === 'VIRTUAL')  baseScore += 8
if (symbol === 'ZEC')      baseScore = Math.min(baseScore, 25)
```

**4. Clamp 0–100 na koniec**

**Efekt:**
- **VIRTUAL** z dobrym Nansenem → bardzo wysokie rotationScore (85+)
- **UNI** – solidny mid-high wynik (60-70), ale bez szału, jeśli dane są ok
- **ZEC** – nawet jak ma fajne flows, nigdy nie przekroczy 25; przy avoid ma 0

---

## 🛡️ **4. Soft SL Hook - Co Robi z maxLoss**

### **W enforcePerPairRisk():**

**1. Najpierw standardowo pobierasz maxLoss z .env:**

```bash
ZEC_MAX_LOSS_PER_SIDE_USD=150
UNI_MAX_LOSS_PER_SIDE_USD=150
VIRTUAL_MAX_LOSS_PER_SIDE_USD=150
```

**2. Potem, na podstawie riskLevel z Nansena, mnożysz:**

```typescript
if (riskLevel === 'avoid') {
  effectiveMaxLoss = maxLoss * 0.6   // 60% oryginalnego limitu
} else if (riskLevel === 'caution') {
  effectiveMaxLoss = maxLoss * 0.8   // 80%
} else { // 'ok'
  effectiveMaxLoss = maxLoss         // 100%
}
```

**Przykład dla ZEC z .env: 150:**
- `riskLevel='avoid'` → `effectiveMaxLoss = 150 * 0.6 = 90`
- `riskLevel='caution'` → `= 120`
- `riskLevel='ok'` → `= 150`

**3. I dopiero względem tego limitu porównujesz unrealizedPnlUsd:**

```typescript
if (unrealizedPnlUsd <= -effectiveMaxLoss) {
  // zamykamy pozycję, cancel orders, ustawiamy cooldown
}
```

---

## 🎯 **5. Macierz Decyzji - Co Bot Robi Przy Różnych riskLevel**

### **A. Rotacja (rotateIfNeeded())**

| riskLevel | rotationScore | Wejście do rotacji? |
|-----------|--------------|---------------------|
| **ok** | liczone pełne (z boostami) | ✅ **tak**, jeśli w top N po score |
| **caution** | cap 35 | ⚠️ **tylko** jeśli brakuje innych kandydatów |
| **avoid** | 0 | ❌ **wykluczony** z rotacji |

**Dodatkowo dla ZEC:** twardy cap 25 nawet przy ok.

---

### **B. Soft SL**

| riskLevel | Multiplikator maxLoss | Efekt |
|-----------|------------------------|-------|
| **ok** | 1.0× | Normalny soft SL |
| **caution** | 0.8× | Soft SL strzela szybciej |
| **avoid** | 0.6× | Jeszcze szybciej, bardzo ciasny |

**Czyli:**
- **ZEC** – bardzo często avoid → mały limit (np. 90 USD), do tego rzadko w rotacji
- **UNI** – zwykle ok / caution, w zależności od flows → normalny lub minimalnie zaostrzony SL
- **VIRTUAL** – ma najwyższą szansę na ok, więc pełne maxLoss i wysoki priorytet w rotacji

---

## 📋 **6. Jak Czytać Logi (Przykład)**

### **Przykład loga:**

```
[NANSEN] ZEC risk=avoid score=0 7d=$-2.50M 24h=$-0.50M fw=35 sell=32.5%
[NANSEN] UNI risk=ok score=68 7d=$+3.20M 24h=$+0.80M fw=65 sell=22.0%
[NANSEN] VIRTUAL risk=ok score=85 7d=$+5.10M 24h=$+1.20M fw=75 sell=28.0%
```

### **Z tego od razu wiesz:**

**ZEC:**
- `risk=avoid` → wycięty z rotacji, soft SL na 60% maxLoss
- `score=0` → rotacja go nie dotknie
- `7d=$-2.50M` → smart money ucieka
- `fw=35` → słaba aktywność fresh wallets
- `sell=32.5%` → top holders sprzedają

**UNI:**
- `risk=ok` → normalny soft SL (100% maxLoss)
- `score=68` → mocny kandydat do rotacji (z +5 boostem)
- `7d=$+3.20M` → smart money wchodzi
- `fw=65` → dobra aktywność
- `sell=22.0%` → niska dystrybucja

**VIRTUAL:**
- `risk=ok` → normalny soft SL (100% maxLoss)
- `score=85` → top priority na kapital rotacji (z +8 boostem)
- `7d=$+5.10M` → bardzo silny smart money flow
- `fw=75` → bardzo dobra aktywność
- `sell=28.0%` → umiarkowana dystrybucja

---

## 🔄 **7. Przykład Pełnej Rotacji - Krok Po Kroku**

### **Scenariusz:**
Volatility rotation daje: `['ZEC', 'UNI', 'VIRTUAL', 'SHITCOIN']`

### **Krok po kroku:**

**1. Volatility Rotation (mm_hl.ts → rotateIfNeeded()):**
```typescript
const topPairs = await this.rotation.getTop3Pairs()
// Zwraca: [
//   { pair: 'ZEC', volatility24h: 5.2, score: 4.8 },
//   { pair: 'UNI', volatility24h: 4.8, score: 4.5 },
//   { pair: 'VIRTUAL', volatility24h: 4.5, score: 4.2 },
//   { pair: 'SHITCOIN', volatility24h: 4.2, score: 4.0 }
// ]
const candidatePairs = topPairs.map(s => s.pair)
// ['ZEC', 'UNI', 'VIRTUAL', 'SHITCOIN']
```

**2. Nansen Refresh (nansenBias.refreshForSymbols()):**
```typescript
await this.nansenBias.refreshForSymbols(candidatePairs)
```

**Logi:**
```
[NANSEN] Refreshing signals for symbols: ZEC, UNI, VIRTUAL, SHITCOIN
[NANSEN] ZEC risk=avoid score=0 7d=$-2.50M 24h=$-0.50M fw=35 sell=32.5%
[NANSEN] UNI risk=ok score=68 7d=$+3.20M 24h=$+0.80M fw=65 sell=22.0%
[NANSEN] VIRTUAL risk=ok score=85 7d=$+5.10M 24h=$+1.20M fw=75 sell=28.0%
[NANSEN] SHITCOIN risk=caution score=25 7d=$-1.20M 24h=$-0.30M fw=40 sell=35.0%
```

**3. Nansen Filtering & Sorting (nansenBias.getRotationCandidates()):**
```typescript
const orderedByNansen = this.nansenBias.getRotationCandidates(candidatePairs)
// Filtruje: ZEC (risk=avoid, score=0) → wykluczony
// Sortuje po rotationScore:
//   1. VIRTUAL (score=85, risk=ok)
//   2. UNI (score=68, risk=ok)
//   3. SHITCOIN (score=25, risk=caution)
```

**Logi:**
```
[NANSEN] ZEC filtered out from rotation (risk=avoid)
```

**4. Final Rotation (Top 3):**
```typescript
const newPairs = orderedByNansen.slice(0, 3)
// ['VIRTUAL', 'UNI', 'SHITCOIN']
```

**Logi:**
```
✅ Rotated to: VIRTUAL, UNI, SHITCOIN
   Reason: Nansen-filtered rotation
   1. VIRTUAL: vol=4.5%, score=4.2 | Nansen: ok (85)
   2. UNI: vol=4.8%, score=4.5 | Nansen: ok (68)
   3. SHITCOIN: vol=4.2%, score=4.0 | Nansen: caution (25)
```

**5. Soft SL Configuration (enforcePerPairRisk()):**

Gdy bot otwiera pozycję na każdej parze:

```typescript
// VIRTUAL
const signal = nansenBias.getSignal('VIRTUAL')
// { riskLevel: 'ok', ... }
let maxLoss = getPerPairMaxLossUsd('VIRTUAL') // $150 z .env
// riskLevel='ok' → maxLoss = $150 * 1.0 = $150 ✅

// UNI
const signal = nansenBias.getSignal('UNI')
// { riskLevel: 'ok', ... }
let maxLoss = getPerPairMaxLossUsd('UNI') // $150 z .env
// riskLevel='ok' → maxLoss = $150 * 1.0 = $150 ✅

// SHITCOIN
const signal = nansenBias.getSignal('SHITCOIN')
// { riskLevel: 'caution', ... }
let maxLoss = getPerPairMaxLossUsd('SHITCOIN') // $150 z .env
// riskLevel='caution' → maxLoss = $150 * 0.8 = $120 ⚠️

// ZEC (gdyby był w rotacji - ale nie jest)
// riskLevel='avoid' → maxLoss = $150 * 0.6 = $90 ❌
```

**Logi:**
```
🧠 [NANSEN] SHITCOIN marked as CAUTION → tightening soft SL to 80% (maxLoss=120.00)
```

**6. Wpływ na Soft SL (przykład):**

Jeśli SHITCOIN ma pozycję i unrealizedPnlUsd = -$125:

```typescript
// Normalny limit: $150
// Z Nansen (caution): $150 * 0.8 = $120
if (unrealizedPnlUsd < -120) {  // -125 < -120 ✅
  // Soft SL HIT!
  // Cancel orders, close position, set cooldown
}
```

**Logi:**
```
[RISK] ❌ SOFT SL HIT on SHITCOIN: uPnL $-125.00 < -$120.00
🧠 [NANSEN] SHITCOIN marked as CAUTION → tightening soft SL to 80% (maxLoss=120.00)
```

---

## 📊 **8. Szczegółowy Przykład - Pełna Rotacja z Wszystkimi Krokami**

### **Scenariusz Startowy:**
- Volatility rotation zwraca: `['ZEC', 'UNI', 'VIRTUAL', 'SHITCOIN']`
- `.env` ma: `ZEC_MAX_LOSS_PER_SIDE_USD=150`, `UNI_MAX_LOSS_PER_SIDE_USD=150`, `VIRTUAL_MAX_LOSS_PER_SIDE_USD=150`

### **Krok 1: Volatility Rotation**
```typescript
// mm_hl.ts → rotateIfNeeded()
const topPairs = await this.rotation.getTop3Pairs()
// [
//   { pair: 'ZEC', volatility24h: 5.2, score: 4.8 },
//   { pair: 'UNI', volatility24h: 4.8, score: 4.5 },
//   { pair: 'VIRTUAL', volatility24h: 4.5, score: 4.2 },
//   { pair: 'SHITCOIN', volatility24h: 4.2, score: 4.0 }
// ]
const candidatePairs = topPairs.map(s => s.pair)
// ['ZEC', 'UNI', 'VIRTUAL', 'SHITCOIN']
```

### **Krok 2: Nansen Refresh**
```typescript
// nansenBias.refreshForSymbols(['ZEC', 'UNI', 'VIRTUAL', 'SHITCOIN'])
// Dla każdego symbolu:
//   - fetchSignalForSymbol() → getFlowIntelligence() + analyzeTokenRisk() + getPerpScreener()
//   - computeRiskLevel() → 'ok' / 'caution' / 'avoid'
//   - computeRotationScore() → 0-100
```

**Wyniki Nansen:**
- **ZEC**: flow7d=-2.5M, flow24h=-0.5M, fw=35, sell=32.5%
  - `computeRiskLevel()`: flow7d <= 0 → **avoid**
  - `computeRotationScore()`: avoid → **0**
- **UNI**: flow7d=+3.2M, flow24h=+0.8M, fw=65, sell=22.0%
  - `computeRiskLevel()`: flow7d >= 0 AND flow24h >= -1M AND fw >= 45 → **ok**
  - `computeRotationScore()`: bazowy ~63 + boost 5 → **68**
- **VIRTUAL**: flow7d=+5.1M, flow24h=+1.2M, fw=75, sell=28.0%
  - `computeRiskLevel()`: flow7d >= 2M AND flow24h >= -1M AND fw >= 50 → **ok**
  - `computeRotationScore()`: bazowy ~77 + boost 8 → **85**
- **SHITCOIN**: flow7d=-1.2M, flow24h=-0.3M, fw=40, sell=35.0%
  - `computeRiskLevel()`: nie spełnia "ok", nie spełnia "avoid" → **caution**
  - `computeRotationScore()`: bazowy ~30, cap caution → **25**

### **Krok 3: Nansen Filtering & Sorting**
```typescript
// nansenBias.getRotationCandidates(['ZEC', 'UNI', 'VIRTUAL', 'SHITCOIN'])
// Filtruje:
//   - ZEC (risk=avoid, score=0) → wykluczony ❌
// Sortuje po rotationScore DESC:
//   1. VIRTUAL (score=85, risk=ok) ✅
//   2. UNI (score=68, risk=ok) ✅
//   3. SHITCOIN (score=25, risk=caution) ⚠️
```

**Logi:**
```
[NANSEN] ZEC filtered out from rotation (risk=avoid)
```

### **Krok 4: Final Rotation (Top 3)**
```typescript
const orderedByNansen = ['VIRTUAL', 'UNI', 'SHITCOIN']
const newPairs = orderedByNansen.slice(0, 3)
// ['VIRTUAL', 'UNI', 'SHITCOIN']
```

**Logi:**
```
✅ Rotated to: VIRTUAL, UNI, SHITCOIN
   Reason: Nansen-filtered rotation
   1. VIRTUAL: vol=4.5%, score=4.2 | Nansen: ok (85)
   2. UNI: vol=4.8%, score=4.5 | Nansen: ok (68)
   3. SHITCOIN: vol=4.2%, score=4.0 | Nansen: caution (25)
```

### **Krok 5: Wpływ na Soft SL Przy Otwieraniu Pozycji**

Gdy bot otwiera pozycję na każdej parze, `enforcePerPairRisk()` jest wywoływane:

**VIRTUAL:**
```typescript
let maxLoss = getPerPairMaxLossUsd('VIRTUAL') // $150 z .env
const signal = nansenBias.getSignal('VIRTUAL')
// { riskLevel: 'ok', ... }
if (signal.riskLevel === 'ok') {
  // maxLoss pozostaje $150 (100%)
}
// Soft SL: jeśli uPnL < -$150 → close
```

**UNI:**
```typescript
let maxLoss = getPerPairMaxLossUsd('UNI') // $150 z .env
const signal = nansenBias.getSignal('UNI')
// { riskLevel: 'ok', ... }
if (signal.riskLevel === 'ok') {
  // maxLoss pozostaje $150 (100%)
}
// Soft SL: jeśli uPnL < -$150 → close
```

**SHITCOIN:**
```typescript
let maxLoss = getPerPairMaxLossUsd('SHITCOIN') // $150 z .env
const signal = nansenBias.getSignal('SHITCOIN')
// { riskLevel: 'caution', ... }
if (signal.riskLevel === 'caution') {
  maxLoss = maxLoss * 0.8  // $150 * 0.8 = $120
}
// Soft SL: jeśli uPnL < -$120 → close (szybciej niż normalnie!)
```

**ZEC (gdyby był w rotacji - ale nie jest):**
```typescript
let maxLoss = getPerPairMaxLossUsd('ZEC') // $150 z .env
const signal = nansenBias.getSignal('ZEC')
// { riskLevel: 'avoid', ... }
if (signal.riskLevel === 'avoid') {
  maxLoss = maxLoss * 0.6  // $150 * 0.6 = $90
}
// Soft SL: jeśli uPnL < -$90 → close (bardzo szybko!)
```

**Logi:**
```
🧠 [NANSEN] SHITCOIN marked as CAUTION → tightening soft SL to 80% (maxLoss=120.00)
```

### **Krok 6: Przykład Soft SL w Akcji**

**Scenariusz:** SHITCOIN ma pozycję, unrealizedPnlUsd = -$125

```typescript
// enforcePerPairRisk('SHITCOIN', -125)
let maxLoss = getPerPairMaxLossUsd('SHITCOIN') // $150
const signal = nansenBias.getSignal('SHITCOIN')
if (signal.riskLevel === 'caution') {
  maxLoss = maxLoss * 0.8  // $120
}
if (unrealizedPnlUsd < -maxLoss) {  // -125 < -120 ✅
  // Soft SL HIT!
  await cancelPairOrders('SHITCOIN')
  await closePositionForPair('SHITCOIN', 'soft_sl')
  // Set cooldown...
}
```

**Logi:**
```
🧠 [NANSEN] SHITCOIN marked as CAUTION → tightening soft SL to 80% (maxLoss=120.00)
[RISK] ❌ SOFT SL HIT on SHITCOIN: uPnL $-125.00 < -$120.00
```

**Bez Nansen:** Soft SL by nie wystrzelił (limit $150, uPnL -$125)
**Z Nansen:** Soft SL wystrzelił (limit $120, uPnL -$125) ✅

---

## 📋 **9. Macierz Decyzji - Podsumowanie**

### **A. Rotacja (rotateIfNeeded())**

| riskLevel | rotationScore | Wejście do rotacji? | Przykład |
|-----------|--------------|---------------------|----------|
| **ok** | liczone pełne (z boostami) | ✅ **tak**, jeśli w top N po score | VIRTUAL (85), UNI (68) |
| **caution** | cap 35 | ⚠️ **tylko** jeśli brakuje innych kandydatów | SHITCOIN (25) |
| **avoid** | 0 | ❌ **wykluczony** z rotacji | ZEC (0) |

**Dodatkowo dla ZEC:** twardy cap 25 nawet przy ok.

---

### **B. Soft SL**

| riskLevel | Multiplikator maxLoss | Efekt | Przykład ($150 z .env) |
|-----------|------------------------|-------|------------------------|
| **ok** | 1.0× | Normalny soft SL | $150 |
| **caution** | 0.8× | Soft SL strzela szybciej | $120 |
| **avoid** | 0.6× | Jeszcze szybciej, bardzo ciasny | $90 |

**Czyli:**
- **ZEC** – bardzo często avoid → mały limit (np. 90 USD), do tego rzadko w rotacji
- **UNI** – zwykle ok / caution, w zależności od flows → normalny lub minimalnie zaostrzony SL
- **VIRTUAL** – ma najwyższą szansę na ok, więc pełne maxLoss i wysoki priorytet w rotacji

---

## ✅ **10. Podsumowanie - Jak System Działa**

### **Nansen = Filtr/Bias Engine (NIE kierownica bota)**

**Co Nansen robi:**
1. ✅ **Filtruje** tokeny do rotacji (avoid → wykluczone)
2. ✅ **Priorytetyzuje** tokeny (rotationScore 0-100)
3. ✅ **Zaostrza soft SL** dla toksycznych tokenów (avoid=60%, caution=80%)

**Czego Nansen NIE robi:**
- ❌ Nie steruje botem bezpośrednio
- ❌ Nie zastępuje volatility rotation
- ❌ Nie zastępuje notional caps / cooldownów

**Core bota (zawsze działa):**
- ✅ Volatility-based rotation
- ✅ Notional caps per pair
- ✅ Soft SL z cooldownami
- ✅ Hard limits z .env

**Nansen (dodatkowa warstwa):**
- ✅ Filtruje i sortuje kandydatów z volatility rotation
- ✅ Zaostrza soft SL dla toksycznych tokenów
- ✅ Graceful fallback gdy API nie odpowiada

---

## 🚀 **Status:**

**System gotowy do użycia!** Wszystkie progi są konkretne, liczbowe i zaimplementowane 1:1 zgodnie z planem.

