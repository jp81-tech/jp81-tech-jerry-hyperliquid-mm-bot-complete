# 🧠 Behavioural Risk Profiles - Per-Token Configuration

## 📊 **Tabela Progów (Normal + Aggressive)**

| Token | Tryb | FOMO 1m (%) | FOMO 5m (%) | KNIFE 1m (%) | KNIFE 5m (%) | MinDepthRatio | FOMO Spread Boost (×) | Knife Suspend (min) |
|-------|------|-------------|-------------|--------------|--------------|---------------|----------------------|---------------------|
| **ZEC** | normal | 1.2 | 3.0 | -1.0 | -3.0 | 0.30 | 1.3 | 2 |
| **ZEC** | aggressive | 0.8 | 2.0 | -0.8 | -2.3 | 0.35 | 1.7 | 4 |
| **UNI** | normal | 1.0 | 2.5 | -0.8 | -2.5 | 0.25 | 1.4 | 3 |
| **UNI** | aggressive | 0.7 | 1.8 | -0.7 | -2.0 | 0.30 | 1.8 | 5 |
| **VIRTUAL** | normal | 0.9 | 2.2 | -0.9 | -2.7 | 0.25 | 1.5 | 3 |
| **VIRTUAL** | aggressive | 0.7 | 1.6 | -0.7 | -1.8 | 0.35 | 1.9 | 5 |

---

## 🎯 **Interpretacja Parametrów**

### **FOMO Thresholds (1m / 5m)**
- **Co mierzy:** Szybkość wzrostu ceny w ostatniej 1 minucie / 5 minutach
- **Kiedy trigger:** Jeśli `ret1m >= fomoRet1m` LUB `ret5m >= fomoRet5m`
- **Akcja:** Odsuwa BUY warstwy od rynku (spread boost ×1.3-1.9)
- **Cel:** Nie gonić świecy w górę, nie kupować na szczycie

**Przykład:**
- ZEC normal: Jeśli cena wzrośnie o **1.2% w 1m** lub **3.0% w 5m** → FOMO guard aktywowany
- ZEC aggressive: Reaguje już przy **0.8% w 1m** lub **2.0% w 5m**

### **KNIFE Thresholds (1m / 5m)**
- **Co mierzy:** Szybkość spadku ceny w ostatniej 1 minucie / 5 minutach
- **Kiedy trigger:** Jeśli `ret1m <= knifeRet1m` LUB `ret5m <= knifeRet5m`
- **Akcja:** Wyłącza wszystkie BUY warstwy (suspendBuys = true)
- **Cel:** Nie łapać spadającego noża, nie kupować podczas paniki

**Przykład:**
- ZEC normal: Jeśli cena spadnie o **-1.0% w 1m** lub **-3.0% w 5m** → Knife guard aktywowany
- ZEC aggressive: Reaguje już przy **-0.8% w 1m** lub **-2.3% w 5m**

### **MinDepthRatio**
- **Co mierzy:** Stosunek aktualnej głębokości orderbooka do mediany
- **Kiedy trigger:** Jeśli `bidDepthNow / bidDepthMedian < minDepthRatio`
- **Akcja:** Traktowane jako knife (wyłącza BUY)
- **Cel:** Wykrywa panikę / wyprzedaż gdy orderbook się zapada

**Przykład:**
- ZEC normal: Jeśli depth spadnie poniżej **30% mediany** → panic
- ZEC aggressive: Bardziej konserwatywny - **35% mediany**

### **FOMO Spread Boost**
- **Co robi:** Mnożnik na spread BUY warstw przy FOMO
- **Efekt:** Odsuwa zlecenia BUY dalej od rynku
- **Cel:** Nie chase'ować ceny w górę

**Przykład:**
- ZEC normal: Spread BUY ×**1.3** (30% szerszy)
- ZEC aggressive: Spread BUY ×**1.7** (70% szerszy)
- VIRTUAL aggressive: Spread BUY ×**1.9** (90% szerszy) - najbardziej konserwatywny

### **Knife Suspend (min)**
- **Co robi:** Czas wyłączenia BUY warstw po wykryciu knife
- **Efekt:** Przez X minut bot nie będzie stawiał BUY orderów
- **Cel:** Dać rynkowi czas na stabilizację

**Przykład:**
- ZEC normal: **2 min** suspension
- UNI/VIRTUAL aggressive: **5 min** suspension - najdłuższa pauza

---

## 🔧 **Konfiguracja w Kodzie**

### **Lokalizacja:**
`src/behaviouralRisk.ts` - `BEHAVIOURAL_PROFILES`

### **Struktura:**
```typescript
const BEHAVIOURAL_PROFILES: Record<string, Record<BehaviouralRiskMode, BehaviouralConfig>> = {
  ZEC: {
    normal: { fomoRet1m: 0.012, fomoRet5m: 0.030, ... },
    aggressive: { fomoRet1m: 0.008, fomoRet5m: 0.020, ... },
  },
  UNI: { ... },
  VIRTUAL: { ... },
}
```

