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

*Ostatnia aktualizacja: 2026-02-02*
*Autor: Claude (z pomocą Jerry'ego)*
