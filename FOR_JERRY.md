# FOR JERRY: The Hyperliquid Smart Money Bot

---

## Autonomous Fund Manager — Status Report (04.02.2026)

**Status:** ONLINE (Pro Mode Active)
**Strategy:** Capital Dominance (Net USD Imbalance) + Dynamic Risk Management + SM Following
**Active pairs:** BTC, ETH (SM rotation) + LIT, FARTCOIN (SM-following focus, sticky, 5x leverage)

### Deployed Upgrades (February 2026)

#### 1. Intelligent Selection ("Capital Dominance")

Zamiast arbitralnych ratio, bot wybiera cele na podstawie **absolutnej kwoty netto Smart Money**.

- **Logika:** `abs(Longs - Shorts)` — posortowane malejąco, top 3 wygrywa
- **Dlaczego?** $114M SHORT na SOL przeważa $6.5M SHORT na LIT. Pieniądze mówią.
- **Rotacja:** Co 4 godziny (stabilna) LUB natychmiastowa gdy pojawi się >$10M nowy imbalance (Flash Override)
- **Plik:** `SmAutoDetector.ts` → `getTopSmPairs()`

#### 2. Dynamic Risk Management

Dźwignia nie jest już statyczna. Adaptuje się do klasy aktywów.

- **Formuła:** `Base(5x) × Conviction(0.5-1.0) × VolatilityDampener(TARGET_VOL / actual_vol)`
- **Majors (BTC/SOL) przy 43% conviction:** 2x leverage
- **Majors przy 85%+ conviction:** do 4x leverage
- **Memecoiny (PUMP/WIF/FARTCOIN):** 1x leverage (volatility dampener dominuje)
- **Plik:** `TokenRiskCalculator.ts` → `calculateLeverage()`

#### 3. Vision SL (ATR-Based)

Stały 15% SL z `PositionProtector` to teraz "Catastrophe Stop" — ostatnia linia obrony. Aktywny stop jest dynamiczny.

- **Mechanizm:** ATR estymowany z dziennej zmienności tokena
- **Logika:** `Entry ± (2.5 × ATR)`, z twardym limitem 15%
- **Zachowanie:** Ciche monitorowanie co ~90s. Zamyka pozycję natychmiast gdy cena przebije strukturę.
- **Hierarchia:** Manual SL (tuning) > Vision SL (ATR) > PositionProtector (15% hard stop)
- **Plik:** `TokenRiskCalculator.ts` → `calculateVisionSlPercent()`, egzekucja w `mm_hl.ts`

#### 4. Risk-Based Position Sizing (Equal Dollar Risk)

Statyczny `capitalPerPair = $5000` dawał wildly różne ryzyko per token. LIT z 15% SL = $750 dollar risk, SOL z 11.3% SL = $565. Teraz pozycje są normalizowane tak, że **dollar risk jest identyczny** niezależnie od volatility tokena.

- **Formuła:** `maxPosition = (equity × riskPerTradePct) / visionSlPct`
- **Default risk:** 5% equity per trade (`RISK_PER_TRADE_PCT` env)
- **Zachowanie:** Działa jako **ostatni cap** po wszystkich upstream multiplierach (adaptive, tuning, MarketVision)
- **Graceful fallback:** Gdy brak danych SM lub equity — cap pomijany, stare zachowanie
- **Plik:** `TokenRiskCalculator.ts` → `calculateRiskBasedMaxPosition()`, egzekucja w `mm_hl.ts`

**Przykład** (equity=$12,372, risk=5%):

| Token | Vision SL | Max Position | Dollar Risk |
|-------|-----------|-------------|-------------|
| SOL | 11.3% | $5,474 | $618 |
| BTC | 11.3% | $5,474 | $618 |
| LIT | 15.0% | $4,124 | $618 |
| FARTCOIN | 15.0% | $4,124 | $618 |

Dollar risk = $618 dla KAŻDEGO tokena. Jednakowe ryzyko, różne pozycje.

### Aktualne wartości (live z serwera)

| Token | SM Direction | Net Imbalance | Leverage | Vision SL |
|-------|-------------|---------------|----------|-----------|
| SOL | SHORT | $113.6M | 2x | 11.2% |
| BTC | SHORT | $108.6M | 2x | 11.2% |
| ETH | SHORT | $25.6M | 2x | 11.2% |
| LIT | SHORT | $6.5M | 1x | 15.0% |
| ENA | SHORT | $5.6M | 1x | 15.0% |

### Jak monitorować

```bash
# Cele i Capital Dominance ranking
ssh hl-mm 'pm2 logs mm-bot --lines 100 --nostream' | grep "Capital Dominance" -A 6

# Dynamic Risk — leverage i SL per token
ssh hl-mm 'pm2 logs mm-bot --lines 200 --nostream' | grep -E "leverage|visionSL"

# Flash Rotation — nagłe zmiany portfela
ssh hl-mm 'pm2 logs mm-bot --lines 500 --nostream' | grep "FLASH ROTATION"

# Vision SL triggery — zamknięcia pozycji przez ATR stop
ssh hl-mm 'pm2 logs mm-bot --lines 500 --nostream' | grep "VISION SL"

# Dynamic Leverage — ustawienia przy rotacji par
ssh hl-mm 'pm2 logs mm-bot --lines 500 --nostream' | grep "DYNAMIC LEV"
```

### Architektura plików

| Plik | Rola | Status |
|------|------|--------|
| `src/mm/TokenRiskCalculator.ts` | Oblicza leverage + Vision SL + Risk-Based Position Sizing | NOWY |
| `src/mm/SmAutoDetector.ts` | Capital Dominance, 4H lock, flash rotation, `getTokenRiskParams()` | ZMODYFIKOWANY |
| `src/mm_hl.ts` | Egzekucja: `setLeverage()` przy rotacji, Vision SL co cykl, Risk cap per pair | ZMODYFIKOWANY |
| `src/risk/RiskManager.ts` | Portfolio-level: drawdown, inventory, emergency liquidation | BEZ ZMIAN |

### Jak monitorować Risk Sizing

```bash
# Risk cap w akcji — ile pozycja została zmniejszona
ssh hl-mm 'pm2 logs mm-bot --lines 500 --nostream' | grep "RISK SIZING"

# Przykładowy output:
# [RISK SIZING] LIT: Cap $6418 -> $4124 (equity=$12372 x 5% / 15.0% SL)
```

### Następne kroki

- Monitorować `VISION SL` logi — jeśli SL zbyt ciasny (whipsaw), zwiększ `ATR_MULTIPLIER` w `TokenRiskCalculator.ts`
- Monitorować `RISK SIZING` logi — sprawdzić czy cap nie jest zbyt agresywny (jeśli tak, zwiększ `RISK_PER_TRADE_PCT`)
- Po tygodniu sprawdzić Win Rate — jeśli >60%, rozważyć zwiększenie `MAX_LEV` z 5x do 7x dla majors
- Rozważyć dodanie prawdziwego ATR ze świec (zamiast estymacji z `TOKEN_VOLATILITY_CONFIG`)

---

## The Big Picture: What We Built

Wyobraź sobie, że masz znajomego który pracuje w Goldman Sachs. Codziennie przy kawie mówi Ci: "Hej, nasi najlepsi traderzy właśnie otworzyli OGROMNEGO shorta na LIT. Mają $11 milionów w grze."

**Ten bot to właśnie taki znajomy** - tyle że zamiast jednego tradera, śledzi dziesiątki "Smart Money" portfeli (wieloryby, fundusze, profesjonalni traderzy) i automatycznie kopiuje ich ruchy na Hyperliquid.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   "Podążaj za pieniędzmi, nie za opiniami na Twitterze"        │
│                                                                 │
│   Smart Money ma $11M SHORT na LIT?                            │
│   → Bot otwiera SHORT na LIT                                    │
│                                                                 │
│   Smart Money zamyka pozycje?                                   │
│   → Bot zamyka pozycje                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## The Architecture: How the Pieces Fit Together

Pomyśl o tym bocie jak o **armii z łańcuchem dowodzenia**:

```
┌─────────────────────────────────────────────────────────────────┐
│                      WYWIAD (Intelligence)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   whale_tracker.py        Nansen Dashboard        AlphaEngine   │
│   (The Spy Satellite)     (The Informant)        (The Drone)    │
│         │                       │                      │        │
│         │ "SM ma $11M short"    │ "Outflow alert!"    │ "3 whales│
│         │                       │                      │ closing!"│
│         ▼                       ▼                      ▼        │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              SmAutoDetector.ts                          │   │
│   │              (The Intelligence Officer)                 │   │
│   │                                                         │   │
│   │   Zbiera wszystkie dane, analizuje, tworzy raport:     │   │
│   │   "REKOMENDACJA: FOLLOW_SM_SHORT, conviction 95%"      │   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
└──────────────────────────────│──────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DOWÓDZTWO (Command)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              SignalEngine.ts                            │   │
│   │              ⭐ THE GENERAL ⭐                           │   │
│   │                                                         │   │
│   │   Podejmuje ostateczne decyzje. Może overridować       │   │
│   │   wszystko gdy ma silny sygnał od Smart Money.         │   │
│   │                                                         │   │
│   │   "Generał rozkazuje: SHORTOWAĆ!"                      │   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              dynamic_config.ts                          │   │
│   │              (The Gatekeeper / Strażnik)                │   │
│   │                                                         │   │
│   │   HARD_BLOCK: "Na tym tokenie NIE handlujemy!"         │   │
│   │   ...ale Generał może go obejść gdy SM signal silny    │   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
└──────────────────────────────│──────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      WYKONANIE (Execution)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              mm_hl.ts                                   │   │
│   │              (The Field Commander)                      │   │
│   │                                                         │   │
│   │   Główna pętla bota. Co 60 sekund:                     │   │
│   │   1. Zbierz dane z wywiadu                             │   │
│   │   2. Zapytaj Generała o rozkazy                        │   │
│   │   3. Złóż zlecenia na giełdzie                         │   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              Hyperliquid Exchange                       │   │
│   │              (The Battlefield)                          │   │
│   │                                                         │   │
│   │   Tu się dzieją prawdziwe transakcje.                  │   │
│   │   Pieniądze wchodzą, pieniądze wychodzą.               │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## The Cast of Characters (Files)

### Wywiad (Intelligence Gathering)

| Plik | Rola | Analogia | Co robi |
|------|------|----------|---------|
| `whale_tracker.py` | Spy Satellite | Satelita szpiegowski | Co 15-30 min robi "zdjęcie" wszystkich pozycji SM. "Jest $11M short vs $1.7M long" |
| `SmAutoDetector.ts` | Intelligence Officer | Oficer wywiadu | Analizuje dane, oblicza ratio, decyduje o trybie (FOLLOW_SM_SHORT/LONG/PURE_MM) |
| `AlphaEngine.ts` | Recon Drone | Dron zwiadowczy | Real-time śledzenie. "3 wieloryby WŁAŚNIE zamykają pozycje!" |
| `nansen_alert_parser_v2.ts` | The Informant | Informator | Parsuje alerty z Nansen Dashboard o SM inflow/outflow |

### Dowództwo (Command & Control)

| Plik | Rola | Analogia | Co robi |
|------|------|----------|---------|
| `SignalEngine.ts` | The General | Generał | Najwyższy priorytet. Gdy mówi "SHORT" - bot shortuje |
| `dynamic_config.ts` | The Gatekeeper | Strażnik bramy | HARD_BLOCK tokeny, zarządza limitami, może być overridowany przez Generała |
| `TokenRiskCalculator.ts` | The Quartermaster | Kwatermistrz | Oblicza ile dźwigni, gdzie SL, i jak dużą pozycję można otworzyć |

### Wykonanie (Execution)

| Plik | Rola | Analogia | Co robi |
|------|------|----------|---------|
| `mm_hl.ts` | Field Commander | Dowódca polowy | Główna pętla, składa zlecenia, zarządza pozycjami |
| `websocket_client.ts` | Radio Operator | Radiooperator | Utrzymuje połączenie z giełdą w real-time |
| `sdk.ts` | The Messenger | Goniec | Wysyła rozkazy (zlecenia) do giełdy |

### Ochrona (Risk Management)

| Plik | Rola | Analogia | Co robi |
|------|------|----------|---------|
| `BehaviouralGuards.ts` | The Bodyguard | Ochroniarz | Blokuje głupie decyzje, pilnuje limitów |
| `nansen_pro.ts` | Kill Switch | Wyłącznik awaryjny | Może zatrzymać handel gdy Nansen wykryje problem |
| `HOLD_FOR_TP` | Diamond Hands | Diamentowe ręce | Nie zamykaj pozycji dopóki nie osiągniesz TP |

---

## Key Concepts Explained (Kluczowe Koncepcje)

### 1. Smart Money Ratio - "Kto ma większe jaja?"

```
SM SHORT: $11,000,000
SM LONG:  $1,700,000
─────────────────────
RATIO:    6.5x SHORT

Interpretacja: Na każdy $1 postawiony na wzrost,
               jest $6.50 postawionych na spadek.

               → Bot powinien być SHORT
```

**Progi decyzyjne:**
- Ratio > 5x → 💎 Diamond Hands (trzymaj mocno)
- Ratio 2-5x → ⚠️ Ostrożność
- Ratio < 2x → 🧻 Paper Hands (szybkie wyjście)

### 2. Snapshot vs Stream - "Zdjęcie vs Film"

To jest **kluczowa koncepcja** którą musisz zrozumieć:

```
┌─────────────────────────────────────────────────────────────────┐
│  SNAPSHOT (whale_tracker.py)                                    │
│  ────────────────────────────                                   │
│                                                                 │
│  📸 "Zdjęcie" co 15-30 minut                                   │
│                                                                 │
│  Mówi: "W tym momencie SM mają $11M short"                     │
│  NIE mówi: "Co robią TERAZ"                                    │
│                                                                 │
│  Użycie: STRATEGIA (długoterminowy kierunek)                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  STREAM (AlphaEngine)                                           │
│  ────────────────────                                           │
│                                                                 │
│  🎬 Real-time "film"                                            │
│                                                                 │
│  Mówi: "3 wieloryby WŁAŚNIE zamykają shorty!"                  │
│  Problem: Może być "szum" - taktyczne ruchy, nie zmiana trendu │
│                                                                 │
│  Użycie: TAKTYKA (krótkoterminowe sygnały)                     │
└─────────────────────────────────────────────────────────────────┘
```

**Złota zasada:** Gdy Strategia i Taktyka się kłócą, **Strategia wygrywa**.

Dlaczego? Bo wieloryb zamykający 5% swojej pozycji to nie zmiana trendu - to może być:
- Realizacja części zysku
- Rebalancing portfela
- Hedge na innym rynku

### 3. Diamond Hands vs Paper Hands - "Stal vs Papier"

```
┌─────────────────────────────────────────────────────────────────┐
│  🧻 PAPER HANDS (stary bot)                                     │
│  ─────────────────────────                                      │
│                                                                 │
│  Stop Loss: 1.5-2%                                              │
│  Take Profit: 2-5%                                              │
│                                                                 │
│  Problem: "Death by 1000 cuts"                                  │
│  - Zamyka ze stratą przy każdej szpilce                        │
│  - Suma małych strat > potencjalny duży zysk                   │
│  - Nigdy nie łapie dużego ruchu                                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  💎 DIAMOND HANDS (nowy bot)                                    │
│  ─────────────────────────                                      │
│                                                                 │
│  Stop Loss: 12%                                                 │
│  Take Profit: 50%                                               │
│                                                                 │
│  Risk/Reward: 1:4.16                                            │
│  Breakeven win rate: ~20%                                       │
│                                                                 │
│  Filozofia: "Jeśli SM mają $11M short, to WIEDZĄ coś           │
│              czego ja nie wiem. Trzymam dopóki oni trzymają."  │
└─────────────────────────────────────────────────────────────────┘
```

### 4. HARD_BLOCK vs GENERALS_OVERRIDE - "Strażnik vs Generał"

```
Scenariusz: Bot chce shortować LIT

┌─────────────────────────────────────────────────────────────────┐
│  STRAŻNIK (HARD_BLOCK):                                         │
│  "STÓJ! LIT jest na liście zakazanych. Nie przejdziesz!"       │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  GENERAŁ (SignalEngine + GENERALS_OVERRIDE):                    │
│  "Strażniku, przepuść go. To rozkaz z góry.                    │
│   Smart Money mają $11M short. Shortujemy."                    │
│                                                                 │
│  ☢️ GENERALS_OVERRIDE AKTYWNY                                   │
│  🦅 HARD_BLOCK bypassed, Generał rozkazuje shortować!          │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                     Bot otwiera SHORT ✅
```

---

## The Money Flow (Jak Płyną Pieniądze)

```
┌─────────────────────────────────────────────────────────────────┐
│                     BULLISH SCENARIO                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. SM kupuje SPOT na DEX (Uniswap, Raydium)                   │
│                    │                                            │
│                    ▼                                            │
│  2. Nansen wykrywa INFLOW alert                                │
│                    │                                            │
│                    ▼                                            │
│  3. Bot parsuje: "SM_ACCUMULATION detected"                    │
│                    │                                            │
│                    ▼                                            │
│  4. SignalEngine: "FOLLOW_SM_LONG"                             │
│                    │                                            │
│                    ▼                                            │
│  5. Bot otwiera LONG na Hyperliquid PERPS                      │
│                    │                                            │
│                    ▼                                            │
│  6. Cena rośnie (bo SM kupuje) → Bot zarabia                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     BEARISH SCENARIO                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. SM sprzedaje SPOT na DEX                                   │
│                    │                                            │
│                    ▼                                            │
│  2. Nansen wykrywa OUTFLOW alert                               │
│                    │                                            │
│                    ▼                                            │
│  3. Bot parsuje: "SM_DISTRIBUTION detected"                    │
│                    │                                            │
│                    ▼                                            │
│  4. SignalEngine: "FOLLOW_SM_SHORT"                            │
│                    │                                            │
│                    ▼                                            │
│  5. Bot otwiera SHORT na Hyperliquid PERPS                     │
│                    │                                            │
│                    ▼                                            │
│  6. Cena spada (bo SM sprzedaje) → Bot zarabia                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technologies Used (Użyte Technologie)

| Technologia | Dlaczego? | Alternatywy które odrzuciliśmy |
|-------------|-----------|-------------------------------|
| **TypeScript** | Type safety = mniej bugów w kodzie finansowym | JavaScript (zbyt ryzykowny dla pieniędzy) |
| **Node.js** | Async/await idealny dla API calls | Python (wolniejszy dla real-time) |
| **PM2** | Process manager - restart po crashu | systemd (mniej features) |
| **WebSocket** | Real-time dane z giełdy | REST polling (za wolny) |
| **Tailscale** | Bezpieczny dostęp do serwera | VPN (skomplikowany setup) |
| **Hyperliquid** | Niskie fees, dobra liquidność | Binance (więcej regulacji) |
| **Nansen** | Najlepsze dane o SM activity | Arkham (mniej dokładny) |

---

## Lessons Learned (Lekcje z Okopów)

### Bug #1: "Generał nie słucha wywiadu"

**Problem:** `loadAndAnalyzeAllTokens()` nigdy nie było wywoływane w głównej pętli.

**Objaw:** Bot ignorował dane o Smart Money - działał jak "ślepy".

**Przyczyna:** Ktoś zapomniał dodać `await loadAndAnalyzeAllTokens()` w `mainLoop()`.

**Fix:** Jedna linia kodu.

**Lekcja:**
> Nawet najlepszy system wywiadu jest bezużyteczny jeśli nikt nie czyta raportów.
> **Zawsze sprawdzaj czy dane faktycznie przepływają przez cały pipeline.**

---

### Bug #2: "Strażnik blokuje własną armię"

**Problem:** HARD_BLOCK na LIT blokował shorty nawet gdy SignalEngine krzyczał "SHORTUJ!".

**Objaw:** Bot nie otwierał pozycji mimo jasnego sygnału SM.

**Przyczyna:** HARD_BLOCK sprawdzał tylko czy nie jesteśmy w PURE_MM mode, ale nie uwzględniał FOLLOW_SM_SHORT.

**Fix:**
```typescript
// Przed
if (token === 'LIT' && !isSignalEnginePureMmMode) {
  // BLOCK
}

// Po
const isFollowSmShort = signalEnginePureMm?.mode === MmMode.FOLLOW_SM_SHORT
if (token === 'LIT' && !isSignalEnginePureMmMode && !isFollowSmShort) {
  // BLOCK tylko gdy NIE FOLLOW_SM_SHORT
}
```

**Lekcja:**
> Security controls są ważne, ale muszą mieć "escape hatch" dla legitimate use cases.
> **Zawsze pytaj: "Czy ten blok ma sens gdy mamy SILNY sygnał?"**

---

### Bug #3: "Parser nie rozumie małych liter"

**Problem:** Nansen wysyła "$5.2k" ale parser szukał "$5.2K".

**Objaw:** Alerty o małych kwotach były ignorowane.

**Przyczyna:** Regex case-sensitive: `/[KMB]?$/` zamiast `/[KkMmBb]?$/`

**Lekcja:**
> Nigdy nie zakładaj formatu danych zewnętrznych.
> **Zawsze testuj z rzeczywistymi danymi, nie tylko z dokumentacją.**

---

### Bug #4: "Port zajęty, telemetry nie startuje"

**Problem:** Telemetry server nie mógł wystartować bo port 8080 i 8081 były zajęte.

**Fix:** Retry logic z incrementem portu:
```typescript
private tryPort(port: number, attempts: number = 0): void {
  const maxAttempts = 5  // Try ports 8080-8084
  // ... retry logic
}
```

**Lekcja:**
> W produkcji zawsze będą konflikty zasobów.
> **Buduj systemy które gracefully degradują, nie crashują.**

---

### Bug #5: "WebSocket nie ma metody subscribeTrades"

**Problem:** `TypeError: this.websocket.subscribeTrades is not a function`

**Przyczyna:** Ktoś wywołał metodę która nie istniała w klasie WebSocket.

