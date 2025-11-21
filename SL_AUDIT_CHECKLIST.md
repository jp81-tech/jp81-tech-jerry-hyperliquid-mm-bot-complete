# 🛡️ SL Audit Checklist - ZEC/UNI/VIRTUAL Freeze Mode (1-2 dni)

## 🎯 **Cel Audytu**

**Pytanie kluczowe:**
> "Czy soft SL + Nansen SL + daily SL naprawdę robią to, co myślimy, że robią?"

**Testy na:**
- ZEC / UNI / VIRTUAL (freeze mode - rotacja wyłączona)
- 1-2 dni obserwacji
- Weryfikacja wszystkich mechanizmów SL

---

## 0️⃣ **Szybkie Komendy do Logów**

### **Na serwerze HL:**

```bash
cd /root/hyperliquid-mm-bot-complete

# Live podgląd – SL + Nansen:
journalctl -u mm-bot.service -f --no-pager | egrep "SL|NANSEN|RISK|cooldown|DAILY"

# Ostatnie 2h z SL:
journalctl -u mm-bot.service --since "2 hours ago" --no-pager \
  | egrep "SL|NANSEN|RISK|cooldown|DAILY"

# Jeśli masz własny bot.log:
tail -n 200 bot.log | egrep "SL|NANSEN|RISK|cooldown|DAILY"
```

### **Mini-ściąga komend:**

```bash
# Wszystkie SL eventy z ostatnich 12h:
journalctl -u mm-bot.service --since "12 hours ago" --no-pager \
  | egrep "SL|RISK|cooldown" | grep -E "ZEC|UNI|VIRTUAL"

# Tylko ZEC SL z dzisiaj:
journalctl -u mm-bot.service --since "today" --no-pager \
  | egrep "SL|RISK|cooldown" | grep "ZEC"

# Nansen sygnały dla VIRTUAL z wczoraj:
journalctl -u mm-bot.service --since "yesterday" --until "today" --no-pager \
  | egrep "NANSEN" | grep "VIRTUAL"

# Wszystkie conflict SL z ostatnich 24h:
journalctl -u mm-bot.service --since "24 hours ago" --no-pager \
  | egrep "CONFLICT|NANSEN.*SL" | grep -E "ZEC|UNI|VIRTUAL"

# Soft SL cooldowny:
journalctl -u mm-bot.service --since "6 hours ago" --no-pager \
  | egrep "cooldown|COOLDOWN" | grep -E "ZEC|UNI|VIRTUAL"

# Daily SL (jeśli wystąpił):
journalctl -u mm-bot.service --since "today" --no-pager \
  | egrep "DAILY|daily.*loss|Daily.*limit"

# Wszystkie Nansen risk levels:
journalctl -u mm-bot.service --since "2 hours ago" --no-pager \
  | egrep "NANSEN.*risk|risk=.*avoid|risk=.*caution|risk=.*ok" | grep -E "ZEC|UNI|VIRTUAL"
```

---

## 1️⃣ **Freeze Mode: Czy Gramy TYLKO ZEC/UNI/VIRTUAL?**

### **Cel:**
Rotacja wyłączona, ale SL + Nansen dalej działają.

### **Co sprawdzić w logach:**

#### **1.1. Przy starcie bota (po restarcie z freeze mode):**

**Szukaj:**
```
[ROTATION] Freeze mode active – locked pairs: ZEC,UNI,VIRTUAL
```

**Jeśli widzisz taki log → ✅ freeze działa.**

#### **1.2. Czy nie pojawiają się inne pary w MM loop:**

**Komenda:**
```bash
journalctl -u mm-bot.service --since "2 hours ago" --no-pager \
  | egrep "Executing MM|pair=" | grep -v "ZEC\|UNI\|VIRTUAL"
```

**Upewnij się, że pojawiają się tylko:**
- ZEC
- UNI
- VIRTUAL (albo dokładna nazwa perpa, np. VIRTUALS)

**Jeśli nagle wpadnie np. PUMP, SOL, ETH → znaczy, że gdzieś rotacja/boost jeszcze działa i trzeba będzie to potem wygasić.**

