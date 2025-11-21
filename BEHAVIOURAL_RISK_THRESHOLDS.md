# 🧠 Behavioural Risk Thresholds - Per-Token Configuration

## 📊 **Kompletna Tabela Progów Anti-FOMO / Anti-Knife**

### **Normal Mode (Start - Conservative)**

| Token | FOMO 1m (%) | FOMO 5m (%) | KNIFE 1m (%) | KNIFE 5m (%) | MinDepthRatio | FOMO Spread Boost (×) | Knife Suspend (min) | Notes |
|-------|-------------|-------------|--------------|--------------|---------------|----------------------|---------------------|-------|
| **ZEC** | 1.0 | 2.5 | -0.8 | -2.5 | 0.25 | 1.4 | 2 | Bazowy profil dla bardzo zmiennego ZEC |
| **UNI** | 1.0 | 2.5 | -0.8 | -2.3 | 0.22 | 1.4 | 3 | Trochę łagodniejszy nóż na 5m |
| **VIRTUAL** | 1.0 | 2.3 | -0.8 | -2.3 | 0.22 | 1.5 | 3 | AI/Base, podobny profil do UNI |
| **DEFAULT** | 1.0 | 2.5 | -0.8 | -2.3 | 0.22 | 1.4 | 3 | Fallback dla innych par |

### **Aggressive Mode (After Testing - More Sensitive)**

| Token | FOMO 1m (%) | FOMO 5m (%) | KNIFE 1m (%) | KNIFE 5m (%) | MinDepthRatio | FOMO Spread Boost (×) | Knife Suspend (min) | Notes |
|-------|-------------|-------------|--------------|--------------|---------------|----------------------|---------------------|-------|
| **ZEC** | 0.7 | 1.8 | -1.2 | -3.5 | 0.30 | 1.8 | 4 | Pełna paranoja na noże, mocniejszy panic-filter |
| **UNI** | 0.8 | 2.0 | -1.0 | -3.0 | 0.27 | 1.8 | 5 | Szybciej łapie FOMO/knife, ale trochę łagodniej niż ZEC |
| **VIRTUAL** | 0.8 | 2.0 | -1.0 | -3.0 | 0.27 | 1.9 | 5 | Kopia agresywnego UNI |
| **DEFAULT** | 0.8 | 2.0 | -1.0 | -3.0 | 0.27 | 1.8 | 5 | Fallback dla innych par |

---

## 🎯 **Interpretacja Parametrów**

### **FOMO Thresholds (1m / 5m)**
- **Co mierzy:** Szybkość wzrostu ceny w ostatniej 1 minucie / 5 minutach
- **Kiedy trigger:** Jeśli `ret1mPct >= fomo1mPct` LUB `ret5mPct >= fomo5mPct`
- **Akcja:** 
  - `spreadBoost = fomoSpreadBoost` (×1.3-1.9)
  - `sizeMultiplier *= 0.7` (zmniejsza size o 30%)
- **Cel:** Nie gonić świecy w górę, nie kupować na szczycie

**Przykłady:**
- **ZEC normal:** Jeśli cena wzrośnie o **1.0% w 1m** lub **2.5% w 5m** → FOMO guard aktywowany
- **ZEC aggressive:** Reaguje już przy **0.7% w 1m** lub **1.8% w 5m**
- **VIRTUAL aggressive:** Bardzo wrażliwy - **0.8% w 1m** lub **2.0% w 5m**

### **KNIFE Thresholds (1m / 5m)**
- **Co mierzy:** Szybkość spadku ceny w ostatniej 1 minucie / 5 minutach
- **Kiedy trigger:** Jeśli `ret1mPct <= knife1mPct` LUB `ret5mPct <= knife5mPct`
- **Akcja:** 
  - `suppressBuys = true` (wyłącza wszystkie BUY warstwy)
  - `knifeSuspendedUntilMs = now + suspendMinutes`
- **Cel:** Nie łapać spadającego noża, nie kupować podczas paniki