**Lekcja:**
> TypeScript chroni przed tym... jeśli go używasz poprawnie.
> **Zawsze definiuj typy dla external APIs.**

---

## Best Practices (Dobre Praktyki)

### 1. Hierarchia Priorytetów

```
   Priorytet 1 (Najwyższy)     Priorytet 2              Priorytet 3
┌─────────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
│   SignalEngine          │ │   HARD_BLOCK        │ │   Risk Cap          │
│   (The General)         │ │   (The Gatekeeper)  │ │   (The Quartermaster)│
└─────────────────────────┘ └─────────────────────┘ └─────────────────────┘
```

**Zasada:** Wyższy priorytet ZAWSZE wygrywa. Generał decyduje o kierunku, Strażnik blokuje niebezpieczne tokeny, Kwatermistrz kontroluje wielkość pozycji.

### 2. Logowanie jest Twój Przyjaciel

Dobre logi:
```
☢️ [GENERALS_OVERRIDE] LIT: WYMUSZONY FOLLOW_SM_SHORT - Generałowie shortują!
🦅 [SIGNAL_ENGINE] LIT: FOLLOW_SM_SHORT → HARD_BLOCK bypassed
💎 [HOLD_FOR_TP] LIT: Blocking bids - hold SHORT for TP
```

Złe logi:
```
Processing LIT...
Done.
```

**Zasada:** Log powinien odpowiadać na: KTO, CO, DLACZEGO.

### 3. Fail Fast, Recover Faster

```typescript
// Złe - cicha porażka
try {
  await placeOrder(...)
} catch (e) {
  // ignore
}

// Dobre - głośna porażka + recovery
try {
  await placeOrder(...)
} catch (e) {
  console.error(`❌ Order failed: ${e.message}`)
  await notifyAdmin(e)
  // retry logic
}
```

### 4. Separacja Strategii od Taktyki

```
NIE mieszaj:
├── Gdzie idziemy (Strategia)
└── Jak tam dojdziemy (Taktyka)

Strategia: "SM mają $11M short → jesteśmy SHORT"
Taktyka: "Jak złożyć zlecenie, jaki spread, ile layers"
```

---

## How Good Engineers Think (Jak Myślą Dobrzy Inżynierowie)

### 1. "What's the worst that can happen?"

Przed każdą zmianą pytaj:
- Co się stanie jeśli ten kod się wysypie?
- Ile pieniędzy mogę stracić?
- Czy jest rollback?

### 2. "Show me the data"

Nie ufaj przeczuciom. Nie ufaj Twitterowi.
- Ile SM jest long vs short?
- Jaki jest faktyczny ratio?
- Czy dane są świeże?

### 3. "Simple > Clever"

```typescript
// Clever (źle)
const mode = (smRatio > 5 ? 1 : smRatio > 2 ? 2 : 3) === 1 ? 'DIAMOND' : 'PAPER'

// Simple (dobrze)
let mode = 'PAPER'
if (smRatio > 5) {
  mode = 'DIAMOND'
} else if (smRatio > 2) {
  mode = 'CAUTIOUS'
}
```

### 4. "Make it work, make it right, make it fast"

W tej kolejności. Nigdy odwrotnie.

1. **Work** - Bot działa, nie crashuje
2. **Right** - Bot podejmuje dobre decyzje
3. **Fast** - Bot jest zoptymalizowany

---

## The War Room Checklist (Przed Bitwą)

```
□ Czy whale_tracker.py działa? (sprawdź /tmp/smart_money_data.json)
□ Czy bot jest connected do WebSocket?
□ Czy GENERALS_OVERRIDE jest ustawiony poprawnie?
□ Czy mamy wystarczający margin?
□ Czy liquidation price jest bezpieczna?
□ Czy PM2 jest ustawiony na auto-restart?
□ Czy logi się zapisują?
```

---

## Final Words (Słowo na Koniec)

Ten bot to nie "magic money printer". To narzędzie które:

1. **Daje Ci edge** - widzisz co robią SM zanim rynek zareaguje
2. **Wymaga dyscypliny** - musisz ufać systemowi, nie emocjom
3. **Ma ryzyko** - SM też się mylą, a 12% SL to realna strata

Pamiętaj słowa Warrena Buffetta:
> "Rule #1: Never lose money. Rule #2: Never forget rule #1."

Ale też pamiętaj słowa każdego tradera który zarobił:
> "Nie można wygrać nie ryzykując. Chodzi o to żeby ryzykować MĄDRZE."

**Smart Money pokazują drogę. Twój bot ją podąża. Ty kontrolujesz ryzyko.**

---

## VIP Spy v2 - Operacja "Cień Generała" Expanded (31.01.2026)

### Co się zmieniło i dlaczego

Wyobraź sobie, że masz 4 informatorów w kasynie. Każdy mówi Ci co robi jeden high roller. Niezły start, ale co jeśli mógłbyś mieć **21 informatorów** śledzących **21 high rollerów** jednocześnie?

Problem: jeśli każdy informator dzwoni co 30 sekund, to masz **42 telefony na minutę**. Kasyno (Hyperliquid API) zaczyna podejrzewać, że coś jest nie tak i odcina Ci linię (rate limit).

Rozwiązanie? **System priorytetów** - dokładnie jak w prawdziwym wywiadzie:

```
┌─────────────────────────────────────────────────────────────┐
│  TIER 1 "Generałowie" (4 VIPów)                             │
│  Poll co 30 sekund                                          │
│  To są nasi NAJWAŻNIEJSI informatorzy.                      │
│  Mają pozycje za $50-90M. Każdy ich ruch to sygnał.        │
├─────────────────────────────────────────────────────────────┤
│  TIER 2 "Oficerowie" (12 VIPów)                              │
│  Poll co 2 minuty                                            │
│  Duzi gracze ($3-35M), ale nie tak kluczowi.                │
│  Sprawdzamy rzadziej - i tak nie tradują co sekundę.        │
├─────────────────────────────────────────────────────────────┤
│  FUND "Fundusze" (5 VIPów)                                   │
│  Poll co 5 minut                                             │
│  Galaxy Digital, Hikari, etc. Fundusze ruszają się powoli.  │
│  Raz na 5 minut wystarczy żeby złapać ich ruch.            │
└─────────────────────────────────────────────────────────────┘
```

**Efektywność:**
- Tier1: 4 VIPów × 2/min = 8 calls/min
- Tier2: 12 VIPów × 0.5/min = 6 calls/min
- Fund: 5 VIPów × 0.2/min = 1 call/min
- **Razem: ~15 calls/min** (vs 42 gdyby wszyscy byli co 30s)

### Dust Filter - "Nie reaguj na grosze"

Znasz tę sytuację, gdy ktoś Ci przeleje $0.001 na portfel żeby "oznaczyć" Twój adres? Albo zostanie Ci dust z zamkniętej pozycji za $2?

Stary bot traktował to jako prawdziwą pozycję i wysyłał alerty: "GENERAŁ OTWORZYŁ NOWĄ POZYCJĘ!" ...za $0.50. Nie brzmi to poważnie.

Nowy filter:
```python
# Muszą być spełnione WSZYSTKIE 3 warunki:
# 1. Coin na whiteliście (np. BTC, LIT - nie losowe shitcoiny)
# 2. Size > 0.001 (nie mikro-pozycje z zaokrągleń)
# 3. Value > $10 (prawdziwe pieniądze, nie dust)
```

Bonus: jeśli VIP ma pozycję za >$1000 na coinie którego NIE mamy na whiteliście, logujemy warning. To pozwala odkrywać nowe coiny które powinniśmy dodać do monitoringu.

### External Config - "Dodaj VIPa bez restartu"

Stary system: VIPy były hardcoded w Pythonie. Chcesz dodać nowego? Edytuj kod, commituj, deplouj, restartuj PM2. 5 kroków.

Nowy system: Edytuj `vip_config.json`, poczekaj max 5 minut. Bot sam przeładuje config (**hot-reload**). 1 krok.

```
┌─────────────────────────────────────────────────────────────┐
│  vip_config.json (edytuj tu)                                 │
│  ├── watched_coins: ["BTC", "ETH", "LIT", ...]             │
│  ├── poll_intervals: {tier1: 30, tier2: 120, fund: 300}     │
│  └── vips: {address: {name, emoji, tier, notes}, ...}       │
└─────────────────────────────────────────────────────────────┘
                           │
                     hot-reload co 10 cykli (~5 min)
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  vip_spy.py                                                  │
│  "O, mamy nowego VIPa! Dodaję do monitoringu."              │
│  (bez restartu PM2)                                          │
└─────────────────────────────────────────────────────────────┘
```

To jest wzorzec znany jako **"Configuration as Data"** - zamiast trzymać config w kodzie (który wymaga deploya), trzymasz go w pliku danych (który można zmieniać w locie). Netflix, Spotify i inne wielkie firmy robią to samo, tyle że na większą skalę (feature flags, A/B testy, etc.).

### Lekcje z tego update'u

**Lekcja #6: Rate Limiting to nie bug, to feature**

Kiedy Hyperliquid mówi "429 Too Many Requests", to nie jest wredna restrykcja - to ochrona przed DDoS. Twój bot jest jednym z tysięcy klientów. Jeśli każdy będzie wysyłał 42 req/min, serwer padnie.

Rozwiązanie to **tier-based polling** - nie musisz sprawdzać wszystkich z taką samą częstotliwością. Fundusz który robi 2 trade'y na tydzień nie potrzebuje pollingu co 30 sekund.

**Analogia:** Nie sprawdzasz poczty co 30 sekund. Maile od szefa sprawdzasz co 5 minut, newslettery raz dziennie.

**Lekcja #7: Separation of Concerns w konfiguracji**

Trzymanie VIPów w kodzie to jak trzymanie numerów telefonów w kodzie źródłowym aplikacji. Działa, ale za każdym razem gdy ktoś zmieni numer, musisz przebudować całą apkę.

Dlatego istnieje rozdzielenie: **kod** (logika) vs **dane** (config). Kod mówi JAK monitorować, dane mówią KOGO monitorować.

**Lekcja #8: Graceful Degradation**

Co jeśli `vip_config.json` jest uszkodzony? Albo ktoś go przypadkiem skasuje?

Dobry system nie crashuje - **wraca do defaults**. Nasz bot:
1. Próbuje załadować config z pliku
2. Jeśli plik nie istnieje → używa hardcoded defaults (4 oryginalne VIPy)
3. Jeśli JSON jest zepsuty → loguje error, używa defaults
4. Jeśli brakuje pól → loguje warning, używa defaults

Użytkownik nigdy nie zostaje z martwym botem.

---

## GENERALS_MIN_SHORT_RATIO - "Generał nie strzela do cieni" (02.02.2026)

### Problem: Ślepy rozkaz

Wyobraź sobie generała który wydaje rozkaz: "Bombardujcie pozycję wroga!" Ale nie sprawdza czy wróg tam faktycznie jest. Satelita pokazuje, że w danym miejscu są praktycznie równe siły - 49% naszych, 51% ich. Czy to powód do bombardowania? Absolutnie nie.

Dokładnie to robił nasz `GENERALS_OVERRIDE`. Dla każdego tokena z listy `SHORT_ONLY_TOKENS` (HYPE, LIT, FARTCOIN, ENA, SUI) wymuszał FOLLOW_SM_SHORT **bezwarunkowo** - nie patrząc na to jak silny jest faktyczny sygnał.

```
PRZED (ślepy rozkaz):

  Token na liście SHORT_ONLY_TOKENS?
       │
       └── TAK → ☢️ WYMUSZONY SHORT (nie patrz na nic innego)
```

HYPE miał SM ratio 1.06x. To znaczy: $1.06 short na każdego $1 long. Praktycznie 50/50. Neutralny rynek. A bot wymuszał agresywnego shorta z conviction score 95%. To jak stawianie wszystkich żetonów na "orzeł" gdy moneta jest lekko krzywa.

### Rozwiązanie: Sprawdź dane zanim strzelisz

Dodaliśmy **minimalny próg ratio** zanim Generał może wymusić shorta:

```
PO (inteligentny rozkaz):

  Token na liście SHORT_ONLY_TOKENS?
       │
       └── TAK → Sprawdź SM ratio z cache'a
                    │
                    ├── ratio >= 2.0x → ☢️ WYMUSZONY SHORT (SM wyraźnie short)
                    │
                    └── ratio < 2.0x  → ⚠️ SKIP (za neutralny, niech normalna
                                             logika zdecyduje)
```

Jedno nowe ustawienie w `src/config/short_only_config.ts`:

```typescript
export const GENERALS_MIN_SHORT_RATIO = 2.0
```

Prosta zmiana. Duży efekt:

| Token | SM Ratio | Przed | Po |
|-------|----------|-------|----|
| HYPE | 1.06x | FORCE SHORT (zły rozkaz!) | SKIP - normalna logika |
| HYPE | 3.50x | FORCE SHORT | FORCE SHORT (ratio wystarczające) |
| LIT | 5.03x | FORCE SHORT | FORCE SHORT |
| FARTCOIN | 43.31x | FORCE SHORT | FORCE SHORT |

Zauważ, że HYPE z ratio 3.50x (stan z dnia deploymentu) nadal dostaje force shorta - bo 3.50 >= 2.0. Ale gdyby generałowie zamknęli swoje pozycje i ratio spadło do np. 1.2x, bot przestałby ślepo shortować. Dokładnie o to chodziło.

### Co się dzieje gdy brak danych?

Ważny edge case: co gdy `cachedAnalysis` nie ma jeszcze danych dla tokena (np. tuż po restarcie, zanim `whale_tracker.py` dostarczy snapshot)?

```typescript
const preAnalysis = cachedAnalysis.get(token)
if (preAnalysis && preAnalysis.ratio < GENERALS_MIN_SHORT_RATIO) {
  // SKIP - mamy dane i ratio za niskie
} else {
  // FORCE SHORT - albo ratio >= 2.0x, albo brak danych (bezpieczny default)
}
```

Gdy `preAnalysis` jest `undefined`, warunek `preAnalysis && ...` jest falsy, więc idziemy do `else` (force short). To **celowy safe default** - lepiej shortować z brakującymi danymi (skoro token jest na liście SHORT_ONLY) niż przypadkowo otworzyć longa.

### Architektura: Centralized Config

Zauważ, że `GENERALS_MIN_SHORT_RATIO` siedzi w `src/config/short_only_config.ts` razem z innymi stałymi:

```
src/config/short_only_config.ts
├── SHORT_ONLY_TOKENS        → które tokeny shortujemy
├── GENERALS_MAX_INVENTORY_USD → ile max na jeden token ($5K)
├── GENERALS_MIN_SHORT_RATIO   → [NOWE] minimalny ratio do force shorta (2.0x)
├── STICKY_SHORT_TOKENS       → tokeny z istniejącymi pozycjami (PUMP)
└── ALL_HOLD_FOR_TP_TOKENS    → kto dostaje Diamond Hands treatment
```

**Single Source of Truth** - zmień threshold w jednym miejscu, nie szukaj po 14 plikach.

### Lekcja #9: Blind Force vs Conditional Force

Wymuszanie czegoś bezwarunkowo jest kuszące - mniej kodu, mniej edge case'ów, mniej myślenia. Ale w systemach finansowych "mniej myślenia" = "więcej strat".

**Zasada:** Każdy force override powinien mieć **minimalny próg wejścia**. Nie wystarczy że token jest "na liście" - dane muszą potwierdzać decyzję. Lista mówi **CO** shortować, dane mówią **KIEDY**.

Analogia z prawdziwego świata: fundusz hedgingowy ma "conviction list" (tokeny do shortowania). Ale nawet najlepszy fundusz nie shortuje ślepo - każdy trade przechodzi przez risk committee który sprawdza: "Czy pozycjonowanie rynku nadal potwierdza naszą tezę?"

Nasz `GENERALS_MIN_SHORT_RATIO` to taki mini risk committee. Mały, szybki check, ale zapobiega głupim trade'om.

---

## Nansen API Credit Leak - "Kran odkręcony na full" (02.02.2026)

### Problem: 50 000 kredytów w miesiąc

Nansen API daje Ci 50 000 kredytów miesięcznie. Brzmi dużo? Nasz bot zużywał ~2 000 kredytów na godzinę. To 48 000 dziennie. Całe 50K wyparowało w nieco ponad dobę intensywnego użycia.

Jak to wyglądało na wykresie:
```
Kredyty/dzień
22K │  ██
20K │  ██
18K │  ██ ██
    │  ██ ██
 6K │              ██ ██
    │  ↑               ↑
    Jan 5          Jan 25
    "Kto zostawił   "Znowu nam
     kran?"          kapie..."
```

### Diagnoza: Pięć warstw problemów

Problem nie był w jednym miejscu. To była kaskada wzajemnie pogarszających się błędów:

**Warstwa 1: Brak cache'a na najwyższym poziomie**

`getGenericTokenGuard()` - funkcja wywoływana co 60 sekund dla KAŻDEGO tokena - nie miała żadnego cache'a. Wyobraź sobie, że za każdym razem gdy chcesz sprawdzić pogodę, dzwonisz do meteorologa osobiście, zamiast zerknąć na apkę. 5 tokenów x 60 razy na godzinę = 300 telefonów na godzinę.

**Warstwa 2: Kaskada fallbacków**

`getTokenOverview()` miała "backup plan" - jeśli główny endpoint nie odpowiedział, próbowała 3 inne endpointy jako fallback:
```
getTokenOverview() → 403 (brak kredytów)
  ↓ fallback
/tgm/token-recent-flows-summary → 403
  ↓ fallback
/tgm/dex-trades → 403
  ↓ fallback
/tgm/holders → 403 (i to za 5 kredytów!)
```

Jeden "sprawdź pogodę" = 4 telefony. A potem `getTokenFlowSignals()` dzwoniła do tych SAMYCH endpointów osobno. Podwójna robota.

**Warstwa 3: Porażki nie były cache'owane**

Komentarz w kodzie mówił `// Removed: Do not cache failures`. Logika była taka: "jak się nie udało, może za chwilę się uda". Problem: gdy API zwraca 403 (brak kredytów), "za chwilę" nic się nie zmieni. Ale bot tego nie wiedział i próbował co 60 sekund.

```
Cykl 1: getHolders() → 403 → return [] (nie cache'uj!)
Cykl 2: getHolders() → 403 → return [] (nie cache'uj!)
Cykl 3: getHolders() → 403 → return [] (nie cache'uj!)
...tak w nieskończoność, 5 kredytów za każdą próbę
```

**Warstwa 4: Circuit breaker za miękki**

Istniał circuit breaker (wyłącznik), ale resetował się co 60 sekund (`cooldownMs = 60_000`). Wyobraź sobie bezpiecznik, który po wybiciu sam się naprawia po minucie. Prąd dalej leci, bezpiecznik dalej wybija, w kółko.

**Warstwa 5: Osobny moduł bez ochrony**

`nansen_scoring.ts` - oddzielny plik, oddzielny klient HTTP - robił własne zapytania do `/perp-screener` bez jakiejkolwiek ochrony na porażkę. Jak tajne drugie konto w banku, o którym nikt nie wiedział.

### Rozwiązanie: Pięć warstw obrony

Zamiast jednego fixa, zbudowaliśmy **warstwowy system ochrony** - jak zabezpieczenia w elektrowni atomowej:

```
┌─────────────────────────────────────────────────────────────┐
│  WARSTWA 5: Global 403 Kill Switch (nowa)                    │
│  "5 porażek 403 z rzędu? WYŁĄCZ WSZYSTKO na 30 min"        │
├─────────────────────────────────────────────────────────────┤
│  WARSTWA 4: Guard Result Cache (nowa, 5 min)                 │
│  "Wynik getGenericTokenGuard() jest ważny 5 minut"          │
├─────────────────────────────────────────────────────────────┤
│  WARSTWA 3: Flow Signals Cache (nowa, 10 min)                │
│  "Połączony wynik 4 endpointów cache'owany jako pakiet"     │
├─────────────────────────────────────────────────────────────┤
│  WARSTWA 2: Failure Caching (naprawiona)                     │
│  "Jak endpoint zwraca 403, cache'uj porażkę też"            │
├─────────────────────────────────────────────────────────────┤
│  WARSTWA 1: Individual Endpoint Caches (istniejące)          │
│  "getHolders: 30min, getFlowIntelligence: 15min, etc."      │
└─────────────────────────────────────────────────────────────┘
```