---

## 2️⃣ **Soft SL Per Pair – Czy W Ogóle Strzela i Jak**

### **Parametry testowe:**

**Z .env + Nansen adjust:**

| Para | Base Limit | Nansen Adjust | Efektywny Limit |
|------|------------|---------------|-----------------|
| **ZEC** | $120 | ok: 1.0× | $120 |
| **ZEC** | $120 | caution: 0.8× | $96 |
| **ZEC** | $120 | avoid: 0.6× | $72 |
| **UNI** | $170 | ok: 1.0× | $170 |
| **UNI** | $170 | caution: 0.8× | $136 |
| **UNI** | $170 | avoid: 0.6× | $102 |
| **VIRTUAL** | $170 | ok: 1.0× | $170 |
| **VIRTUAL** | $170 | caution: 0.8× | $136 |
| **VIRTUAL** | $170 | avoid: 0.6× | $102 |

---

### **2.1. Czy Bot Liczy Poprawnie uPnL + maxLoss?**

**W logach powinny być wpisy podobne do:**

```
[RISK] Soft SL check ZEC: uPnL=-83.50 maxLoss=96 (risk=caution adj=0.8)
[RISK] Soft SL check UNI: uPnL=-45.10 maxLoss=170 (risk=ok adj=1.0)
```

**Co sprawdzić:**
- ✅ Czy uPnL jest ujemne dla strat (np. -83.50)
- ✅ Czy maxLoss odpowiada temu, co wynika z:
  - `.env` (base limit)
  - × adjust z Nansen (0.6 / 0.8 / 1.0)

**Jeśli widzisz np. maxLoss=0 albo undefined → coś jest nie tak z configem lub mapowaniem nazw.**

**Komenda do sprawdzenia:**
```bash
journalctl -u mm-bot.service --since "2 hours ago" --no-pager \
  | egrep "Soft SL check|maxLoss|uPnL" | grep -E "ZEC|UNI|VIRTUAL"
```

---

### **2.2. Jak Wygląda Moment Odpalenia Soft SL**

**Gdy strata przekroczy próg (np. ZEC uPnL < -96):**

**Szukaj sekwencji:**

```
[RISK] ❌ SOFT SL HIT on ZEC: uPnL $-101.23 < -$96.00
🧠 [NANSEN] ZEC marked as CAUTION → tightening soft SL to 80% (maxLoss=96.00)
🚨 ZEC Soft SL (NORMAL): -101.23 USDC (limit=120, breach=1.05x)
✅ ZEC position closed successfully after soft SL
⏸ ZEC in soft SL cooldown for 60 minutes
```

**Co sprawdzić praktycznie:**
- ✅ Czy naprawdę w Hyperliquid po tym logu:
  - pozycja na ZEC jest zamknięta (size ≈ 0)
  - nie ma wiszących orderów na ZEC (lub pojawiają się dopiero po cooldownie)
- ✅ Czy cooldown jest taki, jak konfig:
  - normal: 60 min
  - severe: 120 min (np. gdy strata dużo większa niż limit)

**Komenda:**
```bash
journalctl -u mm-bot.service --since "6 hours ago" --no-pager \
  | egrep "SOFT SL HIT|Soft SL.*HIT|position closed.*soft SL" | grep -E "ZEC|UNI|VIRTUAL"
```

---

### **2.3. Cooldown – Czy Para Jest Blokowana**

**Po odpaleniu Soft SL powinny się pojawiać logi typu:**

```
[RISK] ZEC is in soft SL cooldown (remaining 37 min) – skipping new orders
```

**Sprawdź:**
- ✅ Czy w czasie cooldownu:
  - **NIE** pojawiają się logi w stylu:
    - `Placing MM orders for ZEC`
    - `Executing MM for ZEC`
- ✅ Jeśli się pojawiają → znaczy, że cooldown jest ignorowany

**Komenda:**
```bash
# Sprawdź czy w czasie cooldownu nie ma MM orderów:
journalctl -u mm-bot.service --since "2 hours ago" --no-pager \
  | grep -A 5 "cooldown" | grep -E "Executing MM|Placing.*order" | grep "ZEC"
```

