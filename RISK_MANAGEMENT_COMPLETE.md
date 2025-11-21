# 🛡️ Risk Management - Kompletny Przegląd Wszystkich Mechanizmów

## 📋 **Spis Treści**

1. [Soft Stop Loss (Per-Pair)](#1-soft-stop-loss-per-pair)
2. [Nansen Conflict Stop Loss](#2-nansen-conflict-stop-loss)
3. [Daily Loss Limit (Global)](#3-daily-loss-limit-global)
4. [Per-Pair Notional Caps](#4-per-pair-notional-caps)
5. [Behavioural Risk (Anti-FOMO / Anti-Knife)](#5-behavioural-risk-anti-fomo--anti-knife)
6. [Rotation Filtering & Cooldowns](#6-rotation-filtering--cooldowns)
7. [Position Limits & Max Active Pairs](#7-position-limits--max-active-pairs)
8. [Legacy Position Management](#8-legacy-position-management)
9. [Konfiguracja .env](#9-konfiguracja-env)
10. [Przykładowe Logi](#10-przykładowe-logi)
11. [Jak Sprawdzić w Logach, Czy Wszystkie Warstwy Działają](#11-jak-sprawdzić-w-logach-czy-wszystkie-warstwy-działają)
12. [🔍 Jak w 5 minut sprawdzić, czy wszystkie zabezpieczenia działają](#-jak-w-5-minut-sprawdzić-czy-wszystkie-zabezpieczenia-działają)
13. [🧩 RUNBOOK: Jak sprawdzić, które zabezpieczenie zadziałało (w 60 sekund)](#-runbook-jak-sprawdzić-które-zabezpieczenie-zadziałało-w-60-sekund)

---

## 1. **Soft Stop Loss (Per-Pair)**

### **Cel:**
Zamyka pozycję gdy unrealized PnL przekroczy limit dla danej pary.

### **Główna funkcja:**
`enforcePerPairRisk(pair: string, unrealizedPnlUsd: number): Promise<boolean>`

### **Konfiguracja (.env):**
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

### **Jak działa:**

1. **Pobiera limit z .env:**
   - `getPerPairMaxLossUsd(pair)` - szuka `${PAIR}_MAX_LOSS_PER_SIDE_USD`
   - Fallback: `DEFAULT_MAX_LOSS_PER_SIDE_USD` (100 USD)

2. **Nansen Hook - Adjustuje limit:**
   - `riskLevel = 'avoid'` → **60% maxLoss** (ZEC: 120 × 0.6 = 72 USD)
   - `riskLevel = 'caution'` → **80% maxLoss** (ZEC: 120 × 0.8 = 96 USD)
   - `riskLevel = 'ok'` → **100% maxLoss** (UNI/VIRTUAL: 170 × 1.0 = 170 USD)

3. **Sprawdza warunek:**
   - `if (unrealizedPnlUsd < -maxLoss)` → **TRIGGER**

4. **Akcje przy triggerze:**
   - Cancel wszystkie open orders dla pary
   - Close position (market order)
   - Set cooldown (dynamiczny: normal vs severe)

5. **Dynamiczny cooldown:**
   - **Normal breach** (< 1.5x limit): 60 min
   - **Severe breach** (≥ 1.5x limit): 120 min

### **Funkcje pomocnicze:**
```typescript
getPerPairMaxLossUsd(pair: string): number | null
getSoftSlCooldownMs(): number
getSoftSlSevereCooldownMs(): number
getSoftSlSevereThreshold(): number
isInSoftSlCooldown(pair: string): boolean
```

### **Wywołania:**
- `executeMultiLayerMM()` - przed MM
- `executeRegularMM()` - przed MM

### **Przykładowy log:**
```
[RISK] ❌ SOFT SL HIT on ZEC: uPnL $-95.50 < -$72.00
🧠 [NANSEN] ZEC marked as AVOID → tightening soft SL to 60% (maxLoss=72.00)
```

---

## 2. **Nansen Conflict Stop Loss**

### **Cel:**
Zamyka pozycję gdy jest przeciwko silnemu Nansen bias i traci pieniądze.

### **Główna funkcja:**
`checkNansenConflictStopLoss(pair, positionSize, positionValueUsd, unrealizedPnlUsd): Promise<boolean>`

### **Konfiguracja (.env):**
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

### **Jak działa:**

1. **Sprawdza konflikt:**
   - Pozycja LONG vs Nansen SHORT bias → **KONFLIKT**
   - Pozycja SHORT vs Nansen LONG bias → **KONFLIKT**

2. **Progi w zależności od bias strength:**
   - **Strong bias:** -$10 (hard close), -$25 (max loss)
   - **Soft bias:** -$50
   - **Neutral:** -$700 (praktycznie nigdy)

3. **Cost-Benefit Check:**
   - Oblicza `estimatedCloseCostUsd` (spread-aware)
   - Oblicza `totalRiskUsd` (bias boost × 1% per point)
   - **Skip jeśli:** `cost > risk` (chyba że severity ≥ 8)

4. **Tiered Close (na podstawie severity):**
   - **HIGH (≥8):** Full close 100%, cooldown 60min
   - **MEDIUM (≥5):** Partial close 60%, cooldown 45min
   - **LOW (≥3):** Reduce exposure 30%, cooldown 30min

5. **Bias Flip Detection:**
   - Trackuje historię bias dla pozycji
   - Wykrywa zmiany bias (flip)
   - Zwiększa severity przy flip

### **Funkcje pomocnicze:**
```typescript
calculateConflictSeverity(): number  // 0-10
trackBiasForPosition(pair: string, bias: string): void
shouldExecuteClose(cost: number, risk: number, severity: number): boolean
estimateCloseCostUsd(pair: string, notionalUsd: number, spreadBps?: number): number
getCloseCostParams(): { defaultBps: number, spreadMultiplier: number }
isInNansenConflictCooldown(pair: string): boolean
```

### **Wywołania:**
- `executeMultiLayerMM()` - przed MM
- `checkNansenConflicts()` - globalna funkcja w main loop

### **Przykładowy log:**
```
🛑 [NANSEN CONFLICT SL] Closing LONG on ZEC (PnL: $-22.50, threshold: $-20) - position against Nansen SHORT STRONG bias +3.5
[NANSEN-SL] Skip close | pair=UNI severity=4.5 notional=$500.00 cost=$1.20 risk=$0.80
```

---

## 3. **Daily Loss Limit (Global)**

### **Cel:**
Zatrzymuje bota gdy całkowity dzienny PnL przekroczy limit.

### **Konfiguracja (.env):**
```bash
MAX_DAILY_LOSS_USD=200  # Globalny limit dzienny
```

### **Jak działa:**
- Sprawdza `state.dailyPnl` (resetowany o północy)
- Jeśli `dailyPnl < -MAX_DAILY_LOSS_USD` → **STOP BOT**
- Loguje alert i zatrzymuje wszystkie operacje

### **Przykładowy log:**
```
[RISK] ❌ DAILY LOSS LIMIT HIT: $-205.50 < -$200.00
🛑 Bot stopped due to daily loss limit
```

---

## 4. **Per-Pair Notional Caps**

### **Cel:**
Zapobiega nadmiernej ekspozycji na jedną parę (np. ZEC 20k USD).

### **Główna funkcja:**
`isOverNotionalCap(pair: string, midPrice: number, position: Position): boolean`

### **Konfiguracja (.env):**
```bash
# Rotation caps
ROTATION_TARGET_PER_PAIR_USD=3500      # Cel per para (~14% kapitału)
ROTATION_MAX_PER_PAIR_USD=5000         # Hard cap per para (~20% kapitału)
TOTAL_CAPITAL_USD=25000                 # Całkowity kapitał (referencyjny)
```

### **Jak działa:**

1. **Oblicza notional:**
   - `notionalUsd = Math.abs(position.size) * midPrice`

2. **Sprawdza cap:**
   - `if (notionalUsd > ROTATION_MAX_PER_PAIR_USD)` → **OVER CAP**

3. **Akcje:**
   - **Guard w executeMultiLayerMM:** Nie dodaje nowych orderów
   - **Guard w executeRegularMM:** Nie dodaje nowych orderów
   - **Rotation filtering:** Para jest wykluczona z rotacji

### **Funkcje pomocnicze:**
```typescript
getRotationCaps(): { target: number, max: number }
isOverNotionalCap(pair: string, midPrice: number, position: Position): boolean
```

### **Przykładowy log:**
```
⚠️ ZEC: position notional 5200.00 USD > cap 5000. Skipping new maker orders.
⛔ Rotation: skipping ZEC – notional above cap 5000 USD.
```

---

## 5. **Behavioural Risk (Anti-FOMO / Anti-Knife)**

### **Cel:**
Zapobiega kupowaniu podczas:
- **FOMO pumps** (szybki wzrost ceny)
- **Falling knives** (szybki spadek ceny)
- **Low orderbook depth** (brak płynności)

### **Główne moduły:**
1. **`src/risk/behaviouralGuard.ts`** - Nowy moduł z `evaluateBehaviourGuard()` (rekomendowany)
2. **`src/behaviouralRisk.ts`** - Stary moduł z `applyBehaviouralRiskToLayers()` (legacy)

### **Główna funkcja (nowy moduł):**
`evaluateBehaviourGuard(input: BehaviourCheckInput): BehaviourDecision`

### **Konfiguracja (.env):**
```bash
# Behavioural risk mode
BEHAVIOURAL_RISK_MODE=normal   # albo: aggressive
# lub
BEHAVIOUR_MODE=normal          # alternatywna nazwa
```

### **Per-Token Progi (Normal Mode):**

| Token | FOMO 1m | FOMO 5m | KNIFE 1m | KNIFE 5m | MinDepth | Spread Boost | Suspend (min) | Notes |
|-------|---------|---------|----------|----------|----------|--------------|---------------|-------|
| **ZEC** | 1.0% | 2.5% | -0.8% | -2.5% | 0.25 | ×1.4 | 2 | Bazowy profil dla bardzo zmiennego ZEC |
| **UNI** | 1.0% | 2.5% | -0.8% | -2.3% | 0.22 | ×1.4 | 3 | Trochę łagodniejszy nóż na 5m |
| **VIRTUAL** | 1.0% | 2.3% | -0.8% | -2.3% | 0.22 | ×1.5 | 3 | AI/Base, podobny profil do UNI |

### **Per-Token Progi (Aggressive Mode):**

| Token | FOMO 1m | FOMO 5m | KNIFE 1m | KNIFE 5m | MinDepth | Spread Boost | Suspend (min) | Notes |
|-------|---------|---------|----------|----------|----------|--------------|---------------|-------|
| **ZEC** | 0.7% | 1.8% | -1.2% | -3.5% | 0.30 | ×1.8 | 4 | Pełna paranoja na noże, mocniejszy panic-filter |
| **UNI** | 0.8% | 2.0% | -1.0% | -3.0% | 0.27 | ×1.8 | 5 | Szybciej łapie FOMO/knife, ale trochę łagodniej niż ZEC |
| **VIRTUAL** | 0.8% | 2.0% | -1.0% | -3.0% | 0.27 | ×1.9 | 5 | Kopia agresywnego UNI |

**📋 Szczegółowa dokumentacja:** Zobacz [BEHAVIOURAL_RISK_THRESHOLDS.md](./BEHAVIOURAL_RISK_THRESHOLDS.md) dla pełnej tabeli, interpretacji parametrów i przykładowych scenariuszy.

### **Jak działa (nowy moduł):**

1. **Detekcja FOMO:**
   - `ret1mPct >= fomo1mPct` lub `ret5mPct >= fomo5mPct`
   - **Akcja:** 
     - `spreadBoost = fomoSpreadBoost` (×1.3-1.9)
     - `sizeMultiplier *= 0.7` (zmniejsza size o 30%)

2. **Detekcja Knife:**
   - `ret1mPct <= knife1mPct` lub `ret5mPct <= knife5mPct`
   - **Akcja:** 
     - `suppressBuys = true` (wyłącza wszystkie BUY)
     - `knifeSuspendedUntilMs = now + suspendMinutes`

3. **Low Depth:**
   - `depthRatio < minDepthRatio`
   - **Akcja:** `sizeMultiplier *= 0.5` (zmniejsza size o 50%)

4. **Knife Cooldown:**
   - Jeśli `nowMs < knifeSuspendedUntilMs` → `suppressBuys = true`

### **Wyjście (BehaviourDecision):**
```typescript
{
  shouldQuote: boolean,        // Czy w ogóle quote'ować
  suppressBuys: boolean,       // Czy wyłączyć BUY warstwy
  spreadBoost: number,         // Mnożnik na makerSpreadBps
  sizeMultiplier: number,      // Mnożnik na sizeUsd
  knifeSuspendedUntilMs?: number, // Timestamp cooldownu
  reason?: string              // Powód decyzji
}
```

### **Wywołania:**
- `executeMultiLayerMM()` - przed wysłaniem orderów
- `executeRegularMM()` - przed wysłaniem orderów
- `executePairMM()` - na początku, przed MM

### **Przykładowy log:**
```
🧠 BehaviouralRisk: suspending BUY quoting for ZEC (knife_detected ret1m=-1.50%, ret5m=-3.20%, depthRatio=0.15)
🧠 BehaviouralRisk: ZEC fomo_guard ret1m=1.20%, ret5m=2.10% spreadBoost=1.3x
🧠 BehaviouralGuard: ZEC decision suppressBuys=true spreadBoost=1.0 sizeMultiplier=0.5 reason=knife_guard_triggered,low_depth
```

---

## 6. **Rotation Filtering & Cooldowns**

### **Cel:**
Filtruje pary z rotacji na podstawie:
- Soft SL cooldown
- Nansen Conflict cooldown
- Notional cap
- Time-based rotation enforce (8h rule)

### **Główna funkcja:**
`applyRotationPairs(rotatedPairs: string[]): Promise<void>`

### **Konfiguracja (.env):**
```bash
# Rotation time limit
ROTATION_MAX_HOLD_HOURS=8  # Max czas w rotacji (8h)
```

### **Filtrowanie:**

1. **Soft SL Cooldown:**
   - `if (isInSoftSlCooldown(pair))` → **SKIP**

2. **Nansen Conflict Cooldown:**
   - `if (isInNansenConflictCooldown(pair))` → **SKIP**

3. **Notional Cap:**
   - `if (isOverNotionalCap(pair, midPrice, position))` → **SKIP**

4. **Time-Based Rotation (8h rule):**
   - `if (isRotationOverdue(pair))` → **FORCE ROTATION OUT**

5. **Sticky Pairs:**
   - `STICKY_PAIRS_IGNORE_CAP=true` → Ignoruje cap dla sticky pairs

### **Funkcje pomocnicze:**
```typescript
isInSoftSlCooldown(pair: string): boolean
isInNansenConflictCooldown(pair: string): boolean
isRotationOverdue(pair: string): boolean
markRotationEntered(pair: string): void
getRotationAgeMs(pair: string): number
getMaxRotationHoldMs(): number
```

### **Przykładowy log:**
```
⏸ Rotation: skipping ZEC – in soft SL cooldown.
⛔ Rotation: skipping ZEC – notional above cap 5000 USD.
[ROTATION] Overdue pairs detected: ZEC (maxHoldHours=8.0)
```

---

## 7. **Position Limits & Max Active Pairs**

### **Cel:**
Ogranicza liczbę aktywnych par jednocześnie.

### **Konfiguracja (.env):**
```bash
MAX_ACTIVE_PAIRS=3  # Max liczba par w rotacji
STICKY_PAIRS=ZEC,UNI,VIRTUAL  # Pary zawsze dozwolone
STICKY_PAIRS_IGNORE_CAP=true  # Ignoruj cap dla sticky pairs
```

### **Jak działa:**

1. **Limit rotacji:**
   - `rotatedPairs.slice(0, MAX_ACTIVE_PAIRS)` - top N par

2. **Sticky pairs:**
   - Zawsze dozwolone, nawet jeśli nie w top N
   - Mogą ignorować notional cap

3. **Cleanup:**
   - Pary poza allowed set → **CLOSE POSITION**
   - Cancel orders → Close position → Log cleanup

### **Przykładowy log:**
```
🧭 Rotation input: rotatedPairs=ZEC,UNI,VIRTUAL | max=3
🧲 Sticky pairs: ZEC, UNI, VIRTUAL
📊 Allowed pairs (rotation + sticky): ZEC, UNI, VIRTUAL (count=3/3)
🧹 Rotation cleanup: closing 1 pairs outside rotation: FIL
```

---

## 8. **Legacy Position Management**

### **Cel:**
Zarządza pozycjami które wyszły z rotacji.

### **Konfiguracja (.env):**
```bash
LEGACY_MAX_LOSS_USD=-100  # Force exit if loss exceeds $100
LEGACY_PROFIT_THRESHOLD_PCT=0.5  # Close if profit > 0.5%
```

### **Jak działa:**

1. **Identyfikacja legacy pairs:**
   - Pozycje które nie są w `activePairs`

2. **Force exit przy dużym loss:**
   - `if (unrealizedPnl < LEGACY_MAX_LOSS_USD)` → **FORCE CLOSE**

3. **Profit taking:**
   - `if (unrealizedPnl > profitThreshold)` → **CLOSE PROFITABLE**

### **Funkcje:**
```typescript
checkAndCloseProfitableLegacyPositions(legacyPairs: string[], assetCtxs: any[]): Promise<void>
```

---

## 9. **Konfiguracja .env**

### **Kompletna lista zmiennych:**

```bash
# ============================================
# SOFT STOP LOSS (Per-Pair)
# ============================================
ZEC_MAX_LOSS_PER_SIDE_USD=120
UNI_MAX_LOSS_PER_SIDE_USD=170
VIRTUAL_MAX_LOSS_PER_SIDE_USD=170
DEFAULT_MAX_LOSS_PER_SIDE_USD=100

PER_PAIR_SOFT_SL_COOLDOWN_MINUTES=60
PER_PAIR_SOFT_SL_COOLDOWN_MINUTES_SEVERE=120
PER_PAIR_SOFT_SL_SEVERE_THRESHOLD_MULTIPLE=1.5

# ============================================
# NANSEN CONFLICT STOP LOSS
# ============================================
NANSEN_CONFLICT_CHECK_ENABLED=true
NANSEN_STRONG_CONTRA_HARD_CLOSE_USD=10
NANSEN_STRONG_CONTRA_MAX_LOSS_USD=25
NANSEN_STRONG_CONTRA_MAX_HOURS=3
NANSEN_CONFLICT_COOLDOWN_MINUTES=30
NANSEN_CONFLICT_COOLDOWN_MINUTES_SEVERE=60
NANSEN_CONFLICT_SEVERE_THRESHOLD_MULTIPLE=1.5

NANSEN_CLOSE_COST_DEFAULT_BPS=20
NANSEN_CLOSE_COST_SPREAD_MULTIPLIER=0.5

# ============================================
# DAILY LOSS LIMIT (Global)
# ============================================
MAX_DAILY_LOSS_USD=200

# ============================================
# NOTIONAL CAPS (Per-Pair)
# ============================================
ROTATION_TARGET_PER_PAIR_USD=3500
ROTATION_MAX_PER_PAIR_USD=5000
TOTAL_CAPITAL_USD=25000

# ============================================
# BEHAVIOURAL RISK (Anti-FOMO / Anti-Knife)
# ============================================
BEHAVIOURAL_RISK_MODE=normal  # albo: aggressive

# ============================================
# ROTATION LIMITS
# ============================================
MAX_ACTIVE_PAIRS=3
ROTATION_MAX_HOLD_HOURS=8
STICKY_PAIRS=ZEC,UNI,VIRTUAL
STICKY_PAIRS_IGNORE_CAP=true

# ============================================
# LEGACY POSITIONS
# ============================================
LEGACY_MAX_LOSS_USD=-100
LEGACY_PROFIT_THRESHOLD_PCT=0.5
```

---

## 10. **Przykładowe Logi**

### **Soft SL Hit:**
```
[RISK] ❌ SOFT SL HIT on ZEC: uPnL $-95.50 < -$72.00
🧠 [NANSEN] ZEC marked as AVOID → tightening soft SL to 60% (maxLoss=72.00)
⏸ Rotation: skipping ZEC – in soft SL cooldown.
```

### **Nansen Conflict:**
```
🛑 [NANSEN CONFLICT SL] Closing LONG on ZEC (PnL: $-22.50, threshold: $-20) - position against Nansen SHORT STRONG bias +3.5
[NANSEN-SL] Skip close | pair=UNI severity=4.5 notional=$500.00 cost=$1.20 risk=$0.80
```

### **Notional Cap:**
```
⚠️ ZEC: position notional 5200.00 USD > cap 5000. Skipping new maker orders.
⛔ Rotation: skipping ZEC – notional above cap 5000 USD.
```

### **Behavioural Risk:**
```
🧠 BehaviouralRisk: suspending BUY quoting for ZEC (knife_detected ret1m=-1.50%, ret5m=-3.20%, depthRatio=0.15)
🧠 BehaviouralRisk: ZEC fomo_guard ret1m=1.20%, ret5m=2.10%
```

### **Daily Loss Limit:**
```
[RISK] ❌ DAILY LOSS LIMIT HIT: $-205.50 < -$200.00
🛑 Bot stopped due to daily loss limit
```

### **Rotation:**
```
🧭 Rotation input: rotatedPairs=ZEC,UNI,VIRTUAL | max=3
[ROTATION] Overdue pairs detected: ZEC (maxHoldHours=8.0)
🧹 Rotation cleanup: closing 1 pairs outside rotation: FIL
```

---

## 🎯 **Podsumowanie - Hierarchia Ochrony**

### **Warstwa 1: Prewencja (zanim wejdziesz w pozycję)**
1. **Behavioural Risk** - Zapobiega FOMO/knife, koryguje spread/size przed wystawieniem orderów
2. **Notional Caps** - Zapobiega nadmiernej ekspozycji per para
3. **Rotation Filtering** - Filtruje toksyczne pary z rotacji
4. **Position Limits** - Ogranicza liczbę aktywnych par

### **Warstwa 2: Ochrona (gdy już jesteś w pozycji)**
5. **Soft SL** (Per-Pair) - Podstawowa ochrona per para, zamyka przy przekroczeniu limitu
6. **Nansen Conflict SL** - Zaawansowana ochrona dla konfliktów z bias

### **Warstwa 3: Ostatnia linia obrony (global)**
7. **Daily Loss Limit** (Global) - Zatrzymuje bota przy przekroczeniu dziennego limitu
8. **Legacy Position Management** - Zarządza pozycjami poza rotacją

### **Jak działają razem:**

```
┌─────────────────────────────────────────┐
│ 1. Behavioural Guard                    │ ← Nie wchodź głupio (FOMO/knife)
│    ↓ shouldQuote? suppressBuys?        │
│    ↓ spreadBoost, sizeMultiplier       │
├─────────────────────────────────────────┤
│ 2. Notional Cap Check                   │ ← Nie przekraczaj cap per para
│    ↓ isOverNotionalCap?                │
├─────────────────────────────────────────┤
│ 3. Execute MM (Multi-Layer / Regular)    │ ← Wystaw zlecenia
│    ↓ placeOrders()                     │
├─────────────────────────────────────────┤
│ 4. Soft SL Check                        │ ← Jeśli pozycja traci, zamknij
│    ↓ enforcePerPairRisk()              │
├─────────────────────────────────────────┤
│ 5. Nansen Conflict SL Check             │ ← Jeśli konflikt z bias, zamknij
│    ↓ checkNansenConflictStopLoss()     │
├─────────────────────────────────────────┤
│ 6. Daily Loss Limit Check               │ ← Jeśli dzień zły, stop bot
│    ↓ dailyPnl < -MAX_DAILY_LOSS?        │
└─────────────────────────────────────────┘
```

**Wszystkie mechanizmy działają razem** tworząc wielowarstwowy system ochrony kapitału:
- **Prewencja** (warstwa 1) - zapobiega złym decyzjom
- **Ochrona** (warstwa 2) - chroni przed dużymi stratami
- **Ostatnia linia** (warstwa 3) - zatrzymuje bota w ekstremalnych sytuacjach

---

## 11. **Jak Sprawdzić w Logach, Czy Wszystkie Warstwy Działają**

### **🔍 A. Soft SL / Per-Pair Max Loss**

**Komendy:**
```bash
cd /root/hyperliquid-mm-bot-complete
grep "SOFT SL HIT" bot.log | tail -n 20
```

**Lub przez journalctl:**
```bash
journalctl -u mm-bot.service --since "today" --no-pager | grep "SOFT SL"
```

**Co szukać:**
- Linijki w stylu: `[RISK] ❌ SOFT SL HIT on ZEC: uPnL $-95.50 < -$72.00`
- Dopisek z Nansen: `🧠 [NANSEN] ZEC marked as AVOID → tightening soft SL to 60% (maxLoss=72.00)`

**Potwierdzenie działania:**
- ✅ Per-pair limit z .env działa (ZEC: 120, UNI/VIRTUAL: 170)
- ✅ Nansen hook zmienia limit zgodnie z risk level (60%/80%/100%)

---

### **🔍 B. Nansen Conflict Stop Loss**

**Komendy:**
```bash
cd /root/hyperliquid-mm-bot-complete
grep "NANSEN CONFLICT SL" bot.log | tail -n 20
```

**Cost-benefit check:**
```bash
grep "NANSEN-SL" bot.log | tail -n 20
```

**Co szukać:**
- Wpisy z severity i notional: `severity=4.5 notional=$500.00 cost=$1.20 risk=$0.80`
- Czy przy wysokim severity faktycznie jest full/partial close zgodnie z regułami 30/60/100%

**Potwierdzenie działania:**
- ✅ Nansen Conflict SL triggeruje przy konflikcie bias
- ✅ Cost-benefit check działa (skip gdy cost > risk)
- ✅ Tiered close działa (30%/60%/100% w zależności od severity)

---

### **🔍 C. Behavioural Risk (Anti-FOMO / Anti-Knife)**

**Komendy:**
```bash
cd /root/hyperliquid-mm-bot-complete
grep "BehaviouralRisk" bot.log | tail -n 50
```

**Lub:**
```bash
grep "BehaviouralGuard" bot.log | tail -n 50
```

**Typowe logi:**
- **FOMO guard:** `🧠 BehaviouralRisk: ZEC fomo_guard ret1m=1.20%, ret5m=2.10% spreadBoost=1.4x`
- **Knife guard:** `🧠 BehaviouralRisk: suspending BUY quoting for ZEC (knife_detected ret1m=-1.50%, ret5m=-3.20%, depthRatio=0.15)`

**Potwierdzenie działania:**
- ✅ Po FOMO guard: BUY warstwy są odsuwane (spread boost), size zmniejszony
- ✅ Po knife guard: BUY warstwy wyłączone, SELL dalej działają
- ✅ W logach order-buildera: `built BUY layers: 0` vs `SELL layers: 3`

---

### **🔍 D. Notional Caps (Żeby ZEC Nie Zrobił 20k)**

**Komendy:**
```bash
cd /root/hyperliquid-mm-bot-complete
grep "notional" bot.log | tail -n 50
```

**Lub:**
```bash
grep "position notional" bot.log | tail -n 50
```

**Oczekiwany format:**
- `⚠️ ZEC: position notional 5200.00 USD > cap 5000. Skipping new maker orders.`
- `⛔ Rotation: skipping ZEC – notional above cap 5000 USD.`

**Potwierdzenie działania:**
- ✅ Cap 5k działa (ROTATION_MAX_PER_PAIR_USD)
- ✅ Bot przestaje dokładać nowe warstwy, gdy para jest przegrzana
- ✅ Para jest wykluczona z rotacji przy przekroczeniu cap

---

### **🔍 E. Daily Loss Limit**

**Komendy:**
```bash
cd /root/hyperliquid-mm-bot-complete
grep "DAILY LOSS LIMIT" bot.log | tail -n 10
```

**Lub:**
```bash
grep "daily.*loss" bot.log -i | tail -n 10
```

**Oczekiwany format:**
- `[RISK] ❌ DAILY LOSS LIMIT HIT: $-205.50 < -$200.00`
- `🛑 Bot stopped due to daily loss limit`

**Potwierdzenie działania:**
- ✅ Bot zatrzymuje się przy przekroczeniu MAX_DAILY_LOSS_USD (200 USD)
- ✅ Wszystkie operacje są zatrzymane

---

### **🔍 F. Rotation Filtering**

**Komendy:**
```bash
cd /root/hyperliquid-mm-bot-complete
grep "Rotation:" bot.log | tail -n 30
```

**Oczekiwane logi:**
- `⏸ Rotation: skipping ZEC – in soft SL cooldown.`
- `⛔ Rotation: skipping ZEC – notional above cap 5000 USD.`
- `[ROTATION] Overdue pairs detected: ZEC (maxHoldHours=8.0)`

**Potwierdzenie działania:**
- ✅ Pary w cooldownie są wykluczane z rotacji
- ✅ Pary ponad cap są wykluczane z rotacji
- ✅ Time-based rotation enforce działa (8h rule)

---

### **📊 Przykładowe Scenariusze Testowe**

#### **Scenariusz 1: ZEC Knife Detection**
1. **Warunek:** ZEC spada o -1.5% w 1m (normal mode: threshold -0.8%)
2. **Oczekiwany log:** `🧠 BehaviouralRisk: suspending BUY quoting for ZEC (knife_detected ret1m=-1.50%...)`
3. **Oczekiwane zachowanie:** BUY warstwy wyłączone na 2 min (normal) / 4 min (aggressive)
4. **Weryfikacja:** W logach order-buildera brak BUY orderów dla ZEC

#### **Scenariusz 2: UNI FOMO Pump**
1. **Warunek:** UNI rośnie o +1.2% w 1m (normal mode: threshold +1.0%)
2. **Oczekiwany log:** `🧠 BehaviouralRisk: UNI fomo_guard ret1m=1.20% spreadBoost=1.4x`
3. **Oczekiwane zachowanie:** BUY warstwy odsunięte (spread ×1.4), size zmniejszony o 30%
4. **Weryfikacja:** W logach order-buildera BUY ordery mają wyższe ceny (dalsze od mid)

#### **Scenariusz 3: ZEC Soft SL Hit**
1. **Warunek:** ZEC unrealized PnL = -$95 (limit: -$72 po Nansen adjust)
2. **Oczekiwany log:** `[RISK] ❌ SOFT SL HIT on ZEC: uPnL $-95.50 < -$72.00`
3. **Oczekiwane zachowanie:** Pozycja zamknięta, cooldown ustawiony na 60-120 min
4. **Weryfikacja:** W logach pozycja zamknięta, para w cooldownie

#### **Scenariusz 4: VIRTUAL Notional Cap**
1. **Warunek:** VIRTUAL notional = $5200 (cap: $5000)
2. **Oczekiwany log:** `⚠️ VIRTUAL: position notional 5200.00 USD > cap 5000. Skipping new maker orders.`
3. **Oczekiwane zachowanie:** Bot nie dodaje nowych orderów, para wykluczona z rotacji
4. **Weryfikacja:** W logach brak nowych orderów dla VIRTUAL, para nie w rotacji

---

### **✅ Checklist: Wszystkie Warstwy Działają**

Po sprawdzeniu logów powinieneś zobaczyć:

- [ ] **Soft SL:** Logi "SOFT SL HIT" z prawidłowymi limitami per para
- [ ] **Nansen SL:** Logi "NANSEN CONFLICT SL" z severity i cost-benefit
- [ ] **Behavioural Risk:** Logi "fomo_guard" i "knife_detected" z prawidłowymi triggerami
- [ ] **Notional Caps:** Logi "position notional > cap" przy przekroczeniu 5k
- [ ] **Daily Loss Limit:** Logi "DAILY LOSS LIMIT HIT" przy przekroczeniu 200 USD
- [ ] **Rotation Filtering:** Logi "skipping" dla par w cooldownie / ponad cap

**Jeśli wszystkie checkboxy są zaznaczone → system risk management działa poprawnie!** ✅

---

## 🔍 **Jak w 5 minut sprawdzić, czy wszystkie zabezpieczenia działają (z logów)**

### **Cel:**
W kilka komend zobaczyć, czy Soft SL, Nansen Conflict SL, Anti-FOMO/Knife, notional cap i daily loss limit faktycznie się odpalają.

### **🔧 Uwaga do terminala:**
- Wklejaj jedną linię na raz
- Nie wstawiaj komentarzy po komendach (z prawej strony), bo zsh potrafi się obrazić

---

### **1. Soft Stop Loss (per para)**

**Co sprawdzamy:**
Czy przy większej stracie na ZEC/UNI/VIRTUAL bot faktycznie:
- loguje trafienie Soft SL
- pokazuje poprawny limit (po Nansen-adjust)
- wchodzi w cooldown

**Komenda:**
```bash
cd /root/hyperliquid-mm-bot-complete
grep "SOFT SL" bot.log | tail -n 30
```

**Na co patrzeć w logach:**
- Linie w stylu:
  ```
  [RISK] ❌ SOFT SL HIT on ZEC: uPnL $-95.50 < -$72.00
  🧠 [NANSEN] ZEC marked as AVOID → tightening soft SL to 60% (maxLoss=72.00)
  ```
- Dla UNI / VIRTUAL wartości limitów ~170 USD (albo 80% / 60% tego, jeśli caution / avoid)

**Interpretacja:**
- ✅ Jeśli widzisz `SOFT SL HIT on ...` oraz `maxLoss=` z sensowną wartością → Soft SL działa i Nansen hook też
- ⚠️ Jeśli nigdy nie ma takich logów mimo dużych strat → coś jest nie tak (warto wtedy sprawdzić warunki wywołania `enforcePerPairRisk`)

---

### **2. Nansen Conflict Stop Loss**

**Co sprawdzamy:**
Czy pozycje przeciwko mocnemu Nansen bias:
- są wykrywane jako konflikt
- dostają severity (0–10)
- są zamykane częściowo / w całości zgodnie z zasadami

**Komendy:**
```bash
cd /root/hyperliquid-mm-bot-complete
grep "NANSEN CONFLICT SL" bot.log | tail -n 30
```

oraz:
```bash
grep "NANSEN-SL" bot.log | tail -n 30
```

**Na co patrzeć:**
- Log twardego/miękkiego SL:
  ```
  🛑 [NANSEN CONFLICT SL] Closing LONG on ZEC (PnL: $-22.50, threshold: $-20) - position against Nansen SHORT STRONG bias +3.5
  ```
- Decyzje cost-benefit:
  ```
  [NANSEN-SL] Skip close | pair=UNI severity=4.5 notional=$500.00 cost=$1.20 risk=$0.80
  ```

**Interpretacja:**
- ✅ Jeśli jest konflikt, severity wysokie i widzisz `Closing ...` → Nansen Conflict SL działa
- ✅ Jeśli severity niskie i widzisz `Skip close (risk < cost)` → działa cost-benefit check
- ⚠️ Jeśli nie ma żadnych logów, a masz konflikty i straty → konflikt SL mógł nie być wywoływany

---

### **3. Anti-FOMO / Anti-Knife (Behavioural Risk)**

**Co sprawdzamy:**
Czy bot:
- odsuwa BUY warstwy kiedy rynek pompuje (FOMO)
- wyłącza BUY warstwy kiedy łapiemy spadający nóż

**Komenda:**
```bash
cd /root/hyperliquid-mm-bot-complete
grep "BehaviouralRisk" bot.log | tail -n 50
```

**Typowe logi:**
- **FOMO guard:**
  ```
  🧠 BehaviouralRisk: ZEC fomo_guard ret1m=1.20%, ret5m=2.10%
  ```
- **Spadający nóż / panika:**
  ```
  🧠 BehaviouralRisk: suspending BUY quoting for ZEC (knife_detected ret1m=-1.50%, ret5m=-3.20%, depthRatio=0.15)
  ```

**Interpretacja:**
- ✅ Jak przy dużym ruchu w górę widzisz `fomo_guard` → BUY warstwy są odsuwane (spread boost)
- ✅ Jak przy ostrym spadku / płytkiej książce widzisz `suspending BUY quoting` → BUY są wyłączone, powinny zostać tylko SELL

**Żeby to potwierdzić głębiej:**
Możesz też podejrzeć logi z budowania warstw (jeśli są logowane), np. `built BUY layers=0 SELL layers=3` zaraz po `suspending BUY quoting`.

---

### **4. Per-pair Notional Cap (żeby ZEC nie robił 20k USD)**

**Co sprawdzamy:**
Czy bot przestaje dokładać nowe zlecenia, gdy pozycja na parze przekroczy cap (np. 5k USD).

**Komenda:**
```bash
cd /root/hyperliquid-mm-bot-complete
grep "notional" bot.log | tail -n 50
```

**Na co patrzeć:**
- Logi typu:
  ```
  ⚠️ ZEC: position notional 5200.00 USD > cap 5000. Skipping new maker orders.
  ⛔ Rotation: skipping ZEC – notional above cap 5000 USD.
  ```

**Interpretacja:**
- ✅ Jeśli widzisz takie logi, to cap działa – bot nadal może zarządzać pozycją (zamykać), ale nie buduje nowej ekspozycji
- ⚠️ Jeśli widzisz notional 8k, 10k bez żadnego `> cap` → coś trzeba sprawdzić w `isOverNotionalCap`

---

### **5. Daily Loss Limit (globalny kaganiec)**

**Co sprawdzamy:**
Czy przy dużej stracie dziennej bot zatrzymuje się.

**Komenda:**
```bash
cd /root/hyperliquid-mm-bot-complete
grep "DAILY LOSS LIMIT" bot.log | tail -n 10
```

**Na co patrzeć:**
- Log typu:
  ```
  [RISK] ❌ DAILY LOSS LIMIT HIT: $-205.50 < -$200.00
  🛑 Bot stopped due to daily loss limit
  ```

**Interpretacja:**
- ✅ Jeśli hitnie limit i widzisz komunikat o zatrzymaniu bota → globalny kaganiec działa
- ⚠️ Po takim evencie bot nie powinien dalej składać nowych orderów (możesz to sprawdzić w logach złożonych zleceń po tym czasie)

---

## 🎬 **3 Przykładowe Scenariusze – Jak Powinny Wyglądać Logi**

Poniżej masz trzy sytuacje, które możesz mentalnie "odpalić" i sprawdzić, czy logi zachowywałyby się zgodnie z oczekiwaniami.

---

### **🩸 Scenariusz 1 – ZEC łapie "spadający nóż"**

**Sytuacja:**
- ZEC spada −1.6% w 1m, −3.2% w 5m
- Orderbook się przerzedza (depthRatio ≈ 0.15)
- Masz już otwartą pozycję LONG, która zaczyna wchodzić w stratę

**Oczekiwane logi:**

1. **Behavioural risk wykrywa nóż:**
   ```
   🧠 BehaviouralRisk: suspending BUY quoting for ZEC (knife_detected ret1m=-1.60%, ret5m=-3.20%, depthRatio=0.15)
   ```

2. **W kolejnych iteracjach dla ZEC:**
   - Brak logów tworzenia BUY layers (ew. info typu `buy_layers=0 sell_layers=3`)
   - Być może zobaczysz Soft SL, jeśli strata przekroczy limit:
     ```
     [RISK] ❌ SOFT SL HIT on ZEC: uPnL $-95.50 < -$72.00
     ```

3. **Po czasie cooldownu behaviourala** (np. 2–5 min w zależności od trybu) powinny wrócić logi z normalnym quotingiem BUY.

---

### **🚀 Scenariusz 2 – UNI wchodzi w FOMO pump**

**Sytuacja:**
- UNI rośnie +1.2% w 1m i +2.1% w 5m
- Volume wysokie, spread rośnie, ale nie chcesz kupować na samych szczytach

**Oczekiwane logi:**

1. **FOMO guard:**
   ```
   🧠 BehaviouralRisk: UNI fomo_guard ret1m=1.20%, ret5m=2.10%
   ```

2. **W tej samej iteracji/tuż po:**
   - BUY warstwy ustawione dalej od mid price (nie widać tego bezpośrednio w logu, ale w order-builderze możesz zobaczyć większy spread po stronie BID)
   - SELL warstwy mogą zostać bliżej rynku – możesz sprzedawać w FOMO, nie dokupujesz agresywnie

3. **Jeśli mimo wszystko rynek zawróci i zacznie się robić strata:**
   - Soft SL przejmie pałeczkę, jeśli przekroczysz per-pair limit
   - Ewentualnie Nansen Conflict SL, jeśli FOMO idzie wbrew smart flow

---

### **🧠 Scenariusz 3 – VIRTUAL w konflikcie z Nansen bias**

**Sytuacja:**
- Masz LONG na VIRTUAL
- Nansen zaczyna raportować mocny SHORT bias (bias_strength wysoki, smart_money_netflows ujemne)
- Pozycja jest na stracie −22 USD

**Oczekiwane logi:**

1. **Detekcja konfliktu:**
   ```
   [NANSEN CONFLICT] Detected contra position on VIRTUAL: position=LONG bias=SHORT strong=3.5
   ```

2. **Cost-benefit i severity:**
   ```
   [NANSEN-SL] Decision | pair=VIRTUAL severity=8.2 notional=$600.00 cost=$1.80 risk=$5.40
   ```

3. **Przy high severity (≥ 8) – pełne zamknięcie:**
   ```
   🛑 [NANSEN CONFLICT SL] Closing LONG on VIRTUAL (PnL: $-22.00, threshold: $-20.00) - strong contra bias
   ```

4. **Po tym – cooldown na Nansen Conflict dla VIRTUAL:**
   - Rotacja powinna przez jakiś czas omijać VIRTUAL
   - W logach rotacji pojawi się coś typu:
     ```
     Rotation: skipping VIRTUAL – in Nansen conflict cooldown.
     ```

---

### **💡 Quick Runbook: Dziwna Strata na Parze X**

Jeśli widzisz dziwną stratę na parze X, wykonaj te 3 komendy:

```bash
cd /root/hyperliquid-mm-bot-complete

# 1. Sprawdź czy Soft SL zadziałał
grep "SOFT SL.*X" bot.log | tail -n 10

# 2. Sprawdź czy Nansen Conflict SL zadziałał
grep "NANSEN.*X" bot.log | tail -n 10

# 3. Sprawdź czy Behavioural Risk zadziałał
grep "BehaviouralRisk.*X" bot.log | tail -n 10
```

**Interpretacja:**
- Jeśli **wszystkie 3 są puste** → żaden mechanizm nie zadziałał, warto sprawdzić dlaczego
- Jeśli **tylko Soft SL** → pozycja przekroczyła limit, ale nie było FOMO/knife ani konfliktu z Nansen
- Jeśli **tylko Behavioural Risk** → bot wykrył FOMO/knife, ale pozycja nie przekroczyła jeszcze limitu Soft SL
- Jeśli **tylko Nansen Conflict SL** → pozycja była przeciwko bias, ale nie przekroczyła Soft SL limitu

---

### **✅ Checklist: Wszystkie Warstwy Działają (5-minutowy test)**

Po sprawdzeniu logów powinieneś zobaczyć:

- [ ] **Soft SL:** Logi "SOFT SL HIT" z prawidłowymi limitami per para
- [ ] **Nansen SL:** Logi "NANSEN CONFLICT SL" z severity i cost-benefit
- [ ] **Behavioural Risk:** Logi "fomo_guard" i "knife_detected" z prawidłowymi triggerami
- [ ] **Notional Caps:** Logi "position notional > cap" przy przekroczeniu 5k
- [ ] **Daily Loss Limit:** Logi "DAILY LOSS LIMIT HIT" przy przekroczeniu 200 USD
- [ ] **Rotation Filtering:** Logi "skipping" dla par w cooldownie / ponad cap

**Jeśli wszystkie checkboxy są zaznaczone → system risk management działa poprawnie!** ✅


---

## 🧩 **RUNBOOK: Jak sprawdzić, które zabezpieczenie zadziałało (w 60 sekund)**

### **Cel:**
NATYCHMIAST zobaczyć:
- które zabezpieczenie zadziałało
- które NIE zadziałało
- które było ostatnim wyzwalaczem strat lub przerwania trade'u

### **⚠️ Zasady terminala (dla zsh):**
- Wklejaj jedną linię na raz
- Bez komentarzy `#` w tej samej linii
- Wieloliniowe — wklejaj linia po linii

---

### **✅ KROK 1 — Najpierw: jaka para sprawia problem?**

Jeśli widzisz dziwne zachowanie na ZEC, UNI lub VIRTUAL:

```bash
cd /root/hyperliquid-mm-bot-complete
grep "ZEC" -i bot.log | tail -n 50
grep "UNI" -i bot.log | tail -n 50
grep "VIRTUAL" -i bot.log | tail -n 50
```

**Poszukaj słów kluczowych:**
- `SOFT SL`, `CONFLICT`, `knife`, `fomo`, `cap`, `rotation`, `cooldown`

---

### **✅ KROK 2 — Czy działał Soft Stop Loss?**

```bash
grep "SOFT SL" bot.log | tail -n 20
```

**Interpretacja:**

| Log | Co znaczy? |
|-----|------------|
| `SOFT SL HIT` | Pozycja była zbyt stratna i została zamknięta |
| `maxLoss=72` lub `96` | Nansen-hook zaostrzył limit (avoid/caution) |
| `in soft SL cooldown` | Para jest czasowo wyłączona z rotacji |

⚠️ **Jeżeli para NIGDY nie ma soft SL mimo dużych strat → coś nie działa.**

---

### **✅ KROK 3 — Czy odpalił Nansen Conflict Stop Loss?**

```bash
grep "NANSEN CONFLICT" bot.log | tail -n 30
grep "NANSEN-SL" bot.log | tail -n 30
```

**Interpretacja:**

| Log | Znaczenie |
|-----|-----------|
| `contra position` | Bot znalazł konflikt z Nansen bias |
| `severity=8+` | Mocny konflikt → powinno zamknąć |
| `full close 100%` | Zamknięcie pełne |
| `partial close 60%` | Zamknięcie częściowe |
| `skip close (cost > risk)` | Cost-benefit check ocalił |

⚠️ **Brak logów tutaj, gdy bias był przeciwny i pozycja traciła → do sprawdzenia.**

---

### **✅ KROK 4 — Czy Anti-FOMO działało?**

```bash
grep "fomo_guard" bot.log | tail -n 20
```

**Interpretacja:**

| Log | Znaczenie |
|-----|-----------|
| `fomo_guard ret1m=... ret5m=...` | Buy-layer przesunięty dalej od rynku (nie kupujemy topu) |
| Brak logów mimo 1–2% pump | Może threshold za wysoki / tryb aggressive potrzebny |

---

### **✅ KROK 5 — Czy Anti-Knife (spadający nóż) zadziałał?**

```bash
grep "suspending BUY quoting" bot.log | tail -n 20
grep "knife" bot.log | tail -n 20
```

**Interpretacja:**

| Log | Co to znaczy |
|-----|-------------|
| `suspending BUY quoting` | BUY warstwy WYŁĄCZONE |
| `depthRatio=0.15` | Orderbook za płytki |
| `ret1m ret5m duże na minusie` | Detekcja panic dump |

⚠️ **Jeśli widzisz duży dump, a brak takich logów → problem.**

---

### **✅ KROK 6 — Czy cap na pozycję działa (żeby ZEC nie urósł do 20k)?**

```bash
grep "notional" bot.log | tail -n 30
```

**Interpretacja:**

| Log | Znaczenie |
|-----|-----------|
| `notional 5200.00 USD > cap 5000` | Cap działa |
| `Skipping new maker orders` | Bot nie rozbudowywał dalej pozycji |
| Brak logów, a pozycja 7k, 10k | Cap NIEDZIAŁA |

---

### **✅ KROK 7 — Czy Rotation filtrował pary poprawnie?**

```bash
grep "Rotation" bot.log | tail -n 40
```

**Szukaj:**
- `in soft SL cooldown`
- `in Nansen conflict cooldown`
- `skipping ZEC – notional above cap`
- `overdue pairs detected`
- `Rotation cleanup`

⚠️ **Jeśli rotacja NIGDY nie filtruje par → też coś nie gra.**

---

### **✅ KROK 8 — Czy Daily Loss Limit odpalił?**

```bash
grep "DAILY LOSS LIMIT" bot.log | tail -n 10
```

**Logi:**

| Log | Znaczenie |
|-----|-----------|
| `[RISK] ❌ DAILY LOSS LIMIT HIT` | Limit działa, bot zatrzymany |
| `Bot stopped due to daily loss limit` | Pełne zatrzymanie |

⚠️ **Jeżeli nie zatrzymał się mimo ogromnej straty → problem.**

---

### **🎯 KROK 9 — Szybka identyfikacja "winnego"**

Możesz w 3 liniach sprawdzić WSZYSTKO:

```bash
grep -E "SOFT SL|NANSEN|fomo|knife|notional|DAILY LOSS" bot.log | tail -n 100
```

**Interpretacja:**
- Jeśli jako **ostatni log jest SOFT SL** → winny soft SL
- Jeśli **NANSEN CONFLICT SL** → bias wielkich graczy
- Jeśli **knife_detected / fomo_guard** → behavioural risk
- Jeśli **cap >** → notional limiter
- Jeśli **brak czegokolwiek** → problem w pipeline risk management

---

### **📦 Automatyczny skrypt diagnostyczny**

Zamiast wykonywać wszystkie kroki ręcznie, możesz użyć skryptu:

```bash
./scripts/risk-diagnostic.sh ZEC
```

Skrypt automatycznie wykona wszystkie 8 kroków i wygeneruje gotowy raport.

**Zobacz:** [scripts/risk-diagnostic.sh](./scripts/risk-diagnostic.sh) dla szczegółów.

**Przykładowy output:**
```
🔍 Risk Management Diagnostic Report
====================================
Para: ZEC
Log: /root/hyperliquid-mm-bot-complete/bot.log

📊 KROK 1: Ogólne logi dla ZEC
----------------------------------------
[RISK] ❌ SOFT SL HIT on ZEC: uPnL $-95.50 < -$72.00
...

📊 KROK 2: Soft Stop Loss
-------------------------
[RISK] ❌ SOFT SL HIT on ZEC: uPnL $-95.50 < -$72.00
...

✅ Diagnostic complete!
```