**Przykłady:**
- **ZEC normal:** Jeśli cena spadnie o **-0.8% w 1m** lub **-2.5% w 5m** → Knife guard aktywowany
- **ZEC aggressive:** Pełna paranoja - reaguje już przy **-1.2% w 1m** lub **-3.5% w 5m**
- **UNI aggressive:** Reaguje przy **-1.0% w 1m** lub **-3.0% w 5m**
- **VIRTUAL normal:** Podobny do UNI - **-0.8% w 1m** lub **-2.3% w 5m**

### **MinDepthRatio**
- **Co mierzy:** Stosunek aktualnej głębokości orderbooka do docelowego size
- **Kiedy trigger:** Jeśli `depthRatio < minDepthRatio`
- **Akcja:** `sizeMultiplier *= 0.5` (zmniejsza size o 50%)
- **Cel:** Wykrywa panikę / wyprzedaż gdy orderbook się zapada

**Przykłady:**
- **ZEC normal:** Jeśli depth spadnie poniżej **30% docelowego size** → panic
- **ZEC aggressive:** Bardziej konserwatywny - **35% docelowego size**
- **UNI/VIRTUAL normal:** **25% docelowego size**

### **FOMO Spread Boost**
- **Co robi:** Mnożnik na spread BUY warstw przy FOMO
- **Efekt:** Odsuwa zlecenia BUY dalej od rynku
- **Cel:** Nie chase'ować ceny w górę

**Przykłady:**
- **ZEC normal:** Spread BUY ×**1.4** (40% szerszy)
- **ZEC aggressive:** Spread BUY ×**1.8** (80% szerszy)
- **VIRTUAL aggressive:** Spread BUY ×**1.9** (90% szerszy) - najbardziej konserwatywny

### **Knife Suspend (min)**
- **Co robi:** Czas wyłączenia BUY warstw po wykryciu knife
- **Efekt:** Przez X minut bot nie będzie stawiał BUY orderów
- **Cel:** Dać rynkowi czas na stabilizację

**Przykłady:**
- **ZEC normal:** **2 min** suspension (najkrótsza)
- **UNI/VIRTUAL aggressive:** **5 min** suspension (najdłuższa)

---

## 📋 **Porównanie Normal vs Aggressive**

### **ZEC:**
- **FOMO:** Normal (1.0%/2.5%) → Aggressive (0.7%/1.8%) - **bardziej wrażliwy**
- **KNIFE:** Normal (-0.8%/-2.5%) → Aggressive (-1.2%/-3.5%) - **pełna paranoja na noże**
- **Depth:** Normal (0.25) → Aggressive (0.30) - **bardziej konserwatywny**
- **Spread Boost:** Normal (×1.4) → Aggressive (×1.8) - **silniejsze odsunięcie**
- **Suspend:** Normal (2 min) → Aggressive (4 min) - **dłuższa pauza**

### **UNI:**
- **FOMO:** Normal (1.0%/2.5%) → Aggressive (0.8%/2.0%) - **bardziej wrażliwy**
- **KNIFE:** Normal (-0.8%/-2.3%) → Aggressive (-1.0%/-3.0%) - **bardziej wrażliwy**
- **Depth:** Normal (0.22) → Aggressive (0.27) - **bardziej konserwatywny**
- **Spread Boost:** Normal (×1.4) → Aggressive (×1.8) - **silniejsze odsunięcie**
- **Suspend:** Normal (3 min) → Aggressive (5 min) - **dłuższa pauza**

### **VIRTUAL:**
- **FOMO:** Normal (1.0%/2.3%) → Aggressive (0.8%/2.0%) - **bardziej wrażliwy**
- **KNIFE:** Normal (-0.8%/-2.3%) → Aggressive (-1.0%/-3.0%) - **bardziej wrażliwy**
- **Depth:** Normal (0.22) → Aggressive (0.27) - **bardziej konserwatywny**
- **Spread Boost:** Normal (×1.5) → Aggressive (×1.9) - **najsilniejsze odsunięcie**
- **Suspend:** Normal (3 min) → Aggressive (5 min) - **dłuższa pauza**

---

## 🔧 **Lokalizacja w Kodzie**

### **Moduł:**
`src/risk/behaviouralGuard.ts`

### **Funkcja:**
```typescript
evaluateBehaviourGuard(input: BehaviourCheckInput): BehaviourDecision
```