---

## 3️⃣ **Nansen Conflict SL – Czy "Nie Handlujemy Przeciwko Rynkowi"**

**To jest ta część, gdzie:**
- liczy się severity 0–10
- mamy tiered close:
  - LOW: ~30% redukcji
  - MEDIUM: ~60%
  - HIGH: 100% + dłuższy cooldown
- jest bias flip detection (np. Nansen z bullish na bearish przy naszej long pozycji)

---

### **3.1. Jak Powinien Wyglądać Konfliktowy Log**

**Szukaj wpisów podobnych do:**

```
[NANSEN-SL] Conflict detected on UNI: bias=strong_short, side=long, uPnL=-37.50
[NANSEN-SL] severity=6.5 tier=MEDIUM (close 60%) breachMultiple=1.3 flips=1
[NANSEN-SL] Executing conflict SL on UNI: closing 60% of position (size=xx.xx)
[NANSEN-SL] Setting conflict cooldown for UNI: 45 min
```

**Do sprawdzenia:**
- ✅ Czy severity ma sens:
  - mała strata + łagodny bias → 3–4
  - duża strata + mocny bias + flip → 7–10
- ✅ Czy procent zamykania odpowiada tierowi:
  - LOW → ~30%
  - MEDIUM → ~60%
  - HIGH → 100%

**Komenda:**
```bash
journalctl -u mm-bot.service --since "12 hours ago" --no-pager \
  | egrep "CONFLICT|Conflict detected|severity=" | grep -E "ZEC|UNI|VIRTUAL"
```

---

### **3.2. Cost–Benefit Check – Czy Czasem NIE Zamykamy**

**Powinny być też logi typu:**

```
[NANSEN-SL] Skip close | pair=ZEC severity=4.2 notional=100.00 cost=0.20 risk=0.15
[NANSEN-SL] Skip conflict close on ZEC: cost=18.50 > potentialBenefit=12.30 (severity=4.2)
```

**To jest zdrowy sygnał:**
➡️ Nansen SL odzywa się, ale nie strzela zawsze, tylko gdy ma sens.

**Dobrze jeśli:**
- ✅ są zarówno logi `Executing conflict SL`, jak i `Skip conflict close`
- ✅ nie ma sytuacji, że każda mini-strata od razu zamyka pozycję

**Komenda:**
```bash
journalctl -u mm-bot.service --since "24 hours ago" --no-pager \
  | egrep "Skip.*close|Skip conflict" | grep -E "ZEC|UNI|VIRTUAL"
```

---

## 4️⃣ **Nansen Bias → Soft SL Adjust**

**Chcemy zobaczyć, czy:**
- risk level (ok/caution/avoid) wpływa na maxLoss tak jak chcemy
- i czy to widać w logach

---

### **4.1. Logi Sygnałów Nansen**

**Szukaj czegoś w stylu:**

```
[NANSEN] ZEC risk=avoid score=22 7d=$-2.5M 24h=$-0.5M fw=35 sell=32.5%
[NANSEN] UNI risk=ok score=68 7d=$+3.2M 24h=$+0.8M fw=65 sell=22.0%
[NANSEN] VIRTUAL risk=caution score=54 7d=$+1.1M 24h=$-0.2M fw=48 sell=29.0%
```

**oraz:**

```
🧠 [NANSEN] ZEC marked as AVOID → tightening soft SL to 60% (maxLoss=72.00)
🧠 [NANSEN] UNI marked as OK → full soft SL limit (maxLoss=170.00)
🧠 [NANSEN] VIRTUAL marked as CAUTION → tightening soft SL to 80% (maxLoss=136.00)
```

**Sprawdź:**
- ✅ Czy risk z Nansena jest spójny z tym, co wiemy z Nansen Pro:
  - np. ZEC: duże negatywne flow → caution / avoid
  - UNI/VIRTUAL: okolicznościowe ok / caution w zależności od flow
- ✅ Czy effective maxLoss = base × (0.6 / 0.8 / 1.0)

