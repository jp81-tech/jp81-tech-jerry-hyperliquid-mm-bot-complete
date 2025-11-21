# 🎯 Multi-Layer Grid: Konkretna Konfiguracja dla ZEC/UNI/VIRTUAL

**Data:** 2025-11-15  
**Status:** ✅ Gotowe do wdrożenia  
**Kapitał:** $25,000  
**Pary:** ZEC, UNI, VIRTUAL (bez rotacji)

---

## 📊 **Podział Kapitału**

### **Założenia:**
- **Total Capital:** $25,000
- **3 pary:** ZEC, UNI, VIRTUAL
- **Target per pair:** ~$3,500 (14% kapitału)
- **Max per pair:** $5,000 (20% kapitału - hard cap)

### **Rozkład:**
```
ZEC:    $3,500 target  (max $5,000)
UNI:    $3,500 target  (max $5,000)
VIRTUAL: $3,500 target  (max $5,000)
─────────────────────────────────────
Total:  $10,500 active (42% kapitału)
Buffer: $14,500 (58% - rezerwa na SL, hedging, etc.)
```

---

## 🔧 **Konfiguracja GridManager**

### **Domyślne Warstwy (L1-L5):**

| Layer | Offset (bps) | Capital % | Orders/Side | Status | Capital per Layer ($3,500) |
|-------|---------------|-----------|-------------|--------|----------------------------|
| **L1** | 20 bps (0.20%) | 25% | 2 | ✅ Active | $875 |
| **L2** | 30 bps (0.30%) | 30% | 2 | ✅ Active | $1,050 |
| **L3** | 45 bps (0.45%) | 25% | 2 | ✅ Active | $875 |
| **L4** | 65 bps (0.65%) | 15% | 1 | ⏸ Parking | $525 |
| **L5** | 90 bps (0.90%) | 5% | 1 | ⏸ Parking | $175 |

**Suma active (L1-L3):** 80% = $2,800 per pair  
**Suma parking (L4-L5):** 20% = $700 per pair

---

## 💰 **Szczegółowy Grid dla ZEC (mid = 600 USDT)**

### **Założenia:**
- **Para:** ZEC
- **Mid Price:** 600.00 USDT
- **Capital Per Pair:** $3,500
- **Status:** Neutral (skew = 0, bias = neutral)

### **Obliczenia per Layer:**

```
L1: $3,500 × 25% = $875  → $875 / 4 = $218.75 per order (2 bid + 2 ask)
L2: $3,500 × 30% = $1,050 → $1,050 / 4 = $262.50 per order (2 bid + 2 ask)
L3: $3,500 × 25% = $875  → $875 / 4 = $218.75 per order (2 bid + 2 ask)
─────────────────────────────────────────────────────────────
Total Active: $2,800 (80%)
L4-L5: $700 (20%, parking - nieaktywne)
```

### **Orderbook (ZEC, mid = 600.00):**

```
ASK Side (Sprzedaż):
─────────────────────────────────────────────────────────────
L1-1: 600.60  |  $218.75  |  Offset: +20 bps | Size: 0.364 ZEC
L1-2: 600.62  |  $218.75  |  Offset: +22 bps | Size: 0.364 ZEC
─────────────────────────────────────────────────────────────
L2-1: 601.20  |  $262.50  |  Offset: +30 bps | Size: 0.437 ZEC
L2-2: 601.22  |  $262.50  |  Offset: +32 bps | Size: 0.437 ZEC
─────────────────────────────────────────────────────────────
L3-1: 601.80  |  $218.75  |  Offset: +45 bps | Size: 0.364 ZEC
L3-2: 601.82  |  $218.75  |  Offset: +47 bps | Size: 0.364 ZEC
─────────────────────────────────────────────────────────────
MID: 600.00
─────────────────────────────────────────────────────────────
BID Side (Kupno):
─────────────────────────────────────────────────────────────
L1-1: 599.40  |  $218.75  |  Offset: -20 bps | Size: 0.365 ZEC
L1-2: 599.38  |  $218.75  |  Offset: -22 bps | Size: 0.365 ZEC
─────────────────────────────────────────────────────────────
L2-1: 598.80  |  $262.50  |  Offset: -30 bps | Size: 0.438 ZEC
L2-2: 598.78  |  $262.50  |  Offset: -32 bps | Size: 0.438 ZEC
─────────────────────────────────────────────────────────────
L3-1: 598.20  |  $218.75  |  Offset: -45 bps | Size: 0.366 ZEC
L3-2: 598.18  |  $218.75  |  Offset: -47 bps | Size: 0.366 ZEC
─────────────────────────────────────────────────────────────

Total: 12 orderów (6 bid + 6 ask)
Total Notional: ~$2,800 (80% z $3,500)
Max Exposure: ~$2,800 (jeśli wszystkie wypełnią się po jednej stronie)
```

