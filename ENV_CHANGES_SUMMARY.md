# 📋 Podsumowanie Zmian w .env - Kapitał 25k

## ✅ **Zmiany Wprowadzone**

### **1. Rotation Caps - Twarde Limity Per Para**

```bash
# Kapital dla referencji (tylko jeśli używasz w kodzie)
TOTAL_CAPITAL_USD=25000

# Ile kasy bot ma próbować utrzymać na jedną parę przy rotacji
ROTATION_TARGET_PER_PAIR_USD=3500      # ~14% całego kapitału

# Twardy cap na jedną parę (żeby nie było ZEC 20k)
ROTATION_MAX_PER_PAIR_USD=5000         # max ~20% kapitału na parę
```

**Efekt:**
- Nawet jak coś się wyłamie, jedna para nie powinna przekroczyć ~5k notional
- ZEC + Nansen bias = realnie dużo mniej niż 5k, bo:
  - ZEC ma niski rotationScore
  - często risk='avoid' → w ogóle nie wejdzie do rotacji

---

### **2. Soft SL Per Para - Konkretne Limity**

```bash
# Soft SL – bazowe limity na jedną stronę pozycji
# Nansen mnożniki: ok=100%, caution=80%, avoid=60%

ZEC_MAX_LOSS_PER_SIDE_USD=120          # ZEC: bardzo twardy kaganiec (efektywne: 72-96 USD)
UNI_MAX_LOSS_PER_SIDE_USD=170          # UNI: normalny oddech (efektywne: 102-170 USD)
VIRTUAL_MAX_LOSS_PER_SIDE_USD=170     # VIRTUAL: normalny oddech (efektywne: 102-170 USD)
```

**Jak to się przekłada w praktyce:**

#### **ZEC (chcemy bardzo twardy kaganiec)**
- Base: 120 USD
- ZEC ma z Nansena prawie zawsze risk='caution' albo avoid

**Efektywne SL:**
- avoid → 120 × 0.6 = **72 USD**
- caution → 120 × 0.8 = **96 USD**
- ok → 120 (prawie nigdy)

👉 **Czyli ZEC poleci ze stołu między –72 a –96 USD**, a nie –150/–200. Do tego rotacja go prawie nie wybiera, więc nie urośnie do chorego notional.

#### **UNI**
- Base: 170 USD

**Efektywne SL:**
- ok (normalny case) → **170 USD**
- caution → 170 × 0.8 = **136 USD**
- avoid → 170 × 0.6 = **102 USD**

👉 **UNI ma mieć "normalny" oddech**: może chwilę pobujać się na –150/–170, bo jest płynne i sensowne.

#### **VIRTUAL**
- Base: 170 USD (tak jak UNI)

**Efektywne SL:**
- ok (często, przy dobrych flow) → **170 USD**
- caution → 136 USD
- avoid → 102 USD

👉 **VIRTUAL traktujemy jak "nasz koń roboczy"** – ma pełny limit, dopóki Nansen nie krzyczy.

---

### **3. Nansen - Progi Zostają (Firewall)**

**Minimalny zestaw w .env (już był):**

```bash
NANSEN_ENABLED=true
NANSEN_MIN_FRESH_WALLET_SCORE_FOR_ROTATION=50
NANSEN_MIN_SMART_FLOW_7D_USD=-1000000
NANSEN_MAX_TOP_HOLDER_SELL_PCT=0.30
NANSEN_BAD_FLOW_24H_USD=-1000000
NANSEN_GOOD_FLOW_24H_USD=1000000
NANSEN_REFRESH_INTERVAL_MS=900000   # 15 minut
```

**W kodzie już masz:**
- ZEC → max rotationScore = 25 + częste risk='avoid'
- UNI → +5 boost do score
- VIRTUAL → +8 boost do score

**Czyli:**
- Nansen nie prowadzi bota za rękę,
- tylko:
  - obcina toksyczne (ZEC, shady anonki),
  - podbija priorytet UNI/VIRTUAL w rotacji,
  - zaostrza soft SL tam, gdzie jest syf w danych.

---

## 🎯 **Co Teraz Zrobić**

### **1. Zrestartuj bota normalnie**

```bash
# Na serwerze
systemctl restart mm-bot.service
# lub
systemctl restart hyperliquid-mm-bot.service
```

### **2. Po kilku godzinach sprawdź logi:**

**Szukaj w logach:**
```bash
# Nansen signals
[NANSEN] ... risk=... score=...

# Soft SL triggers
[RISK] Soft SL trigger for ... uPnL=... maxLoss=...
```

**Sprawdź czy:**
- ✅ ZEC nie wchodzi do rotation setu
- ✅ UNI / VIRTUAL mają notional w okolicach 3.5–5k
- ✅ Soft SL odpala się w tych widełkach, których się spodziewamy

---

## 📊 **Przykładowe Logi (Co Powinno Się Pojawić)**

### **Nansen Signals:**
```
[NANSEN] ZEC risk=avoid score=0 7d=$-2.50M 24h=$-0.50M fw=35 sell=32.5%
[NANSEN] UNI risk=ok score=68 7d=$+3.20M 24h=$+0.80M fw=65 sell=22.0%
[NANSEN] VIRTUAL risk=ok score=85 7d=$+5.10M 24h=$+1.20M fw=75 sell=28.0%
```

### **Soft SL (ZEC - powinien być bardzo ciasny):**
```
[RISK] ❌ SOFT SL HIT on ZEC: uPnL $-85.00 < -$96.00
🧠 [NANSEN] ZEC marked as CAUTION → tightening soft SL to 80% (maxLoss=96.00)
```

### **Soft SL (UNI/VIRTUAL - normalny oddech):**
```
[RISK] ❌ SOFT SL HIT on UNI: uPnL $-175.00 < -$170.00
🧠 [NANSEN] UNI marked as OK → normal soft SL (maxLoss=170.00)
```

### **Rotation (ZEC powinien być wykluczony):**
```
[NANSEN] ZEC filtered out from rotation (risk=avoid)
✅ Rotated to: VIRTUAL, UNI, SHITCOIN
```

### **Notional Caps (żadna para > 5k):**
```
⚠️ VIRTUAL: position notional 5200.00 USD > cap 5000. Skipping new maker orders.
```

---

## ✅ **Status:**

**Wszystkie zmienne dodane do .env!**

- ✅ Rotation caps (TARGET=3500, MAX=5000)
- ✅ Soft SL per pair (ZEC=120, UNI=170, VIRTUAL=170)
- ✅ Nansen progi (zostają jak były)
- ✅ Usunięto duplikaty

**Gotowe do restartu bota!** 🚀