**Komenda:**
```bash
journalctl -u mm-bot.service --since "2 hours ago" --no-pager \
  | egrep "NANSEN.*risk|marked as.*AVOID|marked as.*CAUTION|marked as.*OK" | grep -E "ZEC|UNI|VIRTUAL"
```

---

## 5️⃣ **Daily Loss Limit – Czy W Razie Czego Po Prostu Wyłącza Bota**

**Założenia:**
- Daily loss limit ~ -200 USD na cały dzień

---

### **Jak Powinno To Wyglądać w Logach**

**Jeśli day PnL przekroczy limit:**

```
[DAILY_SL] Daily loss limit hit: realized=-145.30, unrealized=-63.80, total=-209.10 (limit=-200)
[DAILY_SL] Stopping MM for today – canceling all orders and entering safe mode
```

**Potem:**
- ✅ brak nowych MM orderów
- ✅ ewentualnie log w stylu:

```
[DAILY_SL] In daily SL safe mode – skipping trading loop
```

**Na te 1–2 dni możesz wręcz chcieć sprowokować taki dzień na małym size, żeby:**
- ✅ raz zobaczyć, że daily SL faktycznie zatrzymuje bota
- ✅ sprawdzić, czy następnego dnia bot startuje normalnie (np. resetuje licznik o 00:00 UTC lub przy restarcie)

**Komenda:**
```bash
journalctl -u mm-bot.service --since "today" --no-pager \
  | egrep "DAILY|daily.*loss|Daily.*limit|safe mode"
```

---

## 6️⃣ **Co Konkretnie Obserwować Przez Te 1–2 Dni**

### **Dzień 1 – "Czy W Ogóle Żyje"**

#### **1. ✅ Freeze Mode:**
- log z locked pairs: ZEC,UNI,VIRTUAL

**Komenda:**
```bash
journalctl -u mm-bot.service --since "today" --no-pager \
  | grep -i "freeze\|locked pairs"
```

#### **2. ✅ Nansen:**
- logi `[NANSEN]` dla wszystkich 3 par (risk, score, flows)

**Komenda:**
```bash
journalctl -u mm-bot.service --since "today" --no-pager \
  | egrep "NANSEN.*ZEC|NANSEN.*UNI|NANSEN.*VIRTUAL" | head -20
```

#### **3. ✅ Soft SL:**
- przynajmniej 1–2 checki z uPnL + maxLoss w logach
- idealnie 1 realny soft SL event na małym size (żeby zobaczyć cały flow)

**Komenda:**
```bash
journalctl -u mm-bot.service --since "today" --no-pager \
  | egrep "Soft SL|SOFT SL|maxLoss" | grep -E "ZEC|UNI|VIRTUAL"
```

#### **4. ✅ Conflict SL:**
- choć raz pojawienie się logu `Conflict detected` + albo `Executing conflict SL`, albo `Skip conflict close`

**Komenda:**
```bash
journalctl -u mm-bot.service --since "today" --no-pager \
  | egrep "Conflict|CONFLICT" | grep -E "ZEC|UNI|VIRTUAL"
```

---

### **Dzień 2 – "Czy Nie Jest Za Agresywny / Za Miękki"**

#### **1. Sprawdź, czy po każdej większej stracie:**
- ✅ albo wchodzi Soft SL
- ✅ albo przynajmniej Nansen conflict robi partial close / skip z logiem

**Komenda:**
```bash
# Znajdź wszystkie większe straty (>$50):
journalctl -u mm-bot.service --since "yesterday" --no-pager \
  | egrep "uPnL.*-[0-9]{2,}|PnL.*-[0-9]{2,}" | grep -E "ZEC|UNI|VIRTUAL"
```

#### **2. Sprawdź, czy:**
- ✅ nie dostajesz 10× conflict SL przy mikroskopijnych ruchach (zbyt agresywny)
- ✅ albo czy przy -150 / -200 na parze w ogóle coś z SL nie zareagowało (za miękki)

