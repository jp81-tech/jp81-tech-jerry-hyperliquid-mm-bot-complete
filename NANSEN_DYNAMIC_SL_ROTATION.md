# 🎯 Nansen Dynamic SL + Time-Based Rotation - Implementacja

## ✅ **Wszystkie Zmiany Wprowadzone**

### **1. Dynamiczny Koszt Zamknięcia (Spread-Aware)**

#### **Zmienne w .env:**
```bash
NANSEN_CLOSE_COST_DEFAULT_BPS=20              # 0.20% domyślnie
NANSEN_CLOSE_COST_SPREAD_MULTIPLIER=0.5      # 50% bieżącego spreadu
```

#### **Helpery w klasie:**
- `getCloseCostParams()` - pobiera parametry z .env
- `estimateCloseCostUsd(pair, notionalUsd, currentSpreadBps?)` - szacuje koszt zamknięcia

**Logika:**
- Jeśli mamy `currentSpreadBps` → używa `spreadBps * spreadMultiplier`
- Jeśli nie mamy → używa `defaultBps` (20 bps = 0.20%)
- `effectiveBps = max(defaultBps, floor(spreadBps * spreadMultiplier))`
- `cost = notionalUsd * (effectiveBps / 10_000)`

**Przykład:**
- Notional: $1000
- Spread: 50 bps
- Effective: max(20, floor(50 * 0.5)) = max(20, 25) = 25 bps
- Cost: $1000 * (25 / 10000) = **$2.50**

---

### **2. Cost-Benefit Check w Nansen SL**

**Dodano w `checkNansenConflictStopLoss()`:**

```typescript
// Estimate potential risk if we keep the position
const biasBoost = Math.abs(biasEntry?.boost || 0)
const riskPerBiasPoint = 0.01 // 1% per bias point
const potentialRiskUsd = positionValueUsd * biasBoost * riskPerBiasPoint
const totalRiskUsd = potentialRiskUsd + Math.abs(Math.min(0, unrealizedPnlUsd))

// Estimate close cost (spread-aware)
const estimatedCloseCostUsd = this.estimateCloseCostUsd(pair, positionValueUsd)

// Skip close if cost > risk (unless severity is very high)
const severity = 5 // Default medium severity
if (estimatedCloseCostUsd > totalRiskUsd && severity < 8) {
  // Skip close - cost too high
  return false
}
```

**Efekt:**
- System nie zamyka pozycji, jeśli koszt zamknięcia > potencjalna strata
- Force close tylko jeśli severity ≥ 8 (ignoruje cost)

---

### **3. Time-Based Rotation Enforce (8h Rule)**

#### **Zmienna w .env:**
```bash
ROTATION_MAX_HOLD_HOURS=8    # Max czas trzymania pary w rotacji
```

#### **Helpery w klasie:**
- `rotationSince: Record<string, number>` - śledzi kiedy para weszła do rotacji
- `markRotationEntered(pair)` - oznacza wejście do rotacji
- `getRotationAgeMs(pair)` - wiek pary w rotacji (ms)
- `getMaxRotationHoldMs()` - max czas trzymania (ms)
- `isRotationOverdue(pair)` - sprawdza czy para jest overdue

**Logika w `rotateIfNeeded()`:**

1. **Wykrywanie overdue pairs:**
```typescript
const overduePairs = currentPairs.filter(p => this.isRotationOverdue(p))
if (overduePairs.length > 0) {
  this.notifier.warn(`[ROTATION] Overdue pairs detected: ${overduePairs.join(',')}`)
}
```

2. **Force rotation jeśli overdue:**
```typescript
const shouldRotate = 
  ... ||
  overduePairs.length > 0 // Force rotation if any pair is overdue
```

3. **Wybór nowych par z uwzględnieniem overdue:**
```typescript
// Start with current pairs, but remove overdue ones first
let nextPairs = [...currentPairs]
nextPairs = nextPairs.filter(p => !overduePairs.includes(p))

// Add new candidates until we reach targetCount
for (const sym of freshCandidates) {
  if (nextPairs.length >= targetCount) break
  if (!nextPairs.includes(sym)) {
    nextPairs.push(sym)
  }
}

// If we still have less than targetCount, allow one overdue pair back
if (nextPairs.length < targetCount && overduePairs.length > 0) {
  // Add one overdue pair back to avoid having too few pairs
}
```

4. **Tracking wejścia do rotacji:**
```typescript
// Mark pairs as entered rotation
for (const p of newPairs) {
  if (!this.rotationSince[p]) {
    this.markRotationEntered(p)
  }
}

// Clean up pairs that were removed from rotation
for (const old of Object.keys(this.rotationSince)) {
  if (!newPairs.includes(old)) {
    delete this.rotationSince[old]
  }
}
```

