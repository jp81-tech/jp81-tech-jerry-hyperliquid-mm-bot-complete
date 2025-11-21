# 🛡️ Stop Loss - Kompletny Przegląd Wszystkich Mechanizmów

## 📋 **Wszystkie Typy Stop Loss w Bocie**

### **1. Soft Stop Loss (Per-Pair)**
**Główna funkcja:** `enforcePerPairRisk()`

**Cel:** Zamyka pozycję gdy unrealized PnL przekroczy limit dla danej pary

**Konfiguracja (.env):**
```bash
# Per-pair limits
ZEC_MAX_LOSS_PER_SIDE_USD=120          # ZEC: bardzo twardy kaganiec
UNI_MAX_LOSS_PER_SIDE_USD=170          # UNI: normalny oddech
VIRTUAL_MAX_LOSS_PER_SIDE_USD=170      # VIRTUAL: normalny oddech
DEFAULT_MAX_LOSS_PER_SIDE_USD=100      # Fallback dla innych par

# Cooldown
PER_PAIR_SOFT_SL_COOLDOWN_MINUTES=60   # Normal cooldown
PER_PAIR_SOFT_SL_COOLDOWN_MINUTES_SEVERE=120  # Severe breach cooldown
PER_PAIR_SOFT_SL_SEVERE_THRESHOLD_MULTIPLE=1.5  # 1.5x = severe breach
```

**Jak działa:**
1. Sprawdza `unrealizedPnlUsd < -maxLoss`
2. Jeśli tak → cancel orders → close position → set cooldown
3. **Nansen hook:** Adjustuje `maxLoss` na podstawie `riskLevel`:
   - `avoid` → 60% maxLoss (ZEC: 120 × 0.6 = 72 USD)
   - `caution` → 80% maxLoss (ZEC: 120 × 0.8 = 96 USD)
   - `ok` → 100% maxLoss (UNI/VIRTUAL: 170 × 1.0 = 170 USD)

**Dynamiczny cooldown:**
- Normal breach (< 1.5x): 60 min
- Severe breach (≥ 1.5x): 120 min

**Funkcje:**
- `getPerPairMaxLossUsd(pair)` - pobiera limit z .env
- `enforcePerPairRisk(pair, unrealizedPnlUsd)` - główna logika
- `isInSoftSlCooldown(pair)` - sprawdza cooldown
- `getSoftSlCooldownMs()` - normal cooldown
- `getSoftSlSevereCooldownMs()` - severe cooldown
- `getSoftSlSevereThreshold()` - severe threshold (1.5x)

**Wywołania:**
- `executeMultiLayerMM()` - przed MM
- `executeRegularMM()` - przed MM

---

### **2. Nansen Conflict Stop Loss**
**Główna funkcja:** `checkNansenConflictStopLoss()`

**Cel:** Zamyka pozycję gdy jest przeciwko silnemu Nansen bias i traci pieniądze

**Konfiguracja (.env):**
```bash
# Nansen Conflict Protection
NANSEN_CONFLICT_CHECK_ENABLED=true
NANSEN_STRONG_CONTRA_HARD_CLOSE_USD=10
NANSEN_STRONG_CONTRA_MAX_LOSS_USD=25
NANSEN_STRONG_CONTRA_MAX_HOURS=3
NANSEN_CONFLICT_COOLDOWN_MINUTES=30
NANSEN_CONFLICT_COOLDOWN_MINUTES_SEVERE=60
NANSEN_CONFLICT_SEVERE_THRESHOLD_MULTIPLE=1.5

# Dynamic Close Cost
NANSEN_CLOSE_COST_DEFAULT_BPS=20              # 0.20% domyślnie
NANSEN_CLOSE_COST_SPREAD_MULTIPLIER=0.5      # 50% bieżącego spreadu
```

**Jak działa:**
1. Sprawdza czy pozycja jest przeciwko bias (long vs short bias lub odwrotnie)
2. Sprawdza czy `unrealizedPnlUsd < threshold`:
   - Strong bias: -$20
   - Soft bias: -$50
   - Neutral: -$700 (praktycznie nigdy)
3. **Cost-benefit check:**
   - Oblicza `estimatedCloseCostUsd` (spread-aware)
   - Oblicza `totalRiskUsd` (bias boost × 1% per point)
   - Skip jeśli `cost > risk` (chyba że severity ≥ 8)
4. Jeśli wszystko OK → close position → set cooldown

**Funkcje:**
- `checkNansenConflictStopLoss()` - główna logika
- `calculateConflictSeverity()` - oblicza severity 0-10
- `trackBiasForPosition()` - wykrywa bias flips
- `shouldExecuteClose()` - cost-benefit check
- `estimateCloseCostUsd()` - dynamiczny koszt zamknięcia
- `getCloseCostParams()` - parametry z .env
- `isInNansenConflictCooldown()` - sprawdza cooldown

