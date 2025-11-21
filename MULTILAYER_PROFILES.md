# 🎯 Multi-Layer Profiles: Normal vs Aggressive

**Data:** 2025-11-15  
**Status:** ✅ **Zaimplementowane**  
**Przełączanie:** 1 zmienna w `.env`

---

## 📊 **Koncepcja**

System profili pozwala na łatwe przełączanie między:
- **NORMAL** - bezpieczny grid (domyślnie)
- **AGGRESSIVE** - PRO grid (2× większy notional)

**Przełączanie:** Tylko zmiana `MULTI_LAYER_PROFILE` w `.env`

---

## 🔧 **Konfiguracja Profili**

### **Profile NORMAL (bezpieczny):**

```typescript
ZEC:    [300, 300, 250, 200, 150] USD per layer per side
UNI:    [200, 200, 180, 150, 120] USD per layer per side
VIRTUAL: [200, 200, 180, 150, 120] USD per layer per side
```

**Suma per side:**
- ZEC: 1,200 USD (L1-L3 active: 850 USD)
- UNI: 850 USD (L1-L3 active: 580 USD)
- VIRTUAL: 850 USD (L1-L3 active: 580 USD)

**Total notional (L1-L3 active):**
- ZEC: ~1,700 USD
- UNI: ~1,160 USD
- VIRTUAL: ~1,160 USD

---

### **Profile AGGRESSIVE (PRO):**

```typescript
ZEC:    [500, 500, 450, 400, 300] USD per layer per side
UNI:    [350, 350, 300, 250, 200] USD per layer per side
VIRTUAL: [350, 350, 300, 250, 200] USD per layer per side
```

**Suma per side:**
- ZEC: 2,150 USD (L1-L3 active: 1,450 USD)
- UNI: 1,450 USD (L1-L3 active: 1,000 USD)
- VIRTUAL: 1,450 USD (L1-L3 active: 1,000 USD)

**Total notional (L1-L3 active):**
- ZEC: ~2,900 USD (1.7× większy vs normal)
- UNI: ~2,000 USD (1.7× większy vs normal)
- VIRTUAL: ~2,000 USD (1.7× większy vs normal)

---

## 📋 **Przykład: ZEC (mid = 600 USDT)**

### **NORMAL Profile:**

```
ASK Side:
─────────────────────────────────────────────
L1-1: 600.60  |  $150  |  Size: 0.250 ZEC
L1-2: 600.62  |  $150  |  Size: 0.250 ZEC
─────────────────────────────────────────────
L2-1: 601.20  |  $150  |  Size: 0.250 ZEC
L2-2: 601.22  |  $150  |  Size: 0.250 ZEC
─────────────────────────────────────────────
L3-1: 601.80  |  $125  |  Size: 0.208 ZEC
L3-2: 601.82  |  $125  |  Size: 0.208 ZEC
─────────────────────────────────────────────
Total ASK: $850 (L1-L3 active)

BID Side:
─────────────────────────────────────────────
L1-1: 599.40  |  $150  |  Size: 0.250 ZEC
L1-2: 599.38  |  $150  |  Size: 0.250 ZEC
─────────────────────────────────────────────
L2-1: 598.80  |  $150  |  Size: 0.250 ZEC
L2-2: 598.78  |  $150  |  Size: 0.250 ZEC
─────────────────────────────────────────────
L3-1: 598.20  |  $125  |  Size: 0.209 ZEC
L3-2: 598.18  |  $125  |  Size: 0.209 ZEC
─────────────────────────────────────────────
Total BID: $850 (L1-L3 active)

Total Notional: ~$1,700 USD
```

### **AGGRESSIVE Profile:**

```
ASK Side:
─────────────────────────────────────────────
L1-1: 600.60  |  $250  |  Size: 0.416 ZEC
L1-2: 600.62  |  $250  |  Size: 0.416 ZEC
─────────────────────────────────────────────
L2-1: 601.20  |  $250  |  Size: 0.416 ZEC
L2-2: 601.22  |  $250  |  Size: 0.416 ZEC
─────────────────────────────────────────────
L3-1: 601.80  |  $225  |  Size: 0.375 ZEC
L3-2: 601.82  |  $225  |  Size: 0.375 ZEC
─────────────────────────────────────────────
Total ASK: $1,450 (L1-L3 active)

BID Side:
─────────────────────────────────────────────
L1-1: 599.40  |  $250  |  Size: 0.417 ZEC
L1-2: 599.38  |  $250  |  Size: 0.417 ZEC
─────────────────────────────────────────────
L2-1: 598.80  |  $250  |  Size: 0.417 ZEC
L2-2: 598.78  |  $250  |  Size: 0.417 ZEC
─────────────────────────────────────────────
L3-1: 598.20  |  $225  |  Size: 0.376 ZEC
L3-2: 598.18  |  $225  |  Size: 0.376 ZEC
─────────────────────────────────────────────
Total BID: $1,450 (L1-L3 active)

Total Notional: ~$2,900 USD (1.7× większy)
```

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

## 🎯 **Jak To Działa**

### **1. Funkcja `getLayerBudgetsUsd()`:**

```typescript
// Sprawdza czy para ma custom config
const customBudgets = getLayerBudgetsUsd('ZEC')
// Returns: [300, 300, 250, 200, 150] dla NORMAL
// Returns: [500, 500, 450, 400, 300] dla AGGRESSIVE
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
| **ZEC** | Aggressive | 1,450 USD | ~2,900 USD | 1.7× |
| **UNI** | Normal | 580 USD | ~1,160 USD | 1.0× |
| **UNI** | Aggressive | 1,000 USD | ~2,000 USD | 1.7× |
| **VIRTUAL** | Normal | 580 USD | ~1,160 USD | 1.0× |
| **VIRTUAL** | Aggressive | 1,000 USD | ~2,000 USD | 1.7× |

**Total dla 3 par:**
- **Normal:** ~$4,020 USD notional
- **Aggressive:** ~$6,900 USD notional (1.7× większy)

---

## 🎯 **Kiedy Używać Którego Profilu?**

### **NORMAL (domyślnie):**
- ✅ Pierwsze 1-2 dni testów
- ✅ Gdy chcesz być bezpieczny
- ✅ Gdy kapitał jest ograniczony
- ✅ Gdy testujesz nowe funkcje

### **AGGRESSIVE (PRO):**
- ✅ Gdy wszystko działa stabilnie
- ✅ Gdy chcesz większe wykorzystanie kapitału
- ✅ Gdy masz większy kapitał
- ✅ Gdy chcesz więcej filli i edge

---

## 🔍 **Sprawdzenie Który Profil Jest Aktywny**

### **W logach przy starcie:**

```
🏛️  Multi-layer grid enabled: Grid: 3 active layers (L1-L3), 2 parking layers
[MM] Profile: normal (ZEC: 1,200 USD/side, UNI: 850 USD/side)
```

### **W logach orderów:**

```
[MM] Placing grid order: ZEC L1 BID @ 599.40 size=0.250 ($150) [NORMAL]
```

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
- ✅ AGGRESSIVE - PRO grid (1.7× większy)
- ✅ Fallback dla innych par
- ✅ Przełączanie przez 1 zmienną w `.env`

**Status:** ✅ **GOTOWE DO UŻYCIA!**

---

**Gotowe!** Masz system profili z łatwym przełączaniem. 🎯

