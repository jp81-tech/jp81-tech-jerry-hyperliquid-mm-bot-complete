# 🔍 Quick Log Check - 30 Sekund Dashboard

## 📊 **Jak Szybko Sprawdzić Czy Bot Działa Poprawnie**

### **1. Nansen Signals (5 sekund)**

```bash
# Na serwerze
journalctl -u mm-bot.service --since "10 minutes ago" | grep "\[NANSEN\]"
```

**Co szukasz:**
- ✅ **ZEC**: `risk=avoid score=0` → **OK** (wykluczony z rotacji)
- ✅ **UNI**: `risk=ok score=60-70` → **OK** (w rotacji, normalny oddech)
- ✅ **VIRTUAL**: `risk=ok score=80-90` → **OK** (top priority w rotacji)

**Czerwone flagi:**
- ❌ ZEC z `risk=ok` → **PROBLEM** (nie powinien mieć ok)
- ❌ UNI/VIRTUAL z `risk=avoid` → **UWAGA** (sprawdź Nansen flows)

---

### **2. Rotation Status (5 sekund)**

```bash
journalctl -u mm-bot.service --since "10 minutes ago" | grep "Rotated to\|filtered out"
```

**Co szukasz:**
- ✅ `ZEC filtered out from rotation` → **OK** (nie wchodzi)
- ✅ `Rotated to: VIRTUAL, UNI, ...` → **OK** (ZEC nie ma w liście)
- ✅ Notional per pair: `3.5k-5k USD` → **OK** (w target range)

**Czerwone flagi:**
- ❌ ZEC w `Rotated to:` → **PROBLEM** (powinien być wykluczony)
- ❌ Notional > 5k → **PROBLEM** (przekroczył cap)

---

### **3. Soft SL Triggers (10 sekund)**

```bash
journalctl -u mm-bot.service --since "1 hour ago" | grep "SOFT SL HIT\|maxLoss="
```

**Co szukasz:**

#### **ZEC (powinien być bardzo ciasny):**
- ✅ `ZEC: uPnL $-85.00 < -$96.00` → **OK** (caution, 80% z 120 = 96)
- ✅ `ZEC: uPnL $-70.00 < -$72.00` → **OK** (avoid, 60% z 120 = 72)

**Czerwone flagi:**
- ❌ ZEC z `maxLoss=150` → **PROBLEM** (nie używa Nansen mnożnika)
- ❌ ZEC z `uPnL $-150` → **PROBLEM** (za późno, powinien być już zamknięty)

#### **UNI/VIRTUAL (normalny oddech):**
- ✅ `UNI: uPnL $-175.00 < -$170.00` → **OK** (ok, 100% z 170 = 170)
- ✅ `VIRTUAL: uPnL $-140.00 < -$136.00` → **OK** (caution, 80% z 170 = 136)

**Czerwone flagi:**
- ❌ UNI/VIRTUAL z `maxLoss=120` → **PROBLEM** (używa ZEC limitu zamiast 170)

---

### **4. Notional Caps (10 sekund)**

```bash
journalctl -u mm-bot.service --since "10 minutes ago" | grep "notional.*cap\|Skipping new maker orders"
```

**Co szukasz:**
- ✅ `VIRTUAL: position notional 4800.00 USD > cap 5000` → **OK** (pod capem)
- ✅ `⚠️ ZEC: position notional 5200.00 USD > cap 5000. Skipping new maker orders.` → **OK** (cap działa, nie dokłada)

**Czerwone flagi:**
- ❌ Notional > 5k i bot dalej dokłada ordery → **PROBLEM** (cap nie działa)
- ❌ Notional > 20k → **KRYTYCZNE** (ZEC problem powrócił!)

---

## 🎯 **Quick Health Check (30 sekund)**

### **Jeden Command - Wszystko Na Raz:**

```bash
journalctl -u mm-bot.service --since "1 hour ago" | grep -E "\[NANSEN\]|Rotated to|SOFT SL HIT|notional.*cap" | tail -20
```

**Interpretacja:**

**✅ ZDROWY BOT:**
```
[NANSEN] ZEC risk=avoid score=0 ...
[NANSEN] ZEC filtered out from rotation
[NANSEN] UNI risk=ok score=68 ...
[NANSEN] VIRTUAL risk=ok score=85 ...
✅ Rotated to: VIRTUAL, UNI, SHITCOIN
[RISK] ❌ SOFT SL HIT on ZEC: uPnL $-85.00 < -$96.00
🧠 [NANSEN] ZEC marked as CAUTION → tightening soft SL to 80% (maxLoss=96.00)
```

**❌ PROBLEM:**
```
[NANSEN] ZEC risk=ok score=25 ...  # ❌ ZEC nie powinien mieć ok!
✅ Rotated to: ZEC, UNI, VIRTUAL    # ❌ ZEC w rotacji!
[RISK] ❌ SOFT SL HIT on ZEC: uPnL $-150.00 < -$150.00  # ❌ Za późno!
⚠️ ZEC: position notional 20000.00 USD > cap 5000  # ❌ KRYTYCZNE!
```

---

## 📋 **Checklist - Co Sprawdzić Po Restarcie**

### **Po 1 godzinie:**
- [ ] ZEC nie jest w `Rotated to:`
- [ ] ZEC ma `risk=avoid` w logach Nansen
- [ ] UNI/VIRTUAL mają notional 3.5k-5k USD
- [ ] Soft SL dla ZEC używa mnożnika (maxLoss=72-96, nie 120)

### **Po 4 godzinach:**
- [ ] Żadna para nie przekroczyła 5k notional
- [ ] Soft SL dla UNI/VIRTUAL używa pełnego limitu (170 USD)
- [ ] Rotacja działa (pary się zmieniają zgodnie z Nansen score)

### **Po 24 godzinach:**
- [ ] ZEC nie urósł do > 5k notional
- [ ] UNI/VIRTUAL mają stabilne notional w target range
- [ ] Soft SL działa poprawnie dla wszystkich par

---

## 🚨 **Czerwone Flaggi - Kiedy Natychmiast Reagować**

1. **ZEC w rotacji** → Sprawdź Nansen API, może nie działa
2. **Notional > 10k** → Cap nie działa, sprawdź kod
3. **Soft SL nie używa mnożników** → Nansen hook nie działa
4. **ZEC z risk=ok** → Nansen progi mogą być złe, sprawdź dane

---

## ✅ **Status:**

**Gotowe do użycia!** Użyj tego przewodnika do szybkiego health check bota po restarcie. 🚀

