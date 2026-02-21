# FOR JERRY — Jak dziala ten bot i czego sie z niego nauczylismy

> "Nie grasz przeciwko rynkowi. Grasz przeciwko innym graczom. Sztuczka polega na tym, zeby wiedziec kto jest najlepszym graczem przy stole i robic dokladnie to co on."

---

## Spis tresci

1. [Co to w ogole jest?](#co-to-w-ogole-jest)
2. [Architektura — wielka mapa](#architektura--wielka-mapa)
3. [Warstwy systemu](#warstwy-systemu)
4. [Skad bot wie co robic?](#skad-bot-wie-co-robic)
5. [Kluczowe pliki i co robia](#kluczowe-pliki-i-co-robia)
6. [Ewolucja strategii — od Market Makera do Swing Tradera](#ewolucja-strategii)
7. [Diamond Hands — psychologia i matematyka](#diamond-hands)
8. [Bugi, katastrofy i lekcje](#bugi-katastrofy-i-lekcje)
9. [Jak mysla dobrzy inzynierowie](#jak-mysla-dobrzy-inzynierowie)
10. [Daily Whale Report — Rentgen portfeli wielorybow](#daily-whale-report--rentgen-portfeli-wielorybow)
11. [Slowniczek](#slowniczek)

---

## Co to w ogole jest?

Wyobraz sobie, ze siedzisz w kasynie. Przy stole pokerowym siedzi 30 graczy. Wiekszosci z nich nie znasz. Ale czterech z nich to legendarni zawodowcy — Nansen (taki "poker tracker" dla krypto) potwierdza, ze ci goscie zarobili lacznie $80M+ na tradingu.

Twoj bot to **szpieg, ktory patrzy im w karty** i robi dokladnie to co oni.

Konkretnie:
- **Hyperliquid** to gielda krypto (perpy/futures) — mozesz tam shortowac i longowac z dzwignia
- **Bot** sklada zlecenia na tej gieldzie automatycznie
- **Nansen** to narzedzie analityczne ktore etykietuje portfele ("Smart Money", "Fund", "Whale")
- **whale_tracker.py** co 15-30 minut sprawdza co robia wieloryby i mowi botowi: "Shortuj LIT bo Smart Money shortuja"

Bot nie probuje byc madrzejszy od rynku. Bot probuje byc **cieniem najlepszych graczy**.

---

## Architektura — wielka mapa

```
                    DANE WEJSCIOWE
                    ==============

  [Hyperliquid API]     [Nansen API]      [Telegram]
   (darmowe!)            (platne)          (alerty)
        |                    |                 |
        v                    v                 v
  whale_tracker.py     nansen_pro.ts    nansen_alert_parser_v2.ts
  (snapshot co 15min)  (flow data)      (SM INFLOW/OUTFLOW)
        |                    |                 |
        v                    v                 v
  /tmp/smart_money_    market_vision.ts  /tmp/nansen_mm_
  data.json            (spread tuning)   signal_state.json
        |                    |                 |
        +--------------------+-----------------+
                             |
                             v
                    MOZG BOTA (mm_hl.ts)
                    ====================
                             |
            +----------------+----------------+
            |                |                |
            v                v                v
     SmAutoDetector    SignalEngine      DynamicConfig
     (tryb tradingu)   (General)        (parametry)
            |                |                |
            +----------------+----------------+
                             |
                             v
                      ZLECENIA NA GIELDZIE
                      ====================
                      Hyperliquid Perps API
                      (buy/sell orders)
                             |
                             v
                    +--------+--------+
                    |                 |
                    v                 v
              TelemetryServer    AlertManager
              (monitoring)       (Telegram/Slack)
```

### Jak to czytac?

1. **Gora** = skad bierzemy dane (3 zrodla)
2. **Srodek** = mozg ktory przetwarza dane i podejmuje decyzje
3. **Dol** = akcje (zlecenia) + monitoring

To jest jak lancuch dowodzenia w armii:
- **Wywiad** (whale_tracker, Nansen) — zbiera informacje
- **Sztab Generalny** (SignalEngine) — analizuje i decyduje
- **Zolnierze** (grid orders) — wykonuja rozkazy
- **Lacznosc** (Telemetry, Alerts) — raportuja co sie dzieje

---

## Warstwy systemu

### Warstwa 1: Zbieranie danych

#### whale_tracker.py — "Wywiad wojskowy"

To jest serce calego systemu. Co 15-30 minut (cron):

1. Bierze liste ~30 adresow wielorybow
2. Dla kazdego pyta Hyperliquid API: "Jakie masz otwarte pozycje?"
3. Wazy je: `final_weight = rozmiar_pozycji x wiarygodnosc_Nansen`
4. Produkuje 2 pliki JSON ktore bot czyta

**Kluczowy insight:** Nie kazdy wieloryb jest rowny. Facet z $50M pozycja ale bez weryfikacji Nansen dostaje wage 0.30. Smart Money z $10M ale potwierdzony przez Nansen dostaje 1.0. Czyli **zweryfikowany SM ma 3.5x wiekszy wplyw**.

To jak roznica miedzy plotka z baru a raportem wywiadu — obydwie moga byc prawdziwe, ale jednemu ufasz bardziej.

#### Nansen Pro (nansen_pro.ts) — "Satelita szpiegowski"

Platne API Nansen dostarcza:
- **Token flows** — ile tokenow wplynelo/wyplynelo z gield
- **Kill switch** — jesli token "umiera" (zero flow), blokuje trading
- **Spread tuning** — dostosowuje spread na podstawie aktywnosci SM

#### Telegram Alerts (nansen_alert_parser_v2.ts) — "Goraca linia"

Alerty z dashboardu Nansen przychodzace przez Telegram:
- **SM OUTFLOW** (SM sprzedaje spot, shortuje perpy) — sygnal SHORT
- **SM INFLOW** (SM kupuje spot, longuje perpy) — sygnal LONG

### Warstwa 2: Mozg

#### mm_hl.ts — "Centrum dowodzenia" (~9500 linii!)

To jest GLOWNY plik. Robi wszystko:
- Czyta dane z whale_tracker
- Uruchamia SignalEngine
- Buduje grid zlecen (multi-layer market making)
- Zarzadza pozycjami (stop loss, take profit)
- Obsluguje rotacje par (ktore coiny tradujemy)
- Monitoring i alerty

Dlaczego taki duzy? Bo w tradingu wszystko jest polaczone ze wszystkim. Zmiana spreadu wplywa na pozycje, pozycja wplywa na ryzyko, ryzyko wplywa na sizing, sizing wplywa na grid... To nie jest CRUD aplikacja gdzie mozesz ladnie podzielic na microservices.

#### SignalEngine — "General"

Najwazniejsza klasa decyzyjna. Patrzy na:
- Co mowia wieloryby? (whale_tracker data)
- Jaki jest trend? (7-dniowa historia)
- Czy SM zarabiaja czy traca? (uPnL)

I wydaje rozkaz:
- `FOLLOW_SM_SHORT` — shortuj agresywnie (bid x0, ask x1.5)
- `FOLLOW_SM_LONG` — longuj agresywnie (bid x1.5, ask x0)
- `PURE_MM` — normalny market making (obie strony)

**General moze overridowac WSZYSTKO** — nawet HARD_BLOCK (straznika).

#### SmAutoDetector — "Analityk wywiadu"

Czyta `/tmp/smart_money_data.json` i tlumaczy go na jezyk bota:
- "SM sa 5.5x bardziej SHORT niz LONG na LIT"
- "Confidence: 85%"
- "Mode: FOLLOW_SM_SHORT"

#### DynamicConfig — "Kwatymistrz"

Dostosowuje parametry w czasie rzeczywistym:
- Spread (wezszy = wiecej tradow, ryzyko; szerszy = mniej tradow, bezpieczenstwo)
- Size multipliers (ile $ na zlecenie)
- HARD_BLOCK (calkowita blokada tradingu na danym coinie)
- Capital allocation (ile kasy na ktory coin)

### Warstwa 3: Wykonanie

Bot ustawia **grid zlecen** — wielowarstwowy zestaw buy i sell orderow:

```
Cena:  $1.05  <-- Sell Level 4 (najdalej)
       $1.04  <-- Sell Level 3
       $1.03  <-- Sell Level 2
       $1.02  <-- Sell Level 1 (najblizej)
       $1.00  <-- Aktualna cena (mid)
       $0.98  <-- Buy Level 1 (najblizej)
       $0.97  <-- Buy Level 2
       $0.96  <-- Buy Level 3
       $0.95  <-- Buy Level 4 (najdalej)
```

W trybie `FOLLOW_SM_SHORT`:
- Wszystkie Buy levels — **WYLACZONE** (bid x0)
- Sell levels — **WZMOCNIONE** (ask x1.5)
- Efekt: bot TYLKO shortuje, nie kupuje

### Warstwa 4: Monitoring

- **TelemetryServer** (port 8082) — health check, status bota
- **AlertManager** — alerty na Telegram/Slack
- **PM2** — process manager, restartuje bota jesli padnie

---

## Skad bot wie co robic?

Najlepsza analogia to **lancuch dowodzenia wojskowego**:

```
POZIOM STRATEGICZNY (whale_tracker.py — co 15-30 min)
  "SM maja $11M short vs $1.7M long na LIT = SHORTUJ"
                    |
                    v
POZIOM OPERACYJNY (SignalEngine — co 60s)
  "Confidence 85%, ratio 5.5x = FOLLOW_SM_SHORT"
                    |
                    v
POZIOM TAKTYCZNY (Grid Orders — co 60s)
  "Bid x0.00, Ask x1.50, 8 sell levels, $200/order"
                    |
                    v
WYKONANIE (Hyperliquid API)
  "Place 8 sell orders at $X.XX"
```

### Priorytet decyzji (kto wygrywa konflikty):

1. **SignalEngine (General)** — NAJWYZSZY. Moze overridowac wszystko
2. **HARD_BLOCK (Straznik)** — blokuje trading, ale General moze obejsc
3. **REVERSAL/REGIME** — trend indicators, najnizszy priorytet

To jak w armii: rozkaz Generala jest wazniejszy niz regulamin straznika.

---

## Kluczowe pliki i co robia

| Plik | Linie | Rola | Analogia |
|------|-------|------|----------|
| `src/mm_hl.ts` | ~9500 | Glowny silnik — WSZYSTKO | Centrum dowodzenia |
| `whale_tracker.py` | ~2400 | Snapshot pozycji SM | Wywiad wojskowy |
| `src/mm/SmAutoDetector.ts` | ~300 | Czyta dane whale_tracker | Analityk wywiadu |
| `src/core/strategy/SignalEngine.ts` | ~500 | Decyzje tradingowe | General |
| `src/mm/dynamic_config.ts` | ~400 | Parametry dynamiczne | Kwatymistrz |
| `src/signals/market_vision.ts` | ~600 | Spread tuning, candle analysis | Snajper (precyzja) |
| `src/mm/kpepe_toxicity.ts` | ~400 | Detekcja toksycznego flow | System obronny |
| `scripts/vip_spy.py` | ~300 | Real-time monitoring 4 VIP whales | Szpieg |
| `src/signals/nansen_alert_parser_v2.ts` | ~400 | Parser alertow Nansen | Dekoder wiadomosci |
| `src/shadow/` | ~800 | Modul kopiowania SM trades | Nieaktywny (brak backendu) |
| `scripts/daily-whale-report.ts` | ~390 | Codzienny raport pozycji 57 wielorybow na Discord | Lornetka |

### Pliki danych (na serwerze):

| Plik | Producent | Konsument | Zawartosc |
|------|-----------|-----------|-----------|
| `/tmp/smart_money_data.json` | whale_tracker.py | SmAutoDetector.ts | Mode, confidence, pozycje SM |
| `/tmp/nansen_bias.json` | whale_tracker.py | mm_hl.ts | Bias 0-1 per coin |
| `/tmp/nansen_mm_signal_state.json` | alert_parser | SignalEngine | GREEN/YELLOW/RED |
| `/tmp/vip_spy_state.json` | vip_spy.py | (monitoring) | Pozycje 4 VIP whales |

---

## Ewolucja strategii

### Akt I: Market Maker (pazdziernik-grudzien 2025)

Bot zaczynal jako klasyczny market maker:
- Ustawiaj bidy i aski
- Lap spread 0.1-0.5%
- Szybko zamykaj pozycje
- Unikaj kierunkowego ryzyka

**Problem:** Na Hyperliquid spready sa mikroskopijne (2-5 bps na majors). Zarabiasz grosze a ryzyko jest duze — jeden ruch 1% i tracisz tydzien zarobkow.

To jak prowadzenie budki z lemonada na ulicy gdzie stoi 50 innych budek — kazdy obcina ceny az nikt nic nie zarabia.

### Akt II: Smart Money Follower (styczen 2026)

Rewolucja. Zamiast lapac spread, bot zaczal **podazac za wielorybami**:

```
STARY: "Kupuje po $100, sprzedaje po $100.05, zysk $0.05"
NOWY:  "SM shortuja LIT z $11M, ja tez shortuje i trzymam do -50%"
```

**Dlaczego to dziala?** Bo SM (Smart Money) wiedza wiecej niz my:
- Maja insiderskie informacje
- Maja lepsze modele
- Maja wiekszy kapital (self-fulfilling prophecy)
- Nansen ich weryfikuje — to nie sa randomy, to potwierdzeni zwyciezcy

### Akt III: Diamond Hands + Nuclear Fix (koniec stycznia 2026)

Problem: bot FOLLOW_SM_SHORT ale zamykal pozycje przy kazdym mini-odbiciu. Efekt: 100 malych strat zamiast jednego duzego zysku.

Rozwiazanie: **Diamond Hands**
- Stop Loss: 12% (duzy)
- Take Profit: 50% (bardzo duzy)
- Risk/Reward: 1:4.16
- Wymagany win rate: ~20%

Nuclear Fix: gdy bot jest w FOLLOW_SM_SHORT:
- `bidMultiplier = 0` — ZERO kupowania
- Position Reduce Logic — DISABLED
- Safety Bids — DISABLED

To jak powiedzenie: "Trzymam short do konca. Albo zarobie 50% albo strace 12%. Nic pomiedzy."

### Akt IV: Focus Pairs + Toxicity Engine (luty 2026)

Pivot na 2 coiny (LIT + FARTCOIN) z 5x leverage zamiast rozmywania kapitalu na 10 par.

Dodanie kPEPE Toxicity Engine — system detekcji toksycznego flow (ktos gra przeciwko nam):
- 8 sygnalow detekcji (rapid fills, sweeps, coordinated attacks)
- 10-zone time-of-day profiling (Asia low vs US open)
- Per-layer refresh rates (L1 co 60s, L4 co 300s)
- Automatyczny hedge gdy skew > 50%

---

## Diamond Hands

### Psychologia

Najwazniejsza lekcja z tego projektu nie jest techniczna. Jest psychologiczna.

**Paper Hands** (stary bot):
> "O nie, cena poszla 0.5% w gore! Zamykam short! O nie, teraz poszla 2% w dol. Powinienem byl trzymac..."

**Diamond Hands** (nowy bot):
> "SM maja $11M short. Ja mam short. Cena poszla 3% w gore? To szum. Trzymam do TP albo SL."

### Matematyka

```
Stop Loss:   12%
Take Profit: 50%
R:R Ratio:   1:4.16

Scenariusze na 10 tradow:
- 2 wygrane x 50% = +100%
- 8 przegranych x 12% = -96%
- Net: +4% (profitable nawet z 20% win rate!)
```

Porownaj ze starym botem:
```
SL: 2%, TP: 3%
R:R: 1:1.5

Scenariusze na 10 tradow:
- 6 wygranych x 3% = +18%
- 4 przegrane x 2% = -8%
- Net: +10% (ale wymaga 60% win rate!)
```

Diamond Hands wymaga mniejszego win rate bo kazda wygrana jest 4x wieksza od straty. Ale wymaga **zelaznej dyscypliny** — nie mozesz zamknac po -5% "bo sie boisz".

### Kiedy Diamond Hands dzialaja?

**TYLKO** gdy masz silne potwierdzenie fundamentalne:

```
SM Ratio > 5x    -->  Diamond Hands AKTYWNE
SM Ratio 2-5x    -->  Ostroznosc, mniejsza pozycja
SM Ratio < 2x    -->  Powrot do Paper Hands (klasyczny MM)
```

---

## Bugi, katastrofy i lekcje

### Katastrofa #1: Bitcoin OG Liquidation (-$128M, 31.01.2026)

Nasz najwiekszy wieloryb — Bitcoin OG (`0xb317d2bc...`) — mial $717M ETH LONG i zostal **zlikwidowany**. Stracil $128M jednego dnia.

| Coin | Fills | Wartosc | Closed PnL | Jak |
|------|-------|---------|-----------|-----|
| ETH | 1,266 | $292M | -$121.8M | **Liquidated Cross Long** |
| SOL | 734 | $18.9M | -$6.1M | Close Long |

**Lekcja:** Nawet "Smart Money" moze sie mylic. Nigdy nie kopiuj slepo. Bot ma SL 12% wlasnie dlatego — zeby nie skonczyc jak Bitcoin OG.

**Lekcja #2:** Musisz regularnie audytowac trackowane adresy. Po tym evencie 4 z 14 TIER 1 portfeli sa puste. Martwe adresy zaburzaja dane.

### Bug #2: HARD_BLOCK blokowal shorty (22.01)

SignalEngine mowil "SHORTUJ LIT!", ale HARD_BLOCK blokowal zlecenia.

**Przyczyna:** HARD_BLOCK nie sprawdzal czy SignalEngine jest w FOLLOW_SM_SHORT. Dwa systemy decyzyjne nie wiedzialy o sobie.

**Fix:** Dodano bypass — jesli General (SignalEngine) rozkazuje shortowac, Straznik (HARD_BLOCK) ustepuje.

**Lekcja:** W systemach z wieloma warstwami decyzyjnymi, **priorytet musi byc jasny i zaimplementowany**. Kto wygrywa gdy dwie warstwy sie nie zgadzaja? Zdecyduj z gory, nie w trakcie bugu produkcyjnego.

### Bug #3: Shadow Trading 404 spam (21.02)

Bot logowal `Trade feed error: HTTP 404` co 30 sekund. Przez 15 dni. Razem ~43,000 identycznych linii logow.

**Przyczyna:** `SHADOW_TRADING_ENABLED=true` ale serwer shadow trades nigdy nie zostal postawiony. Domyslny URL trafial w telemetry server ktory nie ma tego endpointu.

**Fix:** Wylaczenie w .env + rate limiting na error logi (1. + co 10. blad).

**Lekcja:** Nigdy nie wlaczaj feature flagow bez backendu. A jesli juz, dodaj rate limiting na error logi i hint jak wylaczyc. Nikt nie chce czytac 43,000 identycznych errorow.

### Bug #4: Telemetry Server nie startowal (24.01)

Port 8080 i 8081 zajete. Telemetry nie startowal. Zero monitoringu.

**Fix:** Retry logic — probuj portow 8080-8084, pierwszy wolny wygrywa.

**Lekcja:** Porty to ograniczony zasob. Jesli masz wiele serwisow na jednej maszynie, daj kazdemu konfigurowalne porty i fallback logic.

### Bug #5: VPIN stuck na 0.5 (05.02)

kPEPE Toxicity Engine mial VPIN ktore zawsze pokazywalo 0.5 (neutral). Nigdy nie wykazywal toksycznego flow.

**Przyczyna:** Domyslny bucket size $50K — ale kPEPE to memecoin z malym volume. Buckety nigdy sie nie zapelnialy wiec VPIN nie mial danych do analizy.

**Fix:** Zmiana na $500 buckets.

**Lekcja:** Parametry domyslne dzialaja dla mainstreamu. Dla niszowych assetow musisz je dostosowac. To jak uzycie wagi ciezarowkowej do wazenia listow — technicznie dziala, ale wynik zawsze bedzie "zero".

### Bug #6: Nansen AI halucynacje (04.02)

Probowalismy dodac stock perpow (TSM, HOOD). Nansen AI podsunelo symbole `xyz:TSM` i `cash:HOOD` ktore **nie istnieja** na Hyperliquid.

**Lekcja:** Zawsze weryfikuj dane z AI przez prawdziwe API. `curl` do gieldy jest jedynym zrodlem prawdy. AI halucynuje — API nie.

### Bug #7: whale_tracker nigdy nie wyzwalany (22.01)

`loadAndAnalyzeAllTokens()` bylo zaimplementowane ale **nigdy nie wywolywane** w mainLoop. Funkcja istniala, ale nikt jej nie uzyl. Bot mial martwy kod przez tygodnie.

**Lekcja:** Napisac funkcje to polowa roboty. Druga polowa to **wywolac ja w odpowiednim miejscu**. Reviewuj code paths (flow calego programu), nie tylko poszczegolne funkcje.

### Bug #8: HOLD_FOR_TP po rotacji tokenow (25.01)

Po zamianie VIRTUAL na HYPE w portfelu, 10+ miejsc w kodzie nadal mialo "VIRTUAL". HYPE pozycje byly zamykane zamiast trzymane do Take Profit.

**Fix:** Reczna zmiana w 13 miejscach (10 w mm_hl.ts, 3 w dynamic_config.ts).

**Lekcja:** Hardcoded token listy w 13 miejscach to proszenie sie o buga. Powinny byc w jednym configu. Ale — w tradingowym bocie gdzie kazda zmiana moze kosztowac $$, czasem lepiej miec explicit listy ktore latwo audytowac niz sprytna abstrakcja ktora moze zrobic cos niespodziewanego.

### Bug #9: Nansen Kill Switch falszywy alarm (25.01)

`FARTCOIN: token appears dead` — ale FARTCOIN mial $9M+ daily volume! Nansen API po prostu nie mial danych flow dla tego tokena na Solanie.

**Fix:** Whitelist `KNOWN_ACTIVE_TOKENS` — bypass kill switch dla tokenow o ktorych WIEMY ze sa aktywne.

**Lekcja:** "Brak danych" != "Token martwy". Systemy bezpieczenstwa musza rozrozniac miedzy "potwierdzony problem" a "brak danych do oceny".

---

## Jak mysla dobrzy inzynierowie

### 1. Strategia > Taktyka

Nasz bot mial AlphaEngine (real-time stream) i whale_tracker (snapshot co 15 min). Kiedy sie nie zgadzaly, musielismy zdecydowac: kto wygrywa?

**Odpowiedz: Strategia (whale_tracker) wygrywa.** Jesli wieloryby maja $11M short, a 3 portfele redukuja o $200K — to szum taktyczny, nie zmiana strategii.

To dotyczy tez inzynierii oprogramowania: nie optymalizuj performance'u (taktyka) kosztem poprawnosci (strategia). Nie dodawaj featurow (taktyka) kosztem architektury (strategia).

### 2. Fail gracefully, not silently

Shadow Trading 404 to przyklad cichego bledu — bot dzialal, ale logowal smieci i marnowai zasoby. Lepsze podejscia:
- Rate limit error logs (co 10-ty blad zamiast kazdego)
- Dodac hint w logu: "set SHADOW_TRADING_ENABLED=false to disable"
- Auto-disable po N bledach z rzedu

### 3. Dane > Opinie

Bot nie ma opinii. Bot ma dane. Kiedy SM shortuja z ratio 5.5x i zarabiaja — bot shortuje. Kiedy SM flipuja na LONG — bot flipuje.

Najlepsi inzynierowie tez tak dzialaja: nie przywiazuj sie do rozwiazania. Przywiazuj sie do problemu. Jesli dane mowia ze twoje rozwiazanie nie dziala — zmien rozwiazanie, nie dane.

### 4. System wazenia > Binarne decyzje

whale_tracker nie mowi "shortuj / nie shortuj". Mowi:
- Mode: FOLLOW_SM_SHORT
- Confidence: 85%
- maxPositionMultiplier: 0.75
- momentumWarning: "Shorts losing momentum"

To pozwala botowi podejmowac **niuansowane decyzje** zamiast binarnych. W inzynierii oprogramowania to odpowiednik feature flagow z percentage rollout zamiast on/off.

### 5. Warstwy obrony (Defense in Depth)

Bot ma wiele warstw zabezpieczen:

```
Warstwa 1: SignalEngine        — decyzja strategiczna
Warstwa 2: HARD_BLOCK          — twarda blokada
Warstwa 3: HOLD_FOR_TP         — nie zamykaj przedwczesnie
Warstwa 4: Nuclear Fix         — zeruj bidy w SHORT mode
Warstwa 5: Stop Loss 12%       — ostatnia linia obrony
Warstwa 6: UTIL CAP 80%        — max 80% equity w pozycjach
```

Jesli warstwa 1 sie myli, warstwa 2 lapie. Jesli 2 sie myli, 3 lapie. Itd.

W software to odpowiednik: input validation -> business logic -> database constraints -> monitoring -> alerting.

### 6. Audytuj swoje zalozenia

4 z 14 TIER 1 wielorybow zamknelo konta. Bitcoin OG zostal zlikwidowany. Zalozenie "ci traderzy sa Smart Money" przestalo byc prawdziwe dla tych adresow.

Regularnie sprawdzaj czy twoje zalozenia nadal obowiazuja. W kodzie: czy ten config jest aktualny? Czy te hardcoded adresy nadal sa aktywne? Czy ta biblioteka jest nadal utrzymywana?

---

## Technologie

| Technologia | Dlaczego | Alternatywy |
|-------------|----------|-------------|
| **TypeScript** | Typowanie lapie bugi przed deployem. Na gieldzie bug = strata $$ | JavaScript (zbyt ryzykowne) |
| **Python** (whale_tracker) | Szybki prototyping, dobre do data processing | TS (mozliwe, ale Python szybciej pisze sie) |
| **PM2** | Process manager — restartuje bota, logi, monitoring | systemd (mniej elastyczny) |
| **Tailscale** | VPN do serwera — bezpieczne SSH bez otwierania portow | WireGuard (wiecej konfiguracji) |
| **Hyperliquid API** | Darmowe! Pozycje, fills, ceny — bez API key | Binance (wymaga KYC, API key) |
| **Nansen API** | Jedyne narzedzie ktore labeluje portfele jako "Smart Money" | Brak alternatyw |
| **Telegram** | Alerty w real-time na telefon | Discord, Slack |

---

## Infrastruktura

```
MacBook (dev) ---- Tailscale VPN ------- hl-mm (Linux server)
                                             |
                                      PM2 manages:
                                      |-- mm-bot (glowny bot)
                                      |-- nansen-bridge
                                      |-- vip-spy
                                      |-- ai-executor
                                      |-- sm-short-monitor
                                      |-- war-room
                                      |-- prediction-api
                                      +-- sui-price-alert
```

Deploy: `scp` pliku na serwer + `pm2 restart mm-bot`. Proste i skuteczne.

---

## Slowniczek

| Termin | Znaczenie |
|--------|-----------|
| **Perp/Perpetual** | Kontrakt futures bez daty wygasniecia. Mozesz longowac lub shortowac |
| **Long** | Kupujesz — zarabiasz gdy cena rosnie |
| **Short** | "Pozyczasz i sprzedajesz" — zarabiasz gdy cena spada |
| **Leverage/Dzwignia** | 5x leverage = $1000 kontroluje $5000 pozycji. Zyski i straty x5 |
| **uPnL** | Unrealized Profit & Loss — zysk/strata na otwartej pozycji (niezamknieta) |
| **Spread** | Roznica miedzy bid (kupno) a ask (sprzedaz) |
| **Grid** | Zestaw zlecen na roznych poziomach cenowych |
| **Bid** | Zlecenie kupna |
| **Ask** | Zlecenie sprzedazy |
| **SM (Smart Money)** | Portfele potwierdzone przez Nansen jako zyskowne |
| **Whale** | Duzy portfel (niekoniecznie zyskowny) |
| **SL (Stop Loss)** | Automatyczne zamkniecie pozycji przy okreslonej stracie |
| **TP (Take Profit)** | Automatyczne zamkniecie pozycji przy okreslonym zysku |
| **Liquidation** | Gielda zamyka pozycje przymusowo bo margin nie wystarczy |
| **VPIN** | Volume-synchronized Probability of Informed Trading — mierzy czy "ktos wie wiecej" |
| **Bias** | Pochylenie w strone long (>0.5) lub short (<0.5) |
| **Fill** | Zrealizowane zlecenie |
| **Funding Rate** | Periodyczna oplata miedzy longami i shortami (wyrownuje perp do spot) |
| **ATR** | Average True Range — miara zmiennosci ceny |

---

## Daily Whale Report — Rentgen portfeli wielorybow

### Co to jest?

Wyobraz sobie, ze masz lornetke i co rano mozesz podejrzec portfele 57 najlepszych traderow na gieldzie. Nie musisz logowac sie na Nansen, nie musisz recznie sprawdzac adresow. O 12:00 UTC na Discord leci raport:

```
BTC    $153.5M SHORT vs  $11.0M LONG  (93% SHORT)
ETH     $63.0M SHORT vs  $17.8M LONG  (78% SHORT)
SOL     $51.9M SHORT vs   $3.7M LONG  (93% SHORT)
```

Jedno spojrzenie i wiesz: "Smart Money sa masywnie SHORT na BTC/ETH/SOL. Nie kupuj."

### Plik: `scripts/daily-whale-report.ts`

Jeden plik, ~390 linii, zero zewnetrznych zaleznosci poza tym co juz jest w projekcie (`@nktkas/hyperliquid`, `dotenv`).

### Jak dziala? (krok po kroku)

```
1. ZALADUJ ADRESY
   57 wielorybow hardcoded w WHALES dict
   (synced z whale_tracker.py, bez Tier 4 Market Makers)
        |
        v
2. FETCH DANYCH Z HYPERLIQUID API
   Dla kazdego adresu: clearinghouseState
   (batche po 5, 200ms delay miedzy batchami)
        |
        v
3. PARSUJ POZYCJE
   Equity, uPnL, lista pozycji (coin, side, value)
   Closed/empty accounts -> skip
        |
        v
4. FORMATUJ RAPORT
   Tier 1 -> Tier 2 -> Tier 3 -> Aggregate Summary
   Split na wiadomosci <2000 znaków (limit Discord)
        |
        v
5. WYSLIJ NA DISCORD
   POST do webhookURL z { content: "..." }
```

### Kluczowe decyzje techniczne (i dlaczego)

#### 1. `Promise.allSettled` zamiast `Promise.all`

```typescript
const settled = await Promise.allSettled(
  batch.map(async ([address, whale]) => {
    const state = await info.clearinghouseState({ user });
    // ...
  })
);
```

**Dlaczego?** `Promise.all` rzuca blad jesli JAKIKOLWIEK promise fail'uje. Czyli jesli 1 z 57 wielorybow ma zamkniete konto i API rzuca blad — caly raport nie generuje sie.

`Promise.allSettled` czeka az WSZYSTKIE promisy sie rozwiaza (fulfill lub reject) i zwraca status kazdego. Mozesz obsluzyc bledy indywidualnie.

To jak roznica miedzy:
- `Promise.all` = "Jesli JEDEN zolnierz nie zamelduje sie, cala operacja jest odwolana"
- `Promise.allSettled` = "Raportujcie co wiecie. Brakujacych oznaczymy jako BRAK DANYCH"

W realnym swiecie 14 z 57 kont jest zamknietych. Bez `allSettled` raport nigdy by sie nie wygenerował.

#### 2. Rate limiting (batch po 5 + 200ms delay)

```typescript
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 200;

for (let i = 0; i < entries.length; i += BATCH_SIZE) {
  const batch = entries.slice(i, i + BATCH_SIZE);
  // ... fetch batch
  await sleep(BATCH_DELAY_MS);
}
```

**Dlaczego?** Hyperliquid API ma rate limity. 57 requestow naraz = HTTP 429 (Too Many Requests). Batche po 5 z 200ms pauzą = ~2.5 sekundy na caly fetch. Szybko, ale grzecznie.

To jak kolejka w sklepie — mozesz wejsc z 5 osobami naraz, ale nie z 57.

**Dlaczego nie po 1?** Bo byloby zbyt wolno (57 x 200ms = 11 sekund). Batch 5 to dobry balans.

#### 3. Message splitting (limit 2000 znakow Discord)

```typescript
if ((header + section).length > 1900) {
  messages.push(header.trim());
  header = section;  // nowa wiadomosc
}
```

**Dlaczego 1900 a nie 2000?** Bufor bezpieczenstwa. Discord obcina na 2000 — lepiej wyslac 2 wiadomosci niz stracic koniec raportu. Margines 100 znakow na ewentualne markdown formatting.

#### 4. Position value = |size| * entryPx

```typescript
const valueUsd = Math.abs(szi) * entryPx;
```

Nie `Math.abs(szi) * currentPrice`. Dlaczego? Bo `entryPx` jest w danych z API, a `currentPrice` wymaga dodatkowego API call. Roznica jest minimalna (pozycja +5% vs pozycja nominalna), a oszczedzamy 1 API call i unikamy timing issues.

#### 5. Filtry czytelnosci

Trzy stale kontroluja ile szumu widzisz w raporcie:

| Stala | Wartosc | Efekt |
|-------|---------|-------|
| `MIN_POSITION_VALUE` | $100K | Chowaj male pozycje |
| `MAX_POSITIONS_PER_WALLET` | 10 | Cap na pozycje (Wice-General ma 36!) |
| `MIN_AGGREGATE_VALUE` | $1M | Aggregate tylko duze coiny |

Bez tych filtrow raport mialby 200+ linii i bylby nieczytelny. Z nimi — konkretna informacja ktora mozesz przeskanowac w 30 sekund.

### Wzorce z istniejacego kodu (pattern matching)

Ten skrypt nie zostal napisany od zera. Wzorce sa zaczerpniete z istniejacych skryptow:

| Wzorzec | Zrodlo | Uzycie |
|---------|--------|--------|
| Shebang `#!/usr/bin/env -S npx tsx` | `hourly-discord-report.ts` | Mozna uruchomic jako `./daily-whale-report.ts` |
| `config({ path: ... })` | `daily_report.ts` | Ladowanie .env |
| `new hl.HttpTransport() + InfoClient` | `hourly-discord-report.ts` | Klient API |
| `clearinghouseState` parsing | `hourly-discord-report.ts:39-44` | Equity, pozycje, uPnL |
| Discord webhook `{ content }` | `daily_report.ts:20` | Format payloadu |
| Error reporting do Discord | `daily_report.ts:115-121` | Jesli skrypt padnie, wyslij blad na Discord |
| `--dry-run` flag | Nowy (ale standardowa praktyka) | Testowanie bez wysylania |

**Lekcja:** W dojrzalym kodzie nie wymyslasz kola na nowo. Patrzysz jak robi to istniejacy kod i naśladujesz wzorce. Konsystencja > kreatywnosc.

### Adresy wielorybow — duplikacja vs single source of truth

Adresy wielorybow sa hardcoded w dwoch miejscach:
1. `whale_tracker.py` (Python, ~600 linii) — autorytatywne zrodlo
2. `daily-whale-report.ts` (TypeScript) — kopia

**Dlaczego duplikacja?** Bo to sa dwa rozne jezyki (Python vs TS). Importowanie Python dict z TypeScript wymagaloby:
- Albo wspolnego pliku JSON (dodatkowa warstwa, ryzyko desynchronizacji)
- Albo parsowania Python z TS (szalone)
- Albo wspolnej bazy danych (overengineering dla 57 adresow)

**Tradeoff:** Duplikacja = ryzyko ze adresy sie rozjada. Ale te adresy zmieniaja sie raz na kilka tygodni (audit po Bitcoin OG liquidation). Przy takiej czestotliwosci, manualna synchronizacja jest OK.

**Kiedy to NIE jest OK:** Gdy dane zmieniaja sie czesto (np. codziennie). Wtedy single source of truth (JSON file, baza danych) jest obowiazkowy.

### Uruchamianie

```bash
# Lokalnie — dry run (tylko konsola)
npx tsx scripts/daily-whale-report.ts --dry-run

# Produkcja — wyslij na Discord
npx tsx scripts/daily-whale-report.ts

# PM2 cron — codziennie o 12:00 UTC
pm2 start scripts/daily-whale-report.ts \
  --name whale-report \
  --interpreter "npx" \
  --interpreter-args "tsx" \
  --cron "0 12 * * *" \
  --no-autorestart
```

**Dlaczego `--no-autorestart`?** Bo to skrypt jednorazowy (run-and-exit), nie daemon. PM2 domyslnie restartuje procesy ktore sie koncza — bez tej flagi skrypt uruchomilby sie w petli.

### Co mozna nauczyc sie z tego skryptu

1. **Resilient data fetching** — `Promise.allSettled` + rate limiting + graceful error handling. W realnym swiecie dane sa brudne (puste konta, API errory, timeouty). Kod musi to obslugiwac.

2. **Platform constraints drive design** — Limit 2000 znaków Discord ksztaltuje cala logike formatowania. Dobrzy inzynierowie znaja limity platformy ZANIM zaczna pisac kod, nie po deploymencie.

3. **Readability > completeness** — Raport moglby pokazac WSZYSTKIE pozycje. Ale 200-liniowy raport nikt nie czyta. Filtry ($100K min, 10 pozycji max, $1M aggregate) czynia raport uzytecznym.

4. **Copy existing patterns** — Nie wymyslaj nowego sposobu na webhook, format daty, klient API. Uzyj tego co juz dziala w projekcie. Mniej bugow, szybciej, latwiej review.

5. **Dry run mode** — Kazdy skrypt ktory robi cos nieodwracalnego (wysyla wiadomosc, sklada zlecenie, kasuje dane) powinien miec `--dry-run`. Kosztuje 3 linie kodu, oszczedza godziny debugowania.

---

## Podsumowanie

Ten bot to nie jest "kup tanio, sprzedaj drogo". To jest **system wywiadowczy** ktory:

1. **Zbiera dane** z 3 zrodel (Hyperliquid API, Nansen, Telegram)
2. **Wazy je** przez credibility multipliers (SM > Whale > Unknown)
3. **Podejmuje decyzje** przez wielowarstwowy system priorytetow
4. **Wykonuje je** przez grid zlecen na gieldzie
5. **Chroni sie** przez 6 warstw zabezpieczen

Najwazniejsza lekcja: **w tradingu (i w inzynierii) strategia jest wazniejsza od taktyki, dane od opinii, a dyscyplina od sprytu.**

---

*Ostatnia aktualizacja: 21 lutego 2026 (dodano Daily Whale Report)*
*Wygenerowane przez Claude Code*