### **Profile:**
```typescript
const profiles: Record<string, { normal: BehaviourProfile; aggressive: BehaviourProfile }> = {
  ZEC: { normal: {...}, aggressive: {...} },
  UNI: { normal: {...}, aggressive: {...} },
  VIRTUAL: { normal: {...}, aggressive: {...} },
}
```

---

## 📊 **Przykładowe Scenariusze**

### **Scenariusz 1: ZEC FOMO (Normal Mode)**
- **Cena:** 580 → 586 USD w 1 minucie (+1.0%)
- **Trigger:** `ret1mPct = 1.0 >= 1.0` (ZEC normal fomo1mPct)
- **Akcja:** 
  - `spreadBoost = 1.4` (40% szerszy spread)
  - `sizeMultiplier = 0.7` (30% mniejszy size)
- **Log:** `🧠 BehaviouralGuard: ZEC decision suppressBuys=false spreadBoost=1.4 sizeMultiplier=0.7 reason=fomo_guard_triggered`

### **Scenariusz 2: UNI Knife (Aggressive Mode)**
- **Cena:** 7.00 → 6.93 USD w 1 minucie (-1.0%)
- **Trigger:** `ret1mPct = -1.0 <= -1.0` (UNI aggressive knife1mPct)
- **Akcja:** 
  - `suppressBuys = true` (wyłącza wszystkie BUY)
  - `knifeSuspendedUntilMs = now + 5min`
- **Log:** `🧠 BehaviouralGuard: UNI decision suppressBuys=true spreadBoost=1.0 sizeMultiplier=1.0 reason=knife_guard_triggered`

### **Scenariusz 3: VIRTUAL Low Depth**
- **Depth:** 4000 USD (docelowy size: 20000 USD)
- **Ratio:** 0.20 < 0.27 (VIRTUAL aggressive minDepthRatio)
- **Trigger:** Orderbook collapse
- **Akcja:** `sizeMultiplier *= 0.5` (50% mniejszy size)
- **Log:** `🧠 BehaviouralGuard: VIRTUAL decision suppressBuys=false spreadBoost=1.0 sizeMultiplier=0.5 reason=low_depth`

### **Scenariusz 4: ZEC Aggressive Knife (Pełna Paranoja)**
- **Cena:** 580 → 573 USD w 1 minucie (-1.2%)
- **Trigger:** `ret1mPct = -1.2 <= -1.2` (ZEC aggressive knife1mPct)
- **Akcja:** 
  - `suppressBuys = true` (wyłącza wszystkie BUY)
  - `knifeSuspendedUntilMs = now + 4min`
- **Log:** `🧠 BehaviouralGuard: ZEC decision suppressBuys=true spreadBoost=1.0 sizeMultiplier=1.0 reason=knife_guard_triggered`
- **Uwaga:** ZEC aggressive ma najostrzejsze progi na noże (-1.2% w 1m, -3.5% w 5m)

### **Scenariusz 5: ZEC Knife Cooldown Active**
- **Knife wykryty:** 2 minuty temu
- **Cooldown:** 4 minuty (ZEC aggressive)
- **Trigger:** `nowMs < knifeSuspendedUntilMs`
- **Akcja:** `suppressBuys = true` (nadal wyłączone BUY)
- **Log:** `🧠 BehaviouralGuard: ZEC decision suppressBuys=true spreadBoost=1.0 sizeMultiplier=1.0 reason=knife_cooldown_active`

---

## ✅ **Podsumowanie**

- ✅ **Per-token config:** ZEC, UNI, VIRTUAL mają własne progi
- ✅ **Dwa tryby:** normal (start) i aggressive (po testach)
- ✅ **FOMO guard:** Odsuwa BUY i zmniejsza size przy szybkim wzroście
- ✅ **Knife guard:** Wyłącza BUY przy szybkim spadku
- ✅ **Low depth guard:** Zmniejsza size przy braku płynności
- ✅ **Cooldown tracking:** Pamięta knife suspension per para
- ✅ **Logi:** Szczegółowe informacje o triggerach i decyzjach

**Wszystkie wartości są w kodzie** (`src/risk/behaviouralGuard.ts`) i gotowe do użycia! 🚀