**Tiered Close (na podstawie severity):**
- HIGH (≥8): Full close 100%, cooldown 60min
- MEDIUM (≥5): Partial close 60%, cooldown 45min
- LOW (≥3): Reduce exposure 30%, cooldown 30min

**Wywołania:**
- `executeMultiLayerMM()` - przed MM
- `checkNansenConflicts()` - globalna funkcja w main loop

---

### **3. Daily Loss Limit (Global)**
**Konfiguracja (.env):**
```bash
MAX_DAILY_LOSS_USD=200  # Globalny limit dzienny
```

**Jak działa:**
- Sprawdza całkowity PnL za dzień
- Jeśli przekroczy limit → zatrzymuje bota

---

### **4. Legacy Position Max Loss**
**Konfiguracja (.env):**
```bash
LEGACY_MAX_LOSS_USD=-100  # Force exit if loss exceeds $100
```

**Jak działa:**
- Dla pozycji które wyszły z rotacji
- Jeśli loss > $100 → force exit

---

## 📊 **Tabele Konfiguracyjne**

### **A. Per-Pair Soft SL Limits**

| Para | Base Limit | Nansen Adjust | Efektywny Limit |
|------|------------|---------------|-----------------|
| **ZEC** | $120 | avoid: 60% | $72 |
| **ZEC** | $120 | caution: 80% | $96 |
| **ZEC** | $120 | ok: 100% | $120 (rzadko) |
| **UNI** | $170 | avoid: 60% | $102 |
| **UNI** | $170 | caution: 80% | $136 |
| **UNI** | $170 | ok: 100% | $170 |
| **VIRTUAL** | $170 | avoid: 60% | $102 |
| **VIRTUAL** | $170 | caution: 80% | $136 |
| **VIRTUAL** | $170 | ok: 100% | $170 |
| **Other** | $100 | - | $100 |

---

### **B. Nansen Conflict SL Thresholds**

| Bias Strength | Threshold | Cooldown |
|---------------|-----------|----------|
| **Strong** | -$20 | 30-60 min |
| **Soft** | -$50 | 30-60 min |
| **Neutral** | -$700 | - |

---

### **C. Soft SL Cooldowns**

| Breach Type | Multiple | Cooldown |
|-------------|----------|----------|
| **Normal** | < 1.5x | 60 min |
| **Severe** | ≥ 1.5x | 120 min |

---

### **D. Nansen Conflict Cooldowns**

| Severity | Cooldown |
|----------|----------|
| **HIGH (≥8)** | 60 min |
| **MEDIUM (≥5)** | 45 min |
| **LOW (≥3)** | 30 min |

---

## 🔍 **Wszystkie Funkcje w Kodzie**

### **Soft SL:**
```typescript
// Helpery
getPerPairMaxLossUsd(pair: string): number | null
getSoftSlCooldownMs(): number
getSoftSlSevereCooldownMs(): number
getSoftSlSevereThreshold(): number
isInSoftSlCooldown(pair: string): boolean

// Główna logika
enforcePerPairRisk(pair: string, unrealizedPnlUsd: number): Promise<boolean>
```

### **Nansen Conflict SL:**
```typescript
// Helpery
getCloseCostParams(): { defaultBps: number, spreadMultiplier: number }
estimateCloseCostUsd(pair: string, notionalUsd: number, currentSpreadBps?: number): number
calculateConflictSeverity(...): number
trackBiasForPosition(...): { isFlip, flipCount, ... }
shouldExecuteClose(...): boolean
isInNansenConflictCooldown(pair: string): boolean

// Główna logika
checkNansenConflictStopLoss(...): Promise<boolean>
checkNansenConflicts(): Promise<void>
```

---

## 📝 **Zmienne Klasowe**

### **Soft SL:**
```typescript
private softSlCooldownUntil: Map<string, number> = new Map()
private softSlClosingInProgress: Set<string> = new Set()
```

### **Nansen Conflict SL:**
```typescript
private nansenConflictCooldownUntil: Map<string, number> = new Map()
private nansenConflictClosingInProgress: Set<string> = new Set()
private nansenConflictStats: Map<string, {...}> = new Map()
private positionBiasHistory: Map<string, {...}> = new Map()
```

---

## 🎯 **Przepływ Działań**

### **Soft SL:**
```
1. executeMultiLayerMM() / executeRegularMM()
   ↓
2. enforcePerPairRisk(pair, unrealizedPnlUsd)
   ↓
3. getPerPairMaxLossUsd(pair) → pobiera limit z .env
   ↓
4. Nansen hook → adjustuje maxLoss (60%/80%/100%)
   ↓
5. Sprawdza: unrealizedPnlUsd < -maxLoss?
   ↓
6. Jeśli TAK:
   - Cancel orders
   - Close position
   - Set cooldown (60min lub 120min)
   - Return false (skip MM)
   ↓
7. Jeśli NIE:
   - Return true (continue MM)
```

