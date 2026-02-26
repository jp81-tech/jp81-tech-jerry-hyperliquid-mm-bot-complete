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
14. [Sesja 22.02 -- Trzy bugi ktore kradly nam edge](#sesja-2202----trzy-bugi-ktore-kradly-nam-edge)
15. [Rozdzial X: XGBoost + Rozszerzenie 8 tokenow/5 horyzontow](#rozdzial-x-xgboost--jak-dalismy-botowi-prawdziwy-mozg)
16. [Naming Convention — jeden trader, jedna nazwa](#naming-convention--jeden-trader-jedna-nazwa)
17. [Whale Changes Report — radar zmian pozycji](#whale-changes-report--radar-zmian-pozycji)
18. [Fib Guard — nie shortuj dna](#fib-guard--nie-shortuj-dna)
19. [VIP Flash Override — szpieg ratuje sytuacje](#vip-flash-override--szpieg-ratuje-sytuacje)
20. [LIT Vesting — anatomia Nansen alertu](#lit-vesting--anatomia-nansen-alertu)
21. [Czyszczenie danych — Fasanara, Dormant Decay, Manual Boost](#czyszczenie-danych--fasanara-dormant-decay-manual-boost)
22. [Pump Shield — ochrona shortow przed pumpami](#pump-shield--ochrona-shortow-przed-pumpami)
23. [Slowniczek](#slowniczek)
24. [Rozdzielenie bota — PURE_MM vs SM_FOLLOWER](#rozdzielenie-bota--pure_mm-vs-sm_follower-bot_mode)
25. [Momentum Guard — nie kupuj szczytow, nie shortuj den](#momentum-guard--nie-kupuj-szczytow-nie-shortuj-den)

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

### Bug #17: prediction-api Smart Money = zero — data structure mismatch (22.02)

`prediction-api` to serwis ML ktory przewiduje kierunek ceny. Ma 5 komponentow: technical (20%), momentum (15%), trend (15%), volume (10%) i **Smart Money (40%)**. SM to najwazniejszy komponent — to nasz edge.

Problem: SM signal byl **zawsze zero** dla kazdego tokena. Wynik: model opieraral sie tylko na 60% swoich danych (technicals), a 40% (SM) bylo martwe. FARTCOIN z 44:1 SHORT ratio dostal `smartMoney: 0` — jakby wieloryby w ogole nie istnialy.

**Root cause:** `NansenFeatures.ts` szukal danych w zlym miejscu:

```
Kod szukal:         parsed.tokens["LIT"].total_long_usd
Plik mial:          parsed.data["LIT"].current_longs_usd
                          ^^^^            ^^^^^^^^^^^^^^^^
                          inna sciezka    inne nazwy pol
```

To klasyczny **integration bug** — dwa komponenty pisane niezaleznie, nigdy nie przetestowane razem. `whale_tracker.py` (Python) generuje plik JSON z jednym formatem, `NansenFeatures.ts` (TypeScript) czyta go z oczekiwaniem innego formatu. Nikt nie zweryfikowal kontraktu miedzy nimi.

Drugi mismatch: `nansen_bias.json` mial pola `boost` (0-2) i `direction` ("short"/"long") ale kod szukal `bias` (-1 do +1) i `confidence` (0-100).

**Fix:**
- `parsed.tokens` → `parsed.data`
- `total_long_usd` → `current_longs_usd`
- `total_short_usd` → `current_shorts_usd`
- Derive bias from `direction` + `boost`
- Use `tradingModeConfidence` for confidence

**Wynik:**
| Token | Przed | Po |
|-------|-------|----|
| FARTCOIN | SM=0, conf=16% | **SM=-0.487, conf=36%** (44:1 SHORT!) |
| LIT | SM=0, conf=24% | **SM=-0.198, conf=31%** |
| HYPE | SM=0, conf=28% | SM=0, conf=28% (prawidlowo NEUTRAL) |

**Lekcja:** Kiedy dwa systemy komunikuja sie przez plik/API, **napisz test integracyjny**. Nawet prosty skrypt `node -e "read file, check field exists"` zlapalby ten bug w sekundzie. Bez testu — bug przetrwal miesiace niezauwazony, bo model "dzialal" (dawal predykcje) ale z 40% mocy.

To jak samochod z odpieta turbosprezzarka — jedzie, wygrywa przyspieszenie, ale nigdy nie siega pelnej mocy. Dopiero jak sprawdzisz pod maska, widzisz ze turbo jest odlaczone.

### Bug #18: ai-executor zly kanal Nansen (22.02)

`ai-executor` pollowal Telegram kanal `-1003724824266` — ale ten kanal nie istnial! Prawidlowy kanal Nansen alerts to `-1003886465029` ("BOT i jego Sygnaly").

Efekt: alerty SM OUTFLOW/INFLOW nie trafialy do bota od czasu zmiany kanalu. Bot jezdzil na starych danych.

**Fix:** Zmiana `NANSEN_ALERT_CHAT_ID` w `.env.ai-executor`.

**Weryfikacja:** Bot jest administratorem prawidlowego kanalu, aktywnie polluje (409 Conflict potwierdza), czeka na nastepne alerty.

**Lekcja:** Kiedy cos "nie dziala", sprawdz **czesc po czesci**: (1) Czy mam prawidlowy target? (2) Czy mam dostep? (3) Czy dane plyna? Tutaj problem byl w kroku 1 — zly kanal ID. Reszta (token, uprawnienia, kod) byla OK.

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

### 8. Integration contracts — testuj granice miedzy systemami

Nasz prediction-api mial 40% wagi martwej przez miesiace bo `NansenFeatures.ts` czytal `parsed.tokens` zamiast `parsed.data`. whale_tracker (Python) pisal jedno, prediction-api (TypeScript) czytalo drugie. Nikt tego nie przetestowal.

To jest **najczestszy typ buga w systemach z wieloma komponentami**: kazdy komponent dziala sam, ale polaczenie miedzy nimi jest zepsute. API endpoint zwraca JSON, ale klient szuka zlego pola. Database ma kolumne `created_at`, ale ORM mapuje na `createdAt`.

**Rozwiazanie:** Integration tests. Nawet prosty:
```bash
# Czy prediction-api widzi SM data?
curl localhost:8090/predict/LIT | jq '.prediction.signals.smartMoney'
# Jesli 0 — cos jest nie tak
```

To jak testowanie czy kabel jest podlaczony zanim szukasz problemu w komputerze.

### 9. Audytuj swoje zalozenia

4 z 14 TIER 1 wielorybow zamknelo konta. Bitcoin OG zostal zlikwidowany. Zalozenie "ci traderzy sa Smart Money" przestalo byc prawdziwe dla tych adresow.

Regularnie sprawdzaj czy twoje zalozenia nadal obowiazuja. W kodzie: czy ten config jest aktualny? Czy te hardcoded adresy nadal sa aktywne? Czy ta biblioteka jest nadal utrzymywana?

### 10. PM2 delete gubi server-side edits

Zrobilismy `pm2 delete prediction-api && pm2 start dist/prediction/dashboard-api.js` — i proces sie uruchomil ale port 8090 nie sluchal. Fix `if (true)` w `dashboard-api.js` zrobiony wczesniej na serwerze dzialal, bo PM2 restart laduje ten sam plik. Ale `pm2 delete + start` zresetowal PM2 metadata (nowy id), a plik moglby byc nadpisany przy git pull/build.

**Lekcja:** Server-side hotfixy sa kruche. Jesli musisz je robic:
1. Zapisz co zmieniasz i gdzie (w CLAUDE.md)
2. Po kazdym `pm2 delete` lub `git pull` — sprawdz czy fix nadal jest
3. Najlepiej: commit fix do repo zeby `git pull` go nie nadpisal

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

## Naming Convention — jeden trader, jedna nazwa

### Problem: "Kto to w ogole jest?"

Wyobraz sobie ze dostajesz trzy alerty:

```
whale_tracker: "SM Conviction a31211 opened SHORT LIT $3.3M"
daily-whale-report: "General a31211 — SHORT LIT $3.3M"
SmAutoDetector: "SM Conviction a31211: FOLLOW_SM_SHORT 57%"
```

Czy to ten sam trader? Tak! Ale musisz w glowie zrobic mapping `a31211 = General = SM Conviction`. Przy 30+ wielorybach i 3 roznych plikach to sie robi nie do ogarniecia.

### Rozwiazanie: Canonical Source

Stworzylismy `scripts/vip_config.json` jako **jedyne zrodlo prawdy** z memorable aliasami. Nazwy sa po polsku (to bot dla polskiego usera!) i latwe do zapamietania:

| Ranga | Trader | Dlaczego ta nazwa |
|-------|--------|-------------------|
| **General** | `a31211` — $15M PnL, LIT/FARTCOIN shorter | Najwyzszy rang w naszej armii wielorybow |
| **Wice-General** | `45d26f` — $30M PnL, BTC/HYPE mega shorter | Drugi w hierarchii |
| **Pulkownik** | `5d2f44` — $21M PnL, BTC $46M SHORT | Trzeci — "pulkownik" bo trzyma ogromna pozycje |
| **Major** | `35d115` — $12M PnL, SOL $65M SHORT | Czwarty — MEGA shorter na SOL |
| **Kapitan BTC** | `71dfc0` — BTC $25M SHORT | Specjalista BTC |
| **Kraken A/B** | `06cecf`, `56cd86` — timing entry masters | "Kraken" bo pojawiaja sie z glebokosci jak potwor morski |
| **Porucznik SOL2/SOL3** | `6bea81`, `936cf4` — SOL shorterzy | Nizsi rang, ale solid SM |

### Lekcja: Single Source of Truth

To klasyczny problem w inzynierii oprogramowania. Masz dane w 3 miejscach i kazde miejsce ma swoja wersje. Rozwiazanie zawsze to samo:

1. **Wyznacz jedno zrodlo prawdy** (`vip_config.json`)
2. **Zsynchronizuj reszty** z tym zrodlem
3. **Idealnie**: reszta powinna *czytac* ze zrodla zamiast kopiowac (DRY principle)

My zrobilismy krok 1-2 (reczna synchronizacja). Krok 3 (dynamiczne czytanie z vip_config) to potencjalna przyszla optymalizacja — ale na razie 3 pliki z tymi samymi nazwami to wystarczajaco dobre rozwiazanie. Nie overengineeruj.

### Co zmienilismy

| Plik | Rola | Ile zmian |
|------|------|-----------|
| `whale_tracker.py` | Glowne `"name"` pola w WHALES dict | 19 traderow |
| `scripts/daily-whale-report.ts` | `name` pola w WHALES dict (Discord report) | 16 traderow |
| `src/mm/SmAutoDetector.ts` | `label` pola w KNOWN_TRADERS dict (bot runtime) | 5 traderow |

**Czego NIE ruszylismy:**
- `NANSEN_SM_LABELS` w whale_tracker.py — wyglada jak lista nazw, ale to tak naprawde **kategorie Nansen** ("Smart HL Perps Trader", "Fund"). Sa uzywane w `CREDIBILITY_MULTIPLIERS` do obliczania wagi sygnalu. Zmiana "Smart HL Perps Trader" na "General" by zlamala lookup i trader dostalby wage 0.20 (Unknown) zamiast 1.0. **Zawsze czytaj kod zanim zmienisz** — nazwy moga byc kluczami w innym dicu.

---

## VIP Flash Override — szpieg ratuje sytuacje

### Problem: General flipnal, bot tego nie widzial

23 lutego 2026, godzina 20:51 UTC. General — nasz najwazniejszy trader (weight 0.95, lacznie +$15M zysku) — flipnal swoja pozycje na LIT z SHORT na LONG. Pozycja: $192K.

Bot tego nie zauwazyl. Dlaczego?

**whale_tracker.py** aktualizuje dane co 15 minut przez cron. Ale nawet po aktualizacji, problem nie zniknal — bo whale_tracker patrzy na **agregat wszystkich traderow**. A agregat wyglada tak:

```
Wice-General:      LIT SHORT $353K  (weight 0.90)
Laurent Zeimes:    LIT SHORT $1.29M (weight 0.70)
Inni SM:           LIT SHORT $XXK
General:           LIT LONG  $192K  (weight 0.95)  ← FLIP!
                   ─────────────────────────
Agregat:           FOLLOW_SM_SHORT 46%
```

General flipnal, ale reszta nadal shortuje. Agregat mowi "FOLLOW_SM_SHORT". Bot kontynuuje shortowanie LIT.

To jest klasyczny problem **"glos wiekszosci vs glos eksperta"**. Wyobraz sobie glowodowodzacego armii (General) ktory mowi "wycofujemy sie!", ale jego 5 oficerow mowi "atakujemy!". System demokratycznego glosowania kaze atakowac. Ale General wie cos czego oficerowie nie wiedza.

### Rozwiazanie: VIP Flash Override

Pomysl jest prosty: mamy juz `vip_spy.py` (PM2, polling co 30 sekund), ktory zapisuje aktualne pozycje VIPow do `/tmp/vip_spy_state.json`. Ten plik jest **50x swiezszy** niz whale_tracker (30s vs 15min).

Po tym jak `analyzeTokenSm()` oblicza mode z agregatu, dodajemy "szybka sciezke":

```
1. Czytaj /tmp/vip_spy_state.json (30s fresh)
2. Dla kazdego tokenu w trybie kierunkowym (FOLLOW_SM_SHORT/LONG):
   a. Znajdz VIPow z signalWeight >= 0.90
   b. Czy maja pozycje >= $50K na tym tokenie?
   c. Czy ich pozycja DISAGREES z aktualnym modem?
3. Jesli DISAGREE → downgrade do PURE_MM
```

### Dlaczego PURE_MM a nie flip?

To kluczowa decyzja architektoniczna. Mielismy dwie opcje:

**Opcja A: Flip na FOLLOW_SM_LONG** — ZLE
- 5 traderow nadal shortuje, General jest jedynym longiem
- Co jesli General sie myli? Co jesli to trap?
- Agresywne flipowanie na podstawie jednego VIPa = ryzyko

**Opcja B: Downgrade na PURE_MM** — BEZPIECZNE
- Przestajemy shortowac (nie ladujemy nowych shorów)
- Nie otwieramy longow (bo inni SM nadal shortuja)
- Czekamy na nastepny whale_tracker run (15 min)
- Jesli agregat potwierdzi flip → bot sam przejdzie na FOLLOW_SM_LONG

To jest zasada **"kiedy sie nie zgadzasz, nie rob nic"**. W tradingu nie musisz ciagle miec pozycji. Czasem najlepsza decyzja to wyjsc na bok i poczekac az sytuacja sie wyjasni. Warren Buffett nazwalby to "circle of competence" — nie wchodzisz w transakcje ktorych nie rozumiesz.

### Analogia: System wczesnego ostrzegania

Wyobraz sobie radar wojskowy. Masz dwa systemy:

| System | Czas aktualizacji | Co widzi |
|--------|-------------------|----------|
| **whale_tracker** (satelita) | co 15 min | Cale pole bitwy — wszystkie oddzialy, pozycje, sily |
| **vip_spy** (dron) | co 30 sekund | Tylko generala i kilku kluczowych oficerów — ale w czasie rzeczywistym |

Satelita daje pelny obraz ale z opoznieniem. Dron widzi mniej ale natychmiast. VIP Flash Override laczy oba: "Satelita mowi atakuj, ale dron widzi ze General sie wycofal. Wstrzymaj natarcie do nastepnego zdjecia satelitarnego."

### Implementacja — ~50 linii kodu

Cala zmiana miesci sie w jednym pliku: `src/mm/SmAutoDetector.ts`.

**Stalye konfiguracyjne:**
```typescript
const VIP_FLASH_MIN_WEIGHT = 0.90       // Tylko top VIPy
const VIP_FLASH_MIN_POSITION_USD = 50_000  // Ignoruj dust
const VIP_SPY_STATE_PATH = '/tmp/vip_spy_state.json'
```

**Helper:**
```typescript
async function readVipSpyState() {
  try {
    const content = await fsp.readFile(VIP_SPY_STATE_PATH, 'utf-8')
    return JSON.parse(content)
  } catch {
    return null  // File missing → skip, normalne zachowanie
  }
}
```

**Override (po analyzeTokenSm, przed cache):**
```typescript
const vipState = await readVipSpyState()
if (vipState) {
  for (const [token, analysis] of newAnalysis.entries()) {
    if (analysis.mode !== FOLLOW_SM_SHORT && analysis.mode !== FOLLOW_SM_LONG) continue

    for (const [address, positions] of Object.entries(vipState)) {
      const trader = KNOWN_TRADERS[address]
      if (!trader || trader.signalWeight < 0.90) continue

      const vipPos = positions[token]
      if (!vipPos || vipPos.position_value < 50_000) continue

      const disagrees = (isShortMode && vipIsLong) || (!isShortMode && !vipIsLong)
      if (disagrees) {
        analysis.mode = MmMode.PURE_MM  // Stop, don't flip
        analysis.convictionScore = 0
        break  // Jeden disagreement wystarczy
      }
    }
  }
}
```

Zwroc uwage: **zero nowych importow, zero nowych plikow, zero npm dependencies**. Uzywamy istniejacych: `fsp` (juz importowany), `KNOWN_TRADERS` (juz istnieje), `MmMode` (juz istnieje). To jest dobra inzynieria — maksymalne reuse.

### Edge cases i defensive coding

| Case | Co sie stanie | Dlaczego to OK |
|------|---------------|----------------|
| vip_spy_state.json nie istnieje | `readVipSpyState()` → null → skip | vip_spy moze byc wylaczony |
| VIP ma pozycje < $50K | Skip | Moze to dust, reszta z zamknietej pozycji |
| Dwoch VIPow: jeden zgadza, drugi nie | Pierwszy disagreement → PURE_MM | Ostroznosc wygrywa |
| VIP nie ma pozycji na tokenie | Skip | Brak danych ≠ disagreement |
| PURE_MM lub FLAT | Skip | Nie override'ujemy neutralnych modow |

`try/catch` w `readVipSpyState()` to przyklad defensive coding — plik moze byc uszkodzony (np. vip_spy w polowie zapisu), JSON moze byc niepoprawny. Zamiast crashowac bota, po prostu skipujemy override. Bot dziala dalej z agregatu whale_tracker.

### Lekcje

**1. Szybkosc danych > ilosc danych.** whale_tracker ma dane od 30+ traderow ale co 15 min. vip_spy ma dane od 4 ale co 30s. W tradingu, 30-sekundowy signal od jednego top VIPa jest cenniejszy niz 15-minutowy konsensus 30 traderow. Rynki poruszaja sie szybko.

**2. Nie flipuj — parkuj.** Kiedy sygnaly sa sprzeczne, najgorsza decyzja to agresywnie postawic na jedna strone. Najlepsza: wyjsc na bok (PURE_MM) i poczekac na potwierdzenie. To jest odpowiednik "I don't know" w inwestowaniu — i to jest OK.

**3. Post-processor pattern.** VIP Flash Override nie modyfikuje `analyzeTokenSm()`. Dziala POTEM — po analizie, przed cache. To minimalna ingerencja. Gdyby cos poszlo nie tak, wystarczy usunac 40 linii i wrocic do starego zachowania. Dobra architektura pozwala na latwy rollback.

**4. Hierarchia dowodzenia.** W armii i w tradingu: kiedy General mowi cos innego niz oficerowie, sluchasz Generala. Ale nie sledzo — nie atakujesz gdzie General, tylko wstrzymujesz natarcie. Bo moze General tez sie myli. Czekasz na potwierdzenie.

**5. Reuse > nowy kod.** Ta zmiana to 50 linii w istniejacym pliku. Zero nowych plikow, zero importow, zero dependencies. Uzywamy juz istniejace: `KNOWN_TRADERS`, `fsp`, `MmMode`, `vip_spy_state.json`. Najlepszy kod to ten ktorego nie trzeba pisac.

---

## LIT Vesting — anatomia Nansen alertu

### Co sie stalo

24 lutego 2026, Nansen wysyla alert:

> **Fresh wallets received $17.5M of LIT in the last 24 hours (76.47x the recent average)**

76x powyzej sredniej! Brzmi dramatycznie. "Fresh wallets" to portfele utworzone w ciagu ostatnich 15 dni. $17.5M naplywu do swiezych portfeli.

Pierwsza mysl: ktos akumuluje LIT? Insiderzy kupuja przed wielkim ruchem?

### Dochodzenie — co naprawde sie stalo

Analiza transferow z Nansen pokazala dokladne zrodlo:

| Kwota | Skad | Dokad |
|-------|------|-------|
| **$11.1M** | `Lighter: LIT Distributor` | "Token Millionaire" (0xb3058a) |
| **$5M** | `Lighter: LIT Distributor` | Lightspeed Fund VC (0x1190ce) |
| **$1.5M** | `Lighter: LIT Distributor` | kolejny "Token Millionaire" |

To nie jest "ktos akumuluje". To **oficjalna dystrybucja tokenow z kontraktu projektu**. Vesting/unlock — tokeny zespolu i inwestorow sa blokowane na 1 rok z 3-letnim vestingiem, i wlasnie zaczely sie odblokowywac.

### Dlaczego to wazne dla bota

**Vesting = supply unlock = presja sprzedazowa.** Kiedy insiderzy/VC dostaja odblokowane tokeny, czesto je sprzedaja (albo natychmiast, albo stopniowo). $17.5M nowego supply na rynku to duzo dla tokenu z ~$150M market cap.

**Ale nasz General ma LIT LONG $192K.** Dlaczego?

Mozliwe wyjasnienia:
1. **Wie o buybackach** — Lighter ma program buybackow z oplat protokolu ($30-40M planowane). Buybacki = popyt ktory absorbuje supply
2. **Kontrarianski play** — wszyscy shortuja po unlock, General idzie long bo spodziewa sie odwrotnej reakcji
3. **Inne informacje** — jako wieloryb z Nansen label "Smart HL Perps Trader", moze miec dostep do flow data ktorego my nie widzimy

### Kontekst fundamentalny LIT/Lighter

| Metryka | Wartosc | Sygnał |
|---------|---------|--------|
| Dominacja DEX perps | 60% → 8.1% | Bearish (strata udzialu) |
| Cena | ATH $3+ → $1.35 | Bearish (spadek ~55%) |
| Buyback program | $30-40M planowane | Bullish long-term |
| VC inwestorzy (Lightspeed) | Odbieraja tokeny | Neutral/Bearish short-term |

### Lekcja: Nie reaguj emocjonalnie na alerty

Ten alert jest idealnym przykladem dlaczego **trzeba kopac glebiej zanim podejmiesz decyzje**:

1. **Naglowek**: "76x average! $17.5M! Fresh wallets!" — brzmi bullish (ktos kupuje!)
2. **Rzeczywistosc**: Oficjalny unlock vestingu — bearish (wiecej supply)
3. **Kontekst**: General jest long mimo unlock — mixed signals

Gdyby bot zareagowal na sam naglowek alertu, moglby kupic LIT (bo "ktos akumuluje"). W rzeczywistosci to unlock vestingu = wiecej tokenow na rynku = presja sprzedazowa.

**Zasada: Alert to poczatek dochodzenia, nie koniec.** Zawsze sprawdz zrodlo transferow zanim zinterpretujesz naglowek.

### Co bot faktycznie robi z LIT teraz

```
whale_tracker agregat:  Mixed signals (conviction 43%)
SignalEngine:           WAIT zone → PURE_MM
VIP Flash Override:     Gotowy, ale LIT juz w PURE_MM → skip
Generał (vip_spy):      LONG $192K

Rezultat: PURE_MM — bot nie shortuje, nie longuje, czeka
```

To jest najrozsadniejsza decyzja. Mixed signals + vesting unlock + General long = nie rob nic. Czekaj na potwierdzenie.

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

## Sesja 22.02 -- Trzy bugi ktore kradly nam edge

Dzis naprawilismy trzy bugi. Dwa z nich byly cicho zepsute od tygodni. Jeden nigdy nie dzialal. Kazdy z nich to inna lekcja o tym jak dane plyna przez system i jak latwo je zgubic po drodze.

### Sesja Bug #3: General vs Analityk (Conviction Override)

#### Historia

Wyobraz sobie sztab wojenny. General (whale_tracker.py) od godzin obserwuje pole bitwy. Widzi ze SHORT pozycje zarabiaja +$1.4M a LONG pozycje sa pod woda na -$64K. Mowi: "Shortuj LIT. 57% pewnosci."

W kacie siedzi Analityk (SignalEngine) z kalkulatorem. Bierze surowe dane -- $3.3M shortow vs $2.46M longow -- i liczy ratio: 1.34. Sprawdza tablice: prog "moderate" to 2.0. Ratio jest za male. Wynik: 11 na 50. Analityk mowi: "11 to strefa WAIT. Nie jestem pewien niczego. Grajmy na obie strony."

Bot sluchal Analityka i ignorowal Generala.

#### Co sie dzialo w kodzie

W `src/mm/SmAutoDetector.ts`:

1. `whale_tracker.py` produkuje dane: `trading_mode: "FOLLOW_SM_SHORT"`, `trading_mode_confidence: 57`. Ta pewnosc bierze sie z **glebokiej analizy** -- nie tylko kto ma wieksze pozycje, ale **kto wygrywa** (PnL analysis).

2. Dane ida do `SignalEngine.analyze()` w `src/core/strategy/SignalEngine.ts`. Patrzy na short/long ratio (1.34x dla LIT). Dla LIT, prog `moderateRatio` to 2.0 (linia 248 w `TOKEN_CONFIGS`). 1.34 < 2.0, wiec ratio nawet nie rejestruje sie jako "moderate".

3. SignalEngine liczy `hlPerpsScore` na okolo 11. Score laduje miedzy -25 a +25 -- to strefa **WAIT**. Zwraca `action: 'WAIT'`.

4. Z powrotem w SmAutoDetector, stary kod **zawsze** wymuszal PURE_MM gdy Engine mowil WAIT:
   ```typescript
   // STARY KOD (bug):
   if (engineSignal.action === 'WAIT') {
     engineOverrideMode = 'PURE_MM';
     dominantSide = 'NEUTRAL';
   }
   ```

5. Bot zaczyna market-making na obie strony. Sklada zlecenia kupna I sprzedazy. Jesli LIT spada (jak oczekuja wieloryby), nasze zlecenia kupna sie realizuja i kupujemy w spadajacy noz. 57% SHORT conviction Generala idzie na marne.

#### Dlaczego General widzi wiecej niz Analityk

To jest kluczowy insight. General i Analityk patrza na **te same dane** ale zadaja **rozne pytania**.

Analityk pyta: "Jak bardzo nierownomierne jest ratio?"
- $3.3M short vs $2.46M long = 1.34x. Nic specjalnego.

General pyta: "Kto wygrywa?"
- Shorty zarabiaja +$1.4M niezrealizowanego zysku
- Longi sa pod woda -$64K
- Wygrywajaca strona rosnie z czasem

Widzisz roznice? 1.34x ratio nie brzmi ekstremalnie. Ale kiedy dowiadujesz sie ze strona shortowa zarabia $1.4M a longowa tonie, obraz sie zmienia. General uwzglednia PnL, momentum, trend historyczny i squeeze detection. Analityk widzi tylko ratio i flow.

To jest jak roznica miedzy "Dwie armie sa podobnej wielkosci" (Analityk) a "Jedna armia wygrywa na kazdym froncie i ma inicjatywe" (General).

#### Fix

W `src/mm/SmAutoDetector.ts`, linia ~702:

```typescript
if (engineSignal.action === 'WAIT') {
  // NOWE: Engine nie pewien -- ale whale_tracker moze miec
  // analize PnL ktorej Engine nie widzi
  if (whaleTrackerConfidence >= 50 && whaleTrackerMode &&
      !whaleTrackerMode.includes('NEUTRAL')) {
    // whale_tracker ma wysoka pewnosc z analizy PnL
    // (shorty wygrywaja, longi pod woda itd.)
    // SignalEngine widzi tylko ratio ktore moze wygladac "niewystarczajaco"
    // -- zaufaj whale_tracker
    engineOverrideMode = whaleTrackerMode;
    engineOverrideConfidence = whaleTrackerConfidence;
  } else {
    // Niska pewnosc whale_tracker lub NEUTRAL -- PURE_MM
    engineOverrideMode = 'PURE_MM';
    engineOverrideConfidence = Math.abs(engineSignal.score);
    dominantSide = 'NEUTRAL';
  }
}
```

Tlumaczenie: "Gdy Analityk wzrusza ramionami, sprawdz czy General ma silne przekonanie. Jesli General jest 50%+ pewny z kierunkowym callem, zaufaj Generalowi."

#### Dlaczego akurat 50%?

Ponizej 50%, nawet sam `whale_tracker.py` nie jest pewien. Jego confidence score juz uwzglednia momentum penalty, squeeze detection i PnL divergence. Jesli po calej tej analizie osiaga tylko 43%, sygnal naprawde jest niejednoznaczny i PURE_MM (hedge na obie strony) jest bezpieczniejszy.

#### Plot twist

Po deployu sprawdzilismy LIT. Confidence spadlo do 43% bo wieloryby zmniejszyly SHORT pozycje (General zszedl z $7.4M do $3.3M short na LIT). Wiec LIT i tak zostal w PURE_MM -- ale tym razem poprawnie, bo dane naprawde oslably.

Ale **ZEC** udowodnil ze fix dziala: 70% confidence, CONTRARIAN_SHORT mode. Bez fixa SignalEngine wymuszalby PURE_MM z 11% conviction. Z fixem poprawnie trzyma CONTRARIAN_SHORT na 70%.

#### Lekcja

**Gdy dwa systemy sie nie zgadzaja, zrozum co kazdy z nich widzi.** Analityk robil waski osad (tylko ratio), General mial szersza perspektywe (ratio + PnL + trendy). Fix to nie "zawsze ufaj Generalowi" -- to "gdy Analityk mowi 'nie wiem', oddaj glos temu kto ma wiecej informacji."

---

### Sesja Bug #5: Przeterminowany raport wywiadu

#### Historia

Bot ma model ML ktory przewiduje ceny. Model wazy piec czynnikow, a najwazniejszy -- Smart Money positions (40% wagi) -- pochodzi z pliku `/tmp/nansen_bias.json`. Ten plik powinien byc aktualizowany co 15 minut przez `whale_tracker.py`.

Plik mial **20 dni**. Przez prawie trzy tygodnie model ML robil prognozy na podstawie pozycji wielorybow z 2 lutego, a nie dzisiejszych.

W te 20 dni General zredukowal LIT SHORT z $7.4M do $3.3M. Pulkownik zamknal caly $46M BTC SHORT. Bitcoin OG zostal zlikwidowany na -$128M. Caly krajobraz sie zmienil, a model patrzyl na zdjecie sprzed trzech tygodni.

#### Jak to sie stalo

Dwa pliki zyja w `/tmp`:
- `smart_money_data.json` -- szczegolowe dane pozycji wielorybow
- `nansen_bias.json` -- uproszczone wyniki bias dla modelu ML

Oba pisze `whale_tracker.py`. Ale jest haczyk: **inny** proces (`whale_tracker_live`) pisal `smart_money_data.json` periodycznie. NIE pisze `nansen_bias.json`.

Wiec na serwerze:
```bash
ls -la /tmp/smart_money_data.json   # Swiezy! Zaktualizowany 10 min temu
ls -la /tmp/nansen_bias.json         # 2 lutego. Dwadziescia dni temu.
```

Mozesz zerknac na pierwszy plik, zobaczyc ze swiezy, i zalozyc ze wszystko gra. Ale drugi plik -- ten od ktorego zalezy model ML -- jest antyczny.

Przyczyna? `whale_tracker.py` **nie byl w crontabie**. Kiedys dzialal, ale gdzies po drodze wpis cron zniknal (moze przy migracji serwera). Nikt nie zauwazyl bo `smart_money_data.json` byl swiezy dzieki innemu procesowi.

#### Fix

```bash
crontab -e
# Dodane:
*/15 * * * * cd /home/jerry/hyperliquid-mm-bot-complete && python3 whale_tracker.py
```

Jedna linijka crona. Najprostszy fix w calej sesji, ale najbardziej impaktowy: 40% wagi predykcji modelu ML bylo martwe.

#### A bylo jeszcze gorzej: NansenFeatures mismatch

Wczesniej w tej sesji odkrylismy ze `src/prediction/features/NansenFeatures.ts` -- kod ktory CZYTA te pliki -- mial rozjazd nazw pol:

| Co kod szukal | Co plik zawieral |
|---------------|-----------------|
| `parsed.tokens[token]` | `parsed.data[token]` |
| `total_long_usd` | `current_longs_usd` |
| `total_short_usd` | `current_shorts_usd` |
| `tokenBias.bias` | Wyliczane z `tokenBias.direction` + `tokenBias.boost` |
| `tokenBias.confidence` | `tokenBias.tradingModeConfidence` |

Wiec nawet GDYBY dane byly swieze, kod nie mogl ich odczytac. Sygnal `smartMoney` w prognozach byl **zawsze zero** dla kazdego tokena. Model ML dzialal z 40% wagi produkujaca nic. Od zawsze.

Po naprawie obu problemow (mapping kodu + cron job):

| Token | SM (przed) | SM (po) |
|-------|-----------|---------|
| HYPE | 0.000 | 0.000 (prawidlowo -- longi i shorty zbalansowane) |
| LIT | 0.000 | **-0.198** (bearish, ratio -0.28, conviction 58%) |
| FARTCOIN | 0.000 | **-0.487** (bearish, 44:1 SHORT, conviction 95%) |

#### Lekcja: Dwa debugging tipy ktore kazdy powinien znac

**Tip 1: Zawsze sprawdzaj KTO pisze kazdy plik, nie tylko CZY istnieje.**

| Plik | Kto pisze | Kto czyta | Czestotliwosc |
|------|-----------|-----------|---------------|
| `smart_money_data.json` | whale_tracker.py + whale_tracker_live | SmAutoDetector.ts | co 15 min |
| `nansen_bias.json` | **TYLKO** whale_tracker.py | NansenFeatures.ts | co 15 min |

Gdybys mial taka tabelke, od razu zobaczylbys ze `whale_tracker.py` potrzebuje crona.

**Tip 2: `ls -la` to twoj najlepszy przyjaciel.**

Nie sprawdzaj tylko "czy plik istnieje". Sprawdz **kiedy byl ostatnio modyfikowany**:
```bash
ls -la /tmp/nansen_bias.json
# -rw-r--r-- 1 jerry jerry 4096 Feb  2 14:30 nansen_bias.json
#                                  ^^^^^ 20 DNI TEMU!
```

To jest trojwarstwowa awaria:
1. **Writer nie dziala** (brak crona)
2. **Bledne zalozenie** ("plik jest swiezy" -- tak, ale ZLY plik)
3. **Reader zepsuty** (rozjazd nazw pol w NansenFeatures.ts)

Kazda z tych warstw wystarczylyby zeby zabic sygnal. Wszystkie trzy byly zepsute jednoczesnie.

---

### Sesja Bug #6: Odlaczony Wyrocznia

#### Historia

Bot ma silnik predykcji cen. Nazywamy go Wyrocznia (Oracle). Bierze swieczki 5-minutowe (OHLCV), odpala analize techniczna (RSI, MACD, Bollinger Bands), laczy z danymi on-chain przez model ML i produkuje prognozy typu: "LIT bedzie po $1.52 za godzine, 65% confidence, BEARISH."

Wyrocznia byla juz zbudowana. Metoda `getOracleGridBias()` istniala w `src/mm_hl.ts` (okolo linii 5492). Bierze symbol coina, szuka sygnalu Wyroczni w cache i zwraca mnozniki bid/ask ktore przesunelby grid w kierunku przewidywanym:

```typescript
getOracleGridBias(coin: string): { bidMult: number; askMult: number; reason: string } {
    const signal = this.oracleSignalCache.get(coin)
    if (!signal || signal.confidence < 30) {
      return { bidMult: 1.0, askMult: 1.0, reason: 'Oracle: No signal or low confidence' }
    }
    // Score > 60: bullish -> wiecej bidow, mniej askow
    // Score < -60: bearish -> mniej bidow, wiecej askow
}
```

Problem? **Nikt nigdy nie wywolal tej metody.** Idealna funkcja siedzaca w codebase, podlaczona do niczego. Wyrocznia mogla widziec przyszlosc (poniekad), ale nikt nie sluchal.

#### Co zrobilismy

Dodalismy wywolanie `getOracleGridBias()` w petli generowania grida (okolo linii 8051 w `mm_hl.ts`):

```typescript
// Monitoring dywergencji Wyroczni (tylko logowanie -- zero akcji tradingowych)
try {
  const oracleBias = this.getOracleGridBias(symbol)
  if (oracleBias.reason !== 'Oracle: No signal or low confidence') {
    const smMode = overridesConfig?.followSmMode || permissions.reason || 'PURE_MM'
    console.log(`[ORACLE] ${symbol}: ${oracleBias.reason} | SM mode: ${smMode}`)

    // Flaguj dywergencje: Wyrocznia bullish ale SM mowi SHORT, lub odwrotnie
    const oracleBullish = oracleBias.bidMult > 1
    const smShort = smMode.includes('SHORT')
    if (oracleBullish && smShort) {
      console.log(`[ORACLE] ${symbol}: DYWERGENCJA -- Oracle BULLISH vs SM SHORT`)
    }
  }
} catch (e) { /* nie zabij bota przez logowanie */ }
```

#### Dlaczego TYLKO logowanie? (To jest wazne)

Celowo NIE dodalismy biasu Wyroczni do faktycznych decyzji tradingowych. Dlaczego?

Bot dziala wedlug **Doktryny Wojennej**: sygnaly Smart Money sa najwyzsze. Cala architektura jest zbudowana wokol zalozen ze pozycje wielorybow to sygnal o najwyzszym autorytecie. Jesli Wyrocznia mowi "BULLISH" a wieloryby shortuja -- **idziemy za wielorybami**.

Gdybysmy podlaczyli Wyrocznie do tradingu, stworzyloby to natychmiastowy konflikt:

```
Wyrocznia mowi:  "LIT wzrosnie o 3% w 1 godzine" (BULLISH)
Wieloryby mowia: "Mamy $3.3M shorta na LIT" (BEARISH)
Bot mowi:         ???
```

Kto wygrywa? Musielibysmy zdefiniowac wagi, priorytety, edge case'y. Co jesli Wyrocznia ma racje w 60% przypadkow ale wieloryby w 75%? Co jesli Wyrocznia ma racje co do KIERUNKU ale nie TIMINGU?

Dodanie jako logging-only to inzynieryjny odpowiednik **posadzenia nowego doradcy przy stole bez dawania mu prawa glosu**. Mozemy obserwowac logi przez kilka tygodni i zobaczyc:
- Jak czesto Wyrocznia zgadza sie z SM? (wartosc potwierdzenia)
- Jak czesto sie rozni i kto ma racje? (potencjalny alpha)
- Czy jest systematycznie bledna dla niektorych tokenow? (kalibracja modelu)

Po zebraniu tych danych mozemy podjac swiadoma decyzje czy promowac Wyrocznia z "obserwatora" na "uczestnika."

#### Analogia: Paper trading

Tak wlasnie dzialaja profesjonalne firmy quantowe. Nazywaja to "paper trading strategii" -- uruchamiasz nowa strategie rownolegle z systemem live, zapisujesz co BY zrobila, a potem porownujesz hipotetyczny P&L z faktycznym. Dopiero gdy paper wyniki konsekwentnie pokazuja poprawe, dajesz strategii prawdziwy kapital.

Nasza Wyrocznia jest teraz w fazie paper trading. Mowi nam co by zrobila (logi), ale nie ma jeszcze prawa wydawac rozkazow.

---

### Jak te trzy bugi sie lacza: Lekcja o pipeline'ach danych

Wszystkie trzy bugi maja wspolny motyw: **przerwane polaczenia w pipeline'ach danych**.

```
whale_tracker.py                 Smart Money Data
    |                                 |
    | (Bug #5: nie dziala)            | (Bug #5: stary plik)
    v                                 v
/tmp/nansen_bias.json  --->   NansenFeatures.ts  --->  Model ML
                              (rozjazd nazw pol)       (40% wagi = 0)
    |
    | (tez pisze)
    v
/tmp/smart_money_data.json  --->  SmAutoDetector.ts  --->  SignalEngine
                                       |                        |
                                       | (Bug #3: Engine        |
                                       |  nadpisuje tracker)    |
                                       v                        v
                                  Decyzje bota  <---  getOracleGridBias()
                                       ^              (Bug #6: nigdy nie wywolany)
                                       |
                                  Wyrocznia (odlaczona)
```

Architektura jest dobra. Kazdy komponent ma jasna role. Ale polaczenia miedzy nimi byly popsuty w subtelny sposob:
- Cron job zniknal cicho
- Nazwy pol rozjechaly sie miedzy pisarzem a czytelnikiem
- Funkcja zostala zaimplementowana ale nigdy zintegrowana
- System priorytetow zalozy ze jeden komponent widzi wszystko, a on widzial tylko czesc

#### Co by to wszystko wylapalo?

1. **Sprawdzanie swiezosci**: Przy czytaniu `/tmp/nansen_bias.json` sprawdzaj timestamp. Jesli > 30 min, loguj warning. Jesli > 2h, krzycz.

2. **Alarmy na zerowe wartosci**: Jesli `smartMoney` jest 0.000 dla WSZYSTKICH tokenow jednoczesnie, cos jest zepsute. Zdrowe dane powinny miec wariancje.

3. **Testy pokrycia**: Dla kazdej funkcji ktora powinna byc wolana z main loop, grepuj codebase na wywolania. Jesli count jest zero, to martwy kod (albo Bug #6).

4. **Tabela wlasnosci plikow**: Trzymaj w dokumentacji prosta tabele:
   | Plik | Kto pisze | Kto czyta | Czestotliwosc |
   |------|-----------|-----------|---------------|
   | `nansen_bias.json` | `whale_tracker.py` | `NansenFeatures.ts` | Co 15 min |
   | `smart_money_data.json` | `whale_tracker.py` + `whale_tracker_live` | `SmAutoDetector.ts` | Co 15 min |

---

### Kluczowe progi do zapamietania

| Parametr | Wartosc | Plik | Dlaczego |
|----------|---------|------|----------|
| SignalEngine strefa WAIT | -25 do +25 | `SignalEngine.ts` L822-823 | Score za slaby na kierunkowy zaklad |
| whale_tracker conviction threshold | 50% | `SmAutoDetector.ts` L704 | Ponizej nawet General nie jest pewien |
| LIT `moderateRatio` | 2.0x | `SignalEngine.ts` L248 | Short/long ratio musi przekroczyc to dla "moderate" |
| `extremeRatio` (whale override) | 5.0x | `SignalEngine.ts` L107 | Triggeruje bypass wszytkiego |
| ML model waga SM | 40% | `HybridPredictor.ts` L52 | Najwiekszy pojedynczy czynnik w prognozach |

---

### Co dalej

- **Obserwuj logi Wyroczni** przez kilka tygodni. Jesli konsekwentnie poprawnie przewiduje gdy sygnaly SM sa niejednoznaczne, rozwaз promowanie z logowania do tiebreakera.
- **Monitoruj cron whale_tracker** -- weryfikuj ze `/tmp/nansen_bias.json` jest swiezy (sprawdzaj timestampy co dzien).
- **Waliduj prognozy ML** -- teraz gdy dane SM plyna do modelu (40% wagi przywrocone), dokladnosc progonz powinna sie wyraznie poprawic.
- **Dodaj freshness guardy** do kazdego file readera: `if (Date.now() - fileTimestamp > 30*60*1000) warn("stale data!")` -- to uniemozliwi powtorzenie Buga #5.

---

## Podsumowanie

Ten bot to nie jest "kup tanio, sprzedaj drogo". To jest **system wywiadowczy** ktory:

1. **Zbiera dane** z 3 zrodel (Hyperliquid API, Nansen, Telegram)
2. **Wazy je** przez credibility multipliers (SM > Whale > Unknown)
3. **Podejmuje decyzje** przez wielowarstwowy system priorytetow
4. **Wykonuje je** przez grid zlecen na gieldzie
5. **Chroni sie** przez 6 warstw zabezpieczen

Najwazniejsza lekcja: **w tradingu (i w inzynierii) strategia jest wazniejsza od taktyki, dane od opinii, a dyscyplina od sprytu.**

A z dzisiejszej sesji dodatkowa lekcja: **dane musza byc swieze, polaczenia nienaruszone, a nowe sygnaly najpierw obserwowane zanim dostaną prawdziwa wladze.**

I jeszcze jedna: **projektuj systemy tak zeby dodawanie nowych rzeczy (tokenow, horyzontow, cech) bylo jednolinijkowe** — nie dziesiecioplikowe. Config-driven > hardcoded.

---

*Ostatnia aktualizacja: 22 lutego 2026*
*Wygenerowane przez Claude Code*

---

# Rozdzial X: XGBoost — Jak Dalismy Botowi Prawdziwy Mozg

> "The old way: if RSI < 30 then buy. The new way: let the machine figure out what RSI < 30 *combined with* SM ratio > 5x *combined with* high funding *at 3am UTC* actually means."

## Co Wlasnie Zbudowalismy?

Wczesniej `prediction-api` dzialal jak kucharz ze scislym przepisem — "jezeli RSI < 30, to bullish; jezeli SM ratio > 2, to bullish" — sztywne reguly polaczone stalymi wagami. Dzialalo, ale nie moglo odkryc wzorcow, ktorych czlowiek nie zaprogramowal recznie.

Teraz dodalismy **XGBoost** — model machine learning, ktory *uczy sie* z danych. Pomysl o tym jak o drugim mozgu, ktory ogląda tygodnie historii rynkowej, znajduje wzorce niewidoczne dla ludzi, i szepcze swoja opinie przed kazda predykcja.

Setup: **zbieraj dane → trenuj w Pythonie → wnioskuj w TypeScript → mieszaj z istniejacym HybridPredictor.**

---

## Architektura: Trójwarstwowy Tort

```
┌──────────────────────────────────────────────────────────────────┐
│  WARSTWA 1: ZBIERANIE DANYCH (Python, co 15 min)                │
│  scripts/xgboost_collect.py                                      │
│    → Pobiera candle'e, dane SM, funding, OI z Hyperliquid        │
│    → Oblicza 30 znormalizowanych cech (ta sama matma co TS)      │
│    → Dopisuje do /tmp/xgboost_dataset_{TOKEN}.jsonl               │
│    → Wypelnia etykiety wstecz: "co sie stalo 1h/4h/12h/1w/1m?"  │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  WARSTWA 2: TRENING (Python, cotygodniowy cron)                  │
│  scripts/xgboost_train.py                                        │
│    → Czyta dataset JSONL (200+ wierszy h1-h12, 100+ w1, 50+ m1) │
│    → Trenuje 5 modeli per token (h1, h4, h12, w1, m1)            │
│    → 8 tokenow: BTC, ETH, SOL, HYPE, ZEC, XRP, LIT, FARTCOIN    │
│    → Klasyfikacja: SHORT / NEUTRAL / LONG                        │
│    → Eksportuje model JSON do /tmp/xgboost_model_{TOKEN}_{h}.json│
│    → Eksportuje metadane (dokladnosc, waznosc cech)              │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  WARSTWA 3: WNIOSKOWANIE (TypeScript, kazde zapytanie predict)   │
│  src/prediction/models/XGBoostPredictor.ts                       │
│    → Laduje model JSON, przechodzi drzewa decyzyjne              │
│    → Zero zaleznosci npm — czysty traversal drzew                │
│    → Softmax na 3 klasy → prawdopodobienstwa                     │
│    → Mieszane z HybridPredictor wagą 30%                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## Wektor Cech: Co Model Widzi

Karmimy XGBoost 30 liczbami — kazda to starannie znormalizowany widok rynku:

### Techniczne (11 cech, indeksy 0-10)
Pochodza z candle'i ceny/wolumenu. Kluczowy insight: uzywamy `tanh()` zeby skompresowaæ nieograniczone wartosci (MACD moze byc dowolna liczba) do [-1, 1], a proste dzielenie dla naturalnie ograniczonych (RSI zawsze 0-100).

### Nansen/SM (11 cech, indeksy 11-21)
Nasza tajna bron — dane Smart Money, ktorych 99% traderow nie ma. SM ratio, conviction, dollar amounts, signal state, dominacja strony.

### Dodatkowe (8 cech, indeksy 22-29)
Rzeczy, na ktore stary system regul nigdy nie patrzyl:
- **Funding rate** — gdy funding jest bardzo pozytywny, longi placa shortom → presja na sprzedaz
- **Zmiana OI 1h/4h** — rosnace OI = nowe pieniadze wchodzą; spadajace = pozycje zamykane
- **Cykliczne godzina/dzien** — kodowanie sin/cos pozwala modelowi nauczyc sie "sesja azjatycka jest inna niz amerykanska"
- **Zmiennosc 24h** — surowe odchylenie standardowe ostatnich zwrotow

**Dlaczego sin/cos dla czasu?** Gdybysmy uzyly surowej godziny (0-23), model myslalby ze 23:00 i 00:00 sa daleko od siebie. Z sin/cos sa sasiadami na okregu — tak jak czas faktycznie dziala.

---

## Jak Dziala XGBoost (wersja 30-sekundowa)

XGBoost buduje 100 "drzew decyzyjnych" — kazde to prosty zestaw regul jezeli/to:

```
Czy RSI < 0.3?
  ├── TAK: Czy SM_ratio < -0.5?
  │   ├── TAK: lisc = -0.15 (bearish)
  │   └── NIE: lisc = +0.02 (lekko bullish)
  └── NIE: Czy funding > 0.01?
      ├── TAK: lisc = -0.08 (bearish)
      └── NIE: lisc = +0.05 (bullish)
```

Kazde drzewo jest "slabe" — ledwo lepsze niz zgadywanie. Ale 100 drzew glosujacych razem (to "boosting" w XGBoost) staje sie zaskakujaco dokladne.

Dla klasyfikacji 3-klasowej (SHORT/NEUTRAL/LONG), XGBoost buduje drzewa w grupach po 3 — jedno drzewo na klase na runde. Po 100 rundach = 300 drzew lacznie. Sumujemy wartosci lisci per klasa, stosujemy softmax, i dostajemy prawdopodobienstwa.

**Magia:** XGBoost moze odkryc interakcje jak "gdy RSI jest oversold ORAZ SM akumuluje ORAZ jest sesja US → sygnal LONG jest 3x silniejszy." Reczne reguly nie potrafia uchwycic tych wielowymiarowych wzorcow.

---

## Mieszanie: Jak Dwa Mozgi Wspolpracuja

Nie wyrzucamy starego systemu regul — jest sprawdzony w boju. Zamiast tego *mieszamy*:

```typescript
// Stary sygnal oparty na regulach: -1 do +1
let combinedSignal = -0.35;

// XGBoost mowi: SHORT z 72% pewnoscia
const xgbSignal = -0.8;  // SHORT = -0.8
const xgbWeight = 0.30;  // 30% wplyw XGBoost

// Wynik po zmieszaniu:
// -0.35 * 0.70 + (-0.8) * 0.30 * 0.72 = -0.245 + -0.173 = -0.418
```

**Dlaczego 30%?** Konserwatywny start. XGBoost musi udowodnic swoja wartosc na zywyc danych zanim zaufamy mu bardziej. Jesli konsekwentnie pokonuje reguly, mozemy podniesc do 50% lub wiecej. Jesli jest slaby, 30% nas nie zniszczy.

---

## Lekcje i Pulapki

### 1. Wyrownanie Cech jest Wszystkim
Kolektor Python i normalizator TypeScript **musza obliczac identyczne cechy**. Jesli Python mowi ze cecha[4] to `tanh(change_1h/10)` ale TypeScript wstawia tam `tanh(change_4h/20)`, model widzi smieci.

### 2. Podzial Chronologiczny, Nie Losowy
Dla danych czasowych **nigdy** nie mieszamy losowo treningowego/testowego. Zbior testowy musi byc *najnowsze* 20% danych — bo tak dziala swiat rzeczywisty.

### 3. Problem "Przestarzalego Modelu"
Modele trenowane na tygodniowych danych moga byc niebezpiecznie bledne jesli rezim rynku sie zmienil. Dlatego retrenujemy co tydzien, a `/xgb-status` pokazuje wiek modelu.

### 4. Brak Rownoruagi Klas
Wiekszość czasu zmiany cen sa male → NEUTRAL dominuje. Walczymy z tym poprzez rozsadne progi (0.5% dla 1h, 1.5% dla 4h, 3% dla 12h, 8% dla w1, 15% dla m1).

### 5. Brama Probek (per-horyzont)
Odmawiamy treningu z za mala liczba oznaczonych wierszy — ale progi sa rozne per horyzont:
- **h1/h4/h12**: 200 probek (~2 dni zbierania)
- **w1**: 100 probek (~10 dni — etykiety pojawiaja sie dopiero po 7 dniach)
- **m1**: 50 probek (~35 dni — etykiety pojawiaja sie dopiero po 30 dniach)

To wazny pattern: **dluzsze horyzonty potrzebuja mniej probek ale wiecej czasu zeby sie pojawily.**

### 6. Tlumienie Slope'u dla Dlugich Horyzontow
Gdy model regul ekstrapoluje cene na h1 (1 godzine), slope (nachylenie ceny z ostatnich 24h) jest mnozony liniowo. Ale gdybysmy uzylic tego samego mnoznika dla m1 (720 godzin), wynik bylby absurdalny — nikt nie wie co bedzie za miesiac na podstawie 24-godzinnego trendu.

Rozwiazanie: **logarytmiczne tlumienie** — `slope * 24 * Math.log2(hours/24 + 1)` zamiast `slope * hours`. Dla h1 to prawie to samo, ale dla m1 slope jest ~80% slabszy niz liniowa ekstrapolacja.

Analogia: prognoza pogody. Na jutro mozesz uzywac dzisiejszego trendu temperatury. Na za miesiac — nie. Trend rozmywa sie logarytmicznie.

---

## Nowe Endpointy API

| Endpoint | Co zwraca |
|----------|-----------|
| `GET /predict/:token` | Pelna predykcja hybrydowa (reguly + XGBoost) — 5 horyzontow |
| `GET /predict-all` | Predykcje dla wszystkich 8 tokenow naraz |
| `GET /predict-xgb/:token` | Predykcja tylko XGBoost (wszystkie 5 horyzontow z prawdopodobienstwami) |
| `GET /xgb-status` | Ktore tokeny maja modele, wiek, statystyki dokladnosci |
| `GET /xgb-features/:token` | Top 10 najwazniejszych cech per horyzont |
| `GET /verify/:token` | Weryfikacja trafnosci przeszlych predykcji |
| `GET /weights` | Aktualne wagi modelu |
| `GET /features` | Waznosc cech (explainability) |
| `GET /health` | Health check |

Istniejacy `/predict/:token` teraz automatycznie wlacza mieszanie z XGBoost.

---

## Pliki Utworzone/Zmodyfikowane

| Plik | Typ | Co |
|------|-----|-----|
| `scripts/xgboost_collect.py` | NOWY | Kolektor danych (cron co 15 min) |
| `scripts/xgboost_train.py` | NOWY | Skrypt treningowy (cron cotygodniowo) |
| `src/prediction/models/XGBoostPredictor.ts` | NOWY | Silnik wnioskowania TypeScript |
| `src/prediction/models/HybridPredictor.ts` | ZMIENIONY | Mieszanie XGBoost w predict(), 5 horyzontow |
| `src/prediction/dashboard-api.ts` | ZMIENIONY | 3 nowe endpointy, 8 tokenow |
| `src/prediction/index.ts` | ZMIENIONY | Eksporty + nowe metody serwisu, 8 tokenow |

---

## Jak Dobrzy Inzynierowie Mysla o Tym

1. **Zacznij konserwatywnie** — 30% wagi, nie 100%. Udowodnij wartosc zanim zaufasz.
2. **Graceful degradation** — Brak pliku modelu? Stary system dziala sam. Zly model? 30% wplyw nie zabije.
3. **Ta sama matma, dwa jezyki** — Python i TypeScript musza sie zgadzac w normalizacji.
4. **Obserwowalnosc przede wszystkim** — `/xgb-status` i `/xgb-features` pozwalaja zajrzec do srodka. Czarna skrzynka bez monitoringu to bomba zegarowa.
5. **Trenuj offline, wnioskuj online** — Ciezkie obliczenia (trening) w cotygodniowym cronie. Lekkie (traversal drzew) na kazdym requeście. Niskie opoznienie.
6. **Dane sa waskim gardlem** — Sam model jest prosty (100 plytkich drzew). Trudna czesc to zebranie wystarczajaco duzyo danych jakosciowych.

---

## Rozszerzenie: 8 Tokenow + Horyzonty Tygodniowy/Miesieczny (22.02.2026)

### Co sie zmienilo?

Poczatkowo prediction-api obslugiwal 3 tokeny (HYPE, LIT, FARTCOIN) na 3 horyzontach (1h, 4h, 12h). To bylo za malo — bot traduje 8 tokenow, a trader chce wiedziec nie tylko "co za godzine" ale tez "jaki jest trend na tydzien/miesiac".

Rozszerzylismy do **8 tokenow** (BTC, ETH, SOL, HYPE, ZEC, XRP, LIT, FARTCOIN) i **5 horyzontow** (h1, h4, h12, w1, m1).

### Konfiguracja horyzontow — PREDICTION_HORIZONS

Zamiast hardkodowac kazdy horyzont osobno, stworzyliamy jeden obiekt konfiguracyjny:

```typescript
export const PREDICTION_HORIZONS = [
  { key: 'h1',  hours: 1,   multiplier: 0.3, confMax: 80, confBase: 50, confScale: 30 },
  { key: 'h4',  hours: 4,   multiplier: 0.8, confMax: 70, confBase: 45, confScale: 25 },
  { key: 'h12', hours: 12,  multiplier: 1.5, confMax: 60, confBase: 40, confScale: 20 },
  { key: 'w1',  hours: 168, multiplier: 3.0, confMax: 45, confBase: 30, confScale: 15 },
  { key: 'm1',  hours: 720, multiplier: 5.0, confMax: 30, confBase: 20, confScale: 10 },
];
```

**Dlaczego confMax maleje dla dluzszych horyzontow?** Bo im dalej w przyszlosc, tym mniejsza pewnosc. Model moze byc 80% pewny co bedzie za godzine, ale tylko 30% pewny co bedzie za miesiac. To uczciwa komunikacja — lepiej powiedziec "nie wiem" niz udawac pewnosc.

**Dlaczego multiplier nie rosnie liniowo?** Gdyby rosnal liniowo z czasem, m1 (720h) mialby multiplier 720/1 * 0.3 = 216. To absurd. Zamiast tego rosnie subliniowo (0.3 → 0.8 → 1.5 → 3.0 → 5.0) bo dlugie horyzonty maja wiecej mean-reversion — cena moze spasc 5% w tydzien ale raczej nie 500% w miesiac.

### Record<string, ...> zamiast {h1, h4, h12}

Wazna zmiana architektoniczna: typ `predictions` w PredictionResult zmienil sie z:

```typescript
// STARE (sztywne):
predictions: {
  h1: { price: number; change: number; confidence: number };
  h4: { price: number; change: number; confidence: number };
  h12: { price: number; change: number; confidence: number };
};

// NOWE (dynamiczne):
predictions: Record<string, { price: number; change: number; confidence: number }>;
```

**Dlaczego to wazne?** Bo nastepnym razem gdy dodamy nowy horyzont (np. h2 albo q1), wystarczy dodac jeden wpis do PREDICTION_HORIZONS. Zero zmian w interfejsach, zero zmian w API, zero zmian w CLI. To jest **rozszerzalnosc** — napisz raz, dodawaj latwo.

Porownaj to z alternatywa — gdyby kazdy horyzont byl hardkodowany, dodanie jednego nowego wymagaloby zmian w ~15 miejscach. Tak robionym kodem cierpia duze zespoly — kazda zmiana dotyka wszystkiego.

### Timeline danych: Kiedy XGBoost zacznie dzialac?

| Horyzont | Etykiety dostepne po | Model trenowalny po | Reguły HybridPredictor |
|----------|---------------------|---------------------|------------------------|
| h1 | 1 godzina | ~2 dni (200 probek) | Od razu |
| h4 | 4 godziny | ~2 dni | Od razu |
| h12 | 12 godzin | ~2 dni | Od razu |
| w1 | **7 dni** | **~10 dni** (100 probek) | Od razu (reguly) |
| m1 | **30 dni** | **~35 dni** (50 probek) | Od razu (reguly) |

Kluczowy insight: **HybridPredictor (system regul) obsluguje w1/m1 od pierwszego dnia** — nie potrzebuje danych treningowych, uzywa formuly. XGBoost dojdzie pozniej gdy zbierze wystarczajaco danych. To jest wzorzec "graceful degradation" — system dziala bez ML, a ML tylko *poprawia* go gdy jest gotowy.

### Commit i deploy

```
427407f feat: expand prediction-api to 8 tokens + weekly/monthly horizons
```

Zweryfikowano na serwerze — wszystkie 8 tokenow zwracaja predykcje z 5 horyzontami:
```
BTC:      $67,438 — h1, h4, h12, w1, m1 ✅
ETH:      $1,944  — h1, h4, h12, w1, m1 ✅
SOL:      $83.26  — h1, h4, h12, w1, m1 ✅
HYPE:     $21.50  — h1, h4, h12, w1, m1 ✅
ZEC:      $37.85  — h1, h4, h12, w1, m1 ✅
XRP:      $2.38   — h1, h4, h12, w1, m1 ✅
LIT:      $0.77   — h1, h4, h12, w1, m1 ✅
FARTCOIN: $0.28   — h1, h4, h12, w1, m1 ✅
```

---

## War Room Dashboard — Od 3 Paneli do Centrum Dowodzenia (23.02.2026)

### Kontekst: Dlaczego Dashboard jest wazny

Wyobraz sobie, ze jestes dowodca w bunkrze. Masz 8 jednostek na polu walki (8 tokenow), kazda z wlasnymi danymi wywiadowczymi (predykcje ML), pozycjami i PnL. Do tej pory widziales tylko 3 z nich na jednym ekranie. Reszta? Musiales sprawdzac recznie, po jednym.

Dzis zmienilismy to. War Room teraz pokazuje wszystkie 8 tokenow jednoczesnie, na jednym ekranie, z 5 horyzontami predykcji kazdym. Jedno spojrzenie — caly obraz sytuacji.

### Co sie zmienilo

**Plik:** `dashboard.mjs` — pojedynczy plik Node.js ktory serwuje caly dashboard jako HTML.

**Przed (3 panele, 3 horyzonty):**
```
┌───────────┬───────────┬───────────┐
│    LIT    │ FARTCOIN  │   HYPE    │
│  h1,h4,h12│  h1,h4,h12│  h1,h4,h12│
└───────────┴───────────┴───────────┘
```

**Po (8 paneli, 5 horyzontow):**
```
┌─────────┬─────────┬─────────┬─────────┐
│   BTC   │   ETH   │   SOL   │  HYPE   │
│ h1→m1   │ h1→m1   │ h1→m1   │ h1→m1   │
├─────────┼─────────┼─────────┼─────────┤
│   ZEC   │   XRP   │   LIT   │FARTCOIN │
│ h1→m1   │ h1→m1   │ h1→m1   │ h1→m1   │
└─────────┴─────────┴─────────┴─────────┘
```

### Zmiany techniczne — co i dlaczego

#### 1. CSS Grid: `repeat(3, 1fr)` → `repeat(4, 1fr)` + `repeat(2, 1fr)` rows

Stary grid mial 3 kolumny. Nowy ma 4 kolumny i 2 wiersze. CSS Grid robi tu ciezka robote — `grid-template-columns: repeat(4, 1fr)` znaczy "4 kolumny, kazda rowna szerokosc".

**Borderki miedzy panelami** — to klasyczny problem w gridach. Stary kod mial `.panel:last-child { border-right: none }` (ostatni panel bez prawej krawedzi). W siatce 4x2 to nie dziala — musisz usunac prawy border na *kazdym 4. panelu* i dolny border na *drugim wierszu*:

```css
.panel:nth-child(4n) { border-right: none; }   /* 4., 8. panel */
.panel:nth-child(n+5) { border-bottom: none; }  /* panele 5-8 (dolny wiersz) */
```

**Lekcja:** `nth-child` to potezny selektor CSS. `4n` = co 4. element. `n+5` = od 5. elementu wzwyz. Jesli kiedykolwiek robisz siatkowe layouty, `nth-child` jest twoim najlepszym przyjacielem.

#### 2. Zmniejszenie elementow UI

Panele sa teraz ~50% mniejsze (bo 8 zamiast 3). Musielismy zmniejszyc prawie wszystko:

| Element | Bylo | Jest | Dlaczego |
|---------|------|------|----------|
| Chart min-height | 200px | 100px | Mniejszy panel = mniejszy wykres |
| Factors box | max 40px | max 25px | Mniej miejsca na tekst |
| Font sizes | 9px | 8px | Gestsza informacja |
| Padding | 5px | 3-4px | Kazdy piksel sie liczy |

**Lekcja o kompromisach:** Gdy zmniejszasz UI, zawsze jest tradeoff miedzy *iloscia informacji* a *czytelnoscia*. 8px font na monitorze 1080p jest czytelny, ale na 768p juz nie. Dashboard jest projektowany na duzy monitor w "war room" — to nie jest mobilna appka.

#### 3. Nowe horyzonty predykcji: w1 (tygodniowy) i m1 (miesieczny)

W HTML kazdego panelu dodalismy 2 nowe wiersze:
```javascript
'<div class="pred-row"><span>1w:</span><span id="predw1-' + coin + '">---</span></div>'
'<div class="pred-row"><span>1m:</span><span id="predm1-' + coin + '">---</span></div>'
```

W JavaScript musielismy zaktualizowac **4 miejsca** ktore czytaja/wyswietlaja predykcje:
1. `updatePredictionUI()` — odczyt `pred.predictions.w1` i `pred.predictions.m1`
2. No-data fallback — czyszczenie elementow `predw1-` i `predm1-` na "---"
3. `fallbackPrediction()` — kalkulacja w1 (168h) i m1 (720h) z regresji liniowej
4. `drawChart()` — linie predykcji na wykresie (fioletowa=w1, cyan=m1)

**Lekcja o spojnosci:** Gdy dodajesz nowe pole danych, musisz zaktualizowac *kazde miejsce* ktore to pole czyta, wyswietla, inicjalizuje albo resetuje. W tym przypadku bylo 4 takich miejsc. Latwo zapomnic o fallbacku (punkt 3) albo o czyszczeniu danych (punkt 2) — a wtedy masz "ghost data" z poprzedniego tokenu.

#### 4. Kolory na wykresie — semiotyka

Kazdy horyzont predykcji ma swoj kolor:
```javascript
{ key: "h1",  color: "#3fb950" },   // zielony — krotkoterminowy
{ key: "h4",  color: "#d29922" },   // zolty — sredni
{ key: "h12", color: "#f85149" },   // czerwony — dluzszy
{ key: "w1",  color: "#a371f7" },   // fioletowy — tygodniowy
{ key: "m1",  color: "#39c5cf" }    // cyan — miesieczny
```

Nie wybralismy kolorow losowo. Zielony → zolty → czerwony to naturalny gradient "blisko → daleko" (jak swiatla drogowe). Fioletowy i cyan to kolory juz uzywane w dashboard (`.purple` i `.cyan` klasy CSS) — spojnosc wizualna.

### Architektura dashboard — dlaczego jeden plik?

`dashboard.mjs` to **520 linii** w jednym pliku. Caly HTML, CSS i JavaScript jest w template literal:

```javascript
const HTML = `<!DOCTYPE html>
<html>
  <style>/* 65 linii CSS */</style>
  <script>/* 400 linii JS */</script>
</html>`;

const server = http.createServer((req, res) => {
    res.end(HTML);
});
```

**Dlaczego nie React/Vue/Next.js?**

1. **Zero build step** — plik `.mjs` uruchamiasz bezposrednio `node dashboard.mjs`. Zero webpack, zero npm install, zero bundlerów.
2. **Zero zaleznosci** — jedyne importy to `http` i `fs` z Node.js stdlib. Nic nie moze sie zepsuc przez `npm update`.
3. **Natychmiastowy deploy** — `scp dashboard.mjs server:` + `pm2 restart war-room`. 2 komendy, 5 sekund.
4. **Czytelnosc** — caly dashboard w jednym pliku. Ctrl+F i masz wszystko.

**Kiedy to NIE jest dobre podejscie?** Gdy dashboard rosnie powyzej ~1000 linii, gdy potrzebujesz komponentow wielokrotnego uzytku, gdy wielu devow pracuje rownoczesnie, lub gdy potrzebujesz state managementu. Ale dla dashboardu ktory wyswietla dane z API — inline HTML jest idealny.

**Analogia:** To jak notatnik w kuchni vs system ERP. Jesli musisz zapisac liste zakupow, notatnik jest idealny. Jesli musisz zarzadzac lancuchem dostaw — potrzebujesz ERP. Nasz dashboard to lista zakupow.

### Dane — skad plyna

Dashboard pobiera dane z 3 zrodel, client-side (w przegladarce usera):

```
Przegladarka usera
     │
     ├──→ api.hyperliquid.xyz/info
     │    (ceny, pozycje, candle'y)
     │    ← allMids, clearinghouseState, candleSnapshot
     │
     ├──→ 100.71.211.15:8090/predict/{token}
     │    (predykcje ML z prediction-api)
     │    ← direction, predictions{h1..m1}, signals, keyFactors
     │
     └──→ 100.71.211.15:3000/sm-data
          (Smart Money data — serwowane przez sam dashboard!)
          ← dane z /tmp/smart_money_data.json
```

**Ciekawy trik:** Dashboard serwuje *sam siebie* jako backend! Endpoint `/sm-data` w tym samym serwerze HTTP czyta `/tmp/smart_money_data.json` i zwraca JSON. Dashboard to jednoczesnie frontend i micro-backend.

**Fallback ML:** Gdy prediction-api nie odpowiada, dashboard odpala wlasna regresje liniowa na ostatnich 24h candle'y:

```javascript
// Nachylenie prostej (slope) na danych cenowych
const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
const slopePct = (slope / currentPrice) * 100;

// Ekstrapolacja: w1 = 168 godzin, m1 = 720 godzin
w1: { price: currentPrice * (1 + slopePct * 168 / 100), change: slopePct * 168 }
m1: { price: currentPrice * (1 + slopePct * 720 / 100), change: slopePct * 720 }
```

To nie jest dobra predykcja (regresja liniowa na 24h ekstrapolowana na miesiac?), ale lepsze niz "No data". **Lekcja: graceful degradation** — lepiej pokazac przyblizone dane z nota "Fallback: Linear Regression (ML offline)" niz puste miejsce.

### Deploy — jak szybko mozna wrzucic zmiane na produkcje

```bash
# 1. Edytuj plik lokalnie
# 2. Wyslij na serwer
scp dashboard.mjs hl-mm:~/hyperliquid-mm-bot-complete/

# 3. Restart procesu
ssh hl-mm 'pm2 restart war-room'

# 4. Weryfikacja
curl -s http://100.71.211.15:3000 | grep 'const COINS'
# → const COINS = ["BTC", "ETH", "SOL", "HYPE", "ZEC", "XRP", "LIT", "FARTCOIN"]
```

Caly deploy trwa **10 sekund**. Zero build step, zero CI/CD, zero Docker. To jest moc prostych rozwiazan.

### Commit

```
7840af1 feat: War Room dashboard — 8 tokens + w1/m1 horizons, 4x2 grid
```

---

## Whale Changes Report — radar zmian pozycji

### Problem: za duzo danych, za malo informacji

Mielismy juz dwa sposoby monitorowania wielorybow:

1. **whale_tracker.py** (cron co 15 min) — produkuje snapshot "kto ma ile" do `/tmp/smart_money_data.json`. Bot konsumuje. Zero ludzkiego interfejsu.
2. **daily-whale-report.ts** (cron o 08:00 UTC) — "rentgen" 41 portfeli na Discord. Pelny snapshot z equity, pozycjami, agregatem per coin.

Problem? **Daily report** to fotografia — mowisz "dzis Generał ma $3.3M LIT SHORT". Ale nie wiesz *co sie zmienilo* od ostatniego razu. Musisz sam porownac z wczorajszym raportem. A **whale_tracker** daje dane w JSON, nie do czytania. **VIP Spy** (vip_spy.py) monitoruje zmiany real-time, ale tylko 4 portfele i alerty lecą na Telegram per-zmiana — trudno złapac obraz calości.

### Rozwiazanie: Whale Changes Report

Nowy skrypt `scripts/whale-changes-report.ts` — uruchamiany 3x dziennie (06:00, 12:00, 18:00 UTC). Zamiast *snapshot* pozycji, pokazuje **tylko zmiany** od ostatniego runu.

```
Analogia: Daily Report to zdjecie rentgenowskie.
          Changes Report to raport z kamery przemyslowej:
          "O 14:32 ktos wszedl. O 15:17 ktos wyszedl. O 16:45 ktos wrocil z wiekszym plecakiem."
```

### Jak dziala — krok po kroku

```
whale-changes-report.ts (cron 0 6,12,18 * * *)
  ↓
1. Czytaj PREVIOUS snapshot z /tmp/whale_changes_snapshot.json
2. Fetchuj CURRENT pozycje z Hyperliquid API (batch 5 adresow, 200ms delay)
3. Porownaj: NEW / CLOSED / FLIPPED / INCREASED / REDUCED
4. Formatuj raport → Discord webhook (chunked per 1950 znaków)
5. Zapisz CURRENT jako nowy snapshot
```

**Kluczowa roznica vs daily report:** Daily report nie zapisuje nic — kazdorazowo fetchuje i formatuje. Changes report **musi pamietac** co bylo ostatnio, zeby wykryc roznice. Dlatego snapshot file.

### 5 typow zmian (ported z whale_tracker.py `detect_changes()`)

| Typ | Kiedy | Przyklad |
|-----|-------|---------|
| **NEW** | Pozycja istnieje w current ale nie w previous | "Generał OPENED SHORT ASTER — $2.4M" |
| **CLOSED** | Pozycja w previous ale nie w current | "Pulkownik CLOSED SHORT BTC — was $46.3M" |
| **FLIPPED** | Ten sam coin, inna strona (LONG↔SHORT) | "Porucznik SOL3 FLIPPED SOL: SHORT → LONG — $1.9M" |
| **INCREASED** | Wartosc wzrosla o >10% | "Kraken A SHORT SOL +29% → $15.2M" |
| **REDUCED** | Wartosc spadla o >10% | "Wice-Generał SHORT BTC -75% → $9.9M" |

### Progi (thresholds)

| Parametr | Wartosc | Dlaczego |
|----------|---------|----------|
| Min position value | **$10K** | Nizszy niz daily report ($100K) — chcemy widziec wiecej zmian |
| Min change % | **10%** | Filtruje szum (drobne korekty cen) ale lapie realne ruchy |

### Snapshot file — serce systemu

`/tmp/whale_changes_snapshot.json` — JSON z pozycjami kazdego portfela z ostatniego runu.

**Pierwszy run** (brak pliku) = zapisuje baseline, nie wysyla raportu. To jest ważne — nie chcesz dostawac "41 NEW POSITIONS" bo nie ma z czym porownac.

**Struktura:**
```json
{
  "0xa312114b5795dff9b8db50474dd57701aa78ad1e": {
    "positions": {
      "ASTER": { "coin": "ASTER", "side": "SHORT", "valueUsd": 2400000, "uPnl": 935000, ... },
      "LIT":   { "coin": "LIT",   "side": "SHORT", "valueUsd": 3300000, "uPnl": 1300000, ... }
    }
  },
  ...
}
```

Pozycje sa kluczowane po coin name (nie indeksie tablicy) — to pozwala na O(1) lookup zamiast iterowania.

### Reuse patternow z daily-whale-report

Nie wymyslamy kola na nowo. Skrypt uzywa dokladnie tych samych patternow:

| Pattern | Zrodlo | Uzycie |
|---------|--------|--------|
| `WHALES` dict | daily-whale-report.ts | Te same 41 adresow z tymi samymi nazwami |
| Batch fetch 5 adresow + 200ms delay | daily-whale-report.ts | Unika rate limit API |
| `Promise.allSettled()` | daily-whale-report.ts | Jeden timeout nie killuje calego batcha |
| `postToDiscord()` + chunk splitting | daily-whale-report.ts | Discord limit 2000 znaków |
| `fmtUsd()` / `fmtUsdNoSign()` | daily-whale-report.ts | Spójne formatowanie $1.2M / $350K |
| `--dry-run` flag | daily-whale-report.ts | Testowanie bez spamu na Discord |

### Lekcja: Change Detection to nie jest trywialne

Porownywanie dwoch snapshotow wyglada prosto, ale jest kilka pulapek:

**1. Pozycje ponizej progu**

Jesli pozycja spadla z $50K do $8K — to CLOSED czy REDUCED? W naszej implementacji: **CLOSED** (bo $8K < $10K min threshold). Traktujemy pozycje ponizej $10K jakby nie istnialy.

**2. Kolejnosc operacji**

```typescript
// Zla kolejnosc:
if (curr && !prev) → NEW
if (!curr && prev) → CLOSED
if (curr.side !== prev.side) → FLIPPED  // CRASH! prev moze byc undefined

// Dobra kolejnosc:
if (currAboveMin && !prevAboveMin) → NEW
if (prevAboveMin && !currAboveMin) → CLOSED
if (currAboveMin && prevAboveMin) {
  if (curr.side !== prev.side) → FLIPPED  // Bezpieczne — oba istnieja
}
```

**3. Division by zero**

```typescript
const changePct = (curr.valueUsd - prev.valueUsd) / prev.valueUsd;
// Co jesli prev.valueUsd === 0? → Infinity
// Zabezpieczenie: if (prev.valueUsd > 0)
```

**4. Pierwszy run = baseline, nie raport**

Bez tego dostajesz "41 NEW POSITIONS" — kazda istniejaca pozycja wyglada jak "nowa". Rozwiazanie: sprawdz czy plik istnieje, jesli nie — zapisz i wyjdz bez raportu.

### Format raportu na Discord

Przykladowy raport (gdy sa zmiany):
```
📊 WHALE CHANGES REPORT (06:00 UTC)
Period: ~6h | 41 wallets tracked

🔄 FLIPPED:
  🟢 Porucznik SOL3 FLIPPED SOL: SHORT → LONG — $1.9M

🆕 NEW POSITIONS:
  🔴 Generał OPENED SHORT ASTER — $2.4M
  🔴 Manifold Trading OPENED SHORT ZEC — $86K

❌ CLOSED:
  🔴 Pułkownik CLOSED SHORT BTC — was $46.3M

📈 INCREASED:
  🔴 Kraken A SHORT SOL +29% → $15.2M (uPnL +$7.6M)

📉 REDUCED:
  🔴 Wice-Generał SHORT BTC -75% → $9.9M

━━━━━━━━━━━━
Summary: 6 changes across 5 wallets
```

Jesli zero zmian:
```
📊 WHALE CHANGES REPORT (12:00 UTC)
✅ No significant changes — all positions stable
41 wallets tracked | min $10K | min 10% change
```

### Architektura raportow — pelny obraz

Teraz mamy 3 warstwy raportowania (kazda z inna czestotliwoscia i detalami):

```
┌─────────────────────────────────────────────────────┐
│  VIP Spy (co 30s)                                   │
│  Real-time alerty per-zmiana na Telegram            │
│  4 portfele, próg $10K / 5%                         │
│  → "Generał OPENED SHORT ASTER NOW!"                │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  Whale Changes Report (3x dziennie)                 │
│  Zbiorcze podsumowanie zmian na Discord             │
│  41 portfeli, próg $10K / 10%                       │
│  → "6 changes across 5 wallets in last ~6h"         │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  Daily Whale Report (1x dziennie, 08:00 UTC)        │
│  Pelny snapshot wszystkich pozycji na Discord        │
│  41 portfeli, próg $100K                            │
│  → "Kraken A: $4.66M eq, SOL SHORT $15M (+$8M)"    │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  whale_tracker.py (co 15 min)                       │
│  JSON data dla bota, zero interfejsu ludzkiego      │
│  ~39 portfeli + trendy + ważenie + PnL              │
│  → /tmp/smart_money_data.json                       │
└─────────────────────────────────────────────────────┘
```

Kazda warstwa ma inny cel. VIP Spy mowi "CO SIE DZIEJE TERAZ". Changes Report mowi "CO SIE ZMIENILO OD RANA". Daily Report mowi "JAK WYGLADA CALOSC". whale_tracker mowi to samo co Daily Report, ale w formacie ktory bot umie czytac.

### Cron na serwerze

```bash
# Whale Changes Report - 3x daily (06:00, 12:00, 18:00 UTC)
0 6,12,18 * * * cd /home/jerry/hyperliquid-mm-bot-complete && npx tsx scripts/whale-changes-report.ts >> runtime/whale_changes_report.log 2>&1
```

Uzywa `npx tsx` (nie `ts-node`!) — na serwerze `ts-node --transpile-only` nie dziala z ESM (daje `ERR_UNKNOWN_FILE_EXTENSION`). `npx tsx` rozwiazuje to automatycznie.

### Lekcja: Pattern reuse > cleverness

Ten skrypt to ~300 linii, z czego ~100 to skopiowany `WHALES` dict. Mozna by bylo stworzyc shared module i importowac, ale:

1. Kazdy skrypt jest self-contained — mozesz go uruchomic niezaleznie
2. Zero risk ze zmiana w jednym skrypcie zlamie drugi
3. Prostsze debugowanie — caly kontekst w jednym pliku

Trade-off: jak dodajesz nowego wieloryba, musisz zmienic go w 3 plikach (whale_tracker.py, daily-whale-report.ts, whale-changes-report.ts). W zamian: **kazdy plik dziala sam i nie moze sie zepsuc przez zmiane w innym**. Dla skryptow cron ktore sie uruchamiaja raz dziennie, ta niezaleznosc jest wazniejsza niz DRY.

---

## TWAP Executor — zamykanie pozycji jak General

### Dlaczego?

Przeanalizowalismy fille Generala (najlepszy wieloryb w trackerze, +$30M profit). Kiedy zamyka pozycje, NIE robi jednego duzego "market sell". Rozklada to na **60 malych limit orderow po $300-2000** rozlozonych w 45 minut. To technika znana jako **TWAP** (Time-Weighted Average Price).

Nasz stary sposob: jeden IOC (Immediate or Cancel) z 5% slippage. Efekt: duzy market impact, taker fee (4.5bps), gorsze ceny.

Nowy sposob: wiele malych limit orderow (ALO = maker only). Efekt: minimalny market impact, maker fee (1.5bps), lepsze ceny.

Analogia: wyobraz sobie ze chcesz sprzedac 100 jablek na bazarze. Stary bot krzyczal "SPRZEDAJE WSZYSTKO!" i dostawal gorsza cene bo kupujacy widzieli desperacje. General po cichu stawia jablka po jednym na ladzie i cierpliwie czeka na kupcow — dostaje lepsza cene za kazde jablko.

### Jak to dziala

```
Trigger (rotation cleanup / TP / manual close)
  |
  v
closePositionTwap(pair, reason)          <-- wrapper w LiveTrading
  |
  v
TwapExecutor.start(pair, size, side)     <-- osobny modul
  |
  v
+-- setInterval loop (co 3-12s) ---------------------------+
|                                                           |
|  1. Sprawdz L2 book -> oblicz cene slice'a                |
|  2. Zloz limit ALO (maker-only, reduce-only)              |
|  3. Czekaj na fill...                                     |
|  4. Nie fillnal? -> eskaluj:                              |
|     Level 0: ALO (maker) -> Level 1: GTC@mid              |
|     -> Level 2: IOC (taker, gwarantowany fill)            |
|  5. Cena uciekla >50bps? -> IOC reszty natychmiast        |
|  6. Powtarzaj az filled lub timeout                       |
+-----------------------------------------------------------+
  |
  v
Done -> log: avg price, slippage, fills, czas
```

### Eskalacja — kluczowy koncept

Bot zaczyna cierpliwie (ALO = maker only, najnizszy fee), a jesli rynek nie chce kupic -> eskaluje do agresywniejszych metod. To jak negocjacje — zaczynasz od delikatnej oferty, a jesli czas ucieka -> dajesz lepsza cene.

| Level | Typ orderu | Fee | Kiedy aktywny |
|-------|-----------|-----|---------------|
| 0 | ALO (maker) | 1.5bps | Domyslne — cierpliwe czekanie |
| 1 | GTC @ mid | maker/taker | Po X sekundach bez filla |
| 2 | IOC (taker) | 4.5bps | Drugi timeout — gwarantuj fill |

### Dlaczego osobny modul?

MainLoop tick = 60 sekund. TWAP potrzebuje slice'y co 3-12 sekund. Gdybysmy wsadzili TWAP w mainLoop, moglby zlozyc tylko 1 order na tick.

Dlatego TwapExecutor uzywa `setInterval()` — niezalezny timer ktory tyka co kilka sekund, nie blokujac reszty bota. MainLoop tylko loguje postep przez `tick()`.

Analogia: mainLoop to general ktory co minute sprawdza mape bitwy. TWAP to specjalista od snajperow ktory ma swoj wlasny zegar i strzela co kilka sekund — general tylko dostaje raporty.

### Konfiguracja per-token

Plynne coiny (BTC/ETH) -> wiecej slice'ow, szybciej. Illiquid (LIT) -> mniej slice'ow ale dluzej czeka na fill.

```
BTC:      10 slices, 60s, escalate po 8s
ETH:      10 slices, 60s, escalate po 8s
SOL:       8 slices, 45s, escalate po 8s
HYPE:      5 slices, 30s, escalate po 10s
LIT:       5 slices, 60s, escalate po 15s
FARTCOIN:  5 slices, 45s, escalate po 12s
Default:   5 slices, 30s, escalate po 10s
```

Env vars: `TWAP_ENABLED=true`, `LIT_TWAP_SLICES=10`, `LIT_TWAP_DURATION=120`

### Lekcje

**1. Obserwuj profesjonalistow.** Zamiast wymyslac kolo od nowa, przeanalizowalismy jak najlepsi traderzy faktycznie traduja. TWAP to standard w institutional trading.

**2. Maker vs Taker = 3x roznica.** Na $10K pozycji: taker $4.50, maker $1.50. Przy 10 zamkniec dziennie = $30/dzien oszczednosci na samych fee.

**3. setInterval daje pseudo-concurrency.** TWAP timer tyka w tle, mainLoop robi swoje. Pattern "fire and forget with monitoring".

**4. Eskalacja > natychmiastowe poddanie sie.** Zamiast "nie fillnal -> IOC od razu", robimy stopniowa eskalacje (ALO -> GTC -> IOC). Wiekszosc slice'ow fillnie sie jako maker, tylko ostatnie moga byc taker.

**5. Design for failure.** Kazda metoda ma graceful fallback. TWAP nie startuje? -> IOC. Slice rejected? -> Eskalacja. Timeout? -> IOC reszty. Cena uciekla? -> IOC reszty. Zawsze jest plan B.

---

## Fib Guard — nie shortuj dna

### Problem: shortowanie przy samym supportcie

Wyobraz sobie ze jestes w wojsku i dostajesz rozkaz "bombarduj wroga". Ale twoje bomby laduja na wlasnej linii frontu. To wlasnie robil nasz bot — otwienal shorty tuz nad kluczowymi supportami Fibonacciego, a potem cena odbijala i pozycja byla underwater.

Prawdziwy przyklad: APEX przy Fib 0.786 ($0.2902). Bot zaladowal shorty, bounce +5%, strata. Smart Money nie shortuja dna — czekaja na odbicie i dopiero wtedy atakuja. Nasz bot powinien robic to samo.

### Co to Fibonacci i dlaczego dziala?

Fibonacci retracement to narzedzie analizy technicznej oparte na ciagu Fibonacciego (0, 1, 1, 2, 3, 5, 8, 13...). Kluczowe poziomy to **0.618** (zloty podzial), **0.786** i **1.0** (pelna korekta). Dlaczego dzialaja? Bo tysiace traderow patrza na te same poziomy — staja sie samospelniajaca przepowiednia (self-fulfilling prophecy).

Kiedy cena spada o 61.8% zakresu (high24h - low24h), wielu traderow sklada bidy wlasnie tam. Efekt: wsparcie, odbicie, i nasz short traci pieniadze.

Obliczenie jest proste — zero zaleznosci, czysta matematyka:

```
range = high24h - low24h

Fib 0.618 = high24h - range × 0.618   ← KEY SUPPORT
Fib 0.786 = high24h - range × 0.786   ← STRONG SUPPORT
Fib 1.000 = low24h                     ← DNO (pelna korekta)
```

### Jak dziala Fib Guard?

Guard NIE blokuje shortow calkowicie — to bylby zbyt agresywne. Zamiast tego **redukuje moc askow** (askMultiplier) proporcjonalnie do tego jak blisko cena jest supportu.

Trzy sygnaly skladaja sie na "guard score":

```
guardScore = fibProximity × 0.50 + rsiScore × 0.25 + drawdownScore × 0.25
```

| Sygnal | Waga | Co mierzy | Kiedy = 1.0 |
|--------|------|-----------|-------------|
| **fibProximity** | 50% | Odleglosc ceny od najblizszego Fib support | Cena dokladnie na poziomie |
| **rsiScore** | 25% | Czy rynek jest oversold (pseudo-RSI z momentum) | RSI <= 30 |
| **drawdownScore** | 25% | Jak bardzo cena spadla od 24h high | Drawdown >= 8% |

Wynikowy askMultiplier:

| Guard Score | Ask Multiplier | Znaczenie |
|-------------|----------------|-----------|
| >= 0.7 | × 0.15 | STRONG — prawie zero nowych shortow |
| >= 0.5 | × 0.30 | MODERATE — 30% mocy |
| >= 0.3 | × 0.50 | LIGHT — polowa mocy |
| < 0.3 | × 1.00 | Bez zmian — daleko od supportu |

### SM Override — General ma ostatnie slowo

Kluczowa innowacja: gdy Smart Money **aktywnie** shortuja z wysokim conviction, FibGuard ustepuje. Bo jesli General mowi "shortuj mimo supportu", to wie cos czego Fibonacci nie widzi.

```
SM Confidence >= 70% + aktywnie SHORT → FibGuard OFF (pelne aski)
SM Confidence >= 50% + aktywnie SHORT → guardScore × 0.5 (polowiczny guard)
SM Confidence <  50%                  → FibGuard dziala normalnie
```

Analogia: FibGuard to straznik przy bramie mowiacy "nie wchodzic, strefa niebezpieczna". Ale jesli General (SM z 70%+ conviction) rozkazuje "atakuj!" — straznik salutuje i przepuszcza.

### Pseudo-RSI — dlaczego nie prawdziwy?

Prawdziwy RSI wymaga 15+ candle close prices. W naszym grid pipeline mamy tylko snapshot z momentum (change1h, change4h). Wiec aproksymujemy:

```
pseudoRsi = 50 + (change1h × 5) + (change4h × 2)
```

Przyklad: 1h = -3%, 4h = -5% → pseudoRsi = 50 + (-15) + (-10) = **25** (oversold).

Czy to dokladne? Nie. Czy jest "wystarczajaco dobre" zeby chronic przed shortowaniem dna? Tak. Jesli okazaloby sie za slabe, mozna dodac prawdziwy RSI do MarketSnapshot (cache w data fetcher) — ale po co dodawac kolejne API call jesli prosta heurystyka dziala?

**Lekcja: 80% rozwiazanie dzis > 100% rozwiazanie za tydzien.** W tradingu liczy sie execution speed. Bot ktory czeka na idealny RSI traci pieniadze podczas czekania.

### Przyklad z zycia — APEX z wykresu

```
high24h = $0.3200, low24h = $0.2800
range = $0.0400

Fib levels:
  0.618 = $0.3200 - $0.0400 × 0.618 = $0.2953
  0.786 = $0.3200 - $0.0400 × 0.786 = $0.2886
  1.000 = $0.2800

Cena = $0.2902 (z wykresu)
  → odleglosc od Fib 0.786 ($0.2886) = 55bps

Z default config (proximityBps=50): fibProximity = 0 (poza zasiegiem)
Z LIT/FARTCOIN override (proximityBps=80): fibProximity = 1 - 55/80 = 0.31

change1h = -2%, change4h = -4% → pseudoRsi = 32 → rsiScore = 0.87
drawdown = 9.4% → drawdownScore = 1.0

guardScore = 0.31×0.50 + 0.87×0.25 + 1.0×0.25 = 0.62
→ MODERATE → ask × 0.30

Zamiast pelnych shortow, bot uzywa 30% mocy. Jesli cena odbije — mniej strat.
Jesli cena przebije support i dalej spada — nadal mamy 30% pozycji.
```

### Per-token overrides

Kazdy token ma inna zmiennosc. BTC porusza sie wolniej niz LIT. Dlatego:

| Token | proximityBps | drawdownMaxPct | Dlaczego |
|-------|-------------|----------------|----------|
| BTC | 30 (0.3%) | 5% | Stabilny, tighter |
| ETH | 35 (0.35%) | 6% | Troche bardziej zmienny |
| LIT | 80 (0.8%) | 12% | Volatile memecoin, szersze progi |
| FARTCOIN | 80 (0.8%) | 12% | Volatile memecoin, szersze progi |
| Default | 50 (0.5%) | 8% | Srodek |

Pattern jest identyczny jak w BounceFilter i DipFilter — defaults + per-token overrides + getter function. Caly config w jednym pliku (`short_only_config.ts`), zero nowych plikow.

### Gdzie w pipeline?

```
Grid Pipeline (mm_hl.ts):
  ...
  → Bounce Filter (nie shortuj w spadku, czekaj na bounce)
  → 🏛️ FIB GUARD (nie shortuj na supportcie)      ← TUTAJ
  → Dip Filter (nie kupuj na szczycie, czekaj na dip)
  ...
```

FibGuard siedzi miedzy Bounce Filter a Dip Filter. Logika: Bounce Filter mowi "nie shortuj w trakcie spadku", FibGuard mowi "nie shortuj na supportcie nawet po bounce'u", Dip Filter mowi "nie longuj na szczycie".

### Pliki zmienione

| Plik | Co | Ile linii |
|------|-----|-----------|
| `src/config/short_only_config.ts` | Interface, defaults, overrides, getter | +45 |
| `src/mm_hl.ts` | Import + integracja w grid pipeline | +78 |

### Lekcje

**1. Redukuj, nie blokuj.** Poprzednie filtry (HARD_BLOCK) blokowaly calkowicie — zero shortow. Problem: kiedy mialy racje, tracilismy okazje. FibGuard redukuje moc zamiast blokowac — nawet w najgorszym przypadku (score 0.7+) mamy 15% mocy. Jesli support przebity — nadal mamy pozycje.

**2. SM Override ratuje sytuacje.** Fibonacci to tylko techniczna analiza — linie na wykresie. Smart Money widza rzeczy ktorych linie nie widza (insajderzy, flow data, portfolio context). Dlatego SM z wysokim conviction overriduja guard. Hierarchia: SM > TA.

**3. Kazdy filtr to warstwa obrony.** Bounce Filter, FibGuard, Dip Filter — kazdy chroni przed innym bledem. Razem tworza defense-in-depth. Zaden filtr nie jest idealny, ale razem pokrywaja wiekszosc scenariuszy.

**4. Taki sam pattern = mniej bugow.** FibGuard uzywa dokladnie tego samego wzorca co BounceFilter: config interface → defaults → overrides → getter → if block w pipeline. Kazdy nowy filtr dodaje ~100 linii ale nie zmienia architektury. Developer za rok zrozumie go natychmiast bo wygada jak kazdy inny filtr.

---

## Czyszczenie danych — Fasanara, Dormant Decay, Manual Boost

> "Garbage in, garbage out. Nie ma znaczenia jak genialny jest twoj algorytm, jezeli karmisz go smieciowymi danymi."

### Problem: Audyt ujawnil trzy trucizny w danych

Wyobraz sobie, ze masz 22 agentow w terenie i zbierasz ich raporty zeby zdecydowac co robic. Brzmi rozsadnie. Ale co jesli:

1. **Jeden z nich to podwojny agent** — Fasanara Capital. Raportuje "SHORT $83.9M!" ale tak naprawde to market maker. Jego shorty to hedges (zabezpieczenia), nie zaklady na spadki. To tak jakby szpieg raportujacy pozycje wroga okazal sie sprzedawca hot-dogow ktory stoi obok kazdej armii.

2. **9 agentow zasneło w terenie** — nie ruszyli sie od 7 do 21 dni. Kapitan BTC trzyma $20.3M SHORT od 3 tygodni i nie zmienil ani grama. Ale tracker liczy go tak samo jak Generala ktory aktywnie traduje co 30 sekund. To jakby raport zwiadowcy z zeszlego miesiaca traktowac na rowni z raportem z dzisiejszego poranka.

3. **Najcenniejszy agent ma najnizsza range** — OG Shorter ($23M pozycji, +$15.5M zysku, traduje RECZNIE z 2 fillami na tydzien) mial finalWeight=0.13. Dla porownania, Generał (bot algorytmiczny) mial 0.95. Dlaczego? Bo OG Shorter nie mial nansen_label, wiec dostal domyslna credibility 0.20. **6x niedowazony** — najlepszy czlowiek w pokoju mial najcichszy glos.

### Jak to wygladalo w liczbach

```
PRZED czyszczeniem:
  BTC SM agregat:  SHORT $153M vs LONG $0
  → Fasanara wrzuca $24M "phantom SHORT" (to hedge, nie bet)
  → 5 dormant adresow wrzuca $47M "stale SHORT"
  → OG Shorter z $5M SHORT liczy sie jako $650K (weight 0.13)

Prawdziwy "zywy" sentiment aktywnych traderow:
  Duzo mniejszy SHORT consensus niz tracker pokazywal
```

### Fix A: Fasanara Capital → Market Maker (weight 0.0)

To bylo proste. Audyt fills ujawnil smoking gun:

| Metryka | Fasanara | Normalny trader |
|---------|----------|-----------------|
| Maker fills | **100%** | 0-60% |
| CLOID (Custom Order ID) | **100%** | 0-100% |
| Pozycje | 70+ coinow | 3-15 coinow |
| Interpretacja | **Market maker** | Directional |

100% maker fills = nigdy nie "bierze" z ksiazki zlecen, zawsze "wystawia". To definicja market makera. Ich shorty to nie "stawiam na spadki BTC", to "zapewniam plynnosc na rynku i hedguje ryzyko".

**Zmiana w kodzie:**
```python
# PRZED:
"tier": "FUND",
"signal_weight": 0.85,
"nansen_label": "Fund",

# PO:
"tier": "MARKET_MAKER",
"signal_weight": 0.0,
"nansen_label": "Market Maker",
```

`final_weight = 0.0 * 0.0 = 0.0` → linia `if final_weight == 0: continue` → Fasanara kompletnie znika z agregatu. ~$64M phantom SHORT usuniete jednym ruchem.

**Lekcja:** Nie kazdy kto ma duza pozycje jest directional traderem. Market makerzy to "infrastruktura" rynku — musza miec pozycje po obu stronach zeby dzialac. Ich SHORT to nie bearish signal, to koszt prowadzenia biznesu.

### Fix B: Dormant Decay — usypiajace adresy traca glos

To bardziej elegancki problem. Nie mozesz po prostu usunac dormant adresow — moze sa "set and forget" traderzy z genialna teza. Ale nie mozesz tez traktowac ich na rowni z kims kto aktywnie zarzadza pozycja.

**Analogia:** Wyobraz sobie sondaz wyborczy. Pytasz 100 osob "na kogo glosujesz?". 30 z nich odpowiada "na partię X" ale dodaje "odpowiadalem to samo 3 tygodnie temu i od tego czasu nie sledzę polityki". Czy ich glos powinien liczyc sie tak samo jak kogos kto przeanalizowal program wyborczy wczoraj?

**Mechanizm:**

```
                    DORMANT DECAY
    ┌──────────────────────────────────────────┐
    │ Dni bez zmian     Mnoznik wagi           │
    │ ─────────────     ────────────           │
    │ 0-7 dni           1.0 (pelna waga)       │
    │ 7-14 dni          0.50 (polowa)          │
    │ 14-21 dni         0.25 (cwierc)          │
    │ 21+ dni           0.10 (prawie zero)     │
    └──────────────────────────────────────────┘
```

**Implementacja w 3 czesciach:**

**1. Activity tracker** (`/tmp/whale_activity.json`):
```json
{
  "0xa31211...": 1740412800,    // Generał — zmienił pozycję 15 min temu
  "0x71dfc0...": 1738900000,    // Kapitan BTC — ostatnia zmiana 21 dni temu
}
```

Kazdy run whale_trackera porownuje current vs previous pozycje. Jezeli COKOLWIEK sie zmienilo (nowa pozycja, zamknieta, zmieniony rozmiar, flip) — aktualizuje timestamp na "teraz".

**2. Update w `run_tracker()`** — po `detect_changes()`:
```python
for address in WHALES.keys():
    curr_map = {p['coin']: (p['side'], p['position_value']) for p in current_positions}
    prev_map = {p['coin']: (p['side'], p['position_value']) for p in previous_positions}
    if curr_map != prev_map:
        activity[addr] = now_epoch  # Ten adres jest aktywny!
```

**3. PnL-aware Decay w `aggregate_sm_positions()`** (updated):

Pierwsza wersja decay byla slepa — kazdego dormant karano jednakowo. Ale analiza danych pokazala cos zaskakujacego: **dormant adresy mialy NAJLEPSZY timing**. Ktos kto shortnal BTC przy $106K i trzyma od 21 dni z +$14.8M uPnL to nie "zombie" — to **diamond hands**.

```python
addr_total_upnl = sum(p.get('unrealized_pnl', 0) for p in positions)

if days_since_change > 7 and addr_total_upnl > 0:
    # 💎 Diamond Hands: profitable hold = conviction, not dormancy
    dormant_factor = 1.0
elif days_since_change > 21:   dormant_factor = 0.10  # Stale loser
elif days_since_change > 14:   dormant_factor = 0.25
elif days_since_change > 7:    dormant_factor = 0.50
else:                          dormant_factor = 1.0

final_weight = signal_weight * credibility * dormant_factor
```

**Kluczowa roznica:** Jesli trzymasz pozycje i zarabiasz — pelna waga. Jesli trzymasz i tracisz — decay.

**Sprytny detal — pierwszy run:** Przy pierwszym uruchomieniu nie ma jeszcze historii aktywnosci. Zamiast karać wszystkich jako "dormant", inicjalizujemy kazdy adres z biezacym czasem (`now_epoch`). Dopiero NASTEPNE runy zaczynaja wykrywac kto jest aktywny a kto nie. To "graceful degradation" — system zaczyna ostroznie i stopniowo uczy sie prawdy.

**💎 Diamond Hands Hall of Fame (7 adresow, +$44M uPnL):**

| Trader | Dni dormant | Pozycja | uPnL | PnL% | Status |
|--------|------------|---------|------|------|--------|
| Kapitan BTC | 21d | $35.1M SHORT | **+$14.8M** | 41.8% | 💎 full weight |
| Kraken A | 15d | $26.9M SHORT | **+$12.8M** | 47.2% | 💎 full weight |
| Kapitan feec | 15d | $22.0M SHORT | **+$8.3M** | 37.3% | 💎 full weight |
| Porucznik SOL2 | 16d | $11.8M SHORT | **+$4.9M** | 41.3% | 💎 full weight |
| Abraxas Capital | 18d | $7.2M SHORT | **+$2.1M** | 29.1% | 💎 full weight |
| Kraken B | 18d | $2.5M SHORT | **+$1.0M** | 41.6% | 💎 full weight |
| Kapitan 99b1 | 15d | $1.5M SHORT | **+$338K** | 21.5% | 💎 full weight |

**💤 Stale losers (decay):**

| Trader | Dni dormant | uPnL | Decay |
|--------|------------|------|-------|
| ZEC Conviction | 14d | **-$3.8M** | ×0.25 |
| Arrington XRP | 18d | **-$402K** | ×0.25 |

Logi: `💎 [DIAMOND_HANDS] Kapitan BTC: 21d holding, +$14,775,492 uPnL → full weight`
Logi: `💤 [DORMANT] ZEC Conviction: 14d inactive, $-3,782,011 uPnL → weight ×0.25`

### Fix C: Manual Trader Boost — cisza to nie slabość

To moj ulubiony fix bo pokazuje jak kontraintuicyjne sa dobre dane.

**OG Shorter** — facet ktory:
- Trzyma $23M SHORT
- Ma +$15.5M zysku
- Traduje RECZNIE (2 fille na tydzien!)
- Zlapal top BTC ($97K entry) i top ETH ($3,070 entry)
- Mial `finalWeight = 0.13`

**Dlaczego?** Bo braklo mu jednego pola w konfiguracji:

```python
# PRZED:
"signal_weight": 0.65,
# Brak nansen_label → credibility = 0.20 (Unknown)
# 0.65 × 0.20 = 0.13

# PO:
"tier": "CONVICTION",
"signal_weight": 0.85,
"nansen_label": "All Time Smart Trader",  # credibility = 0.95
# 0.85 × 0.95 = 0.8075
```

Z 0.13 na 0.81 — **6-krotny boost**. Z najcichszego glosu w pokoju do jednego z najglosniejszych.

**Dlaczego manual traderzy sa tak cenni?**

Pomysl o tym tak: masz pilota odrzutowca (algorytm) i masz snajpera (manual trader).

Pilot lata 1,977 misji dziennie (Generał ma 1,977 filli/24h). Reaguje na sygnaly quantitative w milisekundach. Jest niesamowicie skuteczny... ale moze sie mylic systematycznie, bo jego model nie uwzglednia czegos czego nie widzi w danych.

Snajper strzela 2 razy na tydzien. Ale kazdy strzal jest wynikiem GODZIN analizy — czytania newsow, rozmow z innymi traderami, intuicji zbudowanej na latach doswiadczenia. Jego trades to **pure conviction** — nie noise.

W tradingu: bot moze miec 1000 filli ktore na koniec dnia netto = zero. Manual trader ma 2 fille ktore netto = +$15.5M. Kto ma wiekszą wartosc informacyjna?

**Kapitan fce0** tez dostal maly boost (0.80 → 0.85) — manual trader z +$6.2M, rzadko traduje, najnizsze entry BTC z Kapitanow ($90,472).

### Fix D: October 2025 Manual Traders — szukanie igiel w stogu siana

Po audycie istniejacych adresow przyszedl czas na **ekspansje** — czy sa traderzy ktorych nie sledzilismy a powinniśmy?

**Metoda:** Cross-reference Nansen BTC Short leaderboard z naszym whale_tracker. Nansen pokazuje kto shortuje BTC — porownalismy z naszymi ~40 adresami i znalezlismy **11 nowych** adresow ktorych nie trackujemy. Z tych 11, wiekszość to dust (pare dolarow equity, porzucone konta). Ale dwa adresy okazaly sie **zlotymi strzalami**:

**October Shorter f62ede** (`0xf62ede...`):
- $769K equity, multi-asset shorter
- BTC SHORT $3.5M (entry $105.5K, +$2.4M, **+67%**)
- ZEREBRO SHORT **+2503%** (tak, dwa i pol tysiaca procent)
- PUMP SHORT +187%, HYPE SHORT +17.5%
- Nansen "Smart HL Perps Trader" — zweryfikowany

**October Shorter c1471d** (`0xc1471d...`):
- $1.7M equity, aggressive multi-asset shorter
- BTC SHORT $2.9M (entry $113.6K, +$2.3M, **+80%**)
- ETH SHORT $2M (+$2.1M, **+106%**)
- SOL SHORT $1M (+$784K, **+75%**)
- FARTCOIN SHORT **+718%**
- Plus 8 wiecej pozycji SHORT — facet shortuje dosłownie wszystko
- Nansen "Smart HL Perps Trader" — zweryfikowany

Obaj sa **MANUAL traderzy** (nie boty) — to byla kluczowa informacja od uzytkownika. W swiecie gdzie 90% aktywnosci to algo/boty, ludzki trader ktory konsekwentnie zarabia jest najcenniejszym sygnalem.

**Konfiguracja:**
```python
"0xf62edeee17968d4c55d1c74936d2110333342f30": {
    "tier": "CONVICTION",
    "signal_weight": 0.80,
    "nansen_label": "Smart HL Perps Trader",  # credibility 1.0
}
# finalWeight = 0.80 × 1.0 = 0.80
```

Dlaczego 0.80 a nie 0.90? Bo to nowe adresy — jeszcze nie widzielismy ich zachowania w naszym systemie. Jesli sie sprawdza (konsekwentni, precyzyjni), mozna podniesc.

### Podsumowanie efektu

```
PRZED:
  Fasanara:        0.85 × 0.90 = 0.765 (phantom MM signal)
  9 dormant:       pelna waga ($66.7M stale positions)
  OG Shorter:      0.65 × 0.20 = 0.130 (niewidoczny)
  October traders: nie trackowane (0.00)

PO (wersja 1 — slepa):
  Fasanara:        0.0 (wyłączony)
  9 dormant:       ×0.10 do ×0.50 (~$10M) ← ALE karano diamond hands!
  OG Shorter:      0.85 × 0.95 = 0.808 (6x glosniejszy)

PO (wersja 2 — PnL-aware):
  Fasanara:        0.0 (wyłączony — nie jest traderem)
  7 diamond hands: 💎 pelna waga ($110M, +$44M uPnL — najlepszy timing!)
  2 stale losers:  💤 ×0.25 (ZEC -$3.8M, Arrington -$402K)
  OG Shorter:      0.85 × 0.95 = 0.808 (6x glosniejszy)
  2 October traders: 0.80 × 1.0 = 0.80 (nowe sygnaly, +$4.7M combined)
```

SM agregat jest teraz **czystszy i madrzejszy** — odroznia "zombie pozycje" (trzyma i traci) od "diamond hands" (trzyma i zarabia). Ktos kto shortnal BTC przy $106K i siedzi na +$14.8M to nie zombie — to geniusz. A teraz mamy tez dwoch nowych traderow z October cohort ktorzy dokladaja ~$6.4M weighted SHORT do agregatu.

### Fix E: Nansen Leaderboard Expansion + Open Orders Intelligence (24.02)

Po dodaniu October traderow, poszerzyliśmy search na caly Nansen BTC Short leaderboard. Znaleźliśmy dwoch potężnych shorterow:

**Mega Shorter 218a65** (`0x218a65e21eddeece7a9df38c6bbdd89f692b7da2`):
- $3.4M equity, BTC SHORT **$25.6M** (358 BTC!)
- Entry $71,253 — shortuje od pazdziernika 2025
- +$3M unrealized, **+186% ROI**, 14x leverage
- Funded from Coinbase → individual human trader (MANUAL)
- Liquidation $71.6K — tight! Ale ma $5.8M DeFi collateral jako safety net

**Algo Shorter d62d48** (`0xd62d484bda5391d75b414e68f9ddcedb207b7d91`):
- $8.6M equity, BTC SHORT **$20.9M** (279 BTC)
- Entry $75,151, +$3.4M unrealized, **+778% ROI** (!), 40x leverage
- 14,996 trades w 30 dni = oczywisty algo bot
- #16 na Nansen BTC PnL leaderboard (+$5.1M/30d)
- Anonymous — zero relacji z innymi adresami

**Problem z finalWeight:** Oba adresy nie maja `nansen_label`, wiec credibility = 0.30 (Unknown). To daje:
- 218a65: 0.75 × 0.30 = **0.225** (w porownaniu z f62ede ktore ma 0.80 × 1.0 = 0.80)
- d62d48: 0.70 × 0.30 = **0.21**

Jesli uzytkownik dostarczy Nansen labele, finalWeight skoczy 3-4x. To pokazuje jak wazna jest weryfikacja zewnetrzna.

### Open Orders Intelligence — SM Take-Profit Targets

Najciekawsze odkrycie sesji: Hyperliquid API `openOrders` endpoint ujawnia **dokladne ceny** na jakich SM planuja zamykac pozycje lub re-enterowac.

**BTC Consensus Zone: $50,000-$53,500:**
- **58bro.eth**: 26 BTC bids rozlozonych $50,000-$62,500 (łącznie **$17.76M**)
- **Pulkownik**: 150 BTC bids na $50,525-$53,525 (**$7.73M**) — zamknal WSZYSTKIE shorty i czeka na re-entry
- **October f62ede**: BTC bids skupione $51,139-$52,639

Trzech niezaleznych traderow (rozny styl, rozne adresy, zero powiazań) ustawia bidy w tej samej strefie $50-53K. To silny consensus.

**October f62ede — Apocalyptic Targets:**
```
ETH bids: $521 - $1,563   (vs current ~$2,800)
SOL bids: $21 - $50        (vs current ~$150)
XRP bids: $0.11 - $0.63    (vs current ~$2.50)
```

Ten trader oczekuje totalnego market wipeout — ETH do $500, SOL do $20. Albo jest geniuszem albo szalehcem. Ale patrzac na jego +$2.4M uPnL z BTC shorta... moze nie jest szaloncem.

**Kraken B**: 247 (!) orders across ETH/SOL/XRP/HYPE/ZEC (~$9.1M) — przygotowany na masowa przecene.

**Kluczowy wniosek:** `openOrders` to **okno do strategii** SM. Nie tylko widzimy co robia (pozycje), ale tez **co planuja** (ordery). To jak czytanie notatek z posiedzenia zarzadu przed ogłoszeniem decyzji.

### Zaktualizowane podsumowanie

```
PO (wersja 5 — Selini→MM + alert filter):
  Fasanara:          0.0 (MARKET_MAKER — nie jest traderem)
  Selini Capital:    0.0 (×2 konta, MARKET_MAKER — tight MM grids potwierdzone)
  7 diamond hands:   💎 pelna waga ($110M, +$44M uPnL)
  2 stale losers:    💤 ×0.25 (ZEC -$3.8M, Arrington -$402K)
  OG Shorter:        0.85 × 0.95 = 0.808 (6x boost)
  2 October traders: 0.80 × 1.0 = 0.80 (Nansen verified, +$4.7M)
  Mega Shorter:      0.75 × 0.30 = 0.225 ($25.6M BTC SHORT)
  Algo Shorter:      0.70 × 0.30 = 0.21 ($20.9M BTC SHORT)
  Contrarian Long:   0.15 × 1.0 = 0.15 (negative confirmation, -$597K)
  MM alert filter:   detect_changes() skips MARKET_MAKER → zero szumu
  Total tracked:     58 adresow (3 MM wyciszone)
```

### Fix F: Selini Capital — trzy zmiany jednego dnia (24.02)

Historia Selini Capital to lekcja o weryfikacji. Chronologicznie:

1. **22.02**: Usunelismy Selini (5 kont MM) z trackera — spam alertow, flipuja non-stop
2. **24.02 rano**: Live scan Nansen pokazuje FRESH BTC shorts na 2 nowych kontach @ $62,940. Wyglada na directional bet. Re-add jako FUND, weight 0.40
3. **24.02 po poludniu**: Sprawdzamy openOrders API i... Selini ma tight spread MM grids ($57-100 spread). To nie directional — to klasyczny market making. **Reklasyfikacja na MARKET_MAKER, weight 0.0**

**Lekcja:** Pozycja (SHORT $3.4M) **nie oznacza** directional conviction. Market maker tez ma pozycje — ale to hedging, nie przekonanie o kierunku. Dopiero **open orders** ujawniaja prawdziwa intencje. Selini ma symetryczny grid buy/sell z minimalnym spreadem — to czysta platforma MM, nie zakład o spadek BTC.

**Contrarian tracker** to nowy koncept. Adres 0x015354 to jedyny znaczacy SM z BTC LONG ($12M, 191 BTC). Wszyscy inni sa SHORT. Dajemy mu weight 0.15 — celowo niski, bo sluzy jako **negative confirmation**. Kiedy on traci (teraz -$597K), to potwierdza ze SHORT consensus jest sluszny.

### Fix G: MARKET_MAKER alert filter (24.02)

Prosty ale wazny fix. `detect_changes()` w whale_tracker.py iterowalo po WSZYSTKICH adresach w WHALES dict — wlacznie z MARKET_MAKER. Mimo ze MMs maja weight=0.0 (zero wplywu na sygnaly bota), tracker i tak generowal alerty Telegram o ich flipach.

**Fix:** Jedna linia: `if whale_info.get('tier') == 'MARKET_MAKER': continue`

**Efekt:** Fasanara Capital, Selini #1, Selini #2 — zero alertow. Czysty feed z alarmami tylko od prawdziwych traderow.

To jest pattern ktory warto zapamietac: **jesli cos nie wplywa na decyzje, nie powinno generowac alertow**. Szum zaglusza sygnal.

**SM Activity Snapshot (24.02):**
- 58bro.eth realizuje zyski — sprzedal ~49 BTC ($3.1M) dzisiaj @ $63K
- OG Shorter c7290b zredukowal 20 BTC ($1.3M) wczoraj @ $66,130
- Selini Capital — swiezy entry, ale potwierdzone jako MM (tight grids)
- Jedyny notable LONG (0x015354) juz -$597K underwater

**58bro.eth BTC open orders deep dive:**
41 orderow, $12.5M total. Kluczowy insight — 25 BUY orderow $50K-$62K to **take profit** na shorcie (zamykanie po nizszej cenie). 16 SELL orderow $66K-$69.75K to **scaling in** (dodawanie do shorta przy odbiciu). Gap $62K-$66K = strefa konsolidacji. 58bro nie planuje zamykac ani flipowac — jesli cena spadnie, bierze zysk; jesli wzrosnie, shortuje jeszcze wiecej. **Hardcore diamond hands bear.**

### Lekcje

**1. Garbage in, garbage out — nawet w "prostych" systemach.** Nasz system wazenia (signal_weight × credibility) jest elegancki. Ale jesli karmisz go bledna klasyfikacja (Fasanara = Fund zamiast MM) albo brakujacymi danymi (OG Shorter bez nansen_label), to nawet najlepszy algorytm da zle wyniki. **Audyt danych jest wazniejszy niz ulepszanie algorytmu.**

**2. Nie usuwaj — degraduj. Ale degraduj MADRZEJ.** Pierwsza wersja dormant decay slepо karale wszystkich dormant adresow. Ale dane pokazaly ze dormant + profitable = diamond hands (najlepszy timing w calym trackerze!). Dopiero druga iteracja (PnL-aware) poprawnie rozroznia "trzyma i zarabia" (pelna waga) od "trzyma i traci" (decay). **Pierwsza implementacja rzadko jest idealna — iteruj na podstawie danych, nie intuicji.**

**3. Activeness ≠ Importance.** Bot z 2000 fillami dziennie nie jest wazniejszy od czlowieka z 2 fillami tygodniowo. Czestotliwosc tradingu to nie signal quality. Najcenniejsi traderzy w naszym systemie (OG Shorter, Kapitan fce0) traduja najrzadziej ale z najwieksza precyzja. To samo z dormant holders — Kapitan BTC nie ruszyl pozycji 21 dni i ma +$14.8M profit. Czasem najlepsza decyzja to **nie robic nic**.

**4. Jeden plik, trzy fixy.** Cala ta zmiana dotyczy jednego pliku (`whale_tracker.py`). Fasanara to 3 pola, dormant decay to ~35 linii kodu, manual boost to 4 pola. Lacznie <50 linii zmian, ale efekt na jakosc sygnalu jest ogromny. **Najlepsze fixy to czesto te najkrotsze.**

**5. First run graceful degradation.** Dormant decay ustawia baseline przy pierwszym uruchomieniu zamiast panikować ze nie ma danych. Dobry pattern: zawsze zakładaj ze system moze sie uruchomic bez historii i stopniowo buduj wiedze.

**6. Diamond Hands to prawdziwa strategia.** 7 adresow ktore shortowaly i nie ruszaly pozycji przez 2-3 tygodnie maja lacznie +$44M uPnL. To nie jest lenistwo — to CONVICTION. W swiecie gdzie 99% traderow robi overtrading, ktos kto wchodzi i czeka jest statystycznie lepszy. Nasz system teraz to rozumie — `💎 [DIAMOND_HANDS]` to nie ozdoba, to informacja ze ten trader wie co robi.

**7. Cross-reference to najlepsza metoda odkrywania.** Nansen ma leaderboard "kto shortuje BTC". My mamy liste 40 adresow. Porownanie tych dwoch zrodel dalo 11 nowych kandydatow, z ktorych 2 okazali sie swietni (+$4.7M combined uPnL). To jak porownywanie list gosci na dwoch imprezach — kto jest na obu, tego warto poznac. Ale klucz to **weryfikacja** — z 11 nowych, 9 to dust/puste konta. Bez sprawdzenia equity i pozycji na Hyperliquid API, dodalibyśmy smieci do systemu. **Odkrywaj szeroko, weryfikuj wasko.**

**8. Open orders to okno do przyszlosci.** Pozycje mowia co SM **robi teraz**. Ale open orders mowia co SM **planuje zrobic**. Kiedy trzech niezaleznych traderow (rozny styl, zero powiazań) ustawia bidy w tej samej strefie $50-53K na BTC, to jest consensus — nie przypadek. A kiedy jeden z nich ustawia ETH bidy na $521 i SOL na $21, to albo szaleniec, albo widzi cos czego inni nie widza. Przy +$2.4M uPnL z BTC shorta, raczej to drugie. **Nie patrz tylko na co ktos robi — patrz na co sie przygotowuje.** `openOrders` to najlepszy darmowy edge na Hyperliquid.

**9. Negative confirmation jest rownie wartosciowa jak positive.** Trackujemy 57 adresow SHORT i 1 adres LONG. Ten jeden LONG (0x015354, $12M BTC @ $65,849) jest juz -$597K underwater. To nie jest "szum" — to **informacja**. Jedyny kto postawil przeciwko consensus traci pieniadze. To potwierdza ze consensus jest sluszny. W systemach tradingowych czesto skupiamy sie na "kto ma racje" i ignorujemy "kto sie myli". Ale ktos kto sie myli jest rownie informatywny — bo mowi ci czego NIE robic. **Dodawaj kontrarianow do trackera z niskim weight — ich straty sa twoim zyskiem informacyjnym.**

**10. Drugie szanse wymagaja ostrożnosci — i weryfikacji.** Selini Capital: usunięte 22.02 za spam → re-added 24.02 (fresh shorts, wyglada na directional) → **znowu reclassified jako MM** tego samego dnia (openOrders ujawnilo tight spread grids). Dalismy im druga szanse i okazalo sie ze nie zasluguja. Ale dowiedzielismy sie tego dzieki **weryfikacji orderami**, nie intuicji. **Pozycja nie rowna sie intencji. Open orders ujawniaja prawde. Zawsze weryfikuj przed zaufaniem.**

**11. Jesli cos nie wplywa na decyzje, nie powinno generowac alertow.** MARKET_MAKER adresy mialy weight=0.0 — zero wplywu na sygnaly bota. Ale tracker i tak generowal alerty o ich flipach. To klasyczny szum zagluszajacy sygnal. Fix: jedna linia `if tier == 'MARKET_MAKER': continue`. **Alarm powinien wymagac akcji. Jesli nie — to nie alarm, to spam.**

---

## Rozdzielenie bota — PURE_MM vs SM_FOLLOWER (BOT_MODE)

### Problem: jeden pracownik, dwa zawody

Wyobraz sobie, ze masz jednego czlowieka ktory jest jednoczesnie cierpliwym sklepikarzem (ustawia ceny kupna i sprzedazy, lapie spread) **i** agresywnym snajperem (podaza za Smart Money, trzyma pozycje tygodniami na Diamond Hands). Gdy snajper dostanie rozkaz "TRZYMAJ SHORT!", sklepikarz tez go slyszy i przestaje normalnie handlowac. Jeden crash restartuje obu. Logi sa pomieszane. Debugowanie to koszmar.

To jest dokladnie to co mielismy — jeden monolit `mm_hl.ts` obslugiwal oba tryby z dziesiatkami `if (isPureMm)` / `if (isFollowSm)` branchy.

### Rozwiazanie: Feature Flag, nie Fork

Kluczowa decyzja architektoniczna: **nie skopiowalismy pliku**. Moglibyśmy stworzyc `mm_hl_pure.ts` i `mm_hl_follower.ts` — ale to oznaczaloby dwa pliki po 8000+ linii, gdzie kazda zmiana musi byc robiona w obu. Koszmar utrzymania.

Zamiast tego: jedna flaga `BOT_MODE` w zmiennych srodowiskowych, kilka warunkowych branchow w kodzie, i PM2 uruchamia dwa procesy z tego samego pliku:

```
mm_hl.ts (jeden plik)
    │
    ├── BOT_MODE=PURE_MM     → mm-pure    (kPEPE, port 8083)
    ├── BOT_MODE=SM_FOLLOWER → mm-follower (BTC/ETH/SOL/HYPE/FARTCOIN, port 8082)
    └── BOT_MODE=UNIFIED     → stare zachowanie (backwards compatible)
```

**Zasada:** Jesli masz <10% roznic miedzy wariantami, uzyj flagi. Jesli >50%, rozważ fork. My mielismy ~5% roznic.

### Wrapper Pattern — jedno miejsce kontroli

W grid pipeline jest 4 miejsca gdzie bot pyta "co mi kaze SignalEngine?":
```typescript
const signalEngineResultPause = getAutoEmergencyOverrideSync(pair)  // pause check
const signalEngineResultInv = getAutoEmergencyOverrideSync(pair)    // inventory
const signalEngineResultFso = getAutoEmergencyOverrideSync(pair)    // force short only
const signalEngineResult = getAutoEmergencyOverrideSync(pair)       // regime permissions
```

Moglibyśmy dodac `if (IS_PURE_MM_BOT)` w kazdym z nich. Ale to 4 identyczne bloki kodu — latwo o bug gdy zmienisz jeden a zapomnisz o pozostalych.

Zamiast tego: **jeden wrapper** `getSignalEngineForPair()`:
```typescript
function getSignalEngineForPair(pair: string) {
  if (IS_PURE_MM_BOT) {
    return { mode: MmMode.PURE_MM, bidMultiplier: 1.0, askMultiplier: 1.0, ... }
  }
  return getAutoEmergencyOverrideSync(pair)  // delegacja do oryginalu
}
```

Jedna funkcja, jedna logika, jeden punkt kontroli. Gdybysmy chcieli dodac trzeci tryb — zmieniamy tylko wrapper.

### Overlap Prevention — trust but verify

Dwa procesy dziela ten sam vault na Hyperliquid. Jesli oba zaczna handlowac tym samym pairem — chaos (podwojne ordery, conflicting pozycje). Prosty mechanizm koordynacji:

Kazdy bot zapisuje swoje aktywne pary do `/tmp/mm_active_pairs_<mode>.json`. Przy kazdej iteracji mainLoop sprawdza plik drugiego bota — jesli wykryje overlap, usuwa zduplikowane pary ze swojej listy.

Nie wymaga bazy danych, IPC, czy lockfile — plik JSON w `/tmp` wystarczy.

### Backwards Compatibility

`BOT_MODE` nie ustawiony = `UNIFIED` = identyczne zachowanie jak przed zmianami. To krytyczne — jesli cos pojdzie nie tak, mozesz wrocic do starego monolitu bez zmian w kodzie.

### Lekcja: rozdzielaj odpowiedzialnosci wczesnie

Gdybysmy od poczatku zaprojektowali bota z myśla o dwoch trybach, mielibysmy czyste interfejsy. Zamiast tego musielismy "operowac na otwartym sercu" — dodawac flagi do dzialajacego systemu produkcyjnego. To dzialalo, ale byloby latwiejsze gdybysmy pomysleli o tym wczesniej.

**Zasada dobrej inzynierii:** Gdy widzisz ze jeden modul robi dwie fundamentalnie rozne rzeczy — rozdziel go zanim stanie sie zbyt skomplikowany. Im dluzej czekasz, tym wiecej branchy i wyjatkow musisz ogarniać.

---

## Pump Shield — ochrona shortow przed pumpami

### Problem: zolnierz ucieka z okopow

Wyobraz sobie zolnierza w okopie. Ma rozkaz od generala: "Trzymaj pozycje SHORT". Wszystkie dane — whale tracker, Signal Engine, Smart Money consensus — mowia: "trzymaj shorta, ten token pojdzie w dol".

I nagle — BAM. Cena wyskakuje w gore o 25% w ciagu kilku minut. To nie zmiana trendu — to krotkoterminowa pompka (fake pump). Moze to likwidacje shortow, moze manipulacja, moze po prostu szum rynkowy.

Bot mial rozstawione ordery kupna (bidy) w gridzie — standardowa czesc market-makingu. Kiedy cena poszla w gore, gielda wypelnila te bidy. Bot KUPIL na samym szczycie pompki, zamykajac shorta ze strata.

**Realne straty:**
- **MON 13 lutego**: Bot mial shorta @ ~$0.018. Pump +26% do $0.0225. Bot kupil CALY short w 1 sekundzie (20 transakcji BUY). **Strata: -$2,130.**
- **LIT 6 lutego**: Bot mial shorta @ ~$1.50. Pump +10% do $1.65. Bot kupil 7 razy. **Strata: -$570.**

To tak jakby zolnierz panicznie uciekal na widok flar oswietleniowych — zamiast trzymac pozycje, porzucil ja w najgorszym mozliwym momencie.

### Wzorzec 58bro.eth — profesjonalista robi odwrotnie

58bro.eth to jeden z naszych sledzonych wielorybow — $31.4M w pozycjach, +$9.3M zysku. Robi dokladnie **odwrotnie** od naszego bota:

Kiedy cena pumpa w gore, 58bro **DODAJE do shorta**. Ma SELL ordery na $66K-$69.75K — to nie stop-lossy, to **scale-in levels**. Cena rosnie? Super, sprzedaje wiecej po lepszej cenie. Ma tez BUY ordery na $50K-$62K — to jego take-profit grid, gdzie zamyka shorta z zyskiem.

**Analogia z pokerem:** Amator majacy AK-suited panikuje gdy na flopie wypadaja same karty blotki. 58bro z tym samym ukladem podnosi stawke — wie ze statystycznie wygra, a chwilowe blotki to szum. Pump Shield uczy naszego bota reagowac jak 58bro: **blokuj kupno na pumpie, opcjonalnie dodawaj do shorta**.

### Architektura — 5 krokow na kazdy tick

```
KAZDY TICK (co ~60 sekund):

1. TRACK    → Zapisz cene do historii (last 10 ticks)
2. DETECT   → Sprawdz czy cena rosnie za szybko (min w oknie 5 tickow)
3. SM CHECK → Czy SM mowi SHORT? Czy mamy SHORT pozycje?
4. REACT    → Redukuj/blokuj bidy + opcjonalnie zwieksz aski
5. NUCLEAR  → Usun bidy z grida + anuluj bidy na gieldzie
```

**Detekcja:** Znajdujemy minimum ceny w oknie 5 tickow, obliczamy % wzrostu od minimum do aktualnej ceny. Porownujemy z progami per-token.

**Trzy levele:**

| Level | Co robi | Kiedy |
|-------|---------|-------|
| LIGHT | bid × 0.50 (polowa bidow) | Maly pump (np. BTC +0.5%) |
| MODERATE | bid × 0.10 (90% mniej bidow) | Sredni pump (np. BTC +1%) |
| AGGRESSIVE | bid × 0.00 + usun z grida + cancel na gieldzie | Duzy pump (np. BTC +2%) |

### Dlaczego per-token progi?

1% wzrost na BTC to zupelnie co innego niz 1% na kPEPE:

| Token | Typowa 5-min vol | Light | Moderate | Aggressive |
|-------|-------------------|-------|----------|------------|
| BTC | 0.1-0.3% | 0.5% | 1.0% | 2.0% |
| ETH | 0.2-0.4% | 0.6% | 1.2% | 2.5% |
| SOL | 0.3-0.6% | 0.8% | 1.5% | 3.0% |
| LIT/FARTCOIN/MON | 0.5-1.5% | 1.5% | 3.0% | 5.0% |
| kPEPE | 0.5-2.0% | 2.0% | 4.0% | 6.0% |

**Zasada kciuka:** Light prog = ~2x normalnej 5-minutowej zmiennosci. Chcemy lapac prawdziwe pumpy, nie normalny szum.

**kPEPE ma `scaleInEnabled: false`** — bo jest w trybie PURE_MM (symetryczny market making). Nie chcemy dodawac kierunkowych pozycji na kPEPE. Na BTC/LIT/FARTCOIN (FOLLOW_SM_SHORT) scale-in ma sens — dodajesz do shorta na pumpie, jak 58bro.

### SM Integration — nie blokuj "prawdziwych" pumpow

Kluczowa inteligencja: Shield NIE blokuje bidow gdy SM mowi LONG i cena rosnie. Bo wtedy pump jest "prawdziwy" — aligned z fundamentami. Blokuje TYLKO gdy SM mowi SHORT (pump to false move).

| SM Dir | Pump | Shield | Dlaczego |
|--------|------|--------|----------|
| SHORT | YES | ACTIVE | Pump to trap — nie kupuj |
| LONG | YES | OFF | Pump aligned z SM — pozwol zamknac |
| any | NO | OFF | Normalny rynek |

### Gdzie siedzi w pipeline

```
sizeMultipliers = { bid: 1.0, ask: 1.0 }
       |
       v
  PUMP SHIELD          ← NOWE (modyfikuje bid/ask)
  BOUNCE FILTER        (modyfikuje ask)
  FIB GUARD            (modyfikuje ask)
  DIP FILTER           (modyfikuje bid)
  FUNDING FILTER       (blokuje gdy funding crowded)
       |
       v
  === GENEROWANIE GRIDA ===
       |
       v
  PROFIT_FLOOR         (usun ordery zamykajace ze strata)
  PUMP SHIELD NUCLEAR  ← NOWE (usun bidy + cancel na gieldzie)
  ZEC TREND STOP
  HOLD_FOR_TP
  EMERGENCY
```

Shield jest **addytywny** — mnozy istniejace multipliers (`bid *= 0.50`), nie nadpisuje. Jesli HOLD_FOR_TP juz ustawilo bid=0, to 0 × 0.50 = 0 — bez zmian. Shield nie walczy z innymi filtrami, tylko je wzmacnia.

**Kluczowe:** Pump Shield NIE blokuje Anaconda SL. Jesli strata przekroczy 7-12%, pozycja MUSI sie zamknac. Shield chroni tylko przed zamknieciem przez GRID bidy.

### Symulacja — MON 13 lutego z Pump Shield

```
Tick 1: $0.0180 (short entry)
Tick 2: $0.0182 (+1.1%)
Tick 3: $0.0190 (+5.6% od min) ← AGGRESSIVE (>5%)
  → bid x 0.00, usuwam bidy, cancelluje na gieldzie
  → Bot NIE KUPUJE. Short bezpieczny.
Tick 4: $0.0225 (+25% od min) ← AGGRESSIVE
  → Shield nadal aktywny. Zero bidow na gieldzie.
  → BEZ shield: 20 BUYs @ $0.0225 = -$2,130
  → Z shield:  zero kupna. Short trzymany.
Tick 5-7: cena wraca... cooldown...
Tick 8: $0.0175 → full bids restored, short w zysku
```

**Oszczednosc: $2,130.**

### Dwa pliki, ~140 linii

**`src/config/short_only_config.ts`** — konfiguracja (interface + defaults + overrides + getter). Ten sam wzorzec co BounceFilter, DipFilter, FundingFilter, FibGuard — juz go znasz. Chcesz zmienic prog dla kPEPE? Edytujesz jedna linijke w overrides.

**`src/mm_hl.ts`** — logika:
1. **pumpShieldHistory** — mapa cen per pair (last 10 ticks)
2. **detectPump()** — funkcja detekcji (window + single-tick)
3. **Grid filter** — przed BounceFilter, redukuje bidy
4. **Nuclear level** — po PROFIT_FLOOR, usuwa bidy z grida + cancel na gieldzie

### Lekcje

**1. Naśladuj najlepszych, nie wymyslaj od nowa.** 58bro.eth ma $31.4M w pozycjach i zarabia na pumpach zamiast tracic. Zamiast wymyslac teorie, po prostu skopiowalismy jego zachowanie: blokuj kupno, zwieksz sprzedaz. Inzynieria to nie innowacja za wszelka cene — to implementacja sprawdzonych rozwiazan.

**2. Config-driven > hardcoded.** Interface → defaults → per-token overrides → getter. Ten pattern pozwala zmienic zachowanie bez dotykania logiki. Chcesz dodac nowy token? Jedna linijka. Chcesz wylaczyc shield? `enabled: false`. Zero ryzyka regresji.

**3. Additive filters > destructive overrides.** `bid *= 0.50` jest bezpieczniejsze niz `bid = 0.50`. Pierwsze wspolpracuje z innymi filtrami, drugie je nadpisuje. W systemie z 6+ filtrami w pipeline, mnozenie gwarantuje ze zaden filtr nie "zje" zmian innego.

**4. Cooldown zapobiega whipsaw.** Pumpy czesto maja druga fale. Gdybys natychmiast przywrocil 100% bidow, moglbys oberwac dead cat bounce. 3 ticki (3 minuty) z 50% bidami to bufor bezpieczenstwa.

**5. Nuclear level to ostatnia linia obrony.** Dwa poziomy ochrony: (a) modyfikacja multiplikatorow w pipeline, (b) fizyczne usuwanie orderow z grida i giedly. Gdyby (a) nie zadzialalo z jakiegos powodu (bug, race condition), (b) i tak ochroni pozycje. **Defense in depth** — nie polegaj na jednym mechanizmie.

**6. Defensive error handling.** `try/catch` wokol cancel orderow na gieldzie — cancel moze failnac (order juz wypelniony, API timeout). To NIE jest powod zeby crashowac caly tick. Nastepny tick za 60 sekund sprobieje ponownie. **Fail gracefully, retry next tick.**

**7. Weryfikacja przez porownanie.** Najlepszy sposob zeby sprawdzic czy shield dziala: odtworz scenariusze z przeszlosci (MON -$2,130, LIT -$570) i policz co by sie stalo z shieldem. Jesli odpowiedz to "zero straty" — dziala. Nie potrzebujesz 100 testow — potrzebujesz 2 realne przypadki ktore mowia "to by zadziałało".

---

## Regime Bypass — kiedy reguly sie gryzą (25.02.2026)

### Problem: bot kPEPE traci na "churning"

Wyobraz sobie ze masz kelnerowi dwa polecenia:
1. "Nie podawaj zupy — jest za goraca" (block longs — RSI overbought)
2. "Nie podawaj salatki — jest za zimna" (block shorts — bull trend)

Kelner stoi z pustymi rekami i nie podaje nic. A klienci (rynek) czekaja.

Dokladnie to sie dzialo z kPEPE. Bot w PURE_MM mode (market maker — zarabia na spreadzie, nie na kierunku) dostal od regime filtra dwa sprzeczne zakazy:
- **Rule #1**: 4h bear + RSI 74 → "nie kupuj, overbought" → `allowLongs = false`
- **Rule #3**: 15m bull → "nie shortuj, bull trend" → `allowShorts = false`
- **Wynik**: oba kierunki zablokowane. Deadlock.

Na szczescie byl SIGNAL_ENGINE_OVERRIDE ktory mowil "olej regime, wlacz oba kierunki". Wiec bot i tak tradowal. Ale logika byla absurdalna:

```
Regime: "NIE HANDLUJ!"
Override: "HANDLUJ!"
Regime: "NIE HANDLUJ!"
Override: "HANDLUJ!"
... co 60 sekund, w nieskonczonosc
```

### Dlaczego regime blokowal oba kierunki naraz?

Bug byl w linii `isBullishTrend`:

```typescript
// PRZED (bug)
const isBullishTrend = analysis.trend4h === 'bull'
  || (analysis.trend15m === 'bull' && analysis.rsi15m < 80);
```

Dla kPEPE: 4h = **bear**, 15m = **bull**, RSI = 74

Logika mowila: "15m jest bull i RSI < 80, wiec mamy bullish trend!" Ale to **absurd** — 4h anchor jest BEAR. 15m bull w 4h bear to **dead cat bounce** (krotki odbicie w dlugoterminowym spadku), nie prawdziwy bullish trend. Nie powinnismy blokowac shortow na podstawie 30-minutowego odbicia gdy caly dzien spada.

To jak stwierdzenie "pogoda jest ladna" bo slonce wyszlo na 5 minut podczas huraganu.

### Fix #1: isBullishTrend — respektuj 4h anchor

```typescript
// PO (fix)
const isBullishTrend = analysis.trend4h === 'bull'
  || (analysis.trend4h !== 'bear' && analysis.trend15m === 'bull' && analysis.rsi15m < 80);
```

Dodanie `analysis.trend4h !== 'bear'` oznacza:
- 4h = bull → `isBullishTrend = true` (prawidlowo)
- 4h = neutral + 15m = bull → `isBullishTrend = true` (OK, moze sie rozwija)
- 4h = **bear** + 15m = bull → `isBullishTrend = false` (dead cat bounce, nie blokuj shortow!)

Ten fix dotyczy WSZYSTKICH par, nie tylko kPEPE. Kazda para ktora miala 4h bear z 15m bounce dostawala falszywy "bull_trend_no_shorting_pump".

### Fix #2: PURE_MM pomija regime calkowicie

Market maker zarabia na **spreadzie** — roznica miedzy cena kupna i sprzedazy. Musi quotowac OBA kierunki. Regime mowi "nie kupuj" albo "nie shortuj" — to logika dla kierunkowych traderow (SM_FOLLOWER), nie dla MM.

Analogia: regime to sygnalizacja swietlna na skrzyzowaniu. SM_FOLLOWER to samochod ktory jedzie prosto — musi respektowac swiatla. PURE_MM to policjant kierujacy ruchem — sygnalizacja go nie dotyczy, on sam jest regula.

```typescript
// Nowy kod (mm_hl.ts)
const signalEngineResultRegime = getSignalEngineForPair(pair);
const isPureMmRegimeBypass = signalEngineResultRegime?.signalEngineOverride
  && signalEngineResultRegime?.mode === MmMode.PURE_MM;

const permissions = isPureMmRegimeBypass
  ? { allowLongs: true, allowShorts: true, reason: 'PURE_MM_REGIME_BYPASS' }
  : this.marketVision!.getTradePermissions(pair);
```

Zamiast: "regime blokuje → override wymusza → regime znowu blokuje → override znowu wymusza"
Teraz: "PURE_MM? Pominiesmy regime. Oba kierunki otwarte. Koniec."

### Wazne: co to jest "regime"?

Regime to system regul ktore analizuja stan rynku i decyduja czy bezpieczne jest otwieranie pozycji w danym kierunku. Ma 8 regul:

| # | Regula | Co blokuje | Kiedy |
|---|--------|-----------|-------|
| 1 | Falling Knife | Longs | 4h bear (nie lap spadajacego noza) |
| 2 | FOMO Protection | Longs | RSI > 75 (nie kupuj szczytu) |
| 3 | Train Wreck | Shorts | Bull trend (nie stawaj przed pociagiem) |
| 4 | Bottom Selling | Shorts | RSI < 30 (nie sprzedawaj dna) |
| 5 | Global Risk Off | Longs | BTC crash + volatile |
| 6 | Wall Protection | Longs/Shorts | Blisko support/resistance |
| 7 | Price Action | Longs/Shorts | Pinbar rejection |
| 8 | Flash Crash | Oba | Nagle zalamania |

Kazda regula jest sensowna dla **kierunkowego** tradingu. Ale market maker to inna gra — on zarabia na spreadzie niezaleznie od kierunku. Dlatego PURE_MM pomija caly system.

### Architektura po fixie

```
┌──────────────────────────────────────┐
│  getTradePermissions()               │
│  (8 regul regime)                    │
│                                      │
│  Dotyczy: SM_FOLLOWER, FOLLOW_SM_*   │
│  Pomija:  PURE_MM                    │
└──────────────────────────────────────┘
           │                    │
     SM_FOLLOWER           PURE_MM
           │                    │
           ▼                    ▼
  ┌─────────────────┐   ┌────────────────────┐
  │ REGIME filters   │   │ REGIME BYPASSED    │
  │ allowLongs: T/F  │   │ allowLongs: true   │
  │ allowShorts: T/F │   │ allowShorts: true  │
  └─────────────────┘   └────────────────────┘
           │                    │
           ▼                    ▼
  ┌─────────────────┐   ┌────────────────────┐
  │ SignalEngine     │   │ Both sides quoting │
  │ may override     │   │ Spread = profit    │
  └─────────────────┘   └────────────────────┘
```

### Lekcje

**1. Reguly zaprojektowane dla X nie dzialaja dla Y.** Regime zostal napisany dla SM_FOLLOWER (idz za wielorybami, shortuj gdy shortuja). Zostal zaaplikowany do PURE_MM (market making) bez modyfikacji. Rezultat: sprzeczne zakazy. **Zawsze pytaj: "czy ta regula ma sens w nowym kontekscie?"**

**2. Sprzeczne reguly = deadlock.** Gdy system ma dwa niezalezne zbiory regul, moga one dac sprzeczne wyniki. "Nie kupuj" + "nie sprzedawaj" = nie rob nic. W tradingu "nie rob nic" to tez decyzja — i czesto zla. Dodanie `SIGNAL_ENGINE_OVERRIDE` zamaskowalo problem ale go nie naprawilo. **Fix root cause, nie symptomy.**

**3. Hierarchia timeframow: 4h > 15m.** 4h to "anchor" — glowny trend. 15m to "taktyczny szum". Gdy 4h mowi bear a 15m mowi bull, 4h wygrywa. To jak prognoza pogody: jesli prognoza tygodniowa mowi "deszcz caly tydzien" ale przez 15 minut swieci slonce, nie pakujesz parasola do plecaka.

**4. Override chain to code smell.** Jesli twoj kod ma pattern "X blokuje → Y override → Z blokuje → W override", to znaczy ze architektura jest zla. Kazdy override dodaje kompleksja i potencjal na bugi. Zamiast tego, **warstwy powinny wiedziec o sobie nawzajem** — regime powinien wiedziec ze jest w PURE_MM mode i od razu zwracac "oba dozwolone".

**5. Logi powinny mowic prawde.** Stare logi: `REGIME: Longs:false Shorts:false` + `OVERRIDE: FORCE BOTH SIDES`. Nowe logi: `REGIME: PURE_MM_REGIME_BYPASS (Longs: true, Shorts: true)`. Stare logi sugerowaly problem ktory nie istnial (override dzialal). Nowe logi jasno mowia co sie dzieje. **Czyste logi = szybsza diagnostyka.**

---

## Adverse Selection — dlaczego ciasny spread zabija market makera (25.02.2026)

### Problem: shorty zamykaja sie na minus mimo poprawnego regime

Po naprawie regime (#43) bot handlowal poprawnie — oba kierunki otwarte, zero deadlockow. Ale trade history nadal pokazywal straty:

```
21:00:15  Open Short  @ 0.004366  (ask fill)
21:00:17  Open Short  @ 0.004363  (ask fill)
21:01:07  Open Short  @ 0.004367  (ask fill)
  ... cena rosnie ...
21:02:33  Close Short @ 0.004372  → -$0.36  (bid fill — WYZEJ niz otwarcie!)
21:02:33  Close Short @ 0.004371  → -$0.34
21:02:33  Close Short @ 0.004371  → -$0.17
```

Bot otwieral shorty (sprzedawal) po 0.004363-0.004367, cena poszla w gore, a potem bot KUPOWAL (zamykal shorty) po 0.004371-0.004372 — drozej niz sprzedal. Strata.

### Co to jest "adverse selection"?

Adverse selection to problem KAZDEGO market makera na swiecie. Zdarza sie gdy ktos kto wie wiecej niz ty handluje z toba.

Wyobraz sobie ze sprzedajesz lody na ulicy za 5zl/sztuke i kupujesz za 4zl (1zl spread). Nagle przybiega ktos i kupuje WSZYSTKIE twoje lody. Zanim zdazysz zamowic nowe, okazuje sie ze hurtownia podniosla cene do 6zl. Teraz musisz kupic lody po 6zl zeby napelnic lodowke — a sprzedales po 5zl. Strata 1zl na sztuce.

Ten "ktos" to informed trader — wiedzial ze cena wzrosnie i kupil od ciebie taniej. Ty, market maker, dales mu dobra cene bo nie wiedziales.

### Jak to wygladalo w kPEPE?

Bot mial **4-warstwowy grid** — 8 orderow kupna (bid) i 8 orderow sprzedazy (ask) rozlozonych wokol ceny srodkowej (mid):

```
PRZED FIX:
         L4 SELL: +55bps (sweep)
         L3 SELL: +28bps (buffer)
         L2 SELL: +14bps (core)
         L1 SELL: +5bps  (scalping)  ← TYLKO 0.05% od mid!
  ──────── MID PRICE ────────
         L1 BUY:  -5bps  (scalping)  ← TYLKO 0.05% od mid!
         L2 BUY:  -14bps (core)
         L3 BUY:  -28bps (buffer)
         L4 BUY:  -55bps (sweep)
```

L1 na 5bps to jak sprzedawanie lodow za 5.025zl i kupowanie za 4.975zl — spread 0.05zl. Kazdy ruch ceny >0.05zl sprawia ze tracisz na round-tripie.

### Dlaczego grid re-centering pogarszal sprawe

Bot odswieza grid co **60 sekund** (1 tick mainLoop). Za kazdym razem przesuwa caly grid tak zeby byl wycentrowany wokol aktualnej ceny srodkowej.

Problem: kPEPE rusza sie **20-30bps na minute**. Scenariusz:

```
Tick 1 (21:00):
  mid = 0.004360
  L1 ask = 0.004363  (+5bps)  ← bot sprzedaje tu (open short)
  L1 bid = 0.004357  (-5bps)

Tick 2 (21:01):
  cena poszla w gore do 0.004375 (+15bps w 60s)
  NOWY mid = 0.004375
  NOWY L1 bid = 0.004372  (-5bps od NOWEGO mid)

  → L1 bid 0.004372 > stary L1 ask 0.004363
  → jesli ten bid sie filluje, zamyka shorta ze STRATA!
```

To jest "grid crossing" — nowe bidy sa wyzej niz stare aski. Bot sprzedal po 0.004363 i teraz kupuje po 0.004372. Round-trip: **-9 ticks = -$0.21**.

### Fix: poszerz grid 3.6x

```
PO FIX:
         L4 SELL: +65bps (sweep)
         L3 SELL: +45bps (wide)
         L2 SELL: +30bps (buffer)
         L1 SELL: +18bps (core)   ← 3.6x szerzej!
  ──────── MID PRICE ────────
         L1 BUY:  -18bps (core)   ← 3.6x szerzej!
         L2 BUY:  -30bps (buffer)
         L3 BUY:  -45bps (wide)
         L4 BUY:  -65bps (sweep)
```

Teraz L1 round-trip: **36bps** (18 + 18). Cena musi ruszyc sie >36bps w 60 sekund zeby grid crossing nastapil. Przy typowym ruchu 20-30bps/min, wiekszosc tickow bedzie bezpieczna.

### Dlaczego nie powiekszylismy spreadu wczesniej?

Bo **ciasny spread = wiecej fillow = wiecej volumenu**. Market makerzy chca jak najciasniejszy spread zeby przyciagac flow. Ale jest granica — jesli spread jest wezszy niz typowa zmiennosc, tracisz wiecej na adverse selection niz zarabiasz na spreadzie.

To klasyczny trade-off market makingu:

```
CIASNY SPREAD (5bps)         SZEROKI SPREAD (18bps)
├── Wiecej fillow             ├── Mniej fillow
├── Mniejszy zysk/fill        ├── Wiekszy zysk/fill
├── Duzo adverse selection    ├── Malo adverse selection
└── STRATA netto              └── ZYSK netto (mniej, ale realny)
```

Sztuka polega na znalezieniu "sweet spot" — spreadu ktory jest dosc ciasny zeby przyciagac flow, ale dosc szeroki zeby przezyc zmiennosc. Dla kPEPE z 20-30bps/min volatility, 18bps to rozsadne minimum.

### Dwie warstwy configu (wazne!)

Znalezlismy ze kPEPE spread jest kontrolowany w **dwoch miejscach**:

| Plik | Co kontroluje | Zmiana |
|------|--------------|--------|
| `mm_hl.ts` → `KPEPE_GRID_LAYERS` | Offsety per warstwa (L1-L4) | L1: 5→18bps |
| `market_vision.ts` → `NANSEN_TOKENS` | Base spread dla standardowego grida | 14→25bps |

Pierwszy jest **wazniejszy** — to rzeczywiste ceny orderow. Drugi jest uzywany jako fallback i w logach. Przy pierwszym deployu zmienilismy tylko NANSEN_TOKENS (14→25bps) ale ordery nadal lezaly na 5bps bo custom grid uzywa KPEPE_GRID_LAYERS.

**Lekcja: zawsze sprawdz ktory config jest faktycznie uzywany.** Zmiana configu ktory nie jest czytany to "fix" ktory nic nie zmienia. Logi (`SPREAD: 25bps`) sugerowaly ze zmiana zadziala, ale ordery (`DEBUG submit: price=...`) mowily prawde.

### Trade-offy szersszego spreadu

| Aspekt | Skutek |
|--------|--------|
| **Mniej fillow** | Mniej transakcji/godzine (ordery dalej od mid) |
| **Wiekszy zysk/fill** | Kazdy round-trip daje ~36bps vs ~10bps |
| **Mniejszy PnL w spokojnym rynku** | W sideways market, ciasny spread daje wiecej drobnych zyskow |
| **Mniejsze straty w volatilnym rynku** | Grid crossing prawie niemozliwy |
| **Netto** | Powinien byc lepszy — kPEPE jest zbyt volatilny na 5bps |

### Lekcje

**1. Spread musi byc szerzszy niz typowa zmiennosc za 1 tick.** Jesli twoj mainLoop trwa 60s a cena rusza sie 20-30bps/min, to L1 na 5bps to samobojstwo. Regula kciuka: L1 >= zmiennosc/tick * 0.7. Dla kPEPE: 25bps * 0.7 = 17.5bps ≈ 18bps.

**2. Logi moga klamac.** `SPREAD: 14bps` w logach brzmial prawidlowo. Ale to byl config z NANSEN_TOKENS — a kPEPE uzywal KPEPE_GRID_LAYERS z L1=5bps. Zawsze weryfikuj logi z rzeczywistoscia: sprawdz `DEBUG submit: price=...` i policz odleglosc od mid.

**3. Adverse selection to enemy #1 market makera.** Nie ryzyko kierunkowe, nie fees, nie volatility — to informed traders ktory wiedza wiecej. Jedyna obrona: szerzszy spread + szybsze re-quoting. My nie mozemy requotowac szybciej (60s tick), wiec musimy miec szerzszy spread.

**4. Config-driven gridy musza byc testowane empirycznie.** Nie mozesz ustawic spreadu "na oko". Musisz: (a) zmierzyc zmiennosc tokena, (b) porownac z tick interval, (c) ustawic spread >= zmiennosc/tick, (d) monitorowac PnL per fill. Jesli PnL/fill < 0, spread jest za ciasny.

**5. Dwa configi dla jednej rzeczy = bug czekajacy na okazje.** NANSEN_TOKENS mowil 14bps, KPEPE_GRID_LAYERS mowil 5bps. Ktory wygrywal? Ten ktory byl czytany przez `generateGridOrdersCustom`. Drugi byl martwy config — zmiana go nic nie dawala. **Jedno zrodlo prawdy (single source of truth) > dwa configi ktore sie nie zgadzaja.**

---

## Momentum Guard — nie kupuj szczytow, nie shortuj den

### Problem: symetryczny grid w asymetrycznym swiecie

Wyobraz sobie, ze jestes sprzedawca hot-dogow na stadionie. Masz dwa okienka — jedno sprzedaje (ask), drugie skupuje (bid). Normalnie oba otwarte na pelna pare. Ale co jesli widzisz, ze tlum biegnie do wyjscia (panika, dump)? Kazdy rozsadny sprzedawca zamknalby okienko skupu — nie chcesz kupowac hot-dogow od panikujacych ludzi po zawyzonej cenie. A okienko sprzedazy? Zostawiasz otwarte — bo ci co zostali, zaplaca wiecej.

To dokladnie to co robi Momentum Guard. Zamiast twardo zamykac okienko (jak HARD_BLOCK), **plynnie reguluje jego szerokosc** w zaleznosci od kierunku i sily ruchu cenowego.

### Jak to dziala — 3 sygnaly

Momentum Guard oblicza score od -1.0 do +1.0 z trzech zrodel:

```
momentumScore = momentum_1h × 0.50 + RSI × 0.30 + proximity_S/R × 0.20
```

**Sygnal 1: Momentum 1h (50% wagi)** — "Jak szybko jedzie pociag?"
Zmiana ceny w ostatniej godzinie, znormalizowana do [-1, +1]. Jesli kPEPE uroslo o 3% w godzine → score=+1.0 (max pump). Jesli spadlo o 2.1% → score=-1.0 (max dump, bo dumpy maja nizszy prog — krypto spada szybciej niz rosnie).

**Sygnal 2: RSI (30% wagi)** — "Czy silnik sie przegrzal?"
RSI powyzej 65 = overbought (pozytywny sygnal). RSI ponizej 35 = oversold (negatywny). RSI jest jak termometr — nawet jesli momentum nadal rośnie, RSI moze powiedziec "uwaga, za goraco".

**Sygnal 3: Proximity do S/R (20% wagi)** — "Jak blisko sciany?"
Odleglosc ceny od 4h resistance (opor) i support (wsparcie). Blisko oporu = pozytywny (nie kupuj pod sufitem). Blisko wsparcia = negatywny (nie shortuj nad podloga). Uzywa ATR-based zones — procentowa odleglosc nie jest statyczna, adaptuje sie do zmiennosci.

### Ewolucja: v1 → v2 (7 fixow w jednej sesji)

v1 dzialala, ale miala corner cases ktore mogly kosztowac pieniadze. Oto co naprawilismy i dlaczego:

**1. Wick Trap (S/R z body zamiast wicks)**

S/R bylo obliczane z `Math.max(H)` / `Math.min(L)` — czyli z wickow. Problem: flash crash o 3 AM spuszczal wick na $0.003, a normalne dno body bylo $0.0038. Bot myslal ze support jest na $0.003 — 20% nizej niz prawdziwe dno. Proximity nigdy nie triggerowala bo "daleko od supportu". Fix: uzywamy `Math.max(O,C)` / `Math.min(O,C)` — ciala swiec, bez szumu z wickow.

**Lekcja: Wicki to szum. Ciala swiec to prawda. Kazdy trader wie, ze close > wick, ale zaprogramowanie tego nie jest oczywiste.**

**2. Breakout Math (ujemna odleglosc = max sygnal)**

Gdy cena przebila opor, `(resistance - price) / price` dawalo liczbe ujemna (np. -0.02). Stary kod mial `if distance < 0.01 → strong signal`. -0.02 < 0.01? TAK! Wiec *przypadkowo* dzialalo poprawnie. Ale "dziala przez przypadek" to nie jest inzynieria — to bomba zegarowa. Fix: explicit `if distance <= 0 → signal = 1.0` (max, bo jestesmy POWYZEJ oporu).

**Lekcja: Kod ktory "dziala" ale nie z wlasciwego powodu to bug czekajacy na okazje. Explicit > implicit, zawsze.**

**3. ATR-based thresholds (dynamiczne progi)**

Static 1%/2% nie dzialaly. Dla kPEPE (30bps/min volatility) 1% to bylo za daleko — proximity nigdy nie triggerowala. Dla BTC 1% to za blisko — triggerowala non-stop. Fix: progi oparte na ATR (Average True Range). Wysoka zmiennosc = szersza zona. Niska zmiennosc = ciasna.

**Lekcja: Statyczne progi w dynamicznym swiecie to antywzorzec. Uzyj ATR, std dev, albo percentyli — cokolwiek co samo sie skaluje.**

**4. Position-aware guard (nie blokuj Take Profitu!)**

To byl najwazniejszy fix. Scenariusz: bot ma SHORT -20% skew. Cena pompuje. Momentum Guard mowi "redukuj bidy!" (nie kupuj szczytu). Ale te bidy **zamykaja shorta** — to jest TP, nie otwarcie nowego longa! Blokowanie ich = trzymanie przegrywajacej pozycji.

Fix: jesli `actualSkew < -0.10` (mamy SHORT) i `momentumScore > 0` (pump), bidy sa **chronione** — nie redukowane. Mirror: LONG + dump → aski chronione.

```
Pump + brak pozycji  → redukuj bidy (nie kupuj szczytu)     ✅
Pump + SHORT pozycja → CHROŃ bidy (to twój Take Profit!)    ✅
Dump + brak pozycji  → redukuj aski (nie shortuj dna)       ✅
Dump + LONG pozycja  → CHROŃ aski (to twój Take Profit!)    ✅
```

**Lekcja: Identyczne zlecenie (bid) moze miec kompletnie rozne intencje w zaleznosci od stanu portfela. Kazdy filtr ktory modyfikuje zlecenia MUSI byc swiadomy aktualnej pozycji.**

**5. ATR-based pumpThreshold (adaptacyjny prog momentum)**

Static 3% jako "max pump" nie sprawdzalo sie. W nocy kPEPE nie ruszalo sie o 3% (threshold nieosiagalny, guard martwy). W dzien potrafiło ruszyc o 5% w godzine (3% za wolno). Fix: `pumpThreshold = 1.5 × ATR%` (kPEPE: 2.0 × ATR%). Automatyczna adaptacja do rezimu zmiennosci.

**6. Dump asymmetry (krypto spada szybciej)**

Rynki krypto maja charakterystyke "schody w gore, winda w dol". Pump o 3% trwa godziny, dump o 3% trwa minuty. Identyczny prog dla obu = za wolna reakcja na dump. Fix: `dumpSensitivityMult = 0.7` — dump threshold = 70% pump threshold. Jesli pump threshold to 2.5%, dump threshold to 1.75%.

**Lekcja: Symetria w kodzie nie znaczy symetria na rynku. Flash crashe i flash pumpy sa fundamentalnie rozne — panic selling jest szybszy niz FOMO buying.**

**7. Micro-reversal detection (obejscie lagu 1h)**

Problem: 1h momentum laguje. Cena uderza w opor, odbija o 2%, ale 1h momentum nadal mowi "+3%" bo patrzyl na caly ostatnia godzine. Fix: uzywamy `pumpShieldHistory` (ostatnie 10 tickow, ~15 min) do detekcji mikro-odwrocen. Jesli 1h mowi "pump" ale cena spadla >0.3% od recent peak → micro-reversal detected → odblokuj closing orders.

**Lekcja: Kazdy wskaznik laguje. Im dluzszy timeframe, tym wiekszy lag. Rozwiazanie: nie polegaj na jednym timeframe. Uzywaj krotszych danych do override dluzszych gdy sytuacja sie zmienia.**

### Dlaczego to "instytucjonalne"

Wiekszosci botow gridowych uzywa statycznych reguł: "spread 20bps, ordery po $100, obie strony". Momentum Guard to system adaptacyjny — reaguje na:

- **Trend** (1h momentum)
- **Extremes** (RSI overbought/oversold)
- **Strukture** (bliskosc do S/R z body-based, nie wick)
- **Zmiennosc** (ATR-based progi)
- **Pozycje** (chroni TP zamiast je blokowac)
- **Mikrostrukture** (micro-reversal z 15-min tick buffer)
- **Asymetrie rynku** (dump = szybszy prog)

To 7 wymiarow adaptacji zamiast 0. Roznica miedzy botem ktory przezywa memecoin volatility a botem ktory oddaje pieniadze rynkowi.
