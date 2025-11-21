# 🚀 PRE-DEPLOYMENT CHECKLIST

## ✅ A. Sprawdzenie .env (lokalnie i na serwerze)

### 1. Tryb ostrożny na start:
```bash
DRY_RUN=true
ENABLE_MULTI_LAYER=true
SPREAD_PROFILE=conservative
BEHAVIOURAL_RISK_MODE=normal
CHASE_MODE_ENABLED=false
ROTATION_ENABLED=false
```

### 2. Limity ryzyka:
```bash
TOTAL_CAPITAL_USD=25000

ROTATION_TARGET_PER_PAIR_USD=3500
ROTATION_MAX_PER_PAIR_USD=5000

ZEC_MAX_LOSS_PER_SIDE_USD=120
UNI_MAX_LOSS_PER_SIDE_USD=170
VIRTUAL_MAX_LOSS_PER_SIDE_USD=170
DEFAULT_MAX_LOSS_PER_SIDE_USD=100

MAX_DAILY_LOSS_USD=200
```

### 3. Spread:
```bash
MAKER_SPREAD_BPS=40
MIN_FINAL_SPREAD_BPS=8
MAX_FINAL_SPREAD_BPS=140
AGGRESSIVE_SPREAD_MULTIPLIER=0.8
```

### 4. Behavioural / Nansen:
```bash
BEHAVIOURAL_RISK_MODE=normal
NANSEN_CONFLICT_CHECK_ENABLED=true
NANSEN_ENABLED=true
```

### 5. Pary na obserwację:
```bash
STICKY_PAIRS=ZEC,UNI,VIRTUAL
MAX_ACTIVE_PAIRS=3
ROTATION_ENABLED=false
```

---

## ✅ B. Szybki technical sanity-check (build)

### Na Macu (lokalnie):
```bash
cd ~/hyperliquid-mm-bot-complete
npm run build
```

**Oczekiwany wynik:** Build przechodzi (tylko znane TS-owe warningi)

### Na serwerze:
```bash
cd /root/hyperliquid-mm-bot-complete
npx tsx scripts/check-all-orders.ts || true
```

*(Jeśli nie masz tego skryptu, pomijamy – TS i tak się ładuje przy starcie)*

---

## ✅ C. Pierwsze uruchomienie – TYLKO DRY_RUN

### Na serwerze:
```bash
cd /root/hyperliquid-mm-bot-complete
ENV_FILE=.env npm start
```

### W drugim oknie (monitoring logów):
```bash
cd /root/hyperliquid-mm-bot-complete
tail -f bot.log | egrep 'SNAPSHOT|RISK|NANSEN|BehaviouralRisk|SOFT SL|DAILY LOSS'
```

### Co chcemy zobaczyć w logach w ciągu pierwszych ~15 minut:

1. **Multi-layer:**
   ```
   🏛️  Multi-layer grid enabled: ...
   ```

2. **Spread snapshoty:**
   ```
   [SNAPSHOT] pair=ZEC profile=conservative mode=multi-layer invSkew=... base=40.0bps profiled=40.0bps bidFinal=... askFinal=...
   ```

3. **Brak errorów** Nansen / conflict SL spam

4. **Brak SOFT SL HIT** (na DRY_RUN i przy małym ruchu to raczej nie powinno się pojawić)

5. **Notional na ZEC nie przekracza ~5–6k** w żadnym momencie

---

## ✅ D. Co zrobić zanim przełączymy na real money

1. **Co najmniej 1 pełny dzień w DRY_RUN=true** z logowaniem snapshotów

2. **Przez ten czas sprawdzić kilka razy dziennie:**
   - Spready w logach (czy nie są za wąskie typu 5 bps ani idiotycznie szerokie 300 bps)
   - Maksymalny notional na ZEC/UNI/VIRTUAL
   - Czy BehaviouralRisk nie wycina nam BUY non stop

3. **Jeśli wszystko wygląda zdrowo →**
   - Zostawić `SPREAD_PROFILE=conservative`
   - Ustawić `DRY_RUN=false`
   - **NIE WŁĄCZAĆ** jeszcze `CHASE_MODE_ENABLED` ani `SPREAD_PROFILE=aggressive`
   - Dopóki nie zobaczymy realnego PnL przez kilka dni

---

## 📊 SANITY-CHECK: ZEC przy 600$, kapitał 25k

### Założenia:
- TOTAL_CAPITAL_USD = 25000
- ROTATION_TARGET_PER_PAIR_USD = 3500
- ROTATION_MAX_PER_PAIR_USD = 5000
- BASE_ORDER_USD = 150
- MAKER_SPREAD_BPS = 40 (0.40%)
- SPREAD_PROFILE = conservative
- ENABLE_MULTI_LAYER = true
- CHASE_MODE_ENABLED = false
- Cena ZEC: 600 USD

### 1. Notional – ile ZEC na target / cap

**Target per pair:**
- 3500 USD / 600 USD ≈ **5.83 ZEC**

**Hard cap per pair:**
- 5000 USD / 600 USD ≈ **8.33 ZEC**

**Czyli:**
- Sensowny zakres pozycji na ZEC: **5–8 ZEC**
- Wszystko powyżej ~8.3 ZEC = blokujemy nowe maker orders (guard działa)

### 2. Order size z BASE_ORDER_USD = 150

Przy cenie 600 USD:
- 150 USD / 600 USD = **0.25 ZEC na order**