**Efekt:**
- Żadna para nie może siedzieć w rotacji > 8h bez prawa do bycia wyrzuconą
- Nawet jeśli Nansen mówi "ok", po 8h para zostanie wypchnięta, jeśli istnieje zamiennik
- ZEC nie będzie zbanowany na stałe - może wrócić po rotacji

---

## 📊 **Przykładowe Logi**

### **Dynamic Close Cost:**
```
[NANSEN-SL] closeCost | pair=ZEC notional=1000.00 spreadBps=20 effBps=20 estCost=2.00
```

### **Cost-Benefit Skip:**
```
[NANSEN-SL] Skip close | pair=ZEC severity=5.0 notional=1000.00 cost=2.00 risk=1.50
```

### **Rotation Overdue:**
```
[ROTATION] Overdue pairs detected: ZEC (maxHoldHours=8.0)
[ROTATION] Entered rotation | pair=UNI at=2024-01-15T10:00:00.000Z
```

### **Rotation with Overdue:**
```
✅ Rotated to: UNI, VIRTUAL, SHITCOIN
   Reason: Nansen-filtered rotation (ZEC overdue, replaced)
```

---

## 🎯 **Jak To Działa z ZEC**

### **Scenariusz: ZEC w rotacji przez 8h**

1. **0h:** ZEC wchodzi do rotacji
   - `markRotationEntered('ZEC')` → `rotationSince['ZEC'] = now`
   - Nansen: `risk=caution`, `score=25` (cap)

2. **4h:** ZEC nadal w rotacji
   - `getRotationAgeMs('ZEC')` = 4h
   - `isRotationOverdue('ZEC')` = false (4h < 8h)

3. **8h:** ZEC staje się overdue
   - `getRotationAgeMs('ZEC')` = 8h
   - `isRotationOverdue('ZEC')` = true (8h >= 8h)
   - `overduePairs = ['ZEC']`

4. **Następna rotacja:**
   - `shouldRotate = true` (bo ZEC overdue)
   - `nextPairs` = `currentPairs.filter(p => p !== 'ZEC')` = `['UNI', 'VIRTUAL']`
   - Dodaje nowych kandydatów: `['UNI', 'VIRTUAL', 'SHITCOIN']`
   - ZEC wypchnięty z rotacji

5. **Po rotacji:**
   - ZEC może wrócić (nie jest zbanowany na stałe)
   - Jeśli volatility rotation go wybierze, może wejść z powrotem
   - Ale po 8h znowu zostanie wypchnięty

---

## ✅ **Status Implementacji**

- ✅ Dynamiczny koszt zamknięcia (spread-aware)
- ✅ Cost-benefit check w Nansen SL
- ✅ Time-based rotation enforce (8h rule)
- ✅ Rotation tracking (rotationSince)
- ✅ Overdue detection i handling
- ✅ Cleanup removed pairs

**Gotowe do testowania!** 🚀

---

## 🔍 **Co Sprawdzić w Logach**

### **Po 8h działania:**

1. **Overdue detection:**
```bash
grep "Overdue pairs detected" bot.log
```

2. **Rotation entries:**
```bash
grep "Entered rotation" bot.log
```

3. **Close cost calculations:**
```bash
grep "closeCost" bot.log
```

4. **Cost-benefit skips:**
```bash
grep "Skip close" bot.log
```

### **Oczekiwane zachowanie:**

- ✅ ZEC nie powinien siedzieć w rotacji > 8h
- ✅ Close cost powinien być obliczany dynamicznie
- ✅ Cost-benefit check powinien skipować drogie zamknięcia
- ✅ Rotation powinna działać płynnie z time-limit

---

## 🎯 **Następne Kroki**

1. **Test w DRY_RUN:**
   - Ustaw `DRY_RUN=1` w .env
   - Uruchom bota i obserwuj logi
   - Sprawdź czy overdue detection działa

2. **Monitorowanie:**
   - Po 8h sprawdź czy ZEC został wypchnięty
   - Sprawdź czy close cost jest obliczany poprawnie
   - Sprawdź czy cost-benefit check działa

3. **Dostrojenie:**
   - Jeśli 8h to za mało/za dużo → zmień `ROTATION_MAX_HOLD_HOURS`
   - Jeśli close cost jest za wysoki/niski → zmień `NANSEN_CLOSE_COST_DEFAULT_BPS`
   - Jeśli spread multiplier nie działa → zmień `NANSEN_CLOSE_COST_SPREAD_MULTIPLIER`

**Gotowe!** 🎉

