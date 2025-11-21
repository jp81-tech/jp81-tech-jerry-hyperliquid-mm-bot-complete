# 🎯 Multi-Layer Profiles: Final Implementation

**Data:** 2025-11-15  
**Status:** ✅ **Zaimplementowane z logowaniem**  
**Przełączanie:** `MULTI_LAYER_PROFILE=normal|aggressive` w `.env`

---

## 📊 **Profile Konfiguracja**

### **Profile NORMAL (bezpieczny na start):**

```typescript
ZEC:    [300, 300, 250, 200, 150] USD per layer per side
UNI:    [220, 220, 200, 160, 140] USD per layer per side
VIRTUAL: [220, 220, 200, 160, 140] USD per layer per side
```

**Suma per side:**
- ZEC: 1,200 USD (L1-L3 active: 850 USD)
- UNI: 940 USD (L1-L3 active: 640 USD)
- VIRTUAL: 940 USD (L1-L3 active: 640 USD)

**Total notional (L1-L3 active):**
- ZEC: ~1,700 USD
- UNI: ~1,280 USD
- VIRTUAL: ~1,280 USD
- **Total 3 pary:** ~$4,260 USD

---

### **Profile AGGRESSIVE (PRO):**

```typescript
ZEC:    [600, 550, 500, 450, 350] USD per layer per side
UNI:    [400, 380, 360, 320, 300] USD per layer per side
VIRTUAL: [400, 380, 360, 320, 300] USD per layer per side
```

**Suma per side:**
- ZEC: 2,450 USD (L1-L3 active: 1,650 USD)
- UNI: 1,760 USD (L1-L3 active: 1,140 USD)
- VIRTUAL: 1,760 USD (L1-L3 active: 1,140 USD)

**Total notional (L1-L3 active):**
- ZEC: ~3,300 USD
- UNI: ~2,280 USD
- VIRTUAL: ~2,280 USD
- **Total 3 pary:** ~$7,860 USD (1.8× większy vs normal)

---

## 🔧 **Konfiguracja .env**

### **Profile NORMAL (domyślnie):**

```bash
# Multi-layer MM
ENABLE_MULTI_LAYER=true
MULTI_LAYER_PROFILE=normal
```

### **Profile AGGRESSIVE (PRO):**

```bash
# Multi-layer MM
ENABLE_MULTI_LAYER=true
MULTI_LAYER_PROFILE=aggressive
```

**Przełączanie:** Zmień `MULTI_LAYER_PROFILE` i zrestartuj bota.

---

## 📋 **Logowanie Przy Starcie**

### **Przykładowe logi (NORMAL):**

```
🏛️  Multi-layer grid enabled: Grid: 3 active layers (L1-L3), 2 parking layers

[GRID] Profile: NORMAL
[GRID] ZEC layers: 300, 300, 250, 200, 150 (1200 USD/side, 850 USD active L1-L3)
[GRID] UNI layers: 220, 220, 200, 160, 140 (940 USD/side, 640 USD active L1-L3)
[GRID] VIRTUAL layers: 220, 220, 200, 160, 140 (940 USD/side, 640 USD active L1-L3)
```

### **Przykładowe logi (AGGRESSIVE):**

```
🏛️  Multi-layer grid enabled: Grid: 3 active layers (L1-L3), 2 parking layers

[GRID] Profile: AGGRESSIVE
[GRID] ZEC layers: 600, 550, 500, 450, 350 (2450 USD/side, 1650 USD active L1-L3)
[GRID] UNI layers: 400, 380, 360, 320, 300 (1760 USD/side, 1140 USD active L1-L3)
[GRID] VIRTUAL layers: 400, 380, 360, 320, 300 (1760 USD/side, 1140 USD active L1-L3)
```

---

## 📊 **Przykład: ZEC (mid = 580 USDT) - AGGRESSIVE**

### **Orderbook:**

```
ASK side (sell):
─────────────────────────────────────────────
L5:  size ≈ 0.60 ZEC @ mid + 6 bps (350 USD)
L4:  size ≈ 0.78 ZEC @ mid + 4 bps (450 USD)
L3:  size ≈ 0.86 ZEC @ mid + 2.5 bps (500 USD)
L2:  size ≈ 0.95 ZEC @ mid + 1.5 bps (550 USD)
L1:  size ≈ 1.03 ZEC @ mid + 1 bps (600 USD)
─────────────────────────────────────────────
MID: 580.00
─────────────────────────────────────────────
BID side (buy):
─────────────────────────────────────────────
L1:  size ≈ 1.03 ZEC @ mid - 1 bps (600 USD)
L2:  size ≈ 0.95 ZEC @ mid - 1.5 bps (550 USD)
L3:  size ≈ 0.86 ZEC @ mid - 2.5 bps (500 USD)
L4:  size ≈ 0.78 ZEC @ mid - 4 bps (450 USD)
L5:  size ≈ 0.60 ZEC @ mid - 6 bps (350 USD)
─────────────────────────────────────────────

Total Notional (L1-L3 active): ~3,300 USD
```