---

## 💰 **Szczegółowy Grid dla UNI (mid = 8.50 USDT)**

### **Założenia:**
- **Para:** UNI
- **Mid Price:** 8.50 USDT
- **Capital Per Pair:** $3,500

### **Orderbook (UNI, mid = 8.50):**

```
ASK Side (Sprzedaż):
─────────────────────────────────────────────────────────────
L1-1: 8.5017  |  $218.75  |  Offset: +20 bps | Size: 25.73 UNI
L1-2: 8.5019  |  $218.75  |  Offset: +22 bps | Size: 25.73 UNI
─────────────────────────────────────────────────────────────
L2-1: 8.5026  |  $262.50  |  Offset: +30 bps | Size: 30.88 UNI
L2-2: 8.5028  |  $262.50  |  Offset: +32 bps | Size: 30.88 UNI
─────────────────────────────────────────────────────────────
L3-1: 8.5038  |  $218.75  |  Offset: +45 bps | Size: 25.73 UNI
L3-2: 8.5040  |  $218.75  |  Offset: +47 bps | Size: 25.73 UNI
─────────────────────────────────────────────────────────────
MID: 8.5000
─────────────────────────────────────────────────────────────
BID Side (Kupno):
─────────────────────────────────────────────────────────────
L1-1: 8.4983  |  $218.75  |  Offset: -20 bps | Size: 25.74 UNI
L1-2: 8.4981  |  $218.75  |  Offset: -22 bps | Size: 25.74 UNI
─────────────────────────────────────────────────────────────
L2-1: 8.4974  |  $262.50  |  Offset: -30 bps | Size: 30.89 UNI
L2-2: 8.4972  |  $262.50  |  Offset: -32 bps | Size: 30.89 UNI
─────────────────────────────────────────────────────────────
L3-1: 8.4962  |  $218.75  |  Offset: -45 bps | Size: 25.74 UNI
L3-2: 8.4960  |  $218.75  |  Offset: -47 bps | Size: 25.74 UNI
─────────────────────────────────────────────────────────────

Total: 12 orderów (6 bid + 6 ask)
Total Notional: ~$2,800
```

---

## 💰 **Szczegółowy Grid dla VIRTUAL (mid = 2.50 USDT)**

### **Założenia:**
- **Para:** VIRTUAL
- **Mid Price:** 2.50 USDT
- **Capital Per Pair:** $3,500

### **Orderbook (VIRTUAL, mid = 2.50):**

```
ASK Side (Sprzedaż):
─────────────────────────────────────────────────────────────
L1-1: 2.5005  |  $218.75  |  Offset: +20 bps | Size: 87.50 VIRTUAL
L1-2: 2.5006  |  $218.75  |  Offset: +22 bps | Size: 87.50 VIRTUAL
─────────────────────────────────────────────────────────────
L2-1: 2.5008  |  $262.50  |  Offset: +30 bps | Size: 105.00 VIRTUAL
L2-2: 2.5009  |  $262.50  |  Offset: +32 bps | Size: 105.00 VIRTUAL
─────────────────────────────────────────────────────────────
L3-1: 2.5011  |  $218.75  |  Offset: +45 bps | Size: 87.50 VIRTUAL
L3-2: 2.5012  |  $218.75  |  Offset: +47 bps | Size: 87.50 VIRTUAL
─────────────────────────────────────────────────────────────
MID: 2.5000
─────────────────────────────────────────────────────────────
BID Side (Kupno):
─────────────────────────────────────────────────────────────
L1-1: 2.4995  |  $218.75  |  Offset: -20 bps | Size: 87.51 VIRTUAL
L1-2: 2.4994  |  $218.75  |  Offset: -22 bps | Size: 87.51 VIRTUAL
─────────────────────────────────────────────────────────────
L2-1: 2.4992  |  $262.50  |  Offset: -30 bps | Size: 105.01 VIRTUAL
L2-2: 2.4991  |  $262.50  |  Offset: -32 bps | Size: 105.01 VIRTUAL
─────────────────────────────────────────────────────────────
L3-1: 2.4989  |  $218.75  |  Offset: -45 bps | Size: 87.51 VIRTUAL
L3-2: 2.4988  |  $218.75  |  Offset: -47 bps | Size: 87.51 VIRTUAL
─────────────────────────────────────────────────────────────

Total: 12 orderów (6 bid + 6 ask)
Total Notional: ~$2,800
```

---

## 🛡️ **Spójność z Soft SL (Per-Pair MaxLoss)**

### **Konfiguracja Soft SL:**

```bash
# .env
ZEC_MAX_LOSS_PER_SIDE_USD=120
UNI_MAX_LOSS_PER_SIDE_USD=170
VIRTUAL_MAX_LOSS_PER_SIDE_USD=170
```