Załóżmy prosty grid: 5 warstw na BID i 5 na ASK, każda po 150 USD.
- 5 warstw * 150 USD = 750 USD po stronie BID
- 5 warstw * 150 USD = 750 USD po stronie ASK
- ➡️ Maksymalnie wystawione na siatce: **1500 USD ≈ 2.5 ZEC**

To jest:
- Dużo poniżej targetu 3500 USD
- Dużo poniżej hard capa 5000 USD

**Czyli:** grid jest konserwatywny – pozycja rośnie stopniowo, nie skacze nagle na 20k notional jak kiedyś.

### 3. Spread – jak się układa w praktyce

#### Case A: Spokojny rynek, brak FOMO, neutralny Nansen, brak skew

1. **Base:** MAKER_SPREAD_BPS = 40 → 0.40%
2. **Profil:** SPREAD_PROFILE=conservative → multiplier 1.0 → baseProfiled = 40 bps
3. **Inventory skew:** ~0% → brak korekty → dalej 40 bps
4. **Nansen bias:** neutral → brak zmiany
5. **Behavioural risk:** brak FOMO / knife → brak zmiany
6. **Chase mode:** wyłączony
7. **Clamp:** ZEC per-pair limit: { min: 10, max: 160 } → 40 bps mieści się → nic nie tnie

**👉 Final bid/ask spread ≈ 0.40%**

To jest zdrowy spread na spokojny rynek.

#### Case B: Duży LONG skew + FOMO (rynek ucieka w górę)

Załóżmy:
- Masz za dużo LONG ZEC (inventory skew +30%)
- ZEC zrobił +1.5% w 1m i +3% w 5m → FOMO on
- Nansen LONG bias strong

1. **Base:** 40 bps
2. **Profil:** conservative → 40 bps
3. **Inventory skew:** +30% → np. +20 bps → working ≈ 60 bps
4. **Nansen bias:** LONG strong bias:
   - BID: 60 × 0.8 = 48 bps
   - ASK: 60 × 1.2 = 72 bps
5. **Behavioural FOMO:** tryb normal: np. ×1.4 na BUY (BID)
   - BID: 48 × 1.4 = ~67 bps
   - ASK: 72 × 1.1 ≈ 79 bps
6. **Chase mode:** OFF → brak zmian
7. **Clamp:** ZEC { min: 10, max: 160 } → obie strony w środku → nic nie tniemy

**👉 W FOMO:**
- BID ~0.67%
- ASK ~0.79%

Kupujemy nieco dalej od rynku i sprzedajemy drożej → mniejsza szansa, że będziemy gonić świecę na szczycie.

#### Case C: Spadający nóż (knife)

Załóżmy:
- ret1m = -1.6%, ret5m = -3.5%
- Mała depth ratio → panicznie pusto w orderbooku

**Behavioural risk:**
- Tryb normal albo później aggressive:
- **BUY: suspend** (nie wystawiamy nowych bidów)
- **SELL: mogą zostać** (wyjście z pozycji OK)

**👉 W logach zobaczysz:**
```
🧠 BehaviouralRisk: suspending BUY quoting for ZEC (knife_detected ret1m=-1.60%, ret5m=-3.40%, depthRatio=0.18)
```

Czyli:
- Nie łapiemy noża nowymi BUY warstwami
- Możemy tylko redukować / domykać pozycję

---

## 🔍 Quick Verification Commands

### Sprawdź .env na serwerze:
```bash
cd /root/hyperliquid-mm-bot-complete
grep -E "DRY_RUN|SPREAD_PROFILE|ENABLE_MULTI_LAYER|ROTATION_TARGET|ROTATION_MAX" .env
```

### Sprawdź pozycje (notional):
```bash
# W logach szukaj:
grep "notional" bot.log | tail -20

# Lub bezpośrednio przez API (jeśli masz skrypt):
npx tsx scripts/check-positions.ts
```

### Sprawdź spready:
```bash
tail -100 bot.log | grep "\[SNAPSHOT\]" | tail -10
```

### Sprawdź behavioural risk:
```bash
tail -100 bot.log | grep "BehaviouralRisk" | tail -10
```

---

## ⚠️ RED FLAGS - Jeśli zobaczysz to, STOP:

1. **Spread < 5 bps** → bot wystawia "darmowe opcje"
2. **Spread > 200 bps** → bot nic nie filluje
3. **Notional ZEC > 10k** → guard nie działa
4. **SOFT SL HIT co 5 minut** → limity za ciasne
5. **BehaviouralRisk suspend non-stop** → może być problem z danymi
6. **Brak logów [SNAPSHOT]** → snapshot log nie działa

---

## ✅ GREEN FLAGS - Wszystko OK:

1. **Spready w zakresie 20-80 bps** dla większości przypadków
2. **Notional ZEC stabilny w 3-7k** zakresie
3. **[SNAPSHOT] logi pojawiają się regularnie**
4. **Brak SOFT SL HIT** (lub bardzo rzadko)
5. **BehaviouralRisk działa selektywnie** (tylko przy realnym FOMO/knife)

---

## 📝 Next Steps After 1 Day DRY_RUN:

1. ✅ Przejrzyj logi z całego dnia
2. ✅ Sprawdź maksymalne notional per pair
3. ✅ Sprawdź średnie spready
4. ✅ Sprawdź czy behavioural risk nie blokuje za często
5. ✅ Jeśli wszystko OK → `DRY_RUN=false`
6. ⚠️ **NIE WŁĄCZAJ** jeszcze `CHASE_MODE_ENABLED` ani `SPREAD_PROFILE=aggressive`

---

**Status:** ✅ Gotowe do pierwszego uruchomienia w DRY_RUN

