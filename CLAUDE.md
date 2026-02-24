# Kontekst projektu

## Aktualny stan
- Data: 2026-02-24
- Katalog roboczy: /Users/jerry
- Główne repozytorium: `/Users/jerry/hyperliquid-mm-bot-complete`
- Serwer: `hl-mm` (100.71.211.15 via Tailscale)
- PM2 zarządza botem: `pm2 restart mm-bot`
- GitHub: `jp81-tech/jp81-tech-jerry-hyperliquid-mm-bot-complete`

## Nad czym pracujemy

### Hyperliquid Market-Making Bot
Bot do market-makingu na Hyperliquid z integracją Nansen dla smart money tracking.

**Branch:** `fix/update-nansen-debug`
**PR:** https://github.com/jp81-tech/jp81-tech-jerry-hyperliquid-mm-bot-complete/pull/1

**Główne komponenty:**
- `src/mm_hl.ts` - główny silnik market-making (SM-following + PURE_MM)
- `src/mm/SmAutoDetector.ts` - auto-detekcja SM mode z whale_tracker.py, TOKEN_VOLATILITY_CONFIG
- `src/mm/dynamic_config.ts` - dynamiczna konfiguracja, HARD_BLOCK logika
- `src/mm/TokenRiskCalculator.ts` - dynamic leverage + Vision SL (ATR-based)
- `src/core/strategy/SignalEngine.ts` - SignalEngine v3.1 z whale override
- `src/signals/market_vision.ts` - MarketVision, NANSEN_TOKENS config, per-token tuning
- `src/signals/nansen_alert_parser_v2.ts` - parser alertów Nansen (SM OUTFLOW/INFLOW)
- `src/signals/nansen_alert_integration.ts` - integracja alertów z botem
- `src/telemetry/TelemetryServer.ts` - serwer telemetrii (port 8082)
- `src/alerts/AlertManager.ts` - zarządzanie alertami
- `src/mm/kpepe_toxicity.ts` - KpepeToxicityEngine (detekcja toksycznego flow + hedge triggers)
- `src/execution/TwapExecutor.ts` - TWAP executor (zamykanie pozycji w slice'ach jak Generał)
- `src/utils/paginated_fills.ts` - paginated fill fetcher (obchodzi 2000-fill API limit)
- `scripts/vip_spy.py` - monitoring VIP SM traderów (Operacja "Cień Generała")

**Kluczowe pliki danych:**
- `/tmp/smart_money_data.json` - dane z whale_tracker.py (na serwerze)
- `/tmp/nansen_bias.json` - bias cache (na serwerze)
- `/tmp/nansen_mm_signal_state.json` - stan sygnałów MM (GREEN/YELLOW/RED)
- `/tmp/nansen_raw_alert_queue.json` - kolejka alertów z Telegram
- `/tmp/vip_spy_state.json` - stan VIP Spy (pozycje Generałów)
- `rotator.config.json` - config rotacji par

---

## Zmiany 24 lutego 2026

### 36. TWAP Executor — zamykanie pozycji w slice'ach (24.02)

**Nowy plik:** `src/execution/TwapExecutor.ts`

**Cel:** Zamykanie pozycji w małych limit orderach (jak Generał) zamiast jednego IOC z 5% slippage. Niższy slippage, maker fees (1.5bps vs 4.5bps), mniejszy market impact.

**Architektura:**
- Standalone klasa z własnym `setInterval` timer loop (mainLoop 60s tick za wolny)
- 3-level eskalacja: ALO (maker) → GTC@mid → IOC (taker)
- Max slippage guard (50bps) → automatyczny IOC jeśli cena ucieknie
- Per-token defaults (BTC 10 slices/60s, LIT 5 slices/60s, etc.)
- Env var override: `${PAIR}_TWAP_SLICES`, `${PAIR}_TWAP_DURATION`

**Zmiany w `src/mm_hl.ts`:**
- Import `TwapExecutor`, `TwapConfig`
- Property `twapExecutor: TwapExecutor | null` na LiveTrading
- Init w `initialize()` gdy `TWAP_ENABLED=true`
- Nowa metoda `closePositionTwap()` — wrapper z fallback na IOC
- `applyRotationPairs()` używa `closePositionTwap()` zamiast `closePositionForPair()`
- `mainLoop` tick: `twapExecutor.tick()` do logowania postępu

**Nie zmienione:**
- Grid ordery — bez zmian
- HOLD_FOR_TP — nadal blokuje bidy/aski
- kPEPE hedge — nadal IOC (za pilne na TWAP)

**Env:**
```
TWAP_ENABLED=true              # domyślnie false (opt-in)
LIT_TWAP_SLICES=10             # override per-token
LIT_TWAP_DURATION=120          # override per-token
```

**Kompilacja:** `tsc --noEmit` — czysto (jedyny error pre-existing w mm_alert_bot.ts)

---

## Zmiany 23 lutego 2026

### 35. Whale Changes Report — 3x daily na Discord (23.02)

**Nowy plik:** `scripts/whale-changes-report.ts`

**Cel:** Zbiorczy raport zmian pozycji wielorybów co ~6h na Discord (06:00, 12:00, 18:00 UTC). Uzupełnia daily report (snapshot) o **delta view** — co się zmieniło od ostatniego runu.

**Architektura:**
```
1. Czytaj PREVIOUS snapshot z /tmp/whale_changes_snapshot.json
2. Fetchuj CURRENT pozycje (batch 5, 200ms delay)
3. Porównaj: NEW / CLOSED / FLIPPED / INCREASED / REDUCED
4. Formatuj raport → Discord webhook (chunked per 1950 chars)
5. Zapisz CURRENT jako nowy snapshot
```

**Progi:**
- Min position value: $10K (niższy niż daily $100K — więcej widocznych zmian)
- Min change %: 10% (INCREASED/REDUCED)

**Pierwszy run:** Zapisuje baseline, brak raportu (zapobiega "41 NEW POSITIONS" spam)

**Change detection (ported z whale_tracker.py `detect_changes()`):**

| Typ | Kiedy |
|-----|-------|
| NEW | Pozycja >$10K w current, brak w previous |
| CLOSED | Pozycja >$10K w previous, brak/mała w current |
| FLIPPED | Ten sam coin, inna strona (LONG↔SHORT) |
| INCREASED | Wartość wzrosła >10% |
| REDUCED | Wartość spadła >10% |

**Reuse z daily-whale-report.ts:** WHALES dict (41 adresów), batch fetch, `Promise.allSettled()`, Discord chunking, `fmtUsd()`/`fmtUsdNoSign()`, `--dry-run` flag

**Cron:** `0 6,12,18 * * * cd ~/hyperliquid-mm-bot-complete && npx tsx scripts/whale-changes-report.ts >> runtime/whale_changes_report.log 2>&1`

**Deploy:** SCP → server, test `--dry-run`, crontab added. Snapshot file: `/tmp/whale_changes_snapshot.json`

**Uwaga:** Używa `npx tsx` (nie `ts-node --transpile-only`) — ts-node failuje z ESM na serwerze (`ERR_UNKNOWN_FILE_EXTENSION`)

### 33. Unify Trader Names Across Codebase (23.02)

**Problem:** Ten sam trader miał różne nazwy w różnych plikach. Np. `0xa31211...` = "SM Conviction a31211" (whale_tracker), "General a31211" (daily-whale-report), "SM Conviction a31211" (SmAutoDetector). Alerty i raporty były niespójne — trudno było skojarzyć, że to ten sam trader.

**Canonical source:** `scripts/vip_config.json` (25 named VIPs z memorable aliasami)

**Zmodyfikowane pliki (3):**

| Plik | Ile zmian | Przykłady |
|------|-----------|-----------|
| `whale_tracker.py` | 19 name fields | "SM Conviction a31211" → "Generał", "SM Trader 35d115" → "Major" |
| `scripts/daily-whale-report.ts` | 16 name fields | "General a31211" → "Generał", "SM 71dfc0" → "Kapitan BTC" |
| `src/mm/SmAutoDetector.ts` | 5 label fields | "SM Conviction a31211" → "Generał", "SM Conviction 06cecf" → "Kraken A" |

**Pełna mapa zmian nazw (19 traderów):**

| Addr prefix | Stara nazwa | Nowa nazwa (z vip_config) |
|-------------|-------------|---------------------------|
| `a31211` | SM Conviction a31211 | **Generał** |
| `45d26f` | SM Conviction 45d26f | **Wice-Generał** |
| `5d2f44` | SM Conviction 5d2f44 | **Pułkownik** |
| `35d115` | SM Trader 35d115 | **Major** |
| `71dfc0` | SM Conviction 71dfc0 | **Kapitan BTC** |
| `06cecf` | SM Trader 06cecf | **Kraken A** |
| `99b109` | SM Active 99b109 | **Kapitan 99b1** |
| `feec88` | SM Active feec88 | **Kapitan feec** |
| `fce053` | SM Active fce053 | **Kapitan fce0** |
| `ea6670` | SM HL Trader ea6670 | **Porucznik ea66** |
| `6bea81` | SM Trader 6bea81 | **Porucznik SOL2** |
| `936cf4` | SM Trader 936cf4 | **Porucznik SOL3** |
| `56cd86` | Token Millionaire 56cd86 | **Kraken B** |
| `d7a678` | Consistent Winner d7a678 | **Winner d7a678** |
| `9eec98` | SM Active 9eec98 | **ETH Whale** |
| `519c72` | SM Conviction 519c72 | **ZEC Conviction** |
| `92e977` | SM HL Trader 92e977 | **BTC/LIT Trader** |
| `0c4926` | SM DOGE Trader Legacy | **DOGE Legacy** |
| `e71cbf` | SM LIT Long 141K Legacy | **LIT Long Legacy** |

**Reverted (not in vip_config):**
- `3c363e` — kept as "SM HL Trader 3c363e" / "SM 3c363e" (no vip_config entry)
- `8a0cd1` — kept as "SM HL Trader 8a0cd1" / "SM 8a0cd1" (no vip_config entry)

**NIE zmienione:**
- `NANSEN_SM_LABELS` dict w whale_tracker.py — to Nansen category labels używane do credibility multiplier lookup, NIE nazwy traderów. Zmiana by złamała `CREDIBILITY_MULTIPLIERS`.
- Fundy (Galaxy Digital, Laurent Zeimes, etc.) — już miały prawidłowe nazwy
- Traderzy bez wpisu w vip_config (SM Active xxx) — brak aliasu, zachowane jak były

**Address swap fix (23.02):** Original plan had 3 wrong address→name mappings. Fixed: `92e977`→"BTC/LIT Trader" (was "ETH Whale"), `9eec98`→"ETH Whale" (was missed), `519c72`→"ZEC Conviction" (was missed), `3c363e` and `8a0cd1` reverted (not in vip_config).

**Deploy:** SCP 3 pliki → server, `pm2 restart mm-bot`, whale_tracker.py w cron */15, daily-whale-report w cron 0 8

**Commit:** `43ed7c4` (initial), fix pending commit

### 34. Tracker Deep Audit — dead accounts, upgrades, kontrariani (23.02)

**Cel:** Pełny audyt ~53 portfeli w whale_tracker.py i daily-whale-report.ts — usunięcie martwych kont, identyfikacja kontrarianów, upgrade najlepszych traderów.

**Usunięte (14 dead/underwater kont):**

| Kto | Powód |
|-----|-------|
| 11 dead accounts ($0) | baae15, 2ed5c4, 689f15, 039405, Hikari, be494a, 95e268, 106943, fuckingbot.eth, c12f6e, 8a0cd1 |
| ETH Whale (9eec98) | ALL LONG, ALL underwater, -$223K |
| SM e28236 | ALL LONG, -$4.46M uPnL |
| SM 0b2396 | ALL LONG, -$656K uPnL, brak czucia rynku |

**Downgraded do WATCH (weight → 0.10):**

| Trader | Powód |
|--------|-------|
| Bitcoin OG (b317d2) | Zlikwidowany -$128M, konto puste |
| Bitcoin OG #2 (2ea18c) | Konto puste, WATCH for return |
| Winner d7a678 | Wypłacił, konto puste |
| **Kontrarian 091159** | ALL LONG (BTC $8.7M 20x, ETH $8.5M 20x) vs SM SHORT consensus. Kupił BTC+ETH 23.02, zamknął BTC po kilku godzinach. Weight 0.85→0.10 |
| **Kontrarian 570b09** | Flipnął SHORT→LONG SOL $2.79M (20x) vs consensus. Closed PnL +$3.13M. Weight 0.60→0.10 |

**Upgraded:**

| Trader | Zmiana | Powód |
|--------|--------|-------|
| **Kraken A ⭐** | w: 0.85→0.90 | $4.66M equity, +$13.15M total profit. SOL $7M (+$8.25M!), BTC $2.9M (+$1.9M), HYPE $2.8M (+$1.56M) |
| **Kraken B ⭐** | notes updated | $6.57M equity, +$3.54M total. Ultra-konserwatywny 0.2x lev, aktywny od cze 2025 (9 mcy) |
| **OG Shorter c7290b** | renamed | +$5.76M total, shortuje od lis 2025. BTC entry $97K, ETH $3,070 |
| **donkstrategy.eth** | w: 0.55→0.65 | +$1.2M total, 49 aktywnych dni, shorter od gru 2025 |
| **Manifold Trading** | MM→ACTIVE, w: 0.00→0.30 | Hybryda MM+trader. 12 SHORT, +$1.33M uPnL. MM-style fills ale directional conviction |

**⭐ Top traderzy (wiedzą więcej):**
1. Generał + Pułkownik + Major + Wice-Generał — prawdopodobnie jedna grupa, koordynowane pozycje
2. Galaxy Digital — instytucja z dostępem do flow data
3. Kapitan feec/fce0/99b1 — trójka BTC shorterów, ogromne pozycje
4. **Kraken A ⭐** — +$13.15M, SOL entry $172 (+$8.25M unrealized)
5. **Kraken B ⭐** — +$3.54M, 9 miesięcy aktywności, ultra-konserwatywny
6. **OG Shorter c7290b** — +$5.76M, złapał szczyty BTC i ETH
7. **donkstrategy.eth** — +$1.2M, konsekwentny shorter

**Stan po audycie:** ~39 aktywnych portfeli + 5 WATCH

**Commits:** `82c3b3b`, `50a3cc9`, `068195c`, `ec34d83`, `c5568d0`, `94cfe08`, `71904a8`, `11f0350`

### 30. War Room Dashboard — 8 tokens + w1/m1 horizons (23.02)

**Plik:** `dashboard.mjs` (PM2 `war-room`, port 3000)

**Przed:** 3 tokeny (LIT, FARTCOIN, HYPE), 3 horyzonty (h1, h4, h12), grid 3-kolumnowy
**Po:** 8 tokenów (BTC, ETH, SOL, HYPE, ZEC, XRP, LIT, FARTCOIN), 5 horyzontów (h1, h4, h12, w1, m1), grid 4x2

**Zmiany:**

| Co | Przed | Po |
|----|-------|----|
| COINS array | `["LIT", "FARTCOIN", "HYPE"]` | `["BTC", "ETH", "SOL", "HYPE", "ZEC", "XRP", "LIT", "FARTCOIN"]` |
| CSS grid | `repeat(3, 1fr)` | `repeat(4, 1fr)` + `repeat(2, 1fr)` rows |
| Panel borders | `.panel:last-child` | `.panel:nth-child(4n)` / `.panel:nth-child(n+5)` |
| Chart min-height | 200px | 100px |
| Factors-box max-height | 40px | 25px |
| Font sizes (pred/signals/factors) | 9px | 8px |
| Prediction rows | h1, h4, h12 | h1, h4, h12, **w1**, **m1** |
| Chart horizon lines | 3 (green/yellow/red) | 5 (+purple=w1, +cyan=m1) |
| Fallback predictions | h1, h4, h12 | h1, h4, h12, w1 (168h), m1 (720h) |

**Deploy:** scp → server, `pm2 restart war-room`, verified via curl (8 coins + w1/m1 confirmed)

### 31. Fix: ai-executor v1 systemd conflict — Telegram 409 (23.02)

**Problem:** Nansen Telegram alerty nie dochodziły do bota od 24 stycznia (miesiąc!). `ai-executor` (PM2, v2) logował tylko startup messages, zero alertów przetworzonych.

**Root cause — 3 problemy:**

| # | Problem | Symptom |
|---|---------|---------|
| 1 | **Stary ai-executor v1** (`/home/jerry/ai-risk-agent/ai-executor.mjs`) zarządzany przez **systemd** (`ai-executor.service`, `Restart=always`) używał tego samego bot tokena `@HyperliquidMM_bot` | Telegram API → `409 Conflict: terminated by other getUpdates request` |
| 2 | **mm-bot PM2 recreate** bez `TS_NODE_TRANSPILE_ONLY=1` | ts-node kompilował z type-checking → `error TS18048` w `mm_alert_bot.ts` → crash loop |
| 3 | **processNansenAlertQueue()** nigdy nie wywoływane | Kombinacja #1 + #2 |

**Diagnostyka:**
```
# 409 Conflict = dwa procesy pollują ten sam bot token
curl "https://api.telegram.org/bot${TOKEN}/getUpdates" → 409

# Znaleziono 2 procesy:
PID 1474088: /home/jerry/ai-risk-agent/ai-executor.mjs (systemd, od Feb 4)
PID 3320092: src/signals/ai-executor-v2.mjs (PM2, od Feb 22)

# Systemd service z Restart=always:
/etc/systemd/system/ai-executor.service → WorkingDirectory=/home/jerry/ai-risk-agent
```

**Fix #1 — Disable stary ai-executor v1:**
- Nie można `sudo systemctl stop` (brak hasła sudo)
- Zastąpiono skrypt stubem: `mv ai-executor.mjs ai-executor.mjs.DISABLED` + nowy `ai-executor.mjs` = `console.log("DISABLED"); process.exit(0);`
- Systemd respawnuje ale stub od razu wychodzi → zero kolizji

**Fix #2 — mm-bot z TS_NODE_TRANSPILE_ONLY:**
- `pm2 delete mm-bot` + `pm2 start` z `TS_NODE_TRANSPILE_ONLY=1 TS_NODE_IGNORE=false`
- Bez tego env var → ts-node kompiluje z type-checking → crash na `TS18048`

**Fix #3 — Weryfikacja pipeline:**
- Wstrzyknięto testowy alert do `/tmp/nansen_raw_alert_queue.json` (processed=false)
- mm-bot przetworzył → `processed: true`
- `processNansenAlertQueue()` potwierdzone w logach

**Nansen SM flow check (MCP API):**
- LIT/FARTCOIN/VIRTUAL: Smart Trader flow = **zero** od 7+ dni na spot
- Brak alertów bo brak SM aktywności na spot (cała akcja SM na perpach HL → whale_tracker)
- Pipeline naprawiony i gotowy — gdy Nansen wyśle alert, dotrze do bota

### 32. Nansen Spot Alerts — diagnoza braku alertów (23.02)

**Sprawdzone przez Nansen MCP API:**

| Token | Chain | SM Trader 1h | SM Trader 1d | SM Trader 7d | Inne segmenty |
|-------|-------|-------------|-------------|-------------|---------------|
| LIT | Ethereum | No data | No flow | No flow | Fresh wallets +$70K |
| FARTCOIN | Solana | No data | No flow | No flow | Whale outflow -$785K/7d (4.6x avg) |
| VIRTUAL | Base | No data | No flow | No flow | Zero aktywności |

**Wniosek:** Alerty Nansen Dashboard **są aktywne** ale Smart Money nie handluje tymi tokenami na spot. Progi alertów (LIT >$3K/1h, FARTCOIN >$25K/1h) nie są przekraczane. Cała akcja SM odbywa się na **perpach Hyperliquid** — to whale_tracker.py obsługuje (działa prawidłowo, update co 15 min).

---

## Zmiany 22 lutego 2026

### 29. Expand prediction-api to 8 tokens + weekly/monthly horizons (22.02)

**Cel:** Rozszerzenie prediction-api z 3 tokenow/3 horyzontow do 8 tokenow/5 horyzontow.

**Przed:** HYPE, LIT, FARTCOIN na h1, h4, h12
**Po:** BTC, ETH, SOL, HYPE, ZEC, XRP, LIT, FARTCOIN na h1, h4, h12, w1, m1

**Zmodyfikowane pliki (6):**

| Plik | Zmiana |
|------|--------|
| `src/prediction/models/HybridPredictor.ts` | `PredictionResult.predictions` → `Record<string, ...>`, `PREDICTION_HORIZONS` config, `calculatePredictions()` loop z slope dampening (`Math.log2`), `verifyPredictions()` dynamic, `VERIFY_CONFIG` (w1: 15%, m1: 25% error threshold) |
| `src/prediction/models/XGBoostPredictor.ts` | `HORIZONS` → `['h1','h4','h12','w1','m1']`, `tokens` → 8 tokenow, `getBestPrediction` preference `['h4','h1','h12','w1','m1']` |
| `src/prediction/index.ts` | CLI tokens → 8, dynamic predictions display, `verifyPredictions()` dynamic return, `getXGBFeatureImportance()` 5 horyzontow, export `PREDICTION_HORIZONS` |
| `src/prediction/dashboard-api.ts` | `/predict-all` tokens → 8 |
| `scripts/xgboost_collect.py` | `TOKENS` → 8, `LABEL_BACKFILL_ROWS=0` (scan all for m1 30-day lookback), `label_w1`/`label_m1` fields, backfill 604800s/2592000s |
| `scripts/xgboost_train.py` | `TOKENS` → 8, `THRESHOLDS` w1=0.08/m1=0.15, `MIN_SAMPLES` per-horizon dict (h1-h12=200, w1=100, m1=50), all loops 5 horizons |

**PREDICTION_HORIZONS config:**
```typescript
{ key: 'h1',  hours: 1,   multiplier: 0.3, confMax: 80 }
{ key: 'h4',  hours: 4,   multiplier: 0.8, confMax: 70 }
{ key: 'h12', hours: 12,  multiplier: 1.5, confMax: 60 }
{ key: 'w1',  hours: 168, multiplier: 3.0, confMax: 45 }
{ key: 'm1',  hours: 720, multiplier: 5.0, confMax: 30 }
```

**Slope dampening dla dlugich horyzontow:**
```typescript
const effectiveSlope = hz.hours <= 24
  ? slope * hz.hours
  : slope * 24 * Math.log2(hz.hours / 24 + 1);
```

**Data timeline (XGBoost):**
- w1 labels available after 7 days, model trainable ~10 days
- m1 labels available after 30 days, model trainable ~35 days
- HybridPredictor rule-based formula covers w1/m1 from day 1

**Deploy:** scp 4 dist files + 2 Python scripts → server, `if (true)` fix reapplied, PM2 restart prediction-api

**Weryfikacja:** All 8 tokens returning 5 horizons (h1, h4, h12, w1, m1) confirmed via `/predict-all`

**Commit:** `427407f` — pushed to `origin/fix/update-nansen-debug`

### 21. Fix: AI Trend Reversal parser — multiplier-based direction (22.02)

**Problem:** Parser `parseMmBotAiTrendReversal` traktował każdy alert "AI Trend Reversal" jako `MOMENTUM_LONG` (bullish). Ignorował mnożnik z tekstu alertu (np. "0.10× the recent average"). FARTCOIN dostawał fałszywe sygnały kupna przez miesiąc mimo że 0.10× = aktywność spadła o 90% = BEARISH.

**Fix w `src/signals/nansen_alert_parser_v2.ts`:**
```typescript
// Wyciąga mnożnik z tekstu: "(0.10× the recent average)"
const multMatch = message.match(/\((\d+\.?\d*)\s*[×x]\s*(?:the\s+)?recent\s+average\)/i);
const multiplier = multMatch ? parseFloat(multMatch[1]) : null;

if (multiplier < 0.5)  → MOMENTUM_SHORT (bearish)
if (multiplier 0.5-2.0) → return null (noise, ignore)
if (multiplier > 2.0)  → MOMENTUM_LONG (bullish)
```

**Commit:** `382203d` — deployed to server, mm-bot restarted

### 22. Remove Selini Capital from all trackers (22.02)

**Problem:** Selini Capital (5 kont MM1-MM5) generowało spam alertów o flipach pozycji (Short→Long, Long→Short). Mimo `signal_weight: 0.0` (nie wpływa na sygnały), tracker i tak raportował zmiany pozycji. Market maker — flipuje ciągle, zero wartości informacyjnej.

**Usunięto z 4 plików:**

| Plik | Co usunięto |
|------|-------------|
| `whale_tracker.py` | 5 kont (MM1-MM5) z sekcji MARKET_MAKER |
| `src/mm/SmAutoDetector.ts` | 3 konta z rejestru traderów |
| `scripts/hype_monitor.ts` | 1 wpis z listy INSTITUTIONS |
| `src/signals/nansen_alert_parser_v2.ts` | "Selini" z regex `extractLabel()` |

**Commit:** `b76ad66` — deployed to server, mm-bot restarted

### 23. Fix: ai-executor Nansen Alert Relay — brakujący .env (22.02)

**Problem:** `ai-executor` (PM2 id 5, `src/signals/ai-executor-v2.mjs`) logował `Main loop error: fetch failed` non-stop od ~24 stycznia. Plik `.env.ai-executor` zniknął z katalogu bota — proces nie miał tokena Telegram i nie mógł pollować. **Nansen alerty nie trafiały do kolejki `/tmp/nansen_raw_alert_queue.json` od miesiąca.**

**Odkrycie — 3 procesy AI na serwerze (nie jeden!):**

| # | Proces | Skrypt | PM2? | Rola |
|---|--------|--------|------|------|
| 1 | `ai-executor` (id 5) | `src/signals/ai-executor-v2.mjs` | TAK | **KRYTYCZNY** — Nansen alert relay do `/tmp/nansen_raw_alert_queue.json` |
| 2 | `ai-chat-gemini.mjs` (PID 1474087) | `/home/jerry/ai-risk-agent/ai-chat-gemini.mjs` | NIE | Prosty Gemini chatbot (proxy do Gemini 2.0 Flash) |
| 3 | `ai-executor.mjs` v4.0 (PID 1474088) | `/home/jerry/ai-risk-agent/ai-executor.mjs` | NIE | "GOD MODE" — /panic, /close, /positions, AI analiza logów |

**3 tokeny Telegram:**

| Token | Bot | Użycie |
|-------|-----|--------|
| `8273887131:...` (`@HyperliquidMM_bot`) | ai-executor (PM2) | Nansen relay — **naprawiony** |
| `8145609459:...` | ai-chat-gemini.mjs | Prosty chatbot |
| `8220591117:...` | ai-executor.mjs GOD MODE | Interaktywny asystent tradingowy |

**Kanał "serwerbotgemini"** na Telegramie to alerty z procesów #2 i #3 (katalog `/home/jerry/ai-risk-agent/`). Strukturyzowane alerty "AI Risk Agent (Gemini) / Severity: warn / Suggested actions" to odpowiedzi Gemini 2.0 Flash gdy GOD MODE wysyła logi bota do AI i prosi o analizę.

**Fix:** Stworzony `/home/jerry/hyperliquid-mm-bot-complete/.env.ai-executor`:
```
GEMINI_API_KEY=AIza...
TELEGRAM_BOT_TOKEN=8273887131:AAFdp3YFv0WHHrjjWEzcbPHzrKOdD6cR_zM
TELEGRAM_CHAT_ID=645284026
NANSEN_ALERT_CHAT_ID=-1003724824266
TG_OFFSET_FILE=/tmp/ai_executor_tg_offset.txt
```

**Weryfikacja:** Restart PM2 → zero `fetch failed` po flush logów → `getMe` potwierdza token → PM2 save

### 24. Pełna mapa procesów na serwerze (22.02, updated)

| PM2 id | Nazwa | Skrypt | Status | Rola |
|--------|-------|--------|--------|------|
| 5 | `ai-executor` | `src/signals/ai-executor-v2.mjs` | online | Nansen alert relay |
| 41 | `mm-bot` | główny bot | online | Market making engine (recreated 23.02, was id=36) |
| 4 | `nansen-bridge` | nansen data provider | online | Port 8080, Golden Duo API |
| 25 | `vip-spy` | `scripts/vip_spy.py` | online | VIP SM monitoring (30s poll) |
| 24 | `sm-short-monitor` | `src/signals/sm_short_monitor.ts` | online | Nansen perp screener API (62% success, 403 credits) |
| 31 | `war-room` | `dashboard.mjs` | online | Web dashboard port 3000 (8 tokens, 5 horizons, 23.02) |
| 39 | `prediction-api` | `dist/prediction/dashboard-api.js` | online | ML prediction API port 8090 (8 tokens, 5 horizons, 22.02) |

**Usunięte z PM2:**
- `sui-price-alert` — nierealistyczne targety (SUI $1.85 przy cenie $0.93), usunięty
- `hourly-report` — przeniesiony do cron `15 * * * *`
- `whale-report` — przeniesiony do cron `0 8 * * *`

**Cron jobs (na serwerze):**
- `15 * * * *` — `scripts/hourly-discord-report.ts` → Discord hourly report
- `0 8 * * *` — `scripts/daily-whale-report.ts` → Discord daily whale report
- `0 6,12,18 * * *` — `scripts/whale-changes-report.ts` → Discord whale changes report (3x daily)

**Poza PM2 (katalog `/home/jerry/ai-risk-agent/`):**
- PID 1474087: `ai-chat-gemini.mjs` — prosty Gemini chatbot (token `8145609459`)
- `ai-executor.mjs` v4.0 GOD MODE — **WYŁĄCZONY** (23.02, zastąpiony stubem `process.exit(0)`, backup: `ai-executor.mjs.DISABLED`). Był zarządzany przez systemd `/etc/systemd/system/ai-executor.service` z `Restart=always` — stub powoduje że restartuje się i natychmiast wychodzi. Konfliktował z PM2 ai-executor (ten sam token Telegram → 409)

### 26. Fix: prediction-api NansenFeatures data mismatch (22.02)

**Problem:** `prediction-api` miał `smartMoney: 0` dla wszystkich tokenów mimo że `smart_money_data.json` zawierał bogate dane SM (np. FARTCOIN 44:1 SHORT ratio). **40% wagi modelu ML było martwe** od zawsze.

**Root cause — 2 mismatche w `src/prediction/features/NansenFeatures.ts`:**

| Metoda | Kod szukał | Plik miał |
|--------|-----------|-----------|
| `getSmartMoneyPositions` | `parsed.tokens[token]` | `parsed.data[token]` |
| `getSmartMoneyPositions` | `total_long_usd` / `total_short_usd` | `current_longs_usd` / `current_shorts_usd` |
| `getNansenBias` | `tokenBias.bias` / `tokenBias.confidence` | `tokenBias.boost` + `tokenBias.direction` / `tokenBias.tradingModeConfidence` |

**Fix w `NansenFeatures.ts`:**
1. `getSmartMoneyPositions`: `parsed.tokens` → `parsed.data`, field names aligned, use `trading_mode_confidence` from whale_tracker
2. `getNansenBias`: derive bias from `direction` + `boost` (short=-boost, long=+boost), confidence from `tradingModeConfidence`
3. Re-applied `if (true)` fix w `dashboard-api.js` (zgubiony przy PM2 delete/recreate)

**Wynik — porównanie przed/po:**

| Token | SM (przed) | SM (po) | Confidence (przed) | Confidence (po) |
|-------|-----------|---------|--------------------|-----------------|
| HYPE | 0.000 | 0.000 *(NEUTRAL — prawidłowo, longs~shorts)* | 28% | 28% |
| LIT | 0.000 | **-0.198** *(bearish, ratio -0.28, conviction 58%)* | 24% | **31.5%** |
| FARTCOIN | 0.000 | **-0.487** *(bearish, 44:1 SHORT, conviction 95%)* | 16% | **36.1%** |

**Deploy:** scp → server, restart PM2, pm2 save

### 27. Fix: ai-executor Nansen channel ID (22.02)

**Problem:** `ai-executor` pollował zły kanał Telegram (`-1003724824266`) zamiast prawidłowego kanału Nansen alerts (`-1003886465029` = "BOT i jego Sygnaly").

**Fix:** `.env.ai-executor` → `NANSEN_ALERT_CHAT_ID=-1003886465029`

**Weryfikacja:**
- `getChat(-1003886465029)` → SUCCESS: supergroup "BOT i jego Sygnaly"
- `getChatMember` → bot jest **administratorem** kanału
- Aktywne pollowanie potwierdzone (409 Conflict = polling works)
- Brak nowych alertów od Jan 24 → Nansen po prostu nie wysłał nowych (kanał aktywny, bot gotowy)

### 28. Fix: Conviction override + stale bias + Oracle monitoring (22.02)

**3 problems fixed:**

**#3 — Trust whale_tracker when SignalEngine says WAIT:**
- **Problem:** whale_tracker.py gives 57% FOLLOW_SM_SHORT for LIT based on PnL analysis, but SignalEngine calculates flow-based score ~11 (WAIT zone) and forces PURE_MM 11%, throwing away whale_tracker's conviction.
- **Root cause:** SignalEngine only sees ratio (1.34 < moderateRatio 2.0), doesn't see PnL data (shorts winning +$1.4M, longs underwater -$64K).
- **Fix in `src/mm/SmAutoDetector.ts` L702-707:** When Engine returns WAIT but whale_tracker confidence >= 50% with directional mode, keep whale_tracker's mode and confidence instead of forcing PURE_MM.
- **Result:** ZEC now correctly uses whale_tracker (70% CONTRARIAN_SHORT) instead of PURE_MM. LIT still PURE_MM because fresh data shows confidence dropped to 43% (generals reduced positions).

**#5 — nansen_bias.json stale (20 days):**
- **Problem:** whale_tracker.py writes both smart_money_data.json and nansen_bias.json, but was NOT in crontab. A different process (whale_tracker_live) wrote smart_money_data.json but not nansen_bias.json.
- **Fix:** Added `*/15 * * * *` crontab entry for whale_tracker.py, verified manual run updates both files.
- **Result:** nansen_bias.json updated from Feb 2 to current timestamp.

**#6 — Oracle predictions disconnected (logging only):**
- **Problem:** `getOracleGridBias()` exists but was never called. Oracle predictions were logging-only.
- **Fix in `src/mm_hl.ts`:** Added Oracle signal logging in per-pair grid generation, flags divergences between Oracle and SM direction.
- **No trading action** — logging only, per War Doctrine (SM signals > everything).

**Commit:** `9f24971`

### 25. Server Health Audit — 5 procesów naprawionych (22.02)

**Problem:** Pełny audit 10 procesów PM2 ujawnił 5 problemów:

| Proces | Problem | Fix |
|--------|---------|-----|
| `sui-price-alert` | Nierealistyczne targety (SUI $1.85 = +98%, LIT $2.50 = +67%) | **Usunięty z PM2** |
| `prediction-api` | Martwy od 27 dni, port 8090 nie nasłuchuje, zero logów | Fix `isMainModule` → `if (true)` |
| `hourly-report` | One-shot skrypt jako PM2 daemon (stopped) | Przeniesiony do cron `15 * * * *` |
| `whale-report` | One-shot skrypt jako PM2 daemon (nigdy nie uruchomiony) | Przeniesiony do cron `0 8 * * *` |
| `sm-short-monitor` | Nansen API 403 Insufficient credits (62% success rate) | Nie naprawialny bez zakupu kredytów, działa częściowo |

**prediction-api root cause:** Check `isMainModule` (`import.meta.url === \`file://${process.argv[1]}\``) failował pod PM2 — PM2 resolvuje ścieżki inaczej. Port 8090 nigdy nie był bindowany. Fix na serwerze: `if (isMainModule)` → `if (true)`.

**hourly-report i whale-report root cause:** One-shot skrypty (run-and-exit) błędnie skonfigurowane jako PM2 daemons. PM2 próbuje restartować je po exit, ale z `--no-autorestart` nie restartuje (albo restartuje i natychmiast się kończą → status "stopped"). Prawidłowe podejście: cron jobs.

**Testy po fixach:**
- `prediction-api`: port 8090 nasłuchuje, `/health` zwraca `{"status":"ok"}`
- `hourly-report`: cron test → "Sent to Discord" (raport na Discord)
- `whale-report`: cron test → "Sent 7 message(s) to Discord"
- `pm2 save` — zapisano stan 7 procesów

---

## Zmiany 21 lutego 2026

### 20. Paginated Fills Utility + Winner d7a678 Analysis (21.02)

**Problem:** Hyperliquid API `userFillsByTime` zwraca max 2000 fills per request. 14 miejsc w codebase nie obsługiwało paginacji — gubiły dane przy aktywnym tradingu.

**Odkrycie:** Analiza wieloryba d7a678 ("Winner") ujawniła problem — API zwróciło 2000 fills (paź-gru 2025) a ukryło nowsze (sty 2026). Myśleliśmy +$1.15M, w rzeczywistości +$4.09M.

**Nowy plik:** `src/utils/paginated_fills.ts`
- `fetchAllFillsByTime(user, startTime, endTime?, opts?)` — paginacja forward, deduplikacja po tid
- Max 10 stron (20K fills), sort ascending po time

**Zmodyfikowane pliki (6):**

| Plik | Zmiana |
|------|--------|
| `src/utils/paginated_fills.ts` | NOWY — utility z paginacją |
| `src/mm_hl.ts` (L894) | `syncPnLFromHyperliquid` → `fetchAllFillsByTime` |
| `src/mm_hl.ts` (L3352) | `getRecentFills` → `fetchAllFillsByTime` |
| `scripts/hourly-discord-report.ts` | `info.userFillsByTime` → `fetchAllFillsByTime` |
| `scripts/reset_daily_pnl_anchor.ts` | `infoClient.userFills` → `fetchAllFillsByTime` |
| `scripts/perfill_hist.ts` + `perfill_bypair.ts` | `info.userFills` → `fetchAllFillsByTime` |

**Commit:** `de1844d` — deployed to server, mm-bot restarted

**Winner d7a678 — pełna analiza:**
- Adres: `0xd7a678fcf72c1b602850ef2f3e2d668ec41fa0ed`
- Nansen: "Smart HL Perps Trader", "Consistent Perps Winner"
- Timeline: 6 paź 2025 → 31 sty 2026 (konto zamknięte, $0)
- PnL: SOL +$3.2M, BTC +$487K, ETH +$397K = **+$4.09M** (HL) + $969K Deribit + $900 Venus = **~$5.5M total**
- 2220 fills w 2 stronach (potwierdzenie paginacji!)
- 6 powiązanych adresów z Nansen — ZERO fills na HL
- Wszystkie 6 "similar traders" z Nansen już trackowane w VIP spy
- Status: w `vip_config.json` jako tier1, "watching for return"

**VIP Intelligence Snapshot (21.02.2026, 25 portfeli — updated):**

| Metryka | Wartość |
|---------|---------|
| Equity | $187.1M |
| Notional | $528.1M |
| uPnL | +$114.3M |
| SHORT dominacja | **5.2x** ($443M SHORT vs $86M LONG) |
| Aktywne | 23/25 (2 puste: Winner, OG#2) |

| Coin | SHORT | LONG | Sygnał |
|------|-------|------|--------|
| BTC | $153M | $0 | **100% SHORT** (najsilniejszy) |
| ETH | $103M | $7M | **15x SHORT** (Fasanara $50M!) |
| SOL | $40M | $2M | 21x SHORT |
| HYPE | $64M | $40M | **Contested** |
| FARTCOIN | $7.6M | $0.1M | 61x SHORT |
| LIT | $4.8M | $0 | 100% SHORT |

Top 5: Laurent Zeimes $36.8M (LONG!), Fasanara $27.6M, Wice-Generał $17.1M, Kapitan BTC $16.2M, Major $13.5M.
Tylko 3/23 LONG: Laurent Zeimes (HYPE/ZEC/PAXG), ZEC Conviction, Porucznik ea66 (flip).

---

### 19. Fix: Shadow Trade Feed HTTP 404 spam (21.02)
**Problem:** Logi bota spamowane co 30 sekund: `🔮 [SHADOW] Trade feed error: HTTP 404`

**Przyczyna:**
- `SHADOW_TRADING_ENABLED=true` w `.env` ale **nie istnieje żaden serwer shadow trades** na maszynie
- Domyślny URL `http://127.0.0.1:8081/api/latest_trades` trafiał w **telemetry server** (który wylądował na porcie 8081 bo 8080 zajęty przez nansen-bridge)
- Telemetry server nie ma endpointu `/api/latest_trades` → HTTP 404 co 30 sekund (poll interval)

**Diagnostyka portów:**
| Port | Proces | Endpoint |
|------|--------|----------|
| 8080 | nansen-bridge | - |
| 8081 | mm-bot (telemetry fallback) | `/telemetry/*` |
| 8082 | nic (telemetry chciał tu, ale wylądował na 8081) | - |

**Fix 1 — `.env` na serwerze:**
```
SHADOW_TRADING_ENABLED=false  # było: true
```

**Fix 2 — `src/mm_hl.ts` (rate-limit error logging):**
```typescript
// Nowe pole:
private shadowFeedErrorCount = 0

// W pollShadowTrades():
if (!response.ok) {
  this.shadowFeedErrorCount++
  // Log first error, then only every 10th to avoid spam
  if (this.shadowFeedErrorCount === 1 || this.shadowFeedErrorCount % 10 === 0) {
    this.notifier.warn(`🔮 [SHADOW] Trade feed error: HTTP ${response.status} (count: ${this.shadowFeedErrorCount}, set SHADOW_TRADING_ENABLED=false to disable)`)
  }
  return
}
this.shadowFeedErrorCount = 0  // Reset on success
```

**Efekt:** Zero logów `[SHADOW]` po restarcie. Gdyby ktoś w przyszłości włączył shadow trading z błędnym URL, logi będą rate-limited (1. + co 10. błąd zamiast każdego).

**Commit:** `83420a4` — `fix: rate-limit shadow trade feed error logs + disable on server`

---

## Zmiany 5 lutego 2026

### 18. kPEPE Toxicity Engine + Advanced Inventory Management (05.02)
**Cel:** Detekcja toksycznego flow na kPEPE (pattern-based, bo Hyperliquid fills nie zawierają adresów counterparty) + automatyczne dostosowanie grida.

**Nowy plik:** `src/mm/kpepe_toxicity.ts`

**8 sygnałów detekcji:**

| # | Sygnał | Warunek | Reakcja |
|---|--------|---------|---------|
| 1 | Consecutive toxic fills | 3/5/7/10 z rzędu | Widen +20% / removeL1 / removeL1,2 / PAUSE 2min |
| 2 | Rapid fill burst | 3+ fills w 10s | Widen +30%, remove L1 |
| 3 | Sweep detection | 20+ bps range w 30s | Widen +50% |
| 4 | Coordinated attack | VPIN HIGH + adverse + rapid | PAUSE 2min |
| 5 | Volatility sizing | momentum >3%/5% | Size ×0.60 / ×0.40 |
| 6 | OI-based spread | OI zmiana >±10% | Widen +15% / +10% |
| 7 | Funding asymmetry | funding >0.01% | Reduce paying side ×0.80 |
| 8 | Hedge trigger | skew >50% przez 30min | IOC 20% pozycji, cooldown 15min |

**Zmiany w 4 plikach:**

| Plik | Zmiana |
|------|--------|
| `src/mm/kpepe_toxicity.ts` | NOWY — KpepeToxicityEngine + getKpepeTimeZoneProfile (10-zone) |
| `src/mm_hl.ts` | Import + instantiate engine, feed fills, tick() w grid pipeline, hedge IOC, per-layer refresh, VPIN bucket fix ($500) |
| `src/config/short_only_config.ts` | KPEPE funding filter override (crowded 0.03%, caution ×0.70) |
| `src/api/hyperliquid_data_fetcher.ts` | kPEPE dodane do CANDLE_COINS (momentum data) |

**Enhanced 10-zone Time-of-Day (zastąpiła starą 4-zone `getKpepeTimeMultiplier`):**
- Asia low (02-04 UTC): spread ×0.85, size ×1.10 (tight, niska toksyczność)
- US open (14-16 UTC): spread ×1.20, size ×0.85 (najwyższa toksyczność)

**Per-layer refresh rates:**
- L1: co tick (60s) — closest to mid
- L2-L3: co 2 ticki (120s)
- L4: co 5 ticków (300s) — oszczędza API rate limit

**VPIN tuning:** kPEPE bucket $500 (default $50K za duży dla memecoin volume, buckety nigdy się nie zapełniały → VPIN stuck na 0.5)

**Kluczowa lekcja:** Hyperliquid fills nie zawierają adresów counterparty (tylko oid, coin, side, px, sz, time, fee, closedPnl). Detekcja toksyczności musi opierać się na wzorcach fill, nie na śledzeniu adresów.

---

## Zmiany 4 lutego 2026

### 17. LIT+FARTCOIN Focus — $500/day Target (04.02)
**Cel:** Pivot z POPCAT (~$0.35/day) na LIT+FARTCOIN jako SM-following focus pairs z celem $500/day.

**Problem:** Po analizie POPCAT okazało się że UTIL CAP bottleneck ($22/order), tick-size constraints (17bps minimum), i mała alokacja (~$3,248 per pair) dawały realistyczny P&L ~$0.35/dziennie. Zmiana strategii na agresywne SM-following na LIT i FARTCOIN.

**Zmiany w 3 plikach + server .env:**

| Plik | Zmiana |
|------|--------|
| `src/mm_hl.ts` | INSTITUTIONAL_SIZE_CONFIG: LIT/FARTCOIN target=$200 (10x poprzednio) |
| `src/mm_hl.ts` | UTIL CAP leverage: per-token `${pair}_LEVERAGE` zamiast hardcoded `2` |
| `src/mm_hl.ts` | Rebucketing: per-token INSTITUTIONAL_SIZE_CONFIG zamiast globalny CLIP_USD=$22 |
| `src/mm_hl.ts` | Capital floor: STICKY_PAIRS min cap×0.80 (zapobiega squeeze throttling) |
| `src/signals/market_vision.ts` | Tuning: LIT 15bps/$2K/level/$10K max, FARTCOIN 20bps/$2K/level/$10K max |
| `src/signals/market_vision.ts` | activePairs: LIT, FARTCOIN, ETH, BTC, HYPE, SOL |
| `src/mm/dynamic_config.ts` | LIT HARD_BLOCK usunięty (blokował aski gdy auto-detect cache pusty) |
| `src/mm/dynamic_config.ts` | LIT EMERGENCY_OVERRIDES: maxInventoryUsd 2000→10000 |

**5 bottlenecków naprawionych (pełny sizing chain):**

1. **INSTITUTIONAL_SIZE_CONFIG** — target $25→$200, max $150→$500
2. **normalizeChildNotionals** — używał CLIP_USD=$22 jako rebucket target zamiast per-token config
3. **UTIL CAP leverage** — hardcoded `const leverage = 2` zamiast per-token `${pair}_LEVERAGE=5`
4. **capitalMultiplier double-apply** — DynamicConfig squeeze (cap×0.38) nakładany dwukrotnie. Fix: capital floor 0.80 dla STICKY_PAIRS
5. **LIT HARD_BLOCK + EMERGENCY_OVERRIDES** — stale overrides blokowały aski i limitowały do $2K

**Rebucketing fix (kluczowy):**
```typescript
const pairSizeCfg = INSTITUTIONAL_SIZE_CONFIG[pair]
const rebucketTarget = pairSizeCfg ? Math.max(GLOBAL_CLIP, pairSizeCfg.targetUsd) : GLOBAL_CLIP
const rebucketMin = pairSizeCfg ? Math.max(MIN_NOTIONAL, pairSizeCfg.minUsd) : MIN_NOTIONAL
```

**Capital floor fix:**
```typescript
const stickyPairs = (process.env.STICKY_PAIRS || '').split(',').map(s => s.trim()).filter(Boolean)
if (stickyPairs.includes(pair) && capitalMultiplier < 0.80) {
  capitalMultiplier = 0.80  // Prevent squeeze from over-throttling focus pairs
}
```

**LIT HARD_BLOCK usunięty:**
```typescript
// STARE (usunięte): Blokował aski gdy isFollowSmShort=false (stale z tygodnie temu)
// NOWE: Tylko log gdy FOLLOW_SM_SHORT aktywny
if (token === 'LIT' && isFollowSmShort) {
  console.log(`🦅 [SIGNAL_ENGINE] LIT: FOLLOW_SM_SHORT → aggressive shorting enabled (focus pair)`)
}
```

**Env vars na serwerze:**
```
FORCE_MM_PAIRS=BTC,ETH              # usunięto SOL, POPCAT
STICKY_PAIRS=LIT,FARTCOIN           # focus pairs (zawsze aktywne)
MAX_ACTIVE_PAIRS=4                  # zmniejszone z 6
LIT_LEVERAGE=5                      # 5x leverage
FARTCOIN_LEVERAGE=5                 # 5x leverage
MANUAL_ACTIVE_PAIRS=LIT,FARTCOIN    # manual mode fallback
```

**Wynik końcowy:**
```
LIT:      8 sell levels, $1,600 total, Ask×2.00, 5x leverage, ~$200/order ✅
FARTCOIN: 8 sell levels, $1,600 total, 5x leverage, ~$200/order ✅
```

---

### 16. POPCAT PURE_MM - Symetryczny Market Maker (04.02)
**Cel:** Dodanie POPCAT jako PURE_MM pary (pasywny market-making, obie strony)

**Kontekst:** Próba dodania stock perpów (TSM, HOOD) nie powiodła się — Nansen AI halucynował symbole `xyz:TSM` i `cash:HOOD` które nie istnieją na Hyperliquid API. Po weryfikacji wszystkich 228 perpów przez API wybrano POPCAT ($3.1M/d volume, 3x max leverage).

**Zmiany w 4 plikach:**

| Plik | Zmiana |
|------|--------|
| `src/mm/SmAutoDetector.ts` | `TOKEN_VOLATILITY_CONFIG['POPCAT']`: SL=1.5%, maxLev=3, ATR×2.5 |
| `src/mm_hl.ts` | `INSTITUTIONAL_SIZE_CONFIG.POPCAT`: min=$15, target=$50, max=$150 |
| `src/mm_hl.ts` | Per-token leverage override: `${pair}_LEVERAGE` env var |
| `src/signals/market_vision.ts` | `NANSEN_TOKENS['POPCAT']`: chain='hyperliquid', 42bps spread, $11K max pos |
| `src/signals/market_vision.ts` | `activePairs` += 'POPCAT' |

**Per-token leverage override (nowy pattern):**
```typescript
const perTokenLev = Number(process.env[`${pair}_LEVERAGE`] || 0)
const targetLeverage = perTokenLev > 0 ? perTokenLev : (riskParams?.recommendedLeverage ?? fallbackLeverage)
```
Dodano w dwóch miejscach: mainLoop leverage setup + rotateIfNeeded.

**Env vars na serwerze:**
```
FORCE_MM_PAIRS=BTC,SOL,ETH,POPCAT
STICKY_PAIRS=POPCAT
MAX_ACTIVE_PAIRS=6
POPCAT_LEVERAGE=3
```

**Problemy napotkane:**
1. **ROTATION_MODE=sm ignorował POPCAT** — SM rotacja wybiera top 3 pary po imbalance, POPCAT nie ma SM danych. Fix: `STICKY_PAIRS=POPCAT` (sticky pairs zawsze aktywne).
2. **Leverage defaultował do 1x** — `getTokenRiskParams('POPCAT')` zwracał undefined (brak cache SM). Fix: `POPCAT_LEVERAGE=3` env + per-token override w kodzie.
3. **Kill switch blokował** — chain='hyperliquid' automatycznie omija flow-based kill switch.

**Parametry POPCAT tuning:**
- Base spread: 42bps (0.42%)
- Min/Max spread: 25-90bps
- SM adjustments: OFF (smFlowSpreadMult=1.0, smSignalSkew=0.0)
- Order size: $1,000/level, 5 levels per side
- Max position: $11,000 (92% equity)
- Inventory skew: 1.5x (aggressive rebalancing)
- Leverage: 3x, SL: 1.5%

**Log potwierdzenia:**
```
🧲 Sticky pairs: POPCAT
📊 Allowed pairs (rotation + sticky): POPCAT, BTC, SOL, ETH (count=4/6)
✅ Set POPCAT leverage to 3x
🎯 [DYNAMIC LEV] POPCAT: 3x (conviction+vol) | Vision SL: 0%
[FORCE_MM] POPCAT: PURE_MM forced → both sides enabled
📊 [ML-GRID] pair=POPCAT mid≈0.0573 buyLevels=8 sellLevels=8
```

---

## Zmiany 22-25 stycznia 2026

### 1. SmAutoDetector - Fix ładowania danych whale (22.01)
**Problem:** `loadAndAnalyzeAllTokens()` nigdy nie było wywoływane w mainLoop
**Fix:**
- Dodano import `loadAndAnalyzeAllTokens` w mm_hl.ts
- Dodano wywołanie `await loadAndAnalyzeAllTokens()` w mainLoop

### 2. HARD_BLOCK bypass dla FOLLOW_SM_SHORT (22.01)
**Problem:** HARD_BLOCK_LIT blokował shorty nawet gdy SignalEngine mówił FOLLOW_SM_SHORT
**Fix w `dynamic_config.ts`:**
```typescript
const isFollowSmShort = signalEnginePureMm?.mode === MmMode.FOLLOW_SM_SHORT
if (token === 'LIT' && !isSignalEnginePureMmMode && !isFollowSmShort) {
  // BLOCK tylko gdy NIE PURE_MM i NIE FOLLOW_SM_SHORT
}
```
**Log sukcesu:** `🦅 [SIGNAL_ENGINE] LIT: FOLLOW_SM_SHORT → HARD_BLOCK bypassed, Generał rozkazuje shortować!`

### 3. SM OUTFLOW (Short Signal) Parser (24.01)
**Plik:** `src/signals/nansen_alert_parser_v2.ts`
**Metoda:** `parseMmBotSmOutflowShortSignal()`

**Logika:**
```
SM sprzedaje spot → otwiera shorty na Hyperliquid perps → BEARISH
```

**Progi outflow:**
| Token | 1h Outflow | 24h Outflow |
|-------|------------|-------------|
| LIT | >$3K | >$10K |
| FARTCOIN | >$25K | >$100K |
| VIRTUAL | >$25K | >$100K |

**Zachowanie:**
- Czyści `lastSmAccumulation`
- Ustawia `combinedSignal: RED`
- Zwraca alert typu `SM_DISTRIBUTION` z `is_short_signal: true`

### 4. SM INFLOW (Long Signal) Parser (24.01)
**Plik:** `src/signals/nansen_alert_parser_v2.ts`
**Metoda:** `parseMmBotSmInflowLongSignal()`

**Logika:**
```
SM kupuje spot → otwiera longi na Hyperliquid perps → BULLISH
```

**Progi inflow:**
| Token | 1h Inflow | 24h Inflow |
|-------|-----------|------------|
| LIT | >$5K | >$15K |
| FARTCOIN | >$100K | >$300K |
| VIRTUAL | >$75K | >$250K |

**Zachowanie:**
- Aktualizuje `lastSmAccumulation`
- Ustawia `combinedSignal: YELLOW/GREEN`
- Zwraca alert typu `SM_ACCUMULATION` z `is_long_signal: true`

### 5. Fix: Regex dla małych liter k/m/b (24.01)
**Problem:** Parser nie rozpoznawał "$5.2k" (mała litera)
**Fix w `findValue()`:**
```typescript
// Przed: /^[0-9,.]+[KMB]?$/
// Po:    /^[0-9,.]+[KkMmBb]?$/
```

### 6. TelemetryServer - Port retry logic (24.01)
**Problem:** Port 8080 i 8081 zajęte, telemetry nie startował
**Fix w `TelemetryServer.ts`:**
```typescript
private tryPort(port: number, attempts: number = 0): void {
  const maxAttempts = 5  // Try ports 8080-8084
  // ... recursive retry logic
}
```
**Konfiguracja:** `TELEMETRY_PORT=8082` w `.env`
**Endpoint:** `http://localhost:8082/telemetry/latest`

### 7. VIP Spy - Operacja "Cień Generała" (25.01)
**Plik:** `scripts/vip_spy.py`
**PM2:** `vip-spy`

**Cel:** Real-time monitoring 4 kluczowych SM traderów (TIER 1 wielorybów)

**Funkcje:**
- Polling co 30 sekund przez Hyperliquid API
- Wykrywanie: nowe pozycje, zamknięcia, flipy, zmiany SIZE >5%
- Anti-glitch protection (ignoruje błędy API)
- Alerty na Telegram + logi PM2
- State persistence w `/tmp/vip_spy_state.json`

**Monitorowane adresy (4 wieloryby):**
- `0xa31211...` (Generał) - altcoiny (HYPE, LIT, FARTCOIN)
- `0x45d26f...` (Wice-Generał) - majors + altcoiny
- `0x5d2f44...` (Pułkownik) - MEGA SHORT BTC $44.6M
- `0x35d115...` (Major) - MEGA SHORT SOL $65M

**Monitorowane coiny:** LIT, FARTCOIN, HYPE, BTC, SOL, ETH

### 8. Rotacja HYPE (25.01)
**Operacja:** Wymiana VIRTUAL na HYPE w aktywnym portfelu

### 9. VIP Spy Expansion - Pułkownik + Major (25.01)
**Operacja:** Dodanie 2 nowych TIER 1 wielorybów do monitoringu

**Nowi VIPy:**
| Alias | Adres | PnL 30D | Główna pozycja |
|-------|-------|---------|----------------|
| 🎖️ Pułkownik | `0x5d2f4460ac3514ada79f5d9838916e508ab39bb7` | +$21.1M | SHORT BTC $44.6M |
| 🎖️ Major | `0x35d1151ef1aab579cbb3109e69fa82f94ff5acb1` | +$12.8M | SHORT SOL $65M |

**Nansen Labels:** Smart HL Perps Trader, Consistent Perps Winner

**Rozszerzenie WATCHED_COINS:** Dodano BTC, SOL, ETH (majors)

**Łączne shorty 4 wielorybów:**
- BTC: $89.3M
- SOL: $67.3M
- ETH: $35.8M
- HYPE: $19.6M
- LIT: $7.95M
- FARTCOIN: $1.73M

### 10. Anti-Glitch Protection (25.01)
**Problem:** Fałszywe alerty gdy API zwraca błąd (429 rate limit)
**Fix:** Gdy `get_positions()` zwraca puste dane, zachowaj poprzedni stan
```python
if not positions and old_positions:
    log(f"⚠️ API glitch - zachowuję poprzedni stan")
    new_state[address] = old_positions
    continue
```

### 11. WebSocket subscribeTrades fix (25.01)
**Problem:** `TypeError: this.websocket.subscribeTrades is not a function` - bot nie mógł wystartować
**Plik:** `src/utils/websocket_client.ts`
**Fix:** Dodano brakującą metodę `subscribeTrades()` do klasy `HyperliquidWebSocket`
```typescript
subscribeTrades(coin: string, callback: (data: TradeUpdate) => void): void {
  const key = `trades:${coin}`
  // ... subscription logic
}
```
**Dodano także:** typ `TradeUpdate`, obsługę `trades` channel w `handleMessage()`

### 12. HOLD_FOR_TP dla HYPE - rotacja tokenów (25.01)
**Problem:** HYPE pozycje były zamykane ze stratą zamiast być trzymane dla Take Profit
**Przyczyna:** Po rotacji VIRTUAL → HYPE, wiele list tokenów nadal miało "VIRTUAL"

**Zmiany w `mm_hl.ts` (10 miejsc):**
- `SIGNAL_ENGINE_TOKENS_PAUSE` → dodano HYPE
- `DEBUG_TOKENS` → dodano HYPE
- `HOLD_FOR_TP_TOKENS` → VIRTUAL → HYPE
- `HOLD_FOR_TP_PAIRS` → VIRTUAL → HYPE
- `HOLD_FOR_TP_GRID` → VIRTUAL → HYPE
- `SIGNAL_ENGINE_TOKENS` → dodano HYPE
- Warunki FSO (Force Short Only) → dodano HYPE

**Zmiany w `dynamic_config.ts` (3 miejsca):**
- `MM_TOKENS` → VIRTUAL → HYPE
- `HOLD_FOR_TP_TOKENS` → VIRTUAL → HYPE
- `HOLD_FOR_TP_EMERGENCY` → VIRTUAL → HYPE

**Log sukcesu:** `💎 [HOLD_FOR_TP] HYPE: Blocking bids in emergency override - hold SHORT for TP`

### 13. HYPE Nansen Kill Switch Bypass (25.01)
**Problem:** `[NANSEN KILL SWITCH] HYPE: 💀 HYPE/hyperevm: token appears dead`
**Przyczyna:** HYPE jest perpem na Hyperliquid, nie ma on-chain flows na hyperevm

**Fix 1 - `market_vision.ts`:**
```typescript
'HYPE': {
  chain: 'hyperliquid',  // Zmiana z 'hyperevm'
  address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  // ...
}
```

**Fix 2 - `nansen_pro.ts` (`getGenericTokenGuard`):**
```typescript
if (chain === 'hyperliquid') {
  console.log(`[NansenPro] ${label}: Hyperliquid perp - skipping flow-based kill switch`)
  return { spreadMult: 1.0, pause: false }
}
```

### 14. FARTCOIN/LIT Known Active Tokens Whitelist (25.01)
**Problem:** `[NANSEN KILL SWITCH] FARTCOIN: 💀 token appears dead` - fałszywy alarm!
**Przyczyna:** Nansen API nie zwraca danych flow dla FARTCOIN na Solanie mimo że token ma $9M+ daily volume

**Fix w `nansen_pro.ts` (`getGenericTokenGuard`):**
```typescript
// Whitelist aktywnych tokenów - bypass kill switch gdy Nansen nie ma danych
const KNOWN_ACTIVE_TOKENS = [
  'FARTCOIN',  // Bardzo aktywny na Solana + HL perps, $9M+ daily volume
  'LIT',       // Aktywny na Ethereum + HL perps
]

// Bypass kill switch dla znanych aktywnych tokenów gdy dataQuality='dead'
if (isKnownActive && s.dataQuality === 'dead') {
  console.log(`[NansenPro] ${label}: ⚠️ Nansen shows no data but token is KNOWN ACTIVE - bypassing kill switch`)
  return { spreadMult: 1.2, pause: false } // Lekko szerszy spread jako ostrożność
}
```

**Log sukcesu:** `[NansenPro] FARTCOIN/solana: ⚠️ Nansen shows no data but token is KNOWN ACTIVE - bypassing kill switch`

### 15. ☢️ GENERALS_OVERRIDE - USUNIĘTY (25.01 → usunięty 03.02)
**Oryginalny cel:** Wymuszanie FOLLOW_SM_SHORT dla HYPE/LIT/FARTCOIN bezwarunkowo.
**Status:** Kod usunięty z codebase. Wieloryby flipnęły na LONG na HYPE (whale_tracker: FOLLOW_SM_LONG 86%).
LIT i FARTCOIN nie potrzebują override — dane same dają FOLLOW_SM_SHORT (ratio 4.89x / 91.6x).
Bot teraz w pełni polega na danych z whale_tracker + SignalEngine (Capital Dominance v3).

---

## Architektura sygnałów

```
┌─────────────────────────────────────────────────────────────┐
│  NANSEN DASHBOARD ALERTS                                    │
│  ├── SM OUTFLOW (Short Signal) ──→ parseMmBotSmOutflow...  │
│  ├── SM INFLOW (Long Signal)   ──→ parseMmBotSmInflow...   │
│  ├── SM Accumulation           ──→ parseMmBotSmAccumulation│
│  └── AI Trend Reversal         ──→ parseMmBotAiTrend...    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  SIGNAL STATE (/tmp/nansen_mm_signal_state.json)           │
│  ├── lastSmAccumulation: {timestamp, value}                │
│  ├── lastAiTrendReversal: {timestamp, signals[]}           │
│  └── combinedSignal: GREEN | YELLOW | RED | NONE           │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  SIGNAL ENGINE (Generał) - HIGHEST PRIORITY                │
│  ├── FOLLOW_SM_SHORT  → Bid×0.00, Ask×1.50                 │
│  ├── FOLLOW_SM_LONG   → Bid×1.50, Ask×0.00                 │
│  └── Może bypassować HARD_BLOCK gdy SM signal silny        │
└─────────────────────────────────────────────────────────────┘
```

### Warstwy priorytetów:
1. **SignalEngine (Generał)** - może overridować wszystko gdy ma silny sygnał
2. **HARD_BLOCK (Strażnik)** - blokuje pozycje, ale Generał może obejść
3. **REVERSAL/REGIME** - niższy priorytet, może być overridowany

---

## ⚔️ DOKTRYNA WOJENNA (War Doctrine)

### 🔄 Zmiana paradygmatu (styczeń 2026)

**BYŁO:** Market Maker łapiący spread
**JEST:** Agresywny Swing Trader podążający za Smart Money

```
┌─────────────────────────────────────────────────────────────┐
│  STARY MODEL (Market Making)                                │
│  - Składaj bidy i aski                                      │
│  - Łap spread 0.1-0.5%                                      │
│  - Szybko zamykaj pozycje                                   │
│  - Unikaj kierunkowego ryzyka                               │
└─────────────────────────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  NOWY MODEL (SM Follower)                                   │
│  - Podążaj za Smart Money                                   │
│  - Trzymaj pozycję do TP lub SL                             │
│  - Ignoruj "szum taktyczny"                                 │
│  - "Gruby albo wcale"                                       │
└─────────────────────────────────────────────────────────────┘
```

### 📸 Snapshot vs 🎬 Stream

| Komponent | Typ | Co mówi | Opóźnienie |
|-----------|-----|---------|------------|
| `whale_tracker.py` | **Snapshot** | "Jest $11M short" | 5-15 min |
| `AlphaEngine` | **Stream** | "3 wieloryby zamykają TERAZ!" | real-time |

**Problem:** Konflikty między Strategią a Taktyką

```
┌─────────────────────────────────────────────────────────────┐
│  STRATEGIA (whale_tracker)                                  │
│  "SM mają $11M short vs $1.7M long = TRZYMAJ SHORT"        │
└─────────────────────────────────────────────────────────────┘
                           ⚔️ KONFLIKT
┌─────────────────────────────────────────────────────────────┐
│  TAKTYKA (AlphaEngine)                                      │
│  "3 portfele redukują shorty = MOŻE BYĆ ODBICIE!"          │
└─────────────────────────────────────────────────────────────┘
```

**Rozwiązanie:** Strategia wygrywa. Ignorujemy taktyczny szum.

### ☢️ Nuclear Fix (aktywny od 24.01.2026)

| Wyłączone | Ustawienie | Efekt |
|-----------|------------|-------|
| **Market Making Bids** | `bidMultiplier: 0` | Zero kupowania w SHORT mode |
| **Position Reduce Logic** | Disabled | Bez panicznego zamykania |
| **Safety Bids** | Disabled | Bez zabezpieczeń odkupujących |

### 💎 Diamond Hands (parametry)

| Parametr | Wartość | Opis |
|----------|---------|------|
| **Stop Loss** | 12% | Maksymalna strata na pozycji |
| **Take Profit** | 50% | Cel zysku |
| **HOLD_FOR_TP** | Aktywny | Trzymaj do osiągnięcia TP |

### 💎 Diamond Hands - Pełna dokumentacja

#### Definicja i psychologia

| Typ | Emoji | Opis |
|-----|-------|------|
| **Diamond Hands** | 💎🙌 | Niezachwiane trzymanie pozycji mimo zmienności. Wierzy w tezę. |
| **Paper Hands** | 🧻🙌 | Panika przy pierwszej korekcie. Zamyka ze stratą przed ruchem. |

#### Porównanie strategii

| Cecha | 🧻 Paper Hands (stary bot) | 💎 Diamond Hands (nowy bot) |
|-------|---------------------------|----------------------------|
| **Stop Loss** | 1.5-2% | **12%** |
| **Take Profit** | 2-5% | **50%** |
| **Trailing Stop** | Agresywny (1.5%) | Wyłączony |
| **Częstotliwość** | Wysoka (Scalping) | Niska (Swing Trading) |
| **Win Rate** | Wysoki, małe zyski | Niższy, duże zyski |
| **Reakcja na szpilki** | Paniczna sprzedaż | Ignorowanie |
| **Ryzyko** | Death by 1000 cuts | Duża strata jeśli trend się odwróci |
| **Potencjał** | Ograniczony (grosze) | Ogromny (całe trendy) |

#### Kiedy stosować Diamond Hands?

**TYLKO** gdy masz silne potwierdzenie fundamentalne:

```
SM Ratio > 5x   →  💎 Diamond Hands AKTYWNE
SM Ratio 2-5x   →  ⚠️ Ostrożność, mniejsza pozycja
SM Ratio < 2x   →  🧻 Powrót do Paper Hands
```

**Aktualne przykłady:**
- LIT: **5.5x** SHORT (SM $11M short vs $1.7M long) → 💎
- FARTCOIN: **219x** SHORT (SM $5.4M short vs $33K long) → 💎💎💎

#### 🎯 Zasady Diamond Hands:

1. **Gdy SM są SHORT** → Bot jest SHORT
2. **Nie zamykaj** dopóki:
   - ✅ TP 50% osiągnięty, lub
   - ❌ SL 12% przekroczony, lub
   - 🔄 SM zmienią pozycję na LONG
3. **Ignoruj:**
   - Krótkoterminowe odbicia (fake pumps)
   - Taktyczne redukcje przez pojedyncze wieloryby
   - "Szum" z AlphaEngine gdy Strategia mówi HOLD
   - Emocje i FOMO

#### 📊 Kiedy Diamond Hands NIE działa:

- SM ratio spada poniżej 2x (np. $5M short vs $3M long)
- Wszystkie SM zamykają pozycje (nie tylko redukcja)
- HARD_BLOCK aktywowany przez zewnętrzny sygnał
- Fundamenty się zmieniły (np. duży news)

#### 🔒 Implementacja w kodzie:

```typescript
// HOLD_FOR_TP blokuje bidy gdy trzymamy shorta
const HOLD_FOR_TP_GRID = ['HYPE', 'LIT', 'FARTCOIN']  // Zaktualizowane 25.01

if (mode === FOLLOW_SM_SHORT && hasShortPosition) {
  bidMultiplier = 0.00  // ZERO kupowania
  askMultiplier = 1.50  // Agresywne shortowanie
  lockBids = true
}

// Nuclear Fix - ostatnia linia obrony
if (sizeMultipliers.bid === 0 && isHoldForTpGrid) {
  gridOrders = gridOrders.filter(o => o.side !== 'bid')
  // + anuluj istniejące bidy na giełdzie
}
```

#### Profil ryzyka

```
         RYZYKO                    NAGRODA
    ┌─────────────┐           ┌─────────────┐
    │   -12%      │           │   +50%      │
    │   (SL)      │           │   (TP)      │
    └─────────────┘           └─────────────┘

    Risk/Reward Ratio = 1:4.16

    Wymagany Win Rate dla breakeven: ~20%
    (przy 1 wygranej na 5 trades jesteś na zero)
```

---

## PM2 Management

```bash
# Restart bota
ssh hl-mm '~/.npm/_npx/5f7878ce38f1eb13/node_modules/pm2/bin/pm2 restart mm-bot'

# Logi
ssh hl-mm '~/.npm/_npx/5f7878ce38f1eb13/node_modules/pm2/bin/pm2 logs mm-bot --lines 50'

# Status
ssh hl-mm '~/.npm/_npx/5f7878ce38f1eb13/node_modules/pm2/bin/pm2 status'
```

---

## Telemetry

```bash
# Health check
curl http://localhost:8082/telemetry/health

# Full status
curl http://localhost:8082/telemetry/latest

# Watchdog
curl http://localhost:8082/watchdog
```

---

## 🕵️ VIP Spy - Operacja "Cień Generała" (25.01.2026)

### Cel
Monitoring w czasie rzeczywistym **4 kluczowych SM traderów** (TIER 1 Wielorybów) na Hyperliquid.

### Monitorowani VIPy (4 wieloryby)

| Alias | Adres | Nansen Labels | PnL 30D | Główne pozycje |
|-------|-------|---------------|---------|----------------|
| 🎖️ **Generał** | `0xa312114b5795dff9b8db50474dd57701aa78ad1e` | Smart HL Perps Trader | +$15.1M | HYPE $8.3M, LIT $7.5M, ETH $3.5M |
| 🎖️ **Wice-Generał** | `0x45d26f28196d226497130c4bac709d808fed4029` | Smart HL Perps Trader | +$30.6M | BTC $39M, ETH $27M, HYPE $11.3M |
| 🎖️ **Pułkownik** | `0x5d2f4460ac3514ada79f5d9838916e508ab39bb7` | Smart HL, Consistent Perps Winner | +$21.1M | BTC $44.6M (MEGA SHORT) |
| 🎖️ **Major** | `0x35d1151ef1aab579cbb3109e69fa82f94ff5acb1` | Smart HL, Consistent Perps Winner | +$12.8M | SOL $65M, BTC $5.6M, ETH $5.4M |

### Łączne shorty 4 wielorybów (snapshot 25.01.2026)

| Coin | Total SHORT | Główny gracz |
|------|-------------|--------------|
| **BTC** | $89.3M | Pułkownik ($44.6M) + Wice-Generał ($39M) |
| **SOL** | $67.3M | Major ($65.2M) |
| **ETH** | $35.8M | Wice-Generał ($26.9M) |
| **HYPE** | $19.6M | Wice-Generał ($11.3M) + Generał ($8.3M) |
| **LIT** | $7.95M | Generał ($7.5M) |
| **FARTCOIN** | $1.73M | Wice-Generał ($957K) + Generał ($773K) |

### Monitorowane coiny
**Altcoiny (Generał + Wice-Generał):**
- LIT, FARTCOIN, HYPE

**Majors (Pułkownik + Major):**
- BTC, SOL, ETH

### Konfiguracja

| Parametr | Wartość |
|----------|---------|
| Interwał | 30 sekund |
| Threshold | $10,000 lub 5% zmiany |
| State file | `/tmp/vip_spy_state.json` |
| PM2 name | `vip-spy` |

### Wykrywane zdarzenia

| Event | Opis | Alert |
|-------|------|-------|
| `NEW_POSITION` | VIP otwiera nową pozycję | Telegram + log |
| `CLOSED_POSITION` | VIP zamyka pozycję | Telegram + log |
| `FLIP_POSITION` | VIP zmienia stronę (LONG↔SHORT) | Telegram + log |
| `SIZE_INCREASED` | VIP zwiększa pozycję o >$10K lub >5% | Telegram + log |
| `SIZE_REDUCED` | VIP redukuje pozycję o >$10K lub >5% | Telegram + log |

### Użycie

```bash
# Uruchomienie
pm2 start scripts/vip_spy.py --name vip-spy --interpreter python3

# Logi
pm2 logs vip-spy --lines 50

# Status
pm2 status vip-spy

# Restart
pm2 restart vip-spy
```

### Źródło danych

```
Hyperliquid API → clearinghouseState → VIP positions
     ↓
   vip_spy.py (co 30s)
     ↓
  Porównanie z poprzednim stanem
     ↓
  Alert jeśli zmiana > threshold
```

---

## 🐋 whale_tracker.py — Smart Money Snapshot Engine

### Źródło danych: Hyperliquid API (darmowe!)

Skrypt korzysta z jednego endpointu: `https://api.hyperliquid.xyz/info`

Dwa typy zapytań:

1. **`clearinghouseState`** — dla każdego trackowanego adresu wieloryba:
```python
POST https://api.hyperliquid.xyz/info
{"type": "clearinghouseState", "user": "0xa312..."}
```
Zwraca: wszystkie otwarte pozycje — coin, side (Long/Short), size, entry price, unrealized PnL, liquidation price, leverage

2. **`allMids`** — aktualne ceny wszystkich perpów

### Trackowane adresy (~30 wielorybów w 3 tierach)

| Tier | Typ | signal_weight | Przykłady |
|------|-----|---------------|-----------|
| **TIER 1** (Conviction) | Nansen-verified SM | 0.80-1.0 | Generał (a31211), Pułkownik (5d2f44), Major (35d115), Bitcoin OG (b317d2) |
| **TIER 2** (Funds) | Instytucje | 0.70-0.85 | Galaxy Digital, Laurent Zeimes, 58bro.eth, Arrington XRP |
| **TIER 3** (Active) | Aktywni SM traderzy | 0.50-0.85 | ~15 weryfikowanych adresów z Nansen |

### System ważenia

```
Final weight = signal_weight (rozmiar pozycji) × credibility_multiplier (weryfikacja Nansen)
```

| Nansen Label | Credibility | Efekt |
|-------------|-------------|-------|
| Smart HL Perps Trader | **1.0** | Pełna waga |
| All Time Smart Trader | 0.95 | Prawie pełna |
| Fund | 0.90 | Wysoka |
| Whale (bez labela) | **0.30** | ~3.5x mniejszy wpływ niż verified SM |
| Market Maker | **0.0** | Ignorowany (flipują ciągle) |

### Produkowane pliki

**`/tmp/smart_money_data.json`** — dla każdego coina:
- `mode`: FOLLOW_SM_SHORT / FOLLOW_SM_LONG / CONTRARIAN_LONG / CONTRARIAN_SHORT / NEUTRAL
- `confidence`: 0-100%
- `maxPositionMultiplier`: 0.0-1.0
- `longValueUsd` / `shortValueUsd` — ważone pozycje SM
- `longPnlUsd` / `shortPnlUsd` — unrealized PnL
- `trend`: increasing_longs / increasing_shorts / stable (7 dni historii)
- `velocity`: flow momentum
- Ostrzeżenia: momentum, squeeze, divergence

**`/tmp/nansen_bias.json`** — prosty bias per coin:
- 0.0 = 100% SHORT, 0.5 = neutral, 1.0 = 100% LONG

### Logika decyzyjna (`determine_trading_mode`)

```
SM SHORT dominant (ratio>2x) + shorts w zysku  → FOLLOW_SM_SHORT
SM SHORT dominant + shorts underwater           → CONTRARIAN_LONG (squeeze potential)
SM LONG dominant (ratio<0.5x) + longs w zysku  → FOLLOW_SM_LONG
SM LONG dominant + longs underwater             → CONTRARIAN_SHORT
Mieszane/neutral                                → NEUTRAL
```

### Zabezpieczenia

| Mechanizm | Co robi | Kiedy |
|-----------|---------|-------|
| **Squeeze timeout** | Maleje confidence po 4h, wyjście po 12h | CONTRARIAN mode trwa za długo |
| **Stale PnL** | Penalty gdy SM traci momentum (24h change) | SM w zysku ale trend odwraca |
| **Perps vs Spot divergence** | Penalty gdy flow nie zgadza się z pozycjami | Np. shorts winning + duży inflow |
| **Confidence → sizing** | 90-100%=full, 60-75%=50%, <40%=10% | Zawsze — mniejsza pewność = mniejsza pozycja |

### Jak bot konsumuje dane

```
whale_tracker.py (cron co 15-30 min)
  → /tmp/smart_money_data.json
  → /tmp/nansen_bias.json
      ↓
SmAutoDetector.ts (loadAndAnalyzeAllTokens)
  → czyta smart_money_data.json
  → przekazuje mode/confidence do SignalEngine
      ↓
SignalEngine (Generał)
  → decyduje: FOLLOW_SM_SHORT / FOLLOW_SM_LONG / PURE_MM
  → ustawia bidMultiplier / askMultiplier
```

### Cache i historia

| Plik | Opis |
|------|------|
| `~/.whale_tracker/positions_cache.json` | Ostatni snapshot (do detekcji zmian) |
| `~/.whale_tracker/daily_history.json` | 7-dniowa historia (analiza trendów) |
| `~/.whale_tracker/hourly_history.json` | 48h historia godzinowa (bottom detection, 24h changes) |
| `/tmp/contrarian_state.json` | Śledzenie czasu w CONTRARIAN mode (squeeze timeout) |

### Uwaga: whale_tracker.py vs whale_tracker_pro.py

- **`whale_tracker.py`** — główny, produkcyjny skrypt (~2400 linii). Trackuje ~30 adresów, system ważenia, trend analysis, bot data generation
- **`whale_tracker_pro.py`** — uproszczona wersja "Trading Manual" z mock data. Tylko 3 adresy, generuje raport na Telegram. Nie używany przez bota

### Audit TIER 1 portfeli (snapshot 21.02.2026)

**4 z 14 kont ZAMKNIĘTE (account = $0):**

| Adres | Alias | Było (styczeń) | Status |
|-------|-------|-----------------|--------|
| `0xb317d2bc2d3d2df5fa441b5bae0ab9d8b07283ae` | Bitcoin OG | $717M ETH, $92M BTC, $68M SOL LONG | **ZLIKWIDOWANY 31.01.2026** |
| `0xbaae15f6ffe2aa6e0e9ffde6f1888c8092f4b22a` | SM baae15 | FARTCOIN SHORT, BTC/PUMP LONG | Zamknięty |
| `0x2ed5c47a79c27c75188af495a8093c22ada4f6e7` | SM 2ed5c4 | ASTER LONG $3.8M | Zamknięty |
| `0x689f15c9047f73c974e08c70f12a5d6a19f45c15` | SM 689f15 | BTC LONG $3.2M | Zamknięty |

#### Bitcoin OG — likwidacja 31.01.2026

Adres: `0xb317d2bc2d3d2df5fa441b5bae0ab9d8b07283ae`

Największy wieloryb w trackerze ($877M pozycji) został zlikwidowany jednego dnia:

| Coin | Fills | Wartość | Closed PnL | Jak |
|------|-------|---------|-----------|-----|
| ETH | 1,266 | $292M | **-$121.8M** | **Liquidated Cross Long** |
| SOL | 734 | $18.9M | **-$6.1M** | Close Long |
| **Łącznie** | 2,000 | $311M | **-$127.9M** | Jednego dnia |

ETH LONG ($717M) został przymusowo zamknięty przez giełdę — margin nie wystarczył po spadku ceny. Reszta (SOL) zamknięta tego samego dnia.

#### Drastyczne redukcje (aktywne konta)

| Alias | Pozycja | Styczeń | Luty 2026 | Zmiana |
|-------|---------|---------|-----------|--------|
| Pułkownik (5d2f44) | BTC SHORT | $46.3M | $0 (puste konto $5.5M) | **Zamknął wszystko** |
| Major (35d115) | SOL SHORT | $64.3M | $15.1M | **-76%** |
| Wice-Generał (45d26f) | BTC SHORT | $40.5M | $9.9M | **-75%** |
| Wice-Generał | ETH SHORT | $28.9M | $2.9M | **-90%** |
| 71dfc0 | ETH SHORT | $19.8M | $2.8M | **-86%** |
| Generał (a31211) | LIT SHORT | $7.4M | $3.3M | **-55%** |

#### Kto zwiększył pozycje

| Alias | Pozycja | Styczeń | Luty 2026 | Zmiana |
|-------|---------|---------|-----------|--------|
| 71dfc0 | BTC SHORT | $25.4M | $29.2M (+$10.5M uPnL) | **+15%** |
| 06cecf | SOL SHORT | $11.8M | $15.2M (+$7.6M uPnL) | **+29%** |
| 06cecf | BTC/HYPE/FARTCOIN SHORT | - | $4.8M/$4.3M/$1.0M | **Nowe pozycje** |

#### Zmiany portfela Generała (a31211)

| Pozycja | Styczeń | Luty 2026 |
|---------|---------|-----------|
| LIT SHORT | $7.4M | $3.3M (+$1.3M uPnL) — zredukował 55% |
| DOGE SHORT | $2M | **ZAMKNIĘTY** |
| ASTER SHORT | - | $2.4M (+$935K) — NOWA, największa |
| PUMP SHORT | - | $1.7M (+$394K) — NOWA |
| FARTCOIN SHORT | - | $959K (+$486K) — trzyma |
| WLFI/APEX/MET SHORT | - | ~$250K każda — NOWE |

#### Flip na 936cf4

| Pozycja | Styczeń | Luty 2026 |
|---------|---------|-----------|
| SOL | SHORT $6.6M | **LONG $1.9M** — FLIP! |
| BTC | - | SHORT $2.1M (underwater) |
| ETH | - | SHORT $4.9M (underwater) |
| XRP | - | LONG $1.8M — nowa |

#### Wnioski

- Mega-bearish trend słabnie — wieloryby realizują zyski i zmniejszają ekspozycję SHORT
- 4/14 kont zamkniętych, w tym Bitcoin OG (likwidacja -$128M)
- Pułkownik zamknął $46M BTC SHORT — brak pozycji
- Nadal SHORT: 71dfc0 (BTC $29M), 06cecf (SOL $15M), Wice-Generał (rozproszone altcoiny)
- Generał zmienił focus: LIT/DOGE → ASTER/PUMP/LIT/FARTCOIN

---

## Git / GitHub

```bash
# Remote
origin: git@github.com:jp81-tech/jp81-tech-jerry-hyperliquid-mm-bot-complete.git

# Branch
fix/update-nansen-debug

# Ostatni commit
43ed7c4 refactor: unify trader names across codebase from vip_config aliases

# PR #1
https://github.com/jp81-tech/jp81-tech-jerry-hyperliquid-mm-bot-complete/pull/1
```

**UWAGA:** Usunięto `.env` i `.env.remote` z historii git (zawierały API keys) używając `git-filter-repo`.

---

## 🔮 Shadow Trading — moduł kopiowania SM trades

### Co to jest
Shadow Trading = moduł "podglądania" i kopiowania ruchów elitarnych traderów (Smart Money) w real-time. Nazwa "shadow" = "cień" — bot chodzi jak cień za wielorybami.

### Architektura

```
Zewnętrzny serwer (Nansen API)
  → wystawia endpoint /api/latest_trades
    → lista ostatnich trade'ów SM traderów (kto, co, buy/sell, ile $)
      ↓
mm-bot polluje co 30s (pollShadowTrades w mm_hl.ts)
      ↓
EliteTraderRegistry — rejestr 8 wielorybów z seed data
  (Abraxas Capital, Pułkownik, Wice-Generał, Major, Generał...)
  → sprawdza czy trade jest od znanego wieloryba
      ↓
SignalDetector — analizuje i generuje sygnały:
  • WHALE_ENTRY  — wieloryb otwiera pozycję
  • WHALE_EXIT   — wieloryb zamyka
  • CONSENSUS_LONG/SHORT — 2+ wielorybów po tej samej stronie
  • MOMENTUM_SHIFT — duża zmiana sentymentu
      ↓
ShadowTradingIntegration — dostosowuje grid MM:
  • getGridBiasAdjustment() → przesuwa bias grida (+/- 30%)
  • detectShadowContrarianConflict() → wykrywa gdy bot jest po złej stronie
      ↓
ShadowAlertIntegration → alerty do AlertManager/Telegram
```

### Pliki modułu

| Plik | Rola |
|------|------|
| `src/shadow/types.ts` | Typy: EliteTrader, TradeSignal, ShadowConfig, NansenTrade |
| `src/shadow/EliteTraderRegistry.ts` | Rejestr 8 wielorybów (seed data z Nansen leaderboard) |
| `src/shadow/SignalDetector.ts` | Analiza trade'ów → generowanie sygnałów (WHALE_ENTRY/EXIT, CONSENSUS, MOMENTUM_SHIFT) |
| `src/shadow/ShadowTradingIntegration.ts` | Główna klasa — grid bias adjustment, conflict detection |
| `src/shadow/ShadowAlertIntegration.ts` | Łącznik z AlertManager — emituje alerty na silne sygnały |
| `src/shadow/index.ts` | Eksporty |

### Siła sygnałów

| Strength | Pozycja | Traderzy | Bias grida |
|----------|---------|----------|------------|
| WEAK | <$100K | 1 | ±3% |
| MODERATE | $100K-$500K | 1-2 | ±8% |
| STRONG | $500K-$2M | 2-3 | ±15% |
| EXTREME | >$2M | 4+ | ±25% |

### Status: WYŁĄCZONY (od 21.02.2026)

**Powód:** Brak backendu. Shadow trading wymaga zewnętrznego serwera który zbiera trade'y SM z Nansen API i wystawia je na `/api/latest_trades`. Ten serwer **nigdy nie został postawiony**.

Domyślny URL (`http://127.0.0.1:8081/api/latest_trades`) trafiał w telemetry server → HTTP 404 spam co 30s.

### Dlaczego nie jest potrzebny (na razie)

Tę samą funkcjonalność (podążanie za SM) realizują inne komponenty które działają:

| Komponent | Źródło danych | Typ | Status |
|-----------|--------------|-----|--------|
| **whale_tracker.py** | Snapshot pozycji SM co 15-30 min | Snapshot | Działa |
| **vip_spy.py** | Real-time polling 4 wielorybów co 30s | Stream | Działa |
| **SignalEngine** | Agregacja whale_tracker + Nansen alerts | Agregator | Działa |
| **Shadow Trading** | Dedykowany feed SM trades z Nansen API | Stream | **Brak backendu** |

### Jak włączyć w przyszłości

1. Postawić serwer który fetchuje SM trades z Nansen API i wystawia `/api/latest_trades`
2. Ustawić `SHADOW_TRADING_ENABLED=true` w `.env`
3. Ustawić `SHADOW_TRADING_TRADES_URL=http://127.0.0.1:<port>/api/latest_trades`
4. Restart mm-bot

---

## Nansen Dashboard Alerts (Telegram)

**Chat ID:** `-1003886465029` (Nansen alerts)
**Chat ID:** `-1003724824266` (alternatywny)

**Skonfigurowane alerty:**
| Token | Chain | Short (Outflow) | Long (Inflow) |
|-------|-------|-----------------|---------------|
| LIT | Ethereum | >$3k/1h | >$3k/1h |
| FARTCOIN | Solana | >$25k/1h | >$25k/1h |
| VIRTUAL | Base | >$25k/1h | >$25k/1h |

---

## Do zrobienia
- [ ] Deploy TWAP na serwer — `TWAP_ENABLED=true` w .env, `pm2 restart mm-bot`, obserwować logi `🔄 [TWAP]`
- [ ] Monitorować TWAP slippage — porównać avg fill price vs start mid price w logach `📊 [TWAP]`
- [ ] Sprawdzić TWAP eskalację — czy ALO→GTC→IOC działa poprawnie na illiquid coinach (LIT, FARTCOIN)
- [ ] Monitorować kPEPE Toxicity Engine — logi `🐸 [kPEPE TOXICITY]` co 20 ticków, sprawdzić VPIN readings
- [ ] Sprawdzić kPEPE VPIN po deployu — czy readings != 0.5 (baseline) po przejściu na $500 buckets
- [ ] Monitorować hedge triggers — czy IOC fires gdy skew >50% przez 30min
- [ ] Sprawdzić per-layer refresh — L4 NIE powinno być cancel/replace co tick, tylko co 5
- [ ] Monitorować LIT+FARTCOIN focus — $200/order fills, P&L tracking, inventory balance
- [ ] Sprawdzić PnL po kilku dniach — cel $500/day z LIT+FARTCOIN
- [ ] Monitorować capital floor (cap×0.80) — czy squeeze analysis nie blokuje focus pairs
- [ ] Monitorować działanie SM OUTFLOW/INFLOW alertów w produkcji
- [ ] Rozważyć dodanie więcej tokenów do monitoringu
- [ ] Obserwować kontrarianów (091159, 570b09) — czy ich LONG play się sprawdzi vs SM SHORT consensus
- [ ] Kraken A — sprawdzić czy adres `06cecf439eceb9e3c7a8ed23efdf5e3e8c124630` w SmAutoDetector to skrócony czy inny portfel (NANSEN_SM_LABELS ma `0x06cecf` = prawidłowy prefix)
- [x] Tracker deep audit — 14 dead usunięte, 5 WATCH, 5 upgraded, ⭐ gwiazdki dla top traderów (DONE 23.02)
- [x] Unify trader names across codebase — 19 traderów renamed from vip_config aliases w 3 plikach (DONE 23.02)
- [x] kPEPE Toxicity Engine deployed — 8 sygnałów, 10-zone time, hedge triggers (DONE 05.02)
- [x] LIT+FARTCOIN focus deployed — 5 bottlenecków naprawionych (DONE 04.02)
- [x] POPCAT PURE_MM deployed (DONE 04.02, zastąpiony przez LIT+FARTCOIN)
- [x] Per-token leverage override (DONE 04.02)
- [x] VIP Spy - monitoring Generała i Wice-Generała (DONE 25.01)
- [x] Fix HOLD_FOR_TP dla HYPE po rotacji tokenów (DONE 25.01)
- [x] Fix fałszywych alarmów Nansen Kill Switch dla FARTCOIN (DONE 25.01)
- [x] GENERALS_OVERRIDE - USUNIĘTY 03.02 (wieloryby flipnęły LONG na HYPE, LIT/FARTCOIN nie potrzebują override)
- [x] Shadow trade feed HTTP 404 spam — wyłączony + rate-limited error logging (DONE 21.02)
- [x] Paginated fills utility — `src/utils/paginated_fills.ts` + 6 plików zmodyfikowanych (DONE 21.02)
- [x] Winner d7a678 analiza — 2220 fills, +$4.09M HL, +$5.5M total, konto zamknięte (DONE 21.02)
- [x] VIP Intelligence Report — 22→24 portfeli, $416.6M notional, 3.9x SHORT (DONE 21.02)
- [x] October 2025 BTC Crash analysis — top 8 traders, $355M profits, Fasanara+Abraxas odkryte i dodane (DONE 21.02)
- [x] Fasanara Capital dodany do VIP spy (tier1, $94.5M notional, London hedge fund) (DONE 21.02)
- [x] Abraxas Capital dodany do VIP spy (tier2, $7.2M, +$37.9M Oct crash) (DONE 21.02)
- [x] Bitcoin OG #2 dodany do VIP spy (tier1, watching for return, +$72.5M Oct crash) (DONE 21.02)
- [x] VIP Intelligence updated — 25 portfeli, $528M notional, 5.2x SHORT (DONE 21.02)
- [x] Fix AI Trend Reversal parser — multiplier-based direction zamiast blind MOMENTUM_LONG (DONE 22.02)
- [x] Remove Selini Capital (5 kont MM) z whale_tracker, SmAutoDetector, hype_monitor, alert parser (DONE 22.02)
- [x] Fix ai-executor Nansen alert relay — brakujący .env.ai-executor, token Telegram (DONE 22.02)
- [x] Mapa procesów serwera — 10 PM2 + 2 standalone, 3 tokeny Telegram (DONE 22.02)
- [x] Server health audit — 5 problemów znalezionych, 4 naprawione (DONE 22.02)
- [x] prediction-api fix — isMainModule → if(true), port 8090 działa (DONE 22.02)
- [x] sui-price-alert usunięty — nierealistyczne targety (DONE 22.02)
- [x] hourly-report → cron `15 * * * *` (DONE 22.02)
- [x] whale-report → cron `0 8 * * *` (DONE 22.02)
- [x] prediction-api NansenFeatures fix — SM data mismatch (parsed.tokens→parsed.data, field names), 40% wagi odblokowane (DONE 22.02)
- [x] ai-executor Nansen channel ID fix — `-1003724824266` → `-1003886465029`, bot jest admin kanału (DONE 22.02)
- [x] Fix #3: whale_tracker conviction override when SignalEngine WAIT (DONE 22.02)
- [x] Fix #5: whale_tracker.py added to crontab */15 min, nansen_bias.json fresh (DONE 22.02)
- [x] Fix #6: Oracle divergence logging added, non-invasive (DONE 22.02)
- [x] prediction-api expanded to 8 tokens + 5 horizons (h1,h4,h12,w1,m1), PREDICTION_HORIZONS config, slope dampening, per-horizon MIN_SAMPLES (DONE 22.02)
- [x] War Room dashboard expanded to 8 tokens + w1/m1 horizons, 4x2 grid layout, shrunk UI for smaller panels (DONE 23.02)
- [x] Fix ai-executor v1 systemd conflict — Telegram 409, stub + TS_NODE_TRANSPILE_ONLY fix (DONE 23.02)
- [x] Nansen Spot Alerts diagnoza — zero SM activity na spot dla LIT/FARTCOIN/VIRTUAL, pipeline działa ale nic do alertowania (DONE 23.02)

## Notatki
- **TWAP Executor**: `TWAP_ENABLED=true` w .env włącza TWAP. Domyślnie wyłączony. `closePositionTwap()` fallbackuje na stary IOC gdy TWAP niedostępny. Per-token override: `${PAIR}_TWAP_SLICES`, `${PAIR}_TWAP_DURATION`. Logi: `🔄 [TWAP]`, `📤 [TWAP]`, `✅ [TWAP]`, `📊 [TWAP]`. TWAP NIE dotyczy kPEPE hedge ani HOLD_FOR_TP — tylko rotation cleanup i manual close.
- `whale_tracker.py` w cronie co 15 min (od 22.02)
- `vip_spy.py` działa jako PM2 process `vip-spy` (polling co 30s)
- Telemetry działa na porcie 8082 (8080/8081 zajęte przez inne serwisy)
- gh CLI zainstalowane i zalogowane jako `jp81-tech`
- **KNOWN_ACTIVE_TOKENS**: FARTCOIN, LIT - omijają kill switch gdy Nansen nie ma danych
- **Hyperliquid perps**: chain='hyperliquid' automatycznie omija flow-based kill switch (HYPE, POPCAT)
- **☢️ GENERALS_OVERRIDE**: USUNIĘTY (wieloryby flipnęły LONG na HYPE; LIT/FARTCOIN działają z danych)
- **LIT+FARTCOIN focus**: STICKY_PAIRS, 5x leverage, $200/order, $10K max pos, SM-following
- **POPCAT**: Zastąpiony przez LIT+FARTCOIN (dawał ~$0.35/day z powodu UTIL CAP bottleneck)
- **Order sizing chain**: 5 warstw bottlenecków — INSTITUTIONAL_SIZE_CONFIG → rebucketing → UTIL CAP → capitalMultiplier → HARD_BLOCK
- **Capital floor**: STICKY_PAIRS mają min cap×0.80 (zapobiega squeeze throttling poniżej 80%)
- **Per-token leverage**: `${TOKEN}_LEVERAGE` env var overriduje globalny `LEVERAGE` i SM-calculated leverage
- **Nansen AI hallucynacje**: Symbole `xyz:TSM` i `cash:HOOD` NIE istnieją na HL — zawsze weryfikuj przez `curl` do API giełdy
- **Dwa tryby par**: SM-rotated (BTC/ETH — co 4H) vs Sticky (LIT/FARTCOIN — zawsze aktywne)
- **kPEPE Toxicity Engine**: 8 sygnałów detekcji, 10-zone time-of-day, per-layer refresh, hedge triggers (IOC), VPIN $500 buckets
- **TS_NODE_TRANSPILE_ONLY=1**: KRYTYCZNE przy recreate mm-bot w PM2 — bez tego crash loop na type errors (np. `TS18048: possibly undefined`). Env var jest w `ecosystem.config.js`
- **systemd ai-executor.service**: `Restart=always` na serwerze, nie da się zatrzymać bez sudo. Workaround: stub script `process.exit(0)` → respawnuje się i natychmiast wychodzi
- **Nansen Spot Alerts (23.02)**: Zero SM activity na spot dla LIT/FARTCOIN/VIRTUAL — pipeline działa (ai-executor polls → queue → mm-bot processes), ale Nansen nie wysyła alertów bo SM nie traduje spot tych tokenów. Prawdziwe dane SM płyną przez whale_tracker.py (Hyperliquid perps)
- **kPEPE CANDLE_COINS**: Dodane do data fetcher — bez tego momentum=0 i volatility sizing nie działa
- **Hyperliquid fills bez adresów**: Fills dają tylko oid/coin/side/px/sz/time/fee — toksyczność musi być wykrywana z wzorców (VPIN, adverse selection, rapid fills, sweeps)
- **Shadow trading**: Wyłączone (`SHADOW_TRADING_ENABLED=false`). Nie ma serwera shadow trades. Domyślny URL trafia w telemetry (port 8081). Gdyby trzeba było włączyć — najpierw postawić serwer i ustawić `SHADOW_TRADING_TRADES_URL`
- **Porty na serwerze**: 8080=nansen-bridge, 8081=mm-bot telemetry (fallback), 8082=wolny
- **Paginated fills**: `src/utils/paginated_fills.ts` — ZAWSZE używaj `fetchAllFillsByTime()` zamiast raw `userFillsByTime`. API zwraca max 2000 fills.
- **Winner d7a678**: `0xd7a678fcf72c1b602850ef2f3e2d668ec41fa0ed` — konto zamknięte od 31.01.2026 ($0, zero pozycji). W VIP spy tier1 "watching for return". +$5.5M total profit (SOL/BTC/ETH short). 6 powiązanych adresów z Nansen — zero aktywności na HL.
- **Tracker Audit (23.02)**: ~39 aktywnych + 5 WATCH. Usunięto 14 dead/underwater. Upgrades: Kraken A ⭐ (0.90, +$13.15M), Kraken B ⭐ (0.85, +$3.54M), OG Shorter c7290b (0.65, +$5.76M), donkstrategy.eth (0.65, +$1.2M), Manifold Trading (0.30, MM→ACTIVE). Kontrariani na WATCH: 091159 (zamknął BTC LONG po kilku h), 570b09 (SOL LONG vs consensus).
- **VIP Intelligence (23.02, updated)**: ~39 aktywnych portfeli + 5 WATCH. SM consensus nadal masywnie SHORT na BTC/ETH/SOL. Dwóch kontrarianów (091159, 570b09) flipnęło na LONG 23.02 ale 091159 się wycofał po kilku godzinach.
- **BTC SHORT Deep Dive (21.02)**: 10 portfeli shortuje BTC, 0 longuje. Łącznie 1,410 BTC ($96M), uPnL +$32M. Top entries: Kraken A $108K (-1% od ATH), Kapitan BTC $106K (-2.6%), Galaxy Digital $104K (-5%). Dwa klastry wejść: 1 paź (SOL2+fce0 tego samego dnia) i 12-13 paź (feec+Kapitan BTC dzień po dniu). Galaxy Digital jedyny kto redukuje (kupuje 37 BTC w lutym). 58bro.eth BTC SHORT $18.4M na 40x — liquidation $90,658.
- **5 podwójnie zweryfikowanych (Smart HL + Consistent Winner)**: Major (3 poz, $30.6M), Pułkownik (0 poz, $5.5M cash, 331% ROI), Wice-Generał (45 poz, $30.8M, HYPE $16.6M underwater), 58bro.eth (7 poz, $31.4M, +$17.6M DeFi), Kapitan 99b1 (5 poz, $1.35M, mid-cap shorter)
- **October 2025 BTC Crash ($126K→$103K, -18% w 11 dni)**: Top 8 traderów zarobiło $355M. Bitcoin OG (+$165M z 2 adresów), Abraxas Capital (+$37.9M), Galaxy Digital (+$31.4M), Fasanara Capital (+$30.8M), Generał (+$30.3M z 2 adresów), Silk Capital/Token Millionaire (+$29.9M), Wintermute (+$29.6M, market maker — pomijamy).
- **Fasanara Capital** (`0x7fdafde5cfb5465924316eced2d3715494c517d1`): London hedge fund, tier1, +$30.8M Oct crash. Obecne: ETH SHORT $49M, BTC SHORT $25M, HYPE SHORT $14.6M = **$94.5M notional** (największy trackowany portfel). Dodany 21.02.
- **Abraxas Capital** (`0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36`): tier2, +$37.9M Oct crash, wypłacił $144M na Binance. Obecne: XRP $3.6M + HYPE $3.4M SHORT = $7.2M. Dodany 21.02.
- **Bitcoin OG pełny cykl**: +$165M na BTC shorts paź 2025 → zlikwidowany -$128M na ETH LONG sty 2026. Konto zamknięte.
- **VIP Spy (po update 21.02)**: 25 VIPów (tier1=10, tier2=10, fund=5), 25 watched coins (dodano AVAX). Bitcoin OG #2 dodany jako "watching for return". vip-spy zrestartowany.
- **ai-executor Nansen relay**: `.env.ai-executor` MUSI istnieć w katalogu bota — bez niego alerty Nansen nie trafiają do kolejki. Token: `@HyperliquidMM_bot` (8273887131). `can_read_all_group_messages: false` ale działa (bot jest adminem kanału Nansen).
- **3 procesy AI na serwerze**: (1) ai-executor PM2 = Nansen relay (KRYTYCZNY), (2) ai-chat-gemini.mjs = prosty chatbot, (3) ai-executor.mjs GOD MODE = /panic, /close, AI analiza. Procesy 2 i 3 poza PM2 (katalog `/home/jerry/ai-risk-agent/`).
- **Kanał "serwerbotgemini"**: Strukturyzowane alerty "Severity: warn / Summary / Suggested actions" to odpowiedzi Gemini 2.0 Flash z GOD MODE (`ai-executor.mjs`). NIE automatyczne — ktoś musi wysłać pytanie lub logi trafiają do Gemini.
- **PM2 vs Cron**: One-shot skrypty (run-and-exit) NIE MOGĄ być PM2 daemons — PM2 restartuje po exit albo pokazuje "stopped". Użyj cron. PM2 = daemons (long-running). Cron = periodic one-shots.
- **prediction-api isMainModule**: `import.meta.url === \`file://${process.argv[1]}\`` failuje pod PM2 (resolving ścieżek). Fix: `if (true)` na serwerze. Plik: `dist/prediction/dashboard-api.js`. **UWAGA:** Ten fix gubi się przy `pm2 delete + pm2 start` — trzeba ponownie edytować plik dist.
- **prediction-api NansenFeatures**: `src/prediction/features/NansenFeatures.ts` — naprawiony mapping: `parsed.data[token]` (nie `parsed.tokens`), `current_longs_usd` (nie `total_long_usd`), bias z `direction`+`boost`. Bez tego 40% wagi modelu (Smart Money) = zero.
- **prediction-api endpointy**: `/predict/:token`, `/predict-all`, `/predict-xgb/:token`, `/verify/:token`, `/weights`, `/features`, `/xgb-status`, `/xgb-features/:token`, `/health`. Tokeny: BTC, ETH, SOL, HYPE, ZEC, XRP, LIT, FARTCOIN (8). Horyzonty: h1, h4, h12, w1, m1 (5). Wagi: SM 40%, tech 20%, momentum 15%, trend 15%, volume 10%.
- **prediction-api PREDICTION_HORIZONS**: Config-driven horyzonty w `HybridPredictor.ts`. confMax maleje (80→30) bo dlugi horyzont = mniej pewnosci. Slope dampened logarytmicznie dla w1/m1.
- **XGBoost data timeline**: w1 etykiety po 7 dniach, m1 po 30 dniach. MIN_SAMPLES: h1-h12=200, w1=100, m1=50. Collector `LABEL_BACKFILL_ROWS=0` (skanuje wszystkie wiersze dla m1 30-day lookback).
- **Nansen channel ID**: `-1003886465029` = "BOT i jego Sygnaly" (prawidłowy). `-1003724824266` = stary/nieistniejący. Bot `@HyperliquidMM_bot` jest administratorem kanału.
- **Porty na serwerze (updated)**: 3000=war-room (8 tokens, 4x2 grid), 8080=nansen-bridge, 8081=mm-bot telemetry (fallback), 8090=prediction-api
- **Raporty na Discord**: hourly (cron :15) = fills/PnL/positions/orders, daily 08:00 UTC = whale positions 41 portfeli, whale changes 3x daily (06/12/18 UTC) = delta zmian pozycji. Wszystkie potrzebują `DISCORD_WEBHOOK_URL` w `.env`. Snapshot zmian: `/tmp/whale_changes_snapshot.json`.
- **sm-short-monitor**: Nansen API 403 "Insufficient credits" — 62% success rate (5165 errors / 8212 successes). Proces działa, częściowo fetchuje dane. Fix wymaga dokupienia kredytów Nansen.
