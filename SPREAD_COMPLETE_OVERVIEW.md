# 📊 Spread - Kompletny Przegląd Jak Jest Liczony i Dynamicznie Modyfikowany

## 📋 **Spis Treści**

1. [Bazowy Spread (Base Spread)](#1-bazowy-spread-base-spread)
2. [Regular MM - Spread Calculation](#2-regular-mm---spread-calculation)
3. [Multi-Layer MM - Spread Calculation](#3-multi-layer-mm---spread-calculation)
4. [Inventory Skew Adjustments](#4-inventory-skew-adjustments)
5. [Nansen Bias Adjustments](#5-nansen-bias-adjustments)
6. [Behavioural Risk Spread Boost (FOMO)](#6-behavioural-risk-spread-boost-fomo)
7. [Chase Mode Volatility Adjustments](#7-chase-mode-volatility-adjustments)
8. [Dynamiczne Modyfikacje Spread](#8-dynamiczne-modyfikacje-spread)
9. [Przykłady Obliczeń](#9-przykłady-obliczeń)
10. [Konfiguracja .env](#10-konfiguracja-env)

---

## 1. **Bazowy Spread (Base Spread)**

### **Konfiguracja:**
```bash
MAKER_SPREAD_BPS=40  # Domyślnie 40 bps (0.40%)
```

### **Gdzie jest używany:**
- **Regular MM:** `this.makerSpreadBps` (linia 2210 w `mm_hl.ts`)
- **Multi-Layer MM:** Warstwy mają własne `offsetBps` (definiowane w `GridManager`)

### **Jednostki:**
- **BPS (Basis Points):** 1 bps = 0.01% = 1/10000
- **Przykład:** 40 bps = 0.40% = 0.004

---

## 2. **Regular MM - Spread Calculation**

### **Lokalizacja:** `executeRegularMM()` w `src/mm_hl.ts` (linie 3678-3684)

### **Formuła:**
```typescript
// 1. Bazowy spread z tuning factor
const adjustedSpread = this.makerSpreadBps * this.tuning.makerSpreadFactor

// 2. Konwersja na factor (0.004 dla 40 bps)
const spreadFactor = adjustedSpread / 10000

// 3. Obliczenie cen bid/ask
const bidPrice = midPrice * (1 - spreadFactor)  // Np. 100 * (1 - 0.004) = 99.60
const askPrice = midPrice * (1 + spreadFactor)  // Np. 100 * (1 + 0.004) = 100.40
```

### **Przykład:**
- **Mid Price:** $100.00
- **MAKER_SPREAD_BPS:** 40 bps
- **tuning.makerSpreadFactor:** 1.0 (100%)
- **adjustedSpread:** 40 bps
- **spreadFactor:** 0.004
- **Bid Price:** $100.00 × (1 - 0.004) = **$99.60**
- **Ask Price:** $100.00 × (1 + 0.004) = **$100.40**
- **Spread:** $0.80 (0.80%)

### **Tuning Factor:**
- `this.tuning.makerSpreadFactor` - dynamiczny mnożnik (domyślnie 1.0)
- Może być modyfikowany przez adaptive tuning system

---

## 3. **Multi-Layer MM - Spread Calculation**

### **Lokalizacja:** `GridManager.generateGridOrders()` w `src/utils/grid_manager.ts`

### **Warstwy (Layers):**
Każda warstwa ma własny `offsetBps`:

```typescript
// Przykładowe warstwy (z GridManager):
L1: offsetBps = 20  // 0.20% od mid
L2: offsetBps = 40  // 0.40% od mid
L3: offsetBps = 60  // 0.60% od mid
L4: offsetBps = 80  // 0.80% od mid (parking)
L5: offsetBps = 100 // 1.00% od mid (parking)
```

### **Formuła dla każdej warstwy:**
```typescript
// 1. Bazowy offset warstwy
let bidOffsetBps = layer.offsetBps  // Np. 20 bps dla L1

// 2. Inventory skew adjustment
bidOffsetBps += this.getInventoryAdjustment(inventorySkew, 'bid')

// 3. Nansen bias adjustment
if (nansenBias === 'long') {
  bidOffsetBps *= tightenFactor  // Np. ×0.7 dla strong bias
  askOffsetBps *= widenFactor      // Np. ×1.3 dla strong bias
}

// 4. Stagger (różne ceny w ramach warstwy)
const staggerBps = i * 2  // 0, 2, 4, 6... bps per order

// 5. Finalna cena
const bidPrice = midPrice * (1 - (bidOffsetBps + staggerBps) / 10000)
const askPrice = midPrice * (1 + (askOffsetBps + staggerBps) / 10000)
```

### **Przykład (L1, mid=$100, inventorySkew=0, nansenBias=neutral):**
- **Base offset:** 20 bps
- **Inventory adjustment:** 0 bps
- **Nansen adjustment:** ×1.0 (neutral)
- **Stagger (order 0):** 0 bps
- **Final bidOffset:** 20 bps
- **Bid Price:** $100 × (1 - 20/10000) = **$99.80**
- **Ask Price:** $100 × (1 + 20/10000) = **$100.20**

---

## 4. **Inventory Skew Adjustments**

### **Lokalizacja:** `GridManager.getInventoryAdjustment()` w `src/utils/grid_manager.ts` (linie 281-295)

### **Formuła:**
```typescript
private getInventoryAdjustment(skew: number, side: 'bid' | 'ask'): number {
  const skewThreshold = 0.15  // 15% skew
  
  if (Math.abs(skew) < skewThreshold) {
    return 0  // Brak adjustment jeśli skew < 15%
  }
  
  // ±10 bps per 15% skew
  const adjustmentBps = (skew / skewThreshold) * 10
  
  return side === 'bid'
    ? adjustmentBps      // Positive skew = widen bids (+10 bps)
    : -adjustmentBps     // Positive skew = narrow asks (-10 bps)
}
```

### **Logika:**
- **Net Long (skew > 0):**
  - **Bid:** +adjustment (szerzej, trudniej kupić)
  - **Ask:** -adjustment (wężej, łatwiej sprzedać)
  
- **Net Short (skew < 0):**
  - **Bid:** -adjustment (wężej, łatwiej kupić)
  - **Ask:** +adjustment (szerzej, trudniej sprzedać)

### **Przykład (skew = +30% = 0.30):**
- **skewThreshold:** 0.15 (15%)
- **adjustmentBps:** (0.30 / 0.15) × 10 = **20 bps**
- **Bid adjustment:** +20 bps (szerzej)
- **Ask adjustment:** -20 bps (wężej)

### **Przykład (L1 z inventory skew +30%):**
- **Base offset:** 20 bps
- **Inventory adjustment:** +20 bps (bid), -20 bps (ask)
- **Final bidOffset:** 20 + 20 = **40 bps**
- **Final askOffset:** 20 - 20 = **0 bps**
- **Bid Price:** $100 × (1 - 40/10000) = **$99.60**
- **Ask Price:** $100 × (1 + 0/10000) = **$100.00**

---

## 5. **Nansen Bias Adjustments**

### **Lokalizacja:** `GridManager.generateGridOrders()` w `src/utils/grid_manager.ts` (linie 220-228)

### **Konfiguracja Bias:**
```typescript
const BIAS_CONFIGS = {
  strong: {
    tightenFactor: 0.7,  // 30% tighter (30% reduction)
    widenFactor: 1.3,    // 30% wider (30% increase)
    boostAmount: 0.15,
    maxContraSkew: 0.25
  },
  soft: {
    tightenFactor: 0.9,  // 10% tighter
    widenFactor: 1.1,    // 10% wider
    boostAmount: 0.10,
    maxContraSkew: 0.30
  },
  neutral: {
    tightenFactor: 1.0,  // No adjustment
    widenFactor: 1.0,    // No adjustment
    boostAmount: 0.0,
    maxContraSkew: 0.50
  }
}
```

### **Formuła:**
```typescript
if (nansenBias === 'long') {
  // LONG bias: buy more aggressively, sell more passively
  bidOffsetBps *= tightenFactor  // Np. ×0.7 dla strong
  askOffsetBps *= widenFactor     // Np. ×1.3 dla strong
} else if (nansenBias === 'short') {
  // SHORT bias: sell more aggressively, buy more passively
  bidOffsetBps *= widenFactor     // Np. ×1.3 dla strong
  askOffsetBps *= tightenFactor  // Np. ×0.7 dla strong
}
```

### **Przykład (L1, LONG bias strong, inventorySkew=0):**
- **Base offset:** 20 bps
- **Inventory adjustment:** 0 bps
- **Nansen adjustment (LONG strong):**
  - **Bid:** 20 × 0.7 = **14 bps** (tighter, łatwiej kupić)
  - **Ask:** 20 × 1.3 = **26 bps** (wider, trudniej sprzedać)
- **Bid Price:** $100 × (1 - 14/10000) = **$99.86**
- **Ask Price:** $100 × (1 + 26/10000) = **$100.26**

### **Przykład (L1, SHORT bias strong, inventorySkew=0):**
- **Base offset:** 20 bps
- **Nansen adjustment (SHORT strong):**
  - **Bid:** 20 × 1.3 = **26 bps** (wider, trudniej kupić)
  - **Ask:** 20 × 0.7 = **14 bps** (tighter, łatwiej sprzedać)
- **Bid Price:** $100 × (1 - 26/10000) = **$99.74**
- **Ask Price:** $100 × (1 + 14/10000) = **$100.14**

---

## 6. **Behavioural Risk Spread Boost (FOMO)**

### **Lokalizacja:** `evaluateBehaviourGuard()` w `src/risk/behaviouralGuard.ts` (linie 170-179)

### **Formuła:**
```typescript
// Anti-FOMO: szybki wzrost → rozszerzamy spread BUY
const isFomo = 
  input.ret1mPct >= profile.fomo1mPct ||
  input.ret5mPct >= profile.fomo5mPct

if (isFomo) {
  spreadBoost = Math.max(spreadBoost, profile.fomoSpreadBoost)
  sizeMultiplier *= 0.7  // Zmniejszamy size o 30%
}
```

### **Progi FOMO (per token, normal mode):**
- **ZEC:** fomo1mPct=1.0%, fomo5mPct=2.5%, fomoSpreadBoost=1.4×
- **UNI:** fomo1mPct=1.0%, fomo5mPct=2.5%, fomoSpreadBoost=1.4×
- **VIRTUAL:** fomo1mPct=1.0%, fomo5mPct=2.3%, fomoSpreadBoost=1.5×

### **Jak jest aplikowany:**
```typescript
// W executeMultiLayerMM, po generateGridOrders:
const adjusted = applyBehaviouralRiskToLayers({
  mode: this.behaviouralRiskMode,
  pair,
  midPrice,
  buyLayers,
  sellLayers,
  recentReturns,
  orderbookStats,
})

// spreadBoost jest aplikowany do BUY layers:
// Każdy BUY order price jest mnożony przez spreadBoost
```

### **Przykład (L1, FOMO guard triggered, spreadBoost=1.4×):**
- **Base bidOffset:** 20 bps
- **FOMO spreadBoost:** 1.4×
- **Adjusted bidOffset:** 20 × 1.4 = **28 bps**
- **Bid Price:** $100 × (1 - 28/10000) = **$99.72** (dalej od mid)

---

## 7. **Chase Mode Volatility Adjustments**

### **Lokalizacja:** `LiveTrading.placeOrder()` w `src/mm_hl.ts` (linie 880-907)

### **Formuła:**
```typescript
// Volatility Detection
const rv = volTracker.getRealizedVolatility(this.chaseConfig.volatility.rvWindowMs)
const isVolatile = rv > this.chaseConfig.volatility.sigmaFastThreshold

if (isVolatile) {
  const offsetAdjustment = this.chaseConfig.volatility.spreadWidenTicks * specs.tickSize
  
  if (side === 'buy') {
    roundedPrice -= offsetAdjustment  // Buy lower when volatile
  } else {
    roundedPrice += offsetAdjustment  // Sell higher when volatile
  }
}
```

### **Konfiguracja:**
```typescript
chaseConfig: {
  volatility: {
    rvWindowMs: 60000,        // 1 minute window
    sigmaFastThreshold: 0.02,  // 2% volatility threshold
    spreadWidenTicks: 5        // Widen by 5 ticks when volatile
  }
}
```

### **Przykład (volatile market, tickSize=0.01):**
- **Original bid price:** $99.60
- **Volatility detected:** rv > 0.02
- **spreadWidenTicks:** 5
- **offsetAdjustment:** 5 × 0.01 = $0.05
- **Adjusted bid price:** $99.60 - $0.05 = **$99.55** (dalej od mid)

---

## 8. **Dynamiczne Modyfikacje Spread**

### **Hierarchia Modyfikacji:**

```
1. Base Spread (MAKER_SPREAD_BPS)
   ↓
2. Tuning Factor (makerSpreadFactor)
   ↓
3. Inventory Skew Adjustment (±10 bps per 15% skew)
   ↓
4. Nansen Bias Adjustment (tightenFactor/widenFactor)
   ↓
5. Behavioural Risk FOMO Boost (spreadBoost ×1.4-1.9)
   ↓
6. Chase Mode Volatility Adjustment (spreadWidenTicks)
   ↓
7. 🛡️ Safety Clamp (MIN_FINAL_SPREAD_BPS / MAX_FINAL_SPREAD_BPS)
   ↓
8. Final Price
```

### **Kolejność aplikacji (Multi-Layer MM):**

1. **Base offset warstwy** (np. 20 bps dla L1)
2. **Inventory skew adjustment** (±adjustmentBps)
3. **Nansen bias adjustment** (×tightenFactor lub ×widenFactor)
4. **Stagger** (+2 bps per order w warstwie)
5. **Behavioural risk FOMO boost** (×spreadBoost dla BUY)
6. **Final price calculation**

### **Kolejność aplikacji (Regular MM):**

1. **Base spread** (MAKER_SPREAD_BPS)
2. **Tuning factor** (makerSpreadFactor)
3. **Chase mode volatility** (spreadWidenTicks)
4. **Final price calculation**

---

## 9. **Przykłady Obliczeń**

### **Przykład 1: L1, neutral, no skew, no FOMO**

**Parametry:**
- Mid Price: $100.00
- Layer: L1 (offsetBps=20)
- Inventory Skew: 0
- Nansen Bias: neutral (tightenFactor=1.0, widenFactor=1.0)
- FOMO: false (spreadBoost=1.0)

**Obliczenia:**
- Bid offset: 20 bps
- Ask offset: 20 bps
- **Bid Price:** $100 × (1 - 20/10000) = **$99.80**
- **Ask Price:** $100 × (1 + 20/10000) = **$100.20**
- **Spread:** $0.40 (0.40%)

---

### **Przykład 2: L1, LONG bias strong, +30% skew, FOMO**

**Parametry:**
- Mid Price: $100.00
- Layer: L1 (offsetBps=20)
- Inventory Skew: +0.30 (30% long)
- Nansen Bias: LONG strong (tightenFactor=0.7, widenFactor=1.3)
- FOMO: true (spreadBoost=1.4)

**Obliczenia:**
- Base bid offset: 20 bps
- Inventory adjustment: +20 bps (skew +30% → +20 bps)
- Nansen adjustment: ×0.7 (LONG strong)
- FOMO boost: ×1.4
- **Final bid offset:** (20 + 20) × 0.7 × 1.4 = **39.2 bps**
- **Bid Price:** $100 × (1 - 39.2/10000) = **$99.61**

- Base ask offset: 20 bps
- Inventory adjustment: -20 bps (skew +30% → -20 bps)
- Nansen adjustment: ×1.3 (LONG strong)
- **Final ask offset:** (20 - 20) × 1.3 = **0 bps**
- **Ask Price:** $100 × (1 + 0/10000) = **$100.00**

- **Spread:** $0.39 (0.39%)

---

### **Przykład 3: Regular MM, volatile market**

**Parametry:**
- Mid Price: $100.00
- MAKER_SPREAD_BPS: 40 bps
- Tuning factor: 1.0
- Volatile: true (spreadWidenTicks=5, tickSize=0.01)

**Obliczenia:**
- Base spread: 40 bps
- Spread factor: 40/10000 = 0.004
- Base bid: $100 × (1 - 0.004) = $99.60
- Volatility adjustment: -$0.05
- **Final Bid:** $99.60 - $0.05 = **$99.55**

- Base ask: $100 × (1 + 0.004) = $100.40
- Volatility adjustment: +$0.05
- **Final Ask:** $100.40 + $0.05 = **$100.45**

- **Spread:** $0.90 (0.90%)

---

## 10. **Czy Spread Jest Dynamiczny?**

### **✅ TAK - Spread jest dynamiczny, ale przez różne mechanizmy:**

### **1. Dynamiczne Modyfikacje (DZIAŁAJĄ):**

#### **A. Inventory Skew (Real-time)**
- **Kiedy:** Przy każdej iteracji MM
- **Jak:** ±10 bps per 15% skew
- **Status:** ✅ **AKTYWNE**

#### **B. Nansen Bias (Real-time)**
- **Kiedy:** Przy każdej iteracji MM
- **Jak:** tightenFactor (0.7-0.9) / widenFactor (1.1-1.3)
- **Status:** ✅ **AKTYWNE**

#### **C. Behavioural Risk FOMO (Real-time)**
- **Kiedy:** Gdy wykryty FOMO (ret1m/ret5m > threshold)
- **Jak:** spreadBoost ×1.4-1.9 dla BUY layers
- **Status:** ✅ **AKTYWNE**

#### **D. Chase Mode Volatility (Real-time)**
- **Kiedy:** Gdy volatility > threshold (jeśli chase mode włączony)
- **Jak:** spreadWidenTicks (5 ticks) dodatkowo
- **Status:** ✅ **AKTYWNE** (jeśli `CHASE_MODE_ENABLED=true`)

### **2. Adaptive Tuning System (WYŁĄCZONY):**

#### **ExecutionOptimizer - Obecnie Disabled**
```typescript
// W mm_hl.ts linia 2258-2262:
applyTuning: async (t) => {
  // TUNING DISABLED: Always use 100% order size regardless of success rate
  this.tuning = {
    orderUsdFactor: 1.0  // Force 100% - ignoring auto-tuning adjustments
    makerSpreadFactor: 1.0  // Force 100% - spread nie jest dynamicznie dostosowywany
  }
}
```

#### **Co by robił (gdyby był włączony):**
- **Success Rate ≥ 80%:** spread ×0.9 (10% tighter)
- **Success Rate 60-80%:** spread ×1.0 (neutral)
- **Success Rate < 60%:** spread ×1.1 (10% wider)
- **High Gas (>4 gwei):** spread ×1.1 (wider)
- **Low Gas (<1.5 gwei):** spread ×0.95 (tighter)

**Status:** ❌ **WYŁĄCZONY** (hardcoded na 1.0)

### **3. Podsumowanie Dynamiczności:**

| Mechanizm | Status | Częstotliwość | Zakres |
|-----------|--------|---------------|--------|
| **Inventory Skew** | ✅ Aktywne | Każda iteracja | ±10 bps per 15% |
| **Nansen Bias** | ✅ Aktywne | Każda iteracja | ×0.7-1.3 |
| **FOMO Boost** | ✅ Aktywne | Gdy FOMO | ×1.4-1.9 |
| **Volatility (Chase)** | ✅ Aktywne* | Gdy volatile | +5 ticks |
| **Adaptive Tuning** | ❌ Wyłączony | - | - |

*Chase Mode wymaga `CHASE_MODE_ENABLED=true`

### **4. Przykład Dynamicznego Spread:**

**Scenariusz:** ZEC, LONG bias strong, +30% skew, FOMO detected

```
Base L1 offset: 20 bps
  ↓
Inventory skew (+30%): +20 bps → 40 bps
  ↓
Nansen LONG strong: ×0.7 (bid) → 28 bps, ×1.3 (ask) → 52 bps
  ↓
FOMO boost: ×1.4 (bid) → 39.2 bps
  ↓
Final:
  - Bid: 39.2 bps (zamiast 20 bps) = +96% szerszy
  - Ask: 52 bps (zamiast 20 bps) = +160% szerszy
```

**Spread zmienia się w czasie rzeczywistym** w zależności od:
- Pozycji (inventory)
- Nansen bias
- Market conditions (FOMO, volatility)

---

## 11. **Konfiguracja .env**

### **Bazowy Spread:**
```bash
MAKER_SPREAD_BPS=40  # 40 bps = 0.40% spread
```

### **🛡️ Spread Safety Limits (NOWE):**
```bash
MIN_FINAL_SPREAD_BPS=8   # Minimum 0.08% (zapobiega zbyt wąskim spreadom)
MAX_FINAL_SPREAD_BPS=140 # Maximum 1.40% (zapobiega zbyt szerokim spreadom)
```

**Dlaczego:**
- **MIN:** Zapobiega sytuacjom, gdzie spread spada do ~1-2 bps (darmowe opcje dla rynku)
- **MAX:** Zapobiega sytuacjom, gdzie spread rośnie do 200+ bps (bot nic nie filluje)

**Jak działa:**
- Wszystkie modyfikacje (inventory, Nansen, FOMO, chase) są aplikowane
- Na końcu spread jest clampowany do [MIN, MAX]
- Log `[SPREAD]` pokazuje, jeśli spread został clamped

### **Nansen Close Cost (dla cost-benefit check):**
```bash
NANSEN_CLOSE_COST_DEFAULT_BPS=20              # 0.20% domyślny koszt zamknięcia
NANSEN_CLOSE_COST_SPREAD_MULTIPLIER=0.5      # 50% bieżącego spreadu
```

### **Behavioural Risk Mode:**
```bash
BEHAVIOURAL_RISK_MODE=normal  # lub: aggressive
```

### **Chase Mode (jeśli włączony):**
```bash
CHASE_MODE_ENABLED=true
# Konfiguracja w kodzie (chaseConfig.volatility.spreadWidenTicks)
```

---

## 📊 **Podsumowanie**

### **Regular MM:**
- **Base:** `MAKER_SPREAD_BPS` (40 bps)
- **Tuning:** `makerSpreadFactor` (1.0)
- **Volatility:** `spreadWidenTicks` (5 ticks)
- **Final:** Symetryczny spread wokół mid price

### **Multi-Layer MM:**
- **Base:** Warstwa offset (20-100 bps)
- **Inventory Skew:** ±10 bps per 15% skew
- **Nansen Bias:** ×0.7-1.3 (asymetryczny)
- **FOMO Boost:** ×1.4-1.9 (tylko BUY)
- **Stagger:** +2 bps per order
- **Final:** Asymetryczny spread z wieloma warstwami

### **Kluczowe Różnice:**
1. **Regular MM:** Jeden spread, symetryczny
2. **Multi-Layer MM:** Wiele warstw, asymetryczny (zależnie od bias/skew)
3. **Behavioural Risk:** Tylko BUY jest modyfikowany (FOMO)
4. **Nansen Bias:** Asymetryczny (favorable side tighter, unfavorable wider)

---

**Wszystkie wartości są dynamiczne i dostosowują się do:**
- Pozycji (inventory skew)
- Nansen bias (directional signal)
- Market conditions (volatility, FOMO, knife)
- Warstwy (L1-L5 mają różne offsety)

