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
26. [Dynamic TP + Inventory SL — pozwol zyskom rosnac, tnij straty](#dynamic-tp--inventory-sl--pozwol-zyskom-rosnac-tnij-straty)
27. [Auto-Skewing — przesun siatke tam gdzie bot potrzebuje fillow](#auto-skewing--przesun-siatke-tam-gdzie-bot-potrzebuje-fillow)
28. [Prediction System Overhaul — kiedy mózg bota mówił głupoty](#prediction-system-overhaul--kiedy-mozg-bota-mowil-glupoty)
29. [Momentum Guard v3 — nie zamykaj w popłochu, trzymaj na odbicie](#momentum-guard-v3--nie-zamykaj-w-poplochu-trzymaj-na-odbicie)
30. [Prediction Bias — bot zaczyna przewidywać przyszłość](#prediction-bias--bot-zaczyna-przewidywac-przyszlosc)
31. [XGBoost Backfiller — 180 dni historii w 5 minut](#xgboost-backfiller--180-dni-historii-w-5-minut)
32. [DRY_RUN Safety — instanceof guard pattern](#dry_run-safety--instanceof-guard-pattern)
33. [S/R Mean-Reversion Cycle — pelny cykl kupuj dol, sprzedaj gore](#sr-mean-reversion-cycle--pelny-cykl-kupuj-dol-sprzedaj-gore)
34. [Inventory-Aware MG Override — gdy bot utknal i nie moze sie ruszyc](#inventory-aware-mg-override--gdy-bot-utknal-i-nie-moze-sie-ruszyc)
35. [MIN_PROFIT Deadlock — gdy dwa systemy bezpieczenstwa sie nawzajem paralizuja](#min_profit-deadlock--gdy-dwa-systemy-bezpieczeństwa-się-nawzajem-paralizują)
36. [Fresh Touch Boost — silniejsza akumulacja na pierwszym dotknieciu S/R](#fresh-touch-boost--silniejsza-akumulacja-na-pierwszym-dotknieciu-sr)
37. [S/R Bounce Hold — nie sprzedawaj za wczesnie po odbiciu](#sr-bounce-hold--nie-sprzedawaj-za-wczesnie-po-odbiciu)
38. [S/R Pipeline — Zestawienie faz w zaleznosci od progresu](#sr-pipeline--zestawienie-faz-w-zaleznosci-od-progresu)
39. [VIRTUAL S/R Pipeline — Daj drugiemu botowi oczy](#virtual-sr-pipeline--daj-drugiemu-botowi-oczy)
40. [HLP Vault Tracking — Sledzenie Wieloryba Gieldy](#hlp-vault-tracking--sledzenie-wieloryba-gieldy)
41. [Oracle allMids Cache — Jeden telefon zamiast trzynastu](#oracle-allmids-cache--jeden-telefon-zamiast-trzynastu)
42. [Dex-Trades 422 — Niedokonczona robota](#dex-trades-422--niedokonczona-robota)

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

---

## Dynamic TP + Inventory SL — pozwol zyskom rosnac, tnij straty

> "Cut your losses short, let your profits run." — Jesse Livermore, 1923

To jest prawdopodobnie najstarsza i najbardziej powtarzana zasada tradingu w historii. Problem? **Ludzie (i boty) robia dokladnie odwrotnie** — zamykaja zyski za wczesnie (strach przed utrata zysku) i trzymaja straty za dlugo (nadzieja na odbicie). Nasz bot mial dokladnie ten sam problem.

### Analogia: restauracja z obrotowymi drzwiami

Wyobraz sobie restauracje. Kelner (bot) przynosi dania (ordery) na stoly (grid levels). Gdy klient (rynek) zblizy sie do wyjscia (micro-reversal), kelner natychmiast zabiera talerz (zamyka TP). Ale jesli klient chce jeszcze jeść (ruch trwa) — powinien poczekac!

**Dynamic TP** to jak kelner ktory mowi: "Widze ze Pan jeszcze je. Przyniosę rachunek pozniej" — przesuwa talerz dalej od klienta.

A jesli klient zaczyna demolowac restauracje (pozycja mocno pod woda)? **Inventory SL** to alarm przeciwpozarowy — natychmiast evakuuj, blokuj wejscia, wszyscy na wyjscie.

### Problem 1: "Papierowe rece" na TP

Momentum Guard v2 dodal **micro-reversal detection** — wykrywa gdy pump/dump zaczyna sie odwracac. Ale co potem? Bot wykrywal odwrocenie i... zachowywal normalny grid. TP zamykal sie na pierwszym poziomie (L1 = 18bps od mid). W memecoinie ktory potrafi spasc o 2% w 10 minut, zamkniecie na 0.18% to jak uciekanie z kasyna po wygraniu $5 na automacie — technicznie zysk, ale zostawiasz fortune na stole.

**Scenariusz:**
```
Tick 1: kPEPE SHORT -20% skew, cena pompuje +3%
Tick 2: Pump stalls — cena spada 0.5% od peak → MICRO-REVERSAL detected!
Tick 3: Normalny grid → L1 bid na 18bps od mid → fill natychmiast
Tick 4: Cena spada jeszcze 1.5% → ale juz zamknelismy...

STRACONY ZYSK: ~1.5% na pozycji ktora mogla brac wiecej
```

### Rozwiazanie: Dynamic TP (Spread Widener)

Gdy micro-reversal wykryty i pozycja na **winning side**:
- Rozszerz closing-side spread o `tpSpreadMult` (domyslnie ×1.5)
- Normalny L1 bid = 18bps → po Dynamic TP = 27bps od mid
- Pozycja ma 50% wiecej miejsca zeby "oddychac" zanim TP sie zamknie

```
SHORT + pump stalling → bid spread ×1.5 → TP dalej → lapie wiecej spadku
LONG + dump stalling  → ask spread ×1.5 → TP dalej → lapie wiecej wzrostu
```

**Klucz: warunek "winning side"**. Dynamic TP TYLKO gdy pozycja jest na DOBREJ stronie odwrocenia:
- SHORT i cena spada od peak? → Swietnie, daj jej spasc dalej
- LONG i cena rośnie od trough? → Swietnie, daj jej rosnac dalej
- SHORT i cena rośnie? → To NIE jest TP — to SL! Dynamic TP nie triggeruje

### Problem 2: Brak "hamulca recznego"

Przed Inventory SL bot mial Momentum Guard (redukuje ordery w trendzie) i Pump Shield (blokuje bidy przy pompie). Ale zadne z nich nie adresowal sytuacji: **duza pozycja + duzy ruch przeciwko + brak poprawy**.

```
Tick 1:  SHORT -45% skew, entry 0.004500
Tick 5:  cena 0.004700 (+4.4% nad entry)
Tick 10: cena 0.004750 (+5.6% nad entry)
Tick 20: cena nadal rosnie — MG redukuje aski ale NIE zamyka pozycji
Tick 50: cena 0.005000 (+11.1% nad entry) — bot nadal ma SHORT
```

Bot kontynuowal market-making (moze z mniejszymi askam) ale **nigdy aktywnie nie zamykal** przegrywajacej pozycji. Jak kierowca ktory widzi mur przed soba ale zamiast hamowac, po prostu zwalnia.

### Rozwiazanie: Inventory SL (Panic Mode)

Dwa warunki musza byc spelnione JEDNOCZESNIE:

1. **|skew| > 40%** — duza pozycja (nie malutki imbalance)
2. **Drawdown od entry > 2.5 × ATR%** — cena ruszyla sie znaczaco PRZECIWKO nam

Gdy oba = **PANIC MODE**:
- **Blokuj losing side** (asks=0 dla SHORT) → stop powieksza straty
- **Agresywne closing** (bids×2.0) → szybkie wyjscie

```
PANIC SHORT:  asks = 0 (nie shortuj wiecej!)  +  bids × 2.0 (zamykaj szybko!)
PANIC LONG:   bids = 0 (nie kupuj wiecej!)    +  asks × 2.0 (zamykaj szybko!)
```

### Dlaczego ATR a nie procenty?

Proste pytanie: "4% drawdown to duzo czy malo?"

- Dla BTC: **DUZO** — BTC rzadko rusza sie o 4% w godzine
- Dla kPEPE: **NORMALNE** — memecoin potrafi ruszyc o 4% w 10 minut

Odpowiedz zalezy od **zmiennosci instrumentu**. ATR (Average True Range) mierzy typowy ruch cenowy. `2.5 × ATR%` znaczy "2.5 razy wiecej niz typowy ruch". To adaptuje sie automatycznie:

| Rezim | ATR% | SL threshold (2.5×) | Interpretacja |
|-------|------|---------------------|---------------|
| Spokojna noc | 0.8% | 2.0% | Maly ruch juz jest alarmujacy |
| Normalny dzien | 1.5% | 3.75% | Standardowy prog |
| Szalony US open | 2.5% | 6.25% | Wiekszy margines — vol jest normalna |

**Lekcja: ATR-based thresholds sa jak termostat — same sie dostosowuja do pogody. Static thresholds sa jak wlacznik on/off — albo za zimno albo za goraco.**

### Bezpiecznik: `drawdownPct > 0`

Subtelny ale krytyczny guard. Inventory SL TYLKO gdy pozycja jest **underwater** (drawdown pozytywny = cena przeciwko nam). Jesli mamy SHORT -50% skew ale jestesmy $200 w zysku — **nie triggeruj panic**. To jest diamond hands, nie problem.

```
skew=-50%, drawdown=-3% (w zysku) → NIE PANIKUJ (pozycja zdrowa)
skew=-50%, drawdown=+4% (strata)  → sprawdz vs 2.5×ATR → moze PANIC
```

Bez tego guardu, kazda duza pozycja (nawet zdrowa, w zysku) trigerowala by panic zamykanie. To by zniszczylo calego Momentum Guarda i position-aware protection.

### Pelny pipeline kPEPE (po zmianach)

```
1. Toxicity Engine      → wykrywa toksyczny flow, dostosowuje spread/size
2. TimeZone Profile     → 10-zone time-of-day adjustment
3. Momentum Guard       → 3-signal score → asymetryczne bid/ask multipliers
4. Position-Aware Guard → chroni closing orders (nie blokuj TP!)
5. Micro-Reversal       → wykrywa odwrocenia mimo lagging 1h
6. 🎯 DYNAMIC TP       → rozszerza closing spread gdy reversal + winning ← NOWE
7. 🚨 INVENTORY SL     → panic close gdy duza strata + wysoki skew     ← NOWE
8. Grid Generation      → generateGridOrdersCustom z finalnym spread/size
9. Layer Removal        → toxicity-driven + skew-based layer pruning
10. Hedge Trigger       → IOC gdy skew >50% przez 30min
```

To jest 10 warstw inteligencji na jednym instrumencie. Kazda warstwa patrzy na cos innego: flow toksycznosc, pora dnia, momentum rynku, pozycje bota, mikro-odwrocenia, potencjal zysku, ryzyko straty, strukture grida, brak rownowagi, ekstremalny skew.

### Lekcje inzynierskie

**1. Dual-threshold gating (AND nie OR)**

Inventory SL wymaga DWOCH warunkow: skew > 40% **AND** drawdown > 2.5×ATR. Kazdy z osobna to normalny stan — bot czesto ma 40% skew (normalna pozycja), czesto widzi 2.5×ATR ruchy (normalna zmiennosc). Dopiero KOMBINACJA obu jest niebezpieczna. To jak alarm pozarowy ktory wymaga DYMU i TEMPERATURY — sam dym (ktos pali papierosa) nie wlacza tryskawki.

**Lekcja: Mechanizmy awaryjne powinny wymagac wielu niezaleznych potwierdzen. Im bardziej destrukcyjna akcja, tym wiecej warunkow powinno byc spelnione.**

**2. Spread vs Size — dwa rozne narzedzia**

Dynamic TP modyfikuje **spread** (jak daleko od mid sa ordery), Inventory SL modyfikuje **size** (ile sztuk). To nie przypadek — sa to ortogonalne narzedzia:

- Spread = "GDZIE chcesz wypelnienie?" → kontrola ceny
- Size = "ILE chcesz sprzedac/kupic?" → kontrola ekspozycji

Dynamic TP nie zwieksza pozycji (bez zmiany size) — tylko przesuwa cel cenowy. Inventory SL nie zmienia spreadu — tylko zmienia ILOSC. Kazde narzedzie robi jedna rzecz dobrze.

**Lekcja: Single Responsibility Principle dziala tez w tradingu. Nie probuj jednym mechanizmem kontrolowac dwoch roznych aspektow.**

**3. Override hierarchy**

Inventory SL jest OSTATNI w pipeline i ustawia `sizeMultipliers.ask = 0` (hard zero). To nadpisuje WSZYSTKIE wczesniejsze multipliery — Toxicity Engine, TimeZone, Momentum Guard. Celowo. Gdy dom sie pali, nie patrzysz jaka jest pora dnia ani jaki jest momentum na RSI.

**Lekcja: Mechanizmy bezpieczenstwa powinny moc nadpisac wszystko ponizej. Ale powinny byc na samym koncu pipeline — zeby mialy pelny obraz sytuacji zanim podejma decyzje.**

---

## Auto-Skewing — przesun siatke tam gdzie bot potrzebuje fillow

> "Jesli masz za duzo towaru na polce, przesuniecie calego regalu blizej kasy sprawi ze ludzie latwiej go kupią."

### Problem: symetryczna siatka ignoruje inwentarz

Wyobraz sobie targowisko. Masz stragan z jablkami i gruszkami. Sprzedajesz po rowno obie strony — jablka po lewej, gruszki po prawej. Ale dzis z jakiegos powodu nazbierales OGROMNA gore gruszek (moze dostawca pomylil zamowienie). Co robisz?

Normalny sprzedawca: **przesuwa stragan** tak, zeby strona z gruszkami byla blizej przejscia, gdzie jest najwiecej klientow. Nie zmienia cen (spread), nie zmienia ilosci (size) — zmienia **POZYCJE straganu** w przestrzeni.

Dokladnie to robi Auto-Skewing z nasza siatka orderow.

### Co robilismy dotychczas?

Przed Auto-Skew mielismy dwa sposoby radzenia sobie z nierownowaga pozycji:

| Narzedzie | Co robi | Analogia |
|-----------|---------|----------|
| `getInventoryAdjustment()` | Przesuwa offsety poszczegolnych warstw ±10bps | Przesuwasz pojedyncze produkty na polce |
| Enhanced Skew (size-based) | Zmienia ILOSC orderow na kazdej stronie | Kladesz WIECEJ gruszek na wystawe |
| **Auto-Skew (mid-price shift)** | Przesuwa CALĄ siatke (midPrice) | **Przesuwasz CALY stragan** ← NOWE |

Te trzy mechanizmy sa **komplementarne** — dzialaja na roznych osiach:
- Offset = mikro-przesuniecia poszczegolnych warstw
- Size = ile towaru wystawiasz
- Mid-price = gdzie stoi caly stragan

### Jak to dziala?

Siatka orderow ma "srodek" — `midPrice`. To jest cena rynkowa wokol ktorej bot rozmieszcza bidy i aski. Normalnie `midPrice = aktualna cena` i siatka jest wycentrowana.

Auto-Skew przesuwa ten srodek na podstawie inventory skew:

```
actualSkew = -30% (mamy za duzo SHORTow)
                    ↓
shiftBps = -((-0.30) × 10 × 2.0) = +6.0 bps
                    ↓
skewedMidPrice = midPrice × (1 + 6.0 / 10000)
                    ↓
midPrice przesunieta W GORE o 6 bps (0.06%)
```

**Dlaczego w gore?** Bo mamy za duzo shortow = musimy KUPOWAC (zamykac shorty). Bidy (kupno) sa PONIZEJ mid. Przesuwajac mid w gore, bidy tez ida w gore = blizej rynku = wiecej fillow = szybsze zamykanie.

```
PRZED (skew=-30%, symetryczna siatka):
                 mid
    bid L4  bid L3  bid L2  bid L1  |  ask L1  ask L2  ask L3  ask L4
    ----+------+------+------+------+------+------+------+----
                                    ^ aktualna cena

PO (skew=-30%, mid przesuniete +6bps):
                         mid (shifted UP)
    bid L4  bid L3  bid L2  bid L1  |  ask L1  ask L2  ask L3  ask L4
    ------+------+------+------+----+----+------+------+------+----
                                    ^ aktualna cena

Bidy = BLIZEJ rynku (latwiej kupic = zamknac shorta)
Aski = DALEJ od rynku (trudniej sprzedac = nie zwiekszaj shorta)
```

### Parametry

| Parametr | Wartosc | Co robi |
|----------|---------|---------|
| `autoSkewShiftBps` | 2.0 | 2 bps przesuniecia na kazde 10% skew |
| `autoSkewMaxShiftBps` | 15.0 | Maksymalne przesuniecie = 15 bps (0.15%) |

**Przyklady:**

| Skew | Shift | Kierunek | Efekt |
|------|-------|----------|-------|
| -10% (lekki SHORT) | +2 bps UP | Bidy blizej | Delikatne zamykanie |
| -30% (sredni SHORT) | +6 bps UP | Bidy blizej | Umiarkowane zamykanie |
| -50% (duzy SHORT) | +10 bps UP | Bidy blizej | Agresywne zamykanie |
| -80% (ekstremalny) | +15 bps UP | **CAPPED** | Max shift, bezpieczenstwo |
| +30% (sredni LONG) | -6 bps DOWN | Aski blizej | Zamykanie longow |

Cap na 15 bps jest kluczowy — bez niego przy 100% skew bot przesunalby srodek o 20 bps, co przy malym spreadzie (18 bps L1) mogloby spowodowac ze bidy i aski sie "mijaja" (crossed market).

### Dlaczego to dziala?

Klucz do zrozumienia: **zmiana midPrice nie zmienia spreadu**. Warstwy L1-L4 (18/30/45/65 bps) sa relatywne do srodka. Przesuwasz srodek = przesuwasz WSZYSTKIE warstwy jednoczesnie.

To jak ruszanie calym suwakiem na equaliserze — wszystkie czestotliwosci ida w gore/dol, ale proporcje miedzy nimi zostaja te same.

Efekt na fills:
- **Closing side** (bidy dla SHORT): wiecej fillow, bo ordery sa blizej rynku
- **Opening side** (aski dla SHORT): mniej fillow, bo ordery sa dalej od rynku

To jest **dokladnie** to czego chcemy: szybciej redukuj ryzyko, wolniej je zwiększaj.

### Pipeline (po zmianach)

```
 1. Toxicity Engine      → wykrywa toksyczny flow
 2. TimeZone Profile     → dostosowanie do pory dnia
 3. Momentum Guard       → 3-signal score → asymetryczne mults
 4. Position-Aware Guard → chroni closing orders
 5. Micro-Reversal       → wykrywa odwrocenia
 6. 🎯 Dynamic TP       → rozszerza closing spread przy reversal
 7. 🚨 Inventory SL     → panic close przy duzej stracie
 8. ⚖️ Auto-Skew        → przesuwa midPrice na podstawie skew      ← NOWE
 9. Grid Generation      → generateGridOrdersCustom z finalnym spread/size/mid
10. Layer Removal        → toxicity + skew pruning
11. Hedge Trigger        → IOC przy ekstremalnym skew
```

11 warstw inteligencji. Kazda modyfikuje inny aspekt siatki:
- Warstwy 1-2: **kontekst** (flow quality, time)
- Warstwy 3-5: **kierunek** (momentum, position, reversals)
- Warstwy 6-7: **ekstrema** (TP opportunity, SL emergency)
- Warstwa 8: **pozycja siatki** (mid-price shift)
- Warstwa 9: **generacja** (finale ordery)
- Warstwy 10-11: **czyszczenie** (pruning, emergency hedge)

### Lekcje inzynierskie

**1. Trzy ortogonalne osie kontroli**

Mamy teraz 3 niezalezne "pokretla" do zarzadzania inventory:

```
Os X: OFFSET    → getInventoryAdjustment() → ±10bps per layer
Os Y: SIZE      → Enhanced Skew            → bid×1.2 / ask×0.8
Os Z: POSITION  → Auto-Skew               → mid-price ±15bps
```

Kazda os kontroluje cos innego. Offset = mikrostruktura warstw. Size = agresywnosc. Position = centrum siatki. Mozesz je dowolnie kombinowac bez konfliktow — nie "walcza" ze soba.

**Lekcja: Projektuj mechanizmy kontroli na niezaleznych osiach. Dwa pokretla na tej samej osi to redundancja i potencjalny konflikt. Trzy pokretla na roznych osiach to precision control.**

**2. Safety cap jako twardy limit**

`autoSkewMaxShiftBps = 15.0` — to nie jest "sugestia", to twardy `Math.min/Math.max`. Bez niego, ekstremalny skew (100%) dal by 20 bps shift na L1 = 18 bps. 20 > 18 = bidy przekroczylyby aski = crossed market = gwarantowana strata na kazdym fillu.

```
maxShift = 15 bps   (nasz cap)
L1 spread = 18 bps  (najwezszy layer)
15 < 18             (zawsze bezpieczne ✅)
```

**Lekcja: Gdy mechanizm moze wygenerowac wartosci proporcjonalne do inputu, ZAWSZE dodaj twardy cap. Procentowe skalowanie bez capu to bomba zegarowa — pewnego dnia input bedzie wiekszy niz oczekiwales.**

**3. Placement w pipeline ma znaczenie**

Auto-Skew jest PO Inventory SL ale PRZED generateGridOrdersCustom. To nie przypadek:
- Gdyby byl PRZED Inventory SL → panic mode moglby zresetowac midPrice (nie ma sensu)
- Gdyby byl PO generateGridOrdersCustom → musialby modyfikowac juz wygenerowane ordery (hack)
- Jego aktualna pozycja: modyfikuje input (midPrice) tuz przed generacja → czyste, eleganckie

**Lekcja: W pipeline architekturze, kazdy krok powinien modyfikowac INPUTY nastepnego kroku, nie outputy poprzedniego. Modyfikowanie inputow = transformacja, modyfikowanie outputow = patch. Transformacja jest czysta, patch jest brudny.**

---

## Prediction System Overhaul — kiedy mozg bota mowil glupoty

> "Nie wystarczy miec mozg. Musisz sprawdzic czy nie ma w nim robaka." — debugging wisdom

### Kontekst: Audyt predykcji

Wyobraz sobie, ze masz asystenta, ktory codziennie mowi ci "BTC spadnie jutro o 0.3%". Ufasz mu, bo brzmi pewnie. Ale pewnego dnia siadasz i sprawdzasz **kazdą** jego predykcje z ostatnich tygodni. Wynik?

- Predykcja na 1 godzine: **35% trafnosci** (gorsze niz rzut moneta!)
- Predykcja na 12 godzin: **0% trafnosci** (zero, nil, nic)
- Predykcja na 4 godziny: **88% trafnosci** (jedyny swietlany punkt)

Twoj asystent nie jest glupi — jest **zle skalibrowany**. I co gorsza, system weryfikacji tez nie dzialal — zawsze mowil "0 sprawdzonych, 0 trafionych" bo miał zbyt ciasne okno czasowe.

To tak jakby nauczyciel nigdy nie sprawdzal klasowek, wiec nigdy nie wiedzial ze uczniowie nie umieją materialu.

### 5 problemow, ktore znalezlismy

#### Problem 1: Jeden zestaw wag dla wszystkich horyzontow

```
PRZED (flat weights):
  h1:   SM=40%  tech=20%  momentum=15%
  h4:   SM=40%  tech=20%  momentum=15%
  h12:  SM=40%  tech=20%  momentum=15%
  m1:   SM=40%  tech=20%  momentum=15%
         ^^ te same wagi wszedzie!
```

**Dlaczego to problem?** Smart Money (SM) signal — np. "wieloryby maja $11M SHORT na LIT" — to informacja **strategiczna**. Ona mowi ci co bedzie za tydzien czy miesiac. Ale za **godzine**? SM nie zmieniaja pozycji co godzine. Wrzucanie 40% wagi SM do predykcji godzinowej to jak pytanie admirala floty o pozycje piechoty — daje ci odpowiedz, ale to szum.

Z drugiej strony, techniczny RSI i momentum zmieniaja sie co godzine — to jest **taktyczny** sygnał idealny dla h1.

```
PO (per-horizon weights):
  h1:   SM=10%  tech=35%  momentum=30%   ← taktyka!
  h4:   SM=30%  tech=25%  momentum=20%   ← balans
  h12:  SM=40%  tech=20%  momentum=15%   ← strategia
  w1:   SM=55%  tech=10%  momentum=10%   ← strategia++
  m1:   SM=65%  tech=5%   momentum=5%    ← SM dominuje
```

**Analogia:** Sterowanie samolotu. Na male korekty kursu (h1) uzywasz lotek (szybki, maly efekt). Na duze skręty (m1) uzywasz steru kierunku (wolny, duzy efekt). Nie uzywasz steru kierunku do mikro-korekt — wyjdzie zle.

#### Problem 2: Slepota na mean-reversion (h12)

Model ekstrapolowal liniowo: "RSI=80, cena rosnie, wiec za 12h cena wzrosnie jeszcze bardziej". W rzeczywistosci, RSI=80 oznacza **overbought** — cena czesciej spada niz rosnie na dłuzszym horyzoncie.

```typescript
// Mean-reversion factor
const rsiMeanReversion = rsi > 70 ? -(rsi - 50) / 100  // overbought → siła w dół
                        : rsi < 30 ? -(rsi - 50) / 100  // oversold → siła w górę
                        : 0;

// Wplywa TYLKO na h12+
const meanRevFactor = hz.hours >= 12
  ? rsiMeanReversion * volatility * min(hz.hours / 12, 3)
  : 0;
```

**Analogia:** Gdy ktos biegnie pod gorke (RSI rosnacy), krotkoterminowo (h1) bedzie biegal dalej. Ale za 12 godzin? Bedzie zmeczony i zwolni. Model teraz o tym wie.

#### Problem 3: Weryfikacja ktora nic nie weryfikowala

Stary system: "Mam predykcje z timestampem 15:00. Sprawdzam aktualna cene. Czy to jest w ciagu ±10% od predykcji 1h? Nie? Skip."

Problem: endpoint `/verify` byl wolany losowo, nie dokladnie 1h po predykcji. Wiec ±10% window prawie nigdy nie matchował → "0 sprawdzonych, 0 trafionych" → zero informacji zwrotnej.

Nowy system: **retrospective verification**. Traktuje wszystkie zapisane predykcje jako historyczny zapis. Dla kazdej predykcji patrzy: "jaka byla cena DOKLADNIE N godzin pozniej?" i porownuje z tym co model przewidzial.

To jak roznica miedzy "czekaj na odpowiedni moment zeby sprawdzic" vs "zbierz wszystkie dane i przeanalizuj na koniec dnia".

#### Problem 4: XGBoost nigdy nie wytreniwal ani jednego modelu

Trzy bugi naraz:

| Bug | Przyczyna | Fix |
|-----|-----------|-----|
| Label key mismatch | Collector pisal `label_1h`, trainer szukal `label_h1` | `LABEL_KEY_MAP` z oboma formatami |
| MIN_SAMPLES za wysokie | 200 wymagane, 375 zebranych ale po odfiltrowaniu <200 | Obnizone do 50 |
| scikit-learn brak | XGBoost 3.2.0 wymaga sklearn | `pip install scikit-learn` |

**Efekt:** 0 modeli → 24 modeli (8 tokenow × 3 horyzonty). XGBoost teraz jest aktywny z 10% effective weight (30% blend × 33% confidence ze wzgledu na overfitting).

**Overfitting insight:** Train accuracy 98% vs test 24% — klasyczny objaw za malego datasetu (375 probek). Ale to nie katastrofa: 10% effective weight oznacza ze zly XGBoost model moze przesunac predykcje o max 3-4%. A z kazdym dniem dataset rosnie (96 probek/dzien = 15min intervals). Za tydzien bedzie 1000+ probek → retrain powinien dac lepsze wyniki.

#### Problem 5: Magnitude za konserwatywna

Model mowil: "BTC spadnie o 0.15% za godzine". Rzeczywistosc: BTC spadl o 0.5%. Multiplier h1=0.3 byl za niski.

```
PRZED: h1=0.3, h4=0.8
PO:    h1=0.5, h4=1.0
```

### Co sie zmienilo w plikach

| Plik | Zmiany | Co robi |
|------|--------|---------|
| `src/prediction/models/HybridPredictor.ts` | +HORIZON_WEIGHTS, +mean-reversion, rewrite calculatePredictions(), rewrite verifyPredictions() | Mozg predykcji |
| `src/prediction/index.ts` | Return type fix (`Record<string, any>`) | Service wrapper |
| `scripts/xgboost_train.py` | +LABEL_KEY_MAP, lower MIN_SAMPLES | XGBoost training |

### Lekcje inzynierskie

**1. Feedback loop albo smierc**

Najwazniejsza lekcja: system predykcji **bez weryfikacji** jest bezwartosciowy. Mozesz miec najlepszy model na swiecie, ale jesli nie sprawdzasz czy dziala, nie wiesz czy nie pogorszyl sie z czasem. Verification endpoint byl zepsuty od poczatku — nikt nie wiedzial bo nikt nie sprawdzal. To byl "latent bug" — nie wywalal errora, po prostu cicho zwracal zera.

**Zasada:** Kazdy system ML potrzebuje:
1. Treningu (tworzenie modelu)
2. Inference (uzycie modelu)
3. **Weryfikacji** (sprawdzenie czy model nadal dziala)

Punkt 3 jest najczesciej pomijany i najwazniejszy.

**2. Nie wszystkie dane sa rowne we wszystkich kontekstach**

SM data jest **genialne** na h4-m1 ale **szum** na h1. To nie wina danych — to wina kontekstu. Te same dane moga byc sygnał lub szum w zaleznosci od horyzontu czasowego.

**Zasada:** Gdy laczysc rożne zrodla danych, waga kazdego zrodla powinna zalezec od kontekstu uzycia. Flat weights to lazy engineering.

**3. Graceful degradation ratuje**

XGBoost byl zepsuty przez tygodnie, ale system dzialal. HybridPredictor (rules-based) obslugiwal wszystko sam. XGBoost blend weight 30% z confidence cap oznaczal ze nawet zly model mial max ~10% wplywu. Gdy XGBoost wrocil, po prostu "dolozylo sie" do istniejacego systemu.

**Zasada:** Projektuj nowe komponenty jako **ulepszenia** istniejacego systemu, nie jako **zamienniki**. Jesli nowy komponent sie zepsuje, stary powinien dzialac sam. To jest roznica miedzy "ML-enhanced" a "ML-dependent".**

---

## Momentum Guard v3 — nie zamykaj w poplochu, trzymaj na odbicie

> "Kupowanie na dnie to sztuka. Ale prawdziwa sztuka to nie sprzedawac zanim cena wrocona na gore."

### Co poszlo nie tak (v2)

Wyobraz sobie handlarza na bazarze. Kupuje owoce taniem (dump = okazja). Ale jak tylko ktos pyta "po ile?", od razu sprzedaje — nawet jesli kupil za $5 a teraz rynek jest na $4. Nie czeka az rynek wrocona do $6. Traci na kazdej transakcji.

Dokladnie to robil nasz bot. Momentum Guard v2 mial "Position-Aware Guard" — regule ktora mowila:

```
Masz LONG? + Cena spada? → Asks ×1.0 (normalne zlecenia sprzedazy)
```

To brzmi rozsadnie: "masz pozycje, pozwol ja zamknac." Ale w kontekscie mean-reversion Market Makingu to **katastrofa**. Bot kupil tanie tokeny na dumpie (dobrze!), a potem natychmiast je oddawal ze strata bo aski byly aktywne.

### Zasada Mean-Reversion

Mean-reversion = "cena wraca do sredniej." Jesli cena mocno spadla, statystycznie jest bardziej prawdopodobne ze WZROSNIE niz ze spadnie dalej. Market Maker zarabia wlasnie na tym:

```
1. Cena spada (DUMP)     → KUP agresywnie (bidy ×1.30)
2. Trzymaj pozycje        → ZABLOKUJ sprzedaz (aski ×0.10)
3. Cena wraca do sredniej → SPRZEDAJ z zyskiem
```

Position-Aware Guard lamal punkt 2 — zamiast blokowac sprzedaz, trzymal ja na ×1.0.

### Co zmienilismy (v3)

Usunelismy dwie linie kodu. Tak, dwie linie:

```typescript
// PRZED (v2) — position-aware skip flags:
const skipBidReduce = pumpAgainstShort || (microReversal && momentumScore > 0)
const skipAskReduce = dumpAgainstLong || (microReversal && momentumScore < 0)

// PO (v3) — tylko micro-reversal:
const skipBidReduce = microReversal && momentumScore > 0
const skipAskReduce = microReversal && momentumScore < 0
```

Usunelismy `pumpAgainstShort` i `dumpAgainstLong`. Reszta kodu sie nie zmienila.

### Symetria ktora dziala

Teraz bot zachowuje sie identycznie dla longow i shortow:

```
PUMP (cena rosnie):              DUMP (cena spada):
  Bidy ×0.10 (nie kupuj)          Bidy ×1.30 (kupuj dip!)
  Aski ×1.30 (sprzedawaj)         Aski ×0.10 (trzymaj!)
       ↓                               ↓
  Bot ma SHORT → trzyma go 💎     Bot ma LONG → trzyma go 💎
  Bot nie ma → nie kupuje szczytu  Bot nie ma → kupuje dno
```

**Jedyny wyjątek: Micro-reversal.** Gdy 1h momentum mowi "dump" ale cena juz odbila >0.3% od dna → "dump stalling" → aski wracaja do ×1.0 → bot moze zamknac longa z zyskiem. To jest punkt 3 z mean-reversion cyklu: "cena wraca → sprzedaj."

### Dowod z fills

Przed fixem (17:50-17:56):
```
17:50:55  Open Long @ 0.003791  ← kupil dip (dobrze!)
17:50:57  Open Long @ 0.003793
17:51:01  Open Long @ 0.003776  ← najtaniej (swietnie!)
  ...5 minut...
17:56:16  Close Long @ 0.003790  -$0.22  ← zamknal PONIZEJ entry (zle!)
17:56:18  Close Long @ 0.003791  -$0.36  ← strata bo asks ×1.0
```

Po fixie (oczekiwane):
```
  Open Long @ 0.003776  ← kupil dip (tak samo)
  ...asks ×0.10 → bot TRZYMA...
  Cena odbija do 0.003820
  Micro-reversal detected → asks ×1.0
  Close Long @ 0.003820  +$0.50  ← zysk bo czekal na odbicie
```

### Lekcje inzynierskie

**1. Nie naprawiaj tego co nie jest zepsute**

Oryginalny Momentum Guard (v1) mial poprawna mean-reversion symetrie. Position-Aware Guard (v2) zostal dodany jako "ulepszenie" — "pomozmy zamykac pozycje." Ale system juz wiedzial kiedy zamykac (micro-reversal). Dodatkowa regula pogorszyla wyniki zamiast je poprawic.

**Zasada: Zanim dodasz nowa regule, upewnij sie ze istniejacy system nie obsluguje juz tego scenariusza. Redundantna logika to nie jest "dodatkowe bezpieczenstwo" — to potencjalny konflikt.**

**2. Symetria jest twoim przyjacielem**

Mean-reversion jest z natury symetryczny: pump = mirror dump. Jesli twoj system traktuje pump i dump rozne (rozne skip flags, rozne warunki), prawdopodobnie cos jest nie tak. Symetryczny system jest latwiejszy do zrozumienia, debugowania i testowania.

**Zasada: Jesli twoja logika handlowa nie jest symetryczna, potrzebujesz dobrego powodu. "Bo tak sie wydaje bezpieczniej" to nie jest dobry powod.**

**3. Dwie linie kodu moga zmienic wszystko**

Cala zmiana to usuniecie dwoch flag z jednej linii. Zero nowych features, zero nowych parametrow, zero nowych plikow. Ale efekt jest fundamentalny — bot przestal zamykac pozycje ze strata na dumpach.

**Zasada: Najlepsze fixy to czesto nie dodawanie kodu, ale usuwanie go. Kod ktory nie istnieje nie ma bugow.**

---

## Prediction Bias — bot zaczyna przewidywac przyszlosc

### Analogia: Prognoza pogody dla tradera

Wyobraz sobie, ze prowadzisz stoisko na targowisku. Dotychczas reagowales na pogode ktora **juz jest** — deszcz pada, otwierasz parasol. Teraz masz dodatkowo prognoza pogody na nastepne 4 godziny: "80% szans na deszcz po poludniu."

Co robisz? Nie zamykasz stoiska (za radykalne). Nie ignorujesz prognozy (szkoda). **Lekko przygotowujesz sie** — troche mniej towaru na wystawie, parasol pod reka.

Dokladnie tak dziala Prediction Bias w bocie.

### Problem: Mozg bota nie mowil do rak

Nasz system predykcji (prediction-api na porcie 8090) byl jak meteorolog ktory robi prognozy... ale nikt ich nie slucha:

```
prediction-api (port 8090):  "h4: kPEPE -2.33%, confidence 51%"
War Room (port 3000):        [wyswietla ladne wykresy]
Bot (mm_hl.ts):              [kompletnie ignoruje, handluje po swojemu]
```

Oracle Vision istnial w kodzie bota, ale mial komentarz ktory mowil wszystko: `"logging only — no trading action"`. Dosłownie — logował przewidywania, ale nie uzywał ich do niczego.

### Rozwiazanie: Soft Prediction Bias

Kluczowe slowo to **soft**. Nie dajemy predykcji pelnej wladzy nad botem. Dajemy jej glos doradczy — max ±15% na bid/ask multipliers.

```
h4 mowi BEARISH -2.33%, confidence 51%
  → strength = min(2.33 / 3.0, 1.0) = 0.78
  → bidMult = 1.0 - 0.10 × 0.78 = 0.92  (mniej kupuj)
  → askMult = 1.0 + 0.15 × 0.78 = 1.12  (wiecej sprzedawaj)
```

Porownaj z Momentum Guard ktory moze dac ×0.10 lub ×1.30 — Prediction Bias jest delikatny, jak lekki wiatr pochylajacy siatke w jedna strone.

### Proaktywny vs Reaktywny

To jest kluczowa roznica:

```
PREDICTION BIAS (proaktywny):
  "Za 4 godziny cena spadnie 2.3%"
  → Juz teraz lekko redukuj bidy, wzmacniaj aski
  → Bot przygotowuje sie ZANIM cena sie ruszy

MOMENTUM GUARD (reaktywny):
  "Cena spadla 1.5% w ostatnia godzine"
  → Teraz reaguj: bidy ×1.30, aski ×0.10
  → Bot reaguje PO ruchu cenowym
```

W pipeline kPEPE Prediction Bias jest PRZED Momentum Guard — oba wplywaja na te same multipliers multiplicatywnie:
```
Toxicity → TimeZone → Prediction Bias → Momentum Guard → Dynamic TP → Inventory SL → Auto-Skew
```

### Problem z kPEPE: mala litera

Prosty bug ktory zjadl godzine debugowania. Hyperliquid API wymaga dokladnie `kPEPE` (mala `k`). Prediction-api uzywalo `toUpperCase()` na kazdym tokenie:

```typescript
// PRZED:
const token = path.split('/')[2]?.toUpperCase()  // kPEPE → KPEPE → HTTP 500!

// PO:
const MIXED_CASE_TOKENS = { 'KPEPE': 'kPEPE' }
function normalizeToken(raw) {
  const upper = raw.toUpperCase()
  return MIXED_CASE_TOKENS[upper] || upper  // KPEPE → kPEPE ✓
}
```

**Lekcja:** Nigdy nie zakladaj ze `toUpperCase()` jest bezpieczna normalizacja. Kazde API ma swoje konwencje. Hyperliquid ma mieszane: `BTC`, `ETH`, `SOL` (uppercase) ale `kPEPE`, `kBONK` (mixed case). Jeden test integracyjny by to zlapal.

### Zabezpieczenia (graceful degradation)

```
prediction-api nie dziala?     → brak bias, bot handluje normalnie
Confidence < 50%?             → brak bias (za mala pewnosc)
|change| < 0.3%?              → brak bias (za slaby sygnal)
Predykcja starsza niz 15 min? → staleFactor = 0.5 (polowa efektu)
Fetch trwa > 3 sekundy?       → abort, uzyj cache
```

Bot nigdy nie zatrzyma sie z powodu prediction-api. To jest **nice-to-have**, nie **must-have**.

### Co to znaczy dla pipeline'u

Pelen lancuch decyzyjny dla kPEPE teraz wyglada tak:

```
1. Toxicity Engine:    "Czy ktos gra przeciwko nam?" → size mult
2. TimeZone:          "Asia quiet czy US peak?"      → spread/size mult
3. PREDICTION BIAS:   "Za 4h cena spadnie 2.3%"     → bid×0.92, ask×1.12  ← NOWE
4. Momentum Guard:    "1h momentum -0.21"            → bid×0.92, ask×0.74
5. Dynamic TP:        "Micro-reversal? Widen TP"     → spread mult
6. Inventory SL:      "Skew > 40% + underwater?"     → panic mode
7. Auto-Skew:         "Przesun mid o 6bps"           → mid price shift
```

Kazdy krok mnozy multipliers z poprzednich — wynik koncowy to produkt wszystkich:
```
Final bid = 1.0 × toxicity × timezone × prediction(0.92) × momentum(0.92) ≈ 0.85
Final ask = 1.0 × toxicity × timezone × prediction(1.12) × momentum(0.74) ≈ 0.83
```

### Lekcje inzynierskie

**1. Zacznij od soft integration**

Mogliśmy podlaczyc predykcje jako twardy sygnal ("BEARISH → blokuj bidy!"). Zamiast tego — soft bias ±15%. Dlaczego?

- Predykcja moze sie mylic (h4 accuracy ~50-88% zaleznie od tokena)
- Inne moduly juz podejmuja decyzje (MG, Toxicity)
- Jesli predykcja jest dobra, ±15% daje edge. Jesli zla, ±15% nie zalamie systemu.

**Zasada: Nowe zrodlo sygnalu dodawaj jako "glos doradczy" (soft bias), nie jako "generalskie rozkazy" (hard override). Niech udowodni wartosc zanim dostanie wiecej wladzy.**

**2. Cache + timeout = odpornosc**

Fetch do prediction-api moze trwac 100ms lub 10s (jezeli serwer jest pod obciazeniem). Bez timeoutu 3s, caly tick bota by sie opóznial. Bez cache 5min, robilibysmy 60 requestow na godzine zamiast 12.

**Zasada: Kazda zewnetrzna zaleznosc powinna miec timeout, cache, i fallback. "Co jezeli ten serwis nie odpowiada?" to pierwsze pytanie ktore powinienes zadac.**

**3. Multiplicatywne multipliers to potezne narzedzie**

Kazdy modul mnozy `sizeMultipliers.bid` i `sizeMultipliers.ask`. Nie nadpisuje — mnozy. To znaczy ze wszystkie moduly wspolpracuja automatycznie:

```
Toxicity mowi "mniej":  0.80
Prediction mowi "mniej": 0.92
Momentum mowi "mniej":   0.92
Wynik: 0.80 × 0.92 × 0.92 = 0.68 (wszystkie zgodne → silna redukcja)

Ale jesli Prediction mowi "wiecej" a Momentum "mniej":
1.12 × 0.92 = 1.03 (prawie neutralne — sygnaly sie niweluja)
```

**Zasada: Multiplicatywna architektura pozwala modulom "glosowac" bez konfliktu. Kazdy moze wzmocnic lub oslabiC sygnal, ale zaden nie moze calkowicie zlamac innego.**

---

## Rozdzial 12: Copy-Trading Bot — Cien Generala v3

### Co budujemy i dlaczego

Wyobraz sobie, ze masz dostep do portfela najlepszego tradera na gieldzie. Widzisz kazda jego pozycje, widzisz kiedy otwiera nowe, kiedy zamyka stare. Pytanie: czy nie bylby dobrze po prostu KOPIOWAC jego ruchy?

To wlasnie robi nasz Copy-Trading Bot. Generał (adres `0xa31211...`) to trader z +$1.26M unrealized PnL na 8 pozycjach, total value $2.23M. Jego decyzje opieraja sie na algorytmach ktore analizuja dane, do ktorych my nie mamy dostepu. Zamiast zgadywac CO robi — po prostu go kopiujemy.

### Architektura: 3 warstwy

```
WARSTWA 1: vip_spy.py (Python)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Co 30 sekund pyta Hyperliquid API:
"Jakie pozycje ma Generał?"
↓
Zapisuje do /tmp/vip_spy_state.json
+ /tmp/general_changes.json (z portfolio summary)

WARSTWA 2: general_copytrade.ts (TypeScript)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Co 30 sekund czyta /tmp/vip_spy_state.json:
"Co sie zmienilo od ostatniego razu?"
↓
Jesli NOWA pozycja → otwieramy kopie ($500)
Jesli ZAMKNIETA → zamykamy nasza kopie
Jesli FLIP → zamknij stara, otworz nowa
Jesli REDUKCJA >20% → redukuj proporcjonalnie

WARSTWA 3: Hyperliquid SDK (API)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IOC ordery z 30bps slippage
Reduce-only do zamykania
Automatyczny leverage setup
```

### Kluczowy problem: Baseline Seeding

Przy pierwszym uruchomieniu bot widzi 8 istniejacych pozycji Generala. Gdyby potraktowal je jako "nowe", probowalby otworzyc 8 kopii natychmiast — ale to sa stare pozycje, otwarte tygodnie temu po zupelnie innych cenach!

**Rozwiazanie:** Baseline seeding. Na starcie bot:
1. Zapisuje snapshot WSZYSTKICH istniejacych pozycji Generala
2. Oznacza je w `activeCopies` jako `baseline: true`
3. Od tego momentu kopiuje TYLKO nowe pozycje

Bug ktory znalezlismy: `loadCopyState()` zwracal `startTime: Date.now()` zamiast `0` w domyslnym stanie. Przez to `isFirstStart` (ktory sprawdzal `startTime === 0`) byl zawsze `false` i baseline nigdy sie nie zapisywal. Fix: zmiana defaultu na `startTime: 0`.

**Lekcja: Wartosc domyslna moze byc zrodlem bugu. `Date.now()` wydaje sie sensowne jako "czas startu", ale zlamalo logike wykrywania pierwszego startu. Czasem `0` (lub `null`) jest lepsza wartosc domyslna, bo latwiej ja wykryc.**

### LIT LONG — Generał vs SM Consensus

Ciekawy przypadek: Generał otworzyl LIT LONG $197K (141K LIT @ $1.375, 5x isolated), ale SM consensus na LIT to 6.7x SHORT dominant ($3.77M SHORT vs $562K LONG). Generał jest jednym z dwoch SM longujacych LIT.

To pokazuje dlaczego kopiujemy KONKRETNEGO tradera a nie "SM consensus":
- SM consensus moze byc lag (opózniony o 15 min z whale_tracker)
- Generał moze widziec cos czego inni nie widza (np. buyback program, fundament)
- Isolated leverage 5x = izoluje ryzyko od reszty portfela

### Dynamic Spread — bo staly spread nie dziala

Wyobraz sobie, ze jestes kasjera w kantorze. W cichym poniedzialek spread 0.18% jest ok — klienci przychodza rzadko, masz czas. Ale w piatek wieczorem, kiedy kazdy wymienia walute, spread 0.18% jest za waski — ktos moze kupic u ciebie i sprzedac chwile pozniej DROŻEJ na innym okienku (to sie nazywa "adverse selection").

Odwrotnie — w BARDZO wolnym dniu, 0.18% moze byc za duzo, bo nikt nie chce handlowac po takiej cenie. Lepiej zwezic spread do 0.14% i przyciagnac wiecej transakcji.

Dynamic Spread robi dokladnie to, ale automatycznie:
- Mierzy **ATR%** (Average True Range jako % ceny) — miara zmiennosci
- Low vol (ATR < 0.30%): widen L1 do 28bps (choppy market = fee-eating)
- High vol (ATR > 0.80%): tighten L1 do 14bps (trending market = capture moves)
- L2-L4 skaluja sie proporcjonalnie (zachowuja proporcje siatki)

### Min Profit Buffer — nie zamykaj ze strata na fees

Problem: bot moze postawic close order (zamykajacy pozycje) tak blisko ceny wejscia, ze FEES zjada caly zysk. Na Hyperliquid:
- Taker fee: 3.5bps (0.035%)
- Kupno + sprzedaz = 7bps (0.07%)
- Jesli close order jest 5bps od entry → strata 2bps gwarantowana

Min Profit Buffer filtruje takie ordery:
- Minimum 10bps od entry price (7bps fees + 3bps safety)
- SHORT: bidy musza byc ponizej `entry × 0.999`
- LONG: aski musza byc powyzej `entry × 1.001`

### Lekcje inzynierskie

**1. Baseline problem jest wszedzie**

Kazdy system ktory "obserwuje zmiany" musi wiedziec JAK wyglada punkt startowy. Bez baseline:
- Monitoring: "wszystko jest NOWE!" (fałszywe alarmy)
- Copy bot: "kopiuj WSZYSTKO!" (stare pozycje)
- Git: "wszystko zmienione!" (bez pierwszego commita)

**Zasada: Kazdy system porownujacy "teraz vs wczesniej" potrzebuje jawnego baseline. Nie zakladaj ze poczatkowy stan jest pusty.**

**2. File-based communication (prosty ale potezny)**

vip_spy.py pisze JSON → general_copytrade.ts czyta JSON. Zero skomplikowanych protokolow, zero message queue, zero gRPC. Czemu to dziala?

- Atomiczne zapisy (write to temp → rename)
- Naturalna odpornosc (plik nie istnieje → skip, plik uszkodzony → skip)
- Latwy debugging (po prostu `cat /tmp/vip_spy_state.json`)
- Zero zaleznosci (nie trzeba Redis, RabbitMQ, Kafka)

**Zasada: Jesli dwa procesy musza sie komunikowac i NIE potrzebuja real-time (<1s), plik JSON jest czesto najlepsza opcja. KISS (Keep It Simple, Stupid).**

**3. Dry-run jako default**

Bot startuje ZAWSZE w dry-run. Musisz SWIADOMIE zmienic na `--live`. To chroni przed:
- Przypadkowym deployem na produkcji
- Testowaniem z prawdziwymi pieniedzmi
- "Ops, nie wiedzialem ze to jest live!"

**Zasada: Kazdy system ktory moze stracic pieniadze/dane powinien byc domyslnie w trybie "nie rob nic". Wlaczenie destrukcyjnych akcji powinno wymagac jawnej decyzji.**

---

## Rozdzial 18: Pierwszy ML Model dla kPEPE — Od Rule-Based do Machine Learning

*27 lutego 2026 — dzien, w ktorym kPEPE dostal wlasny mozg*

### Kontekst

Przez caly czas kPEPE (nasz PURE_MM memecoin) dzialal na samych regulach:
- Momentum Guard: "RSI oversold? Kupuj wiecej!"
- Toxicity Engine: "Szybkie fille? Rozszerz spread!"
- Prediction Bias: "HybridPredictor mowi -2.33%? Mniej kupuj!"

Problem z rule-based prediction: HybridPredictor po prostu ekstrapoluje trend liniowo. Jak cena spada, mowi "bedzie spadac dalej". Na support to jest glupie — cena moze odbic.

### XGBoost Training — co, jak, dlaczego

**XGBoost** (eXtreme Gradient Boosting) to algorytm ML ktory buduje "las" drzew decyzyjnych. Kazde drzewo poprawia bledy poprzedniego. Jest szybki, nie wymaga GPU, i dobrze dziala na małych datasetach.

**Dataset:** 90 wierszy (co 15 min od 26.02), 30 cech per wiersz:
- Techniczne: RSI, MACD, Bollinger Bands, ATR
- Rynkowe: OI change, volume, volatility, funding rate
- Czasowe: hour_sin/cos, day_sin/cos (pora dnia/tygodnia)
- SM: sm_ratio, sm_long/short_usd (dla kPEPE = prawie zero, bo whale_tracker nie trackuje kPEPE)

**Wyniki (90 samples, 3 klasy: SHORT/NEUTRAL/LONG):**
| Horyzont | Test Accuracy | Random Baseline | Top Feature |
|----------|---------------|-----------------|-------------|
| h1 | 58.8% | 33% | MACD signal (19%) |
| h4 | 60.0% | 33% | Pora dnia (20%) |

**Ciekawe discovery:** Top feature dla h4 = `hour_cos` (pora dnia, 20% waznosci!). To potwierdza cos co widzielismy empirycznie — kPEPE ma bardzo wyrazny time-of-day pattern. Asia session (02-04 UTC) = niska vol, US open (14-16 UTC) = wysoka vol + toksycznosc. Model to wylapał sam.

### Efekt na bota

Prediction Bias kPEPE korzysta z h4 predykcji. Po wlaczeniu XGBoost blend:

```
Rule-based only:  h4=BEARISH -2.33% → bid×0.92 ask×1.12 (agresywnie bearish)
Z XGBoost blend:  h4=BEARISH -0.92% → bid×0.97 ask×1.05 (lagodnie bearish)
```

Na support ($0.003631) z RSI=22, XGBoost moderuje predykcje — mowi "tak, trend jest w dol, ale na tym poziomie spadek moze wyhamowac". Rule-based tego nie widzi (slepo ekstrapoluje).

### kPEPE Performance 27.02 — $83 w jeden dzien

374 fills, 100% win rate (zero strat), +$83.23 PnL. Bot siedzial na support caly dzien:
- Kupował dip (bidy wypelniane na $0.003631-0.003650)
- Sprzedawal na micro-bounceach (aski na $0.003660-0.003680)
- Micro-reversal pozwalal zamykac longi z zyskiem zamiast trzymac w nieskonczonosc

$83/dzien z $12.5K capital = ~240% annualizowane. Oczywiscie to jeden dzien na support (idealny scenariusz dla MM), ale system dziala.

### Silk Capital — nasz "sojusznik" na kPEPE

Przy okazji odkrylismy kto jest glownym SM graczem na kPEPE:

**Silk Capital (0x880ac4):** $4.3M equity, kPEPE SHORT $250K (+$51K, +20%). Hardcore shorter — XMR SHORT $10.1M, HYPE SHORT $5.4M. Tier CONVICTION, weight 0.75.

Nasz bot dziala jako PURE_MM (obie strony), ale fakt ze biggest SM player jest SHORT potwierdza ze kPEPE jest w downtrend. Nie wplywu na bota (kPEPE nie jest w whale_tracker WATCHED_COINS), ale to intel.

### Mass SM Profit-Taking

Takze dzisiaj 5 wielorybow zredukowalo shorty o 35-40%:
- fce0: BTC $11.8M→$8.5M, ETH $6M→$3.6M
- SOL2: SOL $8.1M→$4.8M

Ale to NIE byly pelne wyjscia — redukcja zyskow. Heavyweights (58bro $31.8M, Wice-General $28.8M, Kraken A $14.3M) nie ruszyli nawet palcem. SM consensus SHORT nadal trzyma.

### Lekcje inzynierskie

**1. dist/ vs src/ — wieczny problem TypeScript**

Zrodlo (`src/prediction/models/XGBoostPredictor.ts`) mialo kPEPE od 26.02. Ale `dist/` (skompilowany JS ktory PM2 uruchamia) nie mialo — bo `tsc` nie kompiluje czysto (pre-existing errors w innych plikach). Musielismy ręcznie patchowac dist.

**Zasada: Jesli nie mozesz skompilowac czysto, masz dwa wyjscia: (1) napraw WSZYSTKIE errory (idealne ale czasochlonne), (2) patchuj dist reczne i pamietaj ze sie rozjezdza. Opcja 2 jest "technicznym dlugiem" — dziala teraz, gryzie pozniej.**

**2. ML nie musi byc skomplikowane**

XGBoost z 90 probkami, 30 cechami, 2 sekundy treningu → 60% accuracy na 3-class problem. Nie potrzebujesz GPU, nie potrzebujesz miliona probek, nie potrzebujesz transformerow. Dobry feature engineering (pora dnia!) + prosty model = lepiej niz fancy rule-based system.

**3. Blend > Replace**

Nie zamienilismy HybridPredictor na XGBoost. XGBoost jest blendowany z 30% waga × 33% confidence = ~10% efektywnego wplywu. Dlaczego?
- 90 probek to za malo na pelne zaufanie
- Rule-based ma domain knowledge (SM signals, mean-reversion)
- Blend laczy "co model znalazl w danych" z "co wiemy o rynku"

Jak dataset urosnie do 500+, XGBoost confidence wzrosnie i blend automatycznie da mu wiecej wagi.

**4. Bot widzi support — ale po swojemu**

Momentum Guard `prox=-1.00` + `RSI=22` = "jestem na dnie". Ale overall score to "tylko" -0.27 (LIGHT) bo 1h momentum = 0.0% (cena jest flat na support, nie w aktywnym spadku). System mowi: "wiem ze to support, ale nic sie nie dzieje — bede ostrozny, nie agresywny". I to jest madrze — agresywne kupowanie na support ktory moze przebic to przepis na strate.

---

## Rozdzial 12: Zabijanie martwego sygnalu — kPEPE Weight Redistribution

### Problem: 30% wagi = zero

HybridPredictor ma 5 sygnalow: technical, momentum, smartMoney, volume, trend. Dla wiekszosci tokenow (BTC, ETH, SOL) smartMoney to nasz edge — whale_tracker daje nam dane o pozycjach 40+ wielorybow, a SM signal ma 10-65% wagi w zaleznosci od horyzontu.

Ale kPEPE? Zero. Nul. Nic.

whale_tracker nie ma kPEPE w `WATCHED_COINS`. Na spot PEPE (Ethereum) przez Nansen MCP sprawdzilismy: 3 SM holders z drobnymi pozycjami, **zero inflows, zero outflows przez 7 dni**. Na Hyperliquid perps przeskanowalismy wszystkie 64 adresy wielorybow — 6 ma kPEPE, ale 94% to Silk Capital ($250K SHORT). Jeden trader to nie "smart money consensus" — to hazard jednego funduszu.

Wynik? `smartMoney: 0.00` w kazdy prediction call. Na krotkich horyzontach (h1) to 10% martwej wagi — nie tak zle. Ale na h4 to 30%, na h12 to 40%, na m1 to **65%**. Dwie trzecie predykcji miesiecznej opieralo sie na sygnale ktory zawsze zwracal zero.

To jak gdyby 65% twojego nawigacji GPS skladalo sie z danych radarowych z lotniskowca... ktory nie istnieje.

### Rozwiazanie: TOKEN_WEIGHT_OVERRIDES

Zamiast patrzec na martwy sygnal, redystrybuujemy jego wage do sygnalow ktore naprawde dzialaja. Nowy mechanizm:

```typescript
const TOKEN_WEIGHT_OVERRIDES = {
  kPEPE: {
    h1:  { technical: 0.40, momentum: 0.30, smartMoney: 0.00, volume: 0.15, trend: 0.15 },
    h4:  { technical: 0.35, momentum: 0.30, smartMoney: 0.00, volume: 0.15, trend: 0.20 },
    // ... h12, w1, m1 — SM=0%, reszta rosnie
  },
};
```

W `calculatePredictions()` lookup jest prosty:
```typescript
const weightsMap = (token && TOKEN_WEIGHT_OVERRIDES[token]) || HORIZON_WEIGHTS;
```

Jesli token ma override → uzyj go. Jesli nie → domyslne wagi (SM 10-65%). Zero zmian dla BTC/ETH/SOL — ich SM dane sa zdrowe.

### Co sie zmienilo w praktyce

Przed: kPEPE h4 prediction = `technical * 0.25 + momentum * 0.20 + 0 * 0.30 + volume * 0.10 + momentum * 0.15`
Po: kPEPE h4 prediction = `technical * 0.35 + momentum * 0.30 + 0 * 0.00 + volume * 0.15 + momentum * 0.20`

Technical i momentum dostaly wiecej glosu. Na dlugich horyzontach (w1, m1) trend dominuje — co ma sens, bo kPEPE jest memecoin ktory podaza za ogolnym sentymentem rynku bardziej niz za fundamentami.

### Lekcja: audytuj swoje wagi

Kiedy budujesz model predykcyjny, latwo jest ustawic wagi raz i zapomniec. "SM ma 40% bo to nasz edge!" — tak, ale czy SM NAPRAWDE daje dane dla KAZDEGO tokena? Regularny audyt wag vs faktyczny sygnal to must-have.

**Zasada: Dead input > zero wagi > szum.** Martwy input ktory zawsze zwraca 0 to nie jest "neutralny" — to rozcienczanie sygnalow ktore naprawde dzialaja. Wyobraz sobie ze masz 5 doradcow, ale jeden spi. Nie mowisz "jego glos sie nie liczy" — mowisz "reszta teraz ma wiecej do powiedzenia".

### Kiedy przywrocic SM

SM dla kPEPE wroci gdy spelni sie jedno z:
- >= 3 SM addresses z >$50K na kPEPE perps (konsensus a nie jeden trader)
- SM spot activity na PEPE >$500K/tydzien (smart money zaczyna handlowac spotem)

Do tego czasu — kPEPE predykcje opieraja sie w 100% na technice, momentum i trendzie. I to jest szczere, bo to sa jedyne sygnaly ktore naprawde mamy.

---

## Rozdzial 24: Prediction Bias dla wszystkich tokenow — lekcja o deploy pipeline

### Problem: jedna galaz kodu, dwa swiaty

Mielismy fajny feature — prediction bias. Bot fetchowal h4 prognozę z naszego ML modelu (prediction-api, port 8090) i uzywal jej jako soft ±15% bias na rozmiar orderow. BEARISH prediction → mniejsze bidy (mniej kupowania), wieksze aski (agresywniejsze shortowanie). BULLISH → odwrotnie.

Ale dzialal tylko na kPEPE. Piec innych tokenow (BTC, ETH, SOL, HYPE, FARTCOIN) — zero prediction bias. 100% decyzji SM signals + regime gating. ML model pracowal, mial dobre predykcje dla wszystkich tokenow, ale nikt ich nie konsumował.

### Architektura: dwie sciezki wykonania

W `mm_hl.ts` jest metoda `executeMultiLayerMM` ktora obsluguje generowanie grida. Wewnatrz jest rozgalezienie:

```typescript
if (pair === 'kPEPE') {
  // ... Toxicity Engine, TimeZone, Prediction Bias, Momentum Guard ...
  gridOrders = this.gridManager.generateGridOrdersCustom(...)
} else {
  // ... reszta tokenow — tutaj brakowalo prediction bias ...
  gridOrders = this.gridManager.generateGridOrders(...)
}
```

kPEPE ma swoj bogaty pipeline (10+ modulow). Reszta tokenow ma prostszy pipeline. Prediction bias zostal dodany do kPEPE i... nikt nie pomyslal o reszcie.

### Fix: 16 linii kodu

Dodanie prediction bias do else branchu to 16 linii:

```typescript
} else {
  try {
    await this.fetchPrediction(symbol)
    const predBias = this.getPredictionBias(symbol)
    if (predBias.reason) {
      sizeMultipliers.bid *= predBias.bidMult
      sizeMultipliers.ask *= predBias.askMult
    }
  } catch {
    // prediction-api down — continue normally
  }

  gridOrders = this.gridManager.generateGridOrders(...)
}
```

Proste. Ale potem zaczela sie prawdziwa lekcja.

### Lekcja 1: Skad biegnie kod?

Po dodaniu kodu lokalnie i patchowaniu `dist/mm_hl.js` na serwerze — zero efektu. Zero logow, zero prediction bias. Dwa dni debugowania.

Root cause: **mm-follower biegnie z `src/mm_hl.ts` przez ts-node, NIE z `dist/mm_hl.js`**.

```
ecosystem.config.cjs:
  script: "src/mm_hl.ts"          ← to jest zrodlo prawdy
  interpreter_args: "--experimental-loader ts-node/esm"
```

ts-node kompiluje TypeScript w locie do JavaScript. Nie uzywa katalogu `dist/`. Wiec caly czas patchowalismy ZLY PLIK.

**Lekcja: Zanim zaczniesz debugowac, sprawdz KTORY plik jest wykonywany.** `pm2 show <process>` pokaze `script path`. Jesli to `src/*.ts` — zmieniaj src. Jesli to `dist/*.js` — zmieniaj dist. Nigdy nie zakladaj.

### Lekcja 2: src vs dist — dwie prawdy

W naszym projekcie mamy ciekawy podzial:
- **mm-follower** i **mm-pure** — biegna z `src/` (ts-node)
- **prediction-api** — biegnie z `dist/` (skompilowany JS)

Dlaczego? Bo `tsc` (TypeScript compiler) nie kompiluje czysto — sa pre-existing type errors w roznych czesciach codebase. `TS_NODE_TRANSPILE_ONLY=1` pomija type checking i kompiluje "na zywo". `dist/` jest wynikiem starszej kompilacji, ktora trzeba patchowac recznie.

To znaczy ze:
- Zmiana w `src/mm_hl.ts` → SCP na serwer → restart mm-follower/mm-pure
- Zmiana w prediction-api → patch `dist/prediction/*.js` na serwerze → restart prediction-api

**Dwie rozne procedury deploy dla roznych procesow.** Nie jest to idealne, ale tsc nie kompiluje czysto, wiec z tym zyjemy.

### Lekcja 3: Log throttling moze cie zmylic

`PREDICTION_BIAS` log drukuje sie co 20 tickow (~20 minut):

```typescript
if (this.tickCount % 20 === 0) {
  console.log(`📊 [PREDICTION_BIAS] ${pair}: ${predBias.reason}`)
}
```

Kod DZIALA (modyfikuje sizeMultipliers) nawet gdy log nie drukuje. Ale z perspektywy debuggera — zero logow = "kod nie dziala". Dodanie tymczasowego unconditional `console.log` przed throttled logiem od razu pokaze czy kod jest osiagany.

**Zasada debugowania:** Gdy szukasz czy kod w ogole sie wykonuje — NIGDY nie polegaj na throttled logach. Dodaj tymczasowy unconditional log, zweryfikuj, usun.

### Lekcja 4: executeMultiLayerMM vs executeRegularMM

Poczatkowo myslalismy ze mm-follower uzywa `executeRegularMM` (prostsza metoda z 1 bidem + 1 askiem). To by tlumaczylo brak prediction bias — kod byl w `executeMultiLayerMM`.

Ale sprawdzenie logow (`[DEBUG ENTRY] executeMultiLayerMM called for BTC`) i konfiguracji (`ENABLE_MULTI_LAYER=true` w .env) potwierdzilo ze OBA procesy uzywaja `executeMultiLayerMM`.

Routing:
```typescript
async executePairMM(pair, assetCtxs) {
  if (this.config.enableMultiLayer && this.gridManager) {
    return await this.executeMultiLayerMM(pair, assetCtxs)  // ← tu trafiaja oba
  }
  return await this.executeRegularMM(pair, assetCtxs)       // ← dead code w naszym setupie
}
```

**Lekcja: Nie zakladaj sciezki wykonania — zweryfikuj.** Jeden `grep` w logach lub jeden `console.log` w kodzie oszczedzi godziny slepego debugowania.

### Wyniki

Po poprawce — 6 tokenow z prediction bias:

| Token | h4 Prediction | Bid Mult | Ask Mult |
|-------|--------------|----------|----------|
| BTC | BEARISH -0.80% | ×0.97 | ×1.04 |
| ETH | BEARISH -1.31% | ×0.96 | ×1.07 |
| SOL | BEARISH -1.41% | ×0.95 | ×1.07 |
| HYPE | BEARISH -1.12% | ×0.96 | ×1.06 |
| FARTCOIN | BEARISH -1.82% | ×0.94 | ×1.09 |
| kPEPE | BEARISH -1.13% | ×0.96 | ×1.06 |

Prediction bias jest **multiplicative** z innymi modulami. Jesli SM mowi SHORT (ask×1.50) i prediction mowi BEARISH (ask×1.07) — wynik to ask×1.61. Moduly ktore sie zgadzaja wzmacniaja sygnal. Moduly ktore sie nie zgadzaja — neutralizuja sie.

### Podsumowanie lekcji

1. **Sprawdz script path** przed debugowaniem — `pm2 show` pokaze skad biegnie kod
2. **src vs dist** — rozne procesy moga biegac z roznych zrodel
3. **Unconditional logs** do debugowania, nie throttled
4. **Weryfikuj sciezke wykonania** logami, nie zakladaj
5. **16 linii kodu, 2 dni debugowania** — wiekszosc czasu programisty to zrozumienie problemu, nie pisanie rozwiazania

---

## Rozdzial 25: Candlestick Patterns w ML Pipeline — jak dodac features bez zepsucia produkcji

### Problem: XGBoost nie widzi geometrii swiec

Nasz model ML (XGBoost) mial 30 features — technical indicators (RSI, MACD, BB), Nansen SM data, funding, OI, pora dnia. Ale ZERO informacji o ksztalcie samej swieczki.

Wyobraz sobie tradera ktory patrzy na wykres, ale widzi TYLKO liczby (RSI=32, MACD=-0.5) bez patrzenia na same swieczki. Nie widzi hammera na dnie, nie widzi shooting star na szczycie, nie widzi bearish engulfing po pumpie. Wlasnie tak dzialal nasz model.

Analiza kPEPE price action (bearish expansion, liquidity cascade, bear flag) pokazala ze candlestick patterns dodaja informacje ktore zadna z naszych 30 features nie capturuje — geometria cenowa w ramach jednej swieczki.

### Czym sa candlestick patterns?

Kazda swieczka OHLC (Open, High, Low, Close) tworzy ksztalt. Ten ksztalt mowi cos o walce miedzy kupujacymi a sprzedajacymi:

```
Hammer (bullish):       Shooting Star (bearish):
    |                         |
    |                         |
   ___                       ___
  |   |                     |   |
  |___|                     |___|
    |
    |
    |
```

Hammer: cena spadla nisko (dlugi dolny cien), ale kupujacy zepchneli ja z powrotem (male cialo na gorze). To sygnal "popyt jest silny".

Shooting Star: cena poszla wysoko (dlugi gorny cien), ale sprzedajacy zepchneli ja z powrotem (male cialo na dole). To sygnal "podaz jest silna".

### 15 nowych features

Dodalismy 3 kategorie:

**Boolean patterns (13):** hammer, shooting_star, engulfing_bull/bear, doji, pin_bar_bull/bear, marubozu_bull/bear, inside_bar, three_crows, three_soldiers, spinning_top. Wartosc 0.0 lub 1.0.

**Continuous features (2):** body_ratio (0=doji, 1=marubozu — jak "zdecydowana" jest swieczka) i wick_skew (-1 do +1 — czy presja jest od gory czy dolu).

### Backward compatibility — klucz do bezpiecznego deploy

To najwazniejsza lekcja tego rozdzialu. Mielismy ~480 wierszy danych per token, wszystkie z 30 features. Nie mozemy ich wyrzucic — to miesiac zbierania. Ale nowe wiersze beda mialy 45 features.

**Rozwiazanie: zero-padding starych wierszy.**

```python
# W trainerze:
if len(feat) == 30:
    feat = feat + [0.0] * 15  # pad z zerami

# W predictorze (TypeScript):
if (features.length === 30) {
    paddedFeatures = [...features, ...new Array(15).fill(0)];
}
```

Dlaczego to dziala? Zero oznacza "brak pattern" — hammer=0, shooting_star=0, body_ratio=0, wick_skew=0. XGBoost traktuje to jak "ta swieczka nie miala zadnego wyraznego patternu". To NIE jest idealne (body_ratio=0 to nie "brak danych" tylko "doji"), ale jest wystarczajaco dobre — XGBoost sam nauczy sie ze stare wiersze maja inne rozklady tych features.

### Pipeline: collect → train → predict

```
xgboost_collect.py                    xgboost_train.py
┌──────────────────┐                 ┌──────────────────┐
│ tech (11)        │   JSONL file    │ Load JSONL       │
│ nansen (11)      │ ──────────────→ │ Pad 30→45        │
│ extra (8)        │  45 features    │ Train XGBoost    │
│ candle (15) NEW  │                 │ Save model JSON  │
└──────────────────┘                 └──────────────────┘
                                              │
                                              ▼
                                     XGBoostPredictor.ts
                                     ┌──────────────────┐
                                     │ Load model JSON  │
                                     │ Accept 30 OR 45  │
                                     │ Traverse trees   │
                                     │ Return probs     │
                                     └──────────────────┘
```

Kazdy etap musi byc backward compatible:
- **Collect** produkuje 45 features (nowe wiersze). Stare 30-feature wiersze juz w pliku.
- **Train** akceptuje 30 i 45, paduje stare. Model trenuje na 45 kolumnach.
- **Predict** akceptuje 30 i 45 feature vectors. Stare modele (trenowane na 30) dzialaja z nowymi 45-feature wektorami bo ekstra features = 0 = brak wplywu na istniejace drzewa.

### Lekcja: Feature Engineering vs Model Complexity

W ML czesto wazniejsze jest JAKIE features dasz modelowi niz JAK skomplikowany jest model. Nasz XGBoost ma proste parametry (max_depth=4, 100 drzew), ale teraz widzi:
- RSI mowi "oversold" (technical)
- SM mowi "SHORT dominant" (fundamental)
- **Hammer mowi "kupujacy odrzucili dno"** (price action) ← NOWE

Te 3 informacje razem daja duzo silniejszy sygnal niz kazda z osobna. XGBoost sam nauczy sie waznych interakcji — np. "hammer + oversold + SM neutral = silny sygnal kupna".

### Lekcja: Deploy bez downtime

Zmienilismy format danych z 30 na 45 features. Gdybysmy po prostu zmienili `assert len(features) == 45` bez backward compat, to:
1. Trainer by odrzucil 480 istniejacych wierszy ("expected 45, got 30")
2. Predictor by odrzucil feature vectors z callersow ktore jeszcze nie zaktualizowaly
3. Stare modele (trenowane na 30 features) by crashowaly na 45-feature input

Backward compatibility to nie opcja — to **wymog produkcyjny**. Zawsze pytaj sie: "co sie stanie ze starymi danymi?"

---

## Rozdzial 26: Multi-day Trend Features — "Model widzi szerszy obraz" (28.02.2026)

### Problem: Model byl krotkowzroczny

Nasz XGBoost mial max lookback **24 godziny** (`change_24h`). Wyobraz sobie tradera ktory patrzy TYLKO na wykres 1-dniowy — nie widzi ze od 2 tygodni rynek spada. Dokladnie to robil nasz model.

kPEPE spadl 14% w 7 dni (od 13 lutego). BTC spadl 9% od local high. Model tego nie widzial — patrzyl na ostatnie 24h i mowil "dzis spadlo 2%, moze jutro odbije?". Nie mial pojecia o kontekscie.

To jak pytanie meteorologa o pogode na jutro, ale zabranianie mu patrzenia na mapy pogody z ostatniego tygodnia.

### Rozwiazanie: Daily candles jako nowe zrodlo danych

Do tej pory collector fetchowal **100 hourly candles** (100 × 1h = ~4.2 dni). Za malo na 7-10 dniowy lookback. Dodalismy osobny fetch **14 daily candles** z Hyperliquid API — to daje 14 dni historii w zaledwie 14 punktach danych.

4 nowe features:

```
[45] change_7d         — "ile spadlismy/wzroslismy w 7 dni?"
[46] change_10d        — "ile w 10 dni?"
[47] dist_from_7d_high — "jak daleko jestesmy od 7-dniowego szczytu?"
[48] trend_slope_7d    — "nachylenie linii trendu: ostro w dol, plasko, czy w gore?"
```

### Co te features mowia (live dane z 28.02)

```
BTC (cena $63,777):
  change_7d:     -0.19  (spadek ~5.7% w tydzien)
  change_10d:    -0.10  (spadek ~5% w 10 dni)
  dist_from_high: -0.89 (8.9% ponizej 7-dniowego szczytu)
  trend_slope:   -0.76  (silny trend spadkowy)

kPEPE (cena $0.0035):
  change_7d:     -0.42  (spadek ~14% w tydzien!)
  change_10d:    -0.33  (spadek ~15%)
  dist_from_high: -1.00 (>10% ponizej szczytu — SATURATED)
  trend_slope:   -1.00  (ekstremalny downtrend — SATURATED)
```

**"Saturated"** znaczy ze wartosc osiagnela limit normalizacji (tanh). -1.00 = "maksymalnie bearish". Model wie: "to nie jest zwykly spadek, to crash".

### Linear Regression jako miernik trendu

`trend_slope_7d` uzywa **prostej regresji liniowej** — dopasowuje prosta linie do 7 zamkniec dziennych i mierzy nachylenie.

```
Cena ($)
  |  ·                    Slope = -0.76
  |    ·                  (silny spadek)
  |      ·
  |        ·  ·
  |              ·
  |                ·
  +---+---+---+---+---+---+---→ Dni
  1   2   3   4   5   6   7
```

Dlaczego regresja a nie prosty `(cena_teraz / cena_7d_temu - 1)`? Bo prosta roznica nie widzi KSZTALTU trendu:
- "Spadl 10% w 7 dni" moze znaczyc: spadal codziennie po 1.5% (trend) ALBO spadl 10% w 1 dzien i teraz stoi (spike)
- Slope rozroznia te sytuacje — rowny spadek daje wiekszy |slope| niz jednorazowy spike

### Backward Compatibility — trzeci raz ten sam pattern

To juz trzecia iteracja: 30→45→49. Schemat sie powtarza:

```
 Wersja  │ Features │ Padding (trainer + predictor)
─────────┼──────────┼──────────────────────────────
 v1      │ 30       │ +19 zer (15 candle + 4 multi-day)
 v2      │ 45       │ +4 zera (4 multi-day)
 v3      │ 49       │ brak paddingu (current)
```

Stare modele (trenowane na 45 features) dzialaja ze slowem "brak danych" (zeros) na nowych features. Po retrainie XGBoost zacznie korzystac z nowych 4 kolumn.

### Lekcja: Feature Groups i ich horyzonty

Teraz nasz model ma 5 grup features z roznym "zasiegiem":

```
Grupa           │ Lookback │ Features │ Co widzi
────────────────┼──────────┼──────────┼─────────────────────
Technical       │ ~60h     │ 11       │ RSI, MACD, ATR
Nansen/SM       │ Snapshot │ 11       │ Kto shortuje, kto longuje
Extra           │ 12h      │ 8        │ Funding, OI, pora dnia
Candle Patterns │ 3h       │ 15       │ Hammer, engulfing, doji
Multi-day Trend │ 10 dni   │ 4        │ ← NOWE: szeroki kontekst
```

Model teraz widzi od **3 godzin** (candle patterns) do **10 dni** (multi-day trend). To daje mu pelniejszy obraz — krotkoterminowe patterns w kontekscie dlugoterminowego trendu.

Analogia: Jak lekarz ktory patrzy na wynik badania z dzisiaj (candle pattern), ale tez na historie choroby z ostatniego miesiaca (multi-day trend). Samo dzisiejsze badanie moze byc mylace bez kontekstu.

---

## Rozdzial 27: BTC Cross-Market Features — "Model widzi co robi kapitan" (28.02.2026)

### Problem: Kazdy token zyl w bance

kPEPE model widzial TYLKO swoje dane — swoj RSI, swoj MACD, swoje candle patterns. Nie mial pojecia co robi BTC. A w krypto jest niepisana zasada:

> **Gdy BTC spada, spada WSZYSTKO.**

kPEPE ma **95% korelacje z BTC** (Pearson, 24h). ETH 98%. SOL 98%. To nie przypadek — altcoiny sa "dlugatorem" BTC. Wyobraz sobie tradera altcoinow ktory NIGDY nie patrzy na wykres BTC. Dokladnie to robil nasz model.

### Rozwiazanie: BTC jako "kapitan rynku"

Dodalismy 4 features ktore daja kazdemu tokenowi kontekst BTC:

```
[49] btc_change_1h       — "BTC spadl 2% w ostatnia godzine"
[50] btc_change_4h       — "BTC spada od 4h"
[51] btc_rsi             — "BTC jest oversold (RSI 26)"
[52] btc_token_corr_24h  — "kPEPE koreluje z BTC w 95%"
```

### Pearson Correlation — matematyka w 30 sekund

Korelacja Pearsona mierzy "jak bardzo dwa szeregi danych poruszaja sie razem":

```
Korelacja = +1.00  →  doskonale razem (BTC +1% = token +1%)
Korelacja =  0.00  →  brak zwiazku
Korelacja = -1.00  →  doskonale odwrotnie

Nasze wyniki (live, 28.02):
  kPEPE ↔ BTC:  0.95  ← prawie identycznie!
  ETH   ↔ BTC:  0.98  ← prawie doskonale
  SOL   ↔ BTC:  0.98
```

Jak to obliczamy? Bierzemy 24 ostatnie hourly returny (% zmiana) BTC i tokena, i liczymy **co-variance / (odchylenie BTC × odchylenie tokena)**. Wynik jest od -1 do +1.

### Dlaczego BTC sam dostaje zera?

Dla BTC samego te features = `[0, 0, 0, 0]`. Dlaczego? Bo `btc_change_1h` bylby taki sam jak istniejacy `change_1h` (feature [4]). `btc_rsi` = `rsi` (feature [0]). Redundancja nie pomaga modelowi — dodaje szum.

### Architektura: "Fetch once, share everywhere"

BTC candles sa fetchowane **jeden raz** w `main()` i przekazywane do kazdego `collect_token()`:

```python
# main():
btc_candles = fetch_candles("BTC", "1h", 100)  # ← jeden fetch

for token in TOKENS:
    collect_token(token, mids, meta_ctx, btc_candles)  # ← wspoldzielone
```

To oszczedza API calls — zamiast 9 razy fetchowac BTC candles (raz per token), robimy to raz. Dobra praktyka: **nie fetchuj tych samych danych wielokrotnie**.

### Pelna mapa features (53) — 6 grup

```
Grupa           │ Lookback │ Features │ Indeksy  │ Co widzi
────────────────┼──────────┼──────────┼──────────┼────────────────────
Technical       │ ~60h     │ 11       │ [0-10]   │ RSI, MACD, ATR, changes
Nansen/SM       │ Snapshot │ 11       │ [11-21]  │ Kto shortuje, kto longuje
Extra           │ 12h      │ 8        │ [22-29]  │ Funding, OI, pora dnia
Candle Patterns │ 3h       │ 15       │ [30-44]  │ Hammer, engulfing, doji
Multi-day Trend │ 10 dni   │ 4        │ [45-48]  │ Trend 7d/10d, slope
BTC Cross       │ 24h      │ 4        │ [49-52]  │ ← NOWE: co robi kapitan
```

### Lekcja: Cross-Asset Features

W tradycyjnym finance to sie nazywa **factor investing** — uzywanie informacji z jednego assetu do predykcji innego. Np:
- Ropa w gore → airlines w dol (cross-asset)
- S&P 500 w gore → VIX w dol (inverse correlation)
- USD w gore → Gold w dol (macro factor)

W krypto BTC jest **dominujacym faktorem** — single stock (BTC) wplywa na caly rynek. Dodanie BTC features to jak powiedzenie modelowi: "hej, zanim predyktujesz kPEPE, sprawdz co robi BTC — bo w 95% przypadkow kPEPE robi to samo".

### Backward Compatibility — czwarty raz

Pattern sie powtarza, ale teraz mamy 4 wersje danych w jednym pliku:

```
 Wersja  │ Features │ Padding
─────────┼──────────┼────────────────────
 v1 (stare) │ 30    │ +23 zer
 v2 (candle) │ 45   │ +8 zer
 v3 (multiday) │ 49  │ +4 zera
 v4 (btc cross) │ 53 │ brak (current)
```

Kazda iteracja dodaje nowa warstwe padding. To dziala, ale jesli dodamy jeszcze 10 wersji, stanie sie nieczytelne. W przyszlosci rozwazymy **wersjonowanie datasetu** zamiast padding — nagłowek z wersja + automatyczna migracja. Ale na teraz padding jest prosty i dziala.

---

## Chapter 28: Tier-1 Features — Orderbook, MetaCtx i Derived (53→62)

### Problem: model widzi przeszlosc, nie przyszlosc

Wyobraz sobie ze prowadzisz samochod patrzac TYLKO w lusterko wsteczne. Widzisz gdzie byles (RSI, MACD, zmiany cen), ale nie widzisz co jest przed toba. To dokladnie sytuacja naszego modelu przed ta zmiana.

**RSI mowi:** "cena spadla duzo w ostatnich 14 godzinach"
**MACD mowi:** "momentum jest negatywny"
**Orderbook mowi:** "80% orderow w orderbooku to SELL — zaraz spadnie jeszcze bardziej"

Roznica? RSI i MACD patrza WSTECZ. Orderbook patrzy DO PRZODU — widzi presje ktora jeszcze sie nie zmaterializowala w cenie.

### 3 grupy nowych features

#### Grupa A: Orderbook (L2 data) — jedyny leading indicator

```python
# Hyperliquid API:
POST {"type": "l2Book", "coin": "kPEPE"}
# Zwraca: {"levels": [[bidy...], [aski...]]}
# Kazdy level: {"px": "0.0035", "sz": "150000", "n": 3}
```

3 features:

**[53] `bid_ask_imbalance`** — stosunek bid vs ask depth w top 5 levelach
```
imbalance = (bid_depth - ask_depth) / (bid_depth + ask_depth)
```
- **+0.48** (BTC live) = 74% bidow → rynek chce kupowac → bullish
- **-0.80** (ETH live) = 90% askow → rynek chce sprzedawac → bearish
- **-0.04** (kPEPE) = rownowaga → brak sygnalu

To jak patrzenie na kolejke w sklepie — jesli 80% ludzi stoi w kolejce do kasy "SPRZEDAJ", wiesz ze cena spadnie zanim to sie stanie.

**[54] `spread_bps`** — jak szeroki jest spread bid-ask
- BTC: 0.15 bps (ultra tight — duza plynnosc)
- kPEPE: 2.9 bps (szerszy — mniejsza plynnosc)

Ciasny spread = duzo zainteresowania, rynek jest "zdrowy". Szeroki spread = nikt nie chce handlowac, potencjalny problem.

**[55] `book_depth_ratio`** — depth / 24h volume
- Ile plynnosci jest w orderbooku wzgledem dziennego obrotu
- kPEPE: 0.044 (4.4% dziennego volumenu w booku) — relatywnie plytki

#### Grupa B: MetaCtx — dane z istniejacego API (zero nowych callek!)

Te dane JUZ mielismy — `metaAndAssetCtxs` zwraca `markPx`, `oraclePx`, `premium`, `dayNtlVlm`. Po prostu ich nie uzywalismy!

**[56] `mark_oracle_spread`** — roznica miedzy cena perpa a spotem
```
spread = (markPx - oraclePx) / oraclePx × 100
```
- Ujemny = perp tanszy niz spot = BEARISH (traderzy shortuja perpa)
- Dodatni = perp drozszy niz spot = BULLISH (traderzy longuja perpa)
- BTC: -0.07 → perp z dyskontem → bearish pressure

**[57] `oi_normalized`** — Open Interest / dzienny volume
```
oi_norm = OI / (volume_24h × 10)
```
- kPEPE: **1.0 (capped!)** — OI jest 10x wieksze niz dzienny volume
- To znaczy: rynek jest EKSTREMALNIE overleveraged
- Duzy OI/volume = duzo "nabojow" do liquidation cascade
- Analogia: to jak widziec ze wszystkie samochody na autostradzie jadą 200 km/h — jesli jeden zahamuje, bedzie karambol

**[58] `predicted_funding`** — premium (napedza nastepny funding rate)
```
pred_funding = tanh(premium × 1000)
```
- BTC: -0.58 → negatywny funding → shorty placa longom
- Extreme funding = pozycje beda zamykane → mean reversion

#### Grupa C: Derived — obliczane z istniejacych candles

Zero API calls — czysta matematyka na danych ktore juz mamy.

**[59] `volume_momentum`** — czy volume przyspiesza czy zwalnia
```
ratio = sum(volume_last_4h) / sum(volume_prev_4h)
norm = tanh(ratio - 1.0)  # center around 0
```
- BTC: +1.0 → volume EKSPLODOWAL w ostatnich 4h vs poprzednich
- FARTCOIN: -0.05 → volume stabilny

**[60] `price_acceleration`** — druga pochodna ceny
```
change_now = (close[-1] - close[-2]) / close[-2]
change_prev = (close[-2] - close[-3]) / close[-3]
acceleration = change_now - change_prev
```
- Ujemny = cena zwalnia (momentum slabnie)
- Dodatni = cena przyspiesza (momentum rosnie)
- Pierwsza pochodna (MACD) mowi "cena spada". Druga pochodna mowi "CZY spadek przyspiesza czy zwalnia?"

**[61] `volume_price_divergence`** — gdy volume i cena ida w rozne strony
```
divergence = -(price_change × volume_change)
```
- Volume UP + Price DOWN = bearish divergence (sprzedaz pod volume)
- Volume UP + Price UP = bullish confirmation (kupno z conviction)
- Volume DOWN + Price UP = bearish warning (rally bez paliwa)

### Dlaczego to dziala razem

```
Model PRZED (53 features):
  "RSI=25, MACD negatywny → cena spadla" (patrzy wstecz)

Model PO (62 features):
  "RSI=25, MACD negatywny → cena spadla" (wstecz)
  + "Orderbook: 80% askow → dalej spadnie" (przod)
  + "OI/volume=10x → overleveraged → cascade risk" (strukturalny)
  + "Volume spike + price flat → divergence → cos sie szykuje" (momentum)
```

Model dostaje obraz 3D zamiast 1D:
1. **Co sie stalo** (technical indicators)
2. **Co sie zaraz stanie** (orderbook pressure)
3. **Jak niebezpieczny jest rynek** (leverage + divergence)

### Backward compatibility — piata wersja

```
 Wersja  │ Features │ Padding
─────────┼──────────┼────────────────────
 v1 (stare)     │ 30 │ +32 zer
 v2 (candle)    │ 45 │ +17 zer
 v3 (multiday)  │ 49 │ +13 zer
 v4 (btc cross) │ 53 │ +9 zer
 v5 (tier-1)    │ 62 │ brak (current)
```

### API budget

```
PRZED (53 features):
  9 hourly candles + 9 daily candles + 1 BTC hourly + 2 global = ~21 calls

PO (62 features):
  + 9 l2Book calls (1 per token) = ~30 calls

Rate limit: Hyperliquid pozwala ~120 calls/min
Nasz collector: ~30 calls co 15 min = ~2 calls/min — daleko od limitu
```

---

## XGBoost Backfiller — 180 dni historii w 5 minut

### Problem: cold start ML

Wyobraz sobie, ze budujesz samochod autonomiczny. Masz swietne kamery, lidar, radar — ale samochod dopiero zjezdza z linii produkcyjnej. Ma zero kilometrow doswiadczenia. Pierwsze 1000 km jedzie jak pijany — nie zna zakretow, nie wie ze mokra droga jest sliska, nie rozumie ze ten migajacy swiatlo na skrzyzowaniu to znaczy "zwolnij, nie przyspieszaj".

Nasz XGBoost model mial dokladnie ten problem. Collector (cron co 15 min) zbiera dane od 6 dni = **500 wierszy per token**. Model potrzebuje tysiecy przykladow zeby sie nauczyc. Czekanie na "naturalne" zebranie danych trwaloby miesiace.

### Rozwiazanie: podroz w czasie

Co jesli zamiast czekac 6 miesiecy, mozemy **cofnac sie w czasie** i uczyc sie z przeszlosci?

Hyperliquid API ma `candleSnapshot` — zwraca historyczne swiece (OHLCV) na dowolny okres. Czyli mamy ceny, wolumen, high/low co godzine od kiedy token istnial.

Z jednej godzinnej swiece mozemy obliczyc:
- RSI, MACD, ATR — **tak** (potrzebne min 14 poprzednich swiec)
- Candlestick patterns (hammer, doji) — **tak** (potrzebne 3 ostatnie swiece)
- Multi-day trends (change_7d, slope) — **tak** (potrzebne daily candles)
- BTC correlation — **tak** (potrzebne BTC candles + token candles)
- Nansen SM data — **NIE** (to jest live snapshot, nie da sie odtworzyc)
- Orderbook depth — **NIE** (L2 book nie jest archiwizowany)
- Funding rate, OI — **NIE** (metadane perpow nie sa archiwizowane)

Czyli z 62 features mozemy obliczyc **38 historycznie**, a 24 ustawiamy na zero.

### Ale zaraz — labels!

Tu jest magia backfillera vs collectora. Collector nie zna przyszlosci — wpisuje label dopiero po N godzinach:

```
Collector (15:00):  features=[...], label_h1=NULL (nie wie co bedzie o 16:00)
Collector (16:00):  ooo, cena wzrosla! Wraca do wiersza z 15:00, wpisuje label_h1=+0.8%
```

Backfiller ma **cala przyszlosc** w tablicy candles:

```python
# Patrzymy na indeks 100 (= godzina 100 od poczatku)
current_price = candles[100].close  # $63,000
future_1h = candles[101].close      # $63,500
future_4h = candles[104].close      # $64,200

label_h1 = (63500 - 63000) / 63000 = +0.79%  → LONG
label_h4 = (64200 - 63000) / 63000 = +1.90%  → LONG (>1.5%)
```

Backfiller wie jak sie skonczylo — bo patrzymy wstecz.

### Deduplikacja — nie duplikuj danych

Collector juz zapisal ~500 wierszy per token. Backfiller nie moze pisac tych samych timestampow — model by sie "uzczyl" powtorzen zamiast wzorcow.

```python
existing_timestamps = set()
for line in existing_jsonl:
    ts = round(line['timestamp'] / 3600) * 3600  # zaokraglij do pelnej godziny
    existing_timestamps.add(ts)

# Skip jesli juz mamy ten timestamp
if candle_ts in existing_timestamps:
    continue  # pomiń, już jest
```

### Sortowanie — czas ma znaczenie

Po dopisaniu backfill rows, caly dataset musi byc posortowany chronologicznie. Dlaczego?

Trainer robi **80/20 chronological split** — pierwsze 80% to train, ostatnie 20% to test. Jesli dane sa pomieszane (stary, nowy, stary, nowy), model "widzi przyszlosc" w train secie i dostaje falszywie wysoki accuracy.

```python
# Sortuj po timestamp
all_rows.sort(key=lambda r: r['timestamp'])
# Zapisz posortowany dataset
with open(filepath, 'w') as f:
    for row in all_rows:
        f.write(json.dumps(row) + '\n')
```

### Wyniki — 9x wiecej danych

```
PRZED backfill:     4,460 rows total (~500/token, 6 dni)
PO backfill:       39,001 rows total (~4,600/token, 180 dni)
```

Ale nie chodzi tylko o ilosc. BTC model z 500 wierszami widzial **jeden tydzien** rynku. Z 4,600 wierszami widzi:
- Crash pazdziernikowy ($126K → $103K)
- Rally listopadowy ($86K → $105K)
- Kolejne spadki grudniowe
- Dno styczniowe ($55K)

### Training improvement

| Token | h4 (przed) | h4 (po) | h12 (przed) | h12 (po) |
|-------|-----------|---------|-------------|---------|
| BTC | ~55% | **77.1%** | ~65% | **84.1%** |
| kPEPE | 35.3% | **58.0%** | ERROR | **62.2%** |
| ETH | ~50% | **67.9%** | ~55% | **69.6%** |

kPEPE h12 nie mogl sie wytrenowac z 139 wierszami (zero klasy LONG w test set → crash). Z 4,379 wierszami — **62.2% accuracy**. Nie cudownie, ale **dobrze ponad random (33%)** na 3-class problem.

### Top features shift — dowod ze backfill dziala

Przed backfill, top features to: `bb_width`, `volatility_24h`, `hour_cos` — krotkoterminowe, techniczne.

Po backfill: `trend_slope_7d`, `dist_from_7d_high`, `change_10d` — **multi-day trend features**!

To dowod ze model uczy sie prawdziwych wzorcow z historii (np. "jesli kPEPE spadla 15% w 7 dni, to prawdopodobnie spadnie dalej").

### Lekcje

1. **Cold start to zabojca ML** — model z 500 wierszami to jak student po pierwszym wykladzie. Backfill to odrobienie 180 wykładów jednego dnia.

2. **Nie wszystkie features sa historyczne** — 24/62 features (SM data, orderbook, funding) to runtime-only. Model uczy sie z 38/62 features w historii, potem dostaje pelne 62 w produkcji. To **nie problem** — XGBoost wie ze te 24 features sa zerami w starych danych i nauczy sie ich wartosci tylko z nowych (live-collected) wierszy.

3. **Deduplikacja + sortowanie = kluczowe** — bez tego model by sie nauczyl powtorzen (overfitting) albo "widzial przyszlosc" (data leakage). Oba zabijaja predykcje w produkcji.

4. **Rate limiting API** — Hyperliquid API robi 429 (Too Many Requests) jesli za szybko pytasz. LIT dostal 429 przy pierwszym run, trzeba bylo ponowic. Rozwiazanie: 2-sekundowy delay miedzy fetchami i pagination (max 5000 candles per request).

5. **Token age matters** — LIT ma tylko 68 dni historii na Hyperliquid (token nowy). BTC/ETH/SOL maja pelne 180 dni. Wiecej historii = lepszy model. LIT h4 accuracy 34.5% vs BTC h4 77.1% — nie tylko z powodu mniej danych, ale tez dlatego ze LIT jest bardziej losowy (memecoin effect).

### Kiedy re-backfillowac?

**Nie musisz.** Backfill jest one-shot operation. Nowe dane sa zbierane przez collector co 15 min (z pelnymi 62 features). Retrain co tydzien (`xgboost_train.py`) automatycznie wlacza nowe dane.

Re-backfill tylko jesli:
- Zmienisz feature pipeline (nowe features do policzenia z candles)
- Chcesz dluzsza historie (np. `--days 365` gdy token ma roczna historie)
- Dodasz nowy token do systemu

---

## Rozdzial 32: XGBoost Flat Tree Fix — Kiedy Model Mowi "Nie Wiem" Na Wszystko

### Problem: 33.3% / 33.3% / 33.3%

Wyobraz sobie ze masz super-zaawansowany ML model wytrenowany na 39,000 wierszach danych, z 62 features, 300 drzewami decyzyjnymi... i na kazde pytanie odpowiada "nie wiem" (rowne prawdopodobienstwo dla kazdej klasy).

To dokladnie co sie stalo. XGBoost predictions zwracaly **identyczne** 33.3% na SHORT/NEUTRAL/LONG dla KAZDEGO tokena, KAZDEGO horyzontu. Kompletnie bezuzyteczne.

### Dwa niezalezne bugi (Double Whammy)

To byl rzadki przypadek gdzie **dwa rożne bugi** produkowaly ten sam symptom. Naprawienie jednego NIE wystarczylo — trzeba bylo znalezc i naprawic oba.

#### Bug #1: Feature Vector Mismatch (30 vs 62)

TypeScript `getXGBPrediction()` budowal 30-feature vector (11 tech + 11 nansen + 8 extra). Ale modele byly wytrenowane na **62 features**. Co sie dzieje z brakujacymi 32 features? Predictor je padduje zerami.

Problem: top features modelu (te ktore najbardziej wplywaja na decyzje) to `trend_slope_7d` (indeks [48]), `dist_from_7d_high` ([47]), `change_10d` ([46]) — wszystkie w zakresie [30-61], czyli **wszystkie zero**.

To jak pytac doktora o diagnoze ale nie mowic mu wynikow badania krwi — moze miec najlepsza wiedze na swiecie, ale bez danych nie ma co oceniac.

**Fix**: Python collector (ktory ma pelne 62 features) zapisuje je do pliku `/tmp/xgboost_latest_{TOKEN}.json`. TypeScript czyta ten plik zamiast budowac wlasny (niekompletny) vector. Prosty bridge pattern.

#### Bug #2: XGBoost 3.x Flat Tree Format

Nawet po naprawieniu featurow — nadal 33.3%. WTF?

Okazalo sie ze XGBoost 3.x (zainstalowany na serwerze) eksportuje modele w zupelnie innym formacie niz XGBoost 1.x:

```
XGBoost 1.x (stary, nested):
{
  "nodeid": 0,
  "split": 48,
  "split_condition": 0.5,
  "yes": 1, "no": 2,
  "children": [
    {"nodeid": 1, "leaf": 0.123},
    {"nodeid": 2, "leaf": -0.456}
  ]
}

XGBoost 3.x (nowy, flat arrays):
{
  "split_indices": [48, 0, 0],
  "split_conditions": [0.5, 0, 0],
  "left_children": [1, -1, -1],
  "right_children": [2, -1, -1],
  "base_weights": [0.0, 0.123, -0.456]
}
```

Nasz TypeScript traversal szukal `tree.split`, `tree.children`, `tree.nodeid` — ale te pola **nie istnialy** w flat format! Kazde drzewo zwracalo `0` (safety fallback). 300 drzew × `0` = `softmax([0, 0, 0])` = `[0.333, 0.333, 0.333]`.

**Fix**: Dodano `isFlatTree()` detector i `traverseFlatTree()` — odczytuje flat arrays, leaf nodes to `left_children[i] === -1`, leaf values w `base_weights[i]`.

### Debugging journey

To bylo jak sledztwo kryminalne:

1. **Podejrzany #1: Feature mismatch** — znaleziony szybko, naprawiony. Ale symptom sie nie zmienil.
2. **Podejrzany #2: Tree format** — znaleziony dopiero po recznym teście w Node.js: `Raw scores: [0.000000, 0.000000, 0.000000]`. Zbadanie jednego drzewa z modelu: `{"split_indices": [...], "left_children": [...]}` — aha!
3. **Bonus bug: Python patcher stripped quotes** — patch ktory mial naprawic dist plik na serwerze zamienil `'split_indices' in tree` na `split_indices in tree` → `ReferenceError`. Naprawiony sedem.

### Wyniki po fixie

```
PRZED (broken):
kPEPE h1: SHORT 33.3% / NEUTRAL 33.3% / LONG 33.3%  ← useless
BTC   h4: SHORT 33.3% / NEUTRAL 33.3% / LONG 33.3%  ← useless

PO (working):
kPEPE h1: SHORT 34.0% / NEUTRAL 35.3% / LONG 30.7%  ← differentiated!
BTC   h4: SHORT 15.9% / NEUTRAL 31.5% / LONG 52.6%  ← strong signal!
ETH   h4: SHORT 63.0% / NEUTRAL 31.9% / LONG 5.1%   ← very bearish!
```

### Lekcje

1. **Jeden symptom, dwa bugi** — najgorszy rodzaj debugowania. Naprawiasz jedno, symptom sie nie zmienia, myslisz ze fix nie dzialal. W rzeczywistosci dzialal, ale drugi bug maskuje efekt. Zawsze testuj fix IZOLOWANY.

2. **Wersje bibliotek zmieniaja formaty** — XGBoost 1.x vs 3.x to jak JSON vs XML. Ten sam model, kompletnie inny format eksportu. Jesli twoj kod parsuje output biblioteki — **sprawdz jaka wersje masz na produkcji**.

3. **Feature file bridge > recomputing** — zamiast zmuszac TypeScript do obliczania 62 features (pol z nich wymaga API calls), lepiej niech Python (ktory juz je ma) zapisze do pliku. Prosciej, bezbledniej, zero duplikacji logiki.

4. **`softmax([0,0,0])` = [0.333, 0.333, 0.333]** — uniforme wyjscie z softmax jest ZAWSZE czerwona flaga. Znaczy ze model nic nie obliczyl (wszystkie raw scores = 0). Dodaj assert/warning na to!

5. **Dist patching to minefield** — Python script ktory patchuje JavaScript dist pliki na serwerze jest kruchy. Stripuje quotes, zmienia formatting, gubi edge cases. Lepsze rozwiazanie: `tsc` compile lokalne + SCP dist, lub budowanie Docker image.

---

## Rozdzial 33: XGBoost Training Tuning — Kiedy "58% Accuracy" To Klamstwo

### Problem: Iluzyjna Celnosc

Wyobraz sobie ze masz model pogodowy ktory mowi "jutro bedzie pogodnie" codziennie. W Kalifornii mialbys 85% accuracy. Ale to nie jest inteligentny model — to model ktory nauczyl sie ze "pogodnie" jest domyslna odpowiedzia i powtarza ja jak papuga.

Dokladnie tak dzialal nasz XGBoost dla kPEPE h4. Mial "58% accuracy" co wygladalo przyzwoicie. Ale prawda:
- 67% etykiet = NEUTRAL (cena zmienila sie o < ±1.5% w 4h)
- Model nauczyl sie: "zawsze mow NEUTRAL" → 58% trafien
- **Zero przewagi** nad prostym "zawsze mow NEUTRAL"

To sie nazywa **accuracy illusion** — jeden z najczescszych bledow w ML. Accuracy jest bezuzyteczna gdy klasy sa niezbalansowane.

### Dlaczego 67% Neutral?

Progi klasyfikacji (thresholds) byly jednakowe dla WSZYSTKICH tokenow:
- h4 threshold: ±1.5% (zmiana ceny > +1.5% = LONG, < -1.5% = SHORT)

Ale kPEPE jest memcoinem! Mediana ruchu h4 to ~1.0%. Wiec wiekszosc ruchow miescila sie w -1.5% do +1.5% → NEUTRAL. Model nie widzial prawie zadnych LONG/SHORT przykladow.

### Fix 1: Per-token Thresholds

Rozwiazanie jest oczywiste po zrozumieniu problemu — obniz progi dla volatilnych tokenow:

```python
TOKEN_THRESHOLDS = {
    "kPEPE": {"h4": 0.008},   # ±0.8% zamiast ±1.5%
    "FARTCOIN": {"h4": 0.010}, # ±1.0%
    # BTC/ETH dalej ±1.5% — sa mniej volatilne
}
```

Po obnizeniu: 30% SHORT / 43% NEUTRAL / 27% LONG. Teraz model widzi prawdziwe przyklady!

### Fix 2: Class Weighting

Nawet z lepszymi progami NEUTRAL moze dominowac (43%). Rozwiazanie: **inverse frequency weighting**:

```python
def compute_sample_weights(y):
    # Klasa z 1000 probkami: weight = 0.33
    # Klasa z 100 probkami: weight = 3.33  (10x wieksza waga!)
    weights[y == cls] = total / (num_classes * count)
```

Model uczy sie ze bledne SHORT (rzadkie) kosztuje wiecej niz bledne NEUTRAL (czeste). Analogia: w szpitalu przeoczenie raka (rzadki) jest gorsze niz fatszywy alarm (czesty).

### Fix 3: Regularyzacja i Early Stopping

Po naprawieniu thresholds model zaczal **overfittowac** — zapamietal dane treningowe zamiast sie uczyc wzorcow:
- Train accuracy: 90%
- Test accuracy: 37% (gorzej niz random!)

To jak student ktory wyuczyl sie odpowiedzi z egzaminu probnego zamiast zrozumiec material.

**Regularyzacja** (kary za zlozonosc):
- `max_depth: 4 → 3` — plytsze drzewa, mniej szansy na zapamiectywanie
- `min_child_weight: 5 → 10` — liscie potrzebuja wiecej przykladow
- `colsample_bytree: 0.8 → 0.5` — losuj 50% features (bo 30/62 = martwe!)
- `reg_alpha=0.1, reg_lambda=2.0` — L1/L2 penalties

**Early stopping**: Trenuj max 300 drzew, ale zatrzymaj jesli test accuracy nie poprawia sie przez 30 rund. kPEPE h4 zatrzymal sie na 79/300 — 74% drzew bylo zbedne!

### Wyniki

```
PRZED: kPEPE h4 = "58%" (iluzyjna, baseline 58%)
       train 90% vs test 37% (masywny overfitting)

PO:    kPEPE h4 = 40.4% (prawdziwa, baseline 33%)
       train 58.5% vs test 40.4% (zredukowany overfitting)
```

40% na 3-klasowym problemie z memcoinem to solidny wynik. Model ma +7.4% edge nad losowym zgadywaniem. BTC h4 ma 70% bo jest bardziej "przewidywalny" (fundamenty > memecoin vibes).

### Lekcje

1. **Accuracy bez kontekstu jest bezwartosciowa** — zawsze porownuj z baseline (najczescszja klasa). 58% przy baseline 58% = zero edge. 40% przy baseline 33% = +7.4% edge.

2. **Progi musza pasowac do volatilnosci** — kPEPE z ±1.5% h4 progiem to jak mierzyc temperacture termometrem ktory rozpoznaje tylko >40°C. Wiekszosc "choroby" przejdzie niezauwazenie.

3. **Overfitting to podstepny wrog** — train 90%/test 37% wyglada jak "model jest swietny ale test set jest zly". Nie — model zapamietal szum. Regularyzacja + early stopping to leki.

4. **Inverse frequency = sprawiedliwosc** — bez tego model optymalizuje accuracy (= predict majority class). Z tym model optymalizuje REAL accuracy (= trafienie kazdej klasy proporcjonalnie).

5. **Dead features sa toksyczne** — 30/62 features = 0 to nie "neutralne", to szum. `colsample_bytree=0.5` pomaga bo losowo pomija wiele z nich w kazdym drzewie.

---

## Rozdzial 34: Accuracy Illusion — Kiedy "70% Accuracy" Jest GORSZE Niz Losowe Zgadywanie

*Albo: jak BTC h4 model udawal geniusza, a w rzeczywistosci byl gorszy niz moneta*

### "Houston, We Have a Problem" — Skala Iluzji

Po naprawieniu kPEPE (Rozdzial 33), zapytalismy: **czy inne tokeny maja ten sam problem?**

Odpowiedz: TAK, i to GORSZY.

| Token | h4 "Accuracy" | h4 NEUTRAL % | Baseline | **Real Edge** |
|-------|--------------|-------------|----------|---------------|
| **BTC** | 70.0% | **88%** | 88% | **-18%** (gorszy niz random!) |
| **ETH** | 56.7% | **79%** | 79% | **-22%** |
| **SOL** | 58.3% | **73%** | 73% | **-15%** |
| **XRP** | 58.4% | **76%** | 76% | **-18%** |
| kPEPE | 58.0% | 67% | 67% | -9% |

BTC h4 mial **najgorsza iluzje**: model mowil "NEUTRAL" w 88% przypadkow i osiagal "70% accuracy" — bo 88% etykiet BYLO NEUTRAL! To jak przepowiadanie pogody w Dubaju: "jutro bedzie slonecznie" — trafisz w 95% przypadkow, ale to nie jest zaden talent.

### Analogia: Termometr Kliniczny

Wyobraz sobie termometr ktory mierzy temperature ciala, ale ma skale:
- **Normalny**: 35-42°C
- **Goraczka**: > 42°C
- **Hipotermia**: < 35°C

Z taka skala 99% pacjentow to "normalny" — nawet z 39°C goraczka. Termometr wyglada na "99% dokladny" ale jest kompletnie bezuzyteczny.

Nasz XGBoost mial taki sam problem. Progi ±1.5% dla h4 to "termometr z za szerokim zakresem":

```
BTC h4 mediana ruchu: 0.44%
Prog: ±1.5%

Wiec ruch 0.44% (mediana!) → NEUTRAL
Ruch 1.0% (duzy jak na BTC!) → NEUTRAL
Ruch 1.4% (ogromny!) → NEUTRAL

Model: "NEUTRAL, NEUTRAL, NEUTRAL... oh patrz, 88% accuracy!"
```

### Fix: Progi Dopasowane do Kazdego Tokena

Kluczowe odkrycie: **kazdy token ma inna volatilnosc**. BTC rusza sie po 0.44% w 4h, kPEPE po 1.0%, ZEC po 1.6%. Jednakowe progi = nonsens.

Metoda kalibracji:
1. Oblicz mediany ruchow cenowych per token per horyzont
2. Ustaw prog na ~30-35 percentyl absolutnych zmian
3. Cel: ~35-40% etykiet NEUTRAL

```
BTC h4: mediana 0.44% → prog ±0.3% → 37% NEUTRAL (was 88%!)
ETH h4: mediana 0.60% → prog ±0.4% → 36% NEUTRAL (was 79%!)
SOL h4: mediana 0.79% → prog ±0.6% → 40% NEUTRAL (was 73%!)
XRP h4: mediana 0.68% → prog ±0.5% → 38% NEUTRAL (was 76%!)
kPEPE h4: mediana 1.0% → prog ±0.8% → 43% NEUTRAL (was 67%!)
```

### Rozkład Etykiet — Przed vs Po (Confusion Matrix)

Zobaczmy jak zmieniła sie dystrybucja klas:

#### BTC h4 (4648 samples):
```
PRZED (±1.5%): SHORT= 338( 7%)  NEUTRAL=4092(88%)  LONG= 218( 4%)
PO    (±0.3%): SHORT=1453(31%)  NEUTRAL=1748(37%)  LONG=1447(31%)
                                          -50pp !!
```

BTC przeszedl z "88% jednej klasy" do "31/37/31" — prawie idealny balans! Model teraz WIDZI prawdziwe ruchy cenowe.

#### kPEPE h4 (4364 samples):
```
PRZED (±1.5%): SHORT= 775(17%)  NEUTRAL=2926(67%)  LONG= 663(15%)
PO    (±0.8%): SHORT=1326(30%)  NEUTRAL=1878(43%)  LONG=1160(26%)
                                          -24pp
```

#### Porownanie DROP NEUTRAL across all tokens (h4):

```
Token    PRZED   PO     DROP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BTC      88%  →  37%    -50pp  ← NAJWIEKSZY spadek!
ETH      79%  →  36%    -41pp
XRP      76%  →  38%    -37pp
SOL      73%  →  40%    -33pp
kPEPE    67%  →  43%    -24pp
```

### Accuracy po Naprawie — Uczciwe Liczby

Po retrainingu ze skalibrowanymi progami:

| Token | Horizon | Accuracy | Baseline | **Edge** |
|-------|---------|----------|----------|----------|
| HYPE | h1 | 38.9% | 34% | **+4.7%** |
| SOL | h4 | 38.3% | 34% | **+4.2%** |
| ETH | h1 | 38.6% | 35% | **+3.5%** |
| FARTCOIN | h1 | 36.8% | 33% | **+3.4%** |
| kPEPE | h4 | 40.2% | 38% | **+2.4%** |
| BTC | h4 | 40.6% | 40% | +0.9% |

Liczby sa nizsze, ale **PRAWDZIWE**. 38.9% z baseline 34% = +4.7% edge. To realna przewaga!

Analogia: wczesniej miales "70% accuracy" w domowych pantofli na biezni (bieznia stala). Teraz masz "39% accuracy" ale na prawdziwej drodze (z gorkach, wiatrem, i innymi biegaczami). 39% na prawdziwej drodze > 70% na stojaco.

### Dlaczego w1/m1 Nie Dzialaja?

Ciekawe odkrycie: dlugie horyzonty (w1 = tydzien, m1 = miesiac) maja **negatywny edge** prawie dla kazdego tokena. Dlaczego?

**Temporal shift** — dane treningowe (180 dni backfill) obejmuja rozne "rezimy rynkowe":
- Sierpien-Pazdziernik 2025: BTC od $60K do $120K (bull run)
- Grudzien-Luty 2026: BTC od $120K do $60K (bear market)

Model wytrenowany na danych z bull runu probouje predyktowac bear market. To jak nauka jazdy w lecie i egzamin w srodku zimy na lodzie.

Fix nie jest prosty — potrzeba albo wiecej danych z aktualnego rezimu, albo features ktore opisuja rezim (np. "czy jestesmy w bull czy bear market?").

### Lekcje dla Inzynierow

1. **"Accuracy" bez baseline to klamstwo** — ZAWSZE licz: `edge = accuracy - majority_class_baseline`. Edge < 0 = model jest GORSZY niz random. Edge 0 = model nie uczy sie nic. Edge > 0 = realna wartosc.

2. **Progi klasyfikacji musza byc per-asset** — BTC i kPEPE nie zyja w tym samym swiecie volatilnosci. Globalny prog to lazy engineering.

3. **Sprawdzaj WSZYSTKIE tokeny, nie tylko problematyczny** — kPEPE nas zaalarmowalo, ale BTC mial GORSZY problem. Nieintuicyjne! "Bardziej przewidywalny" token mial wieksza iluzje bo jego ruch miesci sie w wezszym przedziale.

4. **Balansowanie klas to nie luksus, to koniecznosc** — Cel: 30-40% per klasa. Wyzej = model sie leniwi (predict majority). Nizej = za malo przykladow do nauki.

5. **Temporal shift to cichy zabojca** — model na danych historycznych moze doskonale pasowac do przeszlosci ale byc bezwartosciowy w terazniejszosci. Szczegolnie na dlugich horyzontach (w1/m1) gdzie rezim rynkowy zmienia sie szybciej niz model sie uczy.

---

## Rozdzial 35: XGBoost Performance Monitor — "Ile Zarabiamy Dzieki ML?" (28.02.2026)

### Problem: Skad wiesz, ze ML pomaga?

Masz ML model. Ladnie produkuje predykcje. Dashboard swiateczny. Ale jedno pytanie wisi w powietrzu jak cien nad baseballisty:

> "Czy ten model FAKTYCZNIE zarabia pieniadze, czy tylko ladnie wyglada?"

To jak zatrudnienie konsultanta za $10K/miesiac — mowci madrzejsze rzeczy, ale jak wiesz, ze firma zarobia WIECEJ przez niego? Potrzebujesz POMIARU, nie wizerunku.

### Jak mierzymy wplyw ML na bota?

Bot nie handluje "bo ML powiedzial". ML *delikatnie* przesuwa rozmiary orderow:
- BEARISH prediction → mniej kupuj (bid x0.92), wiecej shortuj (ask x1.08)
- BULLISH prediction → wiecej kupuj (bid x1.08), mniej shortuj (ask x0.92)

To jest "prediction bias" — soft +-15% adjustment na rozmiary. Pytanie: czy ten bias POMAGA zarabiac, czy SZKODZI?

### Formula atrybucji

```
strength = min(|predicted_change| / 3.0, 1.0)    // sila predykcji, 0-1
bias_on  = confidence >= 50% AND |change| >= 0.3% // czy bias w ogole dziala?

est_bps = direction_correct
  ? +|actual_move_bps| x strength x 0.125         // trafilismy → zysk
  : -|actual_move_bps| x strength x 0.125          // pudlo → strata
```

`0.125` to konserwatywna polowa teoretycznego 0.25 (theoretical max directional exposure z biasu). Dlaczego polowa? Bo:
- Nie wszystkie ordery sie filluja (partial fills)
- Inne moduly (Momentum Guard, Toxicity) tez wplywaja na rozmiary
- Lepiej niedoszacowac niz przeszacowac

### Co mierzy monitor?

Co godzine (cron `:00`):

1. **Zbiera predykcje** — fetchuje z prediction-api aktualny h4 forecast dla 9 tokenow
2. **Scoruje stare predykcje** — patrzy 1h wstecz (h1 window) i 4h wstecz (h4 window), porownuje z rzeczywista cena
3. **Oblicza estimated bps** — ile zarobil/stracil prediction bias na kazdym tokenie
4. **Wysyla raport na Discord** — z rolling stats (24h, 7d, all-time)

### Czytanie raportu

```
BTC       BEAR -0.73% (49%)        | XGB: NEUTRAL 35%    | off
SOL       BEAR -1.28% (52%)        | XGB: SHORT   35%    | ON
```

- `BEAR -0.73% (49%)` = Hybrid (rule-based + XGBoost blend) mowi: bearish, -0.73% predicted change, 49% confidence
- `XGB: SHORT 35%` = Sam XGBoost (pure ML) mowi: SHORT z 35% confidence
- `ON` / `off` = czy prediction bias jest aktywny (conf >= 50% AND |change| >= 0.3%)

SOL ma bias ON bo confidence 52% > 50% i |change| 1.28% > 0.3%. BTC ma bias off bo 49% < 50%.

### Dlaczego to wazne — lekcja inzynierska

**Kazdy system ML powinien miec monitoring wplywu.** Nie wystarczy trenowac model i mierzyc accuracy na test set. Musisz wiedziec ile model ZARABIA w produkcji.

Analogia: Masz GPS w samochodzie. GPS mowi "skrec w lewo". Mozesz zmierzyc:
- **Accuracy offline**: "GPS prawidlowo przewidzial korki w 70% przypadkow" ← to co robimy w xgboost_train.py
- **Impact online**: "Dzieki GPS dojezdzam srednio 8 minut szybciej" ← to co robi performance monitor

Mozesz miec GPS z 90% accuracy ktory codziennie prowadzi cie uliczkami zamiast autostrada, i GPS z 60% accuracy ktory czasem pudluje ale ogolnie oszczedza czas. **Impact > accuracy.**

### Architektura

```
prediction-api (:8090)     HL API (allMids)
       |                        |
       v                        v
  xgb_performance_monitor.ts
       |
       v
  /tmp/xgb_monitor_state.json  (7-day rolling)
       |
       v
  Discord webhook  ──→  #xgb-monitor channel
```

State file przechowuje max 7 dni danych (auto-trim). Dry-run (`--dry-run`) NIE zapisuje state — mozesz testowac bez ryzyka.

### Potencjalne pulapki

1. **"Survivor bias"** — scorujesz tylko predykcje ktore bot widzial. Jesli prediction-api padlo na godzine, ta godzina jest niewidoczna w stats.

2. **"Attribution is hard"** — `0.125` factor to przyblizone. Bot ma 8+ modulow ktore wplywaja na sizing jednoczesnie. Izolowanie wplywu ML jest z natury niedokladne.

3. **"Short-term noise"** — 24h stats beda skakac +50bps / -30bps. Dopiero 7d+ rolling daje wiarygodny obraz. Nie panikuj po jednym zlym dniu.

4. **"Correlation != causation"** — jesli ML mowi BEARISH i rynek spada, ale SM signals TEZ mowily SHORT (i bot podazal za SM), to ML nie "zarobil" — SM zarobilo. ML moze byc redundantne. Monitor tego nie odroznnia.

---

## Rozdzial 36: Usuniecie w1/m1 — Temporal Shift i dlaczego "wiecej" nie znaczy "lepiej"

### Problem: Model ktory patrzy zbyt daleko

Wyobraz sobie ze jestes taksowkarzem w Krakowie. Masz GPS ktory podpowiada ci skrecanie na najblizsych 3 skrzyzowaniach (h1, h4, h12). Dziala super.

Pewnego dnia ktos mowi: "hej, dodajmy prognozowanie ruchu na CALY TYDZIEN do przodu (w1) i CALY MIESIAC (m1)!". Brzmi madrzej, prawda? Wiecej danych = lepsze decyzje?

**Nie.** Oto dlaczego:

1. **Taksowkarz zarabia na TERAZ** — na nastepnym skrzyzowaniu, nie za tydzien. Bot MM zarabia na spreadzie h1-h4, nie na tygodniowych zakładach kierunkowych. Prognoza "BTC spadnie 5% w ciagu miesiaca" nie pomaga ci zdecydowac jaki spread ustawic TERAZ.

2. **Dane z przeszlosci = inny swiat** — nasz backfill siega 180 dni (polowa 2025). Wtedy rynek byl w fazie "akumulacji/nudy" — niski wolumen, male ruchy. Teraz (luty 2026) jestesmy w fazie "euforii/strachu" — ogromne ruchy, panika, liquidacje. Model w1/m1 uczyl sie na danych z INNEGO swiata.

To wlasnie jest **temporal shift** (przesuniecie czasowe) — model patrzy na stare dane i mysli "tak wygladal rynek", ale rynek sie zmienil. To jak uczyc kogos prowadzenia w lecie i oczekiwac ze bedzie dobrze jezdzic po lodzie.

### Dowody

Sprawdzilismy edge (przewage nad losowym zgadywaniem) dla w1/m1:

| Token | w1 edge | m1 edge | h4 edge |
|-------|---------|---------|---------|
| BTC | **-18%** (gorszy niz random!) | brak danych | +0.9% |
| ETH | -12% | -24% | +3.5% |
| SOL | -5% | +10% (podejrzane) | +4.2% |
| kPEPE | -8% | +15% (artifact: 1 klasa) | +2.4% |

w1 i m1 mialy **negatywny edge** dla wiekszosci tokenow. Model ktory jest gorszy niz rzut moneta to nie model — to szum.

### Co zrobilismy

Agresywna amputacja — kompletne usuniecie w1/m1 z calego pipeline:

```
PRZED:  h1 → h4 → h12 → w1 → m1    (5 horyzontow)
PO:     h1 → h4 → h12               (3 horyzonty)
```

7 plikow zmodyfikowanych, -66 linii kodu netto. Czyszczenie, nie dodawanie.

### Lekcja inzynierska: "Mniej znaczy wiecej"

W ML jest pokusa dodawania: wiecej features, wiecej horyzontow, wiecej danych. Ale kazda dodana zmienna moze byc **szumem** zamiast sygnalem. A szum jest gorszy niz brak danych, bo:

- Szum zuzywa pojemnosc modelu (drzewa decyzyjne maja ograniczona glebokosc)
- Szum moze zdominowac slaby sygnal (w1/m1 mowily "NEUTRAL" a h4 mowilo "SHORT" → blend byl rozwodniony)
- Szum zuzywa czas treningu (40% mniej training time po usunieciu)
- Szum zuzywa zasoby (collector nie musi skanowac 4000+ wierszy dla m1 30-day lookback)

Analogia: Masz 5 doradcow. 3 z nich sa dobrzy (h1, h4, h12). 2 z nich sa pijani (w1, m1) — mowia losowe rzeczy. Jesli uswednisz opinie wszystkich 5, pijani rozwadniaja madrosc trzech trzezwych. Lepiej ich wyrzucic.

To sie nazywa **"feature pruning"** w ML — swiadome usuwanie elementow ktore nie pomagaja. Przeciwintuicyjne, ale kluczowe.

### Kiedy wrocic do dlugich horyzontow?

Jesli zbieramy >1 rok danych (obejmujacych wiele rezimow rynkowych: byk, niedzwiedz, konsolidacja, panika), wtedy w1 moze byc ponownie rozpatrzony. Ale m1 (30-dniowy horyzont) to prawdopodobnie zawsze szum dla bota MM — bot nie trzyma pozycji miesiac.

---

## Rozdzial 37: BTC Prediction Proxy — "Smycz Bitcoina"

### Analogia

Wyobraz sobie ze masz 10 psow na spacerze. Kazdy pies (kPEPE, SOL, ETH, FARTCOIN...) biega troche inaczej — jeden szybciej, drugi wolniej, jeden skacze na lewo, drugi na prawo. Ale WSZYSTKIE sa na smyczy trzymanej przez jednego wlasciciela: **Bitcoina**.

Jesli wlasciciel (BTC) skreca w lewo, 95% psow tez skreci w lewo. Moze z opoznieniem, moze z wieksza amplituda, ale kierunek jest ten sam.

Do tej pory model kPEPE probowal sam zgadnac "gdzie idzie wlasciciel", patrzac na swoje wlasne dane techniczne (RSI, MACD, momentum). To tak jakby pies probwoal zgadnac plan spaceru patrzac na swoje wlasne lapy zamiast na wlasciciela.

### Co zrobilismy

Dodalismy 3 nowe features [62-64] ktore mowia modelowi kPEPE **co BTC zamierza zrobic** — nie surowe dane BTC (te juz mielismy w [49-52]), ale GOTOWA PREDYKCJA z modelu BTC:

```
SUROWE DANE BTC (juz mielismy):
  [49] btc_change_1h = "BTC spadl 0.5% w ostatniej godzinie"
  [50] btc_change_4h = "BTC spadl 3% w 4 godziny"
  [51] btc_rsi = "BTC jest oversold (RSI=28)"
  [52] btc_correlation = "kPEPE koreluje z BTC w 95%"

NOWE — PREDYKCJA BTC (od teraz):
  [62] btc_pred_direction = "Model BTC mowi: BEARISH (-1)"
  [63] btc_pred_change = "Model BTC przewiduje: -0.79% w 4h"
  [64] btc_pred_confidence = "Model BTC jest pewny w 50%"
```

Roznica jest kluczowa. Surowe dane mowia "co sie stalo". Predykcja mowi "co sie stanie". To jak roznica miedzy "widzialem wlasciciela skrecajacego w lewo" a "wlasciciel ZAMIERZA skrecic w lewo bo wlasnie sprawdzil mape i ustawil GPS".

### Dlaczego to dziala

Model kPEPE ma 30/62 dead features (zero SM data — nie ma whale_tracker dla kPEPE). Model BTC ma PELNE dane — 11 SM features, funding, orderbook. BTC prediction proxy pozwala kPEPE **pozyczac madrosc BTC** bez bezposredniego dostepu do SM data.

```
MODEL BTC (bogaty w dane):
  - 62 features, w tym 11 SM features
  - whale_tracker: $150M SHORT consensus
  - orderbook: bid/ask imbalance
  - funding: negatywny (bearish)
       |
       v
  BTC PREDICTION: BEARISH -0.79% (50% confidence)
       |
       v
MODEL kPEPE (biedny w dane):
  - 65 features, ale 30 = zera (brak SM)
  - NOWE: [62-64] = [-1, -0.16, 0.50]  ← "smycz Bitcoina"
  - Teraz widzi: "BTC idzie w dol → ja pewnie tez"
```

### Szczegoly techniczne

- **Collector** (`xgboost_collect.py`) fetchuje `localhost:8090/predict/BTC` raz na run (co 15 min)
- Dla BTC samego: features [62-64] = `[0, 0, 0]` (redundantne — BTC nie potrzebuje predykcji samego siebie)
- Jesli prediction-api nie odpowie: `[0, 0, 0]` (graceful degradation)
- Normalizacja: direction = -1/0/+1 (bezposrednio), change = `tanh(change/5)` (|5%| → ~0.76), confidence = `conf/100` (50% → 0.5)

### Kiedy zobaczymy efekt?

**Natychmiast**: zero. Stare modele byly trenowane na 62 features. Nowe [62-64] sa padowane zerami → drzewa ich ignoruja.

**Po retrainingu** (~100 nowych 65-feature wierszy, ~25h): XGBoost zacznie budowac drzewa ktore splituja na `btc_pred_direction` i `btc_pred_change`. Jesli BTC prediction proxy rzeczywiscie pomaga przewidywac kPEPE, te features pojawia sie w **feature importance**.

Spodziewamy sie ze `btc_pred_direction` bedzie jednym z top-5 features dla kPEPE (memecoin na 95% smyczy BTC). Dla BTC samego — zero importance (wyzerowane). Dla ETH/SOL — umiarkowane (80-90% korelacja, mniej niz memecoiny).

### Lekcja inzynierska: "Feature engineering > more data"

W ML sa trzy sposoby poprawy modelu:
1. **Wiecej danych** — zbierasz dluzej (tygodnie, miesiace)
2. **Lepszy model** — zmieniasz architekture, hyperparametry
3. **Lepsze features** — dajesz modelowi MADRZEJSZE informacje

#3 jest zwykle najskuteczniejsze i najtansze. Zamiast czekac miesiace na dane albo tuniwac hyperparametry w nieskonczonosc, dalismy modelowi **gotowa odpowiedz na najwazniejsze pytanie**: "co robi Bitcoin?".

To jest esencja "feature engineering" — nie dodawaj wiecej danych, dodaj **madrzejsze** dane.

---

## Rozdzial 38: xyz:GOLD, Transfer Detection i MIN_PROFIT Bypass — trzy fixy jednego dnia (28.02.2026)

### Kontekst: jeden przelew, dwa problemy, trzy fixy

Ten rozdzial opowiada o dniu, w ktorym jeden przelew USDC ($265) wywalil bota na 30+ minut, obnazajac dwa niezalezne bugi. A przy okazji dodalismy wsparcie dla calkowicie nowego dexu (xyz builder-deployed perps).

Sekwencja zdarzen:

```
1. Kupujemy xyz:GOLD (przelew USDC z perps na xyz dex)
2. Risk Manager widzi -$265 equity = -3.0% drawdown
3. Risk Manager: "HALT! Stracilismy 3%!" → process.exit(1)
4. Bot martwy. kPEPE ma LONG pozycje, zero orderow.
5. Po restarcie: MIN_PROFIT blokuje WSZYSTKIE close ordery
6. kPEPE nadal 0 orderow — bot zamrozony z rosaca strata
```

Dwa kompletnie niezalezne bugi:
- **Bug #1**: Risk Manager nie odroznia przelewow od strat
- **Bug #2**: MIN_PROFIT nie pozwala zamknac underwater pozycji

### Fix #1: Transfer Detection w Risk Manager

#### Problem

Risk Manager oblicza drawdown tak:

```
drawdown = (initialEquity - currentEquity) / initialEquity
```

Prosty wzor, ale jest w nim ukryte zalozenie: **kazdy spadek equity = strata tradingowa**. To nieprawda! Equity moze spasc bo:
- Przelejesz USDC na inny dex (tak jak my — na xyz)
- Wyplacisz USDC na Binance
- Zaplacisz gas fee
- Ktos Ci zrobic airdrop (equity rosnie)

Nasz bot robi ordery po $100 z mainLoop co 60 sekund. **Nie jest fizycznie mozliwe** zeby stracil >1% equity ($88+) w jednym ticku na tradingu. Wiec jesli equity spada o >1% w 60 sekund — to przelew, nie strata.

#### Rozwiazanie: heurystyka "Transfer Detection"

```typescript
// Nowe pola w RiskManager:
private lastCheckedEquity: number = 0;
private static readonly TRANSFER_THRESHOLD_PCT = 0.01;  // 1%
private static readonly TRANSFER_MIN_USD = 50;           // $50

// Na poczatku checkHealth(), PRZED drawdown checks:
if (this.lastCheckedEquity > 0) {
  const tickDelta = this.lastCheckedEquity - currentEquity;
  const tickDeltaPct = Math.abs(tickDelta) / this.lastCheckedEquity;

  if (tickDeltaPct > 0.01 && Math.abs(tickDelta) > 50) {
    if (tickDelta > 0) {
      // Wyplata/przelew — zmniejsz baseline
      this.initialEquity -= tickDelta;
      this.highWaterMark = Math.min(this.highWaterMark, currentEquity);
    } else {
      // Wplata — zwieksz baseline
      this.initialEquity += (-tickDelta);
    }
  }
}
this.lastCheckedEquity = currentEquity;
```

#### Analogia: waga lazienki

Wyobraz sobie ze masz wage w lazience i mierzysz sie codziennie. Pewnego dnia wazylas 80kg, nastepnego 77kg. "O nie, schudlem 3 kilo w jeden dzien!" — to fizycznie niemozliwe (chlowiek traci max ~0.5kg dziennie). Cos jest nie tak z pomiarem (np. wazylas sie w ubraniu, potem bez).

Risk Manager mial ten sam problem — wierzyl w "pomiar" bez pytania "czy ten wynik jest fizycznie mozliwy?". Transfer Detection to "sanity check" — jesli zmiana equity jest zbyt duza na jeden tick, to nie jest trading.

#### Dlaczego progi 1% i $50?

- **1%**: Bot robi ordery po $100. Equity ~$8,800. Nawet jesli WSZYSTKIE ordery zostana wypelnione w jednym ticku (niemozliwe — max kilka), strata bylaby czescia $100, nie 1% of $8,800.
- **$50**: Safety margin — nie chcemy reagowac na male fluktuacje (fees, micro-slippage). $50 to wystarczajaco duzo zeby odroznic od "szumu".
- **Oba warunki**: AND, nie OR. $51 zmiana na koncie $50,000 = 0.1% (ponizej 1%, nie trigger). $90 zmiana na koncie $8,800 = 1.02% AND >$50 = trigger.

### Fix #2: MIN_PROFIT Bypass dla underwater pozycji

#### Problem

MIN_PROFIT to filtr ktory chroni bota przed "fee-eating" — zamykaniem pozycji tak blisko entry price ze fees zjadaja caly profit. Zasada: nie zamykaj pozycji jesli zysk < 10 basis points (0.10%).

Brzmi rozsadnie, prawda? Problem pojawia sie gdy pozycja jest **underwater** (w stracie):

```
kPEPE LONG pozycja:
  Entry: $0.003555
  Mid:   $0.003527 (8 bps PONIZEJ entry)

MIN_PROFIT mowi: "Zaden close order nie daje 10bps profitu → USUN WSZYSTKIE"
Wynik: 0 orderow na gieldzie → bot zamrozony → strata rosnie
```

To jak lekarz ktory mowi "nie bierz aspiryny bo ma efekty uboczne" gdy pacjent krwawi. Tak, aspiryna ma efekty uboczne, ale krwawienie jest GORSZE.

#### Rozwiazanie

```typescript
// Sprawdz czy pozycja jest underwater
const isUnderwaterShort = isShort && midPrice > entryPx
const isUnderwaterLong = isLong && midPrice < entryPx

if (isUnderwaterShort || isUnderwaterLong) {
  // Pozycja underwater — POMIN filtr, pozwol na zamkniecie ze strata
  console.log(`MIN_PROFIT BYPASSED — position underwater → allow loss-cutting`)
} else {
  // Normalne filtrowanie — pozycja w zysku, chron przed fee-eating
  // ... istniejacy filtr bez zmian ...
}
```

Logika: MIN_PROFIT ma sens gdy pozycja jest w zysku — nie chcesz oddawac profitu na feesach. Ale gdy pozycja jest underwater, KAZDE zamkniecie (nawet z feesem) jest lepsze niz siedzenie z rosaca strata i zerem orderow.

#### Wynik live

```
Przed: kPEPE Multi-Layer: 0 orders (MIN_PROFIT usunol 8 askow)
Po:    kPEPE Multi-Layer: 8 orders | asks=8 | $800 notional
```

6 close fills: -$0.27 do -$0.53 per $100 = lacznie -$2.42. Kontrolowane wyjscie z pozycji. Strata $2.42 to nic w porownaniu do "siedzenia z 0 orderami przez godzine podczas spadku ceny".

### xyz:GOLD — nowy dex, nowy swiat

#### Co to xyz dex?

Hyperliquid ma dwa "swiaty" perpsow:
1. **Standard perps** (229 assets): BTC, ETH, SOL, kPEPE... — klasyczne krypto
2. **xyz dex** (47 assets): GOLD, SILVER, TSLA, NVDA, MU, MSTR... — commodities + akcje

xyz to "builder-deployed dex" — inne API, inny clearing, inne indeksy (offset 110000). Kluczowe roznice:

| Cecha | Standard | xyz |
|-------|----------|-----|
| API param | brak dodatkowego | `dex: "xyz"` |
| Nazwy | `BTC`, `ETH` | `xyz:GOLD`, `xyz:TSLA` |
| Asset index | 0-228 | 110000+ |
| Margin | cross lub isolated | **TYLKO isolated** |
| allMids | zawiera | **NIE zawiera** |
| Mid price | `allMids` API | trzeba fetchowac z `l2Book` |

#### Co zmienilismy?

**A) vip_spy.py — dual-dex fetching:**
```python
dex_configs = [
    (None, "perps"),     # standard perps
    ("xyz", "xyz dex"),  # xyz builder-deployed
]
for dex_param, dex_label in dex_configs:
    payload = {"type": "clearinghouseState", "user": address}
    if dex_param:
        payload["dex"] = dex_param
    # fetch + merge z obu dexow
```

Teraz widzimy ze Pulkownik ma xyz:XYZ100 $4.4M i Kapitan BTC ma xyz:MU $625K — wczesniej niewidoczne.

**B) general_copytrade.ts — 5 zmian:**

1. `fetchXyzMidPrice()` — nowa funkcja, bo `allMids` NIE zawiera xyz assets
2. `fetchOurPositions()` — dual fetch: standard + xyz dex
3. Asset map — laduje xyz meta (offset 110000), nazwy z prefixem `xyz:`
4. Leverage — xyz:GOLD 2x isolated (xyz wymusza isolated)
5. `processTick()` — fetch xyz mid prices via l2Book

**C) vip_config.json — `xyz:GOLD` w watched_coins**

#### Odkrycie: VIPy tradeuja xyz!

Z logow po deploy:
```
Pulkownik: xyz:XYZ100 $4.4M
Kapitan BTC: xyz:MU $625K, xyz:SNDK $594K, xyz:MSTR $70K, xyz:SILVER $29K
```

Nie wiedzielismy o tym! xyz pozycje byly niewidoczne bo vip_spy nie fetchowal z xyz dex.

### Lekcja inzynierska: "Brak danych to tez bug"

Trzy pozornie niepowiazane problemy (Risk Manager HALT, MIN_PROFIT freeze, xyz niewidoczne) maja wspolny temat: **system nie mial pelnego obrazu sytuacji**.

| Problem | Brakujaca informacja | Skutek |
|---------|---------------------|--------|
| Risk Manager HALT | Nie wiedzial ze to przelew, nie strata | Bot wylaczony 30+ min |
| MIN_PROFIT freeze | Nie wiedzial ze pozycja jest underwater | 0 orderow, rosaca strata |
| xyz invisible | Nie fetchowal z xyz dex | $5M+ pozycji VIPow niewidoczne |

W kazdym przypadku fix polegal na **dodaniu brakujacej informacji**:
- Risk Manager dostal `lastCheckedEquity` (porownanie tick-to-tick)
- MIN_PROFIT dostal `isUnderwaterShort/Long` (porownanie mid vs entry) — potem usuniety, bo powodowal zamykanie shortow na stracie
- vip_spy dostal `dex: "xyz"` (drugie zrodlo danych)

To jest fundamentalna zasada dobrego inzyniering: **kazda decyzja w kodzie powinna byc oparta na pelnym kontekscie**. Jesli system podejmuje decyzje (HALT, blokuj ordery, ignoruj pozycje) bez pelnego obrazu, bedzie podejmowal zle decyzje.

### Kluczowe pliki

| Plik | Zmiana | LOC |
|------|--------|-----|
| `src/risk/RiskManager.ts` | Transfer Detection heuristic | +32 |
| `src/mm_hl.ts` | MIN_PROFIT + BIAS LOCK fix | -38/+24 |
| `scripts/vip_spy.py` | Dual-dex position fetching | +95/-71 |
| `scripts/general_copytrade.ts` | xyz asset map + mid price + leverage | +86/-3 |
| `scripts/vip_config.json` | xyz:GOLD w watched_coins | +1/-1 |

---

## Rozdzial 39: Catch-22 — Jak Dwa Bugi Tworzą Jeden Wielki Problem

### Scena: Piątkowy wieczor, bot zamrozony

Jest piątek 28 lutego, ~21:00 UTC. Jerry sprawdza bota i widzi: **zero open orders na kPEPE**. Bot jest SHORT na kPEPE (entry $0.003631, mid $0.003671, -17% skew), ale nie ma ŻADNYCH orderów na giełdzie. Kompletnie martwy.

### Anatomia Catch-22

Catch-22 to sytuacja, gdy dwa pozornie rozsądne zasady razem tworzą paradoks. W naszym przypadku:

**Zasada 1 (MIN_PROFIT):** "Nie zamykaj pozycji na stracie — fee zje zysk"
- Bot jest SHORT. Bid = close order (kupno). Entry = $0.003631, mid = $0.003671.
- Mid > entry = underwater. Każdy bid blisko mid zamknąłby shorta ze stratą + fee.
- MIN_PROFIT filtr: usuwa WSZYSTKIE 8 bidów. **bids = 0** ✓ (prawidłowe zachowanie)

**Zasada 2 (BIAS LOCK):** "Jeśli jesteś SHORT >15%, nie shortuj więcej"
- Bot ma -17.2% skew (SHORT heavy). `inventorySkew = -0.172`.
- W `generateGridOrdersCustom()`: `skewSkipAsks = inventorySkew < -0.15 && actualSkew < 0.05`
- `-0.172 < -0.15` = true, `-0.172 < 0.05` = true → **asks = 0** (skipAsks!)

Każda zasada z osobna jest sensowna:
- MIN_PROFIT chroni przed fee-eating ✓
- BIAS LOCK chroni przed piling on to losing position ✓

Ale razem: **bids=0 + asks=0 = 0 orderów = martwy bot** ✗

### Dlaczego BIAS LOCK nie powinien dotyczyć PURE_MM?

BIAS LOCK został zaprojektowany dla SM-following botów. Gdy Generał mówi "SHORT LIT", bot shortuje i BIAS LOCK mówi "nie dodawaj więcej shortów ponad 15%". To ma sens.

Ale kPEPE jest w trybie **PURE_MM** — market maker, nie trader kierunkowy. MM musi **quotować obie strony** żeby łapać spread. Blokowanie asków = odcinanie połowy zarobku.

PURE_MM już miał mechanizm ochrony: `PURE_MM_REGIME_BYPASS` (dodany w rozdziale 31 — Regime Bypass). Problem? Sprawdzenie override w grid managerze szukało słowa `'override'` w reason stringu:

```typescript
// grid_manager.ts, linia 217
if (permissions.reason && permissions.reason.includes('override')) {
    if (permissions.allowShorts) skewSkipAsks = false  // ← to powinno się odpalić
}
```

Ale permission reason był `'PURE_MM_REGIME_BYPASS'` — nie zawierał słowa `'override'`! Więc BIAS LOCK nie był wyłączany.

### Fix: Jedno słowo

```typescript
// PRZED:
reason: 'PURE_MM_REGIME_BYPASS'        // nie matchuje 'override'

// PO:
reason: 'PURE_MM_REGIME_BYPASS_override'  // matchuje!
```

Dosłownie dodanie `_override` do stringa. Najmniejszy możliwy fix, który naprawia cały problem.

### Historia MIN_PROFIT bypass (3 iteracje w jednej sesji)

To jest historia o tym, jak szukaliśmy problemu w złym miejscu, zanim znaleźliśmy prawdziwy root cause.

**Iteracja 1 — MIN_PROFIT bypass v1 (naiwny):**
- Problem: 0 orderów bo MIN_PROFIT usuwa wszystkie bidy
- "Rozwiązanie": bypass MIN_PROFIT gdy pozycja underwater
- Efekt: bot zamykał KAŻDEGO shorta na stracie — 19 fills w 20 minut, -$8.50. Katastrofa.

**Iteracja 2 — MIN_PROFIT bypass v2 (z progiem 20bps):**
- Problem: v1 za agresywny
- "Rozwiązanie": bypass tylko gdy >20bps underwater
- Efekt: kPEPE ruszył się 33-41bps → bypass aktywny → 5 fills, -$2.42. Nadal źle.
- Jerry: "kurwa, cena podchodzi pod resistance to bot nie ma zamykac shortow na minusie"

**Iteracja 3 — Prawdziwy fix (BIAS LOCK override):**
- Usunięto CAŁY bypass MIN_PROFIT — bot NIE zamyka shortów na stracie ✓
- Naprawiono BIAS LOCK → asks wracają, bot quotuje sell-side ✓
- Wynik: `bids=0 asks=8` — bot żyje, nie zamyka na stracie, czeka na mean-reversion

### Lekcja: "Nie szukaj pod latarnią"

Pierwszy odruch to naprawiać to, co widać w logach: "MIN_PROFIT usunął 8 orderów → napraw MIN_PROFIT". Ale prawdziwy problem był gdzie indziej — w grid managerze, który nie generował asków. MIN_PROFIT działał prawidłowo!

To jest klasyczny "streetlight effect" — szukasz kluczy pod latarnią, bo tam jest jasno, a nie tam gdzie je zgubiłeś.

**Technika debugowania która pomogła:**
1. Nie patrz tylko na logi błędów — patrz na brakujące logi
2. `bids=0 asks=0` → pytanie: "skąd 0 asków?" (MIN_PROFIT nie rusza asków!)
3. Trace backwards: `generateGridOrdersCustom()` → BIAS LOCK → permission reason → `'PURE_MM_REGIME_BYPASS'` nie matchuje `'override'`

### Diagram końcowego stanu

```
         GRID GENERATION
              │
    ┌─────────┴─────────┐
    │                    │
  BIDS (close)       ASKS (open)
    │                    │
  BIAS LOCK?           BIAS LOCK?
  inventorySkew>0.15?  inventorySkew<-0.15?
    │ NO (skew=-0.17)    │ YES → ALE 'override' w reason!
    │                    │ → skewSkipAsks = false ✓
    ▼                    ▼
  8 bids generated    8 asks generated
    │                    │
  MIN_PROFIT           (nie filtrowane)
  entry=$0.003631      │
  maxBid=$0.003627     │
  all 8 bids > maxBid  │
    │                    │
  REMOVED (all 8)      KEPT (all 8)
    │                    │
    ▼                    ▼
  bids=0              asks=8
         │
    RESULT: 8 orders ✓
```

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `src/mm_hl.ts` | `PURE_MM_REGIME_BYPASS` → `PURE_MM_REGIME_BYPASS_override` + usunięcie MIN_PROFIT bypass |
| `src/utils/grid_manager.ts` | Nie zmieniony — BIAS LOCK + override mechanism już istniały |

---

## Rozdzial 40: Slepa Plamka — Kiedy Bot Ma Oczy Ale Nie Widzi

> "Masz radar, ale antena wskazuje na Marsa zamiast na autostradę przed tobą."

### Problem

Momentum Guard — system który dostosowuje rozmiary orderów na podstawie 3 sygnałów (momentum, RSI, proximity S/R) — miał **20% martwej wagi**. Sygnał proximity (bliskość do support/resistance) był ZAWSZE zero. Bot reagował na momentum i RSI, ale kompletnie ignorował czy cena jest blisko kluczowego poziomu.

To tak jakby kierowca widział prędkościomierz i obrotomierz, ale miał zaklejone lusterko boczne.

### Dlaczego prox=0.00?

Momentum Guard brał support i resistance z **30 candles 4h** — czyli 5 dni danych. kPEPE (memecoin z szaloną zmiennością) spadło z $0.00436 do $0.00345 w ciągu tych 5 dni. Range = **26%**.

Potem sprawdzał: "czy cena jest blisko S/R?" używając **ATR-based zones** (1.6% strong, 3.2% moderate). Ale cena ($0.00366) była:
- 18.7% poniżej resistance — daleko
- 6.1% powyżej support — daleko

Zone 3.2% vs odległość 18.7%/6.1% → **cena nigdy nie wchodzi w zone**. Bot miał radar o zasięgu 3 km, ale najbliższy obiekt był 19 km dalej.

### Analogia: Lornetka vs Lupa

```
4h S/R (30 candles = 5 dni):    🔭 LORNETKA
  → Widzi dalekie góry i doliny
  → Dobre do identyfikacji trendu
  → Za daleko do nawigacji "tu i teraz"

1h S/R (24 candles = 24h):      🔍 LUPA
  → Widzi najbliższe przeszkody
  → Dobre do reagowania "w tym momencie"
  → Zbyt krótkie na trend
```

Bot potrzebował **obu**. MarketVision używał lornetki do wykrywania trendu (4h=bear), ale Momentum Guard próbował nawigować lornekti zamiast lupy.

### Fix

Dodaliśmy **1h body-based S/R** (24 candles = 24h lookback) do MarketVision. Momentum Guard teraz używa tych krótkoterminowych poziomów do proximity, z fallback na 4h gdy 1h nie jest dostępne.

```
PRZED (4h S/R):
  Resistance: $0.004360 (18.7% od ceny) → prox=0.00 → DEAD
  Support:    $0.003449 (6.1% od ceny)  → prox=0.00 → DEAD

PO (1h S/R):
  Resistance: $0.003682 (0.3% od ceny)  → prox=0.80 → ALIVE!
  Support:    $0.003449 (6.0% od ceny)  → prox=0.00 → daleko (OK)
```

0.3% od resistance → bot widzi że cena jest tuż pod 24h high → sygnał "overbought" → dostosowuje grid.

### Kluczowa lekcja: Testuj Założenia

Ten bug istniał od tygodni. Nikt nie sprawdził CZY proximity faktycznie cokolwiek robi. Logi mówiły `prox=0.00` — a zero wygląda normalnie jeśli nie wiesz czego szukasz.

**Dobre praktyki:**
1. **Dodaj debug log z raw values** — nie tylko wynik (prox=0.00), ale dane wejściowe (res=0.004360, sDist=18.7%)
2. **Sprawdź edge case** — "co jeśli range S/R jest dużo większy niż ATR zone?" → cena nigdy nie trafia
3. **Kwestionuj "to działa"** — score=0.00 może znaczyć "market flat" albo "sygnał zepsuty". Bez kontekstu nie odróżnisz

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `src/signals/market_vision.ts` | Nowe pola `supportBody12h` / `resistanceBody12h` z 24 candles 1h |
| `src/mm_hl.ts` | MG proximity używa 1h S/R z fallback na 4h, S/R values w logu |

---

## Rozdział 21: Nuclear Fix vs PURE_MM — Gdy Generał Rozkazuje Nie Temu Żołnierzowi (01.03.2026)

### Bug w jednym zdaniu

Bot kPEPE (PURE_MM market maker) miał zablokowane kupowanie przez 142 minuty w nocy, bo Nuclear Fix — mechanizm przeznaczony dla SM-following botów — przypadkowo zadziałał na PURE_MM bota.

### Kontekst: Dwa Boty, Jeden Kod

Na serwerze działają dwa boty:

| Bot | PM2 | Tryb | Tokeny | Co robi |
|-----|-----|------|--------|---------|
| **mm-pure** | id 48 | PURE_MM | kPEPE | Market making — kupuj i sprzedawaj, łap spread |
| **mm-follower** | id 45 | SM_FOLLOWER | BTC,ETH,SOL,HYPE,FARTCOIN | Podążaj za Smart Money — shortuj gdy wieloryby shortują |

Oba boty uruchamiają **ten sam kod** (`src/mm_hl.ts`), ale z różnymi zmiennymi środowiskowymi:
- mm-pure: `BOT_MODE=PURE_MM`
- mm-follower: `BOT_MODE=SM_FOLLOWER`

### Nuclear Fix — Przypomnienie

Nuclear Fix to mechanizm z "Doktryny Wojennej" (styczeń 2026). Gdy Smart Money shortują masywnie:
```
bidMultiplier = 0.00  →  ZERO kupowania
askMultiplier = 1.50  →  Agresywne shortowanie
```

To działa świetnie dla mm-follower — podąża za wielorybami. Ale dla mm-pure to **katastrofa** — market maker MUSI kupować i sprzedawać. Bez bidów nie zarabia spreadu, nie zamyka shortów, nie robi mean-reversion.

### Jak Doszło do Buga

Wyobraź sobie dwa biura w jednym budynku:

- **Biuro A (mm-follower)**: "Generał mówi SHORT → shortujemy!"
- **Biuro B (mm-pure)**: "Ignorujemy Generała, robimy swoje market making"

Problem: oba biura dzielą **tę samą szafkę na dokumenty** (`cachedAnalysis` w SmAutoDetector.ts).

```
loadAndAnalyzeAllTokens()  ← wywoływane przez OBA boty
  → analizuje WSZYSTKIE tokeny (nie tylko te przypisane do bota)
  → whale_tracker mówi: kPEPE score -46 (silny SM SHORT)
  → zapisuje do cache: kPEPE → FOLLOW_SM_SHORT
```

Biuro B (mm-pure) prawidłowo ignorowało Generała na frontowych drzwiach:
```typescript
function getSignalEngineForPair(pair) {
  if (IS_PURE_MM_BOT) return { mode: PURE_MM, ... }  // ✅ Generał odrzucony
}
```

Ale boczne drzwi były otwarte:
```typescript
const holdTp = shouldHoldForTp(pair, 'short')  // ← czyta prosto z cache!
if (holdTp) { permissions.allowLongs = false }  // → bid=0 😱
```

`shouldHoldForTp()` nie sprawdzał `IS_PURE_MM_BOT` — szło bezpośrednio do cache, widziało `FOLLOW_SM_SHORT`, i blokowało bidy.

### Analogia: Restauracja

Wyobraź sobie restaurację z dwoma szefami kuchni:

- **Szef A** (mm-follower): gotuje tylko to, co mówi krytyk kulinarny (SM)
- **Szef B** (mm-pure): gotuje własne menu, ignoruje krytyków

Obaj używają **tej samej tablicy zamówień** w kuchni. Krytyk pisze na tablicy: "NIE SERWOWAĆ ZUPY!" (= nie kupuj, bid=0).

Szef B ma instrukcję "ignoruj krytyka" (= `getSignalEngineForPair` zwraca PURE_MM). I prawidłowo ignoruje. Ale kelner sprawdza tablicę bezpośrednio (= `shouldHoldForTp` czyta cache) i mówi klientom "zupy nie ma". Nawet nie pyta Szefa B.

### Fix: 5 Bocznych Drzwi Zamkniętych

Dodaliśmy `!IS_PURE_MM_BOT` guard do 5 miejsc w mm_hl.ts:

```typescript
// Wzorzec: zamiast
const holdTp = shouldHoldForTp(pair, side);

// Teraz:
const holdTp = IS_PURE_MM_BOT ? false : shouldHoldForTp(pair, side);
```

Efekt: PURE_MM bot nigdy nie "trzyma pozycji dla take-profit" — to koncept SM-following, nie market making.

### Dlaczego to Ważne

| Metryka | Przed (bug) | Po (fix) |
|---------|-------------|----------|
| kPEPE bidy | 0 (zablokowane) | 8 (pełny grid) |
| bidMultiplier | 0.00 | 1.21 |
| Mean-reversion | WYŁĄCZONE | Działa |
| Gap w handlu | 142 minut w nocy | Zero |

Bot tracił ~$10-15 potencjalnego zysku za każdą noc z zablokowanymi bidami (bazując na średnim daily PnL kPEPE ~$80/dzień).

### Lekcje

1. **Shared state jest niebezpieczny** — `cachedAnalysis` to globalny cache używany przez oba boty. Funkcje jak `shouldHoldForTp()` nie wiedzą, kto je wywołuje. Zawsze sprawdzaj kontekst wywołania.

2. **"Frontowe drzwi zamknięte" nie wystarczy** — `getSignalEngineForPair()` poprawnie odrzucał SM sygnały dla PURE_MM. Ale 5 innych miejsc w kodzie omijało ten guard i czytało bezpośrednio z cache.

3. **Testuj z perspektywy drugiego bota** — Bug nie występował na mm-follower (tam Nuclear Fix jest pożądany). Trzeba było uruchomić mm-pure i sprawdzić CZY bidy działają.

4. **PM2 env vars nie propagują** — `DRY_RUN=true pm2 restart mm-follower` NIE działa. Env var musi być w `ecosystem.config.cjs` + restart z `--update-env`. To klasyczny PM2 gotcha.

### Bonus: Przegląd 24h Logów

Przy okazji przejrzeliśmy logi z ostatnich 24h i znaleźliśmy kilka problemów:

| Problem | Ważność | Status |
|---------|---------|--------|
| BTC 57% drawdown na mm-follower, AUTO-PAUSED | Krytyczny | mm-follower → DRY_RUN |
| ETH CRITICAL LONG SQUEEZE RISK warnings | Warning | Monitorowany |
| ai-executor fetch failed loop | Error | Znany (brak backendu) |
| Nansen API 403 kill switch (5 consecutive) | Warning | Auto-recovery 30 min |
| copy-general xyz:GOLD cloid format bug | Error | Znany (xyz: prefix w cloid) |
| AlphaEngine XRP/LIT CLOSE_SHORT spam | Info | Kosmetyczny |

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `src/mm_hl.ts` | 5 miejsc z `!IS_PURE_MM_BOT` guard na `shouldHoldForTp()` |
| `src/config/short_only_config.ts` | `lowVolL1Bps` 28→14 |
| `ecosystem.config.cjs` (serwer) | `DRY_RUN: "true"` dla mm-follower |

---

## DRY_RUN Safety — instanceof guard pattern

> "TypeScript sprawdza typy w czasie kompilacji. JavaScript w runtime robi co chce. Twój cast `as LiveTrading` to obietnica złożona kompilatorowi — ale runtime jej nie słucha."

### Problem: Jeden plik, dwa światy

`mm_hl.ts` to potwór — ponad 10,000 linii kodu z **czterema klasami** w jednym pliku:

```
┌─────────────────────────────────────────────────┐
│  mm_hl.ts                                       │
│                                                 │
│  ┌─────────────────────────────────────────────┐│
│  │  StateManager       (linia ~100)            ││
│  │  └─ zarządza stanem sesji                   ││
│  ├─────────────────────────────────────────────┤│
│  │  PaperTrading       (linia ~800)            ││
│  │  └─ symulacja tradingu (DRY_RUN)            ││
│  │  └─ NIE ma: l2BookCache, shadowTrading,     ││
│  │     binanceAnchor, vpinAnalyzers, adverse,  ││
│  │     closePositionForPair()                  ││
│  ├─────────────────────────────────────────────┤│
│  │  LiveTrading        (linia ~1479)           ││
│  │  └─ prawdziwy trading z API                 ││
│  │  └─ MA: l2BookCache, shadowTrading,         ││
│  │     binanceAnchor, vpinAnalyzers, adverse,  ││
│  │     closePositionForPair(), fetchOpenOrders  ││
│  ├─────────────────────────────────────────────┤│
│  │  HyperliquidMMBot   (linia ~3595)           ││
│  │  └─ główna klasa bota                       ││
│  │  └─ this.trading = LiveTrading | PaperTrad. ││
│  │  └─ mainLoop(), executeMultiLayerMM()       ││
│  └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

Kluczowy detal: `HyperliquidMMBot` ma property `this.trading` które może być **albo** `LiveTrading` **albo** `PaperTrading`, zależnie od env var `DRY_RUN`:

```typescript
// W konstruktorze HyperliquidMMBot:
if (process.env.DRY_RUN === 'true') {
  this.trading = new PaperTrading(...)   // ← symulacja, brak wielu metod
} else {
  this.trading = new LiveTrading(...)    // ← prawdziwy trading, pełny zestaw
}
```

### TypeScript kłamstwo: `as LiveTrading`

W ~25 miejscach w kodzie było coś takiego:

```typescript
const lt = this.trading as LiveTrading
const book = lt.l2BookCache.get(pair)  // 💥 CRASH w DRY_RUN!
```

Co robi `as LiveTrading`? **Nic.** To instrukcja dla kompilatora TypeScript: "zaufaj mi, to jest LiveTrading". Kompilator przestaje narzekać. Ale w JavaScript (które faktycznie się wykonuje), `this.trading` nadal jest `PaperTrading`. A `PaperTrading` nie ma `l2BookCache` → `undefined.get(pair)` → `TypeError: Cannot read properties of undefined`.

To trochę jak gdybyś wziął dowód osobisty i napisał na nim flamastrem "Elon Musk". Urzędnik spojrzy i powie "OK, pan Musk" (TypeScript). Ale system bankowy sprawdzi PESEL i odmówi dostępu do konta (JavaScript runtime).

### Anatomia crashu

Kiedy mm-follower startował z `DRY_RUN=true`:

```
                mm-follower (DRY_RUN=true)
                        │
                        ▼
              this.trading = PaperTrading
                        │
                        ▼
        executeMultiLayerMM() starts...
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
   analyzeOrderBook  binanceAnchor  shadow contrarian
   lt.l2BookCache    lt.binanceAn.  lt2.shadowTrading
        │                │              │
        ▼                ▼              ▼
    undefined         undefined      undefined
        │                │              │
        ▼                ▼              ▼
   💥 TypeError     💥 TypeError   💥 ReferenceError
```

Bot nie crashował kompletnie (PM2 restartował), ale te errory zapychały logi i blokowały normalne działanie.

### 3 wzorce naprawy

**Wzorzec 1: Early return z defaults (dla metod)**

Gdy cała metoda potrzebuje LiveTrading:

```typescript
private analyzeOrderBook(pair: string) {
  // Guard na początku — jeśli nie LiveTrading, zwróć neutralne wartości
  if (!(this.trading instanceof LiveTrading)) {
    return { imbalance: 0, wallDetected: false, wallSide: 'none' };
  }
  // Tu mamy pewność że this.trading jest LiveTrading
  const book = this.trading.l2BookCache.get(pair);
  // ... reszta metody bezpieczna
}
```

**Wzorzec 2: Nullable z optional chaining (dla bloków)**

Gdy fragment kodu opcjonalnie korzysta z LiveTrading:

```typescript
// Deklaracja na początku scope — dostępna w całej metodzie
const liveTrading = this.trading instanceof LiveTrading
  ? this.trading
  : null;

// Użycie z optional chaining — null-safe, zero crashy
if (liveTrading?.binanceAnchor) {
  const anchor = liveTrading.binanceAnchor.getPrice(pair);
  // ...
}

// Dalej w tej samej metodzie — nadal bezpieczne
const vpin = liveTrading?.vpinAnalyzers?.get(pair)?.getToxicityLevel();
const adverse = liveTrading?.adverseTracker?.calculateScore(pair) ?? 1.0;
```

**Wzorzec 3: Guard w warunku (dla jednolinijkowych akcji)**

```typescript
// Zamknij pozycję tylko na LIVE tradingu
if (nansenCloseSignal.close && position && this.trading instanceof LiveTrading) {
  await this.trading.closePositionForPair(pair, 'nansen_alert_close');
}
```

### 11 miejsc naprawionych

| # | Co crashowało | Wzorzec | Kontekst |
|---|---------------|---------|----------|
| 1 | `lt.l2BookCache.get(pair)` | Early return | analyzeOrderBook — zwraca neutralne |
| 2 | `liveTrading.binanceAnchor` | Nullable | Binance anchor price — opcjonalne |
| 3 | `lt2.shadowTrading` | Guard w warunku | Shadow contrarian — `lt2` usunięte wcześniej! |
| 4 | `this.trading.closePositionForPair` | Guard w warunku | Nansen close signal |
| 5 | `this.trading.closePositionForPair` | Early return w try | Squeeze trigger |
| 6 | `this.trading.closePositionForPair` | Early return w try | Stop loss |
| 7 | `this.trading.closePositionForPair` | Early return w try | SM-aligned TP |
| 8 | `this.trading.closePositionForPair` | Early return w try | Anaconda SL |
| 9 | `lt.binanceAnchor`, `lt.vpinAnalyzers` | Guard blok | Status log ToxicFlow |
| 10 | `liveTrading.vpinAnalyzers`, `.adverseTracker` | Optional chaining `?.` | VPIN/Adverse w kPEPE |
| 11 | `this.fetchOpenOrdersRaw()` | Duplikat metody | Była TYLKO na LiveTrading! |

### Fix #11 — metoda na złej klasie

Ten bug zasługuje na osobny akapit, bo to **inny rodzaj problemu**:

```typescript
// HyperliquidMMBot class (linia ~4262):
async cancelAllOnBlockedPairs() {
  const orders = await this.fetchOpenOrdersRaw(this.walletAddress);
  //                        ^^^^^^^^^^^^^^^^^^^^^^^^
  //                        Ta metoda istniała TYLKO
  //                        na LiveTrading (linia 2905)!
  //                        HyperliquidMMBot to INNA klasa!
}
```

`cancelAllOnBlockedPairs` jest metodą `HyperliquidMMBot`. Wołała `this.fetchOpenOrdersRaw()`. Ale `fetchOpenOrdersRaw` była zdefiniowana na `LiveTrading` — **to dwie różne klasy**. `this` w `HyperliquidMMBot` to `HyperliquidMMBot`, nie `LiveTrading`.

Dlaczego działało na mm-pure? Prawdopodobnie mm-pure nie trafił na ścieżkę kodu `cancelAllOnBlockedPairs` (brak zablokowanych par) albo timing restartów sprawiał, że cache ESM loadera miał inną wersję.

Fix: dodałem identyczną kopię `fetchOpenOrdersRaw` na `HyperliquidMMBot`:

```typescript
class HyperliquidMMBot {
  // ... existing code ...

  /** Raw openOrders fetch bypassing SDK schema validation */
  private async fetchOpenOrdersRaw(user: string): Promise<any[]> {
    try {
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'openOrders', user }),
      });
      if (!res.ok) return [];
      return await res.json() as any[];
    } catch {
      return [];
    }
  }

  async cancelAllOnBlockedPairs() {
    const orders = await this.fetchOpenOrdersRaw(this.walletAddress); // ✅ teraz istnieje
    // ...
  }
}
```

### PM2 + ESM = Cache Gotcha

Po wgraniu fixów na serwer, mm-pure działał (zero błędów), ale mm-follower nadal crashował z `fetchOpenOrdersRaw is not a function`. Grep na serwerze potwierdzał: metoda JEST w pliku. Ale runtime mówił: NIE ISTNIEJE.

Problem: **ESM loader cache**. PM2 z `--experimental-loader ts-node/esm` cacheuje skompilowane moduły. Zwykły `pm2 restart` nie czyści tego cache. Trzeba:

```bash
# ❌ NIE DZIAŁA (stary cache):
pm2 restart mm-follower

# ✅ DZIAŁA (wymusza przeładowanie env + modułów):
pm2 restart mm-follower --update-env
```

To jest PM2 gotcha #2 (pierwsza to env vars — patrz rozdział Nuclear Fix). Zapamiętaj:

| Operacja | Komenda |
|----------|---------|
| Zmiana pliku źródłowego | `pm2 restart xxx --update-env` |
| Zmiana env vars | `pm2 restart xxx --update-env` |
| Normalny restart (brak zmian) | `pm2 restart xxx` |

### Lekcje

1. **`as` to nie cast, to obietnica** — TypeScript `as X` nie zmienia obiektu w runtime. To mówi kompilatorowi "zaufaj mi". Jeśli kłamiesz, runtime się zemści. Zawsze weryfikuj z `instanceof` gdy typ nie jest pewny.

2. **Monolityczny plik = ukryte zależności** — 4 klasy w jednym pliku o 10K linii. Metoda zdefiniowana na jednej klasie wygląda jak dostępna wszędzie (bo scrollujesz w tym samym pliku), ale `this` w różnych klasach to różne obiekty. Gdyby każda klasa była w osobnym pliku, IDE by od razu krzyczało "method not found".

3. **DRY_RUN musi być first-class citizen** — Nie wystarczy dodać `if (DRY_RUN)` w jednym miejscu. KAŻDA ścieżka kodu, która dotyka LiveTrading-specific properties, musi mieć guard. To jest jak testy: nie testujesz happy path, testujesz edge cases.

4. **ESM cache jest niewidoczny** — Plik na dysku ma nowy kod, grep potwierdza, ale runtime widzi starą wersję. To jeden z najgorszych typów bugów — "ale przecież patrzę na kod i jest poprawny!". Zawsze `--update-env` po zmianie pliku.

5. **Różnica między mm-pure a mm-follower to env vars** — Oba biegną z tego samego pliku `src/mm_hl.ts`. Ale `DRY_RUN=true` vs `DRY_RUN=false` tworzy kompletnie inne ścieżki kodu. Bug który nie istnieje na jednym bocie może crashować drugi. Testuj oba po każdej zmianie.

6. **Optional chaining (`?.`) to twój przyjaciel** — Zamiast `liveTrading.vpinAnalyzers.get(pair)` (crash jeśli null), pisz `liveTrading?.vpinAnalyzers?.get(pair)` (zwraca `undefined` jeśli null). Jedna `?` ratuje od TypeError.

### Wynik

| Bot | Przed (11 bugów) | Po (11 fixów) |
|-----|-------------------|----------------|
| mm-pure | `fetchOpenOrdersRaw is not a function` | Zero błędów |
| mm-follower | `TypeError` × 3, `ReferenceError` × 1, `liveTrading is not defined` | Zero błędów |
| Logi | Zapchane error spam | Czyste, tylko business logic |

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `src/mm_hl.ts` | 11 instanceof guards + fetchOpenOrdersRaw na HyperliquidMMBot (+109/-68) |
| `scripts/general_copytrade.ts` | Usunięto nieprawidłowe pole `c` z cloid (+3/-1) |

---

## Rozdział: Ghost Position — Jak IOC Partial Fill Oszukał State Tracker

*2 marca 2026*

### Problem

Copy-general bot trzymał pozycję xyz:GOLD LONG za $600 na koncie Hyperliquid, ale w swoim stanie wewnętrznym (`activeCopies`) nie miał o niej pojęcia. Bot widział pozycję Generała (xyz:GOLD LONG $1M), widział ją w `generalPositions`, ale nigdy nie próbował jej skopiować — bo nie wiedział, że już to zrobił.

```
┌─────────────────────────────────────────────────────────────┐
│  Stan giełdy (prawda):     xyz:GOLD LONG $600  ✅           │
│  Stan bota (activeCopies): (nic)               ❌           │
│  Efekt: "ghost position" — istnieje, ale niewidzialna       │
└─────────────────────────────────────────────────────────────┘
```

To jest klasyczny **state desync** — rzeczywistość i model rzeczywistości się rozjechały.

### Śledztwo

Rozpoczęliśmy od hipotezy, że `fetchXyzMidPrice()` nie działa (xyz: coiny nie pojawiają się w standardowym `allMids` API). Test na serwerze:

```bash
curl -s -X POST https://api.hyperliquid.xyz/info \
  -H 'Content-Type: application/json' \
  -d '{"type":"l2Book","coin":"xyz:GOLD"}' | jq '.levels'
# → bid: $5378.0, ask: $5379.5, mid: $5378.75 ✅
```

Mid price działa. Dodaliśmy debug logi — okazało się, że bot faktycznie WIDZI xyz:GOLD, MA mid price, ale nigdy nie wchodzi w blok kopiowania. Dlaczego?

Sprawdziliśmy pozycje na koncie:

```bash
curl -s -X POST https://api.hyperliquid.xyz/info \
  -d '{"type":"clearinghouseState","user":"0x...","dex":"xyz"}' | jq '.assetPositions'
# → xyz:GOLD: szi=0.1116, positionValue=$599.84, entryPx=$5373.66
```

Mamy pozycję! 6 fill'ów z 28 lutego — bot UDAŁ się skopiować GOLD, ale o tym zapomniał.

### Root Cause — 3-krokowy desync

```
28.02, 15:37 UTC:
  ┌─ Bot wykrywa: Generał ma xyz:GOLD LONG
  ├─ calculateCopySize() → $500
  ├─ placeOrder() wysyła 6 IOC orderów
  ├─ Giełda: 6 fill'ów, łącznie 0.1116 oz GOLD ($600)  ✅
  ├─ placeOrder() zwraca: false (IOC partial → SDK error)  ❌
  └─ if (ok) { activeCopies['xyz:GOLD'] = ... }  // NIE WCHODZI
      ↓
  activeCopies['xyz:GOLD'] = undefined  // GHOST POSITION
```

Na kolejnych tickach:
```
  calculateCopySize():
    maxAlloc = $500 (limit) - $600 (nasza pozycja) = -$100
    → return 0
    → copySize < 20 → continue (cicho skip)
```

Trzy niezależne mechanizmy zablokowały naprawę:

| # | Mechanizm | Co robił | Dlaczego nie zadziałał |
|---|-----------|----------|----------------------|
| 1 | `placeOrder()` return | Miał zapisać activeCopy | IOC partial fill → `false` → skip |
| 2 | `calculateCopySize()` | Miał ponownie otworzyć | Pozycja > limit → return 0 |
| 3 | Baseline seeding | Miał wykryć na starcie | Uruchamia się TYLKO na pierwszym starcie z pustym stanem |

To jest piękny przykład **Swiss Cheese Model** z inżynierii bezpieczeństwa — każda warstwa ma dziurę, i akurat wszystkie dziury się pokryły.

### Fix — Position Reconciliation

Dodaliśmy nową sekcję 3b w `processTick()`, zaraz po `fetchOurPositions()`:

```typescript
// 3b. Reconcile: jeśli trzymamy pozycję w kierunku Generała
//     ale nie mamy wpisu w activeCopies — zarejestruj ją
for (const [coin, ourPos] of Object.entries(ourPositions)) {
  if (state.activeCopies[coin]) continue    // już śledzona
  if (!generalPos[coin]) continue            // Generał nie ma
  const gSide = generalPos[coin].side === 'LONG' ? 'buy' : 'sell'
  const ourSide = ourPos.size > 0 ? 'buy' : 'sell'
  if (gSide !== ourSide) continue            // opposite side = nie kopia

  // Ghost position znaleziona — zarejestruj
  state.activeCopies[coin] = {
    side: ourSide,
    entryTime: Date.now(),
    generalEntry: generalPos[coin].entry_px,
  }
  log(`🔧 RECONCILE: ${coin} ${ourSide} $${ourPos.value.toFixed(0)}`)
}
```

Wynik na żywo:
```
🔧 RECONCILE: xyz:GOLD buy $600 — registered as active copy (was missing from state)
```

activeCopies: 8 (baseline) → 9 (+ xyz:GOLD reconciled).

### Dodatkowy bug — cloid z dwukropkiem

1 marca o 07:08 bot próbował ponownie skopiować GOLD, ale stary kod miał:
```typescript
c: `copy_${coin}_${Date.now().toString(16)}`
// → "copy_xyz:GOLD_19ca83a7409"
//         ^^ DWUKROPEK w cloid!
```

Hyperliquid API odrzuciło — dwukropek nie jest dozwolony w custom order ID. Ten bug został naprawiony wcześniej (usunięcie pola `c`), ale zanim fix dotarł na serwer, bot już miał ghost position.

### Analogia

Wyobraź sobie, że wysłałeś przelew bankowy. Bank przetransferował pieniądze, ale potwierdzenie maila nie dotarło (spam filter zjadł). Twój budżet w Excelu mówi "pieniądze nadal na koncie", ale konto mówi "przelew wykonany".

Co robisz? **Reconciliation** — porównujesz wyciąg bankowy z Excelem i poprawiasz rozbieżności. Dokładnie to robi sekcja 3b.

### Lekcje

1. **IOC fill ≠ SDK success** — Immediate-or-Cancel ordery na Hyperliquid mogą się częściowo wypełnić, ale SDK zwraca `false` (bo nie wypełniło się w 100%). Musisz OSOBNO sprawdzić czy pozycja faktycznie istnieje na koncie, nie ufaj tylko return value z `placeOrder()`.

2. **State musi być reconciled, nie assumed** — Nigdy nie polegaj wyłącznie na "zapisałem to gdy się udało". Rzeczywistość (giełda) jest source of truth, nie twój state file. Periodyczny reconciliation to standard w finansach — banki robią to co noc.

3. **Silent skip to cichobójca** — `if (copySize < 20) continue` nie logowało nic. Przez 3 dni bot cicho skipował GOLD na każdym ticku (co 30s = ~8,640 razy) bez śladu w logach. Gdyby było choćby jedno `log('SKIP: xyz:GOLD, size too small')`, znaleźlibyśmy problem w 5 minut zamiast 3 dni.

4. **xyz dex to inna bestia** — `allMids` nie zawiera xyz: coinów (trzeba `l2Book`). xyz ordery używają izolowanego marginu. Asset indices zaczynają się od 110000. Każda "specjalność" to potencjalna dziura w logice.

5. **Swiss Cheese Model** — Gdy 3 niezależne mechanizmy "powinny to złapać" i żaden nie złapał, potrzebujesz 4. mechanizmu: **reconciliation** — periodyczne porównanie reality vs model. To jest ostatnia linia obrony, i często jedyna która działa niezawodnie.

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `scripts/general_copytrade.ts` | Sekcja 3b: position reconciliation (+16 linii) |

---

## Rozdział 33: Nie Wymazuj Pamięci Bota — Whitelist, Baseline i Lekcja za $2,500

*2 marca 2026, 12:00 UTC*

### Problem

copy-general miał 7 wpisów w `activeCopies` (stan wewnętrzny bota): AVAX, FARTCOIN, RESOLV, ASTER, APEX + LIT, xyz:GOLD. User chciał kopiować TYLKO LIT i xyz:GOLD. Reszta to stare pozycje Generała otwarte przez API glitch (patrz Rozdział 32).

### Katastrofalny błąd — usunięcie pamięci

Pierwsza próba naprawy: "usuń niechciane wpisy z activeCopies". Brzmi logicznie, prawda?

**NIE.**

`activeCopies` to **pamięć** bota. Każdy wpis mówi: "wiem o tej pozycji, nie kopiuj jej ponownie". Usunięcie wpisu = bot "zapomina" że pozycja istnieje.

Co się stało:
1. Usunięto AVAX, FARTCOIN, RESOLV, ASTER, APEX z activeCopies
2. Na następnym ticku bot sprawdził pozycje Generała
3. Generał ma AVAX, FARTCOIN, RESOLV, ASTER, APEX → bot nie zna ich → **traktuje jako NOWE**
4. Bot natychmiast otworzył 5 kopii po $500 = **$2,500 nowych pozycji**
5. User musiał zamknąć je ręcznie (drugi raz tego dnia!)

### Analogia — Alzheimer bota tradingowego

Wyobraź sobie bota jako wiernego asystenta z notatnikiem. W notatniku ma listę:
- "Generał ma AVAX SHORT — już wiem, nie kopiuję"
- "Generał ma LIT LONG — skopiowałem, śledzę"

Wyrywasz mu 5 stron z notatnika. Asystent patrzy na Generała, widzi AVAX SHORT, sprawdza notatnik — **brak wpisu** → "O, nowa pozycja! Kopiuję!" I tak 5 razy.

Nie wymazujesz pamięci bota, chyba że chcesz żeby popełnił te same błędy od nowa.

### Rozwiązanie #1 — Baseline entries

Zamiast **usuwać** wpisy, **oznacz** je jako `baseline: true`:

```json
{
  "activeCopies": {
    "AVAX": { "side": "sell", "baseline": true },
    "FARTCOIN": { "side": "sell", "baseline": true },
    "LIT": { "side": "buy", "entryTime": 1709312000000 },
    "xyz:GOLD": { "side": "buy", "entryTime": 1709312000000 }
  }
}
```

`baseline: true` mówi: "wiem o tej pozycji, ale NIE zarządzaj nią — nie kopiuj, nie zamykaj, nie redukuj". Bot widzi AVAX w notatniku, sprawdza flag → "baseline, pomijam".

### Rozwiązanie #2 — Whitelist (COPY_ALLOWED_COINS)

Baseline chroni przed ponownym kopiowaniem, ale co jeśli Generał otworzy NOWĄ pozycję na DOGE? Bot ją skopiuje, bo DOGE nie jest w activeCopies ani w blocklist.

**Whitelist** to silniejsza ochrona:

```javascript
// W ecosystem.config.cjs
COPY_ALLOWED_COINS: "LIT,xyz:GOLD"

// W kodzie (sekcja 7 — detect NEW positions)
if (config.allowedCoins.length > 0 && !config.allowedCoins.includes(coin)) continue
```

Teraz bot kopiuje WYŁĄCZNIE LIT i xyz:GOLD. Jakikolwiek inny coin — AVAX, DOGE, TRUMP — jest automatycznie ignorowany. Nawet jeśli API glitch usunie baseline, nawet jeśli state file się zepsuje — whitelist jest twardym limitem.

### Whitelist vs Blocklist

| Podejście | Mechanizm | Bezpieczeństwo |
|-----------|-----------|----------------|
| **Blocklist** (`COPY_BLOCKED_COINS`) | Blokuj wymienione coiny, kopiuj resztę | Nowy coin = automatycznie skopiowany |
| **Whitelist** (`COPY_ALLOWED_COINS`) | Kopiuj TYLKO wymienione, ignoruj resztę | Nowy coin = automatycznie ignorowany |

**Whitelist jest ZAWSZE bezpieczniejszy** w copy-tradingu. Generał handluje ~10 coinami. Chcesz kopiować 2. Blocklist wymaga wymienienia 8 coinów + każdego nowego. Whitelist wymaga wymienienia 2. Prosta matematyka ryzyka.

### Trzeci bug — PM2 env var propagation

Po dodaniu `COPY_ALLOWED_COINS` do `ecosystem.config.cjs`, restartujemy:
```bash
pm2 restart copy-general --update-env
```

Bot loguje: `Allowed coins: (all)` — whitelist nie zadziałał!

**Dlaczego?** `--update-env` czyta env vars z **shell environment** (export, .bashrc), NIE z `ecosystem.config.cjs`. To PM2-owa pułapka którą łatwo przeoczyć.

**Fix:**
```bash
pm2 delete copy-general
pm2 start ecosystem.config.cjs --only copy-general
```

`pm2 start` z plikiem config ZAWSZE czyta env z tego pliku.

### Czwarty bug — brakujące dotenv

Po `pm2 delete + pm2 start`, bot crashuje: "COPY_PRIVATE_KEY is required for --live mode!"

Klucz prywatny jest w `.env` pliku. Ale skrypt w `scripts/` nie ładuje automatycznie `.env`! Stary PM2 proces miał klucz w swoim environment (z poprzedniego `pm2 start`), ale nowy proces zaczyna z czystym środowiskiem.

**Fix:**
```typescript
import { config as dotenvConfig } from 'dotenv'
dotenvConfig()  // Załaduj .env zanim sprawdzisz COPY_PRIVATE_KEY
```

### Chronologia jednego popołudnia (wersja skrócona)

| Czas | Wydarzenie | Lekcja |
|------|-----------|--------|
| 12:00 | "Mają być tylko 2 kopie!" | User zauważa problem |
| 12:05 | Usunięto 5 wpisów z activeCopies | **BŁĄD** — kasowanie pamięci |
| 12:06 | Bot otworzył 5 nowych kopii ($2,500) | Katastrofa |
| 12:07 | User zamyka ręcznie, wściekły | Lekcja o baseline |
| 12:10 | Dodano baseline: true, stop bot | Prawidłowy fix #1 |
| 12:15 | Dodano COPY_ALLOWED_COINS | Fix #2 |
| 12:20 | `--update-env` nie ładuje z config | Pułapka PM2 |
| 12:25 | `pm2 delete + start` → brak klucza | Pułapka dotenv |
| 12:30 | Dodano dotenv import | Fix #4 |
| 12:35 | Bot działa poprawnie | Sukces |
| 18:00 | 6h uptime, zero błędów | Potwierdzone |

### Lekcje

1. **Stan bota = pamięć. Nie kasuj, oznaczaj.** `baseline: true` > usuwanie wpisu. Skasowana pamięć = powtórzone błędy.

2. **Whitelist > Blocklist w copy-tradingu.** Mniej do pamiętania, automatyczna ochrona przed nowymi coinami. Jeśli znasz listę "co chcę", whitelist. Jeśli znasz "czego nie chcę" (a reszta OK), blocklist.

3. **PM2 `--update-env` to pułapka.** Czyta z shell, nie z config. Jeśli dodałeś nowy env var do `ecosystem.config.cjs`, musisz `pm2 delete + pm2 start ecosystem.config.cjs`.

4. **dotenv nie jest automatyczny.** Skrypty w `scripts/` (uruchamiane przez PM2 via `npx tsx`) nie mają dostępu do `.env` bez explicit `dotenvConfig()`. Główny bot (`src/mm_hl.ts`) ma to przez ts-node loader, ale standalone skrypty nie.

5. **Testuj na suchym biegu (--dry-run) zanim zmienisz stan.** Gdybyśmy najpierw usunęli wpisy w dry-run mode, zobaczylibyśmy "5 NEW positions detected" w logach bez otwierania realnych pozycji.

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `scripts/general_copytrade.ts` | `allowedCoins` whitelist, dotenv import (+12 linii) |
| `ecosystem.config.cjs` | `COPY_ALLOWED_COINS: "LIT,xyz:GOLD"`, usunięto mm-follower (-28 linii) |

---

## Rozdział 34: Nie Shortuj Na Oślep — Jak Spread i Timing Decydują o Zysku (02.03.2026)

### Problem

kPEPE (memecoin, 5x leverage, ATR ~1.8%) miał potężne swingi 5-10% w obie strony na godzinnych świecach. Bot łapał shorty za wcześnie — zamiast czekać na opór, wchodził na każdym micro-ruchu.

Efekt? Adverse selection. Cena ruszała się 20-30bps w ciągu minuty, a bot miał spread 14bps (round-trip 28bps). Każdy ruch cenowy > 28bps oznaczał gwarantowaną stratę na round-tripie.

### Analogia: Rybak z za krótką siecią

Wyobraź sobie rybaka który łowi na rzece z rwącym prądem. Sieć (spread) musi być szersza niż prąd (volatility) — inaczej ryby (profitable trades) przepływają przez nią, a rybak łapie tylko śmieci (toxic flow).

Nasz bot miał siatkę 14bps szeroką na rzece z prądem 180bps (ATR 1.8%). Czyli **siatka 13x za wąska**. Każda "ryba" (ruch cenowy) przepływała przez nią i zostawiała nam stratę.

### Trzy niezależne fixy

#### 1. Dynamic Spread — szersza siatka dla memecoina

```
PRZED: lowVolL1Bps=14, highVolL1Bps=14 → L1 ZAWSZE 14bps (flat!)
PO:    kPEPE lowVol=22bps, highVol=32bps → L1 skaluje się z ATR

Round-trip PRZED: 28bps (za ciasno dla 180bps ATR)
Round-trip PO:    44-64bps (wystarczająco szerokie)
```

**Bug odkryty:** Sekcja 79 (01.03) zmieniła `lowVolL1Bps` z 28 na 14, ale `highVolL1Bps` też było 14. Oba identyczne = Dynamic Spread **wyłączony** — ATR nie miał żadnego wpływu na szerokość grida.

**Dodatkowy bug:** Clamp logic zakładał `highVol < lowVol` (ścieśniaj w high vol). Dla kPEPE jest odwrotnie — w high vol chcesz POSZERZYĆ (32bps > 22bps). Stary `Math.max(high, Math.min(low, x))` clampował w złą stronę.

#### 2. Momentum Guard — słuchaj resistance, nie momentum

Momentum Guard ma trzy sygnały, każdy z wagą:

| Sygnał | Stara waga | Nowa waga | Dlaczego zmiana |
|--------|-----------|-----------|-----------------|
| Momentum (1h change) | **50%** | **35%** | Laguje w choppy markets — cena już odbiła a 1h change nadal mówi "dump" |
| RSI | 30% | 30% | OK |
| Proximity S/R | **20%** | **35%** | Najbardziej wartościowy! Mówi "cena jest 0.3% od resistance — nie shortuj tu" |

Momentum laguje bo patrzy na **przeszłość** (zmiana za ostatnią godzinę). Proximity patrzy na **kontekst** (gdzie jesteś względem kluczowych poziomów). Dla memecoina w ranging market, proximity jest ważniejszy.

#### 3. Auto-Skew — GENTLER, nie agresywniej

Pierwsza wersja fixu zwiększyła Auto-Skew z 2.0 do 3.5 bps/10% skew. Przy -43% skew dawało +15bps shift — agresywne kupowanie do zamknięcia shorta.

User feedback: *"nie od razu zamykał pozycje"*. Bot ma TRZYMAĆ shorta, nie próbować go zamknąć. Zmieniono na jeszcze bardziej konserwatywne niż oryginał:

```
ORYGINAŁ:    2.0 bps/10%, max 15bps → przy -43% = +8.6bps shift
AGRESYWNY:   3.5 bps/10%, max 22bps → przy -43% = +15.1bps shift  ← ZA DUŻO
FINALNY:     1.5 bps/10%, max 10bps → przy -43% = +6.5bps shift   ← GENTLE
```

### Lekcja: Trzy warstwy ochrony timingu

```
┌─────────────────────────────────────────────────────────────┐
│  1. DYNAMIC SPREAD — "Jak daleko od ceny składać ordery?"   │
│     L1=32bps w high vol (nie 14bps!)                        │
│     → Mniej fills, ale każdy fill ma więcej buforu           │
├─────────────────────────────────────────────────────────────┤
│  2. MOMENTUM GUARD — "Czy to dobry moment?"                 │
│     Proximity 35% → blisko resistance? Redukuj asks         │
│     Momentum 35% → cena spada? Redukuj bidy                 │
├─────────────────────────────────────────────────────────────┤
│  3. AUTO-SKEW — "Mam pozycję, co teraz?"                    │
│     Gentle shift 1.5bps/10% → trzymaj, nie panikuj          │
│     Max 10bps → nawet przy -80% skew, delikatnie             │
└─────────────────────────────────────────────────────────────┘
```

### Klucz: Clamp direction matters

Standardowe instrumenty (BTC, ETH): w high vol → ŚCIEŚNIJ spread (łap więcej micro-moves).
Memecoiny (kPEPE): w high vol → POSZERZ spread (chroń się przed adverse selection).

To wymaga odwróconej logiki clampa:
```typescript
// Działa niezależnie od kierunku (high > low LUB low > high)
const minL1 = Math.min(cfg.lowVolL1Bps, cfg.highVolL1Bps)
const maxL1 = Math.max(cfg.lowVolL1Bps, cfg.highVolL1Bps)
l1Bps = Math.max(minL1, Math.min(maxL1, Math.round(l1Bps)))
```

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `src/config/short_only_config.ts` | kPEPE DynamicSpread override (22/32bps), Auto-Skew gentler (1.5/10bps) |
| `src/mm_hl.ts` | Clamp fix (direction-agnostic), MG weights (35/30/35) |

---

## S/R Progressive Reduction — nie trzymaj pełnej pozycji przy wsparciu

> "Generał nie wysyła całej armii pod mury twierdzy. Im bliżej murów, tym mniej żołnierzy na froncie — reszta zbiera łupy."

### Problem: bot nie brał profitu

Wyobraź sobie sytuację: kPEPE ma SHORT pozycję -43% skew ($3,583). Cena spada — świetnie, SHORT zarabia. Ale zamiast stopniowo zamykać shorta i brać profit, bot kontynuował budowanie pozycji aż do support level. Przy wsparciu miał PEŁNEGO shorta zamiast max 20%.

To jak jechanie z górki na nartach i nie hamowanie — fajnie dopóki nie trafisz na płaski teren (support), a wtedy cena może się odbić i zabrać cały profit.

**Momentum Guard** już redukował ask SIZE (ask×0.35 przy dump), ale to za mało. Nawet przy zredukowanych askach: $280/tick × 100 ticków = ogromna pozycja. Brakowało mechanizmu który **AKTYWNIE** zamyka pozycję w miarę zbliżania się do S/R.

### Rozwiązanie: stopniowe zamykanie w "strefie redukcji"

```
                 STREFA REDUKCJI (2.5 × ATR = ~4.5%)
     ┌────────────────────────────────────────────────┐
     │                                                │
  Początek strefy                              Support Level
  (progress=0%)                                (progress=100%)
     │                                                │
     │  ask × 1.0     ask × 0.52     ask × 0.0       │
     │  bid × 1.0     bid × 1.48     bid × 2.0       │
     │                                                │
     │  "Normalny MM"  "Zamykam"     "Tylko zamykam"  │
     └────────────────────────────────────────────────┘
                    ↑ cena tutaj (48% through)

  Gdy |skew| <= 20% → DISENGAGED → normalny MM
  (pozycja już wystarczająco mała, MG proximity obsłuży bounce/break)
```

### Matematyka (prosta!)

```
reductionZone = mgStrongZone × srReductionStartAtr
                = 1.8% × 2.5 = 4.5% od support

progress = 1 - (odległość od support / reductionZone)
         = 1 - 2.34% / 4.5% = 0.48 (48%)

Gdy |skew| > 20% (pozycja duża):
  ask × (1 - progress)                    = ask × 0.52 (mniej nowych shortów)
  bid × (1 + progress × (boost - 1))      = bid × 1.48 (więcej zamknięć)

Połączenie z MG dump (bid×1.15, ask×0.40):
  Finał: bid × 1.71, ask × 0.21
  → Agresywne zamykanie, minimalne nowe shorty
```

### Dwa stany: REDUCING vs DISENGAGED

| Stan | Warunek | Co robi |
|------|---------|---------|
| **REDUCING** | Cena w strefie + \|skew\| > 20% | Progresywnie zamyka pozycję |
| **DISENGAGED** | Cena w strefie + \|skew\| <= 20% | Normalny MM — pozycja już mała |

To jest kluczowe: gdy bot zredukuje pozycję do 20% (np. z -43% na -18%), **wyłącza się**. Potem MG proximity obsługuje bounce/break przy support normalnym gridem obu stron.

### Dlaczego to działa z resztą pipeline

```
┌──────────────────────────────────────────────────────────────┐
│ MOMENTUM GUARD: "Cena spada → ask×0.40, bid×1.15"           │
│   ↓ (multiplicative)                                        │
│ S/R REDUCTION: "Blisko support → ask×0.52, bid×1.48"        │
│   ↓                                                         │
│ FINAŁ: ask = 0.40 × 0.52 = 0.21 (prawie zero nowych)       │
│        bid = 1.15 × 1.48 = 1.71 (agresywne zamykanie)      │
│                                                              │
│ Oba systemy zgadzają się: "stop shorting at support!"        │
└──────────────────────────────────────────────────────────────┘
```

S/R Reduction jest **multiplicative** — mnoży na wierzch MG multiplierów. Gdy MG mówi "dump → redukuj aski" a S/R mówi "near support → redukuj aski" — efekt się kumuluje. Zero konfliktu.

### Analogia wojskowa

Generał prowadzi natarcie (SHORT). Armia posuwa się naprzód (cena spada). Ale przed twierdzą wroga (support) Generał nie atakuje pełnymi siłami. Stopniowo wycofuje oddziały:

- **Daleko od twierdzy**: Pełna ofensywa (normalny grid)
- **4.5% od twierdzy**: Zaczyna wycofywać tylne oddziały (reduce asks 20%)
- **2% od twierdzy**: Większość się wycofuje, zostaje straż tylna (reduce asks 50%)
- **Przy murach**: Tylko zwiad i zbieranie łupów (bid boost, ask≈0, pozycja ≤20%)

Gdy armia się skurczy do 20% → Generał ocenia sytuację: czy przebić mury (breakout) czy się wycofać (bounce)?

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `src/config/short_only_config.ts` | 4 nowe pola w `MomentumGuardConfig` + defaults + kPEPE override |
| `src/mm_hl.ts` | ~55 linii po MG log, przed Dynamic TP |

---

## S/R Mean-Reversion Cycle — pelny cykl kupuj dol, sprzedaj gore

> "Kupuj wsparcie, sprzedawaj opor" — najstarsza zasada tradingu. Problem w tym, ze latwiej to powiedziec niz zaprogramowac.

### Problem: S/R Reduction to dopiero polowa

Wyobraz sobie ze masz siatkówke. S/R Reduction (#89) to gracz ktory potrafi ODBIC pilke — gdy kPEPE SHORT schodzi do support, bot zaczyna zamykac pozycje (odbija pilke do gory). Swietnie.

Ale po odbiciu piłka leci w gore... i bot stoi. Nie ustawia sie pod nastepne uderzenie. Nie przygotowuje sie na przyszly support. Nie zamyka pozycji agresywnie gdy piłka leci szybko.

Brakowalo dwoch elementow:
1. **S/R Accumulation** — "ustaw sie pod pilke" (buduj pozycje przy S/R gdy jestes maly/plaski)
2. **Breakout TP** — "smecz!" (agresywnie zamknij gdy momentum jest silny)

### Pelny cykl — jak to teraz dziala

```
         ┌─────────────────────────────────────────────┐
    [7]  │                                             │  [4]
   SUPPORT                                        RESISTANCE
    ↓ S/R Reduction zamyka shorty                    ↓ S/R Reduction zamyka longi
    ↓ S/R Accumulation buduje LONGI      ←───────── ↓ S/R Accumulation buduje SHORTY
    │                                             │
    │  [2] Normalny MM                            │  [5] Normalny MM
    │  MG + Auto-Skew zamyka czesc longow         │  MG + Auto-Skew zamyka czesc shortow
    │                                             │
    │  [3] Mocny pump →                           │  [6] Mocny dump →
    │  BREAKOUT TP: agresywnie zamknij longi! 🚀  │  BREAKOUT TP: agresywnie zamknij shorty! 🚀
    │                                             │
    └───────────────→ cena rosnie ───────────────→┘
                                                  ↓
                     cena spada ←─────────────────┘
```

To jest **pełny cykl mean-reversion** — bot ciągle oscyluje między wsparciem a oporem, budując pozycje na S/R i zamykając je w środku zakresu lub na breakout.

### S/R Accumulation — "kupuj wsparcie, shortuj opor"

**Kiedy sie uruchamia:** Cena blisko S/R + mala/zerowa pozycja (`|skew| <= 20%`).

To jest lustrzany warunek S/R Reduction: Reduction handles duzych (`|skew| > 20%`), Accumulation handles malych (`|skew| <= 20%`). Nigdy oba naraz dla tego samego S/R.

**Przy SUPPORT (buduj LONGI):**
```
bid size  × 1.5  (50% wiecej kupowania — "kupuj dip przy wsparciu")
ask size  × 0.5  (50% mniej sprzedawania — "nie sprzedawaj tanio")
bid spread × 1.3  (30% szerzej — "kupuj PONIZEJ wsparcia, zlap wick")
```

**Przy RESISTANCE (buduj SHORTY):**
```
ask size  × 1.5  (50% wiecej sprzedawania — "shortuj gore przy oporze")
bid size  × 0.5  (50% mniej kupowania — "nie kupuj drogo")
ask spread × 1.3  (30% szerzej — "sprzedawaj POWYZEJ oporu, zlap wick")
```

**Dlaczego widen spread?** Bo chcemy kupowac/sprzedawac NA lub ZA S/R, nie przed. Wick probe (szybkie przebiecie wsparcia) to idealna okazja — szersza siatka lapie te poziomy.

**Progresywny efekt** — im blizej S/R, tym silniejszy:
```
5% od support → progress=0% → zadna zmiana
3% od support → progress=33% → bid×1.17, ask×0.83
1% od support → progress=78% → bid×1.39, ask×0.61
NA support    → progress=100% → bid×1.50, ask×0.50, bidSpread×1.30
```

### Breakout TP — "smecz!"

**Kiedy sie uruchamia:** Silny momentum (|score| > 0.50) + pozycja po wlasciwej stronie.

To jest moment "zabieraj zyski i nie czekaj na odwrocenie". Gdy kPEPE ma LONG i cena robi pump +4% — nie czekaj na szczyt. Agresywnie sprzedawaj.

**LONG + mocny pump (score > 0.50):**
```
ask size × 1.50  (50% wiecej sprzedawania — "zamykaj longi z zyskiem!")
bid size × 0.67  (33% mniej kupowania — "nie dokupuj na gorce")
```

**SHORT + mocny dump (score < -0.50):**
```
bid size × 1.50  (50% wiecej kupowania — "zamykaj shorty z zyskiem!")
ask size × 0.67  (33% mniej sprzedawania — "nie dodawaj shortow na dnie")
```

**Multiplicative z MG:** Momentum Guard juz robi cos podobnego (pump → bid×0.10, ask×1.30). Breakout TP mnozy na wierzch. Efekt:
```
MG strong pump:     bid×0.10, ask×1.30
× Breakout TP LONG: bid÷1.50, ask×1.50
= Combined:         bid×0.067, ask×1.95

→ Prawie ZERO kupowania + prawie 2× normalnej sprzedazy
→ Maximum selling pressure, maximum profit-taking
```

### kPEPE tuning — bardziej agresywny

kPEPE jest volatilny memecoin — bounce od supportu i dump od resistance sa gwaltowne. Dlatego:
- `srAccumBounceBoost: 1.8` (zamiast 1.5) — 80% wiecej na bounce side (silne odbicia)
- `srBreakoutTpScoreThreshold: 0.40` (zamiast 0.50) — trigger wczesniej (momentum jest prawdziwy wczesniej)

### Przyklad pelnego cyklu kPEPE

**Faza 1 — Przy support, pozycja sprowadzona do 10% (po S/R Reduction):**
```
S/R(1h): R=$0.003732 S=$0.003418, ATR=1.8%
price=$0.003430 (0.35% od support), zone=4.5%
|skew|=10% <= 20% → S/R ACCUMULATION ACTIVE

bid × 1.74   ← agresywne kupowanie przy support
ask × 0.54   ← mniejsza sprzedaz
bidSpread × 1.28 ← kupuj ponizej support (zlap wick)

Combined z MG dump (bid×1.30, ask×0.10):
→ Final: bid×2.26, ask×0.05 ← ULTRA-agresywne kupowanie!
```

**Faza 2 — Cena rosnie, srodek zakresu:**
```
price=$0.003580 (4.7% od support > zone 4.5%)
→ S/R Accumulation wyłączone (za daleko)
→ Normalny MM, Auto-Skew naturalnie zamyka longi
```

**Faza 3 — Silny pump, momentumScore=+0.72:**
```
Breakout TP: LONG + score 0.72 > 0.40 → ACTIVE!
ask × 1.50, bid × 0.67

Combined z MG (bid×0.10, ask×1.30):
→ Final: bid×0.067, ask×1.95 ← maximum selling, close longs!
```

**Faza 4 — Przy resistance, pozycja prawie zamknieta:**
```
S/R Reduction → zamknij reszte longow
S/R Accumulation → buduj SHORTY przy resistance
```

**Faza 5-7: Mirror w dol → cykl sie powtarza.**

### Interakcje z innymi systemami

| System | Co robi | Jak wspolgra |
|--------|---------|-------------|
| **MG multipliers** | Asymetryczny grid wg momentum | Multiplicative — oba wzmacniaja ten sam kierunek |
| **S/R Reduction** | Zamyka duze pozycje przy S/R | Complementary — Reduction: |skew|>20%, Accumulation: |skew|<=20% |
| **Dynamic TP** | Poszerza spread przy micro-reversal | Accumulation poszerza po drugiej stronie — brak konfliktu |
| **Inventory SL** | Panic close underwater | Accumulation buduje NOWE pozycje (nie underwater) |
| **Auto-Skew** | Przesuwa mid wg skew | Po accumulation skew rosnie → Auto-Skew lekko przesuwa — naturalne |

### Lekcja inzynierska: Complementary vs Conflicting systems

Dwa systemy moga byc:
- **Conflicting** — walcza ze soba (np. stary Position-Aware Guard vs MG mean-reversion)
- **Complementary** — pokrywaja rozne scenariusze (S/R Reduction + Accumulation)

Klucz: warunki MUSZA byc rozlaczne. S/R Reduction fires when `|skew| > 20%`, Accumulation fires when `|skew| <= 20%`. Matematycznie niemozliwe zeby oba dzialaly jednoczesnie na tym samym S/R. Zero edge cases, zero konfliktow.

Breakout TP tez jest complementary z MG — oba chca tego samego (close profitable position on strong momentum), ale TP dodaje extra boost. Multiplicative = oba wzmacniaja efekt, zamiast sie nadpisywac.

**Anti-pattern (z naszej historii):** Position-Aware Guard (v2) NADPISYWAL MG multiplier (`skipAskReduce=true` → ask×1.0 zamiast ask×0.10). To byl conflicting system — musielismy go usunac w v3. Lekcja: **nigdy nie nadpisuj, zawsze mnoż**.

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `src/config/short_only_config.ts` | 7 nowych pol: srAccumulationEnabled, srAccumBounceBoost, srAccumCounterReduce, srAccumSpreadWiden, srBreakoutTpEnabled, srBreakoutTpScoreThreshold, srBreakoutTpClosingBoost |
| `src/mm_hl.ts` | ~62 linii: S/R Accumulation + Breakout TP bloki po S/R Reduction, przed Dynamic TP |

---

## Inventory-Aware MG Override — gdy bot utknal i nie moze sie ruszyc

### Problem: 8 godzin ciszy

Wyobraz sobie taka sytuacje: bot ma SHORT na kPEPE (skew -38%), cena zaczyna rosnac. Momentum Guard widzi "pump" i mysli: "zmniejsz bidy, nie kupuj na szczytach!". Logiczne, prawda?

Ale jest haczyk. **Bot potrzebuje bidow zeby ZAMKNAC shorta.** MG nie wie o pozycji bota — widzi tylko kierunek rynku. Efekt:

```
MG: "Pump! Zmniejsz bidy!" → bid×0.78
Bot: "Ale ja mam SHORT -38% i potrzebuje bidow zeby sie zamknac..."
MG: "Nie moj problem. Pump = nie kupuj."

Wynik: ZERO fills przez 8+ godzin. Bot zamrozony.
```

To jak powiedziec strazakowi "nie lej wody bo deszcz pada" — deszcz to nie pozar, a bidy to nie spekulacja.

### Analogia: Helikopter ratunkowy

Wyobraz sobie helikopter ratunkowy na morzu:
- **Normalnie** helikopter lata z predkoscia ekonomiczna (oszczedza paliwo)
- **Sztorm nadchodzi** → kontrola lotow mowi "zwolnij, nie ryzykuj"
- **Ale na morzu jest tonacy czlowiek** → helikopter MUSI leciec szybciej, mimo sztormu

Inventory-Aware MG Override to ta decyzja: "tak, jest sztorm (pump), ale mamy tonacego (SHORT -38%) i MUSI byc ratowany".

### Rozwiazanie: urgency-based floor

Kluczowy pomysl: **im glebiej utknal, tym wiecej pomocy dostaje**.

```
urgency = min(1.0, |skew| / 0.50)

|skew| = 15% → urgency = 30%  (lekko utknal → lekka pomoc)
|skew| = 30% → urgency = 60%  (mocno utknal → mocna pomoc)
|skew| = 38% → urgency = 76%  (bardzo utknal → duza pomoc)
|skew| = 50% → urgency = 100% (max → pelna moc)

minClosing = 1.0 + urgency × (closingBoost - 1.0)
```

Przy kPEPE (closingBoost = 1.5):
- skew -15% → minClosing = 1.15 (lekki boost)
- skew -38% → minClosing = 1.38 (solidny boost)
- skew -50% → minClosing = 1.50 (max boost)

### Co sie dzieje w praktyce

**Scenariusz z dzisiejszego dnia:**
```
kPEPE: skew=-38%, pump, score=+0.43

MG mowi: bid×0.78 ask×0.25  (redukuj bidy, wiecej askow)

Override sprawdza:
  |skew| = 38% > 15% (threshold) ✓
  pumpAgainstShort = true ✓
  urgency = 0.38/0.50 = 76%
  minClosing = 1.0 + 0.76 × 0.5 = 1.38
  bid(0.78) < minClosing(1.38) → OVERRIDE!

Po override: bid×1.38 ask×0.25
→ Bot sklada sensowne bidy → dostaje fills → zamyka shorta
```

### Self-correcting: sam sie wylacza

To jest piekne w tym rozwiazaniu — nie trzeba go recznie wylaczac:

```
Faza 1: skew=-38% + pump
  → Override aktywny, bid×1.38
  → Bot zamyka shorta, fills ida

Faza 2: skew spada do -20%
  → Override nadal aktywny ale slabszy (urgency=40%, minClosing=1.20)

Faza 3: skew spada do -14%
  → |skew| < threshold(15%) → Override WYLACZA SIE
  → Normalny MG przejmuje: pump → bid×0.10 ask×1.30
  → S/R Accumulation moze budowac nowa pozycje

Faza 4: skew ~0%
  → Pelny normalny market making
  → Aski dominuja (pump → ask×1.30)
```

System jak termostat — wlacza grzanie gdy za zimno, wylacza gdy temperatura OK.

### Gdzie to siedzi w pipeline

```
MG Score → Multipliers (bid/ask wg momentum)
  ↓
⚡ INVENTORY-AWARE MG OVERRIDE (NOWE)
  ↓
MG Log (teraz pokazuje skorygowane wartosci)
  ↓
S/R Progressive Reduction → S/R Accumulation → Breakout TP → ...
```

Override jest po MG ale PRZED wszystkimi innymi systemami. Dlaczego? Bo ustawia FLOOR (minimum) dla closing side. Dalsze systemy (S/R Reduction, Breakout TP) moga TYLKO zwiekszyc — nigdy nie zmniejsza pod floor. Multiplicative = kazdy nastepny mnozy na wierzch.

### Lekcja inzynierska: Floor vs Override

Poprzedni Position-Aware Guard (v2) NADPISYWAL multiplier (`ask×1.0` zamiast `ask×0.10`). To byl override — brute force.

Inventory-Aware MG ustawia **floor** (minimum). Jesli MG juz daje dość (np. bid×1.50 bo dump), override nic nie zmienia (`bid > minClosing → skip`). Zmienia TYLKO gdy MG daje za malo.

```
Override:  "Zrob X"                    → ignoruje kontekst
Floor:     "Zrob MINIMUM X, reszta OK" → szanuje kontekst
```

Floor jest bezpieczniejszy bo:
- Nie walczy z innymi systemami
- Nie tworzy edge cases
- Dziala TYLKO gdy potrzebny
- Jest transparentny (log: "CLOSING OVERRIDE" vs cisza)

### Lekcja biznesowa: Deadlock detection

Ten bug (8h ciszy) byl klasycznym **deadlockiem** — dwa systemy (MG + Auto-Skew) dzialaly poprawnie INDYWIDUALNIE, ale RAZEM tworzily patowa sytuacje:

| System | Co robil | Sam OK? | W kombinacji? |
|--------|----------|---------|---------------|
| MG | bid×0.78 (nie kupuj na pumpie) | ✓ | ✗ (bot potrzebuje bidow!) |
| Auto-Skew | +4.5bps shift (lekko przesuwa grid) | ✓ | ✗ (za malo na -38% skew) |

Kazdy system jest poprawny w izolacji. Problem pojawia sie dopiero przy ekstremalnym skew + momentum w zla strone. To dlatego testing individual components is not enough — musisz testowac **interakcje miedzy systemami**.

Jak wykryc deadlocki:
1. **Watchdog** — "No fills detected for 7.0h" → cos jest nie tak
2. **Log analysis** — jesli bid×0.78 a skew=-38%, powinien ktos krzyknac
3. **Invariant checking** — "jesli |skew| > 30% i closing-side multiplier < 1.0, to jest bug"

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `src/config/short_only_config.ts` | 3 nowe pola: inventoryAwareMgEnabled, inventoryAwareMgThreshold, inventoryAwareMgClosingBoost + kPEPE override (1.5) |
| `src/mm_hl.ts` | ~30 linii po MG multiplierach: urgency calc, minClosing floor, override logic, updated MG log z ⚡INV_AWARE flag |

---

## Rozdzial 44: S/R Discord Alerts — "Hej, cena jest przy oporze!" (04.03.2026)

### Problem: Bot widzi, ale nie mowi

Wyobraz sobie, ze masz asystenta ktory siedzi przed monitorem 24/7 i patrzy na wykresy. Widzi kazdy ruch ceny. Wie dokladnie gdzie jest support i resistance. Ale... nie mowi ci o tym. Musisz sam wejsc na serwer, otworzyc logi, i szukac odpowiedniej linijki.

Tak wlasnie wygladal nasz bot. Momentum Guard obliczal `mgProxSignal` — proximity do S/R — od tygodni. Uzywal go do asymetrycznego grida (redukuj bidy blisko resistance, redukuj aski blisko support). Ale user (Jerry) nie dostawal zadnego powiadomienia. Musial czytac logi PM2 z serwera zeby zobaczyc "ah, kPEPE jest 0.8% od resistance".

### Rozwiazanie: Discord embeds

Discord ma swietna feature — **embeds**. Zamiast zwyklego tekstu, mozesz wyslac kolorowa karteczke z polami, tytulami, kolorami i timestampami. Wyglada jak mini-dashboard w wiadomosci.

Stworzylem `src/utils/discord_notifier.ts` — prosty modul wzorowany na `slack_router.ts` (ktory juz istnial). Wzorzec jest identyczny:
1. Czytaj webhook URL z env var (`DISCORD_WEBHOOK_URL`)
2. POST JSON na ten URL
3. Jesli blad — loguj, nie crashuj

Roznica: Discord uzywa `embeds` array zamiast `text` field jak Slack.

### 4 typy alertow

| Typ | Kolor | Kiedy |
|-----|-------|-------|
| ABOVE_RESISTANCE | Czerwony | Cena przelamala opor (bullish breakout) |
| NEAR_RESISTANCE | Czerwony | Cena w strong zone (1×ATR) od oporu |
| BELOW_SUPPORT | Zielony | Cena przelamala wsparcie (bearish breakdown) |
| NEAR_SUPPORT | Zielony | Cena w strong zone (1×ATR) od wsparcia |

Dlaczego strong zone a nie moderate? Bo moderate zone (2×ATR) to za duzo — cena moze byc 3.6% od S/R i nadal triggerowac alert. Strong zone (1×ATR, ~1.8% dla kPEPE) to range w ktorym cena naprawde "jest blisko" i moze sie odwrocic lub przelamac.

### Cooldown — nie spamuj

Najwieksze wyzwanie z alertami: **spam**. Main loop bota biegnie co 90 sekund. Jesli cena jest 0.5% od resistance, bot wyslalby alert co 90s = 40 alertow na godzine. Discord by cie znienawidzil.

Rozwiazanie: `srAlertCooldowns` Map z 30-minutowym cooldownem per token per alert type. Klucz: `kPEPE:NEAR_RESISTANCE`. Po wyslaniu alertu, nastepny moze pojsc dopiero za 30 minut.

Dlaczego 30 min a nie 60? Bo 60 min moze byc za dlugo — rynek moze odejsc od S/R i wrocic w ciagu godziny, i chcesz to wiedziec. 30 min to kompromis miedzy informacja a spamem.

### Fire-and-forget pattern

```typescript
sendDiscordEmbed({ ... }).catch(() => {})
```

Ten `.catch(() => {})` jest kluczowy. Discord webhook moze byc down, rate-limited, albo URL moze byc zly. Nie chcemy zeby blad Discorda zatrzymal bota. Alert jest "nice to have" — trading jest "must have". Wiec wysylamy i zapominamy.

To samo robimy z logowaniem — `console.log` idzie niezaleznie od Discorda. Nawet jesli Discord nie dziala, log jest w PM2.

### Lekcja: Separation of Concerns

Ten feature to doskonaly przyklad czystego separation of concerns:

1. **MG (Momentum Guard)** oblicza `mgProxSignal` — to jego robota (analiza)
2. **S/R Alert** czyta `mgProxSignal` i wysyla powiadomienie — to jego robota (notyfikacja)
3. **Discord Notifier** wysyla HTTP POST — to jego robota (transport)

Kazdy robi jedno i robi to dobrze. MG nie wie o Discordzie. Discord Notifier nie wie o S/R. S/R Alert laczy oba.

Gdybysmy chcieli dodac alerty na Telegram, Slack, email — zmieniamy TYLKO transport layer (nowy plik jak `telegram_notifier.ts`). Logika S/R i MG zostaje bez zmian.

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `src/utils/discord_notifier.ts` | NOWY — `sendDiscordMessage()` + `sendDiscordEmbed()`, czyta `DISCORD_WEBHOOK_URL` |
| `src/mm_hl.ts` | +65 linii: import, `srAlertCooldowns` Map, alert logic po `mgProxSignal`, 30min cooldown |

---

## Rozdział 45: Wyrzucanie balastu — usunięcie 3 mechanizmów które paraliżowały bota

### Problem: bot utknął na -38% skew przez 8 godzin

Wyobraź sobie samochód z 6 systemami kontroli trakcji, z których 3 ciągną kierownicę w lewo, 2 w prawo, a 1 jest wyłączony. Samochód jedzie prosto — ale nie dlatego że wszystko działa, tylko dlatego że siły się znoszą. A gdy się nie znoszą? Samochód stoi w miejscu.

Dokładnie to się stało z botem kPEPE. Miał -38% skew (ogromna pozycja SHORT) i powinien ją zamykać — kupować żeby wrócić do równowagi. Ale przez 8+ godzin miał **ZERO fills**. Watchdog krzyczał: "No fills detected for 8.0h".

### Diagnoza: za dużo kucharzy

Trzy mechanizmy wprowadzały chaos:

**1. Inventory Deviation** — "zmień rozmiar orderów gdy skew > 5%"
- Pomysł dobry, ale był BYPASSED dla PURE_MM (kPEPE). Kod: `if (!isSignalEnginePureMmInv && inventoryDeviation > 0.05)` — ten `!isSignalEnginePureMmInv` oznaczał "nie rób tego dla PURE_MM". Efekt: zero.

**2. AlphaEngine multipliers** — "reaguj na real-time SM ruchy"
- AlphaEngine śledziła 83 whale pozycji co minutę i modyfikowała bid/ask multipliery. Problem: to był "szum taktyczny" — 3 wieloryby redukują shorty, a 10 innych trzyma. AlphaEngine panikuje, bot zmienia multipliery, pozycja rośnie zamiast maleć.
- Doktryna Wojenna mówi jasno: **Strategia (whale_tracker snapshot) wygrywa z Taktyką (AlphaEngine stream)**.

**3. SM Direction permissions** — "blokuj counter-SM stronę"
- Gdy SM shortują → `allowLongs = false` → bot nie może składać bidów → nie może ZAMKNĄĆ shorta!
- To był najgorszy z trzech. Chciał chronić pozycję, a w praktyce paraliżował zamykanie.

### Rozwiązanie: usunąć, nie naprawiać

Zamiast dodawać kolejne `if` i `else if` do łatania bypasses — usunęliśmy mechanizmy kompletnie. -90 linii kodu.

```
PRZED (6 systemów rebalancing, 3 martwe/szkodliwe):
  ✅ kPEPE Enhanced Inventory Skew (działa)
  ✅ Momentum Guard (działa)
  ✅ Auto-Skew (działa, ale za słaby sam)
  ❌ Inventory Deviation (bypassed dla PURE_MM)
  ❌ AlphaEngine (szum taktyczny)
  ❌ SM Direction (blokuje closing-side)

PO (3 systemy, wszystkie działają + 3 nowe z tej sesji):
  ✅ kPEPE Enhanced Inventory Skew
  ✅ Momentum Guard + Inventory-Aware MG Override (#92)
  ✅ Auto-Skew
  ✅ S/R Progressive Reduction (#89)
  ✅ S/R Accumulation (#90)
  ✅ Breakout TP (#90)
```

### Lekcja: mniej kodu = lepszy bot

To jest klasyczny przykład **"less is more"** w software engineering. Bot miał 6 systemów rebalancing z których 3 nie działały albo szkodziły. Usunięcie ich nie tylko naprawiło problem (bot teraz quotuje i łapie fills) ale też uprościło codebase o 90 linii.

> **Zasada:** Nie dodawaj nowego mechanizmu żeby naprawić bug w starym. Sprawdź czy stary jest potrzebny. Często odpowiedź brzmi "nie".

### Technikalia: co zostało i dlaczego

- `smDir` (SM direction) — zachowane, bo Pump Shield i FibGuard go potrzebują. Usunęliśmy tylko BLOKOWANIE permissions na tej podstawie.
- `isSignalEnginePureMmInv` — zachowane, bo Vision Skew, MIN_PROFIT i risk checks nadal go używają.
- Import `alphaEngineIntegration` — zachowany (`.getIsRunning()` sprawdzane w innych blokach). Usunięto tylko `getAlphaSizeMultipliers` i `shouldBypassDelay`.
- `signalEngineResultFso` → zamienione na `signalEngineResultInv` (identyczna logika, eliminacja duplikatu).

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `src/mm_hl.ts` | -90/+7 linii: usunięto Inventory Deviation, AlphaEngine, SM Direction blocking, HOLD_FOR_TP guard |

---

## MIN_PROFIT Deadlock — gdy dwa systemy bezpieczeństwa się nawzajem paraliżują

> **Lekcja:** Każdy system bezpieczeństwa ma sens sam w sobie. Ale dwa systemy bezpieczeństwa razem mogą stworzyć deadlock gorszy niż brak jakiegokolwiek.

### Kontekst: co to jest MIN_PROFIT?

MIN_PROFIT to filtr, który chroni bota przed zamykaniem pozycji **ze stratą na fees**. Na Hyperliquid płacisz 3.5bps (0.035%) za każdy fill. Jeśli zamkniesz shorta na cenie bliskiej entry, fee zje cały "zysk" i wyjdziesz na minus.

MIN_PROFIT mówi: "nie składaj bida (zamykającego shorta) jeśli cena bida jest zbyt blisko entry price — czekaj aż cena spadnie dalej, żeby zamknięcie było opłacalne po odliczeniu fees."

Konkretnie: `maxBidPrice = entryPrice × (1 - 0.001)` — bid musi być co najmniej 10bps poniżej entry żeby przejść filtr.

### Problem: underwater SHORT

kPEPE miał pozycję SHORT:
- **Entry:** $0.003527 (tu otworzył shorta)
- **Aktualna cena:** $0.003710 (cena WZROSŁA — short underwater)
- **maxBidPrice:** $0.003527 × 0.999 = $0.003524

Wszystkie bidy grida są wokół aktualnej ceny ($0.003690+). Każdy bid >> $0.003524. MIN_PROFIT filtruje **WSZYSTKIE** bidy → zero buy orderów.

To ma sens w izolacji! Bot nie powinien zamykać shorta drożej niż otworzył (bo strata). Ale...

### Drugi system: INVENTORY_SL

INVENTORY_SL to "panic mode" — gdy pozycja jest za duża (|skew| > 40%) i underwater (drawdown > 2.5×ATR), bot przechodzi w tryb awaryjny: blokuje new-position side, podwaja closing-side.

INVENTORY_SL **bypassuje** MIN_PROFIT (bo panic close > fee optimization). Ale uruchamia się dopiero przy **40% skew**.

### Deadlock: luka 25-40%

```
|skew|    0%        15%        25%        40%        50%
          |          |          |          |          |
          |  normal  | MG/Skew  |  LUKA!   | PANIC    |
          |  MM      | rebalance|  ❌❌❌   | mode     |
          |          |          |          |          |
          |          |          | MIN_PROFIT| BYPASS   |
          |          |          | filtruje  | MIN_PROFIT|
          |          |          | ALL bids  |          |
```

kPEPE miał **38% skew** — za dużo na normalne MM (systemy rebalancing dawały bid×1.38 ale MIN_PROFIT filtrowało wszystko), za mało na panic mode (threshold 40%). **Deadlock.**

Wynik: **0 orderów przez 8+ godzin**. Bot żywy, serwer odpowiada, logi lecą, wszystkie systemy "działają" — ale zero faktycznych orderów na giełdzie. PnL: -$96.57 (fundingowe straty za trzymanie underwater shorta).

### Analogia: dwa zamki na drzwiach

Wyobraź sobie drzwi z dwoma zamkami. Zamek A (MIN_PROFIT) mówi "nie wychodź jeśli na dworze jest za zimno". Zamek B (INVENTORY_SL) mówi "jeśli dom się pali, otwórz zamek A". Ale zamek B reaguje dopiero gdy temperatura w domu przekroczy 100°C.

Co jeśli temperatura = 80°C? Dom się tli, dym leci, ale zamek B mówi "jeszcze nie panika". A zamek A mówi "na dworze za zimno, nie wychodź". **Zostajesz w tlącym się domu.**

### Fix v1: complete bypass (04.03) — ZA AGRESYWNY

```typescript
const highSkewBypassMinProfit = Math.abs(actualSkew) > 0.25
if (... && !inventorySlPanic && !highSkewBypassMinProfit) {
  // MIN_PROFIT filtering — completely skipped at >25% skew
}
```

Wyglądało genialnie. Bot natychmiast dostał 8 buy orderów i zaczął zamykać shorta. Ale...

**Katastrofa:** Bot zamknął 12 shortów na cenie $0.003679-$0.003713, vs entry $0.003527. To **430-530bps** straty na każdym close! 12 fills × ~$4.50 = **~$50 strat** w kilka minut.

Dlaczego? Bo complete bypass = "zamknij po DOWOLNEJ cenie". Bot nie sprawdzał jak daleko od entry jest bid — po prostu kupował na rynku. Zamieniliśmy jeden problem (deadlock) na inny (masowe straty na close).

### Lekcja: chirurgia, nie karabin maszynowy

To klasyczny pattern w programowaniu — "overcorrection". Problem: system za mocno filtruje. Naiwny fix: wyłącz filtr całkowicie. Ale filtr istniał z powodu! Wyłączenie go powoduje nowy problem.

Lepsze podejście: **graduate the response**. Zamiast ON/OFF, daj systemowi suwak.

### Fix v2: graduated max-loss cap (05.03)

```typescript
if (absSkew > 0.45) {
  effectiveMinProfitBps = -9999  // Full bypass — panic territory
} else if (absSkew > 0.25) {
  const urgency = (absSkew - 0.25) / 0.20  // 0.0 at 25%, 1.0 at 45%
  const maxAllowedLossBps = 50 + urgency * 100  // 50-150bps
  effectiveMinProfitBps = -maxAllowedLossBps
}
```

Teraz MIN_PROFIT nie jest ON/OFF. Ma **graduated response**:

| Skew | Max dozwolona strata | Co to znaczy |
|------|---------------------|--------------|
| < 25% | 0 (profit only) | Normalne — nie zamykaj na minus |
| 25% | 50bps (0.5%) | Mały skew — pozwól na małą stratę |
| 30% | 75bps (0.75%) | Rosnąca urgency |
| 38% | 115bps (1.15%) | Nasze kPEPE scenario |
| 45%+ | unlimited | Panic territory |

**Przykład kPEPE at 38% skew:**
- entry = $0.003527
- Max loss = 115bps → maxBidPrice = $0.003527 × 1.00115 = **$0.003568**
- Bidy na $0.003700 (490bps loss) → **ODRZUCONE** (za drogo!)
- Bidy na $0.003550 (65bps loss) → **DOZWOLONE** (w limicie 115bps)

Z v1 fix te $0.003700 bidy **przeszłyby** — i tak się stało, dlatego straciliśmy ~$50. Z v2 bot czeka na lepszą cenę albo na drop bliżej entry.

### Cztery warstwy ochrony (po v2 fixie)

| Skew | System | Co robi |
|------|--------|---------|
| 0-25% | MIN_PROFIT (10bps) | Nie zamykaj poniżej entry-10bps |
| 25-45% | **Graduated loss cap** | Pozwól na stratę 50-150bps (proporcjonalnie do urgency) |
| 45%+ | **Full bypass** | Zamykaj po dowolnej cenie (panic territory) |
| 40%+ & drawdown | `inventorySlPanic` | Panic mode — asks=0, bids×2 |

### Dlaczego ten bug przetrwał tak długo?

Bo dwa systemy testowane osobno działały idealnie:

1. **MIN_PROFIT sam** — chroni przed fee-eating na close orderach. Logiczny, testowany, działa.
2. **INVENTORY_SL sam** — chroni przed ekstremalnym skew. Logiczny, testowany, działa.

Nikt nie testował **interakcji** między nimi. W software engineering to się nazywa **"emergent bug"** — bug który nie istnieje w żadnym pojedynczym komponencie, a pojawia się dopiero gdy komponenty współpracują.

A potem naiwny fix (v1) stworzył **kolejny** bug — overcorrection. To dlatego dobrzy inżynierowie nie robią binarnych ON/OFF fixów na systemach bezpieczeństwa. Zawsze szukaj graduated response.

> **Zasada #1:** Każdy nowy system bezpieczeństwa powinien mieć odpowiedź na pytanie: "co jeśli inny system zablokuje to co ja odblokuję?"
>
> **Zasada #2:** Nigdy nie wyłączaj systemu bezpieczeństwa całkowicie. Zamiast tego, dostosuj jego parametry proporcjonalnie do urgency. Suwak, nie przełącznik.

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `src/mm_hl.ts` | Graduated MIN_PROFIT: `effectiveMinProfitBps` skalowane urgency skew |

---

## Fresh Touch Boost — silniejsza akumulacja na pierwszym dotknieciu S/R

### Analogia: Surfing

Wyobraz sobie surfera czekajacego na fale. Gdy przychodzi **pierwsza fala** po dlugim spokoju, surfer wskakuje z calych sil — wie, ze to swiezy set, pelno energii. Ale po trzeciej, czwartej fali z tego samego setu? Kazda nastepna jest slabsza, surfer mniej zaangazowany.

S/R Accumulation dzialalo jak surfer ktory traktuje kazda fale tak samo — pierwsza i czwarta mialy ten sam rozmiar bidow. A przeciez **pierwsze dotknięcie** supportu (gdy bot jest flat) to najlepszy moment na agresywna akumulacje!

### Problem

5 marca, 08:45 UTC. kPEPE po raz pierwszy dotyka supportu $0.003533. Bot jest prawie flat (skew ~0%). S/R Accumulation aktywuje sie:

```
🔄 [SR_ACCUM] kPEPE: SUPPORT → progress=90% skew=0% → bid×1.72 ask×0.50
```

Dobrze? Tak, ale **za slabo**. Cena odskoczyla ladnie w gore, ale bot zebral longów za zwykla ilosc ($172 zamiast $100 per level). Gdyby bid byl ×5 zamiast ×1.72, bot zebrałby 3× wiecej longow na tym idealnym pierwszym dotknieciu.

Problem: **trzecie dotknięcie** tego samego supportu (14:02 UTC) — skew juz 5% (bot kupil troche na pierwszym i drugim dotknieciu). Ale S/R Accumulation dawalo identyczna sile jak przy pierwszym! A przeciez:

- **Pierwsze dotknięcie** (skew 0%) = swiezy bounce, zadnej pozycji → wchodzmy z calej sily
- **Trzecie dotknięcie** (skew 5%) = juz mamy troche → normalny rozmiar

### Rozwiazanie: absSkew jako proxy dla "swiezosci"

Genialne w prostocie — **im mniejszy skew, tym swiezsze dotknięcie**. Zero pozycji = na pewno pierwsze dotknięcie. 8% pozycji (srMaxRetainPct) = juz nazbieralismy duzp, normalna sila.

```typescript
// freshRatio: 1.0 przy skew=0% → 0.0 przy skew=srMaxRetainPct
const freshRatio = max(0, (srMaxRetainPct - absSkew)) / srMaxRetainPct

// freshBoost: 3.0× przy skew=0% → 1.0× przy skew=8% (kPEPE)
const freshBoost = 1.0 + freshRatio * (srAccumFreshMultiplier - 1.0)

// Wzmocnione multipliery
const effectiveBounceBoost = srAccumBounceBoost * freshBoost   // 1.8 × 3.0 = 5.4×!
const effectiveCounterReduce = srAccumCounterReduce / freshBoost  // 0.50 / 3.0 = 0.17
```

### Tabela wartosci (kPEPE, progress=90%)

| Skew | freshBoost | bid× | ask× | Interpretacja |
|------|-----------|------|------|---------------|
| **0%** (flat) | **3.0×** | **×5.84** | **×0.17** | "Swiezy bounce! Wchodzmy z calej sily!" |
| 2% | 2.5× | ×5.04 | ×0.20 | "Prawie swiezy, nadal agresywnie" |
| 4% | 2.0× | ×4.24 | ×0.25 | "Pol drogi, solidna akumulacja" |
| 6% | 1.5× | ×2.68 | ×0.33 | "Juz blisko max, zwalniamy" |
| **8%** (max) | **1.0×** | **×1.72** | **×0.50** | "Max pozycja, normalny tryb" |

### Dlaczego to dziala

1. **Pierwszy bounce jest najsilniejszy** — statystycznie, pierwsze odbicie od S/R ma najwyzsza szanse na kontynuacje
2. **Risk/Reward najlepszy przy flat** — gdy nie masz pozycji, nie masz nic do stracenia. Przy 5% skew juz ryzykujesz
3. **Self-correcting** — im wiecej bot kupi (skew rosnie), tym wolniej kupuje. Naturalne wyhamowanie
4. **Counter-side tez sie adaptuje** — ask×0.17 przy flat = prawie zero sprzedazy. Nie oddawaj nic na pierwszym dotknieciu!

### Lekcja inzynierska

**Nie traktuj kazdej okazji tak samo.** W tradingu, w softwarze, w zyciu — pierwsza okazja czesto jest najlepsza. System ktory daje identyczna odpowiedz na kazdy sygnał marnuje najlepsze momenty.

Technika "proxy variable" — uzycie jednej zmiennej (skew) jako przyblizonego wskaznika innej (swiezosc dotknięcia S/R) to potezny pattern. Nie potrzebujesz zliczonego "ile razy dotknelimy support" — skew juz to koduje implicite.

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `src/config/short_only_config.ts` | +`srAccumFreshMultiplier` (default 2.0, kPEPE 3.0) |
| `src/mm_hl.ts` | freshBoost w SUPPORT i RESISTANCE blocks, `fresh×X.X` w logach |

---

## Rozdział 47: Nie Ufaj Knotowi Świecy — Jak Odróżnić Fakeout od Prawdziwego Przełamania (05.03.2026)

### Historia: kPEPE i problem z paniczną redukcją

Wyobraź sobie sytuację: bot trzyma longa na kPEPE. Cena spada i na sekundę przebija support ($0.003512). Bot panikuje — "SUPPORT PRZEBITY!" — i natychmiast zaczyna redukcję pozycji. Ale 30 sekund później cena wraca powyżej supportu. To był **fakeout** — knot świecy (wick) dotknął supportu, ale candle zamknęła się powyżej.

Bot właśnie oddał dobrą pozycję na fakeoucie. Teraz musi ją odbudować drożej.

To jest **fundamentalny problem danych tick-by-tick**: widzisz każde drgnięcie ceny w real-time, ale nie masz pojęcia czy ten ruch jest trwały. Cena dotknęła supportu na 3 sekundy — to przełamanie? Czy to tylko wick, który zaraz wróci?

### Rozwiązanie: "Poczekaj na zamknięcie świecy"

Każdy doświadczony trader powie ci tę samą zasadę: **"Nie reaguj na knoty. Czekaj na close."** To znaczy:

- **Tick price** (cena w danym momencie) = szum. Może skoczyć 2% w dół i wrócić w 10 sekund.
- **Candle close** (cena zamknięcia 15-minutowej świecy) = sygnał. Jeśli 15-minutowa świeca ZAMKNĘŁA SIĘ poniżej supportu, to rynek zdecydował — to nie wick, to realne przełamanie.

W kodzie to wygląda tak:

```
Tick price poniżej supportu = prox = -1.0 (AT SUPPORT)
Candle CLOSE poniżej supportu = prox = -1.2 (BROKEN SUPPORT)
```

Ta różnica 0.2 w wartości prox jest kluczowa — to różnica między "cena dotknęła supportu" a "support został potwierdzenie przebity".

### Skąd brać candle close?

Tu jest subtlenie — `candles15m[length-1]` to **forming candle** (jeszcze się tworzy, nie zamknęła). Używamy `candles15m[length-2]` — **ostatnia ZAMKNIĘTA candle**:

```typescript
// candles15m[-1] = FORMING (current, incomplete) — NIE UŻYWAJ do break detection!
// candles15m[-2] = LAST CLOSED (complete) — TO jest twój sygnał
lastCandle15mClose = candles15m[candles15m.length - 2].c
```

To częsty błąd początkujących — bierzesz `candles[-1]` myśląc że to "ostatnia świeca", a to jest świeca która jeszcze się formuje i może wyglądać zupełnie inaczej za 10 minut.

### Grace Period: "Daj mu szansę wrócić"

Nawet potwierdzone przebicie (candle close poniżej supportu) nie musi oznaczać katastrofy. Rynki często robią **false breakdowns** — jedna świeca zamyka poniżej, a następne dwie wracają powyżej.

Dlatego po BROKEN SUPPORT/RESISTANCE bot nie reaguje natychmiast. Zamiast tego startuje **Grace Period** — timer na 2-3 candle (30-45 minut):

```
TICK 1: Candle close poniżej supportu → prox = -1.2 → START GRACE (45 min)
TICK 2-10: Grace active → S/R Reduction SUPPRESSED (bot trzyma pozycję)
...
Scenariusz A: Cena wraca powyżej → prox > -1.2 → GRACE CLEARED → akumulacja kontynuuje
Scenariusz B: 45 min mija, cena dalej pod supportem → GRACE EXPIRED → redukcja dozwolona
```

To jest jak pięciosekundowa zasada w koszykówce — po faulu masz chwilę na podjęcie decyzji. Nie reaguj impulsywnie.

### Dlaczego kPEPE ma 3 candle (45 min) a default to 2 (30 min)?

Memecoiny jak kPEPE mają **więcej fakeoutów**. Wysoka zmienność oznacza, że cena regularnie przebija S/R na 1-2 świece i wraca. Na BTC czy ETH przebicie supportu to poważna sprawa — 2 świece wystarczą do potwierdzenia. Na kPEPE potrzebujesz 3, bo co drugi breakdown to trap.

```typescript
// Config
srReductionGraceCandles: 2,    // Default: 30 min — wystarczy dla majors
// kPEPE override:
srReductionGraceCandles: 3,    // 45 min — volatile memecoin, więcej fakeoutów
```

### Discord Alerts: BROKEN vs AT vs NEAR

Teraz Discord alerty rozróżniają trzy stany:

| Alert | Emoji | Co oznacza | Akcja |
|-------|-------|------------|-------|
| `NEAR_SUPPORT` | 🟡 | Cena w ATR-zone od supportu | Obserwuj |
| `AT_SUPPORT` | 🟢 | Tick price na supportcie (może być wick!) | Uwaga |
| `BROKEN_SUPPORT` | 💥 | Candle CLOSE poniżej = POTWIERDZONY break | Grace period startuje |

Pomarańczowy kolor (0xff8800) dla BROKEN — natychmiast przyciąga uwagę. Plus nowe pole "15m Close" w embed — widzisz dokładną cenę zamknięcia candle.

### Analogia: sędzia w piłce nożnej

Wyobraź sobie sędziego w piłce nożnej. Gracz pcha przeciwnika. Sędzia ma trzy opcje:

1. **Gwizdek natychmiast** (stary system) — reaguj na każde dotknięcie. Problem: co drugie to symulka, tracisz wiarygodność.
2. **Poczekaj i oceń** (nowy system) — widzisz pchnięcie, ale zamiast natychmiast gwizdać, obserwujesz sekundę. Czy gracz naprawdę upadł? Czy wstaje? VAR potwierdza? Dopiero potem decyzja.
3. **Advantage** (grace period) — nawet jeśli był faul, dajesz grę kontynuować. Jeśli drużyna i tak zdobywa bramkę, faul był nieistotny.

Grace Period to połączenie opcji 2 i 3 — poczekaj na potwierdzenie (candle close), a nawet po potwierdzeniu daj szansę na powrót (45 min grace).

### Pipeline flow z Grace Period

```
Momentum Guard → Inventory-Aware Override
  ↓
Grace Period Check: "Czy mamy BROKEN S/R?"
  ├── TAK + grace active → srGraceActive = true → SUPPRESS reduction
  ├── TAK + grace expired → srGraceActive = false → allow reduction
  └── NIE (just touch or far away) → srGraceActive = false → normal flow
  ↓
S/R Progressive Reduction: if (!srGraceActive) → reduce position
  ↓
S/R Accumulation → Breakout TP → Dynamic TP → ...
```

Grace Period jest wstawiony między Inventory-Aware Override a S/R Reduction — blokuje redukcję ale NIE blokuje akumulacji. To ważne: jeśli cena dotknęła supportu i masz małą pozycję, akumulacja dalej działa (buduj longa na bounce). Grace blokuje TYLKO zamykanie pozycji.

### Lekcja inżynierska: hierarchia pewności sygnałów

Ten feature ilustruje ważną koncepcję — **nie wszystkie sygnały są równe**:

```
Tick price dotknął supportu (prox=-1.0)  → 50% szansy na przebicie
Candle close poniżej (prox=-1.2)        → 70% szansy na przebicie
3 candles poniżej (grace expired)        → 90% szansy na przebicie
```

Im dłużej rynek potwierdza sygnał, tym bardziej mu ufasz. To samo w software — jeden failed test to może flaky test. Trzy failed testy z rzędu to prawdziwy bug.

W tradingu ta koncepcja nazywa się **confirmation bias** (w pozytywnym sensie) — czekasz na potwierdzenie zanim podejmiesz nieodwracalną decyzję. Redukcja pozycji jest kosztowna (spread + fees + odbudowa), więc warto poczekać 45 minut na potwierdzenie.

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `src/signals/market_vision.ts` | +`lastCandle15mClose` w PairAnalysis, computation z `candles15m[-2]` |
| `src/config/short_only_config.ts` | +`srReductionGraceCandles` (default=2, kPEPE=3) |
| `src/mm_hl.ts` | +`srBreakGraceStart` Map, proximity signal rewrite (±1.0/±1.2), grace period logic (~50 LOC), Discord alert types (BROKEN/AT/NEAR) |
| `src/utils/discord_notifier.ts` | Embed: +`15m Close` field, orange color for BROKEN |

---

## Chapter 48: Kiedy Przestać Budować — Próg Akumulacji i Jego Pułapki

*Albo: jak jeden parametr (8% vs 15%) decyduje czy bot zbierze dużą pozycję czy się zatrzyma w połowie.*

### Problem: Bot przestał kupować za wcześnie

5 marca, 15:15 UTC. kPEPE jest AT SUPPORT — cena dotknęła wsparcia na $0.003508. Discord wysyła zielony alert. Sprawdzam logi bota i... cisza. Zero logów `[SR_ACCUM]`. Bot nie akumuluje longów mimo że jest dokładnie na supportcie.

Skew wynosi 11%. Bot ma małego longa — 381K kPEPE ($1,339). To nie jest duża pozycja. Powinien kontynuować zbieranie.

Ale nie zbiera.

### Root Cause: Próg 8% był za niski

Problem okazał się być w jednym parametrze: `srMaxRetainPct`. To próg który decyduje:

```
|skew| <= srMaxRetainPct  →  S/R ACCUMULATION (buduj pozycję)
|skew| >  srMaxRetainPct  →  S/R REDUCTION (zamykaj pozycję)
```

Dla kPEPE ustawiliśmy `srMaxRetainPct: 0.08` (8%). To znaczy:

- Skew 3% → akumulacja aktywna, bot kupuje agresywnie (bid×3.20, ask×0.00)
- Skew 8% → **granica** — akumulacja się wyłącza
- Skew 11% → S/R Reduction przejmuje i zaczyna **zamykać** pozycję

Bot dosłownie zbierał longi do 8% skew, a potem zaczynał je oddawać. Budował zamek z piasku i natychmiast go burzył.

### Analogia: Termostat ustawiony za nisko

Wyobraź sobie, że ustawiasz termostat na 18°C w zimie. Grzejnik się włącza, pokój dochodzi do 18°C, grzejnik się wyłącza. Ale tak naprawdę chcesz 22°C — pokój nigdy nie jest wystarczająco ciepły.

Nasz "termostat" S/R Accumulation był ustawiony na 8% — za nisko. Bot nigdy nie budował wystarczająco dużej pozycji żeby naprawdę zarobić na odbiciu od supportu.

### Fix: Jeden parametr

```typescript
// PRZED:
srMaxRetainPct: 0.08,  // 8% — za nisko, bot buduje do 8% i zaczyna zamykać

// PO:
srMaxRetainPct: 0.15,  // 15% — bot buduje do 15% zanim zacznie zamykać
```

Teraz timeline wygląda tak:

| Skew | Przed (8%) | Po (15%) |
|------|-----------|----------|
| 3% | Akumulacja (bid×3.20) | Akumulacja (bid×3.20) |
| 8% | **STOP → Reduction** | Akumulacja (kontynuuje) |
| 11% | Reduction (zamykanie!) | **Akumulacja** (nadal buduje) |
| 15% | Reduction | **Granica** → Reduction |
| 20% | Reduction | Reduction |

### Dlaczego wcześniej było 8%?

Oryginalny komentarz w kodzie mówił: *"was 20% — too high, bot ran symmetric grid at -12% skew"*. Ktoś (my, tydzień temu) obniżył z 20% na 8% bo bot przy 12% skew nadal zachowywał się jak symmetric market maker zamiast aktywnie zamykać.

Ale to było za dużo w drugą stronę. 8% to tak mało, że bot **nigdy nie zbierał sensownej pozycji**. Każde odbicie od supportu budowało pozycję do 8%, potem natychmiast zaczynało ją redukować, tracąc momentum.

15% to złoty środek:
- **Wystarczająco duże** żeby zbudować sensowną pozycję na odbiciu
- **Wystarczająco małe** żeby S/R Reduction miała co zamykać przy resistance
- Bot ma miejsce na organiczny wzrost pozycji od 0% do 15%

### Lekcja inżynierska: Parametry to dźwignia

W systemach tradingowych (i w software ogólnie) jeden parametr może mieć ogromny wpływ na zachowanie systemu. `srMaxRetainPct` to dosłownie granica między "buduj pozycję" a "zamykaj pozycję" — dwa przeciwne zachowania kontrolowane przez jeden próg.

Kilka zasad:

1. **Nie optymalizuj parametrów na jednym przykładzie.** Obniżyliśmy z 20%→8% bo w jednym przypadku 12% skew był za dużo. Ale 8% okazało się za małe w innym przypadku.

2. **Szukaj złotego środka, nie ekstremum.** 20% za dużo, 8% za mało → 15% w sam raz. Goldilocks principle.

3. **Sprawdzaj komplementarne systemy.** Accumulation i Reduction dzielą ten sam próg — zmiana jednego wpływa na oba. Obniżając próg akumulacji, jednocześnie podwyższyliśmy agresywność redukcji.

4. **Logi nie kłamią.** Discord alert mówił "AT SUPPORT", ale brak logów `[SR_ACCUM]` natychmiast wskazał na problem. Dlatego logujemy co 20 ticków — żeby widzieć co się dzieje (i co się NIE dzieje).

### Kluczowy plik

| Plik | Zmiana |
|------|--------|
| `src/config/short_only_config.ts` | kPEPE `srMaxRetainPct`: 0.08 → 0.15 |

---

## Rozdział 49: Dwa Zegary — Dlaczego S/R z 1h a MM na 15m

*"Strategia mówi ci GDZIE walczyć. Taktyka mówi ci JAK walczyć."*

### Problem: Support który tańczy

Wyobraź sobie radar na okręcie wojennym. Masz dwa tryby:
- **Bliski zasięg (15m candles)** — widzisz każdą falę, każdą bryzgę. Linia brzegowa "skacze" z każdą falą.
- **Daleki zasięg (1h candles)** — widzisz kształt zatoki. Linia brzegowa jest stabilna.

Bot miał S/R z 15-minutowych świeczek (48 świeczek = 12h lookback). Problem? Support skakał co kilka minut:

```
18:42  BROKEN SUPPORT  S=$0.003425
18:46  AT SUPPORT      S=$0.003421   ← zmienił się o $0.000004!
18:53  NEAR SUPPORT    S=$0.003431   ← znowu zmiana!
```

Każda nowa 15m świeczka zmieniała min/max → support się przesuwał → bot dostawał sprzeczne sygnały. "Broken!", "At!", "Near!" — jak GPS w tunelu, który co chwilę mówi "skręć w lewo... nie, w prawo... nie, zawróć!"

### Rozwiązanie: Dwa zegary

**S/R z 1h candles (24 świeczki = 24h)** — stabilne poziomy, zmiana najwyżej raz na godzinę.
**MM execution na 15m candles** — szybka reakcja na RSI, trend, break detection.

To jak generał i snajper:
- **Generał (1h)** mówi: "Support jest na $0.003431. Buduj pozycję tam."
- **Snajper (15m)** mówi: "Candle zamknęła poniżej supportu → BROKEN, wstrzymaj."

Generał nie zmienia zdania co 15 minut. Snajper reaguje szybko na to co widzi, ale w ramach strategii generała.

### Co się zmieniło w kodzie

```
BYŁO (15m candles):
  stfLookback = min(48, candles15m.length)    // 48 × 15m = 12h
  supportBody12h = min(candles15m bodies)      // skacze co tick

JEST (1h candles):
  stfLookback = min(24, candles.length)        // 24 × 1h = 24h
  supportBody12h = min(candles 1h bodies)      // stabilne, zmiana max 1×/h
```

### Co ZOSTAŁO na 15m candles

| Element | Timeframe | Dlaczego |
|---------|-----------|----------|
| **S/R levels** | **1h** | Stabilność — generał nie zmienia zdania co 15 min |
| RSI | 15m | Szybka reakcja na oversold/overbought |
| Trend (EMA9/21) | 15m | Krótkoterminowy kierunek |
| Break detection | 15m | `lastCandle15mClose` — czy candle ZAMKNĘŁA się poniżej S/R |
| Flash crash | 15m | Detekcja 3%+ ruchu w 15 min |

### LONG+DUMP — co to znaczy i dlaczego walczą systemy

W logach widzisz:
```
💎LONG+DUMP→holding        — MG mówi: "trzymaj longi, nie sprzedawaj na dnie"
⚡INV_AWARE→closing_boosted — INV_AWARE mówi: "zamknij! masz za dużo longów!"
```

**LONG+DUMP** = bot kupił (ma LONG), a cena spada (DUMP). Pozycja jest PRZECIW kierunkowi rynku.

Dwa systemy widzą to zupełnie inaczej:

| System | Co widzi | Co chce zrobić |
|--------|----------|----------------|
| **Momentum Guard** | "Cena spada, jesteśmy blisko supportu" | Trzymaj longi (ask×0.10), czekaj na odbicie |
| **INV_AWARE Override** | "Mamy 22% skew LONG, to za dużo!" | Zamykaj! (ask×1.22), pozbądź się longów |

To jak dwóch doradców krzyczących w ucho kapitana:
- **Strateg:** "To support, cena odbije. TRZYMAJ!"
- **Risk Manager:** "Masz za dużo longów! ZAMYKAJ zanim stracisz więcej!"

INV_AWARE wygrywa (override), aski lądują blisko ceny → longi zamykane ze stratą → cena odbija od supportu → bot stracił pozycję którą powinien trzymać.

### Lekcja

1. **Dwa timeframe'y to nie kompromis — to architektura.** Najlepsi traderzy patrzą na wyższy timeframe dla kierunku i niższy dla wejścia. Bot powinien robić to samo.

2. **Stabilność S/R > precyzja S/R.** Lepiej mieć support który jest "w przybliżeniu" prawidłowy i stabilny, niż "dokładny" ale skaczący co tick. Bot reagujący na skaczący support zachowuje się chaotycznie.

3. **Systemy walczą ze sobą.** MG (mean-reversion) i INV_AWARE (risk management) mają sprzeczne cele przy supportcie z dużym skew. To normalne — ale trzeba wiedzieć który ma priorytet w jakiej sytuacji.

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `src/signals/market_vision.ts` | S/R computation: `candles15m` → `candles` (1h), lookback 48→24 |
| `src/mm_hl.ts` | Log label `S/R(15m)` → `S/R(1h)`, footer Discord alert updated |

---

## Chapter 50: Wyłączanie mechanizmu który walczy z Twoim botem — NANSEN CONFLICT SL

> "Najgorszy wróg to ten, którego sam sobie stworzyłeś."

### Problem

Bot kPEPE (PURE_MM) robił normalny market making — grid z bidami i askami po obu stronach. S/R Accumulation budowała longi przy supportcie (Chapter 46-49). Wszystko działało... dopóki nie włączył się NANSEN CONFLICT SL.

Ten mechanizm (`checkNansenConflicts()`) sprawdzał jedną prostą rzecz: **"Czy Twoja pozycja jest przeciw Nansen bias?"**. Nansen bias mówił SHORT STRONG. Bot miał longi. Wniosek: **zamknij longi force-close ze stratą**.

Wynik? Bot budował longi przy supportcie (koszt: fees + spread), a potem NANSEN CONFLICT SL je zamykał gdy PnL spadło poniżej -$20. Każde zamknięcie to strata $22-55. Jak Syzyf toczący kamień pod górę — bot budował, system niszczył, bot budował od nowa.

### Dlaczego ten mechanizm w ogóle istniał?

NANSEN CONFLICT SL miał sens w **starym modelu** (War Doctrine, styczeń 2026) — bot SM-following, który podążał za Smart Money. Jeśli bot trzymał LONG a SM mówili SHORT → pozycja jest **źle ustawiona** → zamknij ze stratą zanim stracisz więcej.

Ale od kiedy kPEPE przeszedł na **PURE_MM** (czysty market making), ten mechanizm stał się szkodliwy. Market maker **musi** mieć pozycje w obu kierunkach — to nie jest bug, to jest feature. Grid buduje longi przy supportcie i shorty przy resistance. NANSEN CONFLICT SL nie rozumiał tego kontekstu.

### Analogia: Strażnik w szpitalu

Wyobraź sobie strażnika w szpitalu, który ma prostą zasadę: "Nie wpuszczaj obcych." Zasada miała sens gdy szpital był zamknięty. Ale teraz szpital jest otwarty i przyjmuje pacjentów. Strażnik nadal blokuje wejście. Pacjenci (longi) wchodzą tylnymi drzwiami (grid), a strażnik ich wyrzuca (force-close).

Rozwiązanie? Nie "naucz strażnika kto jest pacjentem" — to byłoby over-engineering. Po prostu **wyłącz strażnika**. Szpital ma teraz inne systemy bezpieczeństwa (Inventory SL, S/R Reduction, MG proximity).

### Fix: jedna linia

```typescript
// PRZED: Domyślnie włączony, trzeba explicit 'false' w env żeby wyłączyć
this.nansenConflictCheckEnabled = process.env.NANSEN_CONFLICT_CHECK_ENABLED !== 'false'

// PO: Hardcode wyłączony
this.nansenConflictCheckEnabled = false
```

Dlaczego hardcode `false` zamiast ustawienia env var `NANSEN_CONFLICT_CHECK_ENABLED=false`?

1. **Czytelność** — każdy kto czyta kod widzi od razu że mechanizm jest wyłączony
2. **Bezpieczeństwo** — restart bota bez env var nie włączy mechanizmu przypadkowo
3. **Dokumentacja w kodzie** — `= false` mówi "świadoma decyzja", nie "zapomniano ustawić env"

### Lekcja

1. **Mechanizmy ochronne mają kontekst.** SL który chroni SM-following bota może niszczyć PURE_MM bota. Gdy zmieniasz strategię (SM-following → PURE_MM), przejrzyj WSZYSTKIE mechanizmy ochronne i sprawdź czy nadal mają sens w nowym kontekście.

2. **Hardcode > env var gdy decyzja jest architekturalna.** Env var to "konfiguracja" — sugeruje że wartość może się zmieniać. Hardcode to "architektura" — mówi "to jest tak a nie inaczej, okres".

3. **Szukaj conflicting systems.** Gdy bot traci mimo poprawnej logiki, sprawdź czy dwa systemy nie walczą ze sobą. Tu: S/R Accumulation budowała longi, NANSEN CONFLICT SL je zamykał. Oba działały "poprawnie" w izolacji — problem był w ich interakcji.

4. **Logi mówią prawdę.** `🛑 [NANSEN CONFLICT SL] Closing LONG on kPEPE (PnL: $-27.03)` — te logi były w error log przez wiele ticków. Wystarczyło grep'nąć żeby zobaczyć problem.

---

## Chapter 51: Od Backtestingu do Produkcji — Jak SMA Crossover Trafił na VIRTUAL (08.03.2026)

> "Teoria bez praktyki jest bezużyteczna. Praktyka bez teorii jest niebezpieczna." — Deming

### Geneza: dlaczego SMA na VIRTUAL?

Bot miał już SMA crossover signal dla kPEPE (SMA 20/60, tolerance 1.10) — ale VIRTUAL działał "na ślepo", bez żadnego sygnału trendu. Market making bez sensu kierunkowego to jak żeglowanie bez kompasu — może działa, ale mógłbyś płynąć szybciej gdybyś wiedział skąd wieje wiatr.

Pytanie brzmiało: **jakie parametry SMA będą działać dla VIRTUAL?** Nie można po prostu skopiować kPEPE — to zupełnie inny token (inna zmienność, inny wolumen, inne zachowanie ceny). Trzeba było to sprawdzić empirycznie.

### Krok 1: Zbierz dane

Plik `fetch_virtual.py` pobrał 2000 godzin (83 dni) danych 1H z Hyperliquid API. Chunk po chunki (750h na raz), żeby nie przekroczyć limitów API. Deduplikacja po timestamp, sortowanie, zapis do CSV.

**Lekcja:** Zawsze zbieraj więcej danych niż myślisz, że potrzebujesz. 2000 candle to minimum do sensownego backtestingu z SMA 50 (bo potrzebujesz 50 pierwszych candle na rozgrzanie wskaźnika, zostaje Ci 1950 na testowanie).

### Krok 2: Backtest z grid search

Plik `momentumSMA.py` użył biblioteki `backtesting.py` z grid search:

```python
stats = bt.optimize(
    sma_fast=range(10, 30, 5),      # [10, 15, 20, 25]
    sma_slow=range(30, 80, 10),     # [30, 40, 50, 60, 70]
    sr_tolerance=[1.02, 1.05, 1.08, 1.10, 1.15],
    maximize='Return [%]',
    constraint=lambda param: param.sma_fast < param.sma_slow,
)
```

To daje 4 × 5 × 5 = 100 kombinacji (minus te gdzie fast ≥ slow). System testuje każdą kombinację na tych samych danych i zwraca najlepszą.

**Wynik:** SMA 20/30 z SR tolerance 1.08 wygrał dla VIRTUAL.

**Dlaczego 20/30 a nie 20/50?** VIRTUAL jest bardziej zmiennym tokenem niż kPEPE — potrzebuje szybszych sygnałów. SMA 30 reaguje szybciej na zmiany trendu niż SMA 50 czy 60. To ma sens — tokeny meme-adjacent (VIRTUAL jest w kategorii AI agents) poruszają się szybko, a zbyt wolny wskaźnik daje sygnały gdy ruch już się skończył.

### Krok 3: Implementacja w bocie — gdzie żyje konfiguracja

Parametry trafiły do `src/config/short_only_config.ts` jako override per-token:

```typescript
'VIRTUAL': {
  smaCrossoverEnabled: true,
  smaFastPeriod: 20,
  smaSlowPeriod: 30,
  smaSrTolerance: 1.08,
  smaCrossoverBidBoost: 1.8,
  smaCrossoverAskBoost: 1.8,
},
```

**Architektura:** `MomentumGuardConfig` to interfejs z defaultami + overridami per-token. Każdy token może mieć swoje parametry. Funkcja `getMomentumGuardConfig(pair)` merguje default z override. To elegancki wzorzec — nie trzeba if/else'ów w kodzie, wystarczy dodać wpis w słowniku.

### Krok 4: MarketVision — skąd brać dane w real-time

Tu zaczęły się problemy. Dodaliśmy config, dodaliśmy logikę w grid pipeline... i nic nie działało. Zero logów SMA. Cisza.

**Root cause:** VIRTUAL nie był w `activePairs` w `market_vision.ts`. To tablica tokenów, dla których MarketVision pobiera 1H candle z Hyperliquid API. Bez wpisu w `activePairs` → brak candle data → `getPairAnalysis('VIRTUAL')` zwraca `undefined` → żaden SMA signal nie jest obliczany.

**Analogia:** Wyobraź sobie, że budujesz system radarowy. Masz antenę (MarketVision), masz ekran (mm_hl.ts), masz instrukcje co robić gdy wykryjesz samolot (config). Ale nie podłączyłeś anteny do tego kanału częstotliwości. Antena nasłuchuje kPEPE, LIT, ETH... ale nie VIRTUAL. Dodanie jednego stringa do tablicy = "nastaw antenę na tę częstotliwość".

```typescript
// PRZED: VIRTUAL niewidoczny
const activePairs = ['LIT', 'kPEPE', 'ETH', 'BTC', 'HYPE', 'SOL']

// PO: VIRTUAL na radarze
const activePairs = ['LIT', 'kPEPE', 'ETH', 'BTC', 'HYPE', 'SOL', 'VIRTUAL']
```

### Krok 5: Dynamiczne SMA per-token

Wcześniej SMA w MarketVision było hardcoded: zawsze SMA 20 i SMA 60. Ale VIRTUAL potrzebuje SMA 20/30. Rozwiązanie — dynamiczne okresy z configu:

```typescript
const mgConfig = getMomentumGuardConfig(pair);
const smaFast = mgConfig.smaFastPeriod;   // VIRTUAL: 20, kPEPE: 20
const smaSlow = mgConfig.smaSlowPeriod;   // VIRTUAL: 30, kPEPE: 60
```

Teraz MarketVision oblicza SMA z **właściwymi okresami** dla każdego tokena. Dodanie nowego tokena wymaga tylko wpisu w configu — zero zmian w logice obliczania.

### Krok 6: Grid pipeline — dwa oddzielne bloki

Tu jest kluczowy punkt architektoniczny. `mm_hl.ts` ma DWA oddzielne bloki grid pipeline:

1. **`if (pair === 'kPEPE')`** — pełny Momentum Guard z S/R Accumulation, Bounce Hold, itd.
2. **`else`** — wszystkie inne tokeny (VIRTUAL, LIT, FARTCOIN...)

SMA crossover signal dla kPEPE był w bloku 1. VIRTUAL idzie przez blok 2 — i tam nie było ŻADNEJ logiki SMA. Dodaliśmy ją:

```typescript
// W bloku else (non-kPEPE pairs):
if (momGuardCfg.smaCrossoverEnabled) {
  const mvA = this.marketVision?.getPairAnalysis(pair)
  // Golden cross + near support → boost bids
  // Death cross + near resistance → boost asks
  // Trend mild → gentle bias
}
```

**Lekcja:** Gdy masz dwa code paths, każda nowa feature musi być dodana do OBIE. Albo — jeszcze lepiej — refaktoryzuj do jednego code path z per-token config. Ale to jest historia na inny dzień.

### Krok 7: Debug — dlaczego nie widzę logów?

Po deployu na serwer — znowu cisza. `SMA_STATUS` log nie pojawił się. Dlaczego?

Okazało się, że log był gated przez `this.tickCount % 20 === 0` — czyli logował co 20 ticków. A `tickCount` startuje od 1 (inkrementowany na POCZĄTKU mainLoop, przed body). Więc pierwszy tick to 1, nie 0. `1 % 20 === 0` → false. Trzeba czekać do tick 20 żeby zobaczyć pierwszy log.

Fix: dodanie `|| this.tickCount <= 3` — loguj też na pierwszych 3 tickach, żeby od razu po deployu widzieć czy system działa.

**Lekcja:** Zawsze loguj na starcie. "Działam, widzę dane, oto mój stan" — to jest bezcenne przy debugowaniu produkcji. Co 20 ticków to fine dla normalnych operacji, ale przy deployu chcesz feedback natychmiast.

### Krok 8: S/R lookback — match backtestem

Ostatni szczegół: S/R levels w MarketVision używały 24-candle lookback (`rolling(24)`), ale backtest używał 50-candle lookback (`rolling(50)`). Zmieniliśmy na 50 żeby parametry z backtestingu pasowały do produkcji.

To jest subtleny ale ważny punkt: **jeśli backtestujesz z window=50, ale produkcja używa window=24, to testujesz inne S/R levels niż te które bot widzi w real-time**. Wyniki backtestingu są wtedy bezwartościowe — optymalizujesz parametry dla sytuacji która nie występuje w produkcji.

### Jak działa crossover detection?

Porównujemy SMAs z dwóch kolejnych barów:

```
Bar N-1:  SMA_fast=0.68  ≤  SMA_slow=0.69   (fast pod slow)
Bar N:    SMA_fast=0.70  >  SMA_slow=0.69   (fast nad slow)
→ GOLDEN CROSS (fast przebił slow od dołu)
```

```
Bar N-1:  SMA_fast=0.70  ≥  SMA_slow=0.69   (fast nad slow)
Bar N:    SMA_fast=0.68  <  SMA_slow=0.69   (fast pod slow)
→ DEATH CROSS (fast przebił slow od góry)
```

Crossover to moment PRZEJŚCIA — trwa tylko jeden tick. Potem signal przechodzi w "trend mild" (SMA20 > SMA60 bez crossover = bullish trend, bez boostu).

### Efekty na grid

| Sygnał | Warunek S/R | Bid multiplier | Ask multiplier |
|--------|-------------|----------------|----------------|
| Golden cross | Near support | × 1.80 | × 0.56 |
| Death cross | Near resistance | × 0.56 | × 1.80 |
| Bullish trend (mild) | Near support | × 1.15 | × 0.90 |
| Bearish trend (mild) | Near resistance | × 0.90 | × 1.15 |
| No signal / no S/R | — | × 1.00 | × 1.00 |

Zauważ, że crossover BEZ potwierdzenia S/R nie robi nic. To jest ten sam princyp z backtestu — tam też crossover musiał być near_support lub near_resistance żeby triggerować trade. Filtr S/R eliminuje fałszywe sygnały w środku range'u.

### Pipeline per-token — podsumowanie

```
┌─────────────────────────────────────────────────────────────┐
│  CONFIG (short_only_config.ts)                              │
│  ├── kPEPE:   SMA 20/60, tolerance 1.10                    │
│  ├── VIRTUAL: SMA 20/30, tolerance 1.08                    │
│  └── default: SMA 20/60, tolerance 1.10 (not enabled)      │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  MARKET VISION (market_vision.ts)                           │
│  activePairs: [LIT, kPEPE, ETH, BTC, HYPE, SOL, VIRTUAL]  │
│  ├── Fetches 1H candles for each active pair                │
│  ├── Computes SMA with dynamic periods per-token            │
│  ├── Detects golden/death crossovers                        │
│  └── Computes S/R levels (50-candle rolling window)         │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  GRID PIPELINE (mm_hl.ts)                                   │
│  if (pair === 'kPEPE') {                                    │
│    // Full Momentum Guard + S/R Accumulation pipeline       │
│    // SMA crossover signal (existing)                       │
│  } else {                                                   │
│    // SMA crossover signal block (NEW — Chapter 51)         │
│    // Moon Guard, other filters...                          │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
```

### 5 lekcji z tego wdrożenia

1. **Backtest → Production musi być 1:1.** Jeśli backtest używa SMA 20/30 i S/R window=50, produkcja MUSI używać identycznych parametrów. Nawet drobna różnica (window 24 vs 50) sprawia, że S/R levels są inne, a crossover signale triggerują w innych momentach. Wyniki backtestingu są wtedy bezwartościowe.

2. **activePairs to brama.** Dodanie tokena do configu i logiki bez dodania do `activePairs` = martwy kod. Zawsze sprawdzaj, czy data pipeline jest podłączony. Najpierw dane, potem logika.

3. **Per-token config > hardcoded values.** Wzorzec `default + overrides` jest potężny. Dodanie nowego tokena to 5 linii w słowniku, zero zmian w logice. Gdy masz 10 tokenów z różnymi parametrami, ten wzorzec skaluje się dużo lepiej niż if/else.

4. **Loguj na starcie, nie tylko co N ticków.** W produkcji potrzebujesz natychmiastowego feedback po deployu. `tickCount <= 3` to prosty hack, ale oszczędza minuty (albo godziny) debugowania.

5. **Dwa code paths to dług techniczny.** Każda nowa feature wymaga implementacji W OBIE GAŁĘZIE. To łatwo przeoczyć (i przeoczyliśmy — cały SMA signal istniał tylko w bloku kPEPE). Długoterminowe rozwiązanie to unifikacja pipeline'u z per-token config. Ale pragmatyzm > perfekcjonizm — lepiej mieć działający system z dwoma ścieżkami niż nie mieć go wcale.

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `src/mm_hl.ts` | Linia 4029: `nansenConflictCheckEnabled = false` (hardcode disable) |

---

## S/R Bounce Hold — nie sprzedawaj za wczesnie po odbiciu

> "Cierpliwosc jest brogia. Bot ktory sprzedaje zbyt wczesnie jest jak rybak ktory wyciaga wedke zanim ryba ugryzla."

### Problem: wygrywasz bitwe, ale przegrywasz wojne

Wyobraz sobie taka sytuacje. Bot kPEPE robi dokladnie to co powinien:

1. Cena spada do supportu ($0.003441)
2. S/R Accumulation aktywuje sie: "Support! Kupuj longi!"
3. Fresh Touch Boost daje bid×5.84 (agresywne kupowanie, Chapter 36)
4. Bot zbiera longi — skew rosnie do 10%, 12%, 15%

Wszystko swietnie. Bot zbudowal pozycje w idealnym miejscu. A potem...

5. Cena zaczyna odbijac w gore (to dobrze! nasz plan dziala!)
6. Momentum Guard widzi pump → boostuje aski: ask×1.05 → ask×1.15 → ask×1.30
7. S/R Accumulation disengages (cena wychodzi ze strefy supportu)
8. Grid aski filluja sie → longi zamkniete z malym zyskiem ($2-5)

Bot "wygral" — zamknal z zyskiem. Ale cena idzie dalej w gore o 1.5-2× ATR (+$0.000130 dla kPEPE). Gdyby poczeral, zarobilby 3-5× wiecej.

To jak sprzedaz akcji Apple po +2% bo "lepszy wrobel w garci". Technicznie poprawne, ale tracisz ogromny potencjal.

### Dlaczego to sie dzialo?

Pipeline bota mial dziure — **zero mechanizmu ktory mowi "poczekaj az odbicie sie rozwinie"**.

Grace Period (Chapter 47) chronil przed fakeoutem **W DOL** (break supportu — nie zamykaj od razu, moze wroci). Ale nic nie chronilo przed zamknieciem **ZA WCZESNIE W GORE**.

```
SUPPORT → Accumulation → Bounce starts → MG boosts asks → Fills → CLOSED
                                                            ↑
                                                     TU JEST PROBLEM
                                              Bot zamyka po 0.06 ATR
                                          zamiast czekac na 1.5-2.0 ATR
```

### Rozwiazanie: S/R Bounce Hold

Pomysl jest prosty: po tym jak S/R Accumulation zbudowala pozycje przy S/R, **tlum closing-side ordery** dopoki cena nie oddali sie wystarczajaco od supportu/resistance.

Ale "wystarczajaco" to nie binary on/off. Bot nie powinien nagle z "zero asków" przeskakiwac na "pelne aski". Zamiast tego — **progressive release**.

### Jak to dziala — Progressive Release

Wyobraz sobie ze trzymasz balon na lince. Im dalej balon odleci od ziemi (support), tym bardziej luzujesz linke. Przy ziemi — trzymasz mocno. W polowie drogi — luzno. Gdy balon jest wystarczajaco wysoko — puszczasz.

```
distFromSr = (price - support) / ATR    // 0.0 = at support, 2.0 = 2× ATR away
holdProgress = min(1.0, distFromSr / srBounceHoldMinDistAtr)
// holdProgress: 0.0 = przy supportcie, 1.0 = przy thresholdzie

askReduction = srBounceHoldAskReduction + holdProgress × (1.0 - srBounceHoldAskReduction)
// askReduction: 0.15 przy supportcie → 1.00 przy thresholdzie
sizeMultipliers.ask *= askReduction
```

Przebieg dla kPEPE (support=$0.003441, ATR=$0.000065, threshold=2.0× ATR):

| Tick | Cena | Dystans | Progress | askReduction | Efekt |
|------|------|---------|----------|-------------|-------|
| 1 | $0.003445 | 0.06 ATR | 3% | ask×0.18 | **HOLD**: prawie zero asków |
| 5 | $0.003480 | 0.60 ATR | 30% | ask×0.41 | Troche asków, ale ciagle trzyma |
| 15 | $0.003550 | 1.68 ATR | 84% | ask×0.86 | Prawie pelne aski, bounce prawie potwierdzony |
| 20 | $0.003575 | 2.06 ATR | 100% | **HOLD OFF** | Normalne aski, bounce potwierdzony |

### Cztery wyjscia awaryjne

Bot nie trzyma pozycji w nieskonczonosc. Sa 4 "clear conditions":

1. **Dystans >= threshold** — cena oddallila sie wystarczajaco (bounce potwierdzony) → hold off
2. **Timeout 30 minut** — jesli po 30 min cena nadal przy supportcie, moze to nie jest bounce → hold off
3. **Pozycja zamknieta** — skew spadl ponizej 2% → nic do trzymania → hold off
4. **S/R level sie zmienil** — nowe candle dalo nowy support/resistance → hold off

### Safety valve: Breakout TP

Kluczowa zasada: **Bounce Hold NIE blokuje Breakout TP**. To safety valve.

Gdy momentum score > 0.40 (silny pump) i bot ma LONG → Breakout TP nadal zamyka agresywnie (Chapter 33). Bounce Hold redukuje "normalne" closing aski, ale nie moze zablokowac Breakout TP ktory strzela na silnym momentum.

To jak hamulec reczny w samochodzie — trzyma go na miejscu na parkingu, ale jesli kierowca wcisnnie gaz do dechy, hamulec reczny nie zatrzyma auta.

### Gdzie to siedzi w pipeline

```
S/R Progressive Reduction (zamyka duze pozycje przy S/R)
S/R Accumulation (buduje pozycje, USTAWIA tracking bouncehold)
>>> S/R BOUNCE HOLD (NEW — redukuje closing-side po accum) <<<
Breakout TP (nadal dziala na strong momentum — safety valve)
Dynamic TP
```

Bounce Hold jest multiplicative z MG — jesli MG daje ask×1.30 (pump), a Bounce Hold daje ask×0.41, wynik = ask × 1.30 × 0.41 = ask×0.53. Oba wplywaja, ale Bounce Hold "lagodziacy" closing.

### Analogia: poker i "slow play"

W pokerze jest cos co sie nazywa "slow play" — masz silna reke (AA, KK), ale zamiast stawiac agresywnie od razu, grasz pasywnie i czekasz az przeciwnik zbuduje pot za Ciebie.

S/R Bounce Hold to slow play. Bot zbudowal pozycje przy supportcie (silna reka). Zamiast od razu ja zamykac z malym zyskiem (fold za wczesnie), czeka az bounce sie rozwinie (pot rosnie). Dopiero gdy cena jest 2× ATR od supportu, zaczyna zamykac (showdown).

Ale jak kazdy slow play — ma timeout. Nie czekasz cala noc. 30 minut i tyle.

### Logi

```
🔒 [BOUNCE_HOLD] kPEPE: LONG near SUPPORT — dist=0.60ATR progress=30% → ask×0.41 (holding for bounce)
🔓 [BOUNCE_HOLD] kPEPE: RELEASED — dist=2.06ATR >= 2.0ATR threshold (bounce confirmed)
⏰ [BOUNCE_HOLD] kPEPE: TIMEOUT — 30min elapsed, resuming normal closing
```

### Config

| Parametr | Default | kPEPE | Opis |
|----------|---------|-------|------|
| `srBounceHoldEnabled` | true | true | Wlaczony/wylaczony |
| `srBounceHoldMinDistAtr` | 1.5 | **2.0** | Ile ATR od S/R zanim pelne closing (volatile → wiecej room) |
| `srBounceHoldAskReduction` | 0.20 | **0.15** | Min closing-side przy S/R (15% = prawie zero) |
| `srBounceHoldMaxMinutes` | 30 | 30 | Timeout |

kPEPE ma wyzszy threshold (2.0 vs 1.5) bo jest volatile — potrzebuje wiecej miejsca na bounce. I nizszy min closing (0.15 vs 0.20) bo chcemy trzymac mocniej.

### Lekcja

1. **"Zysk" to nie tylko "zamkniete z plusem".** Bot ktory zamyka z +$3 gdy mogl zarobic +$15 przegrywa strategicznie. Drobne zyski zjadaja spread i fees. Trzeba pozwolić zyskom rosnac.

2. **Progressive > binary.** Naiwne rozwiazanie: "blokuj aski na 30 minut". Lepsze: progressywne release — im dalej od supportu, tym wiecej asków. Bot nie musi "zgadywac" kiedy bounce sie skonczy — po prostu skaluje.

3. **Safety valves sa kluczowe.** Kazdy mechanizm "hold" potrzebuje wyjscia awaryjnego. Tu: Breakout TP (silny momentum), timeout (30 min), dystans (2.0× ATR). Bez safety valve, "hold" zamienia sie w "stuck".

4. **Systemy buduja na sobie.** Bounce Hold nie ma sensu bez S/R Accumulation (Chapter 33). Accumulation nie ma sensu bez Fresh Touch Boost (Chapter 36). Fresh Touch nie ma sensu bez stabilnych S/R levels z 1h candles (Chapter 49). Kazdy system jest warstwa — sam w sobie prosty, ale razem tworzą cos poteznego.

### Kluczowe pliki

| Plik | Zmiana |
|------|--------|
| `src/config/short_only_config.ts` | +4 interface fields, +4 defaults, +2 kPEPE overrides |
| `src/mm_hl.ts` | +1 property (`srBounceHoldState` Map), +63 linii logika (tracking, clear, progressive release, logging) |

---

## Anatomia Spreadu: Jak daleko od mid price bot stawia ordery (kPEPE)

### O czym jest ten rozdzial

Wyobraz sobie, ze prowadzisz stoisko z wymiana walut na lotnisku. Masz tablice z kursami kupna i sprzedazy. Kurs kupna (bid) jest zawsze nizszy niz kurs sprzedazy (ask) — ta roznica to Twoj zarobek, czyli **spread**.

Bot robi dokladnie to samo, tylko na kryptowalutach i z wieloma warstwami cenowymi jednoczesnie. Ten rozdzial jest pelna mapa tego, jak bot oblicza cene kazdego orderu — od "srodka rynku" (mid price) az po finalny order price na gieldzie.

To jest **czysto analityczny rozdzial** — nic nie zmieniamy w kodzie. Dokumentujemy istniejacy pipeline, zeby zrozumiec jak wszystkie czesci wspolpracuja.

### 1. Mid Price — punkt wyjscia

Mid price to aktualna cena rynkowa tokena, pobierana z Hyperliquid API (`allMids`). To jest "srodek" wokol ktorego bot buduje cala siatke orderow.

Ale mid price moze byc **przesuniete** przez Auto-Skew:

```
skewedMidPrice = midPrice x (1 + shiftBps / 10000)
```

Dla kPEPE Auto-Skew daje 1.5 bps na kazde 10% skew, max 10 bps. Przy skew = -43% (bot trzyma duzego shorta):

```
shiftBps = -(-43% x 10 x 1.5) = +6.45 bps
skewedMidPrice = $0.003500 x (1 + 6.45/10000) = $0.003502
```

Mid przesuniete w gore = bidy blizej rynku = bot agresywniej zamyka shorta.

**Analogia:** To jak gdyby kelner w restauracji nieco przesuwat stolik blizej kuchni gdy ma duzo zamowien do wyniesienia — zeby szybciej obslugiwac.

### 2. Base Spread — ile bps od mid na kazdej warstwie

Base spread to bazowa odleglosc kazdej warstwy (L1, L2, L3, L4) od mid price, mierzona w **basis pointach** (bps). 1 bps = 0.01%.

Zrodlem jest `baseL1OffsetBps` z `NANSEN_TOKENS[kPEPE].baseSpreadBps` (25 bps) lub default 20 bps.

Ale prawdziwa magia dzieje sie w **Dynamic Spread** (`getKpepeGridLayers()`), ktory skaluje L1 na podstawie ATR% (Average True Range — miara zmiennosci):

| ATR% | Regime | L1 (bps) | L2 | L3 | L4 | L5 |
|------|--------|----------|-----|-----|-----|-----|
| <=0.30% | LOW_VOL | 22 | 37 | 55 | 79 | — |
| 0.30-1.20% | NORMAL | 22-32 (interpolated) | x1.67 | x2.50 | x3.61 | x4.69 |
| >=1.20% | HIGH_VOL | **32** | 53 | 80 | 116 | 150 |

kPEPE override: `lowVolL1Bps=22`, `highVolL1Bps=32`, `highVolAtrPctThreshold=1.20`.

Fallback (bez danych ATR): L1=18, L2=30, L3=45, L4=65, L5=150.

**Kluczowa zasada:** Im wieksza zmiennosc, tym szerszy spread. Gdy rynek szaleje (HIGH_VOL), bot stawia ordery dalej od mid — chroni sie przed adverse selection (kupowaniem na szczytach, sprzedawaniem na dolkach). Gdy rynek spi (LOW_VOL), bot zaciesnia spread — wiecej szans na fill, mniejszy zarobek per trade ale wiecej tradow.

**Analogia:** To jak gdyby kantor na lotnisku rozszerzal marze w Sylwestra (duzy ruch, nieprzewidywalnosc) i zaciesnial ja w poniedzialek rano (spokoj).

### 3. Spread Multipliers — rozciaganie lub sciaganie spreadu

Spread multipliers modyfikuja `offsetBps` per warstwa:

```
bidOffsetBps = layer.offsetBps x spreadMultipliers.bid + inventoryAdjustment
askOffsetBps = layer.offsetBps x spreadMultipliers.ask + inventoryAdjustment
```

Co wplywa na spread multipliers:

| Modul | Efekt | Kiedy |
|-------|-------|-------|
| `computeSideAutoSpread()` | Inventory ratio + trend + flash crash + Vision | Zawsze |
| S/R Accumulation | `bidSpread x 1.23` (srAccumSpreadWiden=1.3) | Przy supportcie/resistance |
| Dynamic TP | spread x 1.5 na closing-side | Micro-reversal z pozycja |
| Nansen bid/ask factors | Zawsze 1.0 (DISABLED) | Nigdy (wylaczone) |

**Uwaga:** Unholy Trinity (FARTCOIN/HYPE/LIT) dostaje spread x2.0 (calm) lub x6.0 (volatile), ale kPEPE NIE — ma wlasny grid system.

### 4. Inventory Adjustment — asymetryczne przesuwanie

`getInventoryAdjustment(skew, side)` w `grid_manager.ts` dodaje/odejmuje bps od offsetu na podstawie inventory skew:

```
skewThreshold = 5%
rawAdjBps = (skew / 0.05) x 10     // +/-10 bps per 5% skew
capped at +/-15 bps
```

| Skew | Bid adj | Ask adj | Efekt |
|------|---------|---------|-------|
| 0% | 0 | 0 | Symetryczny grid |
| +10% (LONG) | +15 bps | -15 bps | Bidy dalej (mniej kupuj), aski blizej (zamykaj longa) |
| -20% (SHORT) | -15 bps | +15 bps | Bidy blizej (zamykaj shorta), aski dalej (mniej shortuj) |

To jest **addytywne** (nie multiplikatywne) — dodawane do offsetu warstwy po przemnozeniu przez spread multiplier.

**Analogia:** Wyobraz sobie wage szalkowa. Gdy jedna strona (np. SHORT) jest za ciezka, bot przesuwa punkt podparcia tak, zeby "ciezsza" strona miala latwiej sie rozladowac. Bidy bliZej = latwiej kupic = zamknac shorta.

### 5. Order Stagger — rozrzucenie orderow w warstwie

Kazda warstwa ma `ordersPerSide = 3` ordery. Zeby nie leZaly dokladnie na tej samej cenie, bot dodaje stagger:

```
Order 1: offset + 0 bps
Order 2: offset + 2 bps
Order 3: offset + 4 bps
```

To daje "mikroskopiczne" rozrzucenie — 3 ordery rozlozone na 4 bps zamiast jednego duzego orderu. Efekt: lepsze prawdopodobienstwo czesciowego fill (nie "all or nothing") i mniejszy market impact.

### 6. Final Order Price — wzor koncowy

```
bidPrice = midPrice x (1 - (bidOffsetBps + staggerBps) / 10000)
askPrice = midPrice x (1 + (askOffsetBps + staggerBps) / 10000)
```

To jest cena ktora leci na gielde. Caly pipeline od mid price do tego momentu mozna podsumowac:

```
         midPrice
            |
      [Auto-Skew]           przesuwa mid w gore/dol na podstawie skew
            |
      skewedMidPrice
            |
   +--------+--------+
   |                  |
  BID                ASK
   |                  |
[layer.offsetBps]  [layer.offsetBps]
   |                  |
[x spreadMult]     [x spreadMult]
   |                  |
[+ invAdj]         [+ invAdj]
   |                  |
[+ stagger]        [+ stagger]
   |                  |
[clamp 6-140bps]   [clamp 6-140bps]
   |                  |
 bidPrice          askPrice
```

### 7. Size Multipliers — to nie spread!

Wazne rozroznienie: `sizeMultipliers.bid` / `sizeMultipliers.ask` modyfikuja **rozmiar** orderu, NIE cene:

```
orderSizeUsd = (layerCapital / (ordersPerSide x 2)) x sizeMultiplier
```

Gdy widzisz `bid x 0.81` w logach, to znaczy ze bid ordery maja 81% normalnego rozmiaru ($81 zamiast $100), ale **sa na tej samej cenie** co normalnie.

Moduly ktore modyfikuja rozmiar (nie cene):
- Toxicity Engine (toksyczny flow -> zmniejsz)
- TimeZone (Asia night -> zwieksz, US open -> zmniejsz)
- Prediction Bias (h4 BEARISH -> zmniejsz bidy)
- Momentum Guard (pump -> zmniejsz bidy)
- INV_AWARE_MG (stuck position -> zwieksz closing side)
- S/R Accumulation/Reduction (blisko S/R -> asymetria)
- Bounce Hold (trzymaj pozycje po odbicie od S/R)
- Breakout TP (silny momentum -> zamknij)
- Inventory SL (panic -> podwoj closing side)

### 8. Clamp — granice bezpieczenstwa

`clampSpreadBps()` wymusza minimalny i maksymalny spread:

- **Min:** 6-8 bps (zeby nie quotowac za ciasno i nie tracic na fees)
- **Max:** 120-140 bps (zeby nie quotowac za szeroko i nie byc niewidocznym w orderbooku)

Per-pair overrides mozliwe via `PAIR_SPREAD_LIMITS`.

### 9. Przyklad: kPEPE w HIGH_VOL (ATR=1.8%)

Zalozenia: `mid = $0.003500` (po Auto-Skew), `L1 = 32 bps`, `skew = -15%`, `spreadMult bid = 1.0`, `spreadMult ask = 1.0`.

Inventory adjustment: bid = -15 bps (blizej), ask = +15 bps (dalej).

**L1 Bid (zamykanie shorta — agresywne):**
```
offset = 32 x 1.0 + (-15) = 17 bps
Order 1: $0.003500 x (1 - 17/10000) = $0.003494  (0.17% od mid)
Order 2: $0.003500 x (1 - 19/10000) = $0.003493  (0.19% od mid)
Order 3: $0.003500 x (1 - 21/10000) = $0.003493  (0.21% od mid)
```

**L1 Ask (nowe shorty — pasywne):**
```
offset = 32 x 1.0 + 15 = 47 bps
Order 1: $0.003500 x (1 + 47/10000) = $0.003516  (0.47% od mid)
Order 2: $0.003500 x (1 + 49/10000) = $0.003517  (0.49% od mid)
Order 3: $0.003500 x (1 + 51/10000) = $0.003518  (0.51% od mid)
```

**L2 (53 bps):**
```
Bid offset = 53 - 15 = 38 bps  ->  $0.003487  (0.38% od mid)
Ask offset = 53 + 15 = 68 bps  ->  $0.003524  (0.68% od mid)
```

**L3 (80 bps):**
```
Bid offset = 80 - 15 = 65 bps  ->  $0.003477  (0.65% od mid)
Ask offset = 80 + 15 = 95 bps  ->  $0.003533  (0.95% od mid)
```

**L4 (116 bps):**
```
Bid offset = 116 - 15 = 101 bps  ->  $0.003465  (1.01% od mid)
Ask offset = 116 + 15 = 131 bps  ->  $0.003546  (1.31% od mid)
```

**Asymetria widoczna golymokiem:**
- Bidy: 0.17% — 1.01% od mid (BLISKO = agresywne zamykanie SHORT)
- Aski: 0.47% — 1.31% od mid (DALEKO = pasywne shortowanie)

Inventory adjustment przesuwa caly grid — przy SHORT bot agresywniej kupuje (zamyka pozycje) a mniej agresywnie sprzedaje (nie dodaje do pozycji).

### 10. Porownanie rezimow — round-trip spread

Round-trip spread = bid offset + ask offset (ile musialby sie ruszyc rynek zeby bot kupil I sprzedal).

| Rezim | L1 bid (bps) | L1 ask (bps) | Round-trip L1 |
|-------|-------------|-------------|---------------|
| LOW_VOL (flat) | 22 | 22 | 44 bps (0.44%) |
| LOW_VOL (skew -15%) | 7 | 37 | 44 bps |
| HIGH_VOL (flat) | 32 | 32 | 64 bps (0.64%) |
| HIGH_VOL (skew -15%) | 17 | 47 | 64 bps |
| + S/R Accum (spread x 1.3) | 22 | 61 | 83 bps |

**Kluczowa obserwacja:** Round-trip spread jest STALY niezaleznie od skew (inventory adj jest symetryczny: -15 na bid, +15 na ask = suma ta sama). Ale POZYCJA grida jest asymetryczna — przy SHORT bidy sa blizej rynku.

To eleganckie rozwiazanie: bot nie traci na zarobku per round-trip (spread ten sam), ale zmienia PRAWDOPODOBIENSTWO fill na kazdej stronie. Blisze bidy = wieksze prawdopodobienstwo kupna = szybsze zamykanie shorta.

### 11. Lekcje z tego rozdzialu

1. **Spread to nie jedna liczba — to pipeline.** Od mid price do finalnego orderu jest 6+ krokow transformacji. Kazdy modul dodaje swoje "zdanie" — ATR mowi o zmiennosci, inventory adjustment o pozycji, stagger o rozrzuceniu. Efekt koncowy to wypadkowa wielu niezaleznych sygnalow.

2. **Cena vs rozmiar to dwa rozne kanaly.** Spread multipliers (cena) i size multipliers (rozmiar) sa NIEZALEZNE. Bot moze miec ordery na tej samej cenie co zwykle, ale z polowa rozmiaru — lub na dwukrotnie szerszym spreadzie z normalnym rozmiarem. To daje ogromna elastycznosc.

3. **Symetria round-trip z asymetria pozycji.** Inventory adjustment nie zmienia ILE bot zarabia per trade (round-trip staly), ale GDZIE stoi w orderbooku. To jak przesuwanie siatki rybackiej — ta sama siatka, ale w innym miejscu latwiej lapie ryby.

4. **ATR to krol Dynamic Spread.** Jesli ATR jest 0.3% (spokoj), L1 = 22 bps. Jesli ATR to 1.8% (szalenstwo), L1 = 32 bps. Roznica 10 bps moze wydawac sie mala, ale na round-trip to 20 bps — przy 500 tradow dziennie to 100 bps = 1% dodatkowej ochrony.

5. **Clamp to ostatnia linia obrony.** Nawet jesli jakis modul zrobi cos szalonego (np. spread multiplier = 0.01 z powodu buga), clamp zatrzyma wynik w rozsadnych granicach (6-140 bps). Defensive programming w czystej formie.

### Kluczowe pliki

| Plik | Rola w spread pipeline |
|------|----------------------|
| `src/mm_hl.ts` | Auto-Skew, Momentum Guard spread mults, Dynamic Spread selection, stagger, clamp |
| `src/mm/grid_manager.ts` | `getInventoryAdjustment()`, `generateGridOrdersCustom()` — final order price calculation |
| `src/config/short_only_config.ts` | `DynamicSpreadConfig`, `MomentumGuardConfig` — per-token spread params |
| `src/signals/market_vision.ts` | `NANSEN_TOKENS[kPEPE].baseSpreadBps` — base spread source |

---

## S/R Pipeline — Zestawienie faz w zaleznosci od progresu

> "Wyobraz sobie ze idziesz wzdluz brzegu rzeki. Im blizej podchodzisz do wody, tym bardziej zmienia sie twoje zachowanie — najpierw zwalniasz, potem zdejmujesz buty, a na samym brzegu klekasz i nabierasz wode. S/R Pipeline dziala dokladnie tak samo — im blizej supportu lub resistance'u, tym bardziej zmienia sie zachowanie bota."

To jest najwazniejszy rozdzial jesli chcesz zrozumiec JAK bot handluje kPEPE. Poprzednie rozdzialy (#33-#37) opisywaly poszczegolne fazy osobno — teraz zobaczymy **jak wspolgraja ze soba**, co sie wlacza kiedy, i jak caly pipeline zachowuje sie w roznych scenariuszach.

### Parametry kPEPE (z `short_only_config.ts`)

Zanim zaczniemy — oto "pokretla" ktore konfiguruja caly S/R system dla kPEPE:

| Parametr | Wartosc | Opis |
|----------|---------|------|
| `mgStrongZone` | ~1.86% (ATR/price) | 1xATR strefa — "strong zone" wokol S/R |
| `srReductionStartAtr` | 2.5 | Strefa redukcji = 2.5xATR (~4.65% od S/R) |
| `srMaxRetainPct` | 15% | **Granica skew**: Accumulation <= 15%, Reduction > 15% |
| `srReductionMinSkew` | 5% | Min skew zeby Reduction sie wlaczyla |
| `srAccumBounceBoost` | 1.8x | Boost bounce-side przy akumulacji |
| `srAccumFreshMultiplier` | 3.0x | Extra boost na pierwszym dotkniecium S/R |
| `srAccumCounterReduce` | 0.50 | Redukcja counter-side przy akumulacji |
| `srBounceHoldMinDistAtr` | 2.0 | Dystans (w ATR) do pelnego release |
| `srBounceHoldAskReduction` | 0.15 | Min closing-side przy S/R (15%) |
| `srBreakoutTpScoreThreshold` | 0.40 | Min momentum score dla Breakout TP |
| `srReductionGraceCandles` | 3 | Grace period (3x15min = 45min) po break |

`srMaxRetainPct` to kluczowy przelacznik — **rozdziela swiat na dwie polowy**: ponizej 15% skew bot AKUMULUJE pozycje, powyzej 15% bot REDUKUJE. Nigdy oba naraz.

### Metafora: Generał na polu bitwy

Pomysl o S/R pipeline jak o generalu dowodzacym armia:

- **S/R Accumulation** = "Rekrutuj zolnierzy" (buduj pozycje gdy masz malo)
- **S/R Bounce Hold** = "Trzymaj linie!" (nie oddawaj pozycji za wczesnie)
- **S/R Reduction** = "Realizuj zyski!" (zamykaj pozycje blisko celu)
- **Breakout TP** = "Szarza!" (agresywnie zamykaj na silnym momentum)
- **Grace Period** = "Zwiad!" (poczekaj — moze to fakeout)

Generał nie robi wszystkiego naraz. Kazda faza ma swoj moment:

```
Flat przy supportcie → REKRUTUJ zolnierzy (Accumulation)
Armia zbudowana      → TRZYMAJ LINIE (Bounce Hold)
Cena poszla w gore   → Stopniowo REALIZUJ ZYSKI (Reduction)
Silny ruch           → SZARZA! (Breakout TP)
S/R przebity?        → ZWIAD (Grace) — moze fakeout?
```

### Scenariusz A: Bot jest FLAT (skew ~0%) — budowanie pozycji

Wyobraz sobie: cena kPEPE spada w kierunku supportu. Bot nie ma pozycji (flat). Co sie dzieje?

```
RESISTANCE ─────────────────────────────────────────────── R
│
│  Poza strefa — normalny MG (Momentum Guard only)
│
│ ─ ─ ─ ─ ─ ─ 4.65% od support ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  Granica strefy
│
│  SR_ACCUM: progress 0→100%
│  bid x1.0→5.4 (fresh boost), ask x1.0→0.17
│  Im blizej supportu, tym agresywniej kupuje
│
│ ─ ─ ─ ─ ─ ─ ~0.93% od support (progress>80%) ─ ─ ─ ─  Prog ask=0
│
│  SR_ACCUM: progress 80-100%
│  bid x5.4 (max), ask=0 (zero shortowania)
│  BOUNCE_HOLD: tracking only (nie aplikuje redukcji)
│
SUPPORT ════════════════════════════════════════════════════ S
```

**Tabela wartosci** (skew=0%, freshBoost=3.0x):

| Dystans od S | Progress | Faza | bid x | ask x | Co robi |
|-------------|----------|------|-------|-------|---------|
| 4.65% (granica) | 0% | SR_ACCUM start | 1.0 | 1.0 | Wchodzi w strefe |
| 3.50% | 25% | SR_ACCUM | ~2.1 | ~0.63 | Zaczyna kupowac |
| 2.33% | 50% | SR_ACCUM | ~3.2 | ~0.42 | Mocniej kupuje |
| 1.16% | 75% | SR_ACCUM | ~4.3 | ~0.26 | Agresywne bidy |
| 0.93% | 80% | SR_ACCUM (ask=0) | ~4.5 | **0** | Zero askow (flat → nie shortuj) |
| 0.47% | 90% | SR_ACCUM (ask=0) | ~5.0 | **0** | Max akumulacja |
| 0% (AT support) | 100% | SR_ACCUM (ask=0) | ~5.4 | **0** | Na supportcie |

**Skad sie biora te liczby?**

Fresh Touch Boost sprawia ze przy skew=0% (calkowicie flat, "pierwsze dotknieciem S/R") akumulacja jest 3x silniejsza:
```typescript
freshRatio = (srMaxRetainPct - absSkew) / srMaxRetainPct  // (0.15 - 0.00) / 0.15 = 1.0
freshBoost = 1.0 + freshRatio * (srAccumFreshMultiplier - 1.0)  // 1.0 + 1.0 * 2.0 = 3.0
effectiveBounceBoost = srAccumBounceBoost * freshBoost    // 1.8 * 3.0 = 5.4
effectiveCounterReduce = max(0.05, srAccumCounterReduce / freshBoost)  // max(0.05, 0.50/3.0) = 0.17
```

Przy progress=100%: `bid = 1.0 + 1.0 * (5.4 - 1.0) = 5.4x`. To znaczy ze kazdy bid order jest **5.4 razy wiekszy** niz normalnie — bot naprawde chce kupic na supportcie!

**Kluczowa lekcja:** `ask=0` przy progress>80% to **tylko** gdy bot jest FLAT lub SHORT. Jesli bot jest juz LONG, ask NIE zeruje sie — potrzebuje askow zeby zamknac longi z zyskiem (patrz Scenariusz B).

### Scenariusz B: Bot ma LONG 12% skew — akumulacja + ochrona

Bot juz zbudowal troche longow (12% skew). Cena jest blisko supportu. Co sie zmienia?

| Dystans od S | Progress | Faza | bid x | ask x | Co robi |
|-------------|----------|------|-------|-------|---------|
| 4.65% | 0% | SR_ACCUM start | 1.0 | 1.0 | Wchodzi w strefe, skew<15% |
| 2.33% | 50% | SR_ACCUM | ~2.6 | ~0.50 | Buduje longi, mniej askow |
| 0.93% | 80% | SR_ACCUM (has long) | ~3.8 | **x0.35** | ask reduced (nie 0!) — potrzebuje askow zeby zamknac longa z TP |
| 0.47% | 90% | SR_ACCUM + BOUNCE_HOLD tracking | ~4.2 | **x0.35** | BH sledzi ale nie mnozy |
| 0% | 100% | SR_ACCUM + BOUNCE_HOLD tracking | ~4.6 | **x0.35** | Na supportcie |

**Kluczowa roznica:** Przy progress>80% z istniejacym LONG, system NIE zeruje askow. Zamiast tego:
```typescript
// LONG near support → keep reduced asks for closing
sizeMultipliers.ask *= (1.0 - (progress / 100) * (1.0 - effectiveCounterReduce))
// progress=0.89, effectiveCounterReduce=0.36:
// ask * (1.0 - 0.89 * 0.64) = ask * 0.43
```

To byl wlasnie **bug #111** ktory naprawilismy 06.03 — wczesniej ask zerowalo sie bezwarunkowo, i bot z LONG 12% mial `sellLevels=0`. Nie mogl zamknac longow nawet gdyby chcial.

**Analogia:** To jak siedziec na plazy z koszem pelnym ryb (longi). Blisko brzegu (supportu) nie rzucasz wiecej sieci do morza (nie shortujesz), ale MUSISZ moc sprzedac ryby ktore juz masz (aski na closing).

### Scenariusz C: Bot ma LONG 20% skew → cena odbija w gore

Tutaj skew>15% = Accumulation OFF, Reduction OFF (bo idzie w dobra strone). **BOUNCE_HOLD przejmuje**.

```
RESISTANCE ─────────────────────────────────────────────── R
│
│  Poza strefa — normalny MG
│
│ ─ ─ ─ ─ ─ ─ 2.0 ATR (~3.7%) od S ─ ─ ─ ─ ─ ─ ─ ─ ─  BOUNCE_HOLD RELEASED
│
│  BOUNCE_HOLD: progressive release 0%→100%
│  closing-side: ask x0.15→1.00
│
│ ─ ─ ─ ─ ─ ─ 1.0 ATR (~1.86%) od S ─ ─ ─ ─ ─ ─ ─ ─   50% release
│
│  BOUNCE_HOLD: ask x0.15→0.58
│  Troche wiecej askow ale nadal chroni longi
│
│ ─ ─ ─ ─ ─ ─ 0 ATR (AT support) ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
│
│  BOUNCE_HOLD: ask x0.15 (min closing)
│  Prawie zero zamykania — trzymaj pozycje!
│
SUPPORT ════════════════════════════════════════════════════ S
```

| Dystans od S (ATR) | BH Progress | Faza | ask x | Co robi |
|--------------------|-------------|------|-------|---------|
| 0.0 ATR (na S) | 0% | BOUNCE_HOLD | **0.15** | Min closing — trzymaj longi |
| 0.5 ATR | 25% | BOUNCE_HOLD | 0.36 | Troche zamykania |
| 1.0 ATR | 50% | BOUNCE_HOLD | 0.58 | Polowa normalnych askow |
| 1.5 ATR | 75% | BOUNCE_HOLD | 0.79 | Prawie normalnie |
| 2.0 ATR (threshold) | 100% | **RELEASED** | **1.00** | Bounce potwierdzone, pelne aski |
| >2.0 ATR | — | Normalny MG | 1.00 | BH skasowane |

**Jak to dziala w kodzie:**
```typescript
const holdProgressPct = Math.min(100, (distFromSr / srBounceHoldMinDistAtr) * 100)
const askReduction = srBounceHoldAskReduction + (holdProgressPct / 100) * (1.0 - srBounceHoldAskReduction)
// Na supportcie (dist=0): 0.15 + 0 * 0.85 = 0.15
// W polowie (dist=1.0ATR): 0.15 + 0.5 * 0.85 = 0.575
// Przy threshold (dist=2.0ATR): 0.15 + 1.0 * 0.85 = 1.00
```

**Dlaczego to jest wazne:** Bez Bounce Hold, MG boostowal aski jak cena szla w gore (bo pump = sprzedawaj). S/R Accum budowala longi za bid x5.4 przy supportcie... a potem Momentum Guard zamykal je za ask x1.30 po 0.5% wzroscie. Zysk z 2h budowania longow zjadany w 5 minut. Bounce Hold chroni te pozycje dopoki bounce sie nie rozwinie.

**Analogia:** Bounce Hold to jak powiedzenie "nie sprzedawaj jabloni zaraz po posadzeniu — poczekaj az urosnie".

### Scenariusz D: Bot ma SHORT 25% skew → cena spada do support (TP!)

Skew>15%, SHORT, cena spada = profitable → **S/R Reduction aktywna**. To jest moment take-profit.

```
RESISTANCE ─────────────────────────────────────────────── R
│
│  Poza strefa — normalny MG
│
│ ─ ─ ─ ─ ─ ─ 4.65% od support ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  SR_REDUCTION start
│
│  SR_REDUCTION: progress 0→60%
│  ask progresywnie maleje (stop building shorts)
│  bid progresywnie rosnie (close shorts = take profit)
│
│ ─ ─ ─ ─ ─ ─ ~1.86% od support (progress>60%) ─ ─ ─ ─  ask=0 prog
│
│  SR_REDUCTION: progress 60→100%
│  ask=0 (ZERO nowych shortow!)
│  bid x1.6→2.0 (agresywne zamykanie)
│
SUPPORT ════════════════════════════════════════════════════ S
```

| Dystans od S | Progress | Faza | ask x | bid x | Co robi |
|-------------|----------|------|-------|-------|---------|
| 4.65% (granica) | 0% | SR_REDUCTION start | x1.0 | x1.0 | Wchodzi w strefe |
| 3.50% | 25% | SR_REDUCTION | x0.75 | x1.25 | Mniej shortow, wiecej close |
| 2.33% | 50% | SR_REDUCTION | x0.50 | x1.50 | Polowa shortow, 1.5x close |
| 1.86% | 60% | SR_REDUCTION (ask=0) | **0** | x1.60 | Zero nowych, boost close |
| 0.93% | 80% | SR_REDUCTION (ask=0) | **0** | x1.80 | Agresywne zamykanie |
| 0% | 100% | SR_REDUCTION (ask=0) | **0** | x2.00 | Maximum take profit |

**Jak to dziala w kodzie:**
```typescript
if (progressPct > 60) {
  sizeMultipliers.ask = 0  // ZERO new shorts — very close to support
} else {
  sizeMultipliers.ask *= (1.0 - progressPct / 100)  // Progressive: 50% → ask x0.50
}
sizeMultipliers.bid *= (1.0 + (progressPct / 100) * (srClosingBoostMult - 1.0))
// progress=80%: bid *= (1.0 + 0.80 * 1.0) = bid * 1.80
```

**Kluczowy warunek:** `srReductionMinSkew = 5%`. Reduction wlacza sie TYLKO gdy `|skew| > 5%`. Przy skew 3% = "za malo pozycji zeby redukowac" → normal MM. To chroni przed sytuacja gdzie bot probowalby "zamykac" pozycje ktorej prawie nie ma.

### Scenariusz E: BREAKOUT TP (niezalezny od S/R distance)

Breakout TP to niezalezny system ktory patrzy TYLKO na momentum score, nie na odleglosc od S/R. Wlacza sie przy silnym momentum w kierunku pozycji.

| Warunek | Faza | bid x | ask x |
|---------|------|-------|-------|
| LONG + momentumScore > 0.40 | BREAKOUT_TP | / 1.5 (0.67) | x1.5 | Agresywne zamykanie longow |
| SHORT + momentumScore < -0.40 | BREAKOUT_TP | x1.5 | / 1.5 (0.67) | Agresywne zamykanie shortow |

**Jest MULTIPLICATIVE z reszta** — czyli mnozy sie z wartosciami z S/R Reduction/Accumulation. Jesli S/R Reduction daje bid x1.80, a Breakout TP daje bid x1.5, finalny wynik to bid x2.70. Oba systemy sie zgadzaja: "ZAMYKAJ!".

**Dlaczego prog 0.40 a nie 0.50 (default)?** kPEPE jest volatile — momentum jest "prawdziwy" szybciej niz na BTC. Gdy momentum score kPEPE > 0.40, to juz powazny ruch.

**Wazne:** Breakout TP NIE jest blokowany przez Bounce Hold. Bounce Hold chroni pozycje, ale Breakout TP to safety valve — jesli momentum jest naprawde silny (score > 0.40), pozycja powinna byc zamykana niezaleznie od odleglosci od S/R.

### Scenariusz F: GRACE PERIOD po przebiciu S/R

Grace Period to "zwiad" — gdy cena przebija support lub resistance, bot CZEKA zanim zacznie redukowac pozycje. Dlaczego? Bo wiele przebic to fakeouty.

| Event | Prox | Faza | Efekt |
|-------|------|------|-------|
| Cena dotyka S | -1.0 | Normal | S/R systemy dzialaja |
| Candle close < S | **-1.2** | GRACE START | 45min timer, **Reduction suppressed** |
| Grace active (0-45min) | -1.2 | GRACE | Accumulation kontynuuje (fakeout?) |
| Grace expired | -1.2 | REDUCTION | Breakdown potwierdzony, redukcja OK |
| Cena wraca > S | > -1.2 | GRACE CLEARED | Accumulation kontynuuje |

**Kluczowe rozroznienie: prox=-1.0 vs prox=-1.2**

- **prox=-1.0** (AT_SUPPORT): Tick price dotknal supportu. Moze to byc wick — cena moze od razu sie odbic. Nie jest to wystarczajacy powod do paniki.
- **prox=-1.2** (BROKEN_SUPPORT): **15-minutowa swieca ZAMKNELA SIE** ponizej supportu. To nie wick — to potwierdzone przelamanie. Dopiero TERAZ grace timer startuje.

```typescript
// BROKEN = candle close confirmed, nie tick price
if (hasLongPos && mgProxSignal <= -1.2) {
  // Start grace timer — czekaj 3 candles (45 min) na potwierdzenie
}
```

**Analogia:** Wyobraz sobie ze pilnujesz mostu. Ktos przechodzi na druga strone (tick price przebija support). Ale moze zawroci! Czekasz 45 minut. Jesli nie wroci — most przejety, wycofuj sie (reduction). Jesli wroci — false alarm, kontynuuj obrone (accumulation).

### Pelna mapa — co jest aktywne kiedy

To jest "master chart" calego S/R pipeline. Os X to odleglosc od S/R, os Y to rozmiar pozycji (skew):

```
skew
 ↑
 │
45%│ ............ INVENTORY_SL (panic jesli drawdown>2.5xATR) .........
   │
25%│ SR_REDUCTION  │  SR_REDUCTION  │  BOUNCE_HOLD    │  normalny MG
   │ ask=0,bid x2  │  progresywna   │  ask x0.15→1.0  │
   │               │                │                  │
15%├───────────────┤────────────────┤──────────────────┤──────────────
   │               │                │                  │
   │ SR_ACCUM      │  SR_ACCUM      │  BOUNCE_HOLD     │  normalny MG
   │ ask=0/reduced │  bid x5.4      │  tracking only   │
   │ bid x5.4      │  ask x0.17-0.35│  (SR_ACCUM owns) │
 0%│               │                │                  │
   └───────────────┴────────────────┴──────────────────┴──────────────→ dystans
   AT support     progress>80%    1.0 ATR           2.0 ATR        daleko
   (0%)           (~0.93%)        (~1.86%)          (~3.72%)       (>4.65%)
```

**Wzajemne wykluczanie — kto z kim moze:**

| Faza A | Faza B | Relacja |
|--------|--------|---------|
| SR_ACCUM (skew<=15%) | SR_REDUCTION (skew>15%) | **Exclusive** — nigdy oba naraz (rozne warunki skew) |
| SR_ACCUM | BOUNCE_HOLD | **Sekwencyjne** — BH tracking only gdy SA aktywne, BH przejmuje po SA |
| SR_REDUCTION | BOUNCE_HOLD | BH cleared gdy Reduction aktywna (pozycja sie zmniejsza) |
| BREAKOUT_TP | Wszystkie | **Additive** — multiplicative z reszta, nie blokowany przez BH |
| GRACE | SR_REDUCTION | Grace **suppressuje** Reduction (czekaj na potwierdzenie breaku) |
| INV_AWARE_MG | SR_ACCUM | INV_AWARE **suppressed** blisko S/R (prox<=-0.5), SA ma priorytet |

Zauwaz ze `srMaxRetainPct=15%` to jedyna granica miedzy Accumulation a Reduction. Ponizej = buduj. Powyzej = zamykaj. Prosty przelacznik, ale efekty dramatyczne.

### Pelny cykl zycia pozycji (mean-reversion)

Oto jak wygladaja wszystkie fazy w pelnym cyklu — od flat przy supportcie do flat przy resistance. To jest "zloty scenariusz" bota, gdzie wszystko dziala idealnie:

```
[1] Cena przy SUPPORT, flat     → SR_ACCUM: buduj LONGI (bid x5.4, ask=0)
[2] Skew rosnie do 15%          → SR_ACCUM off, BOUNCE_HOLD przejmuje (ask x0.15)
[3] Cena odbija w gore          → BOUNCE_HOLD: progressive release (ask x0.15→1.0)
[4] Bounce 2.0xATR              → BOUNCE_HOLD released, normalny MG
[5] Silny pump (score>0.40)     → BREAKOUT_TP: agresywne zamykanie (ask x1.5)
[6] Cena przy RESISTANCE        → SR_REDUCTION: zamykaj reszte (ask x2.0, bid=0)
[7] Flat przy RESISTANCE        → SR_ACCUM: buduj SHORTY (mirror krokow 1-6)
```

**W prawdziwym swiecie** ten cykl rzadko jest tak czysty. Cena moze oscylowac wokol supportu przez godziny, fakeouty moga triggerowac Grace Period, a momentum score moze sie zmieniac z tick na tick. Ale FRAMEWORK jest ten sam — bot wie CO robic w KAZDYM punkcie tego cyklu.

### Interakcje z innymi systemami

S/R pipeline nie dziala w prozni. Oto jak wspolpracuje z reszta:

| System | Interakcja z S/R |
|--------|-----------------|
| **Momentum Guard** | Bazowe multipliers (bid/ask) — S/R mnozy na wierzch. MG + SR_ACCUM: bid x1.30 * x5.4 = bid x7.0 (ultra agresywne) |
| **Auto-Skew** | Przesuwa mid price — S/R pracuje na przesunietem gridzie. Komplementarne. |
| **MIN_PROFIT** | Filtruje ordery < 10bps od entry. S/R reduction = profitable → MIN_PROFIT NIE filtruje (ordery daleko od entry) |
| **Inventory SL** | Panic mode przy ekstremalnym skew+drawdown. Ma wyzszy priorytet niz S/R Reduction (overriduje bid/ask) |
| **Dynamic Spread** | ATR-based layer scaling. Niezalezny od S/R — zmienia SPREAD, nie SIZE |
| **Prediction Bias** | h4 prediction. Multiplicative z S/R. BEARISH prediction + SR_ACCUM at support = bid x5.4 * x0.92 = bid x4.97 |

### Kluczowe pliki

| Plik | Rola w S/R pipeline |
|------|---------------------|
| `src/mm_hl.ts` (~8411-8728) | Cala logika S/R: Reduction, Grace, Accumulation, Bounce Hold, Breakout TP |
| `src/config/short_only_config.ts` | Config: `MomentumGuardConfig` interface, defaults, kPEPE overrides |
| `src/signals/market_vision.ts` | S/R levels z 1h candle bodies (supportBody12h, resistanceBody12h) |

### 5 lekcji z budowania S/R pipeline

1. **Jedna granica, dwa swiaty.** `srMaxRetainPct=15%` to jedyny przelacznik miedzy "buduj pozycje" a "zamykaj pozycje". Gdy pierwszy raz go ustawialismy na 8%, akumulacja stopowala za wczesnie (bug #106). Podniesienie do 15% pozwolilo botowi budowac wieksza pozycje zanim zaczyna redukowac. Prosty parametr — ogromny efekt.

2. **Nie zeruj askow gdy masz longi.** Bug #111 — najsubtelniejszy bug w calym pipeline. `ask=0` blisko supportu ma sens gdy bot jest flat (nie chcesz shortowac bounce). Ale gdy bot jest LONG, potrzebuje askow zeby ZAMKNAC longi z zyskiem. Rozwiazanie: sprawdzaj `hasAnyLong` przed zerowaniem.

3. **Grace Period to cierpliwosc.** Wiele breakow to fakeouty — cena przelamuje support, wraca po 20 minutach, i bot stracilby pozycje gdyby od razu zaczal redukowac. 45 minut cierpliwosci (3 candles 15m) to mala cena za unikniecie falszywych sygnałow.

4. **Progressive > Binary.** Kazda faza w pipeline jest PROGRESYWNA (0%→100%), nie binarna (ON/OFF). Bounce Hold nie robi "ask=0 → ask=1.0" — robi "ask x0.15 → x0.36 → x0.58 → x0.79 → x1.00". To daje gladkie przejscia i unika nagłych skokow w zachowaniu grida.

5. **Multiplicative composition.** Kazdy system mnozy `sizeMultipliers.bid/ask` — wynik to iloczyn WSZYSTKICH modulow. Gdy 3 systemy sie zgadzaja (MG x1.30 * SR_REDUCTION x1.80 * BREAKOUT_TP x1.50 = bid x3.51), efekt jest potezny. Gdy sie nie zgadzaja — wzajemnie sie neutralizuja. To jest elegancja multiplicative composition: nie musisz pisac regul "co robic gdy A i B sie nie zgadzaja" — matematyka robi to za ciebie.

---

## Chapter 52: Trzy Zamki, Żaden Nie Zamknięty — Jak kPEPE Krwawił Przez Luki w Obronie (08.03.2026)

> "Nie wystarczy mieć trzy zamki na drzwiach, jeśli złodziej wchodzi przez okno."

### Objawy: śmierć od tysiąca cięć

Ranek 8 marca. kPEPE bot jest LONG (entry $0.003280), cena spada do $0.003216-$0.003267. Bot zaczyna zamykać longi — 17 transakcji "Close Long", prawie wszystkie ze stratą. Łączny wynik: **-$19.76**.

Każda strata jest mała — $0.08 tu, $1.29 tam, $5.66 tam. Ale one się kumulują. To jest klasyczny "death by a thousand cuts" — bot nie eksploduje, on powoli się wykrwawia.

```
08:32  Close Long @ $0.003221  →  -$5.66   (1.8% pod entry)
08:48  Close Long @ $0.003216  →  -$6.14   (2.0% pod entry)
10:29  Close Long @ $0.003267  →  -$0.98   (0.4% pod entry)
11:13  Close Long @ $0.003259  →  -$1.89   (0.6% pod entry)
11:22  Close Long @ $0.003264  →  -$0.95   (0.5% pod entry)
11:22  Close Long @ $0.003269  →  -$0.71   (0.3% pod entry)
...itd, łącznie 15 close'ów na minusie
```

### Diagnoza: trzy zamki, trzy luki

Bot miał TRZY systemy obronne, które powinny zapobiec sprzedaży poniżej entry. Żaden nie zadziałał.

#### Zamek 1: BREAKEVEN_BLOCK (linia ~8692)

```typescript
if (hasLongPos && entryPrice > 0 && midPrice < entryPrice && nearSupport) {
  sizeMultipliers.ask = 0  // ZERO asków
}
```

**Luka:** `nearSupport` — wymaga, żeby cena była blisko supportu. Gdy cena jest w "no man's land" (underwater, ale daleko od S/R), ten zamek się nie zamyka. Support był na $0.003180, a cena chodziła po $0.003220-0.003270 — za daleko od supportu, żeby BREAKEVEN_BLOCK się aktywował.

#### Zamek 2: MIN_PROFIT (linia ~9218)

```typescript
const minAskPrice = entryPx * (1 + minProfitFraction)  // entry + 10bps
gridOrders = gridOrders.filter(o => o.side !== 'ask' || o.price >= minAskPrice)
```

**Luka:** AUTO_SKEW. Gdy bot jest LONG (skew=11%), AUTO_SKEW przesuwa mid price W DÓŁ ("aggressive asks"). Grid generuje ordery wokół przesuniętego mid. Efekt: aski są umieszczane niżej niż powinny. Plus, przy `|skew| > 30%`, MIN_PROFIT zaczyna POZWALAĆ na straty (graduated bypass).

#### Zamek 3: PROFIT_FLOOR (linia ~9429)

```typescript
if (pair !== 'kPEPE' && ...) {
  gridOrders = gridOrders.filter(o => o.side !== 'ask' || o.price >= entryPx)
}
```

**Luka:** `pair !== 'kPEPE'`! Dosłownie: kPEPE jest WYKLUCZONE z tego filtra. Komentarz mówił "kPEPE excluded — need full grid on both sides for fill volume". To miało sens kiedyś — kPEPE jako market maker potrzebuje orderów po obu stronach żeby łapać spread. Ale to było napisane ZANIM dodaliśmy S/R Accumulation i Momentum Guard. W nowym modelu bot świadomie buduje pozycję i NIE powinien jej zamykać ze stratą.

### Analogia: system alarmowy w domu

Wyobraź sobie, że masz dom z trzema systemami alarmowymi:

1. **Czujnik ruchu** — ale tylko w salonie (BREAKEVEN_BLOCK: tylko near S/R)
2. **Zamek na drzwiach** — ale ktoś podłożył klucz pod wycieraczkę (MIN_PROFIT: AUTO_SKEW obniża aski)
3. **Alarm na oknach** — ale wyłączony w kuchni (PROFIT_FLOOR: `pair !== 'kPEPE'`)

Złodziej (rynek) wchodzi przez okno w kuchni. Czujnik ruchu go nie widzi (nie jest w salonie). Zamek na drzwiach jest nieistotny (wchodzi oknem). Alarm na oknach jest wyłączony właśnie w tym pokoju.

Trzy systemy, zero ochrony.

### Fix: HARD BREAKEVEN GUARD

Zamiast łatać trzy dziury, dodaliśmy jeden UNIWERSALNY guard — działa ZAWSZE, dla KAŻDEGO tokena, NIEZALEŻNIE od S/R proximity:

```typescript
const BREAKEVEN_FEE_BUFFER = 0.001  // 0.1% = 10bps na feesy

if (position && Math.abs(position.size) > 0 && position.entryPrice
    && Array.isArray(gridOrders) && !inventorySlPanic) {
  const entryPx = position.entryPrice

  if (position.size > 0) {
    // LONG: żaden ask nie może być poniżej entry + fee buffer
    const minAskPx = entryPx * (1 + BREAKEVEN_FEE_BUFFER)
    gridOrders = gridOrders.filter(o =>
      o.side !== 'ask' || o.price >= minAskPx
    )
  } else if (position.size < 0) {
    // SHORT: żaden bid nie może być powyżej entry - fee buffer
    const maxBidPx = entryPx * (1 - BREAKEVEN_FEE_BUFFER)
    gridOrders = gridOrders.filter(o =>
      o.side !== 'bid' || o.price <= maxBidPx
    )
  }
}
```

**Kluczowe decyzje projektowe:**

1. **Fee buffer 0.1% (10bps):** Round-trip fee na Hyperliquid to ~8bps (4bps maker × 2). Dodajemy 2bps marginesu. Bez tego bufora, ask na cenie entry pozornie wychodzi na zero, ale po odliczeniu fee to strata.

2. **`!inventorySlPanic`:** Jedyny bypass. Gdy bot jest w ekstremalnym drawdown (INVENTORY_SL), MUSI zamknąć pozycję nawet ze stratą. To jest "zbij szybę w razie pożaru" — emergency exit ma priorytet nad profit protection.

3. **Brak `pair !== 'kPEPE'`:** Guard jest UNIWERSALNY. Żaden token nie jest wykluczony. To eliminuje całą klasę bugów typu "zapomniano dodać token X do listy wyjątków".

4. **Filtrowanie orderów, nie zerowanie multiplierów:** BREAKEVEN_BLOCK ustawia `sizeMultipliers.ask = 0` — to blokuje WSZYSTKIE aski. HARD BREAKEVEN GUARD filtruje KONKRETNE ordery poniżej breakeven, ale przepuszcza te powyżej. Efekt: bot nadal może sprzedawać Z ZYSKIEM, nawet gdy jest underwater.

### Layered Defense: jak to teraz działa razem

```
Cena blisko SUPPORT + underwater:
  ├── BREAKEVEN_BLOCK: ask=0 (zero asków — pełna blokada)
  └── GUARD: backup, nic do filtrowania (zero asków i tak)

Cena w "no man's land" + underwater:
  ├── BREAKEVEN_BLOCK: NIE aktywny (nie near support)
  ├── Grid generuje 9 asków poniżej entry
  └── GUARD: filtruje wszystkie 9 → sellLevels=0  ← NOWY!

Cena blisko ENTRY (np. 0.2% pod):
  ├── BREAKEVEN_BLOCK: może nie aktywować (nie near S/R)
  ├── Grid generuje 9 asków, 7 powyżej breakeven, 2 poniżej
  └── GUARD: filtruje 2 → sellLevels=7 (bot może zamknąć z zyskiem)

INVENTORY_SL PANIC (ekstremalny drawdown):
  ├── inventorySlPanic = true
  ├── GUARD: BYPASSED (emergency exit)
  └── Bot zamyka ze stratą (lepsze -5% niż -20%)
```

### Weryfikacja w produkcji

Natychmiast po deployu zobaczyliśmy:

```
mm-virtual:
🛡️ [GUARD] VIRTUAL: Underwater protection active.
  Restricting all asks to Breakeven (>$0.660560)
  | entry=$0.659900 mid=$0.648050 removed=8

mm-pure:
🛡️ [BREAKEVEN_BLOCK] kPEPE: LONG underwater 1.04% at SUPPORT → BLOCKING ASKS
  (entry=0.003280 mid=0.003246)
[ML-GRID] kPEPE: buyLevels=15 sellLevels=0  ← zero asków, bot czeka
```

VIRTUAL: entry $0.6599, cena $0.6481 (1.8% pod). GUARD usunął **wszystkie 8 asków**. Bez GUARD, te aski byłyby fillowane po $0.649-0.654, każdy fill = strata ~$0.50-1.00.

### Scope hoisting — subtelny bug w zasięgu zmiennych

`inventorySlPanic` był zadeklarowany WEWNĄTRZ bloku `if (pair === 'kPEPE')`:

```typescript
if (pair === 'kPEPE') {
  let inventorySlPanic = false  // ← tu
  // ... 1200 linii kodu ...
}
// GUARD jest TU — poza blokiem → inventorySlPanic nie istnieje!
```

HARD BREAKEVEN GUARD jest PO zamknięciu obu bloków (kPEPE i else). `inventorySlPanic` zadeklarowany wewnątrz bloku nie jest widoczny na zewnątrz (`let` ma block scope w JavaScript/TypeScript).

**Fix:** Hoist deklaracji PRZED `if/else`:

```typescript
let inventorySlPanic = false  // ← HOISTED: widoczny w GUARD
if (pair === 'kPEPE') {
  // ... inventorySlPanic = true gdy INVENTORY_SL fires ...
}
// GUARD: !inventorySlPanic → działa poprawnie
```

To jest klasyczny "scope hoisting" — przeniesienie deklaracji na wyższy poziom żeby zmienna była dostępna tam, gdzie jest potrzebna. W dużych plikach (mm_hl.ts ma 10k+ linii) łatwo przeoczyć, że zmienna jest zadeklarowana głęboko w bloku if/else.

### 5 lekcji

1. **Exclusion lists to bomby zegarowe.** `pair !== 'kPEPE'` w PROFIT_FLOOR to klasyczny "negative filter" — lista rzeczy które NIE są chronione. Dodajesz nowy token → zapominasz dodać go do listy → token jest niezabezpieczony. Positive filter (`if position && ...`) jest bezpieczniejszy — domyślnie chroni wszystko.

2. **Testuj ochronę, nie tylko logikę.** Każdy z trzech zamków działał poprawnie w izolacji. Bug był w ich KOMPOZYCJI — luki w jednym nie były pokryte przez drugi. Gdybyśmy napisali test "co się dzieje gdy bot jest LONG, underwater, i NIE near support?", znaleźlibyśmy lukę od razu.

3. **Fee buffer > zero buffer.** Breakeven to nie "sprzedaj po cenie wejścia". To "sprzedaj po cenie wejścia + feesy". Bez bufora, every fill at entry is a net loss. 10bps bufora to $0.10 na $100 — grosze, ale zapobiega systematycznym micro-losses.

4. **Emergency exit musi mieć bypass.** GUARD chroni przed churnem, ale nie może blokować emergency exit. `!inventorySlPanic` to "zbij szybę w razie pożaru". Bez tego, bot w ekstremalnym drawdown nie mógłby zamknąć pozycji → katastrofalna strata. Każdy safety system musi mieć override dla sytuacji gorszej niż ta, przed którą chroni.

5. **Block scope w dużych plikach to pułapka.** `let` w bloku `if` nie jest widoczny poza nim. W pliku z 10k linii, blok `if` może mieć 1200 linii kodu — łatwo zapomnieć, że jesteś "wewnątrz" i zmienna nie będzie widoczna za `}`. Hoist krytyczne zmienne na wyższy poziom, albo — jeszcze lepiej — rozbij plik na mniejsze moduły.

---

## Chapter 53: Mierz, Żeby Wiedzieć — Dzienny Raport na Discord (09.03.2026)

> "Nie możesz poprawić tego, czego nie mierzysz." — Peter Drucker

### Po co raport?

Mamy bota który handluje 24/7. Wiemy że GUARD działa. Wiemy że PnL jest na plusie. Ale skąd wiemy, czy to jest **dobry** plus? Czy fee nie zjadają zysku? Czy bot nie trzyma pozycji za długo? Czy nie jest za bardzo wychylony w jedną stronę?

Bez danych podejmujesz decyzje na czuja. Z danymi — podejmujesz decyzje na podstawie faktów.

### Nowe metryki i dlaczego każda ma znaczenie

#### 1. Skew Exposure (Ekspozycja Kierunkowa)

```
kPEPE:   -19.8% (SHORT)
VIRTUAL: +0.6%  (LONG)
```

Skew = `position_notional / equity`. Mówi Ci: "jaka część Twojego konta jest wystawiona na ruch w jednym kierunku?"

**Dlaczego ważne:** kPEPE ma 19.8% equity na shorcie. Jeśli kPEPE pompnie 10%, tracisz ~2% equity. Przy 50% skew i 10% ruch, tracisz 5%. Skew to Twój termometr ryzyka — im wyższy, tym większe ryzyko (ale też większy potencjał zysku).

Market maker powinien mieć niski skew (< 10% = idealnie). 19.8% to akceptowalne dla memcoina z silnym sygnałem kierunkowym, ale warto obserwować.

#### 2. Fee Efficiency (Efektywność Opłat)

```
Fee/Profit: 11.3%  ✅ Healthy
```

Stosunek zapłaconych fee do realized PnL. Progi:
- **< 15%**: Healthy — feesy to koszt prowadzenia biznesu
- **15-30%**: Warning — za dużo obrotu w stosunku do zysku
- **> 30%**: Churning — bot miele pozycje i traci na fee

**Przed GUARD** fee efficiency kPEPE dochodziło do 40%+ — bot zamykał i otwierał pozycje non-stop, każdy round-trip to ~8bps fee. Po GUARD: 11.3%. Różnica jak dzień i noc.

**Analogia:** Fee efficiency to jak "koszt paliwa na kilometr". Samochód który spala 5L/100km to healthy. 15L/100km to SUV — drogo ale akceptowalnie. 50L/100km to czołg — coś jest nie tak z silnikiem.

#### 3. Inventory Aging (Wiek Pozycji)

```
kPEPE:   15.7h
VIRTUAL: 22.5h
```

Czas między pierwszym otwarciem a ostatnim zamknięciem pozycji w oknie 24h. Mówi: "jak długo bot trzyma towar?"

**Dlaczego ważne:** Market maker chce szybko obracać — kupić tanio, sprzedać drogo, powtórzyć. Jeśli inventory aging rośnie (np. z 4h na 24h), to znaczy że bot utknął z pozycją i nie może jej zamknąć z zyskiem. To early warning signal.

kPEPE 15.7h jest wysoki — bot trzymał longi underwater przez noc (dzięki GUARD nie zamknął ze stratą). VIRTUAL 22.5h — podobnie, ale zamknął prawie całą pozycję z zyskiem.

#### 4. Guard Blocks

```
kPEPE:   25 (25 BREAKEVEN_BLOCK + 0 HARD BREAKEVEN GUARD)
VIRTUAL: 2  (0 BREAKEVEN_BLOCK + 2 HARD BREAKEVEN GUARD)
```

Ile razy safety systemy zablokowały potencjalnie stratne ordery. Każdy block = uniknięta strata.

**Interpretacja:** kPEPE miał 25 blocków — wszystkie przez BREAKEVEN_BLOCK (cena była near support). VIRTUAL miał 2 blocki przez HARD BREAKEVEN GUARD (cena w "no man's land"). Gdyby GUARD nie istniał, te 2 blocki byłyby 2 stratne fille.

### Architektura raportu

```python
# Dane z 3 źródeł:
# 1. Hyperliquid API — pozycje, fille, equity
# 2. PM2 logi — guard blocks, VPIN, exec stats
# 3. Obliczenia lokalne — skew, fee efficiency, aging

fills_24h = get_fills_24h()        # API: userFills + userFillsByTime
state = get_account_state()         # API: clearinghouseState
logs = get_pm2_logs("mm-pure")     # PM2: grep GUARD, VPIN, Exec
```

Skrypt jest w czystym Pythonie (bez TS/node dependencies) — łatwiejszy do debugowania i szybszy do odpalenia z crona.

**Cron:** `5 0 * * *` — codziennie 00:05 UTC. Pięć minut po północy żeby dać czas na ostatnie fille z poprzedniego dnia.

### Lekcje

1. **Mierz wszystko, co Cię kosztuje.** Fee efficiency ujawniła, że GUARD obniżył koszty z 40% do 11%. Bez tej metryki wiedzielibyśmy tylko "PnL jest lepsze" — ale nie wiedzielibyśmy DLACZEGO.

2. **Automatyzuj obserwację.** Ręczne sprawdzanie logów (`pm2 logs | grep ...`) działa do debugowania, ale nie do codziennego monitoringu. Cron + Discord = dostajesz raport na telefon każdego ranka.

3. **Progi > wartości absolutne.** "Fee: $4.22" nic nie mówi. "Fee/Profit: 11.3% ✅ Healthy" mówi wszystko. Progi (< 15% / 15-30% / > 30%) zamieniają dane w decyzje.

---

## Rozdział 54: Fee Efficiency Optimization — Nie zarabiaj po to, żeby płacić prowizję

> "Jeśli 37 centów z każdego dolara zysku oddajesz giełdzie, to nie jesteś traderem — jesteś dostarczycielem płynności pro bono."

### Problem: kPEPE churning (37% fee efficiency)

Raport z Rozdziału 53 ujawnił coś niepokojącego: kPEPE miał **fee efficiency 37%**. To znaczy, że z każdego $1 zrealizowanego zysku, $0.37 szło na opłaty transakcyjne. Dla porównania, VIRTUAL miał 4.4% — prawie 10x lepiej.

Dlaczego? Bot **micro-scalpował** — otwierał i zamykał pozycje z maleńkim spreadem (10-15 basis points), co ledwo pokrywało koszty opłat. Wyobraź sobie, że prowadzisz taksówkę, ale każdy kurs jest tak krótki, że więcej paliwa palisz na rozgrzewanie silnika niż na sam przejazd.

### Diagnoza: zbyt wąski spread po adjustmentach

Spread pipeline kPEPE wygląda tak:

```
Base L1 = 32bps (HIGH_VOL, z Dynamic Spread)
    ↓
Skew Adjustment = -15bps (AUTO_SKEW przesuwa mid, inventory adjustment kompresuje)
    ↓
Efektywne L1 = ~10-17bps
    ↓
Round-trip = 20-34bps
    ↓
Fee round-trip = ~7bps (3.5bps maker × 2 strony)
    ↓
Netto na fill = 13-27bps... ale te najwęższe (13bps) to krawędź opłacalności
```

Problem leżał w dwóch miejscach:

1. **`minProfitBps = 10`** — close ordery musiały być zaledwie 10bps od entry. Przy 7bps fee round-trip, zostawało 3bps marginu. Jeden tick w złą stronę i fill był na stracie.

2. **Brak "podłogi" na effective spread** — po wszystkich adjustmentach (skew, toxicity, spread multipliers), ordery mogły wylądować dowolnie blisko mid price. Żaden mechanizm nie mówił "hej, ten order jest za blisko, nie ma sensu go składać".

### Rozwiązanie: dwa bezpieczniki

**Bezpiecznik #1: minProfitBps 10 → 20 (dla kPEPE)**

Prosty config override:

```typescript
DYNAMIC_SPREAD_OVERRIDES['kPEPE'] = {
  minProfitBps: 20,  // was 10 — close order musi być >= 20bps od entry
}
```

Teraz close ordery, które zamykałyby pozycję z marginem mniejszym niż 20bps, są automatycznie odfiltrowane. 20bps minus 7bps fee = 13bps czystego zysku minimum na każdym filli.

**Bezpiecznik #2: Tightness Floor 18bps**

Nowy filtr po wygenerowaniu grida, PRZED MIN_PROFIT:

```typescript
const TIGHTNESS_FLOOR_BPS = 18
const minBidPx = mid * (1 - 18/10000)  // max bid = mid - 0.18%
const maxAskPx = mid * (1 + 18/10000)  // min ask = mid + 0.18%

// Usuń ordery zbyt blisko mid
gridOrders = gridOrders.filter(o => {
  if (o.side === 'bid' && o.price > minBidPx) return false
  if (o.side === 'ask' && o.price < maxAskPx) return false
  return true
})
```

To jest jak "strefa buforowa" wokół mid price. Żaden order — ani bid, ani ask, ani open, ani close — nie może być bliżej niż 18bps od aktualnej ceny. To chroni przed sytuacją, gdzie skew adjustment ścisnął spread do absurdalnie wąskiego poziomu.

### Dlaczego dwa bezpieczniki, nie jeden?

Bo chronią przed **różnymi** problemami:

| Bezpiecznik | Co chroni | Kiedy działa |
|-------------|-----------|-------------|
| **Tightness Floor (18bps)** | Ordery zbyt blisko **mid price** | Zawsze — nawet bez pozycji |
| **MIN_PROFIT (20bps)** | Close ordery zbyt blisko **entry price** | Tylko gdy masz pozycję |

Scenariusz: Mid=$0.003200, entry=$0.003180 (SHORT, 20bps pod wodą).

- Tightness Floor: "Nie składaj bida powyżej $0.003194" (18bps od mid)
- MIN_PROFIT: "Nie składaj bida powyżej $0.003174" (20bps od entry — profitable close)

Oba działają, ale MIN_PROFIT jest strictszy (wymaga profitu od entry), a Floor chroni przed absurdalnie ciasnym spredem nawet gdy MIN_PROFIT by przepuścił.

### Analogia: Minimum Order Value

To jak "minimum order value" w dostawie jedzenia. Uber Eats nie pozwala ci zamówić jednego banana za $0.50, bo koszt dostawy ($5) zjadłby cały przychód. Ustawiają minimum $15 żeby każde zamówienie było opłacalne po odjęciu kosztów.

Nasz bot robi to samo: "Nie rób filla, który jest tak mały, że opłata transakcyjna zjada cały spread."

### Pipeline position

```
generateGridOrdersCustom()  →  ordery wygenerowane
    ↓
>>> TIGHTNESS FLOOR (18bps) <<<  →  usuń ordery zbyt blisko mid
    ↓
MIN_PROFIT (20bps)  →  usuń close ordery zbyt blisko entry
    ↓
HARD BREAKEVEN GUARD  →  usuń close ordery poniżej breakeven
    ↓
Toxicity layer removal  →  usuń L1/L2 przy toksycznym flow
```

Trzy warstwy ochrony, każda na innym poziomie. Tightness Floor = najszersza sieć (łapie wszystko), MIN_PROFIT = precyzyjny filtr (tylko close ordery), GUARD = ostatnia linia obrony (absolutny breakeven).

### Lekcje

1. **Fee efficiency to kluczowa metryka.** Bez niej nie wiesz, czy twój spread pokrywa koszty. Możesz mieć "zielone PnL" a nadal tracić pieniądze na prowizje w długim terminie (wysoki volume, niski net).

2. **Post-hoc filtrowanie > pre-hoc konfiguracja.** Zamiast próbować skonfigurować idealny spread z góry (co jest niemożliwe bo skew i volatility się ciągle zmieniają), generuj grid normalnie, a potem odfiltruj ordery które by były nieopłacalne. Pragmatyczne, proste, skuteczne.

3. **Dwa bezpieczniki > jeden mocniejszy.** Jeden bezpiecznik na 25bps zastąpiłby oba — ale byłby za sztywny. Tightness Floor (18bps od mid) + MIN_PROFIT (20bps od entry) dają bardziej inteligentną ochronę, bo patrzą na problem z dwóch perspektyw.

---

## Chapter 55: VIRTUAL S/R Pipeline — Daj drugiemu botowi oczy (09.03.2026)

> "Wyobraz sobie kierowce, ktory jedzie noca bez swiatel. Silnik dziala, hamulce dzialaja, ale nie widzi zakretow. Dokladnie tak wygladal VIRTUAL bez S/R awareness."

### Problem: Slepy bot na wsparciu

VIRTUAL bot mial trzy mechanizmy:
- **SMA Crossover** — trendfollower (kupuj gdy SMA20 > SMA30)
- **Moon Guard** — ochrona przed pumpami
- **Order Flow Filter** — filtrowanie zlecen

Brzmi solidnie? Problem w tym, ze **zadne z tych narzedzi nie wie gdzie jest support i resistance.** Bot mogl spokojnie trzymac SHORT na daily support — najgorsze mozliwe miejsce na shorta — i nawet o tym nie wiedziec.

Dokladnie to sie stalo: VIRTUAL mial SHORT z -59.5% skew, siedzac prosto na wsparciu. kPEPE w identycznej sytuacji juz dawno by zredukowal pozycje (S/R Progressive Reduction), zaczal akumulowac longi (S/R Accumulation), albo przynajmniej wstrzymal aski (BREAKEVEN_BLOCK). VIRTUAL? Dalej szorowal.

### Rozwiazanie: Port pelnego pipeline'u z kPEPE

Zamiast budowac cos nowego, wzielismy caly S/R pipeline z kPEPE — 600+ linii kodu — i wkleili do VIRTUAL else branch. Jedna kluczowa roznica: parametry.

**kPEPE vs VIRTUAL — inne parametry, ta sama logika:**

| Parametr | kPEPE | VIRTUAL | Dlaczego |
|----------|-------|---------|----------|
| `srReductionStartAtr` | 2.0 | 2.5 | VIRTUAL mniej agresywna redukcja |
| `srMaxRetainPct` | 0.10 | 0.15 | VIRTUAL zachowuje wiecej pozycji |
| `srAccumBounceBoost` | 1.8 | 1.6 | VIRTUAL wolniejsza akumulacja |
| `pumpThresholdPct` | 3.0 | 2.5 | VIRTUAL wrazliwszy na pumpy |
| `autoSkewShiftBps` | 2.0 | 1.5 | VIRTUAL mniejsze przesuniecie grida |
| `srBounceHoldMinDistAtr` | 1.5 | 1.8 | VIRTUAL pozniej aktywuje bounce hold |

To jak dwa samochody z tym samym silnikiem, ale inne mapowanie gazu. VIRTUAL jest bardziej konserwatywny — mniejsza pozycja, wolniejsze akumulowanie, wieksza tolerancja przed redukcja. Pasuje do tokena, ktory ma mniejsza zmiennosc niz kPEPE.

### Co dokladnie zostalo portowane (i w jakiej kolejnosci)

Pipeline dziala sekwencyjnie — kazdy modul modyfikuje `sizeMultipliers.bid`/`.ask` i przekazuje dalej:

```
1. Fetch momentum (niezaleznie od kPEPE branch)
2. ATR% computation z MarketVision
3. Moon Guard (ochrona przed pumpami)
4. Order Flow Filter
5. Momentum Guard scoring
   - ATR signal, momentum signal, RSI signal
   - Proximity signal (touch vs break distinction!)
   - SMA Crossover wpleciony w MG scoring
6. Position-aware guard (czy mamy LONG przy oporze? SHORT przy wsparciu?)
7. INV_AWARE MG Override (gdy bot utknal z pozycja)
8. S/R Grace Period (delay reduction po breakout)
9. S/R Progressive Reduction (zmniejsz pozycje im blizej S/R)
10. BREAKEVEN_BLOCK (nie zamykaj ze strata blisko S/R)
11. S/R Accumulation + Fresh Touch Boost (buduj pozycje na S/R)
12. S/R Bounce Hold (nie sprzedawaj za wczesnie po odbiciu)
13. Breakout TP (zamknij na silnym momentum alignowanym z breakout)
14. Dynamic TP (rozszerz spread na micro-reversal)
15. Inventory SL (panic exit przy ekstremalnym drawdown)
16. Auto-Skew (przesun mid price w strone potrzebnych fillow)
17. generateGridOrders() z skewedMidPrice
```

### Czego NIE portowalismy

kPEPE ma kilka unikalnych modulow, ktore nie pasuja do VIRTUAL:

| Modul | Dlaczego nie | Alternatywa w VIRTUAL |
|-------|-------------|----------------------|
| **Toxicity Engine** | Wymaga danych toksycznego flow specyficznych dla kPEPE | Moon Guard wystarcza |
| **4-layer Custom Grid** | kPEPE uzywa `generateGridOrdersCustom()` z 4 warstwami | VIRTUAL uzywa standard `generateGridOrders()` |
| **TimeZone Profile** | kPEPE ma profile Asia/Europe/US | Nie potrzebne dla VIRTUAL |
| **OBI Modulator** | Order Book Imbalance — specyficzny dla kPEPE's book | Brak |
| **VWAP Modifier** | Volume-weighted adjustments | Brak |
| **Dynamic Spread ATR** | kPEPE skaluje spread z ATR | VIRTUAL uzywa stalego profilu |

To wazna lekcja: nie musisz portowac **wszystkiego**. Portuj rdzen (S/R pipeline), dostosuj parametry, pomin to co jest specyficzne dla tokena. Mniej kodu = mniej bugow.

### Kluczowa roznica architektoniczna: `skewedMidPrice`

Stary VIRTUAL uzywal raw `midPrice` w `generateGridOrders()`:
```typescript
// STARY KOD
generateGridOrders(pair, midPrice, ...)
```

Nowy VIRTUAL uzywa `skewedMidPrice` — mid price po Auto-Skew:
```typescript
// NOWY KOD
const skewShift = inventorySkewPct * autoSkewShiftBps / 10000
const skewedMidPrice = midPrice * (1 + skewShift)
generateGridOrders(pair, skewedMidPrice, ...)
```

Auto-Skew przesuwa srodek grida w strone, w ktora bot **potrzebuje fillow**. Jesli bot ma duzy LONG, skew przesuwa grid w gore (wiecej askow blizej ceny = latwiejsze zamkniecie). Jesli ma duzy SHORT, przesuwa w dol (wiecej bidow blizej ceny = latwiejsze zamkniecie).

To jak regulacja celownika w karabinie — nie zmieniasz celu, tylko dostosowujesz punkt mierzenia zeby trafic tam gdzie chcesz.

### Weryfikacja: co zobaczylem w logach po deployment

```
[SR_ACCUM] VIRTUAL: RESISTANCE -> accumulate SHORTS -- progress=42% dist=2.45%
[BOUNCE_HOLD] VIRTUAL: RELEASED -- dist=1.73ATR >= 1.5ATR threshold
```

Pipeline zyje. VIRTUAL wykryl opor, zaczal akumulowac shorty (poprawne zachowanie w tym kontekscie), i Bounce Hold wylaczyl sie po potwierdzeniu odbicia. Dokladnie to, co chcielismy.

### Lekcje

1. **Jeden slepy bot moze zniszczyc caly portfel.** VIRTUAL bez S/R to jak prowadzenie samochodu bez swiatel — mozesz jechac, ale nie widzisz zakretow. Skew -59.5% na daily support to wypadek czekajacy na okazje.

2. **Portowanie > pisanie od zera.** 600 linii kodu, ale zero nowej logiki — wszystko przetestowane na kPEPE przez tygodnie. Port zajal godzine, napisanie od zera zaloby tydzien. I mialby nowe bugi.

3. **Parametryzuj, nie dupllikuj.** `getMomentumGuardConfig(pair)` zwraca inne wartosci dla kPEPE i VIRTUAL, ale logika jest identyczna. Jeden zestaw parametrow w `short_only_config.ts`, zero if/else w pipeline.

4. **Standard grid != slabszy grid.** VIRTUAL nie potrzebuje 4-layer custom grida zeby miec S/R awareness. Standard grid z `skewedMidPrice` + S/R multipliers daje 90% korzysci za 10% zlozonosci.

---

## Chapter 56: Sniper Mode — Polowanie na Wyczerpanie (09.03.2026)

### Co to jest i dlaczego tego potrzebujemy

Wyobraz sobie pole bitwy. Z jednej strony okopala sie armia shortujacych traderow — ich pozycje tworzą "klaster likwidacyjny" o wartosci $1.67M, 7% powyżej aktualnej ceny VIRTUAL. Cena zaczyna rosnac. Shorty zaczynaja tracic. Margin calle zaczynaja dzwonic.

I wtedy dzieje sie cos fascynujacego: **kaskada likwidacji**.

Pierwszy short zostaje zlikwidowany. Giełda musi zamknac jego pozycje — kupuje na rynku (forced buy). To podnosi cene. Nastepny short zostaje zlikwidowany. Znowu forced buy. Cena rośnie dalej. Efekt domina — kazda likwidacja powoduje kolejna. Cena leci w gore jak rakieta.

Ale tu jest klucz: **te forced buys nie sa organicznym popytem**. To nie sa ludzie, ktorzy wierza ze cena powinna byc tak wysoko. To giełda wymuszajaca zamkniecie pozycji. I w pewnym momencie — ostatni short w klastrze zostaje zlikwidowany. Nie ma juz wiecej wymuszonych kupujacych.

I cena... spada z powrotem.

To jest **mean reversion po kaskadzie likwidacji**. I dokładnie to Sniper Mode eksploatuje.

### Analogia: Katapulta i gumka recepturka

Pomysl o katapulcie zrobionej z gumki recepturki. Naciagasz ja (cena idzie w kierunku klastra). Im bardziej naciagasz, tym wiecej energii jest zmagazynowane (wiecej shortow dostaje squeezed). W pewnym momencie puszczasz (ostatni short zlikwidowany) — i gumka strzela Z POWROTEM z impetem proporcjonalnym do tego jak mocno ja naciagnales.

Sniper Mode czeka cierpliwie na moment puszczenia gumki, a potem wchodzi w kierunku "snapbacku".

### 6 faz maszyny stanowej

Sniper Mode to **state machine** — automat z 6 fazami, kazda z precyzyjnymi warunkami przejscia:

```
WATCHING  -->  CASCADE_DETECTED  -->  SNIPER_ARMED  -->  ENTRY_ACTIVE
                                                              |
COOLDOWN  <--  POSITION_HELD  <-------------------------------|
    |
    +--> WATCHING (cykl od nowa)
```

#### Faza 1: WATCHING (obserwacja)

Bot monitoruje klastry likwidacyjne z Moon Dev API. Szuka trzech jednoczesnych sygnalow:

1. **Duzy klaster w zasiegu** — cluster > $200K (kPEPE) lub $300K (VIRTUAL) w odleglosci < 3% od ceny
2. **Ruch cenowy w kierunku klastra** — cena przesunela sie > 3% (kPEPE) w strone klastra w ciagu 15 minut
3. **Volume spike** — wolumen na aktualnej swiece 15m jest > 3x sredni wolumen z 8 poprzednich swiec

Wszystkie trzy naraz = "cos sie dzieje". Przechodzimy do fazy 2.

#### Faza 2: CASCADE_DETECTED (kaskada wykryta)

Bot jest teraz w trybie "alert". Sledzi `cascadePeakPrice` — najwyzsza (lub najnizsza) cena osiagnieta podczas kaskady. Timeout: 5 minut. Jesli cena nie dotrze do klastra w tym czasie → reset do WATCHING.

#### Faza 3: SNIPER_ARMED (karabin zaladowany)

Cena weszla w strefe klastra (`|distancePct| < 0.5%`). Likwidacje powinny byc w toku. Bot aktualizuje `cascadePeakPrice` — sledzi szczyt/dolina ruchu.

Teraz czeka na **exhaustion** — moment wyczerpania.

#### Faza 4: ENTRY_ACTIVE (wejscie)

Cena odwrocila sie o >= `reversalThresholdPct` (0.5% dla kPEPE) od peaku. To jest sygnał wyczerpania — nie ma juz wiecej forced buyers/sellers.

Bot wchodzi **counter-trend** przez agresywne multipliers grida:
- Short cluster squeezed (cena pompnela) → enter SHORT: `askMult=3.0, bidMult=0.0`
- Long cluster dumped (cena zrzucona) → enter LONG: `bidMult=3.0, askMult=0.0`

Wazne: bot wchodzi TYLKO gdy jest flat (`|actualSkew| < 0.10`). Nie otwiera sniper trades gdy juz ma pozycje.

#### Faza 5: POSITION_HELD (pozycja trzymana)

Fill wykryty. Teraz zarzadzanie pozycja z trzema mechanizmami wyjscia:

| Mechanizm | Warunek | Akcja |
|-----------|---------|-------|
| **Trailing stop** | Profit > 1% → sledz, retrace 0.5% | Exit z zyskiem |
| **Hard stop** | Strata > 2% (kPEPE: 3%) | Natychmiastowe zamkniecie |
| **Max hold** | 15 minut | Wymuszone zamkniecie |

`exitUrgent` bypassa HARD BREAKEVEN GUARD — sniper musi moc zamknac pozycje natychmiast, nawet na stracie.

#### Faza 6: COOLDOWN (odpoczynek)

30 minut przerwy przed nastepnym sniper trade. Zapobiega over-tradingowi i pozwala rynkowi sie ustabilizowac.

### Conflict resolution — kto ma priorytet

Sniper to potezne narzedzie, ale NIE moze nadpisywac wyzszych systemow. Implementacja sprawdza trzy warunki **przed** ticknieciem snipera:

```typescript
const sniperSkip = inventorySlPanic                    // emergency exit > sniper
  || (se.mode === FOLLOW_SM_SHORT || FOLLOW_SM_LONG)   // SM signal > sniper
  || (!permissions.allowLongs && !permissions.allowShorts) // HARD_BLOCK > sniper
```

Hierarchia priorytetow:
1. **inventorySlPanic** — bot ma ekstremalny drawdown, musi zamknac pozycje TERAZ
2. **FOLLOW_SM modes** — Smart Money daje kierunkowy sygnal, nie chcemy go nadpisywac
3. **HARD_BLOCK** — oba kierunki zablokowane przez regime/external signal

Jesli jakikolwiek z tych warunkow jest prawdziwy, sniper zwraca neutralny output (phase=WATCHING, multipliers=1.0) — jakby go nie bylo.

### Jak to dziala w kodzie — pattern override

Sniper NIE uzywa `forceEntry()` ani IOC orderow. Dziala przez **ten sam mechanizm co wszystkie inne guardy** — modyfikuje `sizeMultipliers.bid` i `sizeMultipliers.ask`. To eleganckie, bo:

1. **Brak specjalnego kodu orderowania** — grid engine robi swoja robote jak zwykle
2. **Kompatybilnosc** z innymi systemami — multiplicative, nie binary
3. **Latwe debugowanie** — widzisz efekt w logach multiplierow

Dodatkowo sniper moze **undo Gravity Guard** — jesli Gravity Guard zmniejszyl aski (bo widzi squeeze risk), a sniper chce wchodzic SHORT po squeeze, to sniper przywraca pre-gravity multipliers:

```typescript
const preGravityBid = sizeMultipliers.bid  // zapisz PRZED gravity
const preGravityAsk = sizeMultipliers.ask

// ... Gravity Guard modyfikuje multipliers ...

if (sniperOut.overrideLiqGravity) {
  sizeMultipliers.bid = preGravityBid  // przywroc
  sizeMultipliers.ask = preGravityAsk
}
sizeMultipliers.bid *= sniperOut.bidMultOverride  // zastosuj sniper
sizeMultipliers.ask *= sniperOut.askMultOverride
```

To jest pattern "save/restore" — czesto uzywany w systemach graficznych (save canvas state, transform, restore).

### Hoisted variable pattern

`sniperExitUrgent` jest zadeklarowany **ponad** if/else block (kPEPE vs VIRTUAL) — ten sam pattern co `inventorySlPanic`:

```typescript
let inventorySlPanic = false   // hoisted
let sniperExitUrgent = false   // hoisted

if (pair === 'kPEPE') {
  // ... moze ustawic sniperExitUrgent = true ...
} else {
  // ... moze ustawic sniperExitUrgent = true ...
}

// HARD BREAKEVEN GUARD — ponizej if/else, uzywa obu zmiennych
if (position && !inventorySlPanic && !sniperExitUrgent) {
  // filtruj ordery poniżej breakeven
}
```

Dlaczego "hoisted"? Bo zmienna musi byc widoczna **po** bloku if/else, w sekcji BREAKEVEN GUARD. Gdyby byla zadeklarowana wewnatrz `if (pair === 'kPEPE')`, nie bylaby dostepna po zamknieciu klamry. JavaScript/TypeScript ma block scope dla `let/const` — zmienne nie "wyciekaja" z blokow.

### Per-token config pattern

Sniper Mode uzywa tego samego patternu co Momentum Guard, Dynamic Spread, Pump Shield, itd.:

```typescript
// Interface → Defaults → Per-token overrides → Getter
export interface SniperModeConfig { ... }
export const SNIPER_DEFAULTS: SniperModeConfig = { ... }
export const SNIPER_OVERRIDES: Record<string, Partial<SniperModeConfig>> = {
  'kPEPE': { enabled: true, clusterMinValueUsd: 200_000, ... },
  'VIRTUAL': { enabled: true, clusterMinValueUsd: 300_000, ... },
}
export function getSniperModeConfig(token: string): SniperModeConfig {
  return { ...SNIPER_DEFAULTS, ...(SNIPER_OVERRIDES[token] || {}) }
}
```

`Partial<SniperModeConfig>` = mozesz podac tylko te pola ktore chcesz nadpisac, reszta bierze sie z defaults. Spread operator `...` laczy obiekty — jesli override ma pole, nadpisuje default. Jesli nie, default zostaje.

To jest **Open/Closed Principle** w praktyce — system jest otwarty na rozszerzenia (dodaj nowy token = 1 wpis w OVERRIDES), ale zamkniety na modyfikacje (nie musisz zmieniac zadnego istniejacego kodu).

### Profil ryzyka — dlaczego to jest bezpieczne

```
Max loss per sniper trade: -3% of 50% grid size = ~1.5% capitalPerPair
Max hold time:             15 minut (nie overnight!)
Max frequency:             1 na 30 min = max 2/h
Worst case hourly loss:    ~3% grid capital (~$150 z $5000 capital)
```

Porownaj z normalnym MM ktory moze trzymac pozycje godzinami i stracic 10%+ na jednym trendzie. Sniper trades sa krotkie, capped, i rzadkie.

In-memory state (PM2 restart kasuje) — ale max hold 15 min, wiec nawet jesli restart "osierocí" pozycje, istniejace guardy (BREAKEVEN, INVENTORY_SL) je ogarnia.

### Lekcje

1. **Defensywa + ofensywa = pelny obraz.** Gravity Guard (#118) broni przed klastrami. Sniper Mode (#119) zarabia na nich. Ten sam sygnał (klaster likwidacyjny), dwa rozne uzycia. To jak w szachach — ten sam pion moze bronic krola albo atakować.

2. **State machine > spaghetti if/else.** 6 faz z wyraznymi przejsciami jest latwe do zrozumienia, debugowania i rozszerzania. Gdyby to bylo 15 zagniezdżonych if/else, kazdy nowy warunek ryzykowalby zlamanie czegoś innego.

3. **Conflict resolution jest rownie wazne jak logika biznesowa.** Sniper bez conflict resolution moglby wchodzic w pozycje gdy SM mowi "HOLD SHORT" albo gdy bot jest w panice — katastrofa. Hierarchia priorytetow (panic > SM > sniper) to kregoslup bezpieczenstwa.

4. **Flat-only entry eliminuje 90% edge cases.** Jesli sniper wchodzilby gdy bot juz ma pozycje, musielibysmy radzic sobie z: pozycja w tym samym kierunku (doloz?), pozycja w przeciwnym (hedge?), interakcja z innymi guardami... Wymog `|actualSkew| < 0.10` sprawia ze te problemy nie istnieja.

---

## Rozdzial: Churning — jak bot sam sobie strzelal w kolano (#120)

### Problem: Buy High, Sell Low na autopilocie

Wyobraz sobie gracza na gieldze ktory robi dokladnie odwrotnie niz powinien — kupuje na szczytach i sprzedaje na dolkach. Brzmi absurdalnie? To dokladnie robil nasz bot z kPEPE przez 9 dni.

Analiza fills od 1 do 9 marca pokazala pattern ktory mrozy krew w zylach:

```
03-01/02: NET SELL @ $0.003435-3454   <-- dobrze! shortuje blisko szczytu
03-03/04/05: NET BUY @ $0.003439-3581 <-- zle! zamyka shorty ze strata
03-07: NET BUY @ $0.003335            <-- zle! kupuje ponizej
03-08/09: NET SELL @ $0.003199-3247   <-- zle! re-shortuje na dnie
```

Bot zbudowal shorta na gorze (dobrze!), potem go zamknal w srodku (zle!), potem ponownie zashortwal na dnie (katastrofa!). Klasyczny "churning" — bezsensowne obracanie pozycja ktore generuje tylko straty i prowizje.

### Detektywistyka: 3 root causes

Nie wystarczy powiedziec "bot churnuje" — trzeba zrozumiec DLACZEGO. Okazalo sie ze 3 niezalezne mechanizmy wspolpracowaly zeby zniszczyc PnL:

#### Root Cause #1: kPEPE za maly na radar

`getSmDirection()` to funkcja ktora mowi botowi "SM sa SHORT" lub "SM sa LONG". Jest kluczowa bo `shouldHoldForTp()` (system ochrony pozycji) uzywa jej do decyzji czy blokowac closing-side ordery.

Problem? `getSmDirection()` wymaga minimum $100,000 SM exposure zeby zwrocic jakikolwiek kierunek. kPEPE mial $34K SM exposure — duzo jak na small-cap memecoin, ale ponizej globalnego progu. Wynik: `getSmDirection()` zawsze zwracal `null`, `shouldHoldForTp()` zawsze zwracal `false`, i ZERO ochrony pozycji.

To jak system alarmowy ktory dziala tylko w domach powyzej 200m2. Twoje mieszkanie ma 80m2 — alarm nie wlaczy sie nawet gdy wlamywacz juz jest w srodku.

#### Root Cause #2: Whale override nieosiagalny

SignalEngine ma specjalny mechanizm — `checkWhaleTrackerOverride()` — ktory moze wymusic FOLLOW_SM_SHORT nawet gdy normalny scoring daje slaby wynik. Ale ten override wymaga pozycji >= $500,000. kPEPE z $34K exposure nigdy tego nie osiagnie.

Bez whale override, SignalEngine patrzyl na score (-25 do +25 = "WAIT zone") i fallbackowal do PURE_MM — market making obu stron. Bot stawial bidy I aski, co oznaczalo ze zamykal shorty i otwieral longi jednoczesnie. Mimo ze LS ratio SM wynioslo 7.54x (ekstremalnie bearish!), bot tego nie widzial.

#### Root Cause #3: Oracle flip-flop

SM direction zmienial sie: SHORT -> NEUTRAL -> LONG -> NEUTRAL -> SHORT przez kilka dni. Kazda zmiana powodowala ze bot otwieral przeciwna strone. SHORT -> LONG = bot zaczyna kupowac (zamyka shorty). LONG -> SHORT = bot zaczyna sprzedawac (re-shortuje). Kazdy flip = fill w zlym momencie = strata.

To jak GPS ktory zmienia trase co 5 minut — zamiast jechac prosto, krazysz w kolko spalajac paliwo.

### 3 fixy — kazdy celuje w inny root cause

#### Fix 1: Per-token SM exposure thresholds (SmAutoDetector.ts)

Zamiast globalnego $100K dla wszystkich, dodalismy `TOKEN_SM_EXPOSURE_OVERRIDES`:

```typescript
const TOKEN_SM_EXPOSURE_OVERRIDES: Record<string, number> = {
  'kPEPE': 10_000,   // $10K wystarczy dla small-cap memecoin
  'LIT': 20_000,     // $20K dla small-cap
}
```

Teraz kPEPE z $34K exposure > $10K threshold = valid SM direction. `shouldHoldForTp()` wreszcie dziala — gdy bot trzyma SHORT i SM mowia SHORT, bidy sa blokowane. Koniec z zamykaniem shortow na polowie drogi.

**Lekcja:** Globalne thresholdy sa wygodne ale niebezpieczne. $100K to duzo dla kPEPE ale nic dla BTC. Dobre systemy skaluja sie proporcjonalnie do kontekstu.

#### Fix 2: Per-token whale override + strong ratio bypass (SignalEngine.ts)

Dwa zmiany w `checkWhaleTrackerOverride()`:

**A) Per-token minimum position:**
```typescript
const WHALE_POSITION_OVERRIDES: Record<string, number> = {
  'kPEPE': 5_000,    // $5K minimum (was $500K global)
  'LIT': 10_000,
}
```

**B) Strong ratio bypass:** Gdy LS ratio >= 5.0 i exposure >= per-token minimum, override odpala sie nawet bez 80% conviction:

```typescript
if (ratio >= 5.0 && Math.abs(netExposure) >= minPosition) {
  // 7.54x ratio mowi sam za siebie — nie potrzebujemy 80% conviction
  return FOLLOW_SM_SHORT
}
```

kPEPE z 7.54x ratio i $34K exposure teraz dostaje FOLLOW_SM_SHORT zamiast PURE_MM. Bot przestaje stawiac bidy (zamykac shorty) i skupia sie na agresywnym shortowaniu.

**Lekcja:** Czasem jeden silny sygnal jest wart wiecej niz 10 slabych. LS ratio 7.54x to ekstremalnie mocny sygnaly kierunkowy — nie potrzeba dodatkowego potwierdzenia.

#### Fix 3: Anti-churn cooldown (mm_hl.ts)

Nowa mapa `lastDirectionChange` trackuje kiedy SM direction sie zmienil per pair. Gdy zmiana nastapi, bot czeka 30 minut zanim zareaguje:

```typescript
if (currentDir !== lastChange.direction) {
  const elapsed = Date.now() - lastChange.timestamp
  if (elapsed < 30 * 60 * 1000) {
    // Trzymaj poprzedni kierunek — nie reaguj na flip
    smDir = lastChange.direction === 'SHORT' ? 'SHORT' : 'LONG'
  }
}
```

Dlaczego to dziala? Wieksznosc flipow oracle'a to "whipsaw" — szum. SHORT -> LONG -> SHORT w ciagu godziny to nie prawdziwa zmiana trendu, to noise. 30 minut cooldownu filtruje wieksznosc tego szumu. Jesli oracle naprawde zmienil zdanie (prawdziwy trend reversal), 30 minut opoznienia to minimalna cena za unikniecie churnu.

**Lekcja:** Opoznienie reakcji moze byc LEPSZE niz natychmiastowa reakcja. W tradingu, "first mover advantage" czesto oznacza "first mover to get rekt". Lepiej spoznic sie 30 minut niz stracic pieniadze na fałszywym sygnale.

### Architektura rozwiazania — defense in depth

Te 3 fixy dzialaja w warstwach:

```
Warstwa 1: SM Exposure Threshold (SmAutoDetector)
  "Czy SM exposure jest wystarczajace zeby zaufac kierunkowi?"
  kPEPE: $34K > $10K = TAK → getSmDirection() zwraca SHORT
                                    |
                                    v
Warstwa 2: Whale Override (SignalEngine)
  "Czy ratio jest wystarczajaco silne?"
  kPEPE: 7.54x >= 5.0 = TAK → FOLLOW_SM_SHORT (nie PURE_MM)
                                    |
                                    v
Warstwa 3: Anti-Churn Cooldown (mm_hl.ts)
  "Czy kierunek naprawde sie zmienil?"
  Flip < 30 min temu = NIE → trzymaj poprzedni kierunek
```

Kazda warstwa jest niezalezna i konserwatywna:
- Warstwa 1 tylko wlacza istniejacy mechanizm ochrony
- Warstwa 2 pozwala override z nizszym conviction, ale wymaga ratio >= 5.0
- Warstwa 3 tylko opoznia reakcje, nigdy jej nie blokuje

To jest wzorzec "defense in depth" — ta sama strategia co w cyberbezpieczenstwie. Jeden firewall moze zawiezc. Trzy niezalezne warstwy razem sa znacznie trudniejsze do przebicia.

### Czego sie nauczylem

1. **Globalne thresholdy to tykajaca bomba.** Gdy dodajesz nowy token do systemu, ZAWSZE sprawdz czy globalne progi maja sens dla niego. BTC z $10B daily volume i kPEPE z $500K daily volume to dwa rozne swiaty — jeden set regul nie pasuje do obu.

2. **Churning jest gorszy niz brak tradingu.** Bot ktory nic nie robi traci $0 (minus opportunity cost). Bot ktory churnuje traci na kazdym flipie — prowizje + adverse selection + slippage. "Primum non nocere" — przede wszystkim nie szkodzic.

3. **Cooldown > natychmiastowa reakcja.** W systemach z szumem (a rynki sa PELNE szumu), szybkosc reakcji to bug, nie feature. Najlepsi traderzy (ludzcy i algorytmiczni) filtruja szum zanim zareaguja. Nasz 30-minutowy cooldown to prosty ale skuteczny filtr.

4. **Config-driven > hardcoded.** `TOKEN_SM_EXPOSURE_OVERRIDES` i `WHALE_POSITION_OVERRIDES` to slowniki — dodanie nowego tokena to 1 linia kodu. Gdybysmy hardcodowali `if (token === 'kPEPE') threshold = 10000`, kazdy nowy token wymagalby kolejnego if/else. Open/Closed Principle w praktyce.

5. **Diagnoza > fix.** 80% czasu poszlo na ZROZUMIENIE problemu (analiza fills, sledzenie kodu, identyfikacja 3 root causes). Sam fix to 62 linie kodu w 3 plikach. Jak mowi stare powiedzenie chirurgow: "Czas na sali operacyjnej jest odwrotnie proporcjonalny do czasu na diagnostyce."

---

## HLP Vault Tracking — Sledzenie Wieloryba Gieldy

### Kontekst — kim jest HLP?

Wyobraz sobie, ze grasz w pokera. Sledzisz wieloryby — Generala, Pulkownika, Majora. Ale jest jeszcze jeden gracz przy stole, ktorego dotychczas ignorowales: **sam kasyno**.

**HLP (Hyperliquid Liquidity Pool)** to oficjalny vault gieldy Hyperliquid. Ma **$121.5M equity** i **189 otwartych pozycji**. To nie jest zwykly trader — to de facto market maker calej gieldy. Kazdy kto handluje na Hyperliquid, czesto handluje PRZECIWKO HLP.

Dlaczego to wazne? Bo HLP ma cechy ktore czynia go unikalnym:

1. **Ogromny rozmiar** — $121.5M to wiecej niz jakakolwiek pojedyncza SM pozycja
2. **Passive market making** — HLP nie ma "opinion" o kierunku rynku, reaguje na flow
3. **Cascade/Squeeze risk** — gdy HLP ma duza pozycje kierunkowa i cena rusza przeciwko, HLP musi redukowac → wymusza dalszy ruch ceny → kaskada

### Odkrycie ktore zmienilo perspektywe

Gdy po raz pierwszy sfetchowalismy pozycje HLP, zobaczylem cos szokujacego:

| Token | HLP | SM SHORT | SM LONG | HLP vs SM |
|-------|-----|----------|---------|-----------|
| **kPEPE** | LONG $195K | $40K | $8K | **HLP 4x > calego SM!** |
| VIRTUAL | LONG $56K | $217K | $14K | HLP ~25% SM SHORT |

kPEPE: HLP LONG $195K to **wieksza pozycja niz wszystkie SM razem** ($48K total). Na tym tokenie HLP jest dominujacym graczem — nie Smart Money!

To calkowicie zmienia obraz. Sledzilismy 30+ wielorybow, analizowalismy ich conviction, LS ratio, PnL — a tymczasem "kasyno" mialo 4x wieksza pozycje niz oni wszyscy. To tak jakbys sledzil karty pokerzystow i nie zauwazyl, ze krupier tez gra.

### Implementacja techniczna

**Problem:** Moon Dev API endpointy (`/api/hlp_aggregated_positions`) zwracaly 404. Trzeba bylo alternatywnego zrodla.

**Rozwiazanie:** Bezposredni polling HLP vault przez natywne Hyperliquid API. HLP to po prostu adres na Hyperliquid (`0x010461C14e146ac35Fe42271BDC1134Ee31C703a`) — mozna sfetchowac jego pozycje identycznie jak pozycje kazdego wieloryba:

```typescript
// To samo API co whale_tracker.py uzywa dla SM!
const resp = await fetch('https://api.hyperliquid.xyz/info', {
  method: 'POST',
  body: JSON.stringify({
    type: 'clearinghouseState',
    user: '0x010461C14e146ac35Fe42271BDC1134Ee31C703a'
  })
});
```

Zaimplementowane w `src/signals/moon_stream_guard.ts` (~230 linii):

| Element | Co robi |
|---------|---------|
| `pollHlp()` | Co 120s fetchuje pozycje HLP, parsuje kPEPE/VIRTUAL |
| `checkHlpAlerts()` | Discord alerty gdy: side flip, nowa pozycja > threshold, value surge >50% |
| `fetchHlpState()` | HTTPS POST do HL API, 10s timeout, error handling |
| `HlpPosition` | Interface: coin, szi, entryPx, valueUsd, unrealizedPnl, side |

### Alerty — kiedy HLP moze nam pomoc lub zaszkodzic

Bot wysyla Discord alert gdy HLP pozycja na kPEPE/VIRTUAL sie zmieni w istotny sposob:

| HLP pozycja | Ryzyko | Scenariusz |
|------------|--------|------------|
| HLP LONG kPEPE $195K | **CASCADE** | Dump wymusi HLP do sprzedazy → dalszy dump → kaskada w dol |
| HLP SHORT kPEPE | **SQUEEZE** | Pump wymusi HLP do odkupienia → dalszy pump → squeeze w gore |
| HLP LONG VIRTUAL | CASCADE | Analogicznie |
| HLP SHORT VIRTUAL | SQUEEZE | Analogicznie |

Alert scenarios: first poll (bot startuje — natychmiast pokaz co HLP trzyma), side flip (HLP zmienil kierunek — cos sie dzieje), value surge >50% (HLP drastycznie zwiekszyl ekspozycje).

Cooldown 60 minut per alert type — zeby nie spamowac Discorda gdy HLP pozycja oscyluje.

### Architektura — jak to wyglada w kodzie

```
mm_hl.ts mainLoop (co 60s)
  |
  v
moonGuard.tick(midPrices)
  |
  +---> pollMoonDev()     -- liquidation clusters, order flow
  +---> pollHlp()         -- [NOWE] HLP vault positions
  |       |
  |       +---> fetchHlpState()     -- HTTPS POST do HL API
  |       +---> checkHlpAlerts()    -- Discord via sendDiscordAlert()
  |       +---> update output       -- hlpKpepe, hlpVirtual, hlpEquity
  |
  v
moonGuard.getOutput()
  |
  +---> hlpPositions[]    -- lista pozycji HLP
  +---> hlpKpepe          -- HlpPosition | null
  +---> hlpVirtual        -- HlpPosition | null
  +---> hlpEquity         -- $121.5M
```

Output trafia do `mm_hl.ts` — downstream pipeline MOZE reagowac na HLP exposure (na razie informacyjnie, w przyszlosci mozna dodac logike typu "HLP ma duzy LONG blisko liquidation → zmniejsz nasze longi").

### Lekcje

1. **Nie ignoruj "oczywistych" graczy.** HLP to publiczny adres z publicznie dostepnymi pozycjami. Kazdy moze go sprawdzic. A mimo to spedzilismy tygodnie sledzac 30+ wielorybow zanim ktos zapytal "a co z samym vaultem gieldy?". Najwazniejsza informacja czesto jest na widoku — po prostu nikt nie patrzy.

2. **Rozmiar > conviction.** SM mieli "conviction" (7.54x LS ratio na kPEPE). Ale HLP mial 4x wiecej kapitalu. W tradingu $195K > $48K, niezaleznie od tego jak madry jest trader po drugiej stronie. **Grubszy portfel wygrywa przez sile gravity** — HLP liquidation cascade moze zmyc wszystkie SM pozycje.

3. **Reuse istniejacych narzedzi.** Zamiast budowac dedykowane HLP API, uzylem dokladnie tego samego `clearinghouseState` co whale_tracker.py. Zero nowych endpointow, zero nowych dependencies. HLP to "po prostu kolejny adres" — elegancko wpasowuje sie w istniejaca architekture.

4. **Moon Dev API failure → direct HL API.** Probowalem najpierw Moon Dev (`/api/hlp_aggregated_positions`) — 404. Zamiast debugowac cudze API, poszerlem bezposrednio do zrodla. Hyperliquid API jest darmowe, stabilne, i nie wymaga klucza. **Zawsze preferuj primary source nad third-party wrapper.**

5. **Alerting z cooldownem > raw data dump.** HLP status log pojawia sie co ~30 minut (co 15 tickow). Alerty ograniczone cooldownem 60 min. Bez tego Discord bylby zasypany "HLP kPEPE LONG $195K" co 2 minuty. **Signal-to-noise ratio jest wazniejszy niz ilosc danych.**

---

## Rozdzial 41: Whale Discovery — Automatyczny Zwiad Nowych Wielorybow

### Problem: Reczny Discovery to Bottleneck

Przez miesiace budowalismy armie sledczych — whale_tracker.py z 53 adresami, vip_spy.py z 25 VIPami, whale-changes-report.ts z alertami 3x dziennie. Ale jak DODAWALISMY nowe adresy do trackera? **Recznie.** Ktos (ja) szedl na Nansen, przegladal leaderboardy, sprawdzal pozycje, i rucznie wpisywal adres do kodu.

To jest jak miec najlepsza armie wywiadowcza na swiecie, ale rekrutowac nowych agentow przez ogłoszenie w gazecie. **Bottleneck nie byl w analizie — byl w discovery.**

Wyobraz sobie: jakis nowy wieloryb otwiera $500K SHORT na kPEPE w poniedzialek. Nasz tracker go nie zna. Przez caly tydzien ten wieloryb handluje, zarabia, zmienia pozycje — a my nie mamy pojecia. Dopiero w niedziele, gdy recznie sprawdzam Nansen, zauwazam "o, jest ktos nowy z duza pozycja". Tydzien opoznienia.

### Rozwiazanie: Automatyczny Zwiad Co Niedziele

`scripts/whale_discovery.ts` — skrypt ktory co tydzien (niedziele 10:00 UTC) automatycznie:

1. **Skanuje Nansen leaderboardy** — kto zarobil/stracil najwiecej na kPEPE i VIRTUAL w ostatnich 7 dniach
2. **Filtruje znane adresy** — 57 adresow juz w trackerze = ignorowane
3. **Sprawdza pozycje na Hyperliquid** — equity, otwarte pozycje, uPnL
4. **Deduplicuje** — adresy juz flagowane w ostatnich 30 dniach = pominięte
5. **Wysyla na Discord** — embed z nowymi wielorybami do human review

Kluczowe: skrypt **nie dodaje automatycznie** adresow do trackera. Flaguje je do przegladu przez czlowieka. Automatyzacja discovery, nie decyzji.

### Architektura: Nansen CLI + Hyperliquid API

```
┌─────────────────────────────────────────────────────────┐
│  NANSEN CLI (subprocess)                                │
│  nansen research token perp-pnl-leaderboard             │
│    --symbol kPEPE --days 7 --format csv                 │
│    --symbol VIRTUAL --days 7 --format csv               │
│  nansen research perp leaderboard --format csv          │
│  → Top PnL earners per token + global top traders       │
└────────────────────┬────────────────────────────────────┘
                     │ CSV output (parsed in-process)
                     v
┌─────────────────────────────────────────────────────────┐
│  FILTER PIPELINE                                        │
│  1. Parse CSV → objects (custom parser)                 │
│  2. Dedup across leaderboards (address Set)             │
│  3. Filter: NOT in KNOWN_ADDRESSES (57 tracked)         │
│  4. Threshold: kPEPE PnL>$10K or pos>$50K              │
│                VIRTUAL PnL>$20K or pos>$100K            │
│  5. Dedup: NOT in seen file (30-day TTL)               │
└────────────────────┬────────────────────────────────────┘
                     │ candidate addresses
                     v
┌─────────────────────────────────────────────────────────┐
│  HYPERLIQUID API (free, no auth)                        │
│  POST https://api.hyperliquid.xyz/info                  │
│  { type: "clearinghouseState", user: "0x..." }          │
│  → equity, positions, uPnL per candidate                │
└────────────────────┬────────────────────────────────────┘
                     │ enriched candidates
                     v
┌─────────────────────────────────────────────────────────┐
│  OUTPUT                                                 │
│  --dry-run: console only (no Discord, no state save)    │
│  normal:    Discord embed + save to seen file           │
└─────────────────────────────────────────────────────────┘
```

### Nansen CLI: Subprocess zamiast API

Dlaczego `execSync('nansen research ...')` zamiast Nansen MCP albo API SDK?

1. **Nansen CLI jest juz zainstalowany** — `/opt/homebrew/bin/nansen`, zalogowany, dziala
2. **Prostota** — jeden subprocess call z `--format csv` zwraca gotowe dane
3. **Kredyty** — ~3 calls per run = ~4-6 kredytow/tydzien (vs sm-short-monitor: ~8000/msc)
4. **Niezaleznosc** — nie wymaga MCP servera ani dodatkowych dependencies

To jest wzorzec ktory warto zapamietac: **jesli narzedzie CLI juz istnieje i dziala, uzyj go jako subprocess zamiast budowac wrapper.** `execSync` to 3 linijki kodu. Natywny SDK to dependency hell + auth flow + error handling.

```typescript
function nansenCmd(args: string): string {
  return execSync(`nansen ${args} --format csv`, {
    timeout: 30_000,
    encoding: 'utf-8',
  });
}

// Uzycie:
const csvOutput = nansenCmd('research token perp-pnl-leaderboard --symbol kPEPE --days 7');
```

### Bug Dnia: JavaScript i Adresy Ethereum

To byl jeden z tych bugow ktore wydaja sie niemozliwe dopoki nie zobaczysz ich na wlasne oczy.

**Problem:** Skrypt crashowal z `TypeError: toLowerCase is not a function` na linijce ktora robilna `(entry.trader_address ?? '').toLowerCase()`.

**Reakcja:** Jak to? `trader_address` to string, stringi maja `toLowerCase()`. Co tu moze nie dzialac?

**Diagnoza:** Napisalem custom CSV parser (bo `csv-parse` to dodatkowa dependency). Parser konwertowal wartosci na numbery:

```typescript
const num = Number(val);
obj[key] = isNaN(num) || val === '' ? val : num;
```

Wyglada niewinnie, prawda? **Ale Ethereum adresy zaczynaja sie od `0x`.**

I teraz kluczowy moment: JavaScript traktuje `0x` prefix jako hex notation:

```javascript
Number('0x985f02b19dbc062e565c981aac5614baf2cf501f')
// = 8.698854026233e+47  (!!!)
// To jest VALID NUMBER w JavaScript!!!
```

Parser widzial adres Ethereum `0x985f02...`, pytal "czy to numer?", JavaScript odpowiadal "tak, to hex number 8.7e47", i zapisywal go jako `number` zamiast `string`. Potem `.toLowerCase()` na numerze = TypeError.

**Fix:**

```typescript
const num = Number(val);
obj[key] = isNaN(num) || val === '' || val.startsWith('0x') ? val : num;
//                                     ^^^^^^^^^^^^^^^^^^
// Adresy Ethereum ZAWSZE zostaja stringami
```

**Lekcja:** `Number()` w JavaScript parsuje wiecej formatow niz myslisz. `0x` (hex), `0o` (octal), `0b` (binary) — wszystkie sa "valid numbers". Jesli parsujesz dane z zewnetrznych zrodel (CSV, JSON, API), **nigdy nie ufaj automatycznej konwersji typow.** Explicite sprawdzaj formaty ktore chcesz zachowac jako stringi.

To jest szersza zasada w programowaniu: **implicit type coercion to zrodlo najdziwniejszych bugow.** Python, Go, Rust — wszystkie sa stricte z typami. JavaScript? "Let me help you by converting this Ethereum address to a number!" Dziekuje, nie trzeba.

### Reused Patterns: Standing on the Shoulders of Giants

Jednym z powodow dlaczego ten skrypt ma ~300 LOC logiki (a nie 1000) jest agresywny reuse istniejacych patternow:

| Pattern | Skad | Co robi |
|---------|------|---------|
| KNOWN_ADDRESSES Set | `whale-changes-report.ts` | 57 adresow juz trackowanych — skopiowane jako `Set<string>` |
| dotenv + shebang | `hourly-discord-report.ts` | `#!/usr/bin/env -S npx tsx` + `config()` |
| Discord embed | `discord_notifier.ts` | `sendDiscordEmbed()` — rich embed z polami |
| `--dry-run` flag | `whale-changes-report.ts` | Console only, no side effects |
| fmtUsd helper | `hourly-discord-report.ts` | `+$123.45` / `-$67.89` formatting |
| HL API fetch | `general_copytrade.ts` | `fetch('https://api.hyperliquid.xyz/info', {...})` |

**Zasada:** Zanim napiszesz nowa funkcje, sprawdz czy juz istnieje w codebase. Ctrl+F `fmtUsd`, `sendDiscord`, `clearinghouseState` — 90% "utility code" juz gdzies jest. Copy-paste z istniejacego, dzialajacego kodu > pisanie od zera.

To sie laczy z szersza zasada software engineeringu: **consistency > elegance.** Lepiej miec 5 skryptow ktore uzyje tego samego `fmtUsd()` pattern (nawet jesli to copy-paste) niz 5 roznych formatowac dolary. Gdy ktos czyta kod, widzi znajomy pattern i od razu rozumie co robi.

### State File: Pamiec Miedzy Runami

```
/tmp/whale_discovery_seen.json
{
  "0x1234...abcd": {
    "firstSeen": 1710000000,
    "token": "kPEPE",
    "label": "Wintermute"
  },
  "0x5678...efgh": {
    "firstSeen": 1709500000,
    "token": "VIRTUAL",
    "label": "Unknown"
  }
}
```

Kazdy adres ktory zostal juz flagowany trafia do "seen file" na 30 dni. Po 30 dniach wpis jest automatycznie usuwany (pruning na kazdym runie). Dlaczego?

- **Bez dedup:** Ten sam wieloryb pojawiałby sie na Discord co tydzien ("Hej, Wintermute nadal ma pozycje!"). Szum.
- **Z dedup, bez TTL:** Adres flagowany RAZ nigdy nie pojawi sie ponownie — nawet jesli za 3 miesiace zmieni pozycje z $50K na $5M. Missed signal.
- **Z dedup + 30d TTL:** Adres jest wyciszony na miesiac. Jesli po miesiacu nadal jest aktywny — re-discovery. Balans miedzy szumem a pokryciem.

Ten pattern (state file + TTL + pruning) jest uzywany w wielu miejscach w naszym systemie:
- `/tmp/whale_changes_snapshot.json` — snapshot do porownania zmian
- `/tmp/copy_general_state.json` — activeCopies + baseline
- `/tmp/whale_activity.json` — last_change_epoch dla dormant decay

### Wyniki Pierwszego Runu (Dry-Run)

```
$ npx tsx scripts/whale_discovery.ts --dry-run

Whale Discovery — Weekly Scan
==============================
Fetching kPEPE perp leaderboard...
  → 50 entries
Fetching VIRTUAL perp leaderboard...
  → 50 entries
Fetching global perp leaderboard...
  → 50 entries
Combined: 109 unique addresses (after dedup)
Known addresses filtered: 57
Candidates after filtering: 24

Notable finds:
  Wintermute    — $4.8M PnL, SHORT kPEPE + VIRTUAL
  Auros Global  — $2.0M PnL
  HLP Strategy B — $121.3M equity (!)

Bearish consensus: majority discovered whales SHORT kPEPE
```

24 nowe adresy znalezione w pierwszym runie! Nie wszystkie beda warte dodania do trackera (niektore to market makerzy, jednodniowe pozycje, albo dust amounts), ale **discovery pipeline dziala.**

### Deployment — Nauka z Produkcji

**Lokalnie (test):**
```bash
npx tsx scripts/whale_discovery.ts --dry-run
```

**Na serwerze — 4 przeszkody ktore musielismy pokonac:**

**1. Git divergent branches:** Serwer mial lokalny commit (`chore(security): backup sshd_config`) ktorego nie bylo na remote. `git pull --ff-only` failowal. Fix: `git stash && git rebase origin/feat/next && git stash pop`. Dodatkowo 4 untracked files blokowaly rebase (plik trackowany w nowych commitach ale istniejacy jako untracked na serwerze) — backup do `/tmp/` i usuniecie.

**2. npm global install permission denied:** `npm i -g nansen-cli` wymagal sudo (zapis do `/usr/lib/node_modules/`). Fix: **user-local npm prefix**:
```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
npm i -g nansen-cli
echo 'export PATH=$HOME/.npm-global/bin:$PATH' >> ~/.bashrc
```
Pattern wart zapamietania: **nigdy nie uzywaj `sudo npm i -g`** — to antypattern ktory moze zepsuc uprawnienia calego `/usr/lib/`. User-local prefix jest bezpieczny i nie wymaga roota.

**3. Nansen CLI nie zalogowany:** Skrypt wywolywal `nansen research ...` ale serwer nie mial skonfigurowanego API key. Fix: `nansen login --api-key dE5Hv...` (klucz z lokalnego `~/.nansen/config.json`).

**4. Hardcoded macOS path:** Skrypt mial `/opt/homebrew/bin/nansen` (Homebrew na macOS). Na serwerze Linux binarka byla w `~/.npm-global/bin/nansen`. Fix: **dynamiczny path resolution**:
```typescript
const NANSEN_CLI = (() => {
  const candidates = [
    process.env.NANSEN_CLI_PATH,
    '/opt/homebrew/bin/nansen',              // macOS (homebrew)
    `${process.env.HOME}/.npm-global/bin/nansen`,  // Linux (npm prefix)
    '/usr/local/bin/nansen',
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return 'nansen';  // fallback to PATH
})();
```

**5. Cron nie laduje `.bashrc`:** Cron entry potrzebuje inline `PATH=`:
```bash
0 10 * * 0 cd ~/hyperliquid-mm-bot-complete && PATH=$HOME/.npm-global/bin:$PATH npx tsx scripts/whale_discovery.ts >> runtime/whale_discovery.log 2>&1
```

**Lekcja metapoziomowa:** Deploy to NIGDY nie jest "po prostu skopiuj plik na serwer". Kazdy serwer ma swoj stan — inne sciezki, inne uprawnienia, inny stan git, inne zmienne srodowiskowe. **Skrypt ktory dziala lokalnie i nie dziala na serwerze** to norma, nie wyjatek. Dobry inzynier pisze kod ktory adaptuje sie do srodowiska (dynamic paths, env var fallbacks, graceful errors) zamiast zakladac konkretna konfiguracje.

Weekly, Sunday 10:00 UTC — pasuje do istniejacego cyklu raportow (hourly, daily whale, 3x whale changes).

### Lekcje

1. **Automatyzuj discovery, nie decyzje.** Skrypt NIE dodaje adresow do trackera automatycznie. Flaguje je na Discord do human review. Dlaczego? Bo kontekst jest wazny — adres moze byc market makerem, moze miec dust position, moze byc powiazany z juz trackowanym VIPem. Czlowiek podejmuje decyzje, maszyna robi grunt work. To ten sam pattern co w DevOps: CI automatyzuje testy, ale PR review robi czlowiek.

2. **`Number()` w JavaScript to pulapka.** Hex strings (`0x...`), octal (`0o...`), binary (`0b...`) — wszystkie sa "valid numbers". Przy parsowaniu zewnetrznych danych ZAWSZE dodawaj explicit checks na formaty ktore chcesz zachowac jako stringi. `val.startsWith('0x')` to 20 znakow kodu ktore oszczedzaja godzine debugowania.

3. **CLI subprocess > custom SDK** gdy narzedzie juz istnieje i jest zalogowane. `execSync('nansen ...')` = 3 linijki. Nansen SDK = import + auth + error handling + types + 50 linijek boilerplate. Dla weekly cron joba ktory robi 3 calle? Subprocess wygrywa.

4. **State file TTL chroni przed dwoma skrajnosciami.** Bez dedup = spam. Bez TTL = missed signals. 30-dniowy TTL to sweet spot — daje miesiac ciszy na adres, potem re-discovery jesli nadal aktywny. Inspiracja z DNS TTL, HTTP cache headers, i certificate validity periods — **wszystko w IT ma swoj optymalny czas zycia.**

5. **Reuse > rewrite.** 6 patternow skopiowanych z istniejacych skryptow — `fmtUsd`, Discord embeds, HL API fetch, dry-run flag, dotenv, KNOWN_ADDRESSES. Kazdy zaoszczedzil 15-30 minut kodowania i testowania. Na skali calego projektu, konsystentny reuse to roznica miedzy "skrypt gotowy w 2 godziny" a "skrypt gotowy w 2 dni".

---

## Rozdzial 55: Cztery Straze — Discord Alerts ktore Mowia Ci Co Wazne (10.03.2026)

Wyobraz sobie ze prowadzisz samochod z oczami zamknietymi. Masz wskazniki — predkosc, obroty, temperature — ale zeby je zobaczyc, musisz zjechac na pobocze, otworzyc maske i odczytac je recznie. Absurd? Dokladnie tak dzialal nasz bot przed ta zmiana.

Bot logowal kluczowe zdarzenia do PM2 logow. Zeby je zobaczyc, trzeba bylo:
```bash
ssh hl-mm 'pm2 logs mm-pure --lines 500' | grep "funding\|whale\|SM direction"
```
Nikt nie robi tego co 30 minut. W efekcie kluczowe sygnaly ginely w szumie — funding spike o 3 rano, whale wall ktory pojawil sie na 10 minut, SM flip ktory nastapil miedzy twoimi sprawdzeniami logow.

### Rozwiazanie: 4 Discord Alerty

Zamiast dodawac nowy serwis, nowy endpoint czy nowy dashboard — po prostu podlaczylismy 4 warunki do juz istniejacego `sendDiscordAlert()`. Zero nowych zaleznosci. Zero nowych plikow. 68 linii kodu w jednym pliku.

#### 1. FUNDING ALERT (📈)

```
Trigger: |fundingRate| > 0.1%
Cooldown: 60 min per pair
```

Funding rate to "oplata" ktora longs placa shortom (lub odwrotnie). Normalnie jest mikro (0.001-0.01%). Gdy przekracza 0.1%, rynek jest **ekstremalnie skrzywiony** — wielu traderow jest po jednej stronie i placa premie za utrzymanie pozycji. To czesto sygnalizuje przeladowanie pozycji i zbliajacy sie mean-reversion move.

Analogia: To jak temperature silnika. Normalna = 90°C, 0.1% funding = 120°C. Nie musisz patrzec caly czas, ale chcesz alarm gdy robi sie goraco.

#### 2. PROFIT GUARD (💰)

```
Trigger: unrealized PnL > +3% notional
Cooldown: 30 min per pair
```

Bot trzyma pozycje po Diamond Hands. Ale czasem pozycja wchodzi w gleboki profit (+5%, +10%) i nikt nie wie, bo nikt nie patrzyl na logi. Profit Guard mowi: "Hej, ta pozycja zarabia. Moze warto rozwazyc czesiowe zamkniecie?"

To NIE jest auto-close. To informacja. Decyzje podejmujesz Ty.

Implementacja jest prosta ale warto zwrocic uwage na obliczenie `pnlPct`:
```typescript
const posNotional = Math.abs(position.size) * midPrice  // biezaca wartosc pozycji
const pnlPct = (unrealizedPnlForAlert / posNotional) * 100
```
Uzywa `midPrice` (aktualna cena) a nie `entryPrice`, bo chcemy wiedziec procent **biezacej ekspozycji**, nie procent od entry.

#### 3. SM FLIP (🔄)

```
Trigger: Smart Money direction zmienia sie (np. SHORT → LONG)
Cooldown: brak (to zdarza sie raz na kilka godzin/dni)
```

Najprostsza implementacja, a zarazem najwazniejszy alert. Caly nasz system podaza za Smart Money — gdy SM flipuja z SHORT na LONG, to jest moment w ktorym **cala strategia sie odwraca**.

Drobny szczegol implementacyjny ktory warto zauwazyc:
```typescript
const prevDir = this.prevSmDirection.get(pair) ?? null
const curDir = smDir ?? null
if (prevDir !== null && curDir !== null && prevDir !== curDir) {
  sendDiscordAlert(...)
}
```
Dlaczego `?? null` i podwojny null check? Bo nie chcemy alertowac na:
- **null → SHORT** (pierwsza inicjalizacja, nie flip)
- **SHORT → null** (brak danych, nie flip)
- Tylko **SHORT → LONG** lub **LONG → SHORT** (prawdziwy flip)

To jest pattern "state machine with null initial state" — czesto uzywany w systemach real-time.

#### 4. WHALE WALL (🐳)

```
Trigger: Order book wall > $100K w 1.5% od mid price
Cooldown: 30 min per pair per side (BID/ASK osobno)
```

Najciekawsza implementacja. Bot ma juz `l2BookCache` — cache orderbooka aktualizowany co tick. Skanujemy top 10 levelow po kazdej stronie:

```typescript
for (let i = 0; i < Math.min(10, levels.length); i++) {
  const px = Number(levels[i][0])   // cena
  const sz = Number(levels[i][1])   // wielkosc
  const val = sz * px               // wartosc w USD
  const dist = Math.abs(px - midPrice) / midPrice  // odleglosc od mid
  if (val > 100_000 && dist < 0.015) {
    // ALERT!
    break  // tylko pierwszy wall per side
  }
}
```

Dwa filtry:
- **$100K minimum** — filtruje retail ordery. Sciany ponizej $100K to szum.
- **1.5% od mid** — filtruje daleki liquidity. Sciana $500K 10% od ceny nas nie obchodzi.

`break` po pierwszym wallu per side zapobiega spamowi gdy jest wiele duzych ordow blisko siebie.

Cooldown jest per `pair:side` (np. `whale_wall:kPEPE:BID` i `whale_wall:kPEPE:ASK` to osobne cooldowny). Bo sciana na bidach i sciana na askach to rozne informacje — bid wall = wsparcie (ktos broni ceny), ask wall = opor (ktos chce sprzedac duzo).

### Architektura — dlaczego tak a nie inaczej

**Podejscie 1 (odrzucone):** Nowy serwis `DiscordAlertService` z wlasnym polling loop.
- Problem: kolejna rzecz do zarzadzania w PM2, wiecej kodu, wiecej bugow
- Bot juz ma wszystkie dane w main loop — funding, PnL, SM direction, orderbook

**Podejscie 2 (wybrane):** Inline w `mm_hl.ts`, cooldowny w Map.
- Zero nowych plikow, zero nowych procesow
- Kazdy alert to ~10 linii kodu w miejscu gdzie dane sa juz dostepne
- Cooldowny w `Map<string, number>` — ten sam pattern co `srAlertCooldowns`

**Podejscie 3 (odrzucone):** Event emitter pattern (`bot.on('fundingSpike', handler)`).
- Overengineering dla 4 alertow. Gdybysmy mieli 20+ alertow, warto by bylo. Dla 4? KISS wins.

### Lekcje

1. **Cooldown key design matters.** `funding:${pair}` vs `whale_wall:${pair}:${sideName}` — rozna granularnosc dla roznych alertow. Funding rate dotyczy calego pairow. Whale wall dotyczy jednej strony orderbooka. Zly klucz = albo za duzo spamu, albo za malo alertow. Zawsze pytaj: "co jest niezaleznym zdarzeniem?"

2. **Alerts powinny informowac, nie decydowac.** Zaden z 4 alertow nie zmienia zachowania bota. Nie modyfikuja bidow, nie zamykaja pozycji. Mowia Ci co sie dzieje. Ty decydujesz. To fundamentalna roznica miedzy **monitoring** a **automation** — jedno jest bezpieczne, drugie wymaga perfekcji.

3. **`.catch(() => {})` na kazdym `sendDiscordAlert()`.** Discord webhook moze failowac (rate limit, network glitch). Bez `.catch()` unhandled promise rejection mogloby crashnac main loop bota. Ten jednolinijkowy pattern — fire-and-forget z cichym failem — jest standardem dla side-effect notifications.

4. **Nie buduj dashboardu gdy wystarczy push notification.** Discord alert dociera do Ciebie sam — na telefon, na desktop, o kazdej porze. Dashboard wymaga zeby Ty do niego przyszedl. Dla krytycznych eventow (SM flip, whale wall) push > pull. Dla analytics (wykresy PnL, historia fills) — dashboard wygrywa.

5. **`sed` na produkcji jest jak operacja na otwartym sercu.** 5 edycji `sed -i` na pliku z 12,447 liniami, na produkcyjnym serwerze, bez type-checkera (transpile-only). Zadzialalo, ale kazdy edit mogl zepsuc caly bot. Backup (`cp mm_hl.ts mm_hl.ts.bak`) to absolutne minimum. Lepsze podejscie: edit lokalnie → push → pull na serwerze. Ale gdy serwer nie ma push access do GitHub (jak w naszym przypadku — SSH key `jaroslawpostument-sys` bez dostepu), trzeba byc kreatywnym: `git format-patch` na serwerze → `git am` lokalnie → push z lokala.

---

## Rozdzial 56: Cichy Zabojca — 6268 Bledow 422 Dziennie (11.03.2026)

### Problem: API mowi "nie rozumiem", bot mowi "ok, pusty wynik"

Wyobraz sobie, ze masz informatora w mafii (Nansen API). Dzwonisz do niego codziennie 6268 razy, ale za kazdym razem podajesz zle haslo. Informator mowi "nie znam cie" (HTTP 422), a Ty notujesz: "informator nie mial zadnych informacji". Tymczasem informator ma pelno danych — po prostu nie rozumie Twojego formatu pytania.

Dokladnie to robil nasz bot. `nansen_pro.ts` wysylal zapytania ze starymi nazwami pol, a Nansen API odrzucal je z 422 Unprocessable Entity. Bot lapal blad, zwracal `[]`, i szedl dalej. **Zero crashy, zero alarmow** — po prostu cichy brak danych.

### Dlaczego to bylo ciche?

```typescript
} catch (error: any) {
  this.logError(error, `TGM Perp Positions failed for ${token}`)
  this.setCache(cacheKey, [])  // Cachuj PUSTY wynik na 15 min!
  return []
}
```

Ten pattern — `catch → cache empty → return []` — jest swietny do resilience (bot nie crashuje), ale fatalny do observability. **Cachowanie pustego wyniku na 15 minut** oznaczalo, ze nawet gdybys naprawil blad, musisz czekac na wygasniecie cache zeby zobaczyc efekt.

### 7 fixow, jeden pattern

Wszystkie bledy mialy wspolny mianownik: **Nansen zmienil API contract, ale nie bylo walidacji po naszej stronie.**

| Endpoint | Co wysylalismy | Czego API oczekiwalo |
|----------|---------------|---------------------|
| `perp-positions` | `parameters.tokenAddress` | `token_symbol` na top level |
| `dex-trades` (perps) | `filters.valueUsd` | pole nie istnieje |
| `who-bought-sold` | `filters.value_usd` | pole nie istnieje |
| `flow-intelligence` | `chain: 'hyperliquid'` | ten endpoint nie wspiera HL |
| `holders` | `filters.value_usd` | pole nie istnieje |

**Klucz do rozwiazania:** Endpoint `perp-pnl-leaderboard` (linia 448) dzialal poprawnie — mial `token_symbol` na top level. To byl Rosetta Stone — dzialajacy przyklad, z ktorego mozna bylo odczytac poprawny format payloadu.

### Technika naprawy: Python string replacement na serwerze

Zamiast recznych `sed` edycji (ryzykowne na 1951-liniowym pliku), uzylem skryptu Python ktory:

1. Wczytal caly plik do stringa
2. Uzywal `str.replace()` z dokladnymi wieloliniowymi patternami
3. Zliczal ile zmian zastosowal (walidacja)
4. Zapisal wynik

To jest bezpieczniejsze niz `sed` bo: widzisz dokladnie co zastapisz (wieloliniowy kontekst), Python nie ma problemow z escape'owaniem regexow w shell, i dostajesz raport ile zmian sie udalo.

### Lekcje

1. **HTTP 422 to nie "serwer nie dziala" — to "nie rozumiem Twojego zapytania".** 422 (Unprocessable Entity) oznacza, ze serwer odebral request, ale nie moze go przetworzyc bo payload jest niepoprawny. To roznica miedzy "telefon nie dziala" (500) a "mowisz do mnie po chinsku" (422). Zawsze loguj body requestu obok kodu bledu.

2. **Cachowanie bledow jest mieczem obosiecznym.** `setCache(key, [])` po bledzie zapobiega hammering dead endpoint (dobre!), ale tez maskuje problem na czas cache TTL (zle!). Lepsze podejscie: cache z krotszym TTL dla bledow (np. 2 min vs 15 min dla sukcesu), i osobny counter bledow per endpoint ktory triggeruje alert po N failach.

3. **Jeden dzialajacy endpoint to Twoj Rosetta Stone.** Gdy 5 endpointow zwraca 422 a 1 dziala, porownaj payloady. Dzialajacy `perp-pnl-leaderboard` z `token_symbol` na top level powiedzial nam dokladnie czego brakuje w `perp-positions`.

4. **API contract drift jest nieunikniony.** Zewnetrzne API zmieniaja sie bez ostrzezenia. Nansen nie wyslal maila "zmienilismy nazwy pol". Jedyna obrona: monitoruj bledy 4xx per endpoint i reaguj gdy rosna. Nasz bot mial 6268 bledow dziennie i nikt nie zauwazyl.

5. **`TS_NODE_TRANSPILE_ONLY=1` oznacza "type errors nie istnieja w runtime".** Bot uzywa ts-node z transpile-only — TypeScript kompiluje sie do JS bez sprawdzania typow. To dlatego pre-existing type errors (np. `holders_fallback` not assignable) nie crashowaly bota. Szybsze starty, ale zero type safety w produkcji.

---

## Rozdzial 57: Oracle allMids Cache — Jeden Telefon Zamiast Trzynastu (11.03.2026)

### Problem: Bot dzwonil 13 razy zeby zapytac o to samo

Wyobraz sobie, ze pracujesz na gieldzie. Masz jednego kumpla (Hyperliquid API) ktory zna ceny WSZYSTKICH coinow. Ale zamiast zapytac go raz "hej, jakie sa ceny?", dzwonisz do niego 13 razy pod rzad:

```
"Ile kosztuje kPEPE?"    → API odpowiada cenami WSZYSTKICH coinow
"Ile kosztuje VIRTUAL?"  → API odpowiada cenami WSZYSTKICH coinow (te same!)
"Ile kosztuje HYPE?"     → API odpowiada cenami WSZYSTKICH coinow (te same!)
... x13 razy
```

Kazdy call do `allMids` zwraca ceny **wszystkich** coinow — ale nasz Oracle pytal o kazdy coin osobno. 13 identycznych HTTP requestow, 13 identycznych odpowiedzi. Co 60 sekund. Na dwoch botach.

### Efekt kaskadowy: 429 Too Many Requests

Hyperliquid ma rate limit. Gdy Oracle zjadal 26+ requestow/minute (13 × 2 boty) samymi cenami, brakowalo "budżetu" na wazniejsze rzeczy:

```
Oracle: 13 × allMids        → 429! 🚫
mainLoop: place orders       → 429! 🚫 (nie moze zlozyc zlecen!)
mainLoop: get positions      → 429! 🚫 (nie wie jakie ma pozycje!)
mainLoop: cancel old orders  → 429! 🚫
```

To jak DDOSowanie samego siebie. Oracle, ktory mial pomagac predykcjami, faktycznie **blokowal botowi mozliwosc tradowania**.

### Rozwiazanie: Cache z 5-sekundowym TTL

Prosta idea: zapytaj raz, zapamietaj na 5 sekund.

```typescript
private async fetchAllMids(): Promise<Record<string, string>> {
  const now = Date.now()
  // Mamy swieze dane? Uzyj cache!
  if (this.allMidsCache && now - this.allMidsCacheTime < 5000) {
    return this.allMidsCache  // zero HTTP, instant
  }
  // Nie mamy? Pobierz i zapamietaj
  const response = await axios.post(HL_API_URL, { type: 'allMids' })
  this.allMidsCache = response.data
  this.allMidsCacheTime = now
  return this.allMidsCache
}
```

Teraz `fetchCurrentPrice('kPEPE')` wywoluje `fetchAllMids()` — ktora robi HTTP tylko jesli cache starszy niz 5s. Nastepne 12 callów w tym samym cyklu dostaje odpowiedz natychmiast z pamieci.

Bonus: w `checkPredictionAccuracy()` tez byl loop wywolujacy `fetchCurrentPrice()` per wygasla predykcje. Dodalismy jawny pre-fetch:

```typescript
const mids = await this.fetchAllMids()  // 1 call
for (const prediction of expired) {
  const actualPrice = mids[prediction.coin] ? parseFloat(mids[prediction.coin]) : null
  // ... zero dodatkowych HTTP callów
}
```

### Liczby

| Metryka | Przed | Po |
|---------|-------|----|
| allMids calls per Oracle cycle | 13 + N | 1 |
| allMids calls per minute (2 boty) | ~26-40+ | ~4-8 |
| Oracle cycle time | ~8-20s (13 round-trips) | ~3-10s (1 round-trip) |
| 429 errors od Oracle | czeste | zero |

### Graceful degradation

Gdy `fetchAllMids()` dostanie blad sieciowy, zwraca **stale dane z cache** zamiast `null`:

```typescript
catch (error) {
  return this.allMidsCache || {}  // lepsze stare ceny niz zadne ceny
}
```

To wazne: jesli siec chwilowo padnie, bot nadal ma ostatnie znane ceny. Nie idealne, ale 5-sekundowe opoznienie jest akceptowalne dla predykcji na horyzoncie 5m-1d.

### Lekcje

1. **Czytaj odpowiedz API zanim zdecydujesz jak go uzywac.** `allMids` zwraca slownik ALL coinow w jednym response. Gdyby oryginalny developer to zauwazyl, nigdy by nie pisal `fetchCurrentPrice()` z osobnym HTTP per coin. Czasem najlepszy fix to po prostu przeczytanie dokumentacji.

2. **Self-DDoS jest realny i cichy.** Bot nie logowal "robie 13 requestow do allMids". Nie bylo metryki. Jedynym symptomem byly losowe 429 na order placement — ktore wygladaly jak "Hyperliquid ma problemy", a nie "nasz Oracle zjada rate limit". Monitoruj swoje wlasne API usage, nie tylko bledy.

3. **Cache TTL powinien odpowiadac use case.** 5 sekund to sweet spot: Oracle cycle trwa 8-20s, wiec w jednym cyklu fetchuje 1-4 razy zamiast 13+. Gdybysmy ustawili 60s, ceny bylyby zbyt stale. Gdyby 100ms, cache nie mialby sensu. TTL = "jak czesto NAPRAWDE potrzebuje swiezych danych?".

4. **Kaskada bledow (error cascade) to najgorszy typ bugu.** Oracle 429 → order placement 429 → position query 429 → bot nie tradeuje → tracisz pieniadze. Jeden komponent zjadajacy rate limit psuje WSZYSTKIE inne komponenty. Dlatego rate limit powinien byc budzetem wspoldzielonym, nie per-component free-for-all.

5. **Publiczne API zachowuj nawet przy wewnetrznym refactorze.** `fetchCurrentPrice()` moze byc uzywane gdzie indziej w kodzie. Zamiast usuwac je i laczyc wszedzie, zamienilismy je w thin wrapper nad `fetchAllMids()`. Zewnetrzny interface bez zmian, wewnetrzna implementacja radykalnie lepsza. To klasyczny Facade pattern.

---

## Rozdzial 58: Dex-Trades 422 — Niedokonczona Robota (11.03.2026)

### Problem: Fix #124 naprawil 7 rzeczy, ale zapominal o osmej

Pamietasz rozdzial 56? Naprawilismy 7 endpointow Nansena ktore zwracaly 422. Swietna robota. Poszlismy spac z poczuciem spelnienia.

Nastepnego dnia w logach mm-virtual:
```
[Nansen Pro] /tgm/dex-trades skipped (status=422)
body={"error":"Unknown field","message":"Field 'value_usd' is not recognized"}
```

Ups. Endpoint `/tgm/dex-trades` mial **dwie sciezki**: perps i spot. Fix #124 naprawil perps branch (usuniety `valueUsd`), ale spot branch nadal wysylal `filters: { value_usd: { min: minUsd } }`. I co gorsza — ten sam blad byl w **dwoch miejscach**: primary payload (linia ~1163) i fallback payload (linia ~1414).

### Dlaczego to przegapilismy?

```typescript
if (mode === 'perps') {
  // ✅ FIX 2026-03-11: Removed valueUsd filter
  payload = { /* ... naprawiony ... */ }
} else {
  // ❌ Standard Spot TGM — nadal ma value_usd!
  payload = {
    filters: { value_usd: { min: minUsd } },  // BOOM → 422
    // ...
  }
}
```

Klasyczny blad if/else — naprawiles jedna galaz, zapominajac o drugiej. Jeszcze gorsze: fallback path (linia 1414) to osobna metoda ktora robi to samo zapytanie inaczej sformatowane. Zeby znalezc wszystkie wystapienia, trzeba bylo `grep -n "value_usd"` na calym pliku.

### Fix

Dwie linie do usuniecia:
```diff
- filters: { value_usd: { min: minUsd } },   // primary (linia ~1163)
- filters: { value_usd: { min: minUsd } },   // fallback (linia ~1414)
```

### Lekcje

1. **Gdy naprawiasz pole API, `grep` po calym pliku.** Fix #124 naprawil `valueUsd` (camelCase) w perps, ale `value_usd` (snake_case) w spot to inna zmienna. Nansen usunal OBA — ale my szukalismy tylko jednego. Zawsze: `grep -n "nazwa_pola" plik.ts` zanim uznasz ze "gotowe".

2. **if/else to pulapka na czesciowe fixy.** Gdy naprawiasz blad w jednej galezi warunku, pytanie "czy ta sama logika jest w else?" powinno byc automatyczne. Jeszcze lepiej: wyciagnij wspolna czesc do zmiennej/funkcji, wtedy naprawiasz w jednym miejscu.

3. **Fallback paths to ciemna strona kodu.** Primary path jest oczywisty, testujesz go, naprawiasz. Fallback path (`catch → retry with different format`) jest ukryty, rzadko sie odpala, i latwiej go przegapic. A gdy sie odpali — ma ten sam bug. Traktuj fallbacki jak rownoprawny kod, nie jak "plan B ktory pewnie nigdy nie ruszy".

4. **"Gotowe" to nie "commitnalem".** "Gotowe" to "sprawdzilem logi po restarcie i zero bledow 4xx". Fix #124 byl "commitniety i pushowany" ale nie byl "gotowy" — bo nikt nie zgrepowal logow na 422 po restarcie. Weryfikacja jest czescia fixa, nie opcjonalnym dodatkiem.

---

## Rozdzial 59: kPEPE "No Fill" — Kiedy Twoje Ordery Sa Niewidzialne (11.03.2026)

### Problem: 10 godzin bez jednego filla

Wyobraz sobie ze otwierasz lemonade stand, ale ustawiasz go 3 kilometry od drogi. Ludzie chodza ulica, kupuja lemoniade od staniskow BLIZEJ — a ty stoisz daleko i czekasz. Dokladnie to robil nasz bot na kPEPE.

kPEPE mial **zero fills przez 10+ godzin**. Nie dlatego ze rynek nie mial volume. Nie dlatego ze bot byl zepsuty. Bot dzialal idealnie — skladal ordery, aktualizowal ceny, logowal snapshot co minute. Problem? Nasze ordery byly na **Level 12-13** w orderbooku, z **$800K liquidity wall** przed nimi.

### Diagnoza: 10x za szeroko

Market spread na kPEPE wynosil **3.1 bps** (0.031%). To znaczy ze najlepszy bid i najlepszy ask byly odlegle o 3.1 bps od siebie. Ultra-tight.

Nasz bot? L1 grid offset = **31 bps**. Dziesiec razy szerzej niz rynek.

```
RYNEK:
  Best Bid:  $0.003500  (0 bps od mid)
  Best Ask:  $0.003501  (3.1 bps od mid)

NASZ BOT:
  Nasz Bid:  $0.003489  (31 bps od mid)  <-- Level 12 w orderbooku
  Nasz Ask:  $0.003515  (43 bps od mid)  <-- Level 13 w orderbooku
```

Przed naszymi orderami bylo $791K w bidach i $796K w askach. Zeby ktos dostal sie do NASZYCH orderow, musialby najpierw zjesc prawie milion dolarow liquidnosci. Na kPEPE z daily volume kilka milionow — to sie nie zdarzalo.

### Dlaczego tak sie stalo?

To wynik akumulacji decyzji z poprzednich tygodni. Pamietasz rozdzial 44 (Grid Widen)? Rozszerzylismy L1 z 5bps do 18bps bo stary spread powodowal adverse selection — bot tracil na kazdym round-tripie. Potem w rozdziale 87 (Timing Fix) ustawilismy `lowVolL1Bps: 22`, `highVolL1Bps: 32` — bo kPEPE to memecoin z wysokim ATR, potrzebuje szerszego spreadu.

Problem w tym ze **rynek sie zmienil**. kPEPE przeszedl z okresu wysokiej zmiennosci (ATR 3-5%) do okresu niskiej zmiennosci (ATR ~1.14%). Market spread scisnal sie do 3 bps. Nasz bot nadal kotowal jak gdyby zmiennosc byla wysoka.

To jak nosic parasol sloneczny w deszczu — kiedys mial sens, ale warunki sie zmenily.

### Dwa niezalezne systemy spreadowe

Kluczowe odkrycie: kPEPE ma **dwa oddzielne systemy** ktore kontroluja spread. To jak miec dwa termostaty w jednym pokoju — jesli nie sa zsynchronizowane, jest chaos.

**System 1: DYNAMIC_SPREAD_OVERRIDES** (w `short_only_config.ts`)
To jest **prawdziwy** system ustawiania orderow dla kPEPE. Funkcja `getKpepeGridLayers(atrPct)` interpoluje miedzy `lowVolL1Bps` i `highVolL1Bps` na podstawie aktualnego ATR, i tworzy 5 warstw gridu:

```
L1: bazowy (core)
L2: L1 x 1.67
L3: L1 x 2.50
L4: L1 x 3.61
L5: L1 x 8.33
```

**System 2: NANSEN_TOKENS tuning** (w `market_vision.ts`)
To jest `baseSpreadBps` i `minSpreadBps` uzywane w SNAPSHOT logging i alternatywnej sciezce bid/ask. Nie kontroluje bezposrednio gridu kPEPE, ale wplywa na inne czesci pipeline'u.

Oba systemy musialy byc zsynchronizowane. Przed fixem System 1 mowil "L1=31bps" a System 2 mowil "base=25bps". Oba za szerokie.

### Fix: Trzy precyzyjne zmiany

**Zmiana 1 — Scisniecie DYNAMIC_SPREAD_OVERRIDES:**

```typescript
// PRZED:
'kPEPE': {
    lowVolL1Bps: 22,    // Nawet w low vol = szerokie
    highVolL1Bps: 32,   // W high vol jeszcze szersze
    minProfitBps: 20,   // 20bps min profit
},

// PO:
'kPEPE': {
    lowVolL1Bps: 8,     // Low vol: tight (market spread ~3bps)
    highVolL1Bps: 14,   // High vol: troche szersze ale w top 5
    minProfitBps: 10,   // 10bps (pokrywa 3.5bps round-trip fee)
},
```

Efekt na grid layers przy ATR=1.14%:

| Layer | Przed | Po | Szacowana pozycja w orderbooku |
|-------|-------|----|-------------------------------|
| L1 | 31 bps | 13 bps | Top 3-5 |
| L2 | 52 bps | 22 bps | Top 8-10 |
| L3 | 78 bps | 33 bps | Top 12-15 |
| L4 | 112 bps | 47 bps | Deep |

**Zmiana 2 — Zsynchronizowanie NANSEN_TOKENS:**

```typescript
baseSpreadBps: 25 -> 10    // Aligned z tight kPEPE book
minSpreadBps: 12 -> 5      // Pozwala na quoting blisko mid
```

**Zmiana 3 — Default fallback grid:**

```typescript
// mm_hl.ts, KPEPE_GRID_LAYERS_DEFAULT
{ level: 1, offsetBps: 18 -> 8, ... }  // Konsystentne z nowym configiem
```

### Onchain Cancel Prioritization — wiatr w plecy

W tym samym czasie Hyperliquid wlaczyl **priorytetyzacje cancelowania** dla kPEPE. Co to znaczy?

Na blockchainowym DEX-ie, kazda operacja (zlozenie orderu, cancel, modyfikacja) musi byc przetworzona przez blockchain. Gdy rynek sie rusza szybko, chcesz moc SZYBKO anulowac stare ordery zeby nie zostaly zrealizowane po niekorzystnej cenie.

Hyperliquid powiedzial: "ordery GTC (Good-Till-Cancelled, nie ALO/Post-Only) na kPEPE dostana priorytet w cancelowaniu". Nasz bot juz uzywal GTC — wiec automatycznie korzystamy.

To jest wazne dla tight quotingu: z bardziej niezawodnym cancelowaniem, mozemy quotowac blizej mid price z mniejszym ryzykiem ze stary order zostanie zrealizowany po zlej cenie. To jak miec lepsze hamulce w samochodzie — mozesz jechac szybciej bo wiesz ze zatrzymasz sie w pore.

**Zero zmian w kodzie** — to ulepszenie na poziomie protokolu.

### Weryfikacja

Po restarcie bota sprawdzilismy logi:

```
[SNAPSHOT] base=10.0bps     (bylo 25.0bps) -- OK
[SPREAD] L1 bid=8.0bps      (bylo ~31bps)  -- OK
kPEPE Multi-Layer: 24 orders              -- Bot quotuje
```

Ordery teraz sa znacznie blizej mid price. Zamiast Level 12-13, powinny byc w Top 3-5.

### Lekcje

1. **Config rot jest realny.** Parametry ktore byly optymalne w lutym (L1=22bps przy ATR 3-5%) sa katastrofalne w marcu (ATR 1.14%, market spread 3bps). Rynek sie zmienia, config musi sie zmieniac razem z nim. Nie ma "ustaw i zapomnij" w market makingu.

2. **Dwa systemy kontrolujace to samo = bug waiting to happen.** kPEPE mial DYNAMIC_SPREAD_OVERRIDES (grid) i NANSEN_TOKENS tuning (SNAPSHOT path) — oba wplywaly na spread, ale byly ustawiane niezaleznie. Gdy zmieniales jeden, musiales pamietac o drugim. To klasyczny problem "single source of truth" — lepiej miec jeden config ktory oba systemy czytaja.

3. **"Bot dziala" != "bot zarabia".** Przez 10 godzin bot logowal snapshot co minute, aktualizowal ceny, robil wszystko "poprawnie". Zero bledow. Zero crashy. I zero fills. Watchdog sprawdzal czy bot zyje — ale nie sprawdzal czy bot HANDLUJE. Monitoring powinien alarmowac na "zero fills przez N godzin", nie tylko na crashe.

4. **Position in book > spread width.** Nie ma znaczenia jak madry jest twoj pricing model jesli twoje ordery sa na Level 12. Lepiej miec "glupie" ordery na Level 2 niz "smart" ordery na Level 12 — bo Level 2 dostaje fille, Level 12 nie. Market making to gra o BYCIE WIDOCZNYM, nie o bycie "poprawnym".

5. **Tight spread + reliable cancel = safe.** Normalna reakcja na "ordery za daleko" to "a co jesli bede za blisko i dostane adverse selection?". Odpowiedz: (a) BREAKEVEN_GUARD nadal chroni przed zamykaniem na stracie, (b) S/R Accumulation kontroluje kierunek, (c) minProfitBps=10 > 3bps round-trip fee, (d) onchain cancel prio zmniejsza ryzyko stale orders. Wiele warstw ochrony pozwala na tight quoting.

6. **Fee math musi sie zgadzac.** minProfitBps zmienione z 20 na 10. Dlaczego nie nizej? Bo maker fee na HL = 1.5bps na strone, round-trip = 3bps. Z safety margin: 10bps > 3bps. Gdybysmy ustawili minProfitBps=3, bot by tracowal na fees. Gdybysmy zostawili 20, za duzo orderow byloby odfiltrowanych. 10bps = sweet spot.

---

## Rozdzial 60: Breakout Bot Phase 2 — Od Stubow do Live Tradingu

*12 marca 2026*

### Kontekst — co mielismy

W Phase 1 (rozdzial wczesniejszy) zbudowalismy kompletnego bota do handlu na breakoutach — Donchian Channel, EMA200 trend filter, volume confirmation, trailing stop loss. Bot potrafil:
- Pobierac swieczki z Hyperliquid API
- Obliczac kanaly Donchiana (20-okresowy lookback na 1m candles)
- Filtrowac sygnaly przez EMA200 (trend) i volume spike (3x srednia)
- Zarzadzac pozycjami z trailing SL i take profit (3R)

Ale byl jeden problem: `BreakoutOrderEngine` byl **stubem**. Metody `placeEntry()` i `placeExit()` logowaly "NOT IMPLEMENTED YET" i zwracaly `false`. Bot wykrywal breakouty, ale nie mogl na nich zarobic — jak radar bez rakiet.

### Problem — jak skladac ordery na Hyperliquid?

Hyperliquid to zdecentralizowana gielda (DEX) — nie ma tradycyjnego REST API z endpointem `/place-order`. Zamiast tego, kazdy order to **podpisana transakcja** na blockchainie. Potrzebujesz:

1. **Private key** — do podpisywania transakcji
2. **Asset index** — Hyperliquid identyfikuje rynki po NUMERZE, nie po nazwie. BTC to `0`, ETH to `1`, SOL to `4`, itd. Musisz pobrac te indeksy z API `meta`.
3. **Size quantization** — kazdy rynek ma `szDecimals` (ile miejsc po przecinku w ilosci). BTC ma szDecimals=5 (0.00001 BTC minimum), kPEPE ma szDecimals=0 (cale jednostki). Jesli wyslesz order z nieprawidlowa precyzja — API go odrzuci.
4. **Order type** — IOC (Immediate-or-Cancel) dla market-like execution.

To duzo boilerplate'u. Na szczescie istnieje SDK `@nktkas/hyperliquid` ktory opakowuje to w ladne TypeScriptowe API.

### Rozwiazanie — pelna implementacja BreakoutOrderEngine

#### Krok 1: Inicjalizacja SDK

```typescript
import * as hl from '@nktkas/hyperliquid'
import axios from 'axios'

async init(): Promise<void> {
  if (this.config.dryRun) return  // Zero SDK calls w dry-run

  // Klient do skladania orderow
  this.exchClient = new hl.ExchangeClient({
    wallet: this.config.privateKey,
    transport: new hl.HttpTransport(),
  })

  // Ladowanie metadanych rynkow
  const resp = await axios.post(HL_API_URL, { type: 'meta' })
  const universe = resp.data?.universe || []
  universe.forEach((market: any, index: number) => {
    this.assetMap.set(market.name, index)     // BTC -> 0, ETH -> 1, ...
    this.szDecMap.set(market.name, market.szDecimals || 0)
  })
  // 229 perps loaded!
}
```

Dlaczego `axios.post` zamiast SDK do pobierania meta? Bo SDK `InfoClient` **nie ma timeout** — jesli HL API zawiesi polaczenie, Node.js event loop jest zablokowany na zawsze. Nauczylismy sie tego bolesnie z copy-general botem (rozdzial wczesniejszy). Axios z `timeout: 10000` jest bezpieczniejszy.

#### Krok 2: Ustawianie leverage

```typescript
private async ensureLeverage(token: string, leverage: number): Promise<void> {
  if (this.leverageSet.has(token)) return  // Jednorazowo per token
  const idx = this.assetMap.get(token)
  await this.exchClient.updateLeverage({
    asset: idx,
    isCross: true,
    leverage
  })
  this.leverageSet.add(token)
}
```

Leverage na Hyperliquid ustawia sie **per asset**, nie per order. I raz ustawiony, zostaje az go zmienisz. Dlatego `leverageSet` — nie chcemy wysylac tego samego requesta 100 razy.

`isCross: true` oznacza cross margin — caly portfel jako zabezpieczenie. Alternatywa to isolated margin (tylko ta pozycja jako zabezpieczenie) — bezpieczniejsze ale mniej efektywne kapitalowo.

#### Krok 3: Size quantization — najwazniejszy detal

```typescript
// Ile coinow za $500?
const sizeCoins = sizeUsd / midPrice  // np. $500 / $85000 = 0.005882 BTC

// Zaokraglij do dozwolonej precyzji
const szDec = this.szDecMap.get(token) || 0  // BTC: 5
const step = Math.pow(10, -szDec)             // 0.00001
const quantizedSize = Math.max(step, Math.round(sizeCoins / step) * step)
// 0.005882 -> 0.00588
```

To jest **krytyczne**. Bez quantization, Hyperliquid API odrzuci order z bledem "invalid size". Kazdy rynek ma inna precyzje:

| Token | szDecimals | Step | Min order |
|-------|-----------|------|-----------|
| BTC | 5 | 0.00001 | ~$0.85 |
| ETH | 4 | 0.0001 | ~$0.20 |
| SOL | 2 | 0.01 | ~$1.30 |
| HYPE | 1 | 0.1 | ~$1.50 |
| kPEPE | 0 | 1 | ~$0.003 |

#### Krok 4: IOC order — "kup teraz albo nic"

```typescript
const result = await this.exchClient.order({
  orders: [{
    a: assetIndex,          // Asset index (number, nie string!)
    b: side === 'buy',      // true = buy, false = sell
    p: priceStr,            // Limit price (string, 5 sig figs)
    s: quantizedSize.toFixed(szDec),  // Size (string)
    r: reduceOnly,          // true = tylko zamykanie pozycji
    t: { limit: { tif: 'Ioc' } }  // Immediate-or-Cancel
  }],
  grouping: 'na',
})
```

**IOC (Immediate-or-Cancel)** = "wykonaj natychmiast po tej cenie lub lepszej, a co nie wypelni — anuluj". Nie zostawia otwartych orderow w orderbooku. Idealne do breakout tradingu gdzie chcesz wejsc TERAZ, nie czekac.

Slippage: 30bps (0.3%) od mid price. Przy kupnie (LONG): `limitPrice = mid * 1.003`. Przy sprzedazy (SHORT): `limitPrice = mid * 0.997`. Daje 0.3% "luzu" zeby order sie wypelnil nawet jesli cena sie przesunie.

#### Krok 5: Dry-run guard

```typescript
async placeEntry(token, side, sizeUsd, midPrice, leverage): Promise<boolean> {
  if (this.config.dryRun) {
    console.log(`[DRY] ENTRY ${side} ${token} | $${sizeUsd} @ ${limitPrice}`)
    return true  // Symuluj sukces
  }
  // ... real order execution
}
```

Prosta ale wazna zasada: `init()` robi `if (this.config.dryRun) return` — zero polaczen z SDK w dry-run mode. `placeEntry()` i `placeExit()` loguja zamiast handlowac. Bot moze testowac strategie bez ryzyka.

### Deployment na serwer

```bash
# 1. Upload plikow
scp src/breakout/BreakoutOrderEngine.ts hl-mm:~/hyperliquid-mm-bot-complete/src/breakout/
scp src/breakout/BreakoutBot.ts hl-mm:~/hyperliquid-mm-bot-complete/src/breakout/

# 2. Start bota
ssh hl-mm 'cd ~/hyperliquid-mm-bot-complete && pm2 start ecosystem.config.cjs --only breakout-bot'

# 3. Weryfikacja
ssh hl-mm 'pm2 logs breakout-bot --lines 20'
```

Output potwierdzajacy:
```
[ORDER_ENGINE] Asset map: 229 perps loaded
[ORDER_ENGINE] Set BTC leverage to 5x cross
[ORDER_ENGINE] Set ETH leverage to 5x cross
[ORDER_ENGINE] Set SOL leverage to 5x cross
[ORDER_ENGINE] Set HYPE leverage to 5x cross
Equity: $325.80
Starting tick loop (15s interval)...
```

Bot dziala! 229 rynkow zaladowanych, leverage ustawiony na 4 tokenach, equity $325.80 gotowe do handlu.

### Moon Stream Guard fix — bonus

Przy okazji naprawilismy bug w `moon_stream_guard.ts` — imbalance-only trigger (order flow bez liquidation clusters) wymaga teraz minimum $5K liquidity confirmation. Bez tego, gdy dane o liquidacjach byly sparse (malo danych), sam stosunek bid/ask imbalance mogl triggerowac falszywe sygnaly.

```typescript
const IMB_CONFIRM_MIN_LIQ_USD = 5_000

// Przed: if (imbalanceStrong) { ... }
// Po:    if (imbalanceStrong && liquidity >= IMB_CONFIRM_MIN_LIQ_USD) { ... }
```

Prosta zmiana, ale wazna — falszywe sygnaly z Moon Guard moga zmieniac multipliers grida i powodowac nieoczekiwane zachowanie bota.

### Architektura calego Breakout Bota

```
ecosystem.config.cjs
  |-- breakout-bot (PM2)
        |-- scripts/breakout_bot.ts (entry point, --live flag)
              |-- src/breakout/config.ts (env vars -> config)
              |-- src/breakout/BreakoutBot.ts (main loop, state machine)
                    |-- BreakoutDataEngine (candles, Donchian, EMA)
                    |-- BreakoutSignalEngine (breakout detection)
                    |-- BreakoutRiskEngine (sizing, SL/TP, daily limits)
                    |-- BreakoutOrderEngine (SDK, live execution)  <-- Phase 2

Tick loop (15s):
  1. Fetch mid prices (allMids API)
  2. Fetch equity (clearinghouseState)
  3. Check existing positions for SL/TP
  4. For each token:
     a. Fetch 1m candles (Donchian) + 5m candles (EMA200)
     b. Compute indicators
     c. Update trailing SL if position exists
     d. Check for breakout signal if no position
     e. Risk check (max positions, daily loss limit)
     f. Place entry order if signal + risk OK
  5. Status summary every 20 ticks (~5 min)
```

### Dedicated wallet — izolacja ryzyka

Breakout bot ma wlasny portfel (`0x8cc8...C730`) z $325 equity, oddzielny od glownego market-making bota ($9K+). Dlaczego?

1. **Blast radius** — jesli breakout bot ma bug i traci wszystko, market-making bot jest nienaruszony
2. **Performance tracking** — latwo zmierzyc P&L breakout strategii vs MM
3. **Leverage isolation** — breakout bot uzywa 5x cross, MM bot uzywa rozne per-token
4. **Risk management** — max 3 pozycje * $325 * 1% risk = ~$10 max loss per trade

To jak miec osobne konto bankowe na "eksperymenty" vs "glowne oszczednosci". Nawet jesli eksperymenty wypajna — oszczednosci sa bezpieczne.

### Lekcje

1. **SDK bez timeout = tykajaca bomba.** `@nktkas/hyperliquid` `InfoClient` nie ma wbudowanego timeout. Uzywaj `axios.post()` z explicit `timeout: 10000` dla read operations. `ExchangeClient` (ordery) jest OK — ma retry/timeout wbudowany. To lesson learned z copy-general bota ktory zawisal sie na godziny.

2. **Asset index, nie symbol.** Hyperliquid API wymaga numerycznego indeksu assetu, nie nazwy. BTC to `0`, nie `"BTC"`. Jesli wysliesz `"BTC"` — dostaniesz nic albo blad. Zawsze laduj meta na starcie i buduj mape `name -> index`.

3. **Size quantization jest obowiazkowa.** `0.005882 BTC` to blad. `0.00588 BTC` to valid order. Roznica? `szDecimals=5` mowi ze max 5 miejsc po przecinku. Zaokraglaj do `step = 10^(-szDec)` i upewnij sie ze `size >= step` (minimum order size).

4. **Price quantization tez.** `toPrecision(5)` daje 5 significant figures. `85432.123` -> `"85432"`. `0.003456` -> `"0.003456"` (prawidlowo, bo 4 cyfry znaczace). HL odrzuci ordery z zbyt duza precyzja ceny.

5. **Dry-run guard na kazdym poziomie.** `init()` robi early return w dry-run. `placeEntry()` loguje zamiast handlowac. Dwa niezalezne guardy — nawet jesli jeden zawiedzie, drugi chroni. Zasada "defense in depth".

6. **IOC > GTC dla breakoutow.** Breakout to "wejdz TERAZ albo wcale". GTC order moze wisziec godzinami czekajac na fill — a do tego czasu breakout moze byc juz falszywy. IOC gwarantuje natychmiastowe wykonanie lub anulowanie. Slippage 30bps to cena za pewnosc wykonania.

7. **Dedykowany portfel = psychologiczny spokoj.** Gdy breakout bot handluje na $325, a MM bot na $9000+, nie panikujesz przy kazdym breakout tradzie. Mozesz pozwolic strategii dzialac bez emocjonalnych interwencji. To jak gra pokerowa z buy-inem ktory mozesz stracic — grasz lepiej bo nie boisz sie wyniku.
=======

---

## Rozdzial 61: SM Short Monitor — Naprawa i Dashboard (12.03.2026)

### Kontekst: Co sie zepsulo

`sm-short-monitor` to proces PM2 ktory monitoruje pozycje Smart Money na Hyperliquid perpach przez Nansen Perp Screener API. Chodzil sobie spokojnie, az naraz dwie rzeczy sie staly:

1. **Ktos skasoval `start_sm_monitor.sh`** — PM2 probowal uruchomic ten shell script, ale plik nie istnial. Klasyczny problem: konfiguracja PM2 wskazywala na plik, ktory ktos usunal nie myslac o konsekwencjach. PM2 probowal restartowac, dostawal "No such file or directory", i po 18 restartach dal spokoj → status: `errored`.

2. **Nansen API: 403 "Insufficient credits"** — kredyty na perp-screener endpoint sie skonczyly. Ale skrypt nie mial zadnego backoff — hamerowal API co 5 minut, dostajac 403 w kolko. To jak pukanie do zamknietych drzwi co 5 minut zamiast sprawdzic czy sklep jutro jest otwarty.

### Co naprawilismy

#### Fix 1: Ecosystem Config

Zamiast uruchamiac `start_sm_monitor.sh` (shell script wrapper), dodalismy `sm-short-monitor` bezposrednio do `ecosystem.config.cjs`:

```javascript
{
  name: "sm-short-monitor",
  script: "src/signals/sm_short_monitor.ts",
  interpreter: "npx",
  interpreter_args: "tsx",
  env: { NANSEN_API_KEY: "..." },  // z .env serwera
  max_restarts: 5,
  min_uptime: 30000,  // 30s minimum
}
```

**Lekcja:** Nigdy nie uzywaj shell script wrappera (`start_xxx.sh`) dla PM2 jezeli mozesz wskazac bezposrednio na plik zrodlowy. Shell script to dodatkowy punkt awarii — moze zostac usuniety, moze miec zle uprawnienia, moze miec zle srodowisko. `npx tsx` bezposrednio na `.ts` pliku = mniej czesci ruchomych.

#### Fix 2: Exponential Backoff

Dodalismy trzy rzeczy do `sm_short_monitor.ts`:

```
Blad 403 → consecutiveErrors++ → backoff = 5min × 2^errors (max 1h)
Sukces   → consecutiveErrors = 0, backoff = 0
Main loop → while(true) zamiast setInterval (zeby backoff dzialal)
```

**Analogia:** Wyobraz sobie ze dzwonisz do restauracji zeby zarezerwowac stolik. Zajete. Normalny czlowiek zadzwoni za 15 minut, potem za 30 minut, potem za godzine. Nasz stary skrypt dzwonil co 5 minut non-stop. Exponential backoff = zachowuj sie jak normalny czlowiek.

**Dlaczego `while(true)` zamiast `setInterval`?**

`setInterval` uruchamia callback co X ms, NIEZALEZNIE od tego co callback robi. Jezeli callback czeka 20 minut (backoff), `setInterval` i tak odpali kolejny callback po 5 minutach. Wiec masz dwa callbacki naraz, potem trzy, potem chaos.

`while(true) { await poll(); await sleep(interval); }` gwarantuje ze nastepny poll zaczyna sie DOPIERO po zakonczeniu poprzedniego + interwal. Sekwencyjne, przewidywalne, bezpieczne.

#### Fix 3: NANSEN_API_KEY w env

Skrypt czytal `process.env.NANSEN_API_KEY`, ale PM2 nie laduje `.env` automatycznie. Wczesniej dzialalo bo shell script wrapper pewnie robil `source .env`. Dodalismy key bezposrednio do ecosystem config (z komentarzem "Set in server .env" w gicie — nie commitujemy sekretow!).

**Lekcja:** PM2 env to NIE to samo co `.env` plik. PM2 `env: {}` w ecosystem config → wstrzykuje do `process.env`. Plik `.env` → czytany przez `dotenv` library (trzeba explicit import). To dwa rozne mechanizmy!

### Mac Command Center Dashboard

Stworzylismy `~/dashboard.py` — terminalowy dashboard ktory laczy sie z serwerem via SSH i wyswietla wszystko na jednym ekranie:

```
========================================================================
   HYPERLIQUID MM BOT — COMMAND CENTER
========================================================================

[ PM2 PROCESSES ]
  mm-virtual       online     15     22h 2m
  mm-pure          online     27     17h 27m
  sm-short-monitor online     0      7m       ← NAPRAWIONY!
  ...

[ SMART MONEY POSITIONS ]
  BTC   FOLLOW_SM_SHORT  $14M longs  $121M shorts  S 8.7x  80%
  ETH   FOLLOW_SM_SHORT  $7M longs   $73M shorts   S 10.7x 65%
  ...

[ NANSEN SIGNAL STATE ]
  VIRTUAL   GREEN    46d ago
  LIT       YELLOW   16d ago
```

**Architektura:** Kazda sekcja to osobna funkcja renderujaca (`render_pm2`, `render_signal_state`, `render_smart_money`, `render_telemetry`, `render_logs`). Dane pobierane via `ssh hl-mm 'command'` → JSON → parse → render. Auto-refresh co 30s.

**Zero dependencies** — tylko stdlib Python 3. Zadnego pip install, zadnego virtualenv. ANSI escape codes dla kolorow (dziala w kazdym terminalu macOS/Linux). Celowo proste — dashboard ma byc narzedziem ktore odpalisz w 1 sekunde, nie aplikacja wymagajaca setupu.

### Lekcje

1. **PM2 error logs sa kumulatywne.** Stare bledy z poprzednich restartow mieszaja sie z nowymi. Patrz na ID procesu (np. `62|sm-shor`) zeby odroznic nowe logi od starych. Nasz monitor mial ID 24 (stary, errored), potem 61 (bez API key), potem 62 (dzialajacy). Czytajac `pm2 logs` widzisz WSZYSTKO naraz.

2. **`pm2 delete + start` vs `pm2 restart`**: `restart` NIE przeladuje `ecosystem.config.cjs` env. Musisz `delete` + `start` zeby PM2 wczytal nowe zmienne srodowiskowe. To jest sprzeczne z intuicja — "restart" sugeruje "zacznij od nowa", ale w PM2 to "zabij + uruchom z TYM SAMYM env".

3. **Sekrety w git = bomba zegarowa.** Breakout bot mial private key hardcoded w ecosystem config. Dashboard mial NANSEN_API_KEY. Przed commitem ZAWSZE: `git diff | grep -i "key\|secret\|password\|token\|private"`. Usunelismy oba przed pushem — w gicie zostaly komentarze `// Set in server .env`.

4. **Exponential backoff to must-have dla kazdego pollingowego serwisu.** Bez niego: 403 co 5min = 288 zbednych requestow dziennie = mozliwy ban. Z nim: 403 → czeka coraz dluzej → max 1h → probuje ponownie. Jeden `if (status === 403)` + 3 zmienne = profesjonalny retry behavior.

5. **Dashboard to twoj command center.** Zanim miales dashboard: `ssh → pm2 status → pm2 logs → cat /tmp/file.json → curl telemetry`. Teraz: `python3 dashboard.py` → wszystko na jednym ekranie. Inwestycja 200 linii kodu oszczedza 5 minut przy KAZDYM sprawdzeniu stanu bota. Przy 10 sprawdzeniach dziennie to 50 minut oszczednosci.