### **Nansen Conflict SL:**
```
1. executeMultiLayerMM() / checkNansenConflicts()
   ↓
2. checkNansenConflictStopLoss(...)
   ↓
3. Sprawdza cooldown → jeśli w cooldownie → return false
   ↓
4. Sprawdza bias → jeśli neutral → return false
   ↓
5. Sprawdza czy pozycja przeciwko bias
   ↓
6. Sprawdza: unrealizedPnlUsd < threshold?
   ↓
7. Jeśli TAK:
   - Cost-benefit check
   - Jeśli cost > risk → skip (chyba że severity ≥ 8)
   - Calculate severity
   - Track bias flip
   - Close position (tiered: 30%/60%/100%)
   - Set cooldown (30/45/60 min)
   - Return true
   ↓
8. Jeśli NIE:
   - Return false
```

---

## 📊 **Przykładowe Logi**

### **Soft SL (Normal):**
```
[RISK] ❌ SOFT SL HIT on ZEC: uPnL $-151.00 < -$120.00
🧠 [NANSEN] ZEC marked as CAUTION → tightening soft SL to 80% (maxLoss=96.00)
🚨 ZEC Soft SL (NORMAL): -151.00 USDC (limit=120, breach=1.26x)
✅ ZEC position closed successfully after soft SL
⏸ ZEC in soft SL cooldown for 60 minutes
```

### **Soft SL (Severe):**
```
[RISK] ❌ SOFT SL HIT on ZEC (SEVERE): uPnL $-225.00 < -$120.00 Breach=1.88x Cooldown=120min
🚨 ZEC Soft SL (SEVERE): -225.00 USDC (limit=120, breach=1.88x)
✅ ZEC position closed successfully after soft SL
⏸ ZEC in soft SL cooldown (SEVERE) for 120 minutes
```

### **Nansen Conflict SL:**
```
[NANSEN-SL] closeCost | pair=ZEC notional=1000.00 spreadBps=20 effBps=20 estCost=2.00
[COST-BENEFIT] ZEC: Approved - Risk $62.50 > 2x cost $2.00
🛑 [NANSEN CONFLICT SL] Closing LONG on ZEC (PnL: -21.00, threshold: -20) - position against Nansen SHORT STRONG bias +2.5
✅ ZEC position closed successfully after Nansen conflict SL
⏸ ZEC in Nansen conflict cooldown (MEDIUM) for 45 minutes
```

### **Nansen Conflict SL (Cost-Benefit Skip):**
```
[NANSEN-SL] closeCost | pair=ZEC notional=100.00 spreadBps=20 effBps=20 estCost=0.20
[NANSEN-SL] Skip close | pair=ZEC severity=5.0 notional=100.00 cost=0.20 risk=0.15
```

---

## ✅ **Status Implementacji**

### **Soft SL:**
- ✅ Per-pair limits z .env
- ✅ Nansen hook (adjust maxLoss)
- ✅ Dynamic cooldown (normal/severe)
- ✅ Retry logic z exponential backoff
- ✅ Position verification
- ✅ Cooldown reset jeśli pozycja nie istnieje
- ✅ Duplicate close prevention
- ✅ Enhanced logging

### **Nansen Conflict SL:**
- ✅ Conflict detection (pozycja vs bias)
- ✅ Dynamic thresholds (strong/soft/neutral)
- ✅ Cost-benefit check (spread-aware)
- ✅ Conflict severity score (0-10)
- ✅ Tiered close (30%/60%/100%)
- ✅ Bias flip detection
- ✅ Retry logic z exponential backoff
- ✅ Position verification
- ✅ Cooldown management
- ✅ Statistics tracking
- ✅ Enhanced logging

---

## 🎯 **Podsumowanie**

**Bot ma 2 główne mechanizmy stop loss:**

1. **Soft SL (Per-Pair)** - podstawowy mechanizm
   - Limit per para z .env
   - Nansen adjust (60%/80%/100%)
   - Dynamic cooldown (60/120 min)

2. **Nansen Conflict SL** - zaawansowany mechanizm
   - Pozycja przeciwko bias
   - Cost-benefit check
   - Tiered close
   - Bias flip detection

**Oba działają razem** - Soft SL jako podstawowa ochrona, Nansen Conflict SL jako dodatkowa warstwa dla konfliktowych pozycji.

---

## 📋 **Wszystkie Zmienne .env**