### **Wywołanie:**
```typescript
const adjusted = applyBehaviouralRiskToLayers({
  mode: this.behaviouralRiskMode,  // 'normal' | 'aggressive'
  pair: 'ZEC-PERP',                // Automatycznie wyciąga 'ZEC'
  midPrice: 580.50,
  buyLayers: [...],
  sellLayers: [...],
  recentReturns: {
    ret1m: 0.015,  // 1.5% w górę (jako decimal)
    ret5m: 0.032,  // 3.2% w górę
  },
  orderbookStats: {
    bidDepthNow: 5000,
    bidDepthMedian: 15000,
  },
})
```

---

## 📋 **Konfiguracja .env**

```bash
# Behavioural risk mode (global dla wszystkich tokenów)
BEHAVIOURAL_RISK_MODE=normal   # albo: aggressive
```

**Uwaga:** Progi per-token są hardcoded w kodzie. Jeśli chcesz je zmieniać bez rekompilacji, możesz dodać .env overrides (np. `ZEC_FOMO_1M_PCT=1.5`), ale na razie są w kodzie dla prostoty.

---

## 📊 **Przykładowe Scenariusze**

### **Scenariusz 1: ZEC FOMO (Normal Mode)**
- **Cena:** 580 → 587 USD w 1 minucie (+1.2%)
- **Trigger:** `ret1m = 0.012 >= 0.012` (ZEC normal fomoRet1m)
- **Akcja:** BUY warstwy odsunięte o ×1.3 spread
- **Log:** `🧠 BehaviouralRisk: ZEC fomo_guard ret1m=1.20% ret5m=0.00% spreadBoost=1.3x`

### **Scenariusz 2: UNI Knife (Aggressive Mode)**
- **Cena:** 7.00 → 6.90 USD w 1 minucie (-1.4%)
- **Trigger:** `ret1m = -0.014 <= -0.007` (UNI aggressive knifeRet1m)
- **Akcja:** Wszystkie BUY warstwy wyłączone na 5 min
- **Log:** `🧠 BehaviouralRisk: suspending BUY quoting for UNI (knife_detected token=UNI ret1m=-1.40% ret5m=-0.50% depthRatio=0.85 suspend=5min)`

### **Scenariusz 3: VIRTUAL Orderbook Panic**
- **Depth:** 5000 USD (normalnie 20000 USD median)
- **Ratio:** 0.25 < 0.35 (VIRTUAL aggressive minDepthRatio)
- **Trigger:** Orderbook collapse
- **Akcja:** Traktowane jako knife, BUY wyłączone
- **Log:** `🧠 BehaviouralRisk: suspending BUY quoting for VIRTUAL (knife_detected token=VIRTUAL ret1m=-0.20% ret5m=-0.10% depthRatio=0.25 suspend=5min)`

---

## 🎯 **Różnice Normal vs Aggressive**

### **Normal Mode (Start):**
- **Mniej wrażliwy:** Wyższe progi FOMO/KNIFE
- **Krótsze suspension:** 2-3 min
- **Mniejszy spread boost:** ×1.3-1.5
- **Cel:** Bezpieczny start, mniej false positives

### **Aggressive Mode (Po testach):**
- **Bardziej wrażliwy:** Niższe progi FOMO/KNIFE
- **Dłuższe suspension:** 4-5 min
- **Większy spread boost:** ×1.7-1.9
- **Cel:** Maksymalna ochrona przed FOMO/knife

---

## 🔍 **Jak Sprawdzić w Logach**

```bash
# Filtruj logi behavioural risk
journalctl -u mm-bot.service -f | grep -E "BehaviouralRisk|🧠"

# Przykładowe logi:
🧠 Behavioural risk mode: normal
🧠 BehaviouralRisk: ZEC fomo_guard ret1m=1.20% ret5m=2.10% spreadBoost=1.3x
🧠 BehaviouralRisk: suspending BUY quoting for UNI (knife_detected token=UNI ret1m=-1.40% suspend=3min)
```

---

## ✅ **Podsumowanie**

- ✅ **Per-token config:** ZEC, UNI, VIRTUAL mają własne progi
- ✅ **Dwa tryby:** normal (start) i aggressive (po testach)
- ✅ **FOMO guard:** Odsuwa BUY przy szybkim wzroście
- ✅ **Knife guard:** Wyłącza BUY przy szybkim spadku
- ✅ **Orderbook panic:** Wykrywa zapadanie się depth
- ✅ **Logi:** Szczegółowe informacje o triggerach

**Wszystkie wartości są w kodzie** (`src/behaviouralRisk.ts`) i gotowe do użycia! 🚀