### **Nansen Adjust:**

```
risk = 'ok'     → maxLoss × 1.0 (100%)
risk = 'caution' → maxLoss × 0.8 (80%)
risk = 'avoid'   → maxLoss × 0.6 (60%)
```

### **Przykład: ZEC z Nansen 'caution':**

```
Base maxLoss: $120
Nansen adjust: 0.8
Effective maxLoss: $120 × 0.8 = $96
```

### **Sprawdzenie Spójności:**

**ZEC Grid:**
- **Max exposure per side:** ~$1,400 (jeśli wszystkie 6 orderów wypełnią się)
- **Soft SL limit:** $96 (z Nansen caution)
- **Ratio:** $1,400 / $96 = **14.6×**

**Interpretacja:**
- ✅ Grid może mieć większe exposure niż SL limit
- ✅ SL działa na **unrealized PnL**, nie na notional
- ✅ Jeśli pozycja straci $96 → SL zamyka, niezależnie od notional

**Przykład:**
```
ZEC pozycja: 2.0 ZEC @ 600 (notional = $1,200)
Cena spada do: 552 (strat 8% = -$96)
→ Soft SL trigger → zamknięcie pozycji
```

---

## 📊 **Podsumowanie: Grid vs SL**

### **Grid (Multi-Layer):**
- **ZEC:** ~$2,800 notional (12 orderów)
- **UNI:** ~$2,800 notional (12 orderów)
- **VIRTUAL:** ~$2,800 notional (12 orderów)
- **Total:** ~$8,400 notional (36 orderów)

### **Soft SL (Per-Pair):**
- **ZEC:** $96-$120 maxLoss (zależnie od Nansen)
- **UNI:** $136-$170 maxLoss
- **VIRTUAL:** $136-$170 maxLoss

### **Daily Loss Limit:**
- **Total:** $200-$400 (z .env)

**Efekt:**
- ✅ Grid może mieć duże notional
- ✅ SL chroni przed stratami (unrealized PnL)
- ✅ Niezależne systemy (grid = exposure, SL = protection)

---

## 🔧 **Konfiguracja .env**

```bash
# Multi-layer MM
ENABLE_MULTI_LAYER=true
ACTIVE_LAYERS=3
NUM_LAYERS=5

# Capital per pair (używane przez GridManager.generateGridOrders)
# ⚠️ WAŻNE: To jest używane do obliczania capitalPerPair w executeMultiLayerMM
ROTATION_TARGET_PER_PAIR_USD=3500
ROTATION_MAX_PER_PAIR_USD=5000

# Soft SL per pair
ZEC_MAX_LOSS_PER_SIDE_USD=120
UNI_MAX_LOSS_PER_SIDE_USD=170
VIRTUAL_MAX_LOSS_PER_SIDE_USD=170

# Nansen (adjusts maxLoss)
NANSEN_ENABLED=true

# Parking layers (opcjonalnie)
PARKING_ACTIVATION_BPS=25
DRIFT_TRIGGER_BPS=6
```

---

## 🎯 **Checklist Przed Włączeniem**

- [ ] `ENABLE_MULTI_LAYER=true` w .env
- [ ] `ROTATION_TARGET_PER_PAIR_USD=3500` ustawione
- [ ] Soft SL działa (sprawdzone 1-2 dni)
- [ ] Nansen SL działa
- [ ] Per-pair caps działają
- [ ] Monitoring orderów (36 orderów vs 6)
- [ ] Rate limits OK

---

## 📋 **Oczekiwane Logi**

### **Przy starcie:**
```
🏛️  Multi-layer grid enabled: Grid: 3 active layers (L1-L3), 2 parking layers
```

### **W executeMultiLayerMM:**
```
[MM] Executing multi-layer MM for ZEC
🧭 ZEC Nansen bias: NEUTRAL +0.00 (neutral signal)
[MM] Generated 12 grid orders for ZEC (L1-L3 active)
```

### **W logach orderów:**
```
[MM] Placing grid order: ZEC L1 BID @ 599.40 size=0.365 ($218.75)
[MM] Placing grid order: ZEC L1 ASK @ 600.60 size=0.364 ($218.75)
...
```

---

## 🎯 **Podsumowanie**

**Grid Configuration:**
- ✅ 3 pary × 12 orderów = 36 orderów total
- ✅ ~$2,800 notional per pair (L1-L3 active)
- ✅ L4-L5 parking (aktywują się przy skew/drift)

**SL Protection:**
- ✅ Per-pair maxLoss: $96-$170 (zależnie od Nansen)
- ✅ Daily limit: $200-$400
- ✅ Nansen conflict SL

**Status:** ✅ **GOTOWE DO WDROŻENIA!**

---

**Gotowe!** Masz pełną konfigurację multi-layer grid dla ZEC/UNI/VIRTUAL. 🎯