Plus dodatkowe fixy:
- **Usunięcie kaskady fallbacków** z `getTokenOverview` i `getSmartMoneyNetflows`
- **Cache na `getTokenOverview`** (jedyny endpoint, który w ogóle nie miał cache'a!)
- **Failure cache w `nansen_scoring.ts`** (1h TTL)

### Efekt

```
PRZED:
- ~2,000 kredytów / godzinę
- 50K miesięcznego limitu znikało w ~1 dzień
- Bot walił w martwe API w kółko

PO:
- ~100 kredytów / godzinę (95% redukcja)
- 50K limitu starcza na ~20 dni
- Gdy API padnie, bot przestaje pytać na 30 min
```

### Lekcja #10: Defense in Depth (Obrona w głąb)

To jest fundamentalna zasada security, ale sprawdza się wszędzie:

**Nigdy nie polegaj na jednej warstwie obrony.**

Gdybyśmy dodali TYLKO kill switch, cache'e dalej marnowałyby kredyty w normalnej pracy. Gdybyśmy dodali TYLKO cache'e, 403-y dalej biłyby w API co minutę po resecie circuit breakera. Każda warstwa łata lukę, którą inna warstwa pozostawia.

Analogia: dom ma zamek w drzwiach (cache), alarm (circuit breaker), i monitoring (kill switch). Sam zamek nie wystarczy, bo włamywacz może wyważyć drzwi. Sam alarm nie wystarczy, bo może mieć opóźnienie. Razem tworzą system, w którym każda warstwa chroni przed scenariuszem, w którym inna zawodzi.

### Lekcja #11: Cache Failures, Not Just Successes

To jeden z najczęstszych błędów w integracji z API. Developerzy myślą: "Cache'uj sukces, żeby nie pytać ponownie. Ale nie cache'uj porażki - może za chwilę się uda."

Problem: jest wielka różnica między **transient failure** (sieć migotała, serwer był chwilowo zajęty) a **persistent failure** (brak kredytów, zły API key, endpoint nie istnieje).

```
TRANSIENT (429 Rate Limit):   → Poczekaj 5 sekund, spróbuj ponownie
PERSISTENT (403 Forbidden):    → Nie próbuj ponownie przez X minut
```

Nasza stara logika traktowała wszystkie porażki jak transient - "spróbuj za minutę". Nowa logika rozróżnia: 403 to signal "przestań pytać", nie "spróbuj ponownie".

### Lekcja #12: Redundancja to nie zawsze dobrze

Fallback endpoints w `getTokenOverview` brzmiały jak dobry pomysł: "Jeśli A nie odpowie, spróbuj B, C, D." Problem: gdy przyczyną jest 403 (brak kredytów), ŻADEN endpoint nie odpowie. Fallbacki tylko mnożą liczbę nieudanych prób - i każda kosztuje kredyty.

Zasada: **Fallbacki mają sens przy losowych awariach, nie przy systemowych problemach.** Jeśli cały serwis jest down (brak kredytów), próbowanie innych endpointów tego samego serwisu to definicja szaleństwa.

---

## Ratio Monitor - "Radar wczesnego ostrzegania" (02.02.2026)

### Problem: Jak wcześnie wykryć zmianę trendu?

Masz shorta na LIT. SM ratio wynosi 4.94x - wygląda solidnie. Ale wczoraj było 5.5x. Przedwczoraj 6.2x. Widzisz trend? **Wieloryby powoli zamykają shorty.**

Problem: bot sprawdza ratio co 30 sekund, ale nigdzie nie porównuje z poprzednimi wartościami. Nie wie, że ratio SPADA. Widzi tylko "teraz jest 4.94x, to powyżej 2.0x, więc FORCE SHORT". Żadnego alarmu dopóki ratio nie spadnie poniżej GENERALS_MIN_SHORT_RATIO (2.0x) - a wtedy może być za późno.

To jak prowadzenie samochodu patrząc tylko na prędkościomierz. "100 km/h, OK." Ale nie widzisz, że zbliżasz się do zakrętu.

### Rozwiązanie: RATIO_MONITOR

Dodaliśmy system monitoringu który:

1. **Śledzi historię ratio** - ostatnie 60 odczytów (~30 minut)
2. **Oblicza trend** - "ratio spadło o 0.52x w ciągu 5 minut"
3. **Alertuje przy progu** - głośny alarm gdy ratio spadnie poniżej zdefiniowanego progu
4. **Ma cooldown** - nie spamuje co 30s, powtarza alert max co 5 minut
5. **Informuje o recovery** - gdy ratio wraca powyżej progu

```
Normalny stan:
📊 [RATIO_MONITOR] LIT: ratio=4.94x (threshold=3.5x) ✅ OK

Ratio spada poniżej progu:
🚨🚨🚨 [RATIO_MONITOR] LIT: THRESHOLD CROSSED - ratio 3.42x < 3.5x | trend: 📉 -0.52x (-11.2%) over ~5min
🚨 [RATIO_MONITOR] LIT ratio spadl ponizej 3.5x - rozwaz redukcje pozycji!
🚨 [RATIO_MONITOR] LIT: longs=$1678K shorts=$5894K uPnL_shorts=$2100K

Ratio wraca:
✅ [RATIO_MONITOR] LIT: RECOVERED above 3.5x - ratio now 3.62x | trend: 📈 +0.20x (5.7%) over ~5min
```

### Architektura: Config + Monitor

Konfiguracja alertów siedzi w `short_only_config.ts` (obok reszty stałych):

```typescript
export const RATIO_ALERTS: RatioAlert[] = [
  { token: 'LIT', threshold: 3.5, message: 'LIT ratio spadl ponizej 3.5x...' },
  // Dodaj więcej tokenów w razie potrzeby
]

export const RATIO_ALERT_COOLDOWN_MS = 5 * 60 * 1000  // 5 min
```

Monitor (`checkRatioAlerts()`) odpala się przy KAŻDYM odświeżeniu danych SM - zarówno przez `loadAndAnalyzeAllTokens()` jak i przez `updateCacheFromSmData()`. To ważne, bo dane wchodzą dwoma ścieżkami i monitor musi łapać obie.

### Bug po drodze: "Monitor się nie odpala!"

Pierwszy deploy monitoringu nie działał. Logi pokazywały GENERALS_OVERRIDE z ratio, ale zero logów z RATIO_MONITOR.

**Przyczyna:** `loadAndAnalyzeAllTokens()` (gdzie dodaliśmy monitor) prawie nigdy nie dociera do kodu analizy - `dynamic_config.ts` wywołuje `updateCacheFromSmData()` WCZEŚNIEJ, która wypełnia `cachedAnalysis`. Gdy `loadAndAnalyzeAllTokens()` jest wywoływana, cache jest świeży i zwraca natychmiast (early return na linii 982).

```
dynamic_config.ts → updateCacheFromSmData() → cachedAnalysis = dane ✅
mm_hl.ts → loadAndAnalyzeAllTokens() → "cache fresh, return early" → ❌ monitor się nie odpala
```

**Fix:** Dodanie `checkRatioAlerts(newAnalysis)` RÓWNIEŻ w `updateCacheFromSmData()`.

**Lekcja:** Gdy dodajesz logikę do jednej ścieżki danych, sprawdź czy dane nie wchodzą inną drogą. W naszym przypadku `cachedAnalysis` jest populowane z dwóch miejsc. Jedno `grep "cachedAnalysis ="` ujawniło problem od razu.

### Centralizacja konfiguracji - "13 list → 1 plik"

Przy okazji monitoringu zrobiliśmy duży refactoring. W `mm_hl.ts` i `dynamic_config.ts` było **13+ miejsc** z hardcoded listami tokenów:

```typescript
// mm_hl.ts - te same tokeny w 8 różnych miejscach!
const SIGNAL_ENGINE_TOKENS_PAUSE = ['LIT', 'HYPE', 'FARTCOIN'];
const HOLD_FOR_TP_TOKENS = ['HYPE', 'LIT', 'FARTCOIN'];
const HOLD_FOR_TP_PAIRS = ['HYPE', 'LIT', 'FARTCOIN'];
const HOLD_FOR_TP_GRID = ['HYPE', 'LIT', 'FARTCOIN'];
const HOLD_FOR_TP_SKIP_SM_TP = ['HYPE', 'LIT', 'FARTCOIN'];
const HOLD_FOR_TP_SKEW = ['HYPE', 'LIT', 'FARTCOIN'];
const NANSEN_HOLD_FOR_TP = ['HYPE', 'LIT', 'FARTCOIN'];
// ...i jeszcze więcej

// dynamic_config.ts - to samo!
const MM_TOKENS = ['HYPE', 'LIT', 'FARTCOIN'];
const HOLD_FOR_TP_TOKENS = ['HYPE', 'LIT', 'FARTCOIN'];
const HOLD_FOR_TP_EMERGENCY = ['HYPE', 'LIT', 'FARTCOIN'];
```

Problem oczywisty: chcesz dodać ENA? Musisz znaleźć i zmienić 13 list. Zapomnisz o jednej? Bug. Zmienisz złą? Bug.

**Teraz:** Wszystko importowane z jednego pliku:

```typescript
import { isShortOnlyToken, isHoldForTpToken, SHORT_ONLY_TOKENS } from '../config/short_only_config.js'

// Było: const HOLD_FOR_TP_TOKENS = ['HYPE', 'LIT', 'FARTCOIN']
// Jest: if (isHoldForTpToken(pair)) { ... }
```

Dodajesz nowy token? Jedna zmiana w `short_only_config.ts`. Gotowe.

### Lekcja #13: "Threshold Alerts" > "Threshold Actions"

Mogli byśmy zrobić tak, żeby bot AUTOMATYCZNIE zamykał pozycję gdy ratio spadnie poniżej 3.5x. Ale tego nie zrobiliśmy - z premedytacją.

Dlaczego? Bo **alert wymaga ludzkiej decyzji**, a automatyczna akcja nie. W tradingu automatyczne decyzje są dobre gdy sytuacja jest czarno-biała (SL przy -12%, to jasne). Ale "ratio spadło do 3.4x" to szary obszar - może to chwilowe, może wieloryb zamknął pozycję na 5 minut i zaraz ją otworzy.

Alert mówi: "Hej, coś się zmienia. Spójrz." Nie mówi: "Panikuj i zamknij wszystko."

**Zasada:** Automatyzuj OCZYWISTE decyzje (hard stop loss). Dla NIEOCZYWISTYCH - alertuj człowieka i pozwól mu zdecydować.

### Lekcja #14: DRY nie jest opcjonalny (Don't Repeat Yourself)

13 identycznych list tokenów to podręcznikowy przykład naruszenia DRY. Jak to się stało? Stopniowo. Najpierw była jedna lista. Potem ktoś potrzebował tej samej listy w innym pliku i skopiował. Potem trzeci plik. Potem czwarty...

Każda kopia to "dług techniczny" - działa dziś, ale jutro gdy zmienisz oryginał a zapomnisz o kopii, masz buga. Im więcej kopii, tym większe ryzyko.

**Sygnał ostrzegawczy:** Jeśli widzisz ten sam string/array w 3+ miejscach, to pora na refactoring. Dzisiaj, nie jutro. Bo jutro będzie 4, potem 5, i za tydzień nikt nie pamięta ile kopii jest.

---

## Bug #6: "PURE_MM zamyka Ci shorty za plecami" (02.02.2026)

### Problem: HYPE short zamykany na minus

HYPE short z entry $28.99 był zamykany kupowaniem po $32+ (~10% strata). Bot **aktywnie składał BUY ordery** na HYPE, mimo że HYPE jest na liście SHORT_ONLY_TOKENS i powinien mieć HOLD_FOR_TP.

Jak to możliwe? Przecież mamy:
- `GENERALS_OVERRIDE` → wymusza FOLLOW_SM_SHORT
- `HOLD_FOR_TP` → blokuje bidy
- `FORCE_SHORT_ONLY` → ASK only
- `REGIME` → bull_trend_no_shorting_pump (longs only, no shorts)

**Pięć warstw ochrony** - i BUY ordery i tak przechodziły. Brzmi jak horror. Bo to jest horror.

### Root Cause: Łańcuch upadku

Problem zaczyna się niewinnie, w SmAutoDetector:

```
1. GENERALS_OVERRIDE sprawdza HYPE:
   ratio = 1.04x  (prawie neutralny - SM mają tyle samo long co short)
   threshold = 2.0x
   → ratio < threshold → SKIP!
   → "Fall through to normal analysis"

2. Normalna analiza patrzy na whale_tracker.py:
   trading_mode = "FOLLOW_SM_LONG" (confidence 86%)
   → Chwila... HYPE SM jest prawie neutralny, ale bias 0.49 daje "LONG"

3. SignalEngine dostaje to:
   Score = 18 (WAIT zone, za niski na SHORT czy LONG)
   → Mode = PURE_MM
   → signalEngineOverride = true
   → signalEngineAllowLongs = true   ← TU ZACZYNA SIĘ PROBLEM
```

OK, SmAutoDetector mówi PURE_MM z `allowLongs=true`. Ale dalej mamy zabezpieczenia... prawda?

```
4. mm_hl.ts → FORCE_SHORT_ONLY:
   "HYPE jest na SHORT_ONLY_TOKENS..."
   ALE: isSignalEnginePureMmFso = true (PURE_MM)
   → "PURE_MM mode → FORCE_SHORT_ONLY bypassed, both sides enabled"
   → Warstwa 1 wyłączona ❌

5. mm_hl.ts → REGIME:
   "HYPE: bull_trend_no_shorting_pump (Longs: true, Shorts: false)"
   → OK, REGIME mówi "tylko longs" - to pasuje

6. mm_hl.ts → SIGNAL_ENGINE MASTER OVERRIDE (linia 7090):
   isPureMmMode = true
   → permissions.allowLongs = true    ← FORCE BOTH SIDES
   → permissions.allowShorts = true
   → Warstwa 2 wyłączona ❌

7. Wynik: Grid generuje BID (buy) ordery
   → HYPE short zamykany po $32+ ze stratą ~10%
```

Cały problem to **jedna linia kodu**:

```typescript
// mm_hl.ts:7095 - PURE_MM MASTER OVERRIDE
permissions.allowLongs = true;  // ← TO ZABIJAŁO NASZEGO SHORTA
```

Ta linia istnieje po to, żeby PURE_MM mode mógł robić "normalny market making" na obie strony. Słuszne dla tokenów bez pozycji. **Katastrofalne** dla tokenów z istniejącym shortem trzymanym na HOLD_FOR_TP.

### Analogia wojskowa

Wyobraź sobie taką sytuację:

```
Generał (GENERALS_OVERRIDE):
  "HYPE - sygnał za słaby (ratio 1.04x), odpuść."
  → Generał wychodzi z pokoju

Oficer wywiadu (SmAutoDetector):
  "Skoro Generał nie chce, to... whale_tracker mówi 'neutral'.
   Dajmy PURE_MM - niech bot handluje normalnie."

Dowódca polowy (mm_hl.ts MASTER OVERRIDE):
  "PURE_MM? Włączam OBE strony - bidy i aski!"
  → Otwiera bidy na HYPE

Strażnik (HOLD_FOR_TP):
  "Czekaj, HYPE ma shorta! Nie otwieraj bidów!"

Dowódca polowy:
  "Sorki, MASTER OVERRIDE. Generał nie jest w pokoju,
   więc PURE_MM ma najwyższy priorytet."
  → Bidy przechodzą → Short zamykany na minus
```

Problem: gdy Generał "odpuścił" (SKIP), nikt nie przejął odpowiedzialności za ochronę istniejącej pozycji. Oficer wywiadu oddał kontrolę PURE_MM, a PURE_MM ma override na wszystko.

### Fix: Dwa zabezpieczenia

**Fix 1: SmAutoDetector - Tryb DEFENSIVE (nie "spadaj")**

Zamiast "fall through to normal analysis" (co prowadzi do PURE_MM), SmAutoDetector teraz zwraca tryb DEFENSIVE:

```typescript
// PRZED: "Generał odchodzi, rób co chcesz"
if (ratio < GENERALS_MIN_SHORT_RATIO) {
  // Fall through to normal analysis below
}

// PO: "Generał odchodzi, ale każe pilnować fortu"
if (ratio < GENERALS_MIN_SHORT_RATIO) {
  return {
    bidEnabled: false,              // BLOKUJ kupowanie
    askEnabled: true,               // Pozwól na shorty
    bidMultiplier: 0.0,
    askMultiplier: 1.0,             // Normalne (nie agresywne)
    mode: MmMode.FOLLOW_SM_SHORT,   // NIE PURE_MM!
    signalEngineOverride: true,     // Override SignalEngine
    signalEngineAllowLongs: false,  // KRYTYCZNE: blokuj longi
    signalEngineAllowShorts: true,
    convictionScore: 60,            // Niższa pewność
  }
}
```

Kluczowa zmiana: `mode: MmMode.FOLLOW_SM_SHORT` zamiast fallthrough do PURE_MM. Dzięki temu `isPureMmMode` w mm_hl.ts będzie FALSE i MASTER OVERRIDE się nie odpali.

**Fix 2: mm_hl.ts - PURE_MM respektuje HOLD_FOR_TP**

Nawet jeśli Fix 1 z jakiegoś powodu nie zadziała, mm_hl.ts teraz sprawdza:

```typescript
if (isPureMmMode) {
  const hasShortPos = actualSkew < -0.05;
  const isHoldTp = isHoldForTpToken(pair);

  if (isHoldTp && hasShortPos) {
    // NIE OTWIERAJ LONGÓW - mamy shorta na HOLD_FOR_TP!
    permissions.allowLongs = false;
    permissions.allowShorts = true;
  } else {
    // Normalne PURE_MM - obe strony
    permissions.allowLongs = true;
    permissions.allowShorts = true;
  }
}
```

### Defense in Depth - znowu

Dwa fixy, nie jeden. Bo:

```
Fix 1 (SmAutoDetector):  Zapobiega powstaniu PURE_MM w ogóle
Fix 2 (mm_hl.ts):        Nawet jeśli PURE_MM powstanie, nie zamknie shorta

Oba muszą JEDNOCZEŚNIE zawieść, żeby bug wrócił.
Prawdopodobieństwo: (p1 failure) × (p2 failure) ≈ bardzo niskie
```

### Weryfikacja po deploy

Logi po fix:

```
☢️ [GENERALS_OVERRIDE] HYPE: WYMUSZONY FOLLOW_SM_SHORT (ratio: 3.50x >= 2x)
💎 [HOLD_FOR_TP] HYPE: Holding SHORT -16% for TP. BIDs BLOCKED, ASKs for TP.
💎 [HOLD_FOR_TP] HYPE removed 8 BIDS - holding SHORT for TP (actualSkew -16%)
🏛️  HYPE Multi-Layer: 0 orders  ← ZERO BUY ORDERÓW!
🛑 [BULL_TRAP] HYPE cancelled existing BID order @ $32.301  ← Anulowane stare bidy!
```

Bot natychmiast anulował istniejące BID ordery i przestał generować nowe. Short chroniony.

### Lekcja #15: Override Chains - "Kto ma FAKTYCZNIE ostatnie słowo?"

Ten bug jest przykładem **niekontrolowanego łańcucha override'ów**. Każdy override z osobna miał sens:
- GENERALS_OVERRIDE: "wymuszaj short dla wybranych tokenów"
- GENERALS_MIN_SHORT_RATIO: "ale nie ślepo, sprawdź dane"
- PURE_MM MASTER OVERRIDE: "gdy brak sygnału, daj obe strony"
- HOLD_FOR_TP: "chroń istniejącą pozycję"

Problem: nikt nie narysował **mapy priorytetów** dla edge case'u "Generał odpuścił, ale pozycja istnieje". Każda warstwa wiedziała o swoich sąsiadach, ale nie o pełnym łańcuchu.

**Zasada:** Gdy masz 5+ warstw override'ów, **narysuj schemat** kto co może nadpisać. Jeśli nie jesteś w stanie narysować go w 2 minuty, system jest za skomplikowany. Uprość, zanim bug narysuje go za Ciebie - Twoimi stratami.

### Lekcja #16: "Fall Through" to ukryty goto

W programowaniu "fall through" (gdy warunek nie pasuje i kod przechodzi do następnej logiki) to mini-`goto`. Jest niewidoczny - nie ma explicit instrukcji "skocz tam", po prostu... kod leci dalej. A gdzie leci? Do PURE_MM, które wymusza `allowLongs=true`, które zamyka Twojego shorta.

**Zasada:** Każdy `if` z `// fall through` komentarzem powinien być traktowany podejrzliwie. Jeśli token jest na liście SHORT_ONLY i Generał go odpuścił - to NIE znaczy "rób co chcesz". To znaczy "chroń pozycję i czekaj na lepszy sygnał".

W naszym fixie zamieniliśmy komentarz `// Fall through to normal analysis below` na explicit `return { ... DEFENSIVE mode ... }`. Teraz kod mówi jasno: "wracam z tymi instrukcjami", a nie "lecę dalej i ktoś tam w dole mnie złapie... albo nie".

---

## Bug #7: "Trzy duchy w maszynie" (02.02.2026)

### Problem: Trzy niezależne błędy, jedna strata

Podczas debugowania HYPE (Bug #6) odkryliśmy, że problem nie był jeden - były **trzy**, działające razem jak nieszczęśliwy splot okoliczności. Jak w katastrofie lotniczej - nigdy nie jest to jeden błąd, zawsze łańcuch.

### Duch #1: Stary plik w złym miejscu

```
~/hyperliquid-mm-bot-complete/smart_money_data.json   ← 22 DNI STARY (11 stycznia!)
/tmp/smart_money_data.json                             ← aktualny (2 lutego)
```

`dynamic_config.ts` szuka danych SM w kilku lokalizacjach, po kolei:
1. `options.dataPath` (nie ustawione)
2. `runtime/smart_money_data.json` (nie istnieje)
3. `smart_money_data.json` (CWD) ← **TEN PLIK!**
4. `/tmp/smart_money_data.json`

Bierze **pierwszy znaleziony**. Stary plik w katalogu roboczym miał HYPE ratio 3.50x (ze stycznia, gdy wieloryby shortowały mocno). Aktualny w `/tmp/` miał 1.04x. Bot ładował stare dane i shortował HYPE na podstawie danych sprzed 22 dni.

**Fix:** Usunięcie starego pliku z CWD. Teraz jedynym źródłem jest `/tmp/smart_money_data.json`.

### Duch #2: `npm start` ignoruje skompilowany kod

```json
// package.json
"start": "TS_NODE_TRANSPILE_ONLY=1 node --loader ts-node/esm src/mm_hl.ts"
```

Bot uruchamiany jest przez `ts-node` - czyta **bezpośrednio pliki `.ts`**, nie skompilowane `.js` z `dist/`. Cały czas deployowaliśmy fix przez `rsync dist/ → serwer`, a bot czytał stary `src/`. Jak wysyłanie nowej wersji mapy do garnizonu, ale żołnierze nadal używają starej bo ktoś zapomniał zabrać ją ze stołu.

**Fix:** Deploy przez `rsync src/*.ts → serwer` zamiast `dist/*.js`.

### Duch #3: ENA na ślepo

```
☢️ [GENERALS_OVERRIDE] ENA: WYMUSZONY FOLLOW_SM_SHORT (ratio: ?x >= 2x)
```

ENA jest w `SHORT_ONLY_TOKENS`, ale `whale_tracker.py` nie miał ENA w `TRACKED_COINS`. Zero danych SM. Gdy `cachedAnalysis.get('ENA')` zwraca `undefined`:

```typescript
const preAnalysis = cachedAnalysis.get(token)  // undefined
if (preAnalysis && preAnalysis.ratio < GENERALS_MIN_SHORT_RATIO) {
  // undefined && ... = false → SKIP
} else {
  // → FORCE SHORT z ratio "?x"
}
```

Bot shortował ENA **bez żadnych danych o pozycjach wielorybów**. Działało na zasadzie "token jest na liście SHORT → shortuj", bez weryfikacji czy SM faktycznie shortują.

**Fix:** Dodanie `"ENA"` do `TRACKED_COINS` w `whale_tracker.py`. Natychmiast pojawiły się dane: ratio 24.29x ($5.85M shorts vs $240K longs). Silny short potwierdzony danymi.

### Jak te trzy duchy współpracowały

```
┌─────────────────────────────────────────────────────────────┐
│  RESTART BOTA                                               │
│                                                              │
│  1. dynamic_config.ts czyta CWD/smart_money_data.json       │
│     → HYPE ratio 3.50x (stare dane z 11.01!)               │
│     → cachedAnalysis.set('HYPE', {ratio: 3.50})             │
│                                                              │
│  2. GENERALS_OVERRIDE: ratio 3.50x >= 2.0x                  │
│     → FORCE SHORT! (na starych danych)                      │
│                                                              │
│  3. loadAndAnalyzeAllTokens() czyta /tmp/...                │
│     → HYPE ratio 1.04x (aktualne)                           │
│     → cachedAnalysis.set('HYPE', {ratio: 1.04})             │
│                                                              │
│  4. GENERALS_OVERRIDE: ratio 1.04x < 2.0x                   │
│     → SKIP! Fall through to PURE_MM                         │
│     → PURE_MM forces allowLongs=true (Bug #6)               │
│     → Grid generuje BUY ordery                              │
│     → Short zamykany na minus                                │
│                                                              │
│  5. Deploy fix (dist/*.js) → bot nadal czyta src/*.ts       │
│     → Fix nie działa!                                        │
│                                                              │
│  6. ENA shortowana bez danych → ratio "?x"                  │
│     → Brak weryfikacji SM pozycji                           │
└─────────────────────────────────────────────────────────────┘
```

Gdyby **którykolwiek** z trzech duchów nie istniał, strata byłaby mniejsza:
- Bez starego pliku → ratio od razu 1.04x, DEFENSIVE mode od startu
- Bez ts-node problemu → fix zadziałałby od pierwszego deploya
- Z danymi ENA → świadoma decyzja zamiast ślepego shortowania

### Lekcja #17: "Data Provenance" - Skąd pochodzą Twoje dane?

Trzy pytania które powinieneś zadać zanim zaufasz jakimkolwiek danym w systemie:

1. **Skąd?** - Który plik/API/endpoint dostarczył te dane?
2. **Kiedy?** - Jak stare są? Czy są fresh czy stale?
3. **Czy jest backup?** - Jeśli główne źródło padnie, skąd biorę dane?

Nasz bot nie zadawał tych pytań. Czytał "pierwszy plik który znalazł" bez sprawdzania jego daty. Jak jedzenie z lodówki bez patrzenia na datę ważności - może być OK, może być food poisoning.

**Zasada:** Każdy data pipeline powinien logować: **"Załadowałem dane z X, timestamp Y, Z rekordów"**. Jeśli nie wiesz skąd dane przyszły, nie wiesz czy im ufać.

### Lekcja #18: "Verify Your Deploy Pipeline"

Nasz deploy wyglądał tak:
```
1. Edytuj .ts na laptopie
2. npm run build → dist/*.js
3. rsync dist/ → serwer
4. pm2 restart
```

Problem: krok 3 był bez sensu, bo bot uruchamia się przez `ts-node src/mm_hl.ts`, nie `node dist/mm_hl.js`. Nigdy tego nie sprawdziliśmy.

**Zasada:** Po każdym deploy sprawdź czy zmiana jest aktywna. Nie przez "nie ma błędów w logach" (brak błędu ≠ zmiana działa). Sprawdź przez **pozytywny dowód**: nowy log message, zmienione zachowanie, test smoke.

W naszym przypadku nowy log `🛡️ DEFENSIVE` zamiast starego `⚠️ SKIP` był takim dowodem. Gdybyśmy sprawdzili od razu po pierwszym deploy, zaoszczędzilibyśmy 30 minut debugowania.

### Lekcja #19: "Phantom Dependencies" - Rzeczy o których zapomniałeś

Bot zależał od 3 rzeczy o których nikt nie pamiętał:
1. Pliku `smart_money_data.json` w CWD (nikt go tam celowo nie zostawił)
2. Faktu że `npm start` używa `ts-node` a nie `dist/` (ustawione dawno, zapomniane)
3. Braku ENA w `whale_tracker.py` (dodane do bota, zapomniane w trackerze)

To są **phantom dependencies** - zależności których nie ma w żadnej dokumentacji, nie widać ich w kodzie, odkrywasz je dopiero gdy coś się psuje.

**Zasada:** Gdy dodajesz token do bota, przejdź CAŁĄ ścieżkę danych od źródła do egzekucji:
```
whale_tracker.py → TRACKED_COINS ← czy token jest tu?
     ↓
/tmp/smart_money_data.json ← czy dane się generują?
     ↓
dynamic_config.ts → loadSmartMoneyFile() ← który plik czyta?
     ↓
SmAutoDetector → cachedAnalysis ← czy ratio jest realne?
     ↓
GENERALS_OVERRIDE → decyzja ← czy oparta na danych?
```

Jedna pominięta stacja = ślepy trade.

---

## Bug #8: "Golden Duo mówi do ściany, Oracle nie zna imion" (02.02.2026)

### Problem: Dwa ciche errory spamujące logi

Po fixach Bug #6 i #7 logi wyglądały czysto... prawie. Dwa errory cicho jechały w tle, co pętlę bota:

```
[Golden Duo] Failed to fetch signal for HYPE: connect ECONNREFUSED 127.0.0.1:8080
[Golden Duo] Failed to fetch signal for LIT: connect ECONNREFUSED 127.0.0.1:8080
[Golden Duo] Failed to fetch signal for PUMP: connect ECONNREFUSED 127.0.0.1:8080
...powtórz dla KAŻDEGO tokena, co 60 sekund...

[Oracle] Error processing BTC: TypeError: mmAlertBot.sendRiskAlert is not a function
[Oracle] Error processing HYPE: TypeError: mmAlertBot.sendRiskAlert is not a function
```

Żaden z nich nie powodował straty pieniędzy (graceful degradation zadziałał), ale: szum w logach maskuje prawdziwe problemy, a Golden Duo nie dostarczał danych do systemu.

### Root Cause #1: Golden Duo - "Trzy adresy, zero działa"

Golden Duo to system który łączy dwa źródła: **SM Position Bias** (strategia) i **Flow Skew** (taktyka). Powinien dostarczać dane do gridu, żeby asymetrycznie skewować ceny.

Problem: w kodzie było **trzy osobne miejsca** z portami, każdy wskazywał na coś innego:

```
nansen-bridge.mjs:        PORT = 8080 (config)
nansen-bridge (aktualny):  nasłuchuje na 8081 (bo 8080 zajęty!)
.env:                      NANSEN_PROXY_URL=http://localhost:8080
nansen_hyperliquid.ts:     fallback = 'http://localhost:8080'
ai-executor-v2.mjs:        fallback = 'http://127.0.0.1:8080'
```

Nansen-bridge wystartował na 8081 bo 8080 był zajęty, ale NIKT nie zaktualizował reszty. Trzy osobne pliki wskazywały na port który nie nasłuchuje.

Ale to nie koniec. `getGoldenDuoSignalForPair()` (wywoływana per token per pętlę) próbowała `POST /api/token-perp-positions` i `POST /api/smart-money-perp-trades`. **Te endpointy nie istnieją na nansen-bridge!** Nansen-bridge ma `GET /api/golden_duo` - zupełnie inne API.

Czyli nawet z poprawnym portem, ta funkcja nigdy by nie zadziałała. Dwa bugi naraz.

Tymczasem `syncGoldenDuo()` (strategic worker, co 60s) poprawnie wywoływał `GET /api/golden_duo` i ładował dane do `goldenDuoData`. Te dane były używane przez `getNansenBiasForPair()` i `getDivergenceMultipliers()` w multi-layer gridzie. Więc **strategiczna warstwa działała** - to taktyczna warstwa (positionBias + flowSkew) była zepsuta.

### Fix: Jedna prawda, jedna ścieżka

```
PRZED (trzy niezgodne ścieżki):

  syncGoldenDuo()              → GET /api/golden_duo → goldenDuoData ✅
  getGoldenDuoSignalForPair()  → POST /api/token-perp-positions → ❌ ECONNREFUSED
  getNansenBiasForPair()       → goldenDuoData → ✅

PO (jedna ścieżka):

  syncGoldenDuo()              → GET /api/golden_duo → goldenDuoData ✅
  getGoldenDuoSignalForPair()  → goldenDuoData (z cache!) → ✅
  getNansenBiasForPair()       → goldenDuoData → ✅
```

Zamiast `getGoldenDuoSignalForPair()` robił osobne HTTP calle (do nieistniejących endpointów), teraz czyta z `goldenDuoData` cache'u który `syncGoldenDuo()` już wypełnia co 60 sekund:

```typescript
// PRZED: HTTP call do nieistniejącego endpointu
const signal = await getGoldenDuoSignal(symbol) // → ECONNREFUSED

// PO: czytaj z cache który już masz
const gdData = this.goldenDuoData[symbol]
if (gdData) {
  const positionBias = (gdData.bias - 0.5) * 2  // 0→-1, 0.5→0, 1→+1
  return { symbol, positionBias, flowSkew: gdData.flowSkew ?? 0 }
}
```

Plus `.env` poprawiony na serwerze: `NANSEN_PROXY_URL=http://localhost:8081`.
Plus fallbacki w kodzie zmienione z 8080 na 8082 (port telemetrii - jako bezpieczny default).

### Root Cause #2: Oracle - "Nie ma takiej metody"

```typescript
// mm_hl.ts:5311
mmAlertBot.sendRiskAlert(flipMsg, 'warning').catch(() => {})
```

`MMAlertBot` nie ma metody `sendRiskAlert()`. Ta metoda istnieje jako **standalone function** w `slack_router.ts`:

```typescript
// utils/slack_router.ts
export async function sendRiskAlert(text: string): Promise<void> {
  await sendSlackText(text, "risk")
}
```

I ta funkcja jest już zaimportowana w mm_hl.ts (linia 105). Ktoś wywołał `mmAlertBot.sendRiskAlert()` zamiast `sendRiskAlert()`. Jedna literka różnicy w prefixie - `mmAlertBot.` zamiast nic.

**Fix:** Zmiana na standalone: `sendRiskAlert(flipMsg).catch(() => {})`.

### Weryfikacja

Po deploy i restart - flush logów, 45 sekund czekania:
```
=== Golden Duo ECONNREFUSED errors: 0
=== Oracle sendRiskAlert errors: 0
=== Golden Duo sync: [GoldenDuo] Synced 15 coins from nansen-bridge ✅
```

### Golden Duo - "Czy te dane w ogóle mają sens?"

Po fixie Golden Duo zaczął dostarczać positionBias do gridu. Sprawdzenie spójności z resztą systemu:

| Token | GD bias | positionBias | getNansenBias | Bot Mode | Spójne? |
|-------|---------|-------------|--------------|----------|---------|
| PUMP | 0.00 | -1.00 | 'short' | FOLLOW_SM_SHORT | YES |
| FARTCOIN | 0.01 | -0.98 | 'short' | FOLLOW_SM_SHORT | YES |
| SUI | 0.03 | -0.94 | 'short' | FOLLOW_SM_SHORT | YES |
| ENA | 0.04 | -0.92 | 'short' | FOLLOW_SM_SHORT | YES |
| LIT | 0.17 | -0.66 | 'short' | FOLLOW_SM_SHORT | YES |
| HYPE | 0.49 | -0.02 | neutral | DEFENSIVE | YES |

Bias 0 = "SM maksymalnie short" → positionBias = -1.0 (bear)
Bias 0.5 = "SM neutralny" → positionBias = 0.0 (neutral)
Bias 1.0 = "SM maksymalnie long" → positionBias = +1.0 (bull)

Ważne: `positionBias` jest używany tylko w Regular MM (nie multi-layer). Wszystkie aktywne tokeny to multi-layer, więc positionBias nie wpływa na ich gridy. Ale `getNansenBiasForPair()` (który też czyta `goldenDuoData`) wpływa - kontroluje spread asymmetry i contra-skew limiting w multi-layer.

Jedna luka: `flowSkew` jest zawsze 0, bo nansen-bridge nie ma tych danych. Oznacza to, że "alpha shift" (przesunięcie mid-price na podstawie flow) nigdy nie działał. To status quo od zawsze - ten feature wymaga rozbudowy nansen-bridge.

### Lekcja #20: "Ciche errory to bomby zegarowe"

Golden Duo i Oracle spamowały errory od tygodni. Nikt ich nie naprawił, bo "bot dalej działa". Prawda - graceful degradation zadziałał. Ale:

1. **Szum w logach maskuje prawdziwe problemy.** Gdy masz 200 linii ECONNREFUSED, łatwo przeoczyć jedną linię z PRAWDZIWYM problemem.
2. **Dane nie docierają.** Golden Duo miał dostarczać positionBias i flowSkew. Nie dostarczał. System działał "bez ręki" - niby OK, ale suboptymalne.
3. **Entropia rośnie.** Dziś jeden cichy error, jutro dwa, za tydzień dziesięć. Każdy "niegroźny" error obniża signal-to-noise ratio logów.

**Zasada:** Treat warnings as errors. Jeśli coś loguje warning/error i to "nie szkodzi" - to albo napraw to, albo wyłącz log. Zero tolerancji dla "w sumie to działa, ale loguje błędy". Twoje przyszłe ja, debugujące o 3 w nocy, podziękuje za czyste logi.

### Lekcja #21: "Sprawdź porty po starcie"

Nansen-bridge miał port 8080 w konfiguracji, ale startował na 8081 bo 8080 był zajęty. Nikt tego nie zauważył. Reszta systemu nadal wskazywała na 8080.

**Zasada:** Po każdym restarcie serwisu sprawdź `ss -tlnp | grep <port>`. Nie ufaj konfiguracji - ufaj kernelowi. Config mówi "chcę 8080", kernel mówi "dostałeś 8081". Kernel ma rację.

Lepsze rozwiązanie: service discovery. Zamiast hardcoded portów, nansen-bridge mógłby ogłosić "nasłuchuję na porcie X" do pliku (np. `/tmp/nansen-bridge.port`) a reszta by go czytała. Ale to overengineering dla naszego przypadku - wystarczy konsekwencja w konfiguracji.

### Lekcja #22: "Jeden cache, wiele konsumentów"

Golden Duo miał DWA cache'e i DWA systemy fetchowania tych samych danych:
- `syncGoldenDuo()` → `goldenDuoData` → `GET /api/golden_duo` ✅
- `getGoldenDuoSignalForPair()` → `goldenDuoCache` → `POST /api/...` ❌

Dwa cache'e robiące to samo, ale inaczej. Jeden działał, drugi nie. Klasyczny DRY violation w data fetching.

**Fix:** Usunięcie drugiego fetching pathway - `getGoldenDuoSignalForPair()` teraz czyta z tego samego `goldenDuoData` cache'u co reszta systemu.

**Zasada:** Jedno źródło danych → jeden fetch → jeden cache → wielu konsumentów. Nigdy "dwa osobne systemy pobierające to samo". Masz `syncGoldenDuo()` co 60s? To niech WSZYSCY czytają z jego cache'u, zamiast robić własne HTTP calle.

---

## SHORT-ON-BOUNCE Filter - "Nie goń dna, shortuj na odbicie" (02.02.2026)

### Problem: Bot shortuje w najgorszym momencie

Wyobraź sobie scenariusz. Generałowie mają $11M short na LIT. Bot dostaje rozkaz: FOLLOW_SM_SHORT. I co robi? Natychmiast składa aski (zlecenia sprzedaży). Nawet jeśli cena właśnie spadła 5% w ciągu godziny.

Czy tak robią prawdziwi wieloryby? **Nie.** Trader 0x38042d (nasz Generał) czeka na **bounce** - chwilowe odbicie ceny w górę - i dopiero wtedy dokłada do shorta. Dlaczego? Bo shortując na górce masz lepszą cenę wejścia i mniejsze ryzyko.

```
CO ROBIŁ BOT:                       CO ROBIĄ WIELORYBY:

Cena: $1.60 ──────────╮             Cena: $1.60 ──────────╮
                       │                                    │
       $1.50 ─────────┤                    $1.50 ─────────┤
                       │ ← Bot shortuje                    │
       $1.40 ──────╮  │   TU (na dnie!)    $1.40 ──────╮  │
                   │  │                                │  │
       $1.35 ─────┤  │                    $1.35 ─────┤  │
                   │  │                                │  │ ← Bounce!
       $1.30 ────╮│  │                    $1.30 ────╮│  │
                 ││  │                              ││  ╰── Wieloryb shortuje
       $1.25 ───╯╯  │                    $1.25 ───╯╯       TU (na bouncie!)
                     │
              Dalszy spadek                     Dalszy spadek

Entry: $1.40 (złe)                   Entry: $1.50 (dobre!)
Różnica: 7% gorszy entry             → lepszy PnL na shorcie
```

### Rozwiązanie: Trzy strefy

Zamiast ślepo shortować, bot teraz sprawdza `change1h` (zmianę ceny w ostatniej godzinie) i decyduje:

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                   │
│  change1h < -2%        │  -2% ... +0.3%     │  >= +0.3%          │
│  ─────────────         │  ──────────────     │  ──────────        │
│  🏃 CHASE              │  ⚠️ NEUTRAL         │  🎯 BOUNCE         │
│                        │                     │                    │
│  "Cena spada mocno.    │  "Cena płaska.      │  "Cena odbija!     │
│   Nie goń dna!"        │   Ostrożnie..."     │   TERAZ shortuj!"  │
│                        │                     │                    │
│  → ZERO asków          │  → Aski × 0.5      │  → PEŁNE aski      │
│  → Czekaj na bounce    │  → Zmniejszona      │  → Agresywne       │
│                        │    ekspozycja       │    shortowanie"     │
│                        │                     │                    │
└──────────────────────────────────────────────────────────────────┘
```

Analogia: to jak łowienie ryb. Nie wskakujesz do wody gdy prąd jest najsilniejszy (CHASE). Czekasz aż prąd się uspokoi (NEUTRAL) albo zacznie cofać (BOUNCE), i wtedy zarzucasz wędkę.

### Per-token progi

Nie każdy token porusza się tak samo. FARTCOIN i HYPE są bardziej zmienne niż LIT czy ENA, więc potrzebują szerszych progów:

| Token | CHASE (blokuj) | BOUNCE (pełne aski) | Dlaczego? |
|-------|---------------|--------------------:|-----------|
| **Default** | < -2.0% | >= +0.3% | Standardowy altcoin |
| **FARTCOIN** | < -3.0% | >= +0.5% | Memecoin, dużo szumu cenowego |
| **HYPE** | < -3.0% | >= +0.5% | Wysoka zmienność, duży OI |

Konfiguracja w jednym miejscu (`src/config/short_only_config.ts`):

```typescript
export const BOUNCE_FILTER_DEFAULTS: BounceFilterConfig = {
  chaseThreshold: -2.0,
  bounceThreshold: 0.3,
  neutralAskMult: 0.5,
  enabled: true,
}

export const BOUNCE_FILTER_OVERRIDES: Record<string, Partial<BounceFilterConfig>> = {
  'FARTCOIN': { chaseThreshold: -3.0, bounceThreshold: 0.5 },
  'HYPE':     { chaseThreshold: -3.0, bounceThreshold: 0.5 },
}
```

Chcesz dodać custom progi dla SUI? Jedna linia: `'SUI': { chaseThreshold: -2.5 }`. Reszta dziedziczy z DEFAULTS.

### Jak to działa w kodzie

Filtr ma dwie fazy w `mm_hl.ts`:

**Faza 1 (pre-grid):** PRZED `generateGridOrders()` - sprawdza `change1h` i albo ustawia flagę `bounceFilterChaseBlock` (CHASE), albo modyfikuje `sizeMultipliers.ask` (NEUTRAL), albo nic nie robi (BOUNCE).

**Faza 2 (post-grid):** PO generowaniu gridOrders - jeśli flaga CHASE jest ustawiona, **usuwa WSZYSTKIE aski** z grida. Wzór identyczny jak istniejący ZEC trend-stop filter.

```
GENERALS_OVERRIDE → FOLLOW_SM_SHORT (bid=0, ask=1.5)
        ↓
[BOUNCE_FILTER] change1h check:          ← Faza 1
  < -2%      → CHASE:   flag = true
  -2%..+0.3% → NEUTRAL: ask × 0.5
  >= +0.3%   → BOUNCE:  pełne aski
        ↓
Grid generuje ordery
        ↓
[BOUNCE_FILTER] if chase → usuń aski     ← Faza 2
        ↓
HOLD_FOR_TP → bidy usunięte (bez zmian)
```

Ważne: HOLD_FOR_TP i BOUNCE_FILTER nie kolidują. HOLD_FOR_TP dotyczy **bidów** (nie kupuj, trzymaj shorta). BOUNCE_FILTER dotyczy **asków** (nie shortuj na dnie). Działają na różnych stronach orderbooka.

### Edge case: brak danych

Gdy `HyperliquidDataFetcher` nie ma jeszcze danych (np. tuż po restarcie), `change1h` defaultuje do 0:

```typescript
const change1h = snapshot?.momentum?.change1h ?? 0
```

Zero mieści się w strefie NEUTRAL (-2% < 0 < +0.3%), więc bot zmniejszy aski o 0.5x zamiast wysyłać pełne. Bezpieczny default - nie shortuje agresywnie bez danych, ale też nie blokuje shortowania całkowicie.

### Bug po drodze: "Data Fetcher nie sięga do naszych coinów"

Po deploy filtr działał, ale HYPE, LIT, FARTCOIN i ENA ciągle pokazywały `change1h: +0.00%`. Tylko SUI miał prawdziwe dane. Co się działo?

`HyperliquidDataFetcher.refreshAllData()` iteruje przez **WSZYSTKIE** coiny na Hyperliquid (300+), fetchując candle'e jeden po drugim. To wymaga osobnego API call per coin. Problem: Hyperliquid ma rate limit, i po ~50 coinach bot zaczyna dostawać 429 (Too Many Requests).

SUI jest "dużym" coinem z niskim indeksem w API (majors mają indeksy 0-30). Nasze altcoiny (HYPE index ~100+, LIT ~200+) nigdy nie były osiągane zanim rate limity zablokowały refresh.

Dwa fixy:

**Fix 1: Priority coins - "VIPy najpierw"**

```typescript
// src/api/hyperliquid_data_fetcher.ts
private static readonly PRIORITY_COINS: Set<string> = new Set([
  'HYPE', 'LIT', 'FARTCOIN', 'ENA', 'SUI', 'PUMP'
])

// W refreshAllData():
const sorted = [...assetCtxs].sort((a, b) => {
  const ap = HyperliquidDataFetcher.PRIORITY_COINS.has(a.coin.toUpperCase()) ? 0 : 1
  const bp = HyperliquidDataFetcher.PRIORITY_COINS.has(b.coin.toUpperCase()) ? 0 : 1
  return ap - bp
})
```

Nasze coiny są fetchowane PIERWSZE, zanim rate limity uderzą. Reszta (300 losowych coinów) fetcho jest po nich - jeśli się nie zmieszczą, trudno. Nasze dane są bezpieczne.

**Fix 2: Concurrent refresh storm prevention**

`getMarketSnapshotSync()` (metoda sync) odpalała `refreshAllData()` w tle, ale **nigdy nie aktualizowała `lastFetch`**. To oznaczało, że KAŻDE wywołanie sync metody (5 tokenów × ~3 razy na pętlę = 15 razy co minutę) odpalało nowy concurrent refresh. 15 równoległych refresh'ów to 15 × 300 API calls. Rate limit gwarantowany.

```typescript
// PRZED: storm
getMarketSnapshotSync(coin) {
  if (now - this.lastFetch >= CACHE_TTL_MS) {
    this.refreshAllData()  // fire and forget, lastFetch NIGDY nie aktualizowane!
  }
}

// PO: jeden refresh na raz
getMarketSnapshotSync(coin) {
  if (now - this.lastFetch >= CACHE_TTL_MS && !this.refreshInProgress) {
    this.refreshInProgress = true
    this.lastFetch = now  // natychmiastowa aktualizacja, zapobiega kolejnym odpaleniom
    this.refreshAllData()
      .finally(() => { this.refreshInProgress = false })
  }
}
```

Efekt natychmiastowy: po restart wszystkie coiny pokazują prawdziwe `change1h`:

```
🎯 [BOUNCE_FILTER] HYPE: NEUTRAL (1h: +0.02%) → ask×0.25→0.13
🎯 [BOUNCE_FILTER] FARTCOIN: NEUTRAL (1h: -0.11%) → ask×2.43→1.21
🎯 [BOUNCE_FILTER] ENA: NEUTRAL (1h: -0.02%) → ask×0.35→0.17
🎯 [BOUNCE_FILTER] SUI: BOUNCE (1h: +0.35%) → FULL asks
```

SUI nawet przeszedł do strefy BOUNCE (+0.35% > threshold +0.3%) - pełne aski! Filtr działa.

### Lekcja #23: Priority Queuing - "VIPy idą bez kolejki"

Gdy masz ograniczony budżet API calls i 300 coinów do sprawdzenia, **nie traktuj wszystkich równo**. Handlujesz 6 coinami? To te 6 coinów powinno być ZAWSZE na pierwszym miejscu.

To ta sama zasada co tier-based polling w VIP Spy - priorytetyzuj to co jest ważne, resztę rób "best effort".

Analogia: szpital z 300 pacjentami i 50 zestawów do badania krwi. Nie testujesz w kolejce zgłoszeń. Pacjenci na OIOM-ie (Twoje aktywne tokeny) idą pierwsi. Reszta czeka. Jeśli zabraknie zestawów - trudno, OIOMowcy mają swoje wyniki.

### Lekcja #24: Sync methods that fire async work - "Brudna bomba"

`getMarketSnapshotSync()` to wzorzec który wygląda niewinnie: "zwróć dane z cache, a w tle odśwież". Problem: "w tle" to niekontrolowane terytorium. Kto śledzi ile refresh'ów jest w locie? Kto aktualizuje `lastFetch`? Kto zapobiega storms?

Jeśli musisz użyć tego wzorca, **zawsze** dodaj:
1. **Guard flag** (`refreshInProgress`) - jeden refresh na raz
2. **Eager timestamp update** (`lastFetch = now` przed async call) - zapobiega kolejnym odpaleniom
3. **Finally cleanup** (`.finally(() => { flag = false })`) - zawsze resetuj stan

Bez tych trzech: sync method z async fire-and-forget = race condition waiting to happen.

---

## Capital Dominance v3 -- Smart Merge + USD-Based Scoring (03.02.2026)

### Problem: Jeden wiersz kodu niszczył $114M sygnału

Wyobraz sobie sytuacje: masz satelitarne zdjecie pola bitwy. Widac na nim, ze wrog ma $114 milionow w pozycjach short na SOL. Wtedy przychodzi zwiadowca z rozmazanym zdjeciem z telefonu - "$62 tysiecy ruchu on-chain na Solanie". I co robi stary kod? **Wyrzuca zdjecie satelitarne i zostawia tylko rozmazane zdjecie z telefonu.**

Dokladnie to robila funkcja `injectProxyData()` w `SmAutoDetector.ts`:

```typescript
enrichedData[perpSymbol] = proxyData    // <-- TEN JEDEN WIERSZ
```

Bezwarunkowy replace. Dla kazdego tokena z mapy `PERP_TO_ONCHAIN_PROXY` pobieral dane on-chain z Nansen i **calkowicie nadpisywal** to co whale_tracker.py zebrarl z Hyperliquid perps.

### Skala zniszczen

| Token | whale_tracker (perps) | Nansen (on-chain) | Po starym inject | Co poszlo nie tak |
|-------|----------------------|-------------------|-----------------|-------------------|
| **SOL** | $1.03M L / **$114.76M S** | SM=$62k | rawL=$0.06M, rawS=$0 | **$114M shorts ZNIKNELO** |
| **LIT** | $1.68M L / **$8.21M S** | SM=$0 | rawL=$0, rawS=$0 | **$8.21M shorts ZNIKNELO** |
| **DOGE** | $0.18M L / $0.16M S | SM=-$235k | rawL=$0, rawS=$0.23M | Dzialalo z farta |
| **VIRTUAL** | ~$0 | SM=$5k | rawL=$0.01M | OK (nie bylo czego stracic) |

SOL dostal Engine score +21 (WAIT/PURE_MM) zamiast FOLLOW_SM_SHORT. Bot dosłownie nie widzial $114 milionow shortow wielorybow.

### Analogia: Generał i zwiadowca

Pomysl o tym tak:

```
STARY KOD:
  Generał (whale_tracker): "Mam zdjęcie satelitarne. $114M SHORT na SOL."
  Zwiadowca (Nansen): "Widziałem $62k ruchu na Solanie."
  System: *wyrzuca zdjęcie satelitarne* "Używamy danych zwiadowcy."
  Generał: "...ale ja mam 1800 razy więcej danych?!"

NOWY KOD:
  System: "Kto ma więcej danych?"
  Generał: "$115.8M łącznie"
  Zwiadowca: "$0.06M łącznie"
  System: "Generał wygrywa. Zachowuję satelitę, notuję raport zwiadowcy."
```

### Fix #1: Smart Merge w `injectProxyData()`

**Plik:** `src/mm/SmAutoDetector.ts`

Zamiast slepego nadpisywania, porownujemy wolumeny:

```
JESLI perpVolume > onchainVolume:
  → ZACHOWAJ dane perps (whale_tracker) — glowne zrodlo
  → DODAJ on-chain jako pola suplementarne (onchain_sm_net, onchain_whale_net...)
  → Log: "PERP dominates"

W PRZECIWNYM RAZIE:
  → UZYJ on-chain jako glowne (stare zachowanie dla VIRTUAL, ZEC)
  → Log: "ONCHAIN primary"
```

Cztery nowe pola w `SmartMoneyEntry` (plik `src/types/smart_money.ts`):
- `onchain_sm_net` — Smart Money net flow w USD
- `onchain_whale_net` — Whale net flow w USD
- `onchain_chain` — ktory chain (solana, base, bnb)
- `onchain_confidence` — pewnosc Nansen 0-100

### Fix #2: Capital Dominance Sorting w `getTopSmPairs()`

**Plik:** `src/mm/SmAutoDetector.ts`

**Przed:** Sortowanie po `|engineScore|` ktory jest ograniczony do -50..+50. SOL ($114M net short) i LIT ($6.5M net short) oba mialy score ~-47 do -49 — prawie nie do odroznienia.

**Po:** Sortowanie po `|rawLongsUsd - rawShortsUsd|` — rzeczywista nierownowaga w dolarach.

```
[SM Auto-Select] Capital Dominance Leaders:
   SOL: 🟥 SHORT $113.7M net | Engine: -49
   BTC: 🟥 SHORT $108.5M net | Engine: -43
   ETH: 🟥 SHORT $25.6M net | Engine: -36
   LIT: 🟥 SHORT $6.5M net | Engine: -47
```

**Zasada:** Sortuj po metryce najblizszej rzeczywistosci (USD), nie po pochodnym score'u.

### Fix #3: Flow Attenuation (Tlumienie szumu)

**Plik:** `src/mm/SmAutoDetector.ts` (przed oboma wywolaniami `SignalEngine.analyze()`)

Gdy perps data jest dużo wieksza niz on-chain flows, wartosci flow podawane do `SignalEngine.analyze()` sa tlumione (skalowane w dol), zeby nie mylily silnika.

| Stosunek Perps/Onchain | Wspolczynnik | Znaczenie |
|------------------------|-------------|-----------|
| >10x | 0.1 | On-chain to szum |
| 3-10x | 0.3 | Zmniejsz wage on-chain |
| <3x | 1.0 | Oba zrodla rowne |

Dla tokenow BEZ proxy (BTC, ETH, HYPE, FARTCOIN) — `onchain_sm_net` jest undefined, wiec `flowAttenuation = 1.0` → **zero wplywu**.

### Wyniki po fixie

| Token | Przed | Po | Dlaczego |
|-------|-------|-----|----------|
| **SOL** | PURE_MM (+21 WAIT) | **FOLLOW_SM_SHORT** (-49) | $114M shorts zachowane |
| **LIT** | PURE_MM (0 WAIT) | **FOLLOW_SM_SHORT** (-47) | $8.21M shorts zachowane |
| **BTC** | FOLLOW_SM_SHORT (-43) | FOLLOW_SM_SHORT (-43) | Nie w proxy map, bez zmian |
| **DOGE** | FOLLOW_SM_SHORT (-46) | FOLLOW_SM_SHORT (-46) | Perps zachowane, on-chain dodany |
| **VIRTUAL** | PURE_MM (+14) | PURE_MM (+14) | On-chain primary, bez zmian |

### Lekcja #25: "Last Writer Wins" anti-pattern

Bug byl klasycznym przypadkiem "last writer wins" — destruktywne nadpisanie ktore wygladalo niewinnie gdy bylo pisane (pewnie gdy w proxy map byl tylko VIRTUAL, ktory nie mial danych perps do nadpisania). Gdy dodawalismy kolejne tokeny (SOL, LIT, DOGE), blast radius rosl po cichu.

**Zasada:** Gdy laczysz dane z dwoch zrodel, ZAWSZE zadaj pytanie: "Co jesli oba zrodla maja dane? Ktore wygrywa?" Zrob strategie merge'u jawna i logowana.

### Lekcja #26: Volume-Weighted Data Fusion

Gdy masz dwa zrodla danych o drastycznie roznych skalach ($114M perps vs $62k on-chain), nie mozesz ich traktowac rowno. Wzorzec atenuacji jest przydatny wszedzie gdzie laczysz sygnaly roznych skal:

```typescript
if (sourceA >> sourceB) {
  weight_B *= 0.1   // sourceB to szum wzgledem sourceA
}
```

To jak nasluchiwanie dwoch radiostacji: jedna nadaje z wiezy transmisyjnej (100kW), druga z walkie-talkie (5W). Jesli zmieszasz je po rowno, walkie-talkie bedzie nieslyšalne. Ale jesli odfiltrujés szum z duzej stacji, wyłowisz informacje z malej.

### Lekcja #27: Sort by reality, not by score

Engine score kompresuje zupelnie rozne sytuacje do zakresu -50..+50. SOL z $114M net short i LIT z $6.5M net short oba dostaly ~-49. Sortowanie po surowych dolarach zachowuje prawdziwa skale sygnalu.

**Analogia:** Oceny w szkole (1-6) kompresują wiedze. Uczen z 6 z matmy moze umiec "troche wiecej" albo "drastycznie wiecej" od ucznia z 5. Ale na olimpiadzie liczy sie surowy wynik, nie ocena.

---

## TokenRiskCalculator - "Dynamiczna dźwignia + inteligentny Stop Loss" (03.02.2026)

### Problem: Jeden rozmiar nie pasuje do wszystkich

Bot miał dwie sztywne liczby: **leverage** i **stop loss 12%**. Każdy token dostawał to samo traktowanie. To tak, jakby dawać identyczne okulary korekcyjne każdemu w pokoju — BTC i FARTCOIN to zupełnie inne bestie.

Przy **5x leverage na BTC**, 12% ruch ceny = **60% kapitału** gone. To nie stop loss, to likwidacja.
Przy **1x leverage na FARTCOIN**, 12% to zaledwie jedna świeca. Bot wyleciałby na szumie.

### Rozwiązanie: Dwa współpracujące systemy

#### System 1: Dynamic Leverage (Combined Strategy)

Formuła:
```
Leverage = MAX_LEV × ConvictionFactor × VolatilityDampener
         = 5       × (0.5 - 1.0)      × (TARGET_VOL / actual_vol)
```

**ConvictionFactor** = atak. Jak bardzo SM są pewni swojego? 90% conviction = factor 0.90. To przyspieszenie.

**VolatilityDampener** = obrona. Kalibrowane do 5% dziennej zmienności. Token z 5% vol (BTC) → dampener 1.0. Token z 12.5% vol (FARTCOIN) → dampener 0.4 (hamulec).

| Token | Dz. Vol | Conviction | Leverage | Dlaczego |
|-------|---------|------------|----------|----------|
| BTC | ~4.5% | 85% | **4x** | Spokojny major + silny sygnał = agresywnie |
| SOL | ~4.5% | 70% | **3x** | Spokojny, ale conviction niższe |
| LIT | ~7.2% | 90% | **3x** | Bardzo pewny sygnał, ale volatile |
| HYPE | ~7.2% | 86% | **3x** | Podobnie do LIT |
| VIRTUAL | ~12.5% | 80% | **1x** | Memecoin = hamulec dominuje |
| FARTCOIN | ~12.5% | 95% | **1x** | 95% conviction, ALE vol 12.5% = 1x |

Zwróć uwagę na FARTCOIN: wieloryby są prawie na 100% pewne, ale volatility override dominuje. Możesz być pewien co do memcoina i DALEJ nie ryzykować 5x leverage. Obrona > Atak.

#### System 2: Vision SL (ATR-based Stop Loss)

```
Vision SL% = Daily Volatility × ATR_MULTIPLIER (2.5x)
           z twardym limitem 15%
```

**Mnożnik 2.5x** to standard swing tradingu. Znaczy: "wychodzimy TYLKO gdy ruch jest 2.5x większy niż normalny dzień." Filtruje szum — losowe knoty i fake pumpy nie trafią w SL, ale prawdziwy trend reversal tak.

| Token | Dz. Vol | Vision SL | Stary SL | Zmiana |
|-------|---------|-----------|----------|--------|
| BTC | ~4.5% | **11.3%** | 12% | Ciut ciaśniej (mniej risk przy 4x lev) |
| SOL | ~4.5% | **11.3%** | 12% | Podobnie |
| LIT | ~7.2% | **15.0%** | 12% | Szerzej — oddycha z volatility |
| HYPE | ~7.2% | **15.0%** | 12% | Szerzej |
| VIRTUAL | ~12.5% | **15.0%** | 12% | Szerzej — nie whipsawuje na spikach |
| FARTCOIN | ~12.5% | **15.0%** | 12% | Szerzej |

### Dlaczego te dwa systemy muszą współpracować

Wyobraź to sobie jako huśtawkę:

```
Volatile token (FARTCOIN):       Stabilny token (BTC):
  Lev: NISKO (1x)                  Lev: WYSOKO (4x)
  SL:  SZEROKO (15%)               SL:  CIASNO (11.3%)
  Risk = 1 × 15% = 15%             Risk = 4 × 11.3% = 45%
```

45% na BTC brzmi dużo — i celowo. Bot bierze 4x leverage TYLKO gdy SM conviction jest 85%+. Przy niższym conviction (50%) leverage spada do 2x → risk = 2 × 11.3% = 22.6%. Conviction działa jako **zawór ryzyka**.

Gdyby SL był sztywny 12% a dźwignia dynamiczna, byłby disconnect. Gdyby SL był dynamiczny a dźwignia sztywna — też. Oba muszą reagować na tę samą zmienność, żeby system był spójny.

**Analogia wojskowa:** ConvictionFactor mówi "jak daleko się zagłębiamy w terytorium wroga" (leverage). VolatilityDampener mówi "jak szeroki jest obszar wycofania" (SL). Agresywne zagłębienie w spokojnym terenie (BTC) = OK. Agresywne zagłębienie w dżungli pełnej pułapek (FARTCOIN) = samobójstwo.

### Skąd bierzemy volatility (bez świec)?

SmAutoDetector nie ma historii cen. Estymujemy z istniejącej `TOKEN_VOLATILITY_CONFIG`:

```typescript
dailyVol = (minStopLossPercent / 100) × atrMultiplier
```

Oba pola już istniały (ustawione ręcznie na podstawie obserwacji tokenów). Mnożenie ich daje rozsądne przybliżenie dziennej zmienności. Gdy dodasz prawdziwe dane ATR ze świec, przekaż je jako `atr_value` — calculator użyje ich zamiast estymaty.

### Architektura: Dwa moduły ryzyka

```
TokenRiskCalculator.ts (NOWY — src/mm/)
  ├── calculateLeverage()        ← conviction × vol → 1-5x
  ├── calculateVisionStopLoss()  ← entry price + ATR → cena SL
  └── calculateVisionSlPercent() ← vol → SL jako % (bez ceny)

RiskManager.ts (BEZ ZMIAN — src/risk/)
  └── Ochrona portfela (drawdown, inventory, emergency liquidation)
```

**Dlaczego dwa?**
- `RiskManager` = **strażnik portfela** → "Czy za dużo dzisiaj straciłem?"
- `TokenRiskCalculator` = **sizer pozycji** → "Ile dźwigni na TEN token? Gdzie SL?"

Działają na różnych poziomach. RiskManager haltuje bota (ostatnia linia obrony). TokenRiskCalculator pomaga podejmować mądrzejsze decyzje indywidualnie.

### Lekcja #28: Naming Collisions — "Nudne ale jasne > Sprytne"

Oryginalny plan nazywał nowy moduł `RiskManager` — identycznie jak istniejący plik w `src/risk/`. TypeScript by to skompilował (różne ścieżki importu), ale człowiek czytający `import { RiskManager } from './RiskManager'` vs `import { RiskManager } from '../risk/RiskManager'` byłby zdezorientowany. Zmiana na `TokenRiskCalculator` kosztuje zero wysiłku i eliminuje kategorię błędów.

### Lekcja #29: Static methods dla pure calculations

`TokenRiskCalculator` używa `public static` — bez instancji, bez stanu. Wołasz `TokenRiskCalculator.calculateLeverage(profile)` bezpośrednio. To właściwy wzorzec dla czystych obliczeń matematycznych. Portfolio-level `RiskManager` używa instancji bo śledzi stan (high water mark, equity sesji). Różne narzędzia do różnych zadań.

### Lekcja #30: Floor, nie Round

Leverage używa `Math.floor` — 2.8x staje się 2x, nie 3x. Celowo. Przy dźwigni zawsze zaokrąglaj w DÓŁ. Zaokrąglanie w górę zwiększa ryzyko w marginalnych przypadkach. Na rynkach krypto, ten jeden x leverage w górę może być różnicą między przetrwaniem a likwidacją.

---

## Wiring: Dynamic Leverage + Vision SL do mm_hl.ts (03.02.2026)

### Problem: Kalkulator istnieje, ale nikt go nie słucha

Po stworzeniu `TokenRiskCalculator.ts` i wpięciu go w `SmAutoDetector.ts`, logi pokazywały piękne wartości: `leverage: '2x', visionSL: '11.2%'`. Ale to było jak sporządzenie recepty bez jej realizacji — **obliczenia istniały w logach, ale bot dalej używał sztywnego `process.env.LEVERAGE` i starego 15% hard stop**.

Trzeba było "wpić" te wartości w trzy miejsca w `mm_hl.ts` (główny silnik, ~9000 linii kodu):

### Zmiana 1: Dynamic Leverage przy rotacji par

**Plik:** `mm_hl.ts` linia ~4585
**Kontekst:** Gdy SM rotation wybierze nowe pary (co 4H lub flash rotation), bot ustawia leverage dla każdej pary na Hyperliquid.

```
PRZED:
  const targetLeverage = Number(process.env.LEVERAGE || 1)
  // Wszystkie pary dostają tę samą dźwignię — BTC, SOL, FARTCOIN = identycznie

PO:
  for (const pair of newPairs) {
    const riskParams = getTokenRiskParams(pair)
    const targetLeverage = riskParams?.recommendedLeverage ?? fallbackLeverage
    await setLeverage(pair, targetLeverage)
    // SOL → 2x, BTC → 2x, FARTCOIN → 1x — każdy wg swojego profilu ryzyka
  }
```

**Kluczowa decyzja:** Leverage ustawiamy TYLKO przy rotacji par, NIE co cykl (~90s). Dlaczego?

Zmiana leverage na otwartej pozycji zmienia cenę likwidacji. Wyobraź sobie, że masz SHORT SOL z 3x leverage. Nagle conviction spada, kalkulator mówi "zmniejsz do 1x". Jeśli to zrobimy w środku trade'u, margin requirements się zmienią. Na giełdach to może spowodować natychmiastową likwidację, jeśli akurat masz dużą pozycję blisko progu.

Bezpieczniej: ustaw leverage RAZ (przy wejściu), trzymaj go do wyjścia.

**Analogia:** Jak ustawianie lustra i fotela w samochodzie. Robisz to PRZED jazdą, nie na autostradzie przy 140 km/h.

### Zmiana 2: Vision SL — nowy blok w executeMultiLayerMM

**Plik:** `mm_hl.ts` linia ~6412 (po bloku "contrarian")
**Kontekst:** `executeMultiLayerMM()` to serce bota — wywoływane co ~90 sekund dla każdej aktywnej pary. Wewnątrz jest kilka systemów stop loss:

```
Hierarchia Stop Loss (od najwyższego priorytetu):

1. 🎯 Manual stopLossPrice (z tuning config)
   → Ręcznie ustawiony SL z DynamicConfig
   → Tylko dla CONTRARIAN pozycji

2. 🎯 VISION SL (NOWY — ATR-based)
   → Dynamiczny SL z TokenRiskCalculator
   → Działa na WSZYSTKIE pozycje (SM-aligned + contrarian)
   → Uruchamia się TYLKO gdy nie ma manual SL

3. 🛡️ PositionProtector (15% hard stop)
   → Ostatnia linia obrony
   → Zawsze aktywny, niezależnie od powyższych
```

Kluczowe: Vision SL jest umieszczony **PO** bloku contrarian (który ma manual SL) ale **PRZED** logiką grid/orderów. Działa na WSZYSTKIE pozycje — to ważne, bo stary manual SL chronił tylko pozycje contrarian. Pozycje SM-aligned (np. SHORT SOL gdy SM też shortują) nie miały żadnego SL oprócz globalnego 15% hard stop.

Teraz SOL SHORT z `visionSL: 11.2%` zostanie zamknięty zanim dotrze do 15% hard stop.

```typescript
// Nowy blok w executeMultiLayerMM — działa na KAŻDEJ pozycji
if (position && position.entryPrice) {
  const visionRisk = getTokenRiskParams(pair)
  const hasManualSl = overridesConfig?.stopLossPrice > 0

  if (visionRisk && !hasManualSl) {
    const slDistance = entryPx * visionRisk.visionSlPct
    const visionStopPrice = posSide === 'short'
      ? entryPx + slDistance    // SHORT: SL powyżej entry
      : entryPx - slDistance    // LONG: SL poniżej entry

    if (midPrice crossed visionStopPrice) {
      → closePositionForPair(pair, 'vision_sl')
      → return  // Wyjdź z executeMultiLayerMM — pozycja zamknięta
    }
  }
}
```

### Zmiana 3: getTokenRiskParams() — nowy getter w SmAutoDetector

**Plik:** `SmAutoDetector.ts`
**Problem:** `mm_hl.ts` potrzebowało `recommendedLeverage` i `visionSlPct`, ale nie miało jak je dostać. Istniejące gettery (`getAutoEmergencyOverrideSync`, `getSmDirection`) nie zwracają danych ryzyka.

Mogliśmy:
- **Opcja A:** Dodać pola do `getAutoEmergencyOverrideSync` → Zły pomysł. Ta funkcja zwraca `undefined` dla PURE_MM tokenów, a leverage/SL potrzebujemy dla WSZYSTKICH tokenów.
- **Opcja B:** Nowy dedykowany getter → Prosty, czysty, zawsze działa.

```typescript
export function getTokenRiskParams(token: string): {
  recommendedLeverage: number
  visionSlPct: number
} | undefined {
  const analysis = cachedAnalysis.get(token)
  if (!analysis) return undefined
  return { recommendedLeverage: analysis.recommendedLeverage, visionSlPct: analysis.visionSlPct }
}
```

Jedna funkcja, zero efektów ubocznych, sync (używa cache'u).

### Jak to wygląda w praktyce (live logi po deploy)

```
🤖 [SmAutoDetector] SOL: {
  rawShorts: '$114.68M',
  ratio: '103.62',
  mode: 'FOLLOW_SM_SHORT',
  leverage: '2x',          ← TokenRiskCalculator obliczył
  visionSL: '11.2%'        ← ATR-based, ciaśniejszy niż stary 15%
}

🚨 [SM ROTATION] FLASH ROTATION — new >$10M imbalance detected
[SM Auto-Select] Capital Dominance Leaders:
   SOL: 🟥 SHORT $113.6M net | Engine: -42.65
   BTC: 🟥 SHORT $108.6M net | Engine: -42.65
   ETH: 🟥 SHORT $25.6M net | Engine: -35.65
[SM ROTATION] Locked pairs for 4H: SOL, BTC, ETH

🎯 [DYNAMIC LEV] SOL: 2x (conviction+vol) | Vision SL: 11.2%
🎯 [DYNAMIC LEV] BTC: 2x (conviction+vol) | Vision SL: 11.2%
🎯 [DYNAMIC LEV] ETH: 2x (conviction+vol) | Vision SL: 11.2%
```

A gdy SL uderzy (hipotetycznie):
```
🎯 [VISION SL] SOL HIT! Price $225.40 reached ATR stop $224.80
    (11.2% from entry $201.30) | SHORT | PnL: -11.9% | CLOSING...
✅ [VISION SL] SOL position closed at $225.40
```

### Cały flow od danych do egzekucji

```
whale_tracker.py (co 15-30 min)
  → /tmp/smart_money_data.json
    → SmAutoDetector.loadAndAnalyzeAllTokens()
      → analyzeTokenSm() per token
        → SignalEngine.analyze() → mode, conviction
        → TokenRiskCalculator.calculateLeverage() → 1-5x
        → TokenRiskCalculator.calculateVisionSlPercent() → 0-15%
      → getTopSmPairs(3) → 4H lock, flash rotation
        → mm_hl.ts applyRotationPairs()
          → setLeverage(pair, recommendedLeverage)  ← NOWE
    → executeMultiLayerMM() co ~90s per pair
      → Vision SL check (entry ± visionSlPct)      ← NOWE
        → if triggered: closePositionForPair('vision_sl')
      → Grid generation (bid/ask multipliers)
      → Order placement
```

### Lekcja #31: "Calculate once, enforce everywhere"

`TokenRiskCalculator` oblicza wartości RAZ w `analyzeTokenSm()`. Potem te wartości żyją w `TokenSmAnalysis` i są dostępne przez `getTokenRiskParams()`. Nie ma duplikacji obliczeń — jeden kalkulator, wiele konsumentów:

- `SmAutoDetector` → loguje leverage i SL w analizie tokena
- `mm_hl.ts` rotation → czyta `recommendedLeverage` do `setLeverage()`
- `mm_hl.ts` execution → czyta `visionSlPct` do sprawdzenia SL

Gdybyśmy obliczali leverage w jednym miejscu a SL w innym, z czasem parametry by się rozjechały (różne wersje volatility, inne progi). Centralizacja zapewnia spójność.

**Analogia:** Jak centralny system dowodzenia w NATO. Jeden ośrodek wydaje rozkazy (TokenRiskCalculator), różne jednostki je wykonują (rotation, execution). Gdyby każda jednostka sama obliczała strategię, miałbyś chaos.

### Lekcja #32: "Silent success, loud failure"

Vision SL nie loguje nic w normalnej pracy. Logi pojawiają się TYLKO gdy SL zostanie trafiony. To celowe — w systemie tradingowym masz setki cykli na minutę. Logowanie "SL OK" co cykl zaśmieciłoby logi tak, że prawdziwe alarmy byłyby niewidoczne.

Pattern: normalny przebieg = cicho. Problem = głośno. Tak działa dobry monitoring.

**Anty-pattern:** Logowanie wszystkiego "na wszelki wypadek". W produkcyjnym bocie z 3 parami × 90s cyklami × 24h = ~2880 wpisów dziennie PER PAR. Razy 3 pary = 8640 linii "SL OK". Nikt tego nie przeczyta.

### Lekcja #33: "Rotation-time vs cycle-time decisions"

Nie wszystkie decyzje powinny być podejmowane z tą samą częstotliwością:

| Decyzja | Częstotliwość | Dlaczego |
|---------|--------------|----------|
| **Leverage** | Co rotację (4H) | Zmiana leverage na otwartej pozycji = ryzyko. Ustaw raz. |
| **Vision SL** | Co cykl (90s) | SL musi reagować natychmiast na cenę. Opóźnienie = strata. |
| **Pair selection** | Co 4H (z flash override) | Zbyt częsta rotacja = churn, prowizje, slippage. |
| **Grid orders** | Co cykl (90s) | Rynek się zmienia, grid musi nadążać. |

Kluczowa intuicja: **im większe konsekwencje decyzji, tym rzadziej ją podejmuj**. Zmiana leverage to "duża" decyzja (wpływa na liquidation price). Sprawdzenie SL to "mała" decyzja (nie zmienia nic, jeśli cena jest OK). Złe dopasowanie częstotliwości do wagi decyzji to klasyczny błąd.

### Lekcja #34: "Priority chains need escape hatches"

Hierarchia SL: manual > Vision SL > PositionProtector (15%). Ale co gdy Vision SL jest zbyt ciasny? Co gdy kalkulator volatility się myli i SL wynosi 5% na tokenie który regularnie robi 7% dzienne wahania?

Dlatego `hasManualSl` sprawdzany jest PIERWSZY. Jeśli ustawisz ręczny `stopLossPrice` w tuning config, Vision SL zostaje pominięty. To "escape hatch" — możesz nadpisać algorytm ręcznie w każdym momencie.

A na samym końcu jest PositionProtector z 15% hard stop — nawet jeśli Vision SL zawiedzie (bug w kalkulatorze, brak danych), 15% złapie katastrofę.

**Analogia:** Systemy bezpieczeństwa w samolocie. Pilot może ręcznie sterować (manual SL). Autopilot reaguje na warunki (Vision SL). Ale nawet jeśli oba zawiodą, jest fizyczny ogranicznik przeciążenia (PositionProtector). Trzy warstwy, każda niezależna.

---

## Risk-Based Position Sizing — "Kwatermistrz" (03.02.2026)

### Problem: Jednakowy budżet, nierówne ryzyko

Bot dawał każdemu tokenowi taki sam `capitalPerPair` — np. $5000. Brzmi sprawiedliwie? Nie jest.

```
Token A (SOL):  $5000 pozycja × 11.3% SL = $565 ryzyko na trade
Token B (LIT):  $5000 pozycja × 15.0% SL = $750 ryzyko na trade

Różnica: 33% WIĘCEJ ryzyka na LIT niż na SOL.
Przy tych samych pieniądzach.
```

To tak, jakby każdy żołnierz dostał identyczny plecak na wyprawę — bez względu na to, czy idzie w góry czy na plażę. Żołnierz w górach (LIT) niesie 33% więcej ciężaru (ryzyka) niż żołnierz na plaży (SOL), mimo że obaj mają "ten sam budżet".

### Rozwiązanie: Normalizacja dollar-risk

Jedna elegancka formuła:

```
maxPosition = (accountEquity × riskPerTradePct) / visionSlPct
```

Rozbijmy to na części:
- **accountEquity** = ile masz na koncie ($12,372)
- **riskPerTradePct** = ile % chcesz zaryzykować na jeden trade (5%)
- **visionSlPct** = Vision SL tego tokena (11.3% dla SOL, 15% dla LIT)

```
SOL: ($12,372 × 5%) / 11.3% = $5,474 max pozycja
     → Dollar risk: $5,474 × 11.3% = $618

LIT: ($12,372 × 5%) / 15.0% = $4,124 max pozycja
     → Dollar risk: $4,124 × 15.0% = $618

Identyczny dollar risk: $618 na OBA tokeny. 🎯
```

Memecoin z szerokim SL (15%) dostaje MNIEJSZĄ pozycję. Major z ciasnym SL (11.3%) dostaje WIĘKSZĄ. Ale ryzyko w dolarach jest takie samo. To jest esencja risk management — nie "ile kupuję", ale "ile mogę stracić".

### Gdzie to siedzi w pipeline

```
upstream multipliers → MarketVision → RISK CAP (nowy) → inventorySkew → grid
                                          ↑
                                    OSTATNI CAP
                                    Nic powyżej nie
                                    może go przekroczyć
```

Risk Cap jest umieszczony CELOWO jako **ostatni filtr** przed gridów. To znaczy:
- MarketVision może powiększyć pozycję (1.25x trend confidence) ✅
- Adaptive sizing może zwiększyć (1.5x) ✅
- Ale ŻADEN z nich nie przebije limitu risk cap ❌

Analogia: to jak limit na karcie kredytowej. Możesz kupować co chcesz, ale powyżej limitu — odmowa. Nie ważne ile razy klikniesz "kup".

### Graceful fallback — "Kwatermistrz nie blokuje, gdy nie ma danych"

```typescript
const riskParams = getTokenRiskParams(pair)
if (riskParams && this.positionRiskManager) {
  // Risk cap aktywny — mamy dane SM i equity
} else {
  // Brak danych? Skip. Stare zachowanie.
}
```

Dwa warunki muszą być spełnione:
1. `getTokenRiskParams(pair)` zwraca dane (SmAutoDetector ma analizę tego tokena)
2. `positionRiskManager` istnieje (bot zna swoje equity)

Jeśli którykolwiek brakuje — risk cap nie działa, a `capitalPerPair` przepływa bez zmian. Zero ryzyka awarii przy starcie bota lub brakujących danych.

### Konfiguracja

Jeden env var: `RISK_PER_TRADE_PCT` (default: `0.05` = 5%)

- **5%** = konserwatywne. Przy $12K equity ryzykujesz max $618 na trade.
- **10%** = agresywne. $1,237 na trade.
- **2%** = ultra-safe. $247 na trade.

Zmiana nie wymaga restartu kodu — env var czytany co cykl.

### Weryfikacja (live logi)

```
[RISK SIZING] LIT: Cap $6418 -> $4124 (equity=$12372 x 5% / 15.0% SL)
```

Czytamy: "LIT chciał $6418 pozycję, ale Risk Cap ograniczył do $4124 (bo equity $12,372 × 5% ryzyka / 15% SL = $4,124)."

Matematyka się zgadza: $12,372 × 0.05 / 0.15 = $4,124. ✅

### Lekcja #35: "Equal Risk, Not Equal Capital"

To jest fundamentalna zasada zarządzania portfelem. Prawdziwe fundusze hedgingowe nie dają $1M na każdą pozycję — dają **tyle, żeby ryzyko było jednakowe**.

Wyobraź sobie, że masz 10 pozycji w portfelu. 5 z nich to majors (BTC, ETH, SOL) z 11% SL, 5 to altcoiny (LIT, FARTCOIN) z 15% SL. Jeśli dajesz każdej $5000:

```
Najgorszy scenariusz (wszystkie SL trafione):
  Majors:  5 × $5000 × 11% = $2,750 strata
  Altcoiny: 5 × $5000 × 15% = $3,750 strata
  RAZEM: $6,500

Altcoiny stanowią 57.7% straty mimo że to "połowa portfela".
```

Z risk-based sizing:
```
  Majors:  5 × $5,474 × 11.3% = $3,093 strata
  Altcoiny: 5 × $4,124 × 15.0% = $3,093 strata
  RAZEM: $6,186

Każda strona = dokładnie 50%. Portfel jest ZBALANSOWANY pod kątem ryzyka.
```

### Lekcja #36: "Last Word Architecture"

Risk Cap siedzi na końcu łańcucha celowo. To wzorzec "Last Word" — ostatni filtr w pipeline ma prawo weta nad wszystkim powyżej.

Alternatywa (zła): umieścić risk cap PRZED MarketVision. Wtedy MarketVision mogłoby powiększyć pozycję powyżej risk-normalized limitu. "Trend jest silny, daj 1.25x!" → $5,155 na LIT zamiast $4,124. Dollar risk = $773 zamiast $618. Risk normalizacja złamana.

**Zasada:** Filtr bezpieczeństwa ZAWSZE na końcu pipeline. Nigdy na początku, nigdy w środku. Jak zawór bezpieczeństwa w rurociągu — musi być na samym końcu, bo inaczej ciśnienie za nim może dalej rosnąć.

### Lekcja #37: "Infinity as Safe Default"

```typescript
if (visionSlPct <= 0 || accountEquity <= 0) return Infinity
```

Gdy dane są brakujące lub błędne, `calculateRiskBasedMaxPosition()` zwraca `Infinity`. To znaczy: "nie mam danych, nie nakładam limitu". Brzmi kontr-intuicyjnie? Ale to bezpieczne, bo:

1. `Infinity` nigdy nie jest mniejsze od `capitalPerPair` → warunek `capitalPerPair > riskBasedMax` jest false → cap nie działa
2. Stare zachowanie jest zachowane w 100%
3. Brak danych ≠ "ustaw limit 0" (co by zablokowało handel)

**Pattern:** W systemach bezpieczeństwa, "brak danych" powinien oznaczać "zachowaj status quo", nie "zablokuj wszystko" (chyba że konsekwencje są katastrofalne). Risk cap to optymalizacja, nie ochrona krytyczna. PositionProtector (15% hard stop) to ochrona krytyczna — ON nigdy nie zwraca Infinity.

---

## POPCAT PURE_MM — "Symetryczny Market Maker" (04.02.2026)

### Problem: Bot zarabia tylko na kierunkowych ruchach SM

Cały dotychczasowy system był zbudowany wokół jednej idei: **podążaj za Smart Money**. Gdy wieloryby shortują — shortuj. Gdy flipną na long — flipnij. To działało świetnie na LIT, FARTCOIN, HYPE.

Ale jest drugi sposób na zarabianie: **klasyczny market making**. Nie obchodzi Cię kierunek — stawiasz zlecenia po obu stronach order booka i łapiesz spread. Zarabiasz na różnicy między ceną kupna a sprzedaży. Brak wieloryba potrzebnego.

### Dlaczego POPCAT?

Jerry chciał dodać stock perps (TSM, HOOD) do bota. Okazało się, że **Nansen AI halucynował** — symbole `xyz:TSM` i `cash:HOOD` nie istnieją na Hyperliquid. Te prefixy to wewnętrzna konwencja Nansena, nie prawdziwe tickery na giełdzie.

Po sprawdzeniu **wszystkich 228 perpów** przez Hyperliquid API znaleźliśmy POPCAT — memecoin na Solanie z idealnym profilem do MM:

| Metryka | Wartość | Dlaczego dobre dla MM? |
|---------|---------|------------------------|
| **24h Volume** | ~$3.1M | Wystarczający flow do łapania spreadów |
| **Open Interest** | ~$2M | Umiarkowane — nie za duży, nie za mały |
| **Max Leverage** | 3x | Pozwala na 3x kapitał, ale nie zachęca do hazardu |
| **Funding** | 0.00125% | Neutralny — brak dużego kosztu trzymania pozycji |
| **Price** | ~$0.057 | Niski nominał = szDecimals:0 (całe tokeny, brak frakcji) |

### Lekcja z "Nansen AI halucynacji"

To jest ważna lekcja: **zawsze weryfikuj dane u źródła**. Nansen AI podał symbole `xyz:TSM` i `cash:HOOD` jako istniejące na Hyperliquid. Brzmiało wiarygodnie — podał nawet wolumen, liczbę traderów, mark price. Wszystko sfabrykowane.

```
┌─────────────────────────────────────────────────────────────┐
│  NANSEN AI: "cash:HOOD ma $8.6M volume, 66 traderów"      │
│                                                             │
│  HYPERLIQUID API: "Nie ma takiego symbolu."                │
│                                                             │
│  LEKCJA: AI halucynuje. API nie halucynuje.                │
│          Zawsze: curl > AI opinion.                         │
└─────────────────────────────────────────────────────────────┘
```

Sprawdziliśmy każdy endpoint:
- `metaAndAssetCtxs` (228 perpów) — brak TSM, brak HOOD
- `spotMetaAndAssetCtxs` (437 tokenów) — brak TSM, HOOD to crypto token za $0.17 (nie Robinhood stock)
- `allMids` (506 entries) — zero tokenów z prefiksem `cash:` czy `xyz:`
- Pre-launch `@N` tokeny (277 rynków) — żaden nie mapuje się do TSM

Stock tokeny które **faktycznie istnieją**: NVDA, TSLA, AAPL, GOOGL, AMZN, META, MSFT, ORCL, AVGO, MU — ale tylko jako **spot pairs** (`@N`), nie perpy. Bot handluje perpami.

### Architektura: Jak POPCAT wchodzi do systemu

POPCAT działa w trybie **PURE_MM** — fundamentalnie innym niż SM-following tokeny jak LIT czy FARTCOIN. Oto różnica:

```
┌─────────────────────────────────────────────────────────────┐
│  SM-FOLLOWING (LIT, FARTCOIN, HYPE)                        │
│                                                             │
│   whale_tracker → SmAutoDetector → SignalEngine             │
│                                                             │
│   "SM shortuje? → My shortujemy."                          │
│   Bid×0.00, Ask×1.50 (one-sided)                           │
│   Diamond Hands: SL=12%, TP=50%                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  PURE_MM (POPCAT, BTC, SOL, ETH)                           │
│                                                             │
│   MarketVision → Grid Generator → Both Sides               │
│                                                             │
│   "Spread 42bps? → Bidy i aski symetrycznie."             │
│   Bid×1.00, Ask×1.00 (two-sided)                           │
│   Inventory management: skew adjustment ±15bps             │
│   SL=1.5%, no TP target (ciągłe łapanie spreadów)         │
└─────────────────────────────────────────────────────────────┘
```

### Cztery pliki, cztery zmiany

| Plik | Co dodano | Dlaczego |
|------|-----------|----------|
| `SmAutoDetector.ts` | `TOKEN_VOLATILITY_CONFIG['POPCAT']` | SL=1.5%, maxLev=3, ATR mult=2.5 (wysoka zmienność memecoina) |
| `mm_hl.ts` | `INSTITUTIONAL_SIZE_CONFIG.POPCAT` | min=$15, target=$50, max=$150 per child order |
| `mm_hl.ts` | Per-token leverage override (`${pair}_LEVERAGE` env) | POPCAT_LEVERAGE=3 w `.env` |
| `market_vision.ts` | `NANSEN_TOKENS['POPCAT']` + `activePairs` | chain='hyperliquid' (bypass kill switch), 42bps spread, $11K max position |

### Problem #1: Rotacja ignorowała POPCAT

Po pierwszym deploy POPCAT nie pojawiał się w logach. Dlaczego?

```
ROTATION_MODE=sm  →  getTopSmPairs(3)  →  BTC, SOL, ETH
                                           ↑
                                    Brak POPCAT! Nie ma SM danych.
```

Bot w trybie `sm` wybiera pary na podstawie Smart Money imbalance. POPCAT nie ma danych SM (to PURE_MM), więc nigdy nie wejdzie do rotacji SM.

`MANUAL_ACTIVE_PAIRS` nie pomagał — jest ignorowany gdy `ROTATION_MODE=sm`.

**Fix:** `STICKY_PAIRS=POPCAT` w `.env`. Sticky pairs są **zawsze** dodawane do listy aktywnych, niezależnie od trybu rotacji:

```typescript
// applyRotationPairs() — sticky pairs mają priorytet:
const merged: string[] = []
for (const p of stickyPairs) {        // ← POPCAT wchodzi PIERWSZY
  if (!merged.includes(p)) merged.push(p)
}
for (const p of desiredPairs) {       // ← Potem SM pairs (BTC, SOL, ETH)
  if (!merged.includes(p)) merged.push(p)
}
```

Log po fix:
```
🧲 Sticky pairs: POPCAT
📊 Allowed pairs (rotation + sticky): POPCAT, BTC, SOL, ETH (count=4/6)
```

### Problem #2: Leverage ustawiał się na 1x zamiast 3x

`getTokenRiskParams('POPCAT')` zwracał `undefined` (brak danych SM w cache), więc bot fallbackował do globalnego `LEVERAGE=1` z `.env`.

**Fix:** Per-token leverage override w env:

```typescript
// Przed (fallback do globalnego 1x):
const targetLeverage = riskParams?.recommendedLeverage ?? fallbackLeverage

// Po (sprawdź env per-token najpierw):
const perTokenLev = Number(process.env[`${pair}_LEVERAGE`] || 0)
const targetLeverage = perTokenLev > 0
  ? perTokenLev
  : (riskParams?.recommendedLeverage ?? fallbackLeverage)
```

Teraz `POPCAT_LEVERAGE=3` w `.env` → POPCAT dostaje 3x, reszta bez zmian.

### Problem #3: Kill Switch blokował POPCAT

Nansen Pro kill switch sprawdza on-chain flows. POPCAT jest perpem na Hyperliquid — nie ma on-chain flows do sprawdzenia. Bez ochrony, kill switch mówił: "token appears dead" i blokował handel.

**Fix (już wbudowany):** `chain: 'hyperliquid'` w `NANSEN_TOKENS` automatycznie omija flow-based kill switch:

```typescript
if (chain === 'hyperliquid') {
  console.log(`[NansenPro] ${label}: Hyperliquid perp - skipping flow-based kill switch`)
  return { spreadMult: 1.0, pause: false }
}
```

### Parametry POPCAT (tuning)

```
┌─────────────────────────────────────────────────────────────┐
│  POPCAT PURE_MM — Ultra Aggressive                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Base Spread:        42 bps (0.42%)                        │
│  Min Spread:         25 bps (0.25%)                        │
│  Max Spread:         90 bps (0.90%) — extreme vol          │
│                                                             │
│  Base Order Size:    $1,000 per level                      │
│  Max Position:       $11,000 (92% of $12k equity)          │
│  Leverage:           3x                                     │
│  Stop Loss:          1.5%                                   │
│                                                             │
│  SM Adjustments:     OFF (smFlowSpreadMult = 1.0)          │
│  Directional Skew:   0.0 (neutral, no bias)                │
│  Inventory Skew:     1.5x (aggressive rebalancing)         │
│                                                             │
│  Grid: 8 buy levels + 8 sell levels, symmetric             │
│  Refresh: Every cycle (~30s)                               │
│                                                             │
│  Kill Switch:        Bypassed (chain='hyperliquid')        │
│  Rotation:           Sticky (always active)                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Env vars na serwerze

```bash
FORCE_MM_PAIRS=BTC,SOL,ETH,POPCAT    # Wymusza PURE_MM mode
STICKY_PAIRS=POPCAT                    # Zawsze aktywny, niezależnie od SM rotacji
MAX_ACTIVE_PAIRS=6                     # Podniesione z 5 żeby zmieścić POPCAT
POPCAT_LEVERAGE=3                      # 3x leverage (HL max dla POPCAT)
```

### Jak monitorować POPCAT

```bash
# Sprawdź czy POPCAT jest aktywny
ssh hl-mm 'pm2 logs mm-bot --lines 500 --nostream' | grep POPCAT

# Grid orders (bidy i aski)
ssh hl-mm 'pm2 logs mm-bot --lines 500 --nostream' | grep "ML-GRID.*POPCAT"

# Leverage
ssh hl-mm 'pm2 logs mm-bot --lines 500 --nostream' | grep "DYNAMIC LEV.*POPCAT"

# Fills (zrealizowane zlecenia)
ssh hl-mm 'pm2 logs mm-bot --lines 500 --nostream' | grep "POPCAT.*FILL\|fill.*POPCAT"

# Sticky pair confirmation
ssh hl-mm 'pm2 logs mm-bot --lines 500 --nostream' | grep "Sticky"
```

### Data flow — od startu do orderów

```
PM2 restart mm-bot --update-env
    ↓
FORCE_MM_PAIRS=...,POPCAT loaded
STICKY_PAIRS=POPCAT loaded
POPCAT_LEVERAGE=3 loaded
    ↓
SmAutoDetector.isForcedMmPair('POPCAT') = true
    ↓
getAutoEmergencyOverrideSync('POPCAT') → mode: PURE_MM
    → bidMultiplier: 1.0, askMultiplier: 1.0 (both sides)
    ↓
ROTATION_MODE=sm → getTopSmPairs(3) → BTC, SOL, ETH
    ↓
applyRotationPairs() → merge STICKY_PAIRS first
    → POPCAT, BTC, SOL, ETH (4/6)
    ↓
setLeverage('POPCAT', 3)  ← POPCAT_LEVERAGE env override
    ↓
executeMultiLayerMM('POPCAT')
    → MarketVision: 42bps base spread
    → SIGNAL_ENGINE_OVERRIDE: FORCE BOTH SIDES
    → NansenPro: skipping kill switch (chain='hyperliquid')
    → Grid: 8 buy + 8 sell, symmetric around mid
    ↓
Orders submitted to Hyperliquid
    → buy  384 POPCAT @ $0.0572
    → buy  385 POPCAT @ $0.0571
    → sell 384 POPCAT @ $0.0574
    → sell 385 POPCAT @ $0.0575
    → ... (16 orders total)
```

### Lekcja #38: "Weryfikuj u źródła, nie u pośrednika"

Nansen AI (LLM) powiedział: "cash:HOOD istnieje na Hyperliquid, ma $8.6M volume". Brzmiało konkretne, z liczbami, z detalami. Był **całkowicie zmyślony**.

Jeden `curl` do prawdziwego API rozwiał iluzję w sekundę:

```bash
curl -s https://api.hyperliquid.xyz/info -X POST \
  -H "Content-Type: application/json" \
  -d '{"type":"metaAndAssetCtxs"}' | python3 -c "
import sys, json
data = json.load(sys.stdin)
names = [u['name'] for u in data[0]['universe']]
print('HOOD' in names)  # False
print('TSM' in names)   # False
print(len(names))        # 228
"
```

**Reguła:** Gdy budujesz system tradingowy, jedyne źródło prawdy to API giełdy. Nie Nansen, nie Twitter, nie ChatGPT. `curl` > opinia.

### Lekcja #39: "Sticky vs Rotated — dwa tryby życia para"

W bocie pary mają dwie ścieżki życia:

| Typ | Przykład | Jak wchodzi | Jak wychodzi |
|-----|----------|-------------|--------------|
| **Rotated** | BTC, SOL, ETH | SM analysis (Capital Dominance) | Automatycznie co 4H |
| **Sticky** | POPCAT | `STICKY_PAIRS` env | Nigdy (ręczne usunięcie) |

To ważne rozróżnienie, bo nie każdy token pasuje do SM-following. POPCAT nie ma SM danych — wieloryby go nie shortują/longują w ilościach które `whale_tracker.py` wykryje. Ale ma wystarczający wolumen żeby łapać spready. Inne narzędzie, inna strategia, ten sam bot.

### Lekcja #40: "Per-token config > Global defaults"

Globalny `LEVERAGE=1` był bezpiecznym defaultem ale blokował POPCAT na 1x gdy chciałeś 3x. Zamiast zmieniać globalny default (co wpłynęłoby na wszystkie pary), dodaliśmy per-token override:

```
Priorytet: POPCAT_LEVERAGE (env) > getTokenRiskParams() (SM data) > LEVERAGE (global)
```

Ten pattern — `${TOKEN}_SOMETHING` env vars — to czysty sposób na per-token konfigurację bez zmiany kodu. Można dodać `BTC_LEVERAGE=5` czy `LIT_LEVERAGE=2` bez restartu logiki.

---

## LIT+FARTCOIN Focus — "Polowanie na grubą zwierzynę" (04.02.2026)

### Dlaczego zmiana z POPCAT?

POPCAT wyglądał obiecująco na papierze — $3.1M dziennego wolumenu, nice spread do łapania. W praktyce? **$0.35 dziennie**. Czemu?

```
┌─────────────────────────────────────────────────────────────┐
│  POPCAT Reality Check                                       │
│                                                             │
│  UTIL CAP bottleneck:                                       │
│    equity($12K) × utilization(0.65) × leverage(3x) / 4 pairs│
│    = $5,850 per pair                                         │
│                                                             │
│  ALE: CLIP_USD=22 → normalizeChildNotionals rebucketuje    │
│       do $22/order → 8 levels × $22 = $176 total           │
│                                                             │
│  $176 total position × 42bps spread × ~10 fills/day        │
│  = ~$0.35/day profit                                        │
│                                                             │
│  Target: $500/day                                           │
│  Reality: $0.35/day                                         │
│  Gap: 1,428x za mało 😅                                    │
└─────────────────────────────────────────────────────────────┘
```

Rozwiązanie? Przestać łapać grosze z market-makingu na niszowym memcoinie, i wrócić do core strategii — **SM-following na tokenach gdzie wieloryby mają naprawdę duże pozycje**.

LIT: SM $11M SHORT. FARTCOIN: SM $5.4M SHORT. To jest "gruba zwierzyna".

### Pięć warstw bottlenecków — "Cebula z problemami"

To była najtrudniejsza sesja debugowania tego bota. Nie dlatego że był jeden duży bug — dlatego że było **pięć** małych bugów, nałożonych na siebie jak warstwy cebuli. Naprawiasz jeden, a pod spodem jest następny.

```
┌─────────────────────────────────────────────────────────────┐
│  WARSTWA 1: INSTITUTIONAL_SIZE_CONFIG                       │
│  Problem: target=$25/order (domyślne)                       │
│  Fix: target=$200/order dla LIT/FARTCOIN                    │
│  Status: ✅ Naprawione → ale ordery dalej $22...            │
├─────────────────────────────────────────────────────────────┤
│  WARSTWA 2: normalizeChildNotionals (rebucketing)           │
│  Problem: Funkcja ignorowała per-token config i używała    │
│           globalnego CLIP_USD=$22 jako target               │
│  Fix: Math.max(GLOBAL_CLIP, pairSizeCfg.targetUsd)         │
│  Status: ✅ Naprawione → ordery teraz $200! Ale LIT 0...   │
├─────────────────────────────────────────────────────────────┤
│  WARSTWA 3: UTIL CAP leverage                               │
│  Problem: const leverage = 2 (hardcoded!)                   │
│           LIT/FARTCOIN mają 5x w env ale UTIL CAP ignorował│
│  Fix: Czyta ${pair}_LEVERAGE z env                          │
│  Status: ✅ Naprawione → ale capital dalej za mały...       │
├─────────────────────────────────────────────────────────────┤
│  WARSTWA 4: capitalMultiplier double-apply                  │
│  Problem: DynamicConfig squeeze (cap×0.38) nakładany       │
│           na ALREADY-reduced baseOrderSizeUsd              │
│  Fix: Capital floor 0.80 dla STICKY_PAIRS                   │
│  Status: ✅ Naprawione → FARTCOIN działa! Ale LIT blocked..│
├─────────────────────────────────────────────────────────────┤
│  WARSTWA 5: LIT HARD_BLOCK + stale EMERGENCY_OVERRIDES     │
│  Problem: Stara instrukcja "stop adding shorts to LIT"     │
│           z tygodnia temu blokował aski. Plus              │
│           maxInventoryUsd=$2000 (zbyt niskie)               │
│  Fix: Usunięto HARD_BLOCK. maxInventory 2000→10000         │
│  Status: ✅ Naprawione → LIT + FARTCOIN = $200/order! 🎉  │
└─────────────────────────────────────────────────────────────┘
```

### Order Sizing Pipeline — "Droga zlecenia przez biurokrację"

Każde zlecenie przechodzi przez 5 warstw, z których każda może je zmniejszyć:

```
capitalBase ($12,372 equity)
    │
    ▼
MarketVision tuning: baseOrderSizeUsd = $2,000
    │
    ▼
RISK SIZING: min(tuning, equity × riskPct / SL%)
    │
    ▼
UTIL CAP: equity × utilization × leverage / numPairs
    = $12,372 × 0.65 × 5 / 4 = $10,053 (teraz z 5x lev!)
    │
    ▼
capitalMultiplier (DynamicConfig squeeze)
    × 0.80 (min floor dla STICKY_PAIRS, było 0.38)
    │
    ▼
Grid generation: 8 levels × $200/level = $1,600
    │
    ▼
normalizeChildNotionals: rebucket do $200 (per-token, nie $22)
    │
    ▼
Size sanity check: OK ($200 < $400 limit)
    │
    ▼
🏦 Orders submitted to Hyperliquid → ok=1
```

### Kluczowe zmiany w kodzie

**1. INSTITUTIONAL_SIZE_CONFIG (mm_hl.ts)**

```typescript
LIT: {
  minUsd: 50,       // vs $15 poprzednio
  targetUsd: 200,   // vs $25 → 8x bigger orders
  maxUsd: 500,
  maxUsdAbs: 5000   // $5K max total per token
},
FARTCOIN: {
  minUsd: 50,
  targetUsd: 200,
  maxUsd: 500,
  maxUsdAbs: 5000
},
```

**2. Rebucketing fix (mm_hl.ts)**

```typescript
// PRZED: Zawsze używał globalnego CLIP_USD ($22)
gridOrders = normalizeChildNotionals(gridOrders, { targetUsd: GLOBAL_CLIP })

// PO: Per-token sizing
const pairSizeCfg = INSTITUTIONAL_SIZE_CONFIG[pair]
const rebucketTarget = pairSizeCfg
  ? Math.max(GLOBAL_CLIP, pairSizeCfg.targetUsd)  // $200 for LIT/FARTCOIN
  : GLOBAL_CLIP                                     // $22 fallback
```

**3. Capital floor (mm_hl.ts)**

```typescript
const stickyPairs = (process.env.STICKY_PAIRS || '').split(',')
  .map(s => s.trim()).filter(Boolean)

if (stickyPairs.includes(pair) && capitalMultiplier < 0.80) {
  console.log(`💪 [CAPITAL FLOOR] ${pair}: cap×${capitalMultiplier} → cap×0.80`)
  capitalMultiplier = 0.80  // Focus pairs get priority capital
}
```

**4. LIT HARD_BLOCK usunięty (dynamic_config.ts)**

```typescript
// STARE — blokował aski gdy auto-detect cache pusty (co drugi cykl!)
if (token === 'LIT' && !isFollowSmShort) {
  askMultiplier: 0, askLocked: true  // 💀 Zabijał zlecenia
}

// NOWE — tylko log, zero blokowania
if (token === 'LIT' && isFollowSmShort) {
  console.log(`🦅 LIT: FOLLOW_SM_SHORT → aggressive shorting enabled`)
}
```

### Env vars na serwerze

```bash
FORCE_MM_PAIRS=BTC,ETH              # PURE_MM mode (obie strony)
STICKY_PAIRS=LIT,FARTCOIN           # Focus pairs — zawsze aktywne, cap floor 0.80
MAX_ACTIVE_PAIRS=4                  # BTC, ETH + LIT, FARTCOIN
LIT_LEVERAGE=5                      # 5x leverage (HL max)
FARTCOIN_LEVERAGE=5                 # 5x leverage
MANUAL_ACTIVE_PAIRS=LIT,FARTCOIN    # Fallback dla manual mode
```

### Jak monitorować LIT+FARTCOIN

```bash
# Grid i ordery
ssh hl-mm 'pm2 logs mm-bot --lines 500 --nostream' | grep -E "LIT|FARTCOIN" | grep -E "ML-GRID|CAPITAL FLOOR|submitted"

# Czy capital floor działa
ssh hl-mm 'pm2 logs mm-bot --lines 500 --nostream' | grep "CAPITAL FLOOR"

# Leverage
ssh hl-mm 'pm2 logs mm-bot --lines 500 --nostream' | grep -E "DYNAMIC LEV.*(LIT|FARTCOIN)"

# Fills (zarobki!)
ssh hl-mm 'pm2 logs mm-bot --lines 1000 --nostream' | grep -E "(LIT|FARTCOIN).*(FILL|fill)"

# Sprawdź sizing — ile USD per order
ssh hl-mm 'pm2 logs mm-bot --lines 500 --nostream' | grep -E "rebucket|INSTITUTIONAL.*LIT|INSTITUTIONAL.*FARTCOIN"
```

### Lekcja #41: "Sizing Chain — 5 warstw cebuli"

W systemie tradingowym, rozmiar zlecenia nie jest jedną liczbą. To **pipeline** przez który przepływa kalkulacja, i każda warstwa może ją zmniejszyć:

```
Chcesz: $200/order
Config mówi: $200 ✅
Rebucketing mówi: $22 ❌ (globalny CLIP_USD)
UTIL CAP mówi: $3,900 ✅ (ale z leverage=2 zamiast 5!)
capitalMultiplier mówi: ×0.38 ❌ (squeeze analysis)
HARD_BLOCK mówi: ×0 ❌ (stale override)
```

Żeby znaleźć bottleneck, musisz przejść **cały pipeline** i sprawdzić każdą warstwę. Pierwszy fix to nie koniec — pod nim może być następny blocker. W naszym przypadku było 5 takich warstw.

**Reguła:** Gdy coś nie działa w systemie z wieloma warstwami abstrakcji, nie zakładaj że znalezienie jednego buga = problem rozwiązany. Weryfikuj end-to-end po każdym fixie.

### Lekcja #42: "Stale overrides to ciche zabójcy"

LIT HARD_BLOCK i EMERGENCY_OVERRIDES z maxInventoryUsd=$2000 to były instrukcje sprzed 2 tygodni — "stop adding shorts to LIT". Ale sytuacja się zmieniła, a kod tego nie wiedział.

```
Tydzień 1: "Nie shortuj LIT!" → HARD_BLOCK aktywny ✅
Tydzień 2: LIT staje się focus pair → HARD_BLOCK nadal aktywny ❌
           Bot: "Dlaczego LIT ma 0 orderów?"
           My: "WTF? Config wygląda dobrze..."
           *3 godziny debugowania*
           My: "O kurwa, HARD_BLOCK z zeszłego tygodnia!"
```

**Reguła:** Hardcoded overrides powinny mieć expiry date lub być tagged z datą + powodem. Gdy zmieniasz strategię, **przejrzyj WSZYSTKIE hardcoded overrides** w dynamic_config.ts i mm_hl.ts.

### Lekcja #43: "Capital floor — priorytet zasobów"

Squeeze analysis (DynamicConfig) mówi cap×0.38 — "mamy za dużo otwartych pozycji, zmniejsz alokację". To generalnie dobra logika. Problem: dla focus pairs (LIT/FARTCOIN) nie chcesz żeby automatyczny safety mechanism zredukował Ci capital do $600 na tokena gdy celujesz w $500/day.

Rozwiązanie: **Capital floor** — minimum capitalMultiplier dla STICKY_PAIRS. Nie wyłączamy squeeze analysis (to chroni przed blowup), ale stawiamy podłogę na 80% alokacji dla priorytetowych par.

To jest pattern znany z zarządzania zasobami w systemach operacyjnych: `nice` / `cgroups` w Linuxie pozwalają ustawić priorytety procesów. Tu robimy to samo z kapitałem tradingowym.

---

---

## Hourly Discord Report (05.02.2026)

### Co to jest?

Skrypt `scripts/hourly-discord-report.ts` -- samodzielny program, ktory co godzine wysyla na Discorda snapshot Twojego bota: ile fills bylo, jakie pozycje trzymasz, ile orderow czeka, jaki PnL. Cos jak pulse check -- patrzysz na telefon i wiesz, czy bot dziala.

### Dlaczego osobny skrypt, a nie czesc bota?

Wyobraz sobie szpital. Maszyna do podtrzymywania zycia (bot) i monitor pracy serca (raport) to dwa oddzielne urzadzenia. Jezeli monitor sie zepsuje, pacjent nadal zyje. Jezeli maszyna sie wylaczy, monitor Ci o tym powie (0 fills = cos jest nie tak).

To jest **Unix philosophy** w praktyce: male, wyspecjalizowane narzedzia ktore robia jedna rzecz dobrze. Bot handluje. Skrypt raportuje. Nie mieszamy.

### Jak to dziala?

```
PM2 Cron (co godzine o :00)
  |
  v
hourly-discord-report.ts
  |
  +-- userFillsByTime()      --> fills z ostatniej godziny
  +-- openOrders()           --> resting orders teraz
  +-- clearinghouseState()   --> pozycje + equity
  |       (wszystko rownolegle -- Promise.all)
  v
Formatowanie -> POST na Discord webhook
```

Skrypt jest **read-only** -- uzywa tylko `InfoClient`, nie potrzebuje klucza prywatnego. Czyta publiczne dane konta z adresu w `.env`.

### Lekcja #44: "Promise.all -- rownolegle zapytania"

Mamy 3 niezalezne zapytania do API. Mozemy je wyslac:
- **Sekwencyjnie**: 200ms + 200ms + 200ms = 600ms
- **Rownolegle**: max(200ms, 200ms, 200ms) = 200ms

```typescript
const [fills, orders, state] = await Promise.all([
  info.userFillsByTime({ user, startTime: oneHourAgo }),
  info.openOrders({ user }),
  info.clearinghouseState({ user }),
]);
```

Regula: jezeli operacje nie zaleza od siebie (wynik jednej nie jest potrzebny drugiej), **zawsze** rownoleglij. To jest jedno z najlatwiejszych usprawnien wydajnosci w async kodzie.

### Lekcja #45: "Discord webhooks -- najprostsze API na swiecie"

Wiekszosci ludzi wydaje sie, ze integracja z Discordem wymaga tworzenia bota, OAuth, tokenow, bibliotek. Webhook to dosłownie jeden POST request:

```typescript
await fetch(webhookUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: "wiadomosc" }),
});
```

Webhook URL zawiera autentykacje I cel (kanal) w jednym stringu. Zero konfiguracji. Dlatego Discord webhooks sa idealnym rozwiazaniem dla "chce szybko dostac notyfikacje gdzies".

### Lekcja #46: "Hyperliquid zwraca stringi, nie liczby"

Kazda wartosc z API (`px`, `sz`, `closedPnl`, `fee`, `accountValue`) to string: `"1.4913"` a nie `1.4913`. Musisz `parseFloat()` zanim zrobisz matematyke.

Dlaczego? Floating point. `0.1 + 0.2 = 0.30000000000000004` w JavaScript. W finansach kazdy cent sie liczy, wiec API zwraca precise stringi ktore Ty sam konwertujesz. To standardowa praktyka w financial APIs.

### Lekcja #47: "PM2 --cron z --no-autorestart"

PM2 normalnie restartuje proces gdy sie zakonczy (to dobre dla serwerow ktore powinny byc zawsze wlaczone). Ale dla one-shot skryptow to katastrofa -- bez `--no-autorestart` skrypt uruchamiałby sie w nieskonczonosc:

```
run -> exit -> restart -> exit -> restart -> ...
```

Z `--no-autorestart` + `--cron "0 * * * *"`:
```
:00 run -> exit -> czekaj -> :00 run -> exit -> czekaj -> ...
```

### Co moze pojsc nie tak?

1. **API Hyperliquid down**: Skrypt crashuje, PM2 nie restartuje (no-autorestart), nastepna proba za godzine. OK.
2. **0 fills**: To informacja, nie blad. Znaczy: rynek cichy, albo bot ma problem.
3. **Discord rate limit**: 30 wiadomosci/min. Jedna na godzine = zero ryzyka.

### Pliki

| Plik | Zmiana |
|------|--------|
| `scripts/hourly-discord-report.ts` | NOWY |
| `.env` | Dodano `DISCORD_WEBHOOK_URL` |
| PM2 | Nowy proces `hourly-report` z cron `0 * * * *` |

---

## kPEPE Custom 4-Layer Grid + Inventory Management (05.02.2026)

### Problem: Generyczny grid nie pasuje do kPEPE

Wyobraz sobie, ze prowadzisz stoisko z wymiana walut na bazarze. Wczesniej miałeś jedna tabliczke z cenami kupna i sprzedazy -- jak wszyscy inni. Kazdy token dostal ten sam 5-warstwowy grid (20/30/45/65/90 bps) pomnozony przez UNHOLY TRINITY (×2.0 w calm, ×6.0 w volatile). L1 ladowalo na 40 bps minimum -- daleko od mid price.

kPEPE ma $23.6M dziennego wolumenu. High Balance traderzy robia $70-100k co kilka minut w scalpingu. Token Millionaire i wieloryby robia $280-450k mega-trade'y. Przy 40 bps od mid, te drobne scalpy nas omijaly. Przy mega-trade'ach, nasz L4 na 90bps × 6.0 = 540 bps (5.4%!) byl absurdalnie daleko.

Potrzebowalismy **czterech tabliczek**, kazdej na inna okazje.

### Rozwiazanie: 4 warstwy z wlasnymi spreadami

```
Cena mid: $0.003900

L1 Scalping  | <-- 5 bps -->  |   $0.003898 -- $0.003902   (10% kapitalu)
L2 Core      | <-- 14 bps --> |   $0.003895 -- $0.003905   (24% kapitalu)
L3 Buffer    | <-- 28 bps --> |   $0.003889 -- $0.003911   (30% kapitalu)
L4 Sweep     | <-- 55 bps --> |   $0.003879 -- $0.003921   (20% kapitalu)
Rezerwa: 16% niezaalokowane

             <---- BID ----------- MID ----------- ASK ---->
```

**Dlaczego akurat takie spready?**

- **L1 (5 bps)**: Lapie scalpowanie High Balance traderow. Mala stawka ($500 = 10%), szybkie obroty. Ryzyko adverse selection jest male, bo to male ordery.
- **L2 (14 bps)**: Chleb powszedni -- matchuje `baseSpreadBps: 14` z market_vision tuning. Wiekszosc tradingowej aktywnosci laduje tutaj.
- **L3 (28 bps)**: Najwieksza alokacja (30% = $1,500) bo fillowana regularnie bez duzego ryzyka. Srodek drogi -- nie za blisko mid, nie za daleko.
- **L4 (55 bps)**: Lapie mega-trade'y i sweep'y. Kiedy ktos paniczny sprzedaje market orderem, cena przesuwa sie o 50-100 bps. L4 kupuje z premia.
- **Rezerwa (16%)**: Wolna gotowka na rebalancing. Nie alokowana do zadnej warstwy.

### Architektura: Trzy pliki, jeden pipeline

```
market_vision.ts
  "Mapa" -- tuning tokena (spread caps, inventory skew mult)
  kPEPE: baseSpread=14bps, min=5bps, max=60bps, inventorySkewMult=2.0
         |
         | tuning config flows down
         v
mm_hl.ts
  "Mozg" -- decyzje: ile, gdzie, kiedy
  1. Oblicz inventory skew + time decay
  2. Oblicz sizeMultipliers (bid/ask scaling)
  3. Oblicz time-of-day spread adjustment
  4. Wywolaj generateGridOrdersCustom()
  5. Layer removal jesli skew > 40%
         |
         | custom layers + multipliers
         v
grid_manager.ts
  "Rece" -- generuje konkretne zlecenia
  generateGridOrdersCustom() --> 16 zlecen (4 warstwy x 2 strony x 2 per side)
```

### GridLayer vs GridOrder -- Blueprint vs Product

To kluczowe rozroznienie ktore latwo pomylić.

**`GridLayer`** to **przepis** -- mowi "warstwa L1 ma byc 5 bps od mid, dostaje 10% kapitału, 2 zlecenia na strone":

```typescript
// CONFIG (input)
{ level: 1, offsetBps: 5, capitalPct: 10, ordersPerSide: 2, isActive: true }
```

**`GridOrder`** to **gotowe danie** -- konkretne zlecenie do wyslania na gielde:

```typescript
// ORDER (output)
{ layer: 1, side: 'bid', price: 0.003898, sizeUsd: 125, units: 32051.3 }
```

Jedna `GridLayer` z `ordersPerSide: 2` produkuje do **4** `GridOrder` (2 bidy + 2 aski). Cztery warstwy = do 16 zlecen.

### generateGridOrdersCustom() vs generateGridOrders()

Dodalismy nowa metode zamiast modyfikowac istniejaca, bo:

1. **Bezpieczenstwo** -- stary kod dziala dla FARTCOIN, LIT, HYPE, ETH, BTC. Jedna zmiana i psujesz 5 par naraz.
2. **Czytelnosc** -- `if (pair === 'kPEPE')` w mm_hl.ts jest jasne. Zagiezdzone `if` wewnatrz istniejacego generatora to spaghetti.
3. **Kluczowa roznica** -- nowa metoda *naprawde stosuje* `sizeMultipliers`.

```typescript
// STARY (generateGridOrders): sizeMultipliers IGNOROWANE
const orderSizeUsd = layerCapital / (layer.ordersPerSide * 2)
// <-- zawsze ta sama wartosc, niezaleznie od inventory

// NOWY (generateGridOrdersCustom): sizeMultipliers APLIKOWANE
const orderSizeUsdBase = layerCapital / (layer.ordersPerSide * 2)
const bidOrderSize = orderSizeUsdBase * sizeMultipliers.bid  // <-- skalowane!
const askOrderSize = orderSizeUsdBase * sizeMultipliers.ask  // <-- skalowane!
```

Stary `generateGridOrders()` mial parametr `_sizeMultipliers` z podkreslnikiem -- to konwencja TypeScript oznaczajaca "parametr istnieje ale nie jest uzywany". Tygodniami bot obliczal piekne sizeMultipliers, przekazywal je do GridManagera... i GridManager je ignorowal.

To jest **Open/Closed Principle** -- kod jest otwarty na rozszerzenie (nowa metoda) ale zamkniety na modyfikacje (stara dziala jak dotad).

### UNHOLY TRINITY -- Dlaczego kPEPE wyszedl

```typescript
// STARY:
const unholyTrinity = ['FARTCOIN', 'HYPE', 'LIT', 'kPEPE'];
// Calm: x2.0 na WSZYSTKIE warstwy
// Volatile: x6.0 na WSZYSTKIE warstwy

// NOWY:
const unholyTrinity = ['FARTCOIN', 'HYPE', 'LIT'];
// kPEPE zarzadza swoja zmiennoscia sam
```

Problem: mnoznik jest **jednolity**. L1 na 5 bps x 2.0 = 10 bps. OK. L4 na 55 bps x 6.0 = 330 bps. Absurd. UNHOLY TRINITY nie rozumie koncepcji "rozne warstwy, rozne cele".

kPEPE teraz zarzadza zmiennoscia przez: time-of-day multiplier (lekka korekta) + naturalnie rozna szerokosc warstw (L1=5bps, L4=55bps). Nie potrzebuje mlota.

### Time-of-Day Spread Adjustment

```
UTC:  02  04  06  08  10  12  14  16  18  20  22  00  02
      |==========|  |==========|  |=================|  |==|
      Low (0.85x)   Standard(1.0) Peak (1.15x)         Cool
                                                       (1.0)
```

- **02-08 UTC** (noc Azji, wczesna Europa): wolumen spada, book cienki. Tighter = wiecej fillow.
- **08-14 UTC** (Europa + wczesna Ameryka): normalny wolumen, standardowe spready.
- **14-22 UTC** (szczyt Ameryki, wieczor Europy): najwieksza aktywnosc. Wider = mniej adverse selection.
- **22-02 UTC** (cool-down): powrot do normy.

Analogia: restauracja obniża ceny w happy hour (malo klientow) i podnosi w piatkowy wieczor (kuchnia nie nadaza).

### Inventory Management -- Trzy Linie Obrony

#### Linia 1: Size Skewing (ciagla, zawsze aktywna, prog >10%)

Kiedy masz za duzo kPEPE (long heavy):

| Inventory | Bid Size | Ask Size | Co sie dzieje |
|-----------|----------|----------|---------------|
| 0% | 100% | 100% | Symetrycznie |
| +15% | ~78% | ~123% | Lekko przesuniete |
| +25% | ~63% | ~138% | Wyraznie przesuniete |
| +40% | 40% | 160% | Agresywnie -- prawie nie kupujesz |

Formula:
```typescript
skewFactor = min(absSkew / 0.40, 1.0)    // 0->1 over 10-40%
bid = bid x (1.0 - skewFactor x 0.6)     // 100%->40%
ask = ask x (1.0 + skewFactor x 0.6)     // 100%->160%
```

#### Linia 2: Time-Based Inventory Decay (progresywna, eskaluje z czasem)

Problem: co jesli masz 20% skew i size skewing dziala, ale fillow po prostu nie ma? Siedzisz z tym skewem minute, 5 minut, 30 minut...

Im dluzej trzymasz skew, tym bardziej bot go "wzmacnia". 20% skew trzymany 30 minut jest traktowany jak ~25% skew.

| Czas trzymania | Mnoznik | Efektywny skew (przy real 20%) |
|----------------|---------|-------------------------------|
| 0-5 min | 1.0x | 20% -> bid 70%, ask 130% |
| 5-15 min | 1.1x | 22% -> bid 67%, ask 133% |
| 15-30 min | 1.25x | 25% -> bid 63%, ask 138% |
| 30-60 min | 1.5x | 30% -> bid 55%, ask 145% |
| >60 min | 2.0x | 40% -> bid 40%, ask 160% |

Technicznie: module-level state sledzi kiedy skew pierwszy raz przekroczyl 10% i w jakim kierunku. Kiedy skew zmieni kierunek (long->short) albo spadnie ponizej 10%, timer resetuje sie.

```typescript
const kpepeSkewState = {
  skewStartTime: 0,    // kiedy skew > 10%
  lastSkewSign: 0,     // +1 long, -1 short, 0 neutral
}
```

**Dlaczego module-level a nie class property?** kPEPE to jedyny token z tym mechanizmem. Dodawanie property do klasy `HyperliquidMM` (ktora zarzadza wszystkimi parami) byloby over-engineering. Prosty obiekt na poziomie modulu jest czysty i czytelny.

**Dlaczego cap na 1.5?** Bez capu, 40% skew x 2.0 time decay = skewFactor 2.0 → bid = 1.0 - 2.0×0.6 = **-0.2** (ujemny!). Cap na 1.5 daje minimum bid = 10%, ask = 190%. Nadal agresywny, ale sensowny.

#### Linia 3: Layer Removal (nuklearna, >40% skew)

Kiedy dwie poprzednie linie nie wystarcza i skew przekracza 40%:

```
Skew > +40% (LONG heavy):
  -> Usun WSZYSTKIE L1-L2 bidy (przestań kupowac na bliskich warstwach)
  -> Zostaw L3-L4 bidy (daleko od mid, bezpieczne)
  -> Aski na wszystkich warstwach (sprzedawaj!)

Skew < -40% (SHORT heavy):
  -> Analogicznie -- usun L1-L2 aski
```

Dlaczego L1-L2 a nie L3-L4? Bo L1-L2 sa najblizej mid price -- najbardziej narazone na adverse selection. Kiedy masz 40% long i cena spada, **ostatnie** czego chcesz to kupowac jeszcze wiecej po cenie blisko mid.

L3-L4 zostaja, bo jesli ktos filluje Twojego bida na L4 (55 bps od mid), to jest duze odchylenie -- prawdopodobnie mean reversion nastapi.

Analogia wojskowa: wycofujesz zolnierzy z pierwszej linii frontu do drugiej. Nie uciekasz z pola bitwy (to byloby zamkniecie WSZYSTKICH bidow), ale cofasz sie na bezpieczniejsza pozycje.

### Pelny pipeline -- krok po kroku

Zalozmy: kPEPE, godzina 15:00 UTC, skew +25% trzymany 25 minut.

```
1. TIME DECAY
   skew +25% > prog 10% -> sign = +1
   Trwa od 25 minut -> timeDecayMult = 1.25

2. SIZE MULTIPLIERS
   rawSkewFactor = 0.25 / 0.40 = 0.625
   skewFactor = min(0.625 x 1.25, 1.5) = 0.78
   sizeMultipliers.bid = 1.0 x (1.0 - 0.78x0.6) = 0.53
   sizeMultipliers.ask = 1.0 x (1.0 + 0.78x0.6) = 1.47

3. CLAMP
   bid 0.53 -> max(0.25, min(2.5, 0.53)) = 0.53 OK
   ask 1.47 -> max(0.25, min(2.5, 1.47)) = 1.47 OK

4. TIME-OF-DAY
   15:00 UTC -> timeMult = 1.15 (peak hours)

5. GRID GENERATION (generateGridOrdersCustom)
   L1: 2 bids ($125 x 0.53 = $66) + 2 asks ($125 x 1.47 = $184)
   L2: 2 bids ($300 x 0.53 = $159) + 2 asks ($300 x 1.47 = $441)
   L3: 2 bids ($375 x 0.53 = $199) + 2 asks ($375 x 1.47 = $551)
   L4: 2 bids ($250 x 0.53 = $133) + 2 asks ($250 x 1.47 = $368)
   Total: 16 zlecen

6. LAYER REMOVAL
   |skew| = 25% < 40% -> nie usuwamy
   Wynik: 16 zlecen (bez zmian)
```

Gdyby skew wynosil 45%:
```
6. LAYER REMOVAL
   |skew| = 45% > 40% -> AKTYWACJA
   actualSkew > 0 (long heavy) -> usun L1-L2 bidy
   Usunieto: 4 zlecenia (2xL1 + 2xL2 bidy)
   Wynik: 12 zlecen (4 bidy na L3-L4 + 8 askow)
```

### Zmiany w plikach

| Plik | Co sie zmienilo |
|------|-----------------|
| `src/utils/grid_manager.ts` | +`generateGridOrdersCustom()` -- nowa metoda z sizeMultipliers |
| `src/mm_hl.ts` | +`KPEPE_GRID_LAYERS`, +`getKpepeTimeMultiplier()`, +`kpepeSkewState` + `getKpepeTimeDecayMult()`, +enhanced skew z time decay, +layer removal >40%, +kPEPE branch w grid generation, -kPEPE z UNHOLY TRINITY, -kPEPE z LOW-LIQ EXPANSION, INSTITUTIONAL_SIZE_CONFIG maxUsd 200->300 maxUsdAbs 2000->5000 |
| `src/signals/market_vision.ts` | kPEPE tuning: baseSpread 15->14, minSpread 14->5, maxSpread 15->60, inventorySkewMult 1.3->2.0 |

### Lekcja #48: "_sizeMultipliers -- Parametr Duch"

W oryginalnym `generateGridOrders()` parametr mial podkreslnik: `_sizeMultipliers?`. To konwencja TypeScript oznaczajaca "wiem ze istnieje, celowo nie uzywam". Przez tygodnie bot obliczal piekne sizeMultipliers w mm_hl.ts, przekazywal je do GridManagera... a GridManager je ignorowal. Zamowienia zawsze mialy ten sam rozmiar niezaleznie od inventory.

**Zawsze sprawdz czy parametr jest faktycznie *uzyty* w ciele funkcji, nie tylko *przyjety* w sygnaturze.** TypeScript nie ostrzeze Cie ze nie uzywasz optional parametru.

### Lekcja #49: "Jednolite mnozniki to zly pomysl dla wielowarstwowych systemow"

UNHOLY TRINITY aplikowal x2.0 (lub x6.0) uniform na caly grid. L1 na 5 bps x 6.0 = 30 bps (OK). L4 na 55 bps x 6.0 = 330 bps (absurd). Kazda warstwa ma inny cel -- scalping (L1), sweep (L4) -- i potrzebuje innego traktowania.

Jesli budujesz system z warstwami, kazda warstwa powinna miec sens niezaleznie od globalnego mnoznika. "Multiplier hell" to moment w ktorym global scaling niszczy lokalne zachowanie.

### Lekcja #50: "Czas trzymania to tykajaca bomba"

Bez time decay, bot z 20% long skew zachowywal sie tak samo po 1 minucie i po 60 minutach. Ale ryzyko rosnie z czasem -- im dluzej trzymasz skew, tym wieksze prawdopodobienstwo ze rynek pojdzie przeciw Tobie.

To pattern znany z risk management: "stale positions are ticking bombs". Dotyczy nie tylko inventory w tradingu -- jesli Twoj system trzyma jakis stan (cache, lock, polaczenie), pytaj sie "co sie stanie jesli to trwa 10x dluzej niz oczekiwalem?".

### Lekcja #51: "Escalation ladder -- nie strzelaj od razu z armaty"

Trzy linie obrony (size skew -> time decay -> layer removal) to wzorzec "progressive enhancement". Kazdy poziom ma jasny prog:
- Size skew: >10% inventory
- Time decay: >5 minut trzymania
- Layer removal: >40% inventory

Nie zamykasz calej pozycji od razu. Zaczynasz od delikatnego przesuniecia, potem nasilasz. To samo dotyczy alertow (info -> warn -> error), rate limiting (throttle -> backoff -> circuit break), i degradacji uslug (reduce features -> maintenance mode -> shutdown).

### Weryfikacja po deploy

```bash
# Logi PM2 -- szukaj kPEPE
ssh hl-mm 'pm2 logs mm-bot --lines 100 | grep "kPEPE"'

# Grid powinien pokazac bids=8 asks=8 (lub mniej po layer removal)
# Szukaj: [kPEPE GRID] 4-layer custom: bids=8 asks=8

# Time decay -- po 15+ minutach z pozycja
# Szukaj: [kPEPE SKEW] inventory=25.0% held=15.3min decay x1.25

# Layer removal -- przy duzej pozycji (>40% kapitalu)
# Szukaj: [kPEPE LAYER_REMOVAL] skew=45.0% -> removed 4 L1-L2 bids

# Spread check -- L1 ordery ~5 bps od mid
# Przy mid $0.0039: bid ~$0.003898, ask ~$0.003902
```

---

*Ostatnia aktualizacja: 2026-02-05*
*Autor: Claude (z pomoca Jerry'ego)*
