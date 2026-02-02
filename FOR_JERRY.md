# FOR JERRY: The Hyperliquid Smart Money Bot

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
| `GENERALS_OVERRIDE` | Nuclear Button | Przycisk nuklearny | Wymusza FOLLOW_SM_SHORT niezależnie od innych sygnałów |

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
│   GENERALS_OVERRIDE     │ │   SignalEngine      │ │   HARD_BLOCK        │
│   (Nuclear option)      │ │   (The General)     │ │   (The Gatekeeper)  │
└─────────────────────────┘ └─────────────────────┘ └─────────────────────┘
```

**Zasada:** Wyższy priorytet ZAWSZE wygrywa. Nie próbuj być mądrzejszy od Generała.

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

*Ostatnia aktualizacja: 2026-02-02*
*Autor: Claude (z pomocą Jerry'ego)*