---

## 🎯 **Jak To Działa**

### **1. Funkcja `getLayerBudgetsUsd()`:**

```typescript
// Sprawdza czy para ma custom config
const customBudgets = getLayerBudgetsUsd('ZEC')
// Returns dla NORMAL: [300, 300, 250, 200, 150]
// Returns dla AGGRESSIVE: [600, 550, 500, 450, 350]
// Returns: null dla innych par (fallback)
```

### **2. W GridManager.generateGridOrders():**

```typescript
// Sprawdź czy są custom budgets
const customLayerBudgets = getLayerBudgetsUsd(symbol)
const useCustomBudgets = customLayerBudgets !== null

if (useCustomBudgets && customLayerBudgets) {
  // ✅ Użyj custom budgets
  const layerBudgetUsd = customLayerBudgets[layer.level - 1]
  orderSizeUsd = layerBudgetUsd / layer.ordersPerSide
} else {
  // 🔙 Fallback – stara logika (percentage-based)
  const layerCapital = (capitalPerPair * layer.capitalPct) / 100
  orderSizeUsd = layerCapital / (layer.ordersPerSide * 2)
}
```

### **3. Logowanie przy starcie:**

```typescript
// W konstruktorze GridManager
this.logProfileConfig()

// Wyświetla:
// [GRID] Profile: NORMAL
// [GRID] ZEC layers: 300, 300, 250, 200, 150 (1200 USD/side, 850 USD active L1-L3)
// ...
```

---

## 🛡️ **Fallback dla Innych Par**

Jeśli para nie jest w konfiguracji (np. SOL, ETH), używa **starej logiki**:
- Percentage-based allocation (`capitalPct`)
- `capitalPerPair` z `.env` (`ROTATION_TARGET_PER_PAIR_USD`)

**Efekt:** Inne pary działają normalnie, tylko ZEC/UNI/VIRTUAL mają custom profiles.

---

## 📊 **Porównanie: Normal vs Aggressive**

| Para | Profile | L1-L3 Active (per side) | Total Notional | Ratio |
|------|---------|--------------------------|----------------|-------|
| **ZEC** | Normal | 850 USD | ~1,700 USD | 1.0× |
| **ZEC** | Aggressive | 1,650 USD | ~3,300 USD | 1.9× |
| **UNI** | Normal | 640 USD | ~1,280 USD | 1.0× |
| **UNI** | Aggressive | 1,140 USD | ~2,280 USD | 1.8× |
| **VIRTUAL** | Normal | 640 USD | ~1,280 USD | 1.0× |
| **VIRTUAL** | Aggressive | 1,140 USD | ~2,280 USD | 1.8× |

**Total dla 3 par:**
- **Normal:** ~$4,260 USD notional
- **Aggressive:** ~$7,860 USD notional (1.8× większy)

---

## 🎯 **Kiedy Używać Którego Profilu?**

### **NORMAL (domyślnie):**
- ✅ Pierwsze 1-2 dni testów
- ✅ Gdy chcesz być bezpieczny
- ✅ Gdy testujesz nowe funkcje
- ✅ Gdy kapitał jest ograniczony

### **AGGRESSIVE (PRO):**
- ✅ Gdy wszystko działa stabilnie
- ✅ Gdy chcesz większe wykorzystanie kapitału
- ✅ Gdy masz większy kapitał
- ✅ Gdy chcesz więcej filli i edge

---

## 📋 **Checklist Przed Przełączeniem na AGGRESSIVE**

- [ ] Bot działa stabilnie na NORMAL przez 1-2 dni
- [ ] Soft SL działa poprawnie
- [ ] Nansen SL działa poprawnie
- [ ] Brak niespodziewanych problemów
- [ ] Masz wystarczający kapitał (25k+)
- [ ] Monitoring działa (możesz obserwować większe notional)

---

## 🎯 **Podsumowanie**

**System Profili:**
- ✅ NORMAL - bezpieczny grid (domyślnie)
- ✅ AGGRESSIVE - PRO grid (1.8× większy)
- ✅ Fallback dla innych par
- ✅ Przełączanie przez 1 zmienną w `.env`
- ✅ Logowanie przy starcie pokazujące aktywny profil

**Status:** ✅ **GOTOWE DO UŻYCIA!**

---

**Gotowe!** Masz system profili z łatwym przełączaniem i logowaniem. 🎯

