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
11. [Case Study: Winner d7a678](#case-study-winner-d7a678--anatomia-idealnego-tradea)
12. [VIP Intelligence Report](#vip-intelligence-report--snapshot-21-lutego-2026) *(updated: 25 VIPs)*
13. [BTC SHORT Deep Dive](#btc-short-deep-dive--kto-shortowal-od-topu-i-mogl-cos-wiedziec)
14. [Slowniczek](#slowniczek)

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

### Bug #9: 2000-fill API limit — gubienie danych (21.02)

Hyperliquid API `userFillsByTime` zwraca **maksymalnie 2000 fills** na request (najstarsze w oknie). Przez miesiac bot i skrypty analityczne nie paginowaly — po prostu braly co API dalo i szly dalej.

**Jak to odkrylismy:** Analizowalismy wieloryba d7a678 ("Winner"). API zwrocilo dokladnie 2000 fills (z pazdziernika do grudnia 2025) i pominelo nowsze fills ze stycznia 2026. Myslismy ze zarobil +$1.15M (3 tokeny) — w rzeczywistosci zarobil +$4.09M. **60% danych bylo ukryte.**

**Skutki:**
- `syncPnLFromHyperliquid` w mm_hl.ts — PnL tracking mogl gubic fills przy aktywnym tradingu
- Skrypty analityczne (perfill_hist, perfill_bypair) — niekompletne dane
- Skrypt hourly-discord-report — raport mogl byc uciety

**Fix:** Stworzylismy `src/utils/paginated_fills.ts` — utility z automatyczna paginacja:
1. Fetch fills z `startTime` do `endTime`
2. Jesli 2000 fills (limit) → przesuwa `startTime` za ostatni fill i fetchuje kolejna strone
3. Deduplikacja po `tid` (unique transaction ID)
4. Powtarza do max 10 stron (20K fills)

**Weryfikacja:** d7a678 zwrocil 2220 fills w 2 stronach. Bez paginacji mielibysmy 2000 i brak najnowszych 220.

**Lekcja:** Kazde API ma limity. Jesli nie wiesz jaki jest limit — sprawdz dokumentacje. Jesli dokumentacji nie ma (Hyperliquid) — testuj z duzymi zbiorami danych. Magiczna liczba 2000 powinna byc red flag ("czemu dokladnie okragla liczba?"). **Zawsze sprawdzaj czy wynik API nie jest rowny limitowi.**

To jak czytanie 200-stronicowej ksiazki i nie zauwazenie ze brakuje stron 201-300. Wydaje sie kompletna, ale nie jest.

### Bug #10: AI Trend Reversal — slepe bullish sygnaly przez miesiac (22.02)

Alert Nansen "AI Trend Reversal" dla FARTCOIN przychodzil codziennie od miesiaca. Cena nie ruszyla. Dlaczego?

Alert mowil: `"Fresh wallets received $97K of FARTCOIN (0.10× the recent average)"`. Kluczowa informacja to **0.10×** — aktywnosc nowych portfeli spadla o **90%** od sredniej. To jest **bearish**, nie bullish!

Ale parser (`parseMmBotAiTrendReversal`) ignorowal mnoznik i slepo traktowal kazdy "AI Trend Reversal" jako `MOMENTUM_LONG` (bullish). Przez miesiac bot dostawal falszywe sygnaly kupna na tokenie ktory tracil zainteresowanie.

**Fix:** Parser teraz wyciaga mnoznik z tekstu:
- `<0.5×` → `MOMENTUM_SHORT` (bearish — popyt wyschnal)
- `0.5-2.0×` → IGNORE (szum, normalny zakres)
- `>2.0×` → `MOMENTUM_LONG` (bullish — napływ nowych portfeli)

**Lekcja:** Nazwa alertu ("Trend Reversal") to marketing — trzeba czytac dane, nie nazwe. 0.10× to nie "reversal up", to "demand collapse". **Zawsze parsuj numeryczne wartosci z alertow, nie polegaj na etykietach.**

To jak dostac alert "Zmiana pogody!" i zalozyc ze bedzie slonecznie — a potem okazuje sie ze zmiana to huragan.

### Bug #11: Market maker spam — Selini Capital (22.02)

Selini Capital (5 kont MM1-MM5) bylo w `whale_tracker.py` jako MARKET_MAKER z `signal_weight: 0.0`. Zero wplywu na sygnaly bota. Ale tracker i tak generowal alerty o kazdym flipie pozycji — a market maker flipuje pozycje **ciagle** (Short→Long, Long→Short, po kilkanascie razy dziennie).

Efekt: skrzynka alertow pelna bezuzytecznych wiadomosci typu "Selini Capital FLIPPED PUMP Short→Long | $19K". Szum zagluszal wazne sygnaly od prawdziwych traderow.

**Fix:** Usuniecie Selini Capital z 4 plikow (whale_tracker.py, SmAutoDetector.ts, hype_monitor.ts, nansen_alert_parser_v2.ts).

**Lekcja:** `signal_weight: 0` nie wystarczy jesli system i tak raportuje zmiany. Jesli cos jest na liscie "ignoruj" — **usun to z listy calkowicie**. "Ignorowany ale monitorowany" to oksymoron ktory generuje spam. Albo sledzisz, albo nie.

### Bug #13: ai-executor Nansen relay martwy od miesiaca (22.02)

`ai-executor` (PM2 id 5) logowal `Main loop error: fetch failed` non-stop od okolo 24 stycznia. Plik `.env.ai-executor` zniknal z katalogu bota — proces nie mial tokena Telegram i nie mogl pollowac kanalu Nansen. Przez miesiac alerty Nansen (SM Accumulation, AI Trend Reversal, SM Outflow) **nie trafialy do kolejki** `/tmp/nansen_raw_alert_queue.json` — bot MM ich nie przetwarzal.

**Diagnoza — odkrycie 3 procesow AI:**
Na serwerze dzialaly 3 oddzielne procesy AI (a nie jeden jak myslalismy):
1. **ai-executor** (PM2) — Nansen alert relay, KRYTYCZNY, zepsuty
2. **ai-chat-gemini.mjs** (poza PM2) — prosty Gemini chatbot
3. **ai-executor.mjs GOD MODE** (poza PM2) — interaktywny asystent z /panic, /close, /positions

Kazdy uzywal **innego tokena Telegram** i wyglądalo jakby wszystko dzialalo bo procesy 2 i 3 odpowiadaly na Telegramie. Ale jedyny KRYTYCZNY (relay alertow do bota) byl martwy.

**Fix:** Stworzenie brakujacego `.env.ai-executor` z tokenem Telegram `@HyperliquidMM_bot`.

**Lekcja:** Proces ktory cicho failuje jest gorszy od procesu ktory crashuje. `ai-executor` logowal `fetch failed` co sekundę ale PM2 pokazywal go jako "online" (bo proces nie crashowal — pollowal z pustym tokenem w nieskonczonosc). Gdyby proces sprawdzil token na starcie i zcrashowawl (`if (!TELEGRAM_TOKEN) process.exit(1)`), PM2 pokazalby "errored" i ktos by zareagowal wczesniej. **Fail loud, not quiet.**

### Bug #14: prediction-api martwy od miesiaca — isMainModule pod PM2 (22.02)

`prediction-api` (PM2 id 30, port 8090) nie działał od 27 dni. Zero logów, port nienasłuchujący, ale PM2 pokazywał "online".

**Przyczyna:** Skrypt `dist/prediction/dashboard-api.js` ma na końcu:
```javascript
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  startPredictionServer();
}
```

Pod PM2 ta ścieżka nie matchuje (PM2 resolves paths inaczej niż direct `node` call). Warunek `isMainModule` zwracał `false`. Serwer HTTP **nigdy nie startował**. Proces po prostu kończył setup i czekał na event loop (który był pusty) — PM2 nie crashował go bo technicznie proces żył.

**Fix:** Zamiana `if (isMainModule)` na `if (true)` w pliku na serwerze.

**Lekcja:** Pattern `import.meta.url === \`file://${process.argv[1]}\`` jest **neszczelny** — działa z `node script.js` ale nie z process managerami (PM2, Docker entrypoints), transpilerami (tsx, ts-node), i bundlerami (esbuild). Jeśli plik jest ZAWSZE uruchamiany standalone (jak serwer API), nie potrzebujesz tego checka — po prostu wywołaj `startServer()`. Użyj tego wzorca TYLKO gdy plik jest jednocześnie biblioteką (importowaną) i standalone skryptem.

### Bug #15: One-shot skrypty jako PM2 daemons (22.02)

`hourly-report` i `whale-report` w PM2 — jeden "stopped" (restartował się i kończył), drugi nigdy nie uruchomiony.

**Przyczyna:** Oba skrypty są **one-shot** (run-and-exit): fetchują dane, wysyłają raport na Discord, i kończą się z `process.exit(0)`. PM2 jest zaprojektowany dla **daemons** (procesów które działają w nieskończoność). Gdy one-shot się kończy, PM2 albo:
- Restartuje go (i znowu się kończy — pętla)
- Oznacza jako "stopped" jeśli użyto `--no-autorestart`

Ani jedno ani drugie nie jest poprawne — skrypt powinien uruchamiać się **periodycznie** (co godzinę / raz dziennie), nie ciągle.

**Fix:** Usunięcie z PM2, dodanie jako cron jobs:
```bash
# Co godzinę o :15
15 * * * * cd ~/hyperliquid-mm-bot-complete && npx tsx scripts/hourly-discord-report.ts

# Codziennie o 08:00 UTC
0 8 * * * cd ~/hyperliquid-mm-bot-complete && npx tsx scripts/daily-whale-report.ts
```

**Lekcja:** Narzędzie musi pasować do zadania:
- **PM2** = procesy ciągłe (bot, serwer API, websocket listener, dashboard)
- **Cron** = zadania periodyczne (raporty, backupy, cleanup, health checks)
- **systemd timer** = jak cron ale z lepszym logowaniem (przyszła alternatywa)

To jak różnica między strażnikiem (PM2 — stoi na posterunku 24/7) a kurierem (cron — przychodzi o ustalonej godzinie, zostawia paczkę, odchodzi). Nie zatrudniaj kuriera jako strażnika.

### Bug #16: sui-price-alert nierealistyczne targety (22.02)

`sui-price-alert` monitorował ceny SUI ($0.93) z targetem $1.85 (+98%) i LIT ($1.50) z targetem $2.50 (+67%). Przy tych targetach alert nigdy by się nie wyzwolił.

**Fix:** Usunięcie z PM2.

**Lekcja:** Skrypty z hardcoded targetami cenowymi wymagają regularnego przeglądu. Ceny krypto zmieniają się szybko — target ustawiony 2 miesiące temu może być absurdalny dzisiaj.

### Bug #12: Nansen Kill Switch falszywy alarm (25.01)

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

### 3. Fail loud, not quiet

`ai-executor` logowal `fetch failed` co sekunde przez miesiac. PM2 pokazywal go jako "online" (status zielony!). Nikt nie zareagowal bo proces NIE crashowal — cicho pollowal Telegram z pustym tokenem w nieskonczonej petli. Tymczasem alerty Nansen nie trafialy do bota MM przez caly luty.

Gdyby kod mial na starcie:
```javascript
if (!TELEGRAM_TOKEN) {
  console.error("FATAL: TELEGRAM_BOT_TOKEN not set!");
  process.exit(1);
}
```
PM2 pokazalby "errored" (czerwony), ktos by zobaczyl i naprawil w 5 minut zamiast w miesiac.

**Zasada:** Jesli konfiguracja jest wymagana do dzialania — sprawdz ja na starcie i **crashnij glosno**. Cichy blad w petli jest gorszy od crashu, bo crash jest widoczny.

### 4. Dane > Opinie

Bot nie ma opinii. Bot ma dane. Kiedy SM shortuja z ratio 5.5x i zarabiaja — bot shortuje. Kiedy SM flipuja na LONG — bot flipuje.

Najlepsi inzynierowie tez tak dzialaja: nie przywiazuj sie do rozwiazania. Przywiazuj sie do problemu. Jesli dane mowia ze twoje rozwiazanie nie dziala — zmien rozwiazanie, nie dane.

### 5. System wazenia > Binarne decyzje

whale_tracker nie mowi "shortuj / nie shortuj". Mowi:
- Mode: FOLLOW_SM_SHORT
- Confidence: 85%
- maxPositionMultiplier: 0.75
- momentumWarning: "Shorts losing momentum"

To pozwala botowi podejmowac **niuansowane decyzje** zamiast binarnych. W inzynierii oprogramowania to odpowiednik feature flagow z percentage rollout zamiast on/off.

### 6. Warstwy obrony (Defense in Depth)

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

### 7. Right tool for the job (PM2 vs Cron)

Mielismy 2 skrypty (hourly-report, whale-report) skonfigurowane jako PM2 daemons. Jeden "stopped", drugi nigdy nie uruchomiony. Problem: PM2 jest dla daemons (procesow ktore dzialaja ciagle). Te skrypty to one-shots (run-and-exit).

```
PM2 (daemon)    = Straznik na posterunku 24/7
Cron (periodic) = Kurier — przychodzi o 8:00, zostawia paczke, odchodzi

Nie zatrudniaj kuriera jako straznika.
```

W software to odpowiednik: nie uzywaj bazy danych do cache'owania (uzyj Redis), nie uzywaj queue do prostego cron joba, nie uzywaj Kubernetes do jednego serwera. Kazde narzedzie ma swoj sweet spot.

### 8. Audytuj swoje zalozenia

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
                                      PM2 manages (7 daemons):
                                      |-- mm-bot (glowny bot)
                                      |-- nansen-bridge (port 8080)
                                      |-- vip-spy (polling 30s)
                                      |-- ai-executor (Nansen relay)
                                      |-- sm-short-monitor (Nansen perp API)
                                      |-- war-room (dashboard port 3000)
                                      +-- prediction-api (ML API port 8090)
                                             |
                                      Cron jobs (periodic):
                                      |-- hourly-discord-report (:15 co godzine)
                                      +-- daily-whale-report (08:00 UTC)
                                             |
                                      Standalone (poza PM2):
                                      |-- ai-chat-gemini.mjs (chatbot)
                                      +-- ai-executor.mjs GOD MODE
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

## Case Study: Winner d7a678 — anatomia idealnego trade'a

### Kim jest Winner?

Adres: `0xd7a678fcf72c1b602850ef2f3e2d668ec41fa0ed`

Jeden z najlepszych traderow na Hyperliquid w Q4 2024 / Q1 2025. Nansen labeluje go jako "Smart HL Perps Trader" i "Consistent Perps Winner". Zarobil **+$4.09M** na Hyperliquid i **~$5.5M lacznie** (wliczajac Deribit i Venus Protocol) w ciagu 4 miesiecy.

### Co zrobil (timeline)

```
6 pazdziernika 2025  — Pierwsza transakcja na Hyperliquid
Pazdziernik-Grudzien — Buduje shortow na SOL, BTC, ETH (shortuje z topu!)
Styczen 2026         — Kolekcjonuje zyski, zamyka pozycje
31 stycznia 2026     — Ostatnia transakcja. Konto zamkniete. $0.
```

### Wyniki per token

| Token | PnL z fills | Strategia |
|-------|------------|-----------|
| **SOL** | **+$3.2M** | SHORT od topu, glowna pozycja |
| **BTC** | **+$487K** | SHORT, mniejsza pozycja |
| **ETH** | **+$397K** | SHORT, mniejsza pozycja |
| **Lacznie HL** | **+$4.09M** | 2220 fills w 4 miesiace |

Dodatkowo:
- **Deribit**: +$969K (opcje — prawdopodobnie hedge albo dodatkowe shorty)
- **Venus Protocol**: ~$900 (yield farming na stablecoiny — parkowal gotowke w DeFi)
- **Lacznie**: **~$5.5M**

### Dlaczego jest to wazne dla nauki

#### 1. Koncentracja na jednym trade

Winner nie tradowal 20 tokenow. Mial 3 tokeny i **78% zysku z jednego** (SOL). To potwierdzenie zasady: lepiej miec jedna swietna teze niz 10 srednich.

#### 2. Wejscie z topu, wyjscie z dolu

Shortowal SOL/BTC/ETH od pazdziernikowych szczytow i trzymal do stycznia. To znaczy ze mial **teze makro** (krypto jest za drogie) i ja realizowal z cierpliwoscia. Nie zamykal po 5% — trzymal do 50%+.

#### 3. Multi-venue strategy

Nie ograniczal sie do jednej gieldy:
- **Hyperliquid** — glowne pozycje perp
- **Deribit** — opcje (hedge? dodatkowe shorty?)
- **Venus Protocol** — yield na gotowce (stablecoiny zarabiaja 5-8% APY)

#### 4. Clean exit

31 stycznia zamknal WSZYSTKO i odsunol krzeslo od stolu. Konto = $0. Zadnych pozycji. To cecha profesjonalisty — wie kiedy wyjsc. Nie "jeszcze troche", nie "moze jeszcze spadnie".

#### 5. Powiazane adresy — nic na Hyperliquid

Nansen znalazl 6 powiazanych adresow (Gnosis Safe, counterparties). Sprawdzilismy je wszystkie na Hyperliquid — **zero fills, zero equity**. Winner dziala z jednego adresu na HL. Nie rozklada ryzyka na wiele portfeli.

### Co to znaczy dla naszego bota

Winner jest w naszym VIP Spy jako tier1 z nota "watching for return". Jesli kiedykolwiek wroci na Hyperliquid i otworzy pozycje — dostaniemy alert w ciagu 30 sekund.

Jego strategia potwierdza nasza doktryne: **podazaj za SM, trzymaj do TP, nie zamykaj na szumie.** Winner zrobil dokladnie to — i zarobil $5.5M.

---

## VIP Intelligence Report — Snapshot 21 lutego 2026

> **Update:** Raport aktualizowany tego samego dnia — po dodaniu Fasanara Capital, Abraxas Capital i Bitcoin OG #2 mamy teraz 25 portfeli.

### Podsumowanie 25 portfeli

| Metryka | Poprzednio (22 VIP) | Teraz (25 VIP) | Zmiana |
|---------|---------------------|----------------|--------|
| **Laczne equity** | $151.7M | **$187.1M** | +$35.4M |
| **Laczny notional** | $416.6M | **$528.1M** | +$111.5M |
| **Laczny uPnL** | +$104.3M | **+$114.3M** | +$10M |
| **Dominacja SHORT** | 3.9x | **5.2x** | Silniejsza! |
| **Aktywne konta** | 18/22 | **23/25** | |

### Top 5 portfeli (po equity)

| # | Nazwa | Equity | Notional | uPnL | Styl |
|---|-------|--------|----------|------|------|
| 1 | **Laurent Zeimes** | $36.8M | $56.4M | +$6.5M | LONG (HYPE $37.6M, ZEC $9.4M) — jedyny duzy bull |
| 2 | **Fasanara Capital** | $27.6M | $101.3M | +$6.9M | Short everything (23 poz), London hedge fund |
| 3 | **Wice-General** | $17.1M | $59.2M | +$28.2M | Short everything (45 poz!), najlepszy uPnL |
| 4 | **Kapitan BTC** | $16.2M | $35.1M | +$13.0M | BTC SHORT $29.2M — koncentracja |
| 5 | **Major** | $13.5M | $38.8M | +$8.2M | SOL+BTC SHORT — macro shorter |

### Top sygnaly per coin

| Coin | SHORT | LONG | Dominacja | Sygnal |
|------|-------|------|-----------|--------|
| **BTC** | $153M | $0 | **100% SHORT** | Najsilniejszy — wzrosl z $128M! |
| **ETH** | $103M | $7M | **15x SHORT** | Wzrosl z $33M (Fasanara $50M!) |
| **SOL** | $40M | $2M | **21x SHORT** | Stabilny |
| **HYPE** | $64M | $40M | **Contested** | Nadal pole bitwy |
| **XMR** | $10M | $0 | 100% SHORT | Token Millionaire |
| **FARTCOIN** | $7.6M | $0.1M | 61x SHORT | Silny |
| **ZEC** | $3M | $18M | **6x LONG** | Jedyny wyrazny LONG! |
| **LIT** | $4.8M | $0 | 100% SHORT | General shortuje |

### Kto jest LONG? (tylko 3 z 23 aktywnych)

Interesujace pytanie: kto plynie pod prad?

| Trader | Co longuje | Notional | Dlaczego? |
|--------|-----------|----------|-----------|
| **Laurent Zeimes** | HYPE $37.6M, ZEC $9.4M, PAXG $8M | $54.9M LONG | Fund — jedyny duzy bull |
| **ZEC Conviction** | ZEC $8.3M, HYPE $2.1M | $10.4M LONG | Fund — ZEC thesis |
| **Porucznik ea66** | ETH $3.9M, XPL $2.3M | $11.6M LONG | Flipnal na LONG! |

Reszta (20/23 aktywnych) jest **dominujaco SHORT**.

### 2 puste konta (watching for return)

- **Winner d7a678** — +$4.6M net, konto zamkniete od 31 stycznia 2026
- **Bitcoin OG #2** — +$72.5M na Oct crash, ten sam podmiot co OG #1 (zlikwidowany)

### Kluczowe wnioski

1. **Consensus bearish SILNIEJSZY niz tydzien temu** — SHORT/LONG ratio wzrosl z 3.9x do 5.2x. Dodanie Fasanary ($101M notional, 99% SHORT) drastycznie przesunelo bilans.

2. **BTC $153M ALL SHORT** — najsilniejszy sygnal. Zero longow. Fasanara dodala $25M do puli.

3. **ETH skoczylo z $33M do $103M SHORT** — Fasanara ma ETH SHORT $50M (15x leverage). To teraz drugi najsilniejszy sygnal po BTC.

4. **Tylko 3 portfele sa LONG** — i 2 z nich to fundy z tezami na konkretne tokeny (ZEC, HYPE). Jeden (ea66) to flip — wczesniej byl SHORT.

5. **Fasanara Capital to game changer** — $101M notional na $27.6M equity, 23 pozycje, prawie wszystko SHORT. To profesjonalny hedge fund ktory robi dokladnie to samo co nasi SM traderzy ale na 3x wiekszej skali.

### Lekcja: VIP Intelligence jako edge

Ten raport to nasz "satelitarny obraz pola bitwy". W ciagu 60 sekund wiemy:
- **Co robia najlepsi** (kierunek)
- **Ile wkladaja** (przekonanie)
- **Czy zarabiaja** (walidacja)

Zaden indywidualny trader nie ma dostepu do takich danych. Nansen + Hyperliquid API + nasze narzedzia daja nam **asymetryczny edge** — widzimy wiecej niz 99% rynku.

---

## BTC SHORT Deep Dive — Kto shortowal od topu i mogl cos wiedziec?

### Kontekst

BTC ATH: ~$109,500 (styczen 2025). BTC teraz: ~$68,300 (luty 2026). Spadek -37.6%.

Wsrod 22 monitorowanych portfeli VIP, **10 aktywnie shortuje BTC**. Zero longuje. Lacznie **1,410 BTC ($96M) w shortach** z niezrealizowanym zyskiem **+$32M**.

Pytanie: czy to zbieznosc, czy ktos wiedzial wiecej?

### Top 10 BTC Shorterow — ranking po entry price

| # | Trader | Tier | Entry | Od ATH | Size | Value | uPnL | Lev |
|---|--------|------|-------|--------|------|-------|------|-----|
| 1 | **Kraken A** | tier1 | **$108,415** | **-1.0%** | 44 BTC | $3.0M | +$1.8M | 20x |
| 2 | **Kapitan BTC** | tier2 | **$106,677** | **-2.6%** | 274 BTC | $18.7M | +$10.5M | 20x |
| 3 | **Galaxy Digital** | fund | **$103,994** | **-5.0%** | 123 BTC | $8.4M | +$4.4M | 20x |
| 4 | **Wice-General** | tier1 | **$101,885** | **-7.0%** | 97 BTC | $6.6M | +$3.3M | 20x |
| 5 | **Kapitan feec** | tier2 | **$101,600** | **-7.2%** | 215 BTC | $14.7M | +$7.2M | 16x |
| 6 | Porucznik SOL2 | tier2 | $94,282 | -13.9% | 25 BTC | $1.7M | +$645K | 20x |
| 7 | Kapitan fce0 | tier2 | $90,472 | -17.4% | 130 BTC | $8.9M | +$2.9M | 20x |
| 8 | Major | tier1 | $75,273 | -31.3% | 200 BTC | $13.7M | +$1.4M | 40x |
| 9 | 58bro.eth | tier2 | $69,034 | -37.0% | 270 BTC | $18.4M | +$202K | 40x |
| 10 | Porucznik SOL3 | tier2 | $66,976 | -38.8% | 31 BTC | $2.1M | -$41K | 20x |

### Dwie fale wejsc

#### Fala 1: "Prescient Shorters" — pazdziernik 2025 (BTC $110-117K)

6 portfeli otwieralo BTC SHORT w ciagu 2 tygodni gdy BTC byl blisko ATH:

| Kto | Kiedy | Cena |
|-----|-------|------|
| Porucznik SOL2 | 1 paz | $117,251 (shortuje NAJWYZEJ!) |
| Kapitan fce0 | 1 paz | $113,896 (tego samego dnia) |
| Kapitan feec | 12 paz | $110,616 |
| Kapitan BTC | 13 paz | $114,963 (dzien po feec) |
| 58bro.eth | 31 paz | $109,500 |
| Kapitan feec | do 16 lis | $94,341 (dodaje po drodze w dol) |

**Kraken A** i **Wice-General** weszli PRZED pazdziernikiem — ich fills nie sa widoczne w oknie od Oct 1. Najwczesiejsi "prescient" shorterzy.

#### Fala 2: "Confirmation Adders" — luty 2026 (BTC $68-75K)

| Kto | Kiedy | Cena | Ruch |
|-----|-------|------|------|
| Galaxy Digital | 3-4 lut | $73-76K | **KUPUJE** — redukuje short! |
| Major | 4-5 lut | $71-73K | Nowy short, 40x |
| Porucznik SOL3 | 6-10 lut | $68-70K | Nowy short, 20x |

Galaxy Digital jedyny ktory aktywnie realizuje zyski. Reszta trzyma albo powieksza.

### Klasterowanie wejsc — przypadek czy koordynacja?

```
1 pazdziernika:    SOL2 + fce0           — 2 portfele tego samego dnia
12-13 pazdziernika: feec + Kapitan BTC   — 2 portfele dzien po dniu
31 pazdziernika:    58bro.eth            — samotny
4-6 lutego:         Major + Galaxy + SOL3 — 3 portfele w 3 dni
```

Dwa klastry sa szczegolnie ciekawe:
- **1 pazdziernika** — 2 niezalezne portfele shortuja BTC tego samego dnia
- **12-13 pazdziernika** — kolejne 2 portfele shortuja dzien po dniu

Mozliwe wyjasnienia:
1. **Zbieznosc** — wszyscy czytali te same dane makro (FED, treasury yields, raporty on-chain)
2. **Koordynacja** — znaja sie, dzielenia sie tezami inwestycyjnymi
3. **Insider info** — ktos wiedzial ze BTC top jest blisko (np. duza sprzedaz OTC, whale outflow z gield)

### Kto "wiedzial najwiecej"? — Scoring

| # | Trader | Timing | Size | Conviction | Risk Mgmt | Total |
|---|--------|--------|------|------------|-----------|-------|
| 1 | **Kapitan BTC** | 9/10 | 9/10 | 10/10 | 7/10 | **35** |
| 2 | **Kapitan feec** | 8/10 | 8/10 | 10/10 | 8/10 | **34** |
| 3 | **Wice-General** | 8/10 | 4/10 | 10/10 | 9/10 | **31** |
| 4 | **Kraken A** | 10/10 | 3/10 | 9/10 | 8/10 | **30** |
| 5 | **Galaxy Digital** | 7/10 | 6/10 | 7/10 | 10/10 | **30** |

**Kapitan BTC wygrywa** — entry 2.6% od ATH, $18.7M pozycji, +$10.5M uPnL, i nadal trzyma.

### 5 podwojnie zweryfikowanych — analiza stylow

Wsrod 5 portfeli z oboma etykietami Nansen (Smart HL Perps Trader + Consistent Perps Winner) wyrozniamy dwa style:

| Styl | Kto | Pozycje | Podejscie |
|------|-----|---------|-----------|
| **Koncentracja** | Major (3 poz), 58bro (7 poz) | Duze rozmiary, duze dzwignie | "Kilka strzalow, kazdy celny" |
| **Dywersyfikacja** | Wice-General (45 poz!) | Male rozmiary, szerokie pokrycie | "Short everything, cos spadnie" |
| **Cash** | Pulkownik (0 poz, $5.5M gotowki) | Zero pozycji | "Wiem kiedy nie grac" |
| **Mid-cap** | Kapitan 99b1 (5 poz, $339K) | Unika BTC/SOL, shortuje LTC/BCH/HYPE | "Szukam slabszych celow" |

**Pulkownik** ma najlepszy ROI z calej piatki (331%) i jedyny jest 100% w gotowce. Lekcja: najlepszy trade to czasem BRAK trade'a.

**Wice-General** ma 45 shortow, z czego **HYPE $16.6M jest underwater (-$547K)** — jego jedyny duzy problem. HYPE to pole minowe.

**58bro.eth** ma BTC SHORT $18.4M na **40x** z liquidation **$90,658** — jesli BTC dotknie $91K, traci wszystko. Trzyma $17.6M w DeFi (Aave/Morpho) osobno. Smart capital allocation ale ryzykowny BTC short.

### Pazdziernik 2025 — kto zarobil na krachu BTC $126K → $103K?

Nansen ujawnil top 8 traderow ktorzy zarobili lacznie **$355M** w pierwszych 2 tygodniach pazdziernika 2025, gdy BTC spadl z $126K do $103K (-18% w 11 dni):

| # | Trader | PnL (1-15 paz) | ROI | Typ |
|---|--------|----------------|-----|-----|
| 1 | **Bitcoin OG #1** | **+$93M** | **4,331%** | Whale — zlikwidowany pozniej |
| 2 | **Bitcoin OG #2** | **+$72.5M** | 381% | Ten sam podmiot, 2. adres |
| 3 | **Abraxas Capital** | +$37.9M | ~0% | Fundusz — wyplacil $144M do Binance |
| 4 | **Galaxy Digital** | +$31.4M | 0.1% | Fundusz — wyplacil $92M |
| 5 | **Fasanara Capital** | +$30.8M | ~0% | Londynski hedge fund |
| 6 | **General (a31211)** | +$30.3M | ~0% | Nasz tier1 VIP |
| 7 | **Silk Capital** | +$29.9M | ~0% | Trading bot |
| 8 | **Wintermute** | +$29.6M | ~0% | Market maker |

**Bitcoin OG** (2 adresy, "Unidentified Entity 1KAt6STt") zarobil lacznie **$165M** z ROI 4,331%. Potem probowal powtorzyc na ETH LONG — i zostal **zlikwidowany 31 stycznia 2026** tracac $128M. Klasyczny cykl: geniusz → overconfidence → katastrofa.

**Kluczowe odkrycie:** Fasanara Capital ($94.5M notional!) i Abraxas Capital ($7.2M) nie byly w naszym VIP Spy — **dodane 21.02.2026**. Fasanara to teraz nasz **najwiekszy trackowany portfel** (wiekszy niz Wice-General i Galaxy Digital razem).

### Lekcja: co mozemy z tego wyciagnac?

1. **Timing matters, ale size wazniejszy.** Kraken A shortuje 1% od ATH ale z $3M. Kapitan BTC shortuje 2.6% od ATH ale z $18.7M i zarabia 6x wiecej.

2. **Klasterowanie wejsc to sygnal.** Gdy 6 niezaleznych portfeli shortuje w 2-tygodniowym oknie — to nie przypadek. Nasz bot powinien reagowac na klastry, nie na pojedyncze ruchy.

3. **Diamond Hands dziala — ale z ryzykiem.** Ci traderzy trzymaja shorty 4+ miesiecy. Funding kosztuje (~$6M lacznie) ale uPnL ($32M) wielokrotnie to rekompensuje.

4. **Galaxy Digital jedyny kto redukuje** — jako fund maja lepszy risk management. Realizacja zysku to tez umiejetnosc, nie tylko wchodzenie.

5. **Zero BTC LONG wsrod top traderow.** Absolutny consensus. Gdy najlepsi nie widza powodu zeby longowac — nie longuj.

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

*Ostatnia aktualizacja: 22 lutego 2026 (server health audit — prediction-api fix, sui-price-alert usuniety, hourly/whale report → cron, ai-executor fix, Selini Capital removed, AI Trend Reversal fix, VIP Intelligence 25 portfeli)*
*Wygenerowane przez Claude Code*