**Komenda:**
```bash
# Policz ile razy conflict SL wystąpił:
journalctl -u mm-bot.service --since "yesterday" --no-pager \
  | egrep "Conflict.*SL|Executing conflict" | wc -l

# Sprawdź czy były duże straty bez reakcji SL:
journalctl -u mm-bot.service --since "yesterday" --no-pager \
  | egrep "uPnL.*-[0-9]{3,}" | grep -v "SL\|RISK\|cooldown"
```

---

## 7️⃣ **Co Mi Potem Napisać**

**Jak już puścisz to na żywo, najlepiej mi potem wrzucić:**

### **1. Kilka realnych logów:**

#### **A) 1–2 przypadki soft SL (ZEC / UNI / VIRTUAL):**
```bash
# Skopiuj pełny flow od "Soft SL check" do "cooldown":
journalctl -u mm-bot.service --since "yesterday" --no-pager \
  | grep -A 10 "SOFT SL HIT" | grep -E "ZEC|UNI|VIRTUAL"
```

#### **B) 1 przykład conflict SL (choćby z severity=low):**
```bash
# Skopiuj pełny flow od "Conflict detected" do "cooldown":
journalctl -u mm-bot.service --since "yesterday" --no-pager \
  | grep -A 10 "Conflict detected" | grep -E "ZEC|UNI|VIRTUAL"
```

#### **C) Jeśli się uda: daily SL trigger:**
```bash
journalctl -u mm-bot.service --since "yesterday" --no-pager \
  | grep -A 5 "DAILY.*limit\|daily.*loss" | head -20
```

### **2. Plus info:**

- ✅ czy widziałeś sytuację "ZEC poszedł do 20k notional i nikt go nie kontrolował" – czy już nie

**Komenda do sprawdzenia:**
```bash
# Sprawdź maksymalny notional ZEC:
journalctl -u mm-bot.service --since "yesterday" --no-pager \
  | grep "ZEC" | grep -E "notional|position.*value" | grep -oE "[0-9]{4,}" | sort -n | tail -5
```

---

## 8️⃣ **Szablon Raportu Po Testach**

**Wklej to i wypełnij:**

```markdown
# 📊 SL Audit Report - ZEC/UNI/VIRTUAL (Data: YYYY-MM-DD)

## ✅ Freeze Mode
- [ ] Freeze mode działa (locked pairs: ZEC,UNI,VIRTUAL)
- [ ] Tylko 3 pary w MM loop
- [ ] Brak innych par

## ✅ Soft SL
- [ ] uPnL + maxLoss liczone poprawnie
- [ ] Soft SL strzela gdy przekroczy limit
- [ ] Cooldown działa (60/120 min)
- [ ] Nansen adjust działa (60%/80%/100%)

**Przykładowe logi:**
```
[Wklej tutaj logi soft SL]
```

## ✅ Nansen Conflict SL
- [ ] Conflict detection działa
- [ ] Severity ma sens (3-10)
- [ ] Tiered close działa (30%/60%/100%)
- [ ] Cost-benefit check działa (skip gdy cost > risk)

**Przykładowe logi:**
```
[Wklej tutaj logi conflict SL]
```

## ✅ Nansen Bias → Soft SL Adjust
- [ ] Risk levels są spójne (ok/caution/avoid)
- [ ] maxLoss adjust działa (0.6/0.8/1.0)

**Przykładowe logi:**
```
[Wklej tutaj logi Nansen risk]
```

## ✅ Daily Loss Limit
- [ ] Daily SL działa (jeśli wystąpił)
- [ ] Bot zatrzymuje się przy limicie
- [ ] Reset następnego dnia

## ⚠️ Problemy / Obserwacje
- [ ] ZEC notional > 20k? (TAK/NIE)
- [ ] Zbyt agresywny SL? (TAK/NIE)
- [ ] Zbyt miękki SL? (TAK/NIE)
- [ ] Inne problemy:

## 🎯 Rekomendacje
- [ ] Co trzeba podregulować:
  - Per token limits?
  - Nansen progi?
  - Tiered close?
```

---

## 🚀 **Gotowe do Testów!**

**Wszystkie komendy i checklisty są gotowe. Powodzenia!** 🎯