### **Soft SL:**
```bash
# Per-pair limits
ZEC_MAX_LOSS_PER_SIDE_USD=120
UNI_MAX_LOSS_PER_SIDE_USD=170
VIRTUAL_MAX_LOSS_PER_SIDE_USD=170
DEFAULT_MAX_LOSS_PER_SIDE_USD=100

# Cooldown
PER_PAIR_SOFT_SL_COOLDOWN_MINUTES=60
PER_PAIR_SOFT_SL_COOLDOWN_MINUTES_SEVERE=120
PER_PAIR_SOFT_SL_SEVERE_THRESHOLD_MULTIPLE=1.5
```

### **Nansen Conflict SL:**
```bash
# Nansen Conflict Protection
NANSEN_CONFLICT_CHECK_ENABLED=true
NANSEN_STRONG_CONTRA_HARD_CLOSE_USD=10
NANSEN_STRONG_CONTRA_MAX_LOSS_USD=25
NANSEN_STRONG_CONTRA_MAX_HOURS=3
NANSEN_CONFLICT_COOLDOWN_MINUTES=30
NANSEN_CONFLICT_COOLDOWN_MINUTES_SEVERE=60
NANSEN_CONFLICT_SEVERE_THRESHOLD_MULTIPLE=1.5

# Dynamic Close Cost
NANSEN_CLOSE_COST_DEFAULT_BPS=20
NANSEN_CLOSE_COST_SPREAD_MULTIPLIER=0.5
```

### **Inne Limity:**
```bash
MAX_DAILY_LOSS_USD=200
LEGACY_MAX_LOSS_USD=-100
MIN_LOSS_TO_CLOSE_USD=-50
```

---

## 🔍 **Szczegółowe Funkcje w Kodzie**

### **Soft SL - Pełna Lista:**

```typescript
// Helpery do pobierania limitów
getPerPairMaxLossUsd(pair: string): number | null

// Helpery do cooldownu
getSoftSlCooldownMs(): number
getSoftSlSevereCooldownMs(): number
getSoftSlSevereThreshold(): number
isInSoftSlCooldown(pair: string): boolean

// Główna logika
enforcePerPairRisk(pair: string, unrealizedPnlUsd: number): Promise<boolean>
```

**Szczegóły implementacji:**
- Sprawdza `unrealizedPnlUsd < -maxLoss`
- Nansen hook adjustuje `maxLoss` (60%/80%/100%)
- Dynamic cooldown: normal (60min) vs severe (120min)
- Retry logic z exponential backoff (3 próby)
- Position verification po zamknięciu
- Cooldown reset jeśli pozycja nie istnieje
- Duplicate close prevention (`softSlClosingInProgress`)

### **Nansen Conflict SL - Pełna Lista:**

```typescript
// Helpery do kosztu zamknięcia
getCloseCostParams(): { defaultBps: number, spreadMultiplier: number }
estimateCloseCostUsd(pair: string, notionalUsd: number, currentSpreadBps?: number): number

// Helpery do severity i bias
calculateConflictSeverity(...): number
trackBiasForPosition(...): { isFlip, flipCount, ... }
shouldExecuteClose(...): boolean

// Helpery do cooldownu
isInNansenConflictCooldown(pair: string): boolean

// Główna logika
checkNansenConflictStopLoss(...): Promise<boolean>
checkNansenConflicts(): Promise<void>
```

**Szczegóły implementacji:**
- Sprawdza pozycję vs bias (long vs short)
- Dynamic thresholds: strong (-$20), soft (-$50), neutral (-$700)
- Cost-benefit check z spread-aware kosztem
- Conflict severity score (0-10) z bias flip detection
- Tiered close: HIGH (100%), MEDIUM (60%), LOW (30%)
- Retry logic z exponential backoff (3 próby)
- Position verification po zamknięciu
- Statistics tracking (`nansenConflictStats`)
- Bias history tracking (`positionBiasHistory`)

---

## 📊 **Dokumentacja**

**Pliki związane z Stop Loss:**
- `STOP_LOSS_COMPLETE_OVERVIEW.md` - ten plik (kompletny przegląd)
- `SOFT_SL_FINAL.md` - finalna wersja soft SL
- `SOFT_SL_IMPROVEMENTS.md` - ulepszenia soft SL
- `SOFT_SL_ANALYSIS.md` - analiza soft SL
- `NANSEN_SL_SUMMARY.md` - podsumowanie Nansen SL
- `NANSEN_DYNAMIC_SL_ROTATION.md` - dynamic SL + rotation
- `NANSEN_ADVANCED_FEATURES.md` - zaawansowane funkcje
- `NANSEN_CONFLICT_IMPROVEMENTS.md` - ulepszenia conflict SL
- `NANSEN_CONFLICT_ANALYSIS.md` - analiza conflict SL

---

**Gotowe do produkcji!** 🚀

