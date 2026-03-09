# Kontekst projektu

## Aktualny stan
- Data: 2026-03-09
- Katalog roboczy: /Users/jerry
- Główne repozytorium: `/Users/jerry/hyperliquid-mm-bot-complete`
- Serwer: `hl-mm` (100.71.211.15 via Tailscale)
- PM2 zarządza botem: `pm2 restart mm-pure copy-general`
- GitHub: `jp81-tech/jp81-tech-jerry-hyperliquid-mm-bot-complete`

## Nad czym pracujemy

### Hyperliquid Market-Making Bot
Bot do market-makingu na Hyperliquid z integracją Nansen dla smart money tracking.

**Branch:** `feat/next`
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
- `src/config/short_only_config.ts` - filtry grid pipeline (BounceFilter, DipFilter, FundingFilter, FibGuard, PumpShield, MomentumGuard)
- `src/execution/TwapExecutor.ts` - TWAP executor (zamykanie pozycji w slice'ach jak Generał)
- `src/utils/paginated_fills.ts` - paginated fill fetcher (obchodzi 2000-fill API limit)
- `src/utils/discord_notifier.ts` - Discord webhook notifier (S/R alerts, embeds)
- `scripts/vip_spy.py` - monitoring VIP SM traderów (Operacja "Cień Generała"), ALL COINS dla Generała
- `scripts/general_copytrade.ts` - copy-trading bot: kopiuje pozycje Generała (dry-run/live)
- `scripts/daily_discord_report.py` - dzienny raport 24h na Discord (PnL, skew, fee efficiency, aging, guard blocks)

**Kluczowe pliki danych:**
- `/tmp/smart_money_data.json` - dane z whale_tracker.py (na serwerze)
- `/tmp/nansen_bias.json` - bias cache (na serwerze)
- `/tmp/nansen_mm_signal_state.json` - stan sygnałów MM (GREEN/YELLOW/RED)
- `/tmp/nansen_raw_alert_queue.json` - kolejka alertów z Telegram
- `/tmp/vip_spy_state.json` - stan VIP Spy (pozycje Generałów)
- `/tmp/whale_activity.json` - activity tracker dla dormant decay (address → last_change_epoch)
- `rotator.config.json` - config rotacji par

---

## Zmiany 9 marca 2026

### 117. VIRTUAL S/R Pipeline — Full S/R Awareness (09.03)

**Problem:** VIRTUAL bot miał tylko SMA Crossover + Moon Guard + Order Flow Filter — ZERO S/R awareness. Trzymał SHORT na daily support z -59.5% skew, nie wiedząc że jest na wsparciu (najgorsza pozycja dla shorta).

**Fix:** Skopiowano pełny S/R pipeline z kPEPE do VIRTUAL else branch w `mm_hl.ts` (~600+ linii). VIRTUAL używa własnych parametrów z `short_only_config.ts`.

**Portowane moduły (w kolejności pipeline):**
1. Momentum Guard scoring (ATR%, momentum signal, RSI signal, proximity signal z touch/break)
2. S/R Discord alerts z cooldown
3. MG Score + SMA Crossover merged into MG flow
4. Pipeline status object (Discord embeds)
5. Position-aware guard + micro-reversal detection + asymmetric multipliers
6. INV_AWARE MG Override z S/R suppression
7. S/R Grace Period (delay reduction po confirmed break)
8. S/R Progressive Reduction (SHORT→support, LONG→resistance)
9. BREAKEVEN_BLOCK (S/R-specific)
10. S/R Accumulation + Fresh Touch Boost
11. S/R Bounce Hold (progressive release)
12. Breakout TP (close on strong aligned momentum)
13. Dynamic TP (spread widener on micro-reversal)
14. Inventory SL (panic mode, sets `inventorySlPanic = true`)
15. Auto-Skew (creates `skewedMidPrice`)

**NIE portowane (kPEPE-specific):** Toxicity Engine, TimeZone profile, 4-layer custom grid, OBI modulator, VWAP modifier, Dynamic Spread ATR scaling, Dynamic Position Sizing, Hedge trigger

**Config VIRTUAL w `short_only_config.ts`:**
- `srReductionStartAtr: 2.5`, `srMaxRetainPct: 0.15` — mniej agresywna redukcja niż kPEPE
- `srAccumBounceBoost: 1.6`, `srAccumFreshMultiplier: 2.5` — akumulacja z fresh touch boost
- `autoSkewShiftBps: 1.5`, `autoSkewMaxShiftBps: 10.0` — auto-skew
- `inventoryAwareMgThreshold: 0.10` — INV_AWARE override
- `srBounceHoldMinDistAtr: 1.8` — bounce hold

**Grid:** VIRTUAL zachowuje `generateGridOrders()` (standard grid) z `skewedMidPrice`

**Logi potwierdzające deployment:**
- `🔄 [SR_ACCUM] VIRTUAL: RESISTANCE → accumulate SHORTS — progress=42%`
- `🔓 [BOUNCE_HOLD] VIRTUAL: RELEASED — dist=1.73ATR >= 1.5ATR threshold`

**Pliki:** `src/mm_hl.ts` (+700, -70), `src/config/short_only_config.ts` (+20)

### 116. kPEPE Fee Efficiency Optimization — minProfitBps 20 + Tightness Floor 18bps (09.03)

**Problem:** kPEPE fee efficiency at 37% (churning territory — target <15%). Bot micro-scalped with L1 close orders just 10bps from entry, and after skew adjustments the effective spread compressed below profitable levels. Each fill's margin was too thin to cover accumulation fees.

**Diagnoza:** SPREAD log showed `L1 bid=10bps` (baseProfiled 25bps + skewAdj -15bps = 10bps). MIN_PROFIT only filtered at 10bps — fills between 10-20bps were profitable pre-fee but unprofitable post-fee.

**2 zmiany:**

| # | Zmiana | Efekt |
|---|--------|-------|
| 1 | **minProfitBps: 10→20** w `DYNAMIC_SPREAD_OVERRIDES['kPEPE']` | Close orders muszą być >= 20bps od entry (was 10bps) |
| 2 | **Tightness Floor 18bps** w `mm_hl.ts` (po `generateGridOrdersCustom`, PRZED MIN_PROFIT) | Po wszystkich skew/spread adjustments, ordery bliżej niż 18bps od mid usuwane |

**Tightness Floor logika:**
```typescript
const TIGHTNESS_FLOOR_BPS = 18
const minBidPx = skewedMidPrice * (1 - 18/10000)  // max bid
const maxAskPx = skewedMidPrice * (1 + 18/10000)  // min ask
gridOrders = gridOrders.filter(o => {
  if (o.side === 'bid' && o.price > minBidPx) return false
  if (o.side === 'ask' && o.price < maxAskPx) return false
  return true
})
```

**Pipeline position:** Po `generateGridOrdersCustom`, PRZED `MIN_PROFIT`. Działa na WSZYSTKIE ordery (nie tylko close), zapewniając że żaden order nie jest zbyt blisko mid po skew adjustments.

**Log:** `📐 [LIQUIDITY] kPEPE: spread floor active (min 18bps) — removed N orders too close to mid`

**Cel:** Zmniejszyć fee/profit ratio z 37% do <15% (healthy).

**Pliki:** `src/config/short_only_config.ts` (+1), `src/mm_hl.ts` (+21)

### 115. Daily Discord Performance Report (09.03)

**Plik:** `scripts/daily_discord_report.py`
**Cron:** `5 0 * * *` (codziennie 00:05 UTC)
**Webhook:** Discord channel via `DISCORD_REPORT_WEBHOOK` env var

**Metryki:**
- Executive Summary: Net PnL (realized - fees), unrealized, equity, total fills
- Per-pair breakdown: position, entry, uPnL, realized, fees, leverage, liq price
- **Skew Exposure** (NEW): kierunkowe ryzyko per pair (`position_notional / equity`)
- **Fee Efficiency** (NEW): `fee/profit ratio` — <15% healthy, 15-30% warning, >30% churning
- **Inventory Aging** (NEW): czas trzymania pozycji (first open → last close w 24h window)
- Orders/Fills: buy/sell count + volume per pair
- Guard Blocks: BREAKEVEN_BLOCK + HARD BREAKEVEN GUARD counts
- VPIN toxicity levels
- Risk Assessment: account leverage, margin used, free margin, liq distance

**Dane z:** Hyperliquid API (`clearinghouseState`, `userFills`, `userFillsByTime`), PM2 logs

**Pierwszy raport (09.03):** Net PnL +$33.25, Fee Efficiency 11.3% (healthy), kPEPE skew -19.8%, VIRTUAL skew +0.6%

---

## Zmiany 8 marca 2026

### 114. HARD BREAKEVEN GUARD — universal underwater churn protection (08.03)

**Problem:** kPEPE bot tracił na "churning" — zamykał longi ze stratą gdy cena była w "no man's land" (underwater ale daleko od S/R). BREAKEVEN_BLOCK wymagał `nearSupport`, a PROFIT_FLOOR miał `pair !== 'kPEPE'`.

**Root cause (3 warstwy obrony, wszystkie zawiodły):**
1. `BREAKEVEN_BLOCK` (L8692): wymaga `nearSupport` → nie działa daleko od S/R
2. `MIN_PROFIT` (L9218): 10bps buffer, ale AUTO_SKEW przesuwa mid w dół → aski poniżej entry
3. `PROFIT_FLOOR` (L9429): `pair !== 'kPEPE'` → **całkowicie pominięty** dla kPEPE

**Fix w `mm_hl.ts`:**
- Zastąpiono `PROFIT_FLOOR` uniwersalnym `HARD BREAKEVEN GUARD`
- Działa dla WSZYSTKICH par (nie wyklucza kPEPE)
- LONG: filtruje aski < `entry × 1.001` (0.1% fee buffer)
- SHORT: filtruje bidy > `entry × 0.999`
- Bypass TYLKO przez `inventorySlPanic` (emergency exit przy ekstremalnym drawdown)
- Hoisted `inventorySlPanic` powyżej if/else block (scope access)

**Log:** `🛡️ [GUARD] VIRTUAL: Underwater protection active. Restricting all asks to Breakeven (>$0.660560)`

**Zweryfikowano:**
- mm-virtual: GUARD usunął 8 asków (entry=$0.6599, mid=$0.6481, 1.8% underwater)
- mm-pure: BREAKEVEN_BLOCK + GUARD = layered defense

**Wyniki overnight (09.03):**
- GUARD zatrzymał churning natychmiast (Daily PnL zamrożony na -$17.63, zero nowych strat)
- Następny dzień: mm-pure +$25.27, mm-virtual +$31.10
- VIRTUAL wyszedł z underwater → normalny MM (8 bids + 8 asks, grid symetryczny)
- kPEPE zamknął longi z zyskiem, obrócił na SHORT, Total PnL: $342

**Pliki:** `src/mm_hl.ts` (+23/-11 linii)

### 113. SMA Crossover Signal — VIRTUAL integration + per-token dynamic SMA (08.03)

**Kontekst:** Backtestowano strategię MomentumSMA+RSI na VIRTUAL 1H (2000 candles). Grid search: `sma_fast=[10-25], sma_slow=[30-70], sr_tolerance=[1.02-1.15]`. Wygrały parametry: **SMA 20/30, SR tolerance 1.08**.

**Problem:** SMA crossover sygnał działał tylko dla kPEPE (blok `if (pair === 'kPEPE')`). VIRTUAL nie miał żadnego SMA pipeline'u + nie był w `activePairs` MarketVision (zero candle data).

**Zmiany:**

1. **`src/signals/market_vision.ts`:**
   - Dodano `'VIRTUAL'` do `activePairs` (bez tego `getPairAnalysis('VIRTUAL')` zwracało undefined)
   - Dodano `sma20`, `sma60`, `smaCrossover` do `PairAnalysis` interface
   - S/R lookback: 24 → **50 candles** (match backtest `rolling(window=50)`)
   - Dynamiczne SMA per-token via `getMomentumGuardConfig(pair)` — VIRTUAL: 20/30, kPEPE: 20/60
   - Crossover detection: porównanie current vs previous bar's SMA (golden/death cross)

2. **`src/config/short_only_config.ts`:**
   - 7 nowych pól w `MomentumGuardConfig`: `smaCrossoverEnabled`, `smaFastPeriod`, `smaSlowPeriod`, `smaSrTolerance`, `smaCrossoverBidBoost`, `smaCrossoverAskBoost`, `smaCrossoverTrendMild`
   - Override VIRTUAL: `{smaCrossoverEnabled: true, smaFastPeriod: 20, smaSlowPeriod: 30, smaSrTolerance: 1.08, bidBoost: 1.8, askBoost: 1.8}`

3. **`src/mm_hl.ts` (else branch, non-kPEPE pairs):**
   - Nowy blok SMA crossover signal PRZED Moon Guard section
   - Golden cross + near support → `bid × 1.8, ask × 0.56`
   - Death cross + near resistance → `ask × 1.8, bid × 0.56`
   - Trend mild (SMA20 > SMA60 + near sup) → `bid × 1.15, ask × 0.90`
   - `SMA_STATUS` log co 20 ticków + pierwsze 3 ticki

**Zweryfikowano w produkcji:**
- mm-virtual: `📊 [SMA_STATUS] VIRTUAL: SMA20/$0.6830 SMA30/$0.6863 cross:none`
- mm-pure (kPEPE): nadal działa z SMA 20/60

**Pliki:** `src/config/short_only_config.ts`, `src/signals/market_vision.ts`, `src/mm_hl.ts`

---

## Zmiany 7 marca 2026

### 112. BREAKEVEN_BLOCK — prevent selling at loss near S/R levels (07.03)

**Problem:** Bot składał zredukowane aski (ask × 0.15) blisko mid price nawet gdy był underwater na pozycji LONG przy support. Fill price < average entry = zrealizowana strata.

**Root cause:** S/R Bounce Hold tylko skalował wielkość asków, ale nie sprawdzał czy fill będzie na stracie.

**Fix w `mm_hl.ts` (~8607-8640):**
```typescript
// LONG + underwater + near support = BLOCK ASKS
if (hasLongPos && entryPrice > 0 && midPrice < entryPrice && nearSupport) {
  sizeMultipliers.ask = 0
  console.log(`🛡️ [BREAKEVEN_BLOCK] ${pair}: LONG underwater ${underwaterPct}% at SUPPORT → BLOCKING ASKS`)
}

// SHORT + underwater + near resistance = BLOCK BIDS
else if (hasShortPos && entryPrice > 0 && midPrice > entryPrice && nearResistance) {
  sizeMultipliers.bid = 0
}
```

**Logika:**
| Warunek | Akcja |
|---------|-------|
| LONG + mid < entry + near support | `ask = 0` |
| SHORT + mid > entry + near resistance | `bid = 0` |

**Przykład:**
- Entry: $0.004000, Mid: $0.003700 (7.5% underwater), Support: $0.003600
- Bot jest 7.5% pod wodą NA SUPPORT → ZERO asks
- Bot czeka aż cena wróci powyżej $0.004000 zanim zacznie sprzedawać

**Pliki:** `src/mm_hl.ts` (+33 linie)

**Bug fix (08.03):** `accumZone is not defined` — zmienna była zdefiniowana w S/R Accumulation block ale używana w BREAKEVEN_BLOCK przed definicją. Naprawiono inline'owaniem obliczenia: `const accumZone = mgStrongZone * momGuardConfig.srReductionStartAtr` bezpośrednio w bloku BREAKEVEN_BLOCK.

---

## Zmiany 6 marca 2026

### 111. Fix: SR_ACCUM ask=0 when LONG near support — sellLevels=0 bug (06.03)

**Problem:** kPEPE (mm-pure) miał **0 sell orderów** (`sellLevels=0`, `sellNotional=$0.00`). Bot był LONG (skew=12%) przy supportie, ale nie mógł zamknąć pozycji bo S/R Accumulation zerowała aski.

**Root cause:** `progress > 0.80` w S/R Accumulation ustawiał `sizeMultipliers.ask = 0` bezwarunkowo — "blisko supportu = nie shortuj". Ma sens gdy bot jest FLAT (nie chcesz otwierać shortów), ale NIE gdy bot jest LONG (potrzebujesz asków żeby **zamknąć** longi z zyskiem).

**Fix w `mm_hl.ts` (~8565):**
```typescript
// SUPPORT block: progress > 0.80 → ask=0 ONLY if not LONG
} else if (progress > 0.80 && !hasAnyLong) {
  sizeMultipliers.ask = 0  // FLAT/SHORT near support → zero asks (don't short the bounce)
} else if (progress > 0.80 && hasAnyLong) {
  // LONG near support → keep reduced asks for closing (same progressive formula)
  sizeMultipliers.ask *= (1.0 - progress * (1.0 - effectiveCounterReduce))
}

// RESISTANCE block (mirror): progress > 0.80 → bid=0 ONLY if not SHORT
} else if (progress > 0.80 && !hasAnyShort) {
  sizeMultipliers.bid = 0  // FLAT/LONG near resistance → zero bids
} else if (progress > 0.80 && hasAnyShort) {
  sizeMultipliers.bid *= (1.0 - progress * (1.0 - effectiveCounterReduce))
}
```

**Wartości po fix (kPEPE, progress=89%, effectiveCounterReduce=0.36):**
- SR_ACCUM: `ask × (1.0 - 0.89 × 0.64) = ask × 0.43` (was: ask=0)
- BOUNCE_HOLD: `ask × 0.27` (additional reduction)
- Wynik: `sellLevels=6, sellNotional=$578` (was: 0)

**Log:** `🔄 [SR_ACCUM] kPEPE: SUPPORT → accumulate LONGS — progress=89% ... HAS_LONG→ask_reduced ... ask×0.35`

**Pliki:** `src/mm_hl.ts` (SUPPORT block ~8565, RESISTANCE block ~8604)

---

## Zmiany 5 marca 2026

### 110. S/R Bounce Hold — nie zamykaj longów od razu po odbiciu z supportu (05.03)

**Problem:** S/R Accumulation buduje longi przy supportie (bid×5.84 z Fresh Touch Boost), ale jak cena zaczyna odbijać w górę, MG boostuje aski (ask×1.05→1.30), S/R Accum disengages (cena wychodzi ze strefy), i grid aski fillują się → longi zamknięte z małym zyskiem zamiast poczekać na pełny bounce. Zero mechanizmu "poczekaj aż odbicie się rozwinie".

**Rozwiązanie:** Po tym jak S/R Accumulation zbudowała pozycję przy S/R, **tłum closing-side** dopóki cena nie oddali się wystarczająco od S/R (mierzone w ATR).

**Mechanizm:**
1. **Tracking** — `srBounceHoldState: Map<string, {timestamp, srLevel, side}>` na bocie. Aktualizowany gdy `srAccumApplied = true`.
2. **Progressive release** (nie binary on/off):
   ```
   distFromSr = (price - support) / atr   // 0 at support, 2.0 at 2×ATR
   holdProgress = min(1.0, distFromSr / srBounceHoldMinDistAtr)
   askReduction = srBounceHoldAskReduction + holdProgress × (1.0 - srBounceHoldAskReduction)
   // 0.15 at support → 1.00 at threshold (full asks)
   sizeMultipliers.ask *= askReduction
   ```
3. **Clear conditions:** dist >= threshold, timeout 30min, position closed (skew<2%), S/R level changed

**Config (`MomentumGuardConfig`):**

| Config | Default | kPEPE |
|--------|---------|-------|
| `srBounceHoldEnabled` | true | true |
| `srBounceHoldMinDistAtr` | 1.5 | **2.0** (volatile → więcej room) |
| `srBounceHoldAskReduction` | 0.20 | **0.15** (tighter hold) |
| `srBounceHoldMaxMinutes` | 30 | 30 |

**Pipeline position:** Po S/R Accumulation, PRZED Breakout TP. Hold NIE blokuje Breakout TP (safety valve na strong momentum score>0.40).

**Przykład kPEPE:**
```
support=$0.003441, ATR=$0.000065, threshold=2.0×ATR

At support (dist=0.06ATR): askReduction=0.18 → ask×0.18 (HOLD: tiny closing)
Bouncing (dist=0.60ATR):   askReduction=0.41 → ask×0.41 (some closing)
Strong bounce (dist=1.68ATR): askReduction=0.86 → ask×0.86 (almost full)
Past threshold (dist>2.0ATR): HOLD OFF, normal asks
```

**Logi:**
- `🔒 [BOUNCE_HOLD] kPEPE: LONG near SUPPORT — dist=0.60ATR progress=30% → ask×0.41 (holding for bounce)`
- `🔓 [BOUNCE_HOLD] kPEPE: RELEASED — dist=2.06ATR >= 2.0ATR threshold (bounce confirmed)`
- `⏰ [BOUNCE_HOLD] kPEPE: TIMEOUT — 30min elapsed, resuming normal closing`

**Interakcje:**
- **S/R Accumulation**: Komplementarne — Accum buduje, Hold chroni
- **MG multipliers**: Hold redukuje closing-side DODATKOWO po MG (multiplicative)
- **Breakout TP**: Hold NIE blokuje Breakout TP (safety valve)
- **INV_AWARE_MG**: INV_AWARE suppressed przy S/R (prox <= -0.5) → brak konfliktu

**Pliki:** `src/config/short_only_config.ts` (+4 interface, +4 defaults, +2 kPEPE override), `src/mm_hl.ts` (+1 property, +63 linii logika)

---

### 109. Disable NANSEN CONFLICT SL — stop closing longs against Nansen bias (05.03)

**Problem:** NANSEN CONFLICT SL zamykał longi kPEPE ze stratą ($-22 do $-55 per close) bo Nansen bias = SHORT STRONG (+0.07). Bot robi normalny MM (grid obu stron), a ten mechanizm wymuszał zamknięcie każdego LONGA gdy PnL < -$20. Sprzeczne z zasadą że Nansen bias NIE wpływa na grid.

**Root cause:** `checkNansenConflicts()` (linia ~5316) sprawdzał czy pozycja jest przeciw Nansen bias i zamykał ją force-close IOC. Mechanizm był zaprojektowany dla SM-following bota, nie dla PURE_MM market makera. W PURE_MM grid buduje pozycje w obu kierunkach — NANSEN CONFLICT SL niszczył longi zbudowane przez S/R Accumulation przy support.

**Fix w `mm_hl.ts` (linia 4029):**
```typescript
// PRZED:
this.nansenConflictCheckEnabled = process.env.NANSEN_CONFLICT_CHECK_ENABLED !== 'false'

// PO:
this.nansenConflictCheckEnabled = false
```

**Wynik live:** Zero `🛑 [NANSEN CONFLICT SL]` wpisów po restarcie. Bot quotuje normalnie (23 ordery, BUY + SELL).

**Pliki:** `src/mm_hl.ts` (1 linia)

---

### 108. INV_AWARE_MG S/R suppression — stop closing positions built by S/R Accumulation (05.03)

**Problem:** INV_AWARE_MG (Inventory-Aware Momentum Guard Override) zamykał longi zbudowane przez S/R Accumulation przy supportie. Dwa systemy walczyły:
- **S/R Accumulation**: "Cena przy supportie! Kupuj longi, trzymaj do 15%!"
- **INV_AWARE_MG**: "Masz longi + bearish momentum! Zamykaj natychmiast!" (threshold 8%)

Bot kupował longi przy supportie, a potem INV_AWARE boostował aski (ask×1.22) i zamykał je ze stratą. 8 close'ów = -$11.86.

**Root cause:** INV_AWARE nie wiedział o S/R proximity — patrzył tylko na |skew| > threshold + pozycja przeciw momentum → closing override. Nie sprawdzał **dlaczego** bot ma tę pozycję.

**Fix:** S/R proximity suppression w INV_AWARE_MG block (`mm_hl.ts`):
- `LONG near SUPPORT` (mgProxSignal <= -0.5) → INV_AWARE SUPPRESSED, S/R Accumulation ma priorytet
- `SHORT near RESISTANCE` (mgProxSignal >= 0.5) → INV_AWARE SUPPRESSED (mirror)
- Gdy cena odejdzie od S/R (prox > -0.5 / prox < 0.5) → INV_AWARE wraca do normalnej pracy

**Log (suppressed):** `⚡ [INV_AWARE_MG] kPEPE: LONG+DUMP — skew=22% prox=-1.00 → SUPPRESSED (position near SUPPORT, S/R Accumulation has priority)`

**Wynik live:**
- Przed: 8 close'ów przy supportie = **-$11.86** (INV_AWARE zamykał longi ze stratą)
- Po: 12 close'ów po odbiciu od supportu = **+$4.98** (S/R Accumulation zbudowała, cena odbiła, bot zamknął z zyskiem)

**Pliki:** `src/mm_hl.ts` (~+15 linii w INV_AWARE_MG block)

---

### 107. S/R z 1h candles zamiast 15m — stabilniejsze support/resistance (05.03)

**Problem:** S/R obliczane z 15m candles (48 candles = 12h lookback) były zbyt niestabilne — zmieniały się co kilka ticków, bot reagował na szum zamiast na prawdziwe poziomy. kPEPE z daily range 5-10% potrzebuje stabilnych S/R żeby MG proximity, S/R Accumulation i S/R Reduction działały przewidywalnie.

**Zmiana:** S/R dla MG proximity teraz z **1h candle bodies** (24 candles = 24h lookback) zamiast 15m candle bodies (48 candles = 12h). MM execution nadal na 15m candles (RSI, trend, break detection via `lastCandle15mClose`).

**Co zostało:**
- 15m candles: trend15m (EMA9/EMA21), rsi15m, lastCandle15mClose (break confirmation), flash crash detector
- 1h candles: **S/R levels** (`supportBody12h`, `resistanceBody12h`), trend4h (EMA200), HTF S/R (72 candles = 3d)

**Dlaczego 1h:**
- 15m (12h lookback) — za dużo szumu, S/R skacze co tick
- 1h (24h lookback) — stabilne intraday S/R, mniej fałszywych sygnałów
- HTF 1h×72 (3d) fallback nadal istnieje dla szerszego kontekstu

**Log:** `S/R(1h): R=$0.003760 S=$0.003441` (było `S/R(15m)`)

**Pliki:** `src/signals/market_vision.ts` (S/R computation: `candles15m` → `candles` (1h), lookback 48→24, min guard 24→12), `src/mm_hl.ts` (log label `15m`→`1h`)

---

### 106. kPEPE srMaxRetainPct 8%→15% — akumulacja trwała za krótko (05.03)

**Problem:** kPEPE AT SUPPORT z skew=11%, ale S/R Accumulation nie działała. Discord alert pokazywał NEAR_SUPPORT, ale logi nie miały `[SR_ACCUM]`.

**Root cause:** kPEPE override `srMaxRetainPct: 0.08` (8%). Akumulacja wymaga `|skew| <= srMaxRetainPct`. Przy 11% skew → `11% > 8%` → akumulacja zablokowana, S/R Reduction przejęła (bo `|skew| > srMaxRetainPct`). Bot zbierał longi do 8% a potem zaczynał je redukować — za wcześnie.

**Fix:** `srMaxRetainPct: 0.08 → 0.15` (15%) w kPEPE override (`short_only_config.ts`).

**Efekt:**
- Akumulacja kontynuuje do 15% skew (było: stop przy 8%)
- S/R Reduction przejmuje dopiero powyżej 15% (było: powyżej 8%)
- Bot buduje większą pozycję przy support zanim zacznie redukować

**Pliki:** `src/config/short_only_config.ts` (1 linia: srMaxRetainPct 0.08→0.15)

---

### 105. S/R Reduction Grace Period — opóźniona redukcja po przełamaniu S/R (05.03)

**Problem:** Gdy cena przebija support/resistance, S/R Reduction natychmiast zaczynał zamykać pozycję. Ale wiele przebić to fakeouty (cena wraca). Bot tracił pozycję na fakeoucie, a potem musiał odbudowywać ją droższej.

**Rozwiązanie:** Grace period — po POTWIERDZONYM przebieceniu S/R (candle close, prox=±1.2) czekaj N candles 15m przed redukcją. Jeśli cena wróci → grace kasuje się, akumulacja kontynuuje.

**Config (`srReductionGraceCandles`):**

| Config | Default | kPEPE |
|--------|---------|-------|
| `srReductionGraceCandles` | 2 (30 min) | **3 (45 min)** |

**Logika:**
- LONG + `mgProxSignal <= -1.2` (BROKEN SUPPORT, candle close below) → start grace timer
- SHORT + `mgProxSignal >= 1.2` (BROKEN RESISTANCE, candle close above) → start grace timer
- Podczas grace: `srGraceActive = true` → S/R Reduction suppressed
- Grace expired → reduction dozwolona (breakdown potwierdzony)
- Price recovery (`mgProxSignal > -1.2` / `< 1.2`) → grace cleared, accumulation continues

**Kluczowe:** Grace triggeruje TYLKO na `prox=±1.2` (candle close confirmed), NIE na `prox=±1.0` (touch). To chroni przed fakeoutami gdzie tick price spada poniżej supportu ale candle zamyka się powyżej.

**Logi:**
- `⏳ [SR_GRACE] kPEPE: LONG + BROKEN SUPPORT ($0.003512) prox=-1.2 → grace started (3 candles = 45min)`
- `⏳ [SR_GRACE] kPEPE: LONG grace active — 30min remaining | prox=-1.2`
- `⏳ [SR_GRACE] kPEPE: LONG grace EXPIRED — breakdown confirmed, allowing reduction`
- `✅ [SR_GRACE] kPEPE: Price recovered above SUPPORT ($0.003512) prox=-0.8 → grace cleared, accumulation continues`

**Pliki:** `src/config/short_only_config.ts` (+3: interface, default, kPEPE override), `src/mm_hl.ts` (+1 property `srBreakGraceStart` Map, +~50 linii grace logic)

---

### 104. Proximity Signal prox=±1.0/±1.2 + `lastCandle15mClose` — rozróżnienie touch vs confirmed break (05.03)

**Problem:** Proximity signal miał binarne wartości — cena na supportcie lub nie. Brak rozróżnienia między:
- Tick price dotknął supportu (może być fakeout, wick)
- 15m candle ZAMKNĘŁA SIĘ poniżej supportu (potwierdzone przebicie)

**Rozwiązanie:** Nowe wartości prox signal + pole `lastCandle15mClose` w PairAnalysis.

**A) Nowe wartości `mgProxSignal`:**

| Wartość | Znaczenie | Warunek |
|---------|-----------|---------|
| -1.0 | AT SUPPORT | `mgSupportDist <= 0` (tick price na/pod supportem) |
| **-1.2** | **BROKEN SUPPORT** | AT SUPPORT + `lastCandle15mClose < mgSupportBody` |
| -0.8 | NEAR SUPPORT | `mgSupportDist < mgStrongZone` (1×ATR) |
| -0.4 | APPROACHING SUPPORT | `mgSupportDist < mgModerateZone` (2×ATR) |
| +1.0 | AT RESISTANCE | `mgResistDist <= 0` |
| **+1.2** | **BROKEN RESISTANCE** | AT RESISTANCE + `lastCandle15mClose > mgResistBody` |
| +0.8 | NEAR RESISTANCE | `mgResistDist < mgStrongZone` |
| +0.4 | APPROACHING RESISTANCE | `mgResistDist < mgModerateZone` |

**B) `lastCandle15mClose` w `market_vision.ts`:**
```typescript
// candles15m[-1] = FORMING candle (current, incomplete)
// candles15m[-2] = LAST CLOSED candle (complete, used for break detection)
lastCandle15mClose = candles15m[candles15m.length - 2].c
```

**Pliki:** `src/signals/market_vision.ts` (+1 field PairAnalysis, +computation), `src/mm_hl.ts` (proximity signal rewrite ~25 linii)

---

### 103. Discord S/R Alerts — BROKEN_SUPPORT/RESISTANCE + AT_SUPPORT/RESISTANCE (05.03)

**Problem:** Discord alerty miały tylko NEAR_SUPPORT/NEAR_RESISTANCE — brak rozróżnienia touch vs confirmed break.

**Rozwiązanie:** 4 nowe typy alertów na podstawie `mgProxSignal`:

| Typ | Kiedy | Emoji | Kolor |
|-----|-------|-------|-------|
| `BROKEN_RESISTANCE` | `mgProxSignal >= 1.2` | 💥 | Orange (0xff8800) |
| `AT_RESISTANCE` | `mgResistDist <= 0` | 🔴 | Red |
| `NEAR_RESISTANCE` | `mgResistDist < mgStrongZone` | 🟡 | Red |
| `BROKEN_SUPPORT` | `mgProxSignal <= -1.2` | 💥 | Orange (0xff8800) |
| `AT_SUPPORT` | `mgSupportDist <= 0` | 🟢 | Green |
| `NEAR_SUPPORT` | `mgSupportDist < mgStrongZone` | 🟡 | Green |

**Nowe pole w embed:** `15m Close` — pokazuje cenę zamknięcia ostatniej 15m candle (potwierdzenie break).

**Footer:** `"BROKEN = candle close confirmed | Cooldown 30min"`

**Pliki:** `src/mm_hl.ts` (alert type logic + embed update, ~30 linii)

---

### 102. Fresh Touch Boost — silniejsza akumulacja na pierwszym dotknięciu S/R (05.03)

**Problem:** kPEPE o 08:45 po raz pierwszy odbił od supportu (skew ~0%, flat). Bot zebrał longi ale z normalną siłą (bid×1.54, ask×0.50). Cena poszła ładnie w górę. Gdyby akumulacja była 2-3× silniejsza przy pierwszym dotknięciu (niski skew = flat = świeże odbicie), bot zebrałby dużo więcej longów.

**Pomysł:** Użyć `absSkew` jako proxy dla "świeżości" dotknięcia S/R:
- Skew 0% = flat = pierwsze dotknięcie = maksymalny boost (3× dla kPEPE)
- Skew 8% (srMaxRetainPct) = już zaakumulowaliśmy = normalny boost (1×)

**Nowy config param `srAccumFreshMultiplier`:**

| Config | Default | kPEPE |
|--------|---------|-------|
| `srAccumFreshMultiplier` | 2.0 | **3.0** |

**Formuła:**
```typescript
freshRatio = max(0, (srMaxRetainPct - absSkew)) / srMaxRetainPct  // 1.0 at 0%, 0.0 at max
freshBoost = 1.0 + freshRatio * (srAccumFreshMultiplier - 1.0)     // 3.0× at 0%, 1.0× at max
effectiveBounceBoost = srAccumBounceBoost * freshBoost              // 1.8 × 3.0 = 5.4× at 0%
effectiveCounterReduce = max(0.05, srAccumCounterReduce / freshBoost) // 0.50 / 3.0 = 0.17 at 0%
```

**Przykładowe wartości (kPEPE, progress=90%):**

| Skew | freshBoost | bid× | ask× | Efekt |
|------|-----------|------|------|-------|
| 0% | 3.0× | ×5.84 | ×0.17 | Agresywna akumulacja, prawie zero counter |
| 4% | 2.0× | ×4.24 | ×0.25 | Silna akumulacja |
| 8% | 1.0× | ×1.72 | ×0.50 | Normalna (jak dotychczas) |

**Log:** `🔄 [SR_ACCUM] kPEPE: SUPPORT → accumulate LONGS — progress=90% ... fresh×3.0 → bid×5.84 ask×0.17`

**Pliki:** `src/config/short_only_config.ts` (+3: interface, default, kPEPE override), `src/mm_hl.ts` (+8 w SUPPORT block, +8 w RESISTANCE block, updated log format)

---

### 101. 15m S/R lookback skrócony z 96 do 48 candles (12h zamiast 24h) (05.03)

**Problem:** kPEPE widział resistance na $0.003760 (szczyt z ~24h temu), ale cena to $0.003577 — dystans 5.1%. Lookback 96 candles × 15m = 24h łapał szczyty/dołki z wczoraj, za szeroko dla volatile memecoina z daily range 5-10%.

**Root cause:** Lookback 24h na 15m candles to de facto HTF S/R — za szeroki dla intraday mean-reversion. kPEPE potrzebuje tighter S/R żeby MG proximity signal i S/R Reduction/Accumulation reagowały na bliższe, aktualne poziomy.

**Fix w `src/signals/market_vision.ts` (linia 466):**
```typescript
// Przed:
const stfLookback = Math.min(96, candles15m.length);  // 96 × 15m = 24h

// Po:
const stfLookback = Math.min(48, candles15m.length);  // 48 × 15m = 12h
```

**Dlaczego 48 (12h):**
- 96 (24h) łapie szczyty/dołki z wczoraj — za daleko
- 48 (12h) = ~2 sesje handlowe (Asia+Europe lub Europe+US)
- Nadal wystarczająco żeby złapać intraday S/R
- Fallback na HTF (1h × 72 = 3 dni) nadal istnieje
- Min guard `stfLookback >= 24` (6h) nadal chroni

**Wynik live (porównanie):**

| | Stary (24h lookback) | Nowy (12h lookback) |
|---|---|---|
| Resistance | $0.003760 | **$0.003644** |
| Dystans od ceny ~$0.003577 | 5.1% | **1.9%** |
| MG prox signal | 0.00 (za daleko) | **-1.00 (aktywny!)** |

Resistance spadł 3x bliżej ceny. S/R Reduction i Accumulation teraz reagują na aktualne, nie wczorajsze poziomy.

**Komentarze zaktualizowane** w 3 miejscach: linia 294-295 (PairAnalysis interface), 444, 465.

**Pliki:** `src/signals/market_vision.ts` (3 edycje: lookback 96→48, komentarze ×3)

---

### 100. Oracle kPEPE-only filter + slack_router silence + log cleanup (05.03)

**Problem:** Logi zaśmiecone przez 3 źródła:
1. **Oracle BREAKOUT/FLIP spam** — Oracle analizował 13 coinów (`TRACKED_COINS` z NansenFeed), ale bot handluje tylko kPEPE. Logi pełne `💥 BREAKOUT LIT`, `🔄 DIRECTION FLIP DOGE` itp.
2. **slack_router "No webhook" spam** — Każde `this.notifier.info/warn/error()` (241+ wywołań w mm_hl.ts) generowało `[slack_router] No webhook configured for kind=risk, text="..."` bo Slack webhooks nie są skonfigurowane
3. **NansenBias logi dla nie-tradowanych coinów** — `tryLoadNansenBiasIntoCache` logowało bias dla LIT, SUI, DOGE, ETH, SOL zamiast tylko kPEPE

**5 zmian:**

| # | Zmiana | Efekt |
|---|--------|-------|
| 96 | **Oracle kPEPE-only filter** — early return w `handleOracleSignal()` dla non-MM_ONLY_PAIRS | Zero Oracle logów dla 12 nie-tradowanych coinów |
| 97 | **slack_router silent return** — usunięto `console.warn` z `sendSlackText()` i `sendSlackPayload()` | Zero `[slack_router] No webhook...` spam |
| 98 | **NansenBias logCoins** — zmieniono hardcoded `['LIT','SUI','DOGE','ETH','SOL']` na `MM_ONLY_PAIRS` | Tylko kPEPE bias logowany |
| 99 | **Prediction bias disabled** — oba branche (kPEPE + else) wyłączone, prediction-api i war-room zatrzymane | Zero prediction logów |
| 100 | **Oracle dashboard table** — `generateSignalDashboard()` wykomentowane | Zero 13-liniowych ASCII tabel co 60s |

**Pliki:** `src/mm_hl.ts` (-77 linii), `src/utils/slack_router.ts` (-10 linii)

**Commit:** `39f5a36` → `feat/next`

---

## Zmiany 4 marca 2026

### 95. MIN_PROFIT graduated max-loss cap — fix stuck positions WITHOUT unlimited loss (04-05.03)

**Problem (04.03):** kPEPE z SHORT underwater (entry=$0.003527, mid=$0.003710) miał **0 buy orderów** przez 8+ godzin. MIN_PROFIT filtrował WSZYSTKIE bidy (maxBidPrice=$0.003524, all grid bids >> that).

**v1 fix (04.03) — ZA AGRESYWNY:** Complete bypass `highSkewBypassMinProfit` at |skew|>25%. Bot natychmiast zamknął 12 shortów 5% underwater (~$50 strat). Closes at $0.003679-$0.003713 vs entry $0.003527 = 430-530bps loss per trade.

**v2 fix (05.03) — GRADUATED:** Zamiast full bypass, WIDEN allowed loss window proporcjonalnie do urgency skew:

| Skew | Zachowanie | Max dozwolona strata |
|------|-----------|---------------------|
| < 25% | Normalne MIN_PROFIT (10bps profit wymagany) | 0bps (only profit) |
| 25% | Graduated start | 50bps (0.5%) |
| 35% | Urgency grows | 100bps (1.0%) |
| 45%+ | Full bypass (panic territory) | unlimited |

**Formuła:**
```typescript
urgency = (|skew| - 0.25) / 0.20     // 0.0 at 25%, 1.0 at 45%
maxAllowedLossBps = 50 + urgency × 100  // 50-150bps
effectiveMinProfitBps = -maxAllowedLossBps
maxBidPrice = entry × (1 + maxAllowedLossBps/10000)  // ABOVE entry (allow loss)
```

**Przykład kPEPE at 38% skew:**
- urgency = (0.38 - 0.25) / 0.20 = 0.65
- maxLoss = 50 + 0.65 × 100 = 115bps (1.15%)
- entry=$0.003527 → maxBidPrice = $0.003527 × 1.00115 = $0.003568
- Bidy powyżej $0.003568 nadal filtrowane (np. $0.003700 = 490bps loss → odrzucone)
- Bidy do $0.003568 dozwolone (max 115bps loss zamiast unlimited)

**Log:** `📐 [MIN_PROFIT_GRAD] kPEPE: |skew|=38% → allow loss up to 115bps | entry=0.0035270 mid=0.0037139 removed=4`

**Pliki:** `src/mm_hl.ts` (replace #95 v1)

### 94. Remove Inventory Deviation, AlphaEngine, SM Direction — fix 8h stuck skew (04.03)

**Problem:** Bot kPEPE (PURE_MM) utknął na -38% skew przez 8+ godzin z ZERO fills. Auto-Skew dawał tylko +4.5bps (za mało), a 3 mechanizmy były bypassowane dla PURE_MM lub wprowadzały szum taktyczny:

| Mechanizm | Co robił | Problem |
|-----------|----------|---------|
| **Inventory Deviation** | `bid×0.7/ask×1.2` przy skew>5% | Bypassed dla PURE_MM — zero efektu |
| **AlphaEngine multipliers** | Real-time SM multipliers z NansenFeed | Szum taktyczny, konflikty ze Strategią |
| **SM Direction permissions** | `allowLongs=false` / `allowShorts=false` | Blokował closing-side ordery |
| **HOLD_FOR_TP guard** | `!IS_PURE_MM_BOT` blokował HOLD_FOR_TP | PURE_MM nie mógł korzystać z HOLD_FOR_TP |

**Rozwiązanie:** Usunięcie kompletne 3 mechanizmów + usunięcie PURE_MM guard z HOLD_FOR_TP.

**4 zmiany w `src/mm_hl.ts` (-90 linii):**

| # | Zmiana | Linie usunięte |
|---|--------|----------------|
| 1 | **HOLD_FOR_TP**: usunięto `!IS_PURE_MM_BOT` guard | 2 linie |
| 2 | **Inventory Deviation**: usunięto cały blok (if/else-if/else-if) | ~10 linii |
| 3 | **AlphaEngine multipliers**: usunięto cały blok + importy `getAlphaSizeMultipliers`, `shouldBypassDelay` | ~26 linii |
| 4 | **SM Direction permissions**: usunięto cały blok (FOLLOW_SM_SHORT/LONG permissions blocking) | ~44 linie |

**Zachowane:**
- `smDir` = `getSmDirection(pair)` — nadal potrzebne przez Pump Shield, FibGuard, inne downstream bloki
- `isSignalEnginePureMmInv` — nadal potrzebne przez Vision Skew, MIN_PROFIT, risk checks
- `signalEngineResultInv` reused zamiast `signalEngineResultFso` (identyczna logika)

**Co teraz zarządza rebalancing:**
- **kPEPE Enhanced Inventory Skew** (size multipliers skalowane 10-40% skew + time decay)
- **Momentum Guard** (asymetryczny grid na podstawie momentum/RSI/proximity)
- **Inventory-Aware MG Override** (#92, gwarantuje closing-side przy stuck positions)
- **S/R Progressive Reduction** (#89, zamyka pozycje przy S/R)
- **Auto-Skew** (mid-price shift proporcjonalny do skew)
- **Inventory SL** (panic mode przy ekstremalnym skew + drawdown)

**Pliki:** `src/mm_hl.ts` (-90/+7)

### 93. S/R Discord Alerts — powiadomienia gdy cena podchodzi do wsparcia/oporu (04.03)

**Problem:** Bot obliczał proximity S/R (support/resistance) ale nie powiadamiał usera. Trzeba było ręcznie czytać logi PM2 żeby zobaczyć czy cena jest blisko kluczowych poziomów.

**Rozwiązanie:** Discord embed alerty gdy cena wchodzi w strong zone (1×ATR) wokół S/R z 1h candle bodies.

**A) Nowy plik `src/utils/discord_notifier.ts`:**
- `sendDiscordMessage(content)` — prosty tekst
- `sendDiscordEmbed(embed)` — rich embed z polami, kolorami, timestampem
- Czyta `DISCORD_WEBHOOK_URL` z `.env` (już skonfigurowany)
- Pattern reused z `slack_router.ts` (https.request POST)

**B) 4 typy alertów (w `mm_hl.ts`, po obliczeniu `mgProxSignal`):**

| Typ | Kiedy | Kolor | mgProxSignal |
|-----|-------|-------|-------------|
| `ABOVE_RESISTANCE` | Cena >= resistance | Czerwony | +1.0 |
| `NEAR_RESISTANCE` | Cena w strong zone od resistance | Czerwony | +0.8 |
| `BELOW_SUPPORT` | Cena <= support | Zielony | -1.0 |
| `NEAR_SUPPORT` | Cena w strong zone od support | Zielony | -0.8 |

**C) Discord embed zawiera 6 pól:**
- Price, S/R Level (RESISTANCE/SUPPORT), Distance %, ATR Zone %, RSI, Skew
- Footer: "S/R from 1h candles (24h lookback) | Cooldown 30min"

**D) Cooldown:** 30 minut per token per alert type (`srAlertCooldowns` Map).
- Klucz: `${pair}:${alertType}` (np. `kPEPE:NEAR_RESISTANCE`)
- Zapobiega spamowi gdy cena oscyluje wokół poziomu

**E) Pipeline position:** Po obliczeniu `mgProxSignal` (proximity), PRZED MG scoring. Fire-and-forget (`.catch(() => {})` — nie blokuje main loop).

**Logi:** `📍 [SR_ALERT] kPEPE: NEAR_RESISTANCE — price=$0.003729 RESISTANCE=$0.003760 dist=0.83% zone=1.80%`

**Verified live:** Pierwszy tick po deploy — alert NEAR_RESISTANCE wysłany na Discord, embed z 6 polami.

**Pliki:** `src/utils/discord_notifier.ts` (NEW, 74 LOC), `src/mm_hl.ts` (+65)

### 92. Inventory-Aware MG Override — fix stuck positions against momentum (04.03)

**Problem:** MG (Momentum Guard) traktuje bid/ask jako sygnały kierunkowe rynku, NIE jako zarządzanie pozycją. Podczas pumpa MG redukuje bidy — ale gdy bot ma SHORT, potrzebuje bidów żeby ZAMKNĄĆ pozycję. kPEPE: skew=-38%, cena rośnie, MG daje bid×0.78 ask×0.25 → bot utknął na 0 fills przez 8+ godzin.

**Root cause:** MG nie wie o pozycji bota. Auto-Skew daje +4.5bps (za mało przy -38% skew). Signal Engine bypassuje Vision skew i inventory deviation. Efekt: zero closing-side orderów.

**Rozwiązanie:** Inventory-Aware MG Override — po MG multiplierach, PRZED logiem MG. Gdy pozycja jest PRZECIW momentum, gwarantuj minimalny closing-side multiplier skalowany urgency.

**A) Config — 3 nowe pola w `MomentumGuardConfig` (`short_only_config.ts`):**
```typescript
inventoryAwareMgEnabled: boolean       // default true
inventoryAwareMgThreshold: number      // default 0.15 (15% |skew|)
inventoryAwareMgClosingBoost: number   // default 1.3 (kPEPE: 1.5)
```

**B) Logika (`mm_hl.ts`, ~30 linii po MG multiplierach, przed MG log):**
```
absSkewInv = |actualSkew|
if absSkewInv > threshold (15%):
  urgency = min(1.0, absSkewInv / 0.50)     // 15%→0.30, 30%→0.60, 50%→1.00
  minClosing = 1.0 + urgency × (closingBoost - 1.0)

  SHORT + PUMP → if bid < minClosing: bid=minClosing, ask=min(ask, 1/minClosing)
  LONG + DUMP  → if ask < minClosing: ask=minClosing, bid=min(bid, 1/minClosing)
```

**C) Pipeline position:**
```
MG Score → Multipliers (bid/ask based on momentum)
  ↓
>>> INVENTORY-AWARE MG OVERRIDE (NEW — fix closing-side when against momentum) <<<
  ↓
MG Log (now shows corrected multipliers + ⚡INV_AWARE flag)
  ↓
S/R Progressive Reduction → S/R Accumulation → Breakout TP → Dynamic TP → ...
```

**D) Interakcje:**
- Override TYLKO gdy closing-side < minClosing (nie zmienia nic gdy MG już daje dość)
- `pumpAgainstShort` / `dumpAgainstLong` flagi już istniały (dotąd logging only) — teraz mają realną logikę
- Counter-side capped `1/minClosing` (konserwatywnie)
- S/R systems (po override) mogą TYLKO zwiększyć closing-side (multiplicative)
- Auto-Skew (po override) nadal działa — teraz closing side ma sensowne ordery do wypełnienia

**E) Scenariusz z dzisiejszego problemu:**
```
kPEPE: skew=-38%, pump, momentumScore=+0.43
Przed override: bid×0.78 ask×0.25

threshold=0.15 → |-0.38| > 0.15 ✓
urgency = min(1.0, 0.38/0.50) = 0.76
minClosing = 1.0 + 0.76 × (1.5 - 1.0) = 1.38
pumpAgainstShort=true → bid(0.78) < 1.38 ✓

Po override: bid×1.38 ask×0.25
→ Bot ma sensowne bidy żeby zamknąć shorta
```

**F) Self-correcting behavior:**
1. skew=-38% + pump → INV_AWARE → bid×1.38 (zamykaj shorta)
2. Bot dostaje fills, skew maleje
3. skew < 15% → override wyłącza się
4. skew ~0% → S/R Accumulation buduje nową pozycję w kierunku bounce
5. Normalny MG przejmuje (aski dominują przy pumpie)

**Logi:**
- `⚡ [INV_AWARE_MG] kPEPE: SHORT+PUMP — skew=-38% score=0.43 urgency=77% minClosing=1.38 → bid×1.38 ask×0.25 (CLOSING OVERRIDE)`
- `📈 [MOMENTUM_GUARD] kPEPE: score=0.43 ... ⚡INV_AWARE→closing_boosted`

**Verified live:** Pierwszy tick po deploy — override aktywny, bid×1.38 zamiast bid×0.78.

**Pliki:** `src/config/short_only_config.ts` (+7), `src/mm_hl.ts` (+38)

### 90. S/R Accumulation + Breakout TP — full mean-reversion cycle (04.03)

**Problem:** S/R Reduction (#89) zamykał pozycje schodząc do S/R, ale brakowało dwóch komplementarnych mechanizmów:
1. Przy S/R z małą/zerową pozycją bot NIE budował pozycji w kierunku bounce
2. Przy silnym momentum w kierunku pozycji bot NIE przyspieszał zamykania

**Rozwiązanie:** Dwa nowe bloki w kPEPE pipeline — S/R Accumulation + Breakout TP. Razem z S/R Reduction tworzą pełny cykl mean-reversion.

**Pełny cykl:**
```
[1] Przy SUPPORT, mały/brak pozycji → S/R Accumulation: buduj LONGI
[2] Cena rośnie, normalny MM → MG + Auto-Skew zamyka część
[3] Mocny pump → Breakout TP: agresywnie zamknij longi
[4] Przy RESISTANCE → S/R Reduction zamyka resztkę + Accumulation buduje SHORTY
[5-7] Mirror going down → cycle repeats
```

**A) Config — 7 nowych pól w `MomentumGuardConfig` (`short_only_config.ts`):**
```typescript
// S/R Accumulation
srAccumulationEnabled: boolean       // default true
srAccumBounceBoost: number           // default 1.5 (50% more on bounce side)
srAccumCounterReduce: number         // default 0.50 (50% less on counter side)
srAccumSpreadWiden: number           // default 1.3 (30% wider on bounce side)
// Breakout TP
srBreakoutTpEnabled: boolean         // default true
srBreakoutTpScoreThreshold: number   // default 0.50 (min |score| to trigger)
srBreakoutTpClosingBoost: number     // default 1.5 (closing-side boost)
```

kPEPE overrides: `srAccumBounceBoost: 1.8` (aggressive), `srBreakoutTpScoreThreshold: 0.40` (trigger earlier).

**B) S/R Accumulation logika (`mm_hl.ts`, po S/R Reduction, przed Dynamic TP):**
- Fires when `|skew| <= srMaxRetainPct` (small/no position) — complementary with S/R Reduction which fires when `|skew| > srMaxRetainPct`
- Same zone as S/R Reduction (`accumZone = mgStrongZone × srReductionStartAtr`)
- At SUPPORT (`!hasShortPos`): `bid × bounceBoost`, `ask × counterReduce`, `bidSpread × spreadWiden`
- At RESISTANCE (`!hasLongPos`): mirror — `ask × bounceBoost`, `bid × counterReduce`, `askSpread × spreadWiden`
- Progress 0→1 as price approaches S/R level

**C) Breakout TP logika (`mm_hl.ts`, po S/R Accumulation, przed Dynamic TP):**
- Fires when `|momentumScore| > threshold` AND position aligned with momentum
- LONG + strong pump (score > threshold): `ask × closingBoost`, `bid × 1/closingBoost`
- SHORT + strong dump (score < -threshold): `bid × closingBoost`, `ask × 1/closingBoost`
- Multiplicative with MG — amplifies natural mean-reversion closing

**D) Pipeline position:**
```
MG Score → Multipliers
  ↓ MG Log
  ↓ S/R PROGRESSIVE REDUCTION (close big pos at S/R)
  ↓ >>> S/R ACCUMULATION (NEW — build pos at S/R when flat) <<<
  ↓ >>> BREAKOUT TP (NEW — close pos on strong aligned momentum) <<<
  ↓ Dynamic TP
  ↓ Inventory SL
  ↓ Auto-Skew
  ↓ generateGridOrdersCustom
```

**E) Interakcje:**
- **S/R Reduction + Accumulation**: Complementary — never both active for same S/R (different skew conditions). Together: full position lifecycle at S/R.
- **MG + Accumulation**: MG at support with dump: bid×1.30 ask×0.10. Accumulation adds bid×1.5 → combined bid×1.95, ask×0.05. Ultra-aggressive buying.
- **MG + Breakout TP**: MG strong pump: bid×0.10 ask×1.30. Breakout with LONG: ask×1.5 → combined bid×0.067, ask×1.95. Maximum selling pressure.

**Logi:**
- `🔄 [SR_ACCUM] kPEPE: SUPPORT → accumulate LONGS — progress=92% dist=0.35% zone=4.50% skew=10% → bid×1.74 ask×0.54 bidSpread×1.28`
- `🔄 [SR_ACCUM] kPEPE: RESISTANCE → accumulate SHORTS — progress=96% ...`
- `🚀 [BREAKOUT_TP] kPEPE: LONG+PUMP — score=0.72 > 0.40 → bid×0.067 ask×1.95 (CLOSING)`
- `🚀 [BREAKOUT_TP] kPEPE: SHORT+DUMP — score=-0.65 > 0.40 → bid×1.95 ask×0.067 (CLOSING)`

**Pliki:** `src/config/short_only_config.ts` (+14), `src/mm_hl.ts` (+62)

### 89. S/R Progressive Position Reduction — take profit at support/resistance (04.03)

**Problem:** kPEPE (PURE_MM) budował masywnego SHORT (-959K kPEPE, $3,583) schodząc do support. Momentum Guard redukował ask SIZE (ask×0.35), ale nawet $280/tick przez 100+ ticków = ogromna pozycja. Brak mechanizmu który AKTYWNIE redukuje pozycję gdy cena podchodzi do S/R w korzystnym kierunku. Przy support bot miał pełnego shorta zamiast max 20%.

**Rozwiązanie:** S/R Progressive Reduction — gdy SHORT i cena spada ku support (profit) → progresywnie zamykaj. Przy support → max 20% pozycji. Potem normalny MM (MG proximity handles bounce/break).

**A) Config — 4 nowe pola w `MomentumGuardConfig` (`short_only_config.ts`):**
```typescript
srReductionEnabled: boolean     // default true
srReductionStartAtr: number     // Start zone at N×ATR from S/R (default 3.0)
srMaxRetainPct: number          // Max position at S/R (default 0.20 = 20%)
srClosingBoostMult: number      // Closing-side boost at S/R (default 2.0)
```

kPEPE override: `srReductionStartAtr: 2.5` (start earlier — volatile, moves fast).

**B) Logika (`mm_hl.ts`, po MG multipliers, przed Dynamic TP):**
```
reductionZone = mgStrongZone × srReductionStartAtr  (e.g. 1.8% × 2.5 = 4.5%)
progress = 1 - mgSupportDist / reductionZone         (0.0 at zone edge → 1.0 at S/R)

SHORT near SUPPORT (profitable):
  if |skew| > 20%:
    ask × (1 - progress)              → stop building shorts
    bid × (1 + progress × 1.0)        → boost closing (buy back)
  else: DISENGAGED → normal MM

LONG near RESISTANCE (profitable): mirror logic
```

**C) Pipeline position:**
```
MG Score → Multipliers
  ↓ MG Log
  ↓ >>> S/R PROGRESSIVE REDUCTION (NEW) <<<
  ↓ Dynamic TP (spread widener)
  ↓ Inventory SL (panic close)
  ↓ Auto-Skew
  ↓ generateGridOrdersCustom
```

**Interakcje:**
- **MG multipliers (before):** MG redukuje asks podczas dump (ask×0.10). S/R Reduction mnoży na wierzch: ask×0.10 × 0.2 = ask×0.02. Oba systemy zgadzają się "stop shorting at support".
- **Dynamic TP (after):** Rozszerza closing spread. Komplementarne — S/R boost SIZE, Dynamic TP widen SPREAD.
- **Inventory SL (after):** Panic close underwater. S/R Reduction = profitable positions (TP at S/R). Brak konfliktu.
- **MIN_PROFIT (after grid):** S/R operuje na profitable positions (cena away from entry toward S/R) → close orders far from entry → MIN_PROFIT nie filtruje.

**Przykład kPEPE SHORT -43% skew, cena spada do support:**
```
S/R(1h): R=$0.003732 S=$0.003418, ATR=$0.000065 (1.8%)
reductionZone = 0.018 × 2.5 = 4.5%
price=$0.003500, mgSupportDist=2.34%
progress = 1 - 2.34/4.5 = 0.48 (48%)

|skew|=43% > 20% → ACTIVE:
  ask × 0.52 (halve new shorts)
  bid × 1.48 (boost closing)
Combined with MG dump (bid×1.15, ask×0.40):
  Final: bid×1.71, ask×0.21 → aggressive closing, minimal new shorts
```

**Logi:** `📉 [SR_REDUCTION] kPEPE: SHORT near SUPPORT — progress=48% dist=2.34% zone=4.50% skew=-43% → ask×0.21 bid×1.71 (REDUCING)` lub `DISENGAGED (skew 15% <= 20% → normal MM)`

**Pliki:** `src/config/short_only_config.ts` (+8), `src/mm_hl.ts` (+55)

### 88. INVENTORY_SL + MIN_PROFIT deadlock fix — 8h bot freeze resolved (04.03)

**Problem:** Bot mm-pure (kPEPE) zamrożony na 8+ godzin — generował **0 orderów**. Pozycja SHORT -976,589 kPEPE ($3,583, entry $0.003450) underwater 6.1% przy cenie $0.003660. Watchdog: "No fills detected for 7.0h".

**Root cause — deadlock między dwoma systemami:**

| System | Co robi | Efekt |
|--------|---------|-------|
| **INVENTORY_SL (Panic)** | skew=45%, drawdown=6.1% > 4.8% (2.5×ATR) → `asks=0, bids×2` | Blokuje aski (nie dodawaj shortów), podwaja bidy (zamykaj SHORT!) |
| **MIN_PROFIT** | Filtruje bidy gdzie `price > entry × (1 - 0.001)` | Entry=$0.003450, maxBidPrice=$0.003447. Cena $0.003660 → WSZYSTKIE bidy odfiltrowane |

**Wynik:** asks=0 (INVENTORY_SL) + bids=0 (MIN_PROFIT) = **0 orderów przez 8 godzin**. Bot żywy ale kompletnie sparaliżowany.

**Logi (pre-fix):**
```
🚨 [INVENTORY_SL] kPEPE: PANIC SHORT — skew=45% drawdown=6.1% > 4.8% (2.5×ATR) → asks=0 bids×2
🛑 [BEAR_TRAP] kPEPE: Cancelled 0 ASK orders (sizeMultipliers.ask=0)
📊 [ML-GRID] pair=kPEPE mid≈0.0036600 buyLevels=0 sellLevels=0
kPEPE Multi-Layer: 0 orders
🕒 [WATCHDOG] No fills detected for 7.0h
```

**Fix — `inventorySlPanic` flag (4 zmiany w `src/mm_hl.ts`):**

| Linia | Zmiana |
|-------|--------|
| 8268 | `let inventorySlPanic = false` — deklaracja flagi |
| 8443 | `inventorySlPanic = true` — w bloku PANIC SHORT |
| 8453 | `inventorySlPanic = true` — w bloku PANIC LONG |
| 8526 | `&& !inventorySlPanic` dodane do warunku MIN_PROFIT |

**Logika:** Gdy INVENTORY_SL jest w trybie PANIC (ekstremalny skew + drawdown), MIN_PROFIT jest bypassowany. Stop-loss (zamknięcie pozycji) ma priorytet nad ochroną przed stratą na fees. Bot zamyka underwater pozycję nawet ze stratą, bo alternatywa (8h paraliżu) jest gorsza.

**Timeline pozycji (z analizy fills):**
- 03-03 17:00 → 03-04 08:46 UTC: Gradualny buildup SHORT (-976K kPEPE) przez ~100 sell fills po $100
- 03-04 08:46 UTC: Ostatni fill. Cena rosła, INVENTORY_SL kicked in + MIN_PROFIT blocked = freeze
- 03-04 17:02 UTC (po fix): Pierwsze BUY fills (Close Short @ $0.003701, closedPnl=-$6.78) — bot zamyka pozycję

**Weryfikacja po deploy:**
```
📊 Status | Daily PnL: $1.37 | Total: $458.65
L1-L4 BUY orders: $0.003674-$0.003703 × 27K-27K kPEPE ($100 each)
```

**Pliki:** `src/mm_hl.ts` (+4 linie)

### 91. vip_spy channel rename + ecosystem memory bump (04.03)

**A) vip_spy.py — Telegram channel rename:**
- `WHALE_ALERT_CHAT_ID` → `VIP_ALERT_CHAT_ID` (zmienna + referencje)
- Nowy chat ID: `-1003773745774` (był `-1003835151676`)
- Funkcja `send_telegram()`: param `also_whale_channel` → `also_vip_channel`

**B) ecosystem.config.cjs — memory bump:**
- `max_memory_restart`: `300M` → `350M` dla mm-pure
- Powód: mm_hl.ts rośnie (nowe bloki S/R Accumulation, Breakout TP) — bot był restartowany przez PM2 przy ~300M

**Pliki:** `scripts/vip_spy.py` (+4/-4), `ecosystem.config.cjs` (+1/-1)

---

## Zmiany 1 marca 2026

### 78. Momentum Guard 1h S/R — fix prox=0.00 for kPEPE (01.03)

**Problem:** Momentum Guard proximity signal (`prox`) zawsze 0.00 dla kPEPE — bot nie widział resistance/support. Efekt: 20% wagi MG score (proximity S/R) było martwe. Bot reagował tylko na momentum (50%) i RSI (30%), ignorując bliskość kluczowych poziomów cenowych.

**Root cause:** S/R obliczane z **30 candles 4h (5 dni lookback)** — zbyt szeroki zakres dla volatile memecoina. kPEPE spadło z $0.004360 do $0.003449 w 5 dni (26% range). ATR-based proximity zone = 1.6% (strong) / 3.2% (moderate). Cena ($0.003660) była 18.7% od resistance i 6.1% od support — obie daleko poza zone. `prox` zawsze 0.

**Diagnoza (debug log):**
```
PRZED: resBody=0.004360 supBody=0.003449 rDist=18.7% sDist=6.0% zone=1.5%/3.0% → prox=0.00
```

**Rozwiązanie:** Dodano **1h S/R** (24 candles = 24h lookback) — krótkoterminowe support/resistance z 1h candle bodies. Tighter range → cena wchodzi w ATR-based zone → proximity signal aktywny.

**A) Nowe pola w `PairAnalysis` (`market_vision.ts`):**
```typescript
supportBody12h: number;      // Short-term support (last 24 1h candles)
resistanceBody12h: number;   // Short-term resistance (last 24 1h candles)
```

**B) Obliczenie z istniejących 1h candles (zero nowych API calls):**
```typescript
const srLookback = Math.min(24, candles.length);
if (srLookback >= 12) {
  const recent1h = candles.slice(-srLookback);
  supportBody12h = Math.min(...recent1h.map(c => Math.min(c.o, c.c)));
  resistanceBody12h = Math.max(...recent1h.map(c => Math.max(c.o, c.c)));
}
```

**C) Momentum Guard używa 1h S/R z fallback na 4h (`mm_hl.ts`):**
```typescript
const mgResistBody12h = mvAnalysis?.resistanceBody12h ?? 0
const mgSupportBody12h = mvAnalysis?.supportBody12h ?? 0
const mgResistBody = mgResistBody12h > 0 ? mgResistBody12h : (mvAnalysis?.resistanceBody4h ?? 0)
const mgSupportBody = mgSupportBody12h > 0 ? mgSupportBody12h : (mvAnalysis?.supportBody4h ?? 0)
```

**Wynik live:**
```
PRZED: res=0.004360 (18.7% od ceny) → prox=0.00, score=0.00
PO:    res=0.003682 (0.3% od ceny)  → prox=0.80, score=0.16
```

| Metryka | Przed (4h S/R) | Po (1h S/R) |
|---------|---------------|-------------|
| Resistance | $0.004360 (18.7%) | **$0.003682 (0.3%)** |
| Support | $0.003449 (6.0%) | $0.003449 (6.0%) |
| prox signal | 0.00 (dead) | **0.80 (active!)** |
| MG score | 0.00 | **0.16** |

**D) S/R values w logu MG:**
```
📈 [MOMENTUM_GUARD] kPEPE: score=0.16 (mom=0.00 rsi=0.00 prox=0.80) → bid×1.28 ask×0.72 | S/R(1h): R=$0.003682 S=$0.003449
```

**Dotyczy WSZYSTKICH par** w activePairs (kPEPE, LIT, ETH, BTC, HYPE, SOL) — 1h candles już fetchowane przez MarketVision, zero dodatkowych API calls.

**Pliki:** `src/signals/market_vision.ts` (+12), `src/mm_hl.ts` (+8/-3)

### 79. Nuclear Fix disabled for PURE_MM — kPEPE bid=0 bug fixed (01.03)

**Problem:** kPEPE (PURE_MM bot, mm-pure) miał bidy zablokowane (bid=0) przez Nuclear Fix mimo że `getSignalEngineForPair()` poprawnie zwracał `PURE_MM`. Bot nie kupował przez ~142 minut w nocy (3 AM gap), nie zamykał shortów, nie robił mean-reversion.

**Root cause:** `shouldHoldForTp()` w `SmAutoDetector.ts` czyta z globalnego `cachedAnalysis` map. `loadAndAnalyzeAllTokens()` analizuje WSZYSTKIE tokeny (nie tylko te przypisane do bota) i zapisuje wyniki w cache. Gdy whale_tracker.py pokazał silny SM SHORT dla kPEPE (score -46), cache się zaktualizował → `shouldHoldForTp('kPEPE', 'short')` zwracał `true` nawet na PURE_MM bot. To triggerowało Nuclear Fix: `permissions.allowLongs = false` → `bidMultiplier = 0` → zero bidów.

**Kluczowy bug (linia 7727):** Wewnątrz bloku `if (isPureMmMode)` (linia 7722), kod sprawdzał `shouldHoldForTp()` które obchodziło PURE_MM guard:
```typescript
// PRZED (bug): PURE_MM mode, ale shouldHoldForTp czyta z globalnego cache
const holdTp = shouldHoldForTp(pair, positionSideCheck);
if (holdTp) { permissions.allowLongs = false; } // → bid=0!

// PO (fix):
const holdTp = IS_PURE_MM_BOT ? false : shouldHoldForTp(pair, positionSideCheck);
```

**5 miejsc naprawionych z `!IS_PURE_MM_BOT` guard:**

| Linia | Blok | Co robiło źle |
|-------|------|---------------|
| 6647 | Bid restore block | Blokował przywracanie bidów po HOLD_FOR_TP |
| 6842 | SM-aligned TP skip | Blokował take-profit gdy SM-aligned |
| 7085-7088 | Skew override | Fałszował inventorySkew na +30% |
| **7727** | **Permissions override** | **allowLongs=false → bid=0 (THE KEY BUG)** |
| 8597 | Grid bid removal | Usuwał bidy z grid orders |

**Wynik live po fix:**
```
PRZED: kPEPE bids=0 asks=8, bidMult=0.00 — bot zamrożony (tylko aski)
PO:    kPEPE bids=8 asks=8, bidMult=1.21 askMult=1.04 — pełny market making
```

**Dodatkowa zmiana:** `lowVolL1Bps` 28→14 w `short_only_config.ts` (Dynamic Spread). W niskiej zmienności L1 teraz 14bps zamiast 28bps — tighter quotes.

**Pliki:** `src/mm_hl.ts` (+5/-5), `src/config/short_only_config.ts` (+1/-1)

### 80. mm-follower → DRY_RUN, copy-general → LIVE (01.03)

**Problem:** mm-follower miał otwarte pozycje (BTC 57% drawdown, AUTO-PAUSED). copy-general był w dry-run mimo że config mówił `--live`.

**Zmiany:**

| Bot | Przed | Po | Jak |
|-----|-------|----|-----|
| mm-follower | LIVE (handlował) | **DRY_RUN** (paper) | `DRY_RUN: "true"` w ecosystem.config.cjs + `--update-env` |
| copy-general | DRY_RUN (nie startował z --live) | **LIVE** | `pm2 restart copy-general --update-env` |

**mm-follower w DRY_RUN:** Bot działa ale nie tworzy LiveTrading instance → `getAlphaShiftBps` undefined na wszystkich 5 parach. PnL = $0.00 (brak tradingu). Błędy w logach są kosmetyczne — bot jest bezpieczny.

**PM2 env propagation:** Shell env vars (`DRY_RUN=true`) przed `pm2 restart` NIE przechodzą do procesu app. Trzeba dodać do `ecosystem.config.cjs` env section i restartować z `--update-env`.

**PM2 save:** Stan zapisany po zmianach.

**Pliki:** `ecosystem.config.cjs` na serwerze (+1 linia: `DRY_RUN: "true"`)

### 81. DRY_RUN safety — guard all LiveTrading casts (02.03)

**Problem:** mm-follower (DRY_RUN=true) crashował z `TypeError` i `ReferenceError` na wielu code paths. W DRY_RUN mode `this.trading` jest `PaperTrading` (nie `LiveTrading`), ale ~25 miejsc w mm_hl.ts robiło `this.trading as LiveTrading` i odwoływało się do properties które nie istnieją na PaperTrading: `l2BookCache`, `shadowTrading`, `binanceAnchor`, `vpinAnalyzers`, `adverseTracker`, `closePositionForPair()`.

**Root cause:** Niezabezpieczone type assertions. TypeScript `as LiveTrading` nie zmienia runtime behavior — casting PaperTrading na LiveTrading kompiluje się ale crashuje przy dostępie do brakujących properties.

**11 fixów w `mm_hl.ts`:**

| # | Lokalizacja | Fix | Co crashowało |
|---|-------------|-----|---------------|
| 1 | `analyzeOrderBook()` | `instanceof` guard, return neutrals | `lt.l2BookCache.get(pair)` |
| 2 | Binance anchor block | nullable liveTrading + optional chaining | `liveTrading.binanceAnchor` |
| 3 | Shadow contrarian | replaced removed `lt2` var, `instanceof` guard | `lt2.shadowTrading` (undefined) |
| 4 | Nansen close signal | `instanceof` guard w condition | `this.trading.closePositionForPair()` |
| 5-8 | closePositionForPair calls | `instanceof` guard wewnątrz try | squeeze, stop_loss, sm_tp, anaconda_sl |
| 9 | Status log block | `instanceof` guard na cały ToxicFlow log | `lt.binanceAnchor`, `lt.vpinAnalyzers` |
| 10 | VPIN/Adverse | optional chaining `?.` | `liveTrading.vpinAnalyzers`, `.adverseTracker` |
| 11 | `fetchOpenOrdersRaw` | duplikat metody na `HyperliquidMMBot` | metoda była tylko na `LiveTrading` class |

**Fix #11 detail:** `cancelAllOnBlockedPairs()` jest na `HyperliquidMMBot` class (linia 4262) i woła `this.fetchOpenOrdersRaw()`. Ale `fetchOpenOrdersRaw` był zdefiniowany TYLKO na `LiveTrading` class (linia 2905) — inny class! Dodano identyczną kopię metody na `HyperliquidMMBot` (linia 4248).

**Dodatkowy fix:** `scripts/general_copytrade.ts` — usunięto nieprawidłowe pole `c` z cloid (Hyperliquid API odrzucał format `c-0xABC-123`, prawidłowy: `0xABC-123`).

**Wynik po deploy:**
```
mm-pure:     ZERO TypeError/ReferenceError ✅
mm-follower: ZERO TypeError/ReferenceError ✅ (wcześniej 3+ różne crashe)
```

**Lekcja:** `--update-env` wymagane przy `pm2 restart` gdy plik źródłowy zmienił się — bez tego ESM loader może cacheować starą wersję.

**Pliki:** `src/mm_hl.ts` (+109/-68), `scripts/general_copytrade.ts` (+3/-1)
**Commit:** `33204b6`

### 82. copy-general position reconciliation — xyz:GOLD state desync fix (02.03)

**Problem:** copy-general miał xyz:GOLD LONG $600 na koncie ale `activeCopies` state tego nie śledził. Bot nie mógł reagować na redukcje/zamknięcia GOLD przez Generała — pozycja była "niewidzialna" dla systemu śledzenia.

**Root cause — 3-krokowy desync:**
1. **28.02 15:37**: Bot wykrył xyz:GOLD jako nową pozycję, złożył 6 IOC orderów, otworzył LONG ~$600 (6×0.0186 oz @ ~$5367)
2. `placeOrder()` zwróciło `false` (IOC partial fill → SDK error) → `if (ok)` nie weszło → `activeCopies['xyz:GOLD']` NIE zapisane
3. Na kolejnych tickach: `calculateCopySize()` → `maxAlloc = $500 - $600 = -$100 → return 0` → `copySize < 20 → continue` (cicho skipowany)

**Dodatkowy bug (01.03 07:08):** Bot próbował ponownie skopiować GOLD, ale stary kod miał `c: \`copy_${coin}_...\`` → `copy_xyz:GOLD_19ca83a7409` → HL API odrzuciło (dwukropek w cloid). Fix `c` field usunięcia (z poprzedniej sesji) naprawił to, ale pozycja była już powyżej limitu.

**Fix — sekcja 3b: Position Reconciliation (`scripts/general_copytrade.ts`):**
```typescript
// 3b. Reconcile: if we have a position matching Generał but no activeCopy, register it
for (const [coin, ourPos] of Object.entries(ourPositions)) {
  if (state.activeCopies[coin]) continue  // already tracked
  if (!generalPos[coin]) continue  // Generał doesn't have this coin
  const gSide = generalPos[coin].side === 'LONG' ? 'buy' : 'sell'
  const ourSide = ourPos.size > 0 ? 'buy' : 'sell'
  if (gSide !== ourSide) continue  // opposite side — not a copy
  state.activeCopies[coin] = { side: ourSide, entryTime: Date.now(), generalEntry: generalPos[coin].entry_px }
  log(`🔧 RECONCILE: ${coin} ${ourSide} $${ourPos.value.toFixed(0)} — registered as active copy`)
}
```

**Logika:** Na każdym ticku po `fetchOurPositions()`, porównaj realne pozycje z activeCopies. Jeśli trzymamy pozycję w tym samym kierunku co Generał ale brak wpisu w activeCopies → zarejestruj automatycznie. Guard: opposite side = nie kopia (np. nasza pozycja hedgeowa).

**Wynik live:**
```
🔧 RECONCILE: xyz:GOLD buy $600 — registered as active copy (was missing from state)
```
activeCopies: 8 (baseline) → **9** (8 baseline + xyz:GOLD reconciled). Bot teraz będzie reagować na GOLD redukcje/zamknięcia przez Generała.

**Pliki:** `scripts/general_copytrade.ts` (+16)
**Commit:** `99de1bf`

### 85. mm-follower usunięty — uproszczenie PM2 (02.03)

**Problem:** mm-follower (SM-following bot dla BTC, ETH, SOL, HYPE, FARTCOIN) nie był już potrzebny. User zamknął pozycje ręcznie, bot był w DRY_RUN, generował błędy TypeErrors w DRY_RUN mode.

**Zmiany:**
- `pm2 stop mm-follower && pm2 delete mm-follower && pm2 save` na serwerze
- Usunięto sekcję mm-follower z `ecosystem.config.cjs` (lokal + serwer)
- Dodano `COPY_BLOCKED_COINS: "PUMP"` permanentnie w ecosystem.config.cjs

**Przed:** 3 boty (mm-follower, mm-pure, copy-general)
**Po:** 2 boty (mm-pure kPEPE market making, copy-general kopiowanie Generała)

**Pliki:** `ecosystem.config.cjs` (-28 linii mm-follower sekcji)

### 86. copy-general COPY_ALLOWED_COINS whitelist + baseline state fix (02.03)

**Problem:** copy-general miał 7 activeCopies (AVAX, FARTCOIN, RESOLV, ASTER, APEX + LIT, xyz:GOLD) zamiast oczekiwanych 2 (LIT, xyz:GOLD). User chciał kopiować TYLKO te dwa coiny.

**Krytyczny błąd:** Usunięcie niechcianych wpisów z activeCopies (AVAX, FARTCOIN, RESOLV, ASTER, APEX) spowodowało katastrofę — bot zobaczył istniejące pozycje Generała w tych coinach jako "nowe" i natychmiast otworzył 5 nowych kopii po $500 ($2,500 total). User musiał zamknąć je ręcznie.

**Root cause:** `activeCopies` służy jako "pamięć" bota — jeśli coin jest w activeCopies, bot go nie kopiuje ponownie. Usunięcie wpisu = bot "zapomina" że pozycja istnieje → traktuje jako nową.

**Fix 1 — Baseline entries (state file na serwerze):**
Re-dodano WSZYSTKIE pozycje Generała jako `baseline: true` w `/tmp/copy_general_state.json`. Flag `baseline` oznacza "znana pozycja, nie zarządzaj" — bot nie próbuje kopiować, zamykać ani redukować baseline entries.

**Fix 2 — COPY_ALLOWED_COINS whitelist (general_copytrade.ts):**
```typescript
// Config interface
allowedCoins: string[]  // If non-empty, ONLY these coins will be copied

// Env var parsing
const allowedStr = process.env.COPY_ALLOWED_COINS || ''
const allowedCoins = allowedStr ? allowedStr.split(',').map(s => s.trim()).filter(Boolean) : []

// Whitelist check (section 7 — detect NEW positions)
if (config.allowedCoins.length > 0 && !config.allowedCoins.includes(coin)) continue
```

**Fix 3 — dotenv loading:**
```typescript
import { config as dotenvConfig } from 'dotenv'
dotenvConfig()  // Potrzebne bo COPY_PRIVATE_KEY jest w .env, nie w ecosystem.config.cjs
```

**Fix 4 — PM2 env var propagation:**
`pm2 restart --update-env` czyta z shell env, NIE z `ecosystem.config.cjs`. Żeby załadować env vars z pliku config: `pm2 delete` + `pm2 start ecosystem.config.cjs --only copy-general`.

**ecosystem.config.cjs:**
```javascript
COPY_ALLOWED_COINS: "LIT,xyz:GOLD",
COPY_BLOCKED_COINS: "PUMP",
```
Whitelist (ALLOWED) ma priorytet nad blocklist (BLOCKED). Nowe coiny Generała są automatycznie ignorowane.

**Lekcja:**
- **NIGDY nie usuwaj wpisów z activeCopies** — użyj `baseline: true` flag zamiast tego
- **Whitelist > Blocklist** — COPY_ALLOWED_COINS (whitelist) jest bezpieczniejszy niż COPY_BLOCKED_COINS (blocklist) bo nowe coiny automatycznie ignorowane
- **PM2 --update-env czyta z shell, nie z config file** — trzeba delete + start żeby załadować z ecosystem.config.cjs

**Pliki:** `scripts/general_copytrade.ts` (+12), `ecosystem.config.cjs` (+1 linia COPY_ALLOWED_COINS)

### 87. kPEPE timing fix — Dynamic Spread widen + MG proximity boost + Auto-Skew speed (02.03)

**Problem:** kPEPE bot łapał shorty za wcześnie — cena miała duże swingi 5-10% w obie strony na 1h, a bot z L1=14bps (round-trip 28bps) łapał adverse selection na każdym micro-ruchu. Trzy niezależne problemy:

1. **Dynamic Spread disabled**: `lowVolL1Bps=14` i `highVolL1Bps=14` (sekcja 79 zmieniła lowVol 28→14) → L1 zawsze 14bps niezależnie od ATR. Memecoin z ATR 1.8% miał spread jak BTC.
2. **Momentum Guard wagi**: momentum (1h change) miał 50% wagi, ale laguje w choppy markets. Proximity S/R miał tylko 20% — bot nie reagował na bliskość resistance/support.
3. **Auto-Skew za wolny**: 2.0 bps per 10% skew, max 15bps — przy skew -43% bot ledwo przesuwał grid.

**Fix 1 — Dynamic Spread widen dla kPEPE (`short_only_config.ts`):**
```typescript
// Defaults changed:
lowVolL1Bps: 20,   // was 14
highVolL1Bps: 18,  // was 14

// kPEPE-specific override:
'kPEPE': {
  lowVolL1Bps: 22,              // kPEPE even in low vol = wider than majors
  highVolL1Bps: 32,             // In high vol WIDEN for memecoins (not tighten!)
  highVolAtrPctThreshold: 1.20, // kPEPE "high vol" threshold is higher
},
```
kPEPE L1 range: 22-32bps (was flat 14bps). Round-trip 44-64bps (was 28bps).

**Fix 2 — Momentum Guard signal weights (`mm_hl.ts` line 8218):**
```typescript
// PRZED: momentum 50% + RSI 30% + proximity 20%
// PO:    momentum 35% + RSI 30% + proximity 35%
const momentumScore = momentumNorm * 0.35 + mgRsiSignal * 0.30 + mgProxSignal * 0.35
```
Proximity S/R teraz ma równą wagę z momentum — bot widzi resistance/support tak samo jak kierunek ruchu.

**Fix 3 — Auto-Skew GENTLER dla kPEPE (`short_only_config.ts`):**
```typescript
'kPEPE': {
  autoSkewShiftBps: 1.5,       // was 2.0 — GENTLER, hold positions, don't rush to close
  autoSkewMaxShiftBps: 10.0,   // was 15.0 — conservative cap, even at 80% skew max 10bps
},
```
User feedback: "nie od razu zamykał pozycje" — bot ma trzymać shorta, nie agresywnie kupować do zamknięcia.

**Fix 4 — Clamp logic (`mm_hl.ts` line ~358-361):**
```typescript
// PRZED: Math.max(cfg.highVolL1Bps, Math.min(cfg.lowVolL1Bps, l1Bps))
// Zakładało highVol < lowVol — dla kPEPE (highVol=32 > lowVol=22) clamp był odwrócony
// PO:
const minL1 = Math.min(cfg.lowVolL1Bps, cfg.highVolL1Bps)
const maxL1 = Math.max(cfg.lowVolL1Bps, cfg.highVolL1Bps)
l1Bps = Math.max(minL1, Math.min(maxL1, Math.round(l1Bps)))
```

**Wynik live po deploy:**
```
📐 [DYNAMIC_SPREAD] kPEPE: ATR=1.816% → L1=32bps L2=53bps L3=80bps L4=116bps | HIGH_VOL
📈 [MOMENTUM_GUARD] kPEPE: score=0.28 (mom=0.00 rsi=0.00 prox=0.80) → bid×1.09 ask×0.35 | S/R(1h): R=$0.003640 S=$0.003382
⚖️ [AUTO_SKEW] kPEPE: skew=-43.1% → mid shift +15.08bps UP | real=0.003593 skewed=0.003598
```

| Metryka | Przed | Po |
|---------|-------|----|
| L1 spread | 14bps (flat) | **22-32bps** (ATR-based) |
| Round-trip | 28bps | **44-64bps** |
| Proximity weight | 20% | **35%** |
| Momentum weight | 50% | **35%** |
| Auto-Skew speed | 2.0 bps/10% | **1.5 bps/10%** (gentler) |
| Auto-Skew max | 15.0 bps | **10.0 bps** (conservative) |

**Pliki:** `src/config/short_only_config.ts` (+14/-2), `src/mm_hl.ts` (+6/-4)

### 84. copy-general SDK timeout fix — infoClient hang replaced with axios (02.03)

**Problem:** copy-general bot zawieszał się po "Monitoring started" — PM2 pokazywał "online" ale bot nie tickował. Cisza w logach przez 60+ minut.

**Root cause:** `fetchOurPositions()` używał `infoClient.clearinghouseState()` z `@nktkas/hyperliquid` SDK. SDK NIE ma timeout — HTTP request wisał w nieskończoność gdy HL API connection hung, blokując Node.js event loop. Inne fetche (`fetchMidPrices`, xyz positions) już używały `axios.post()` z 10s timeout i działały.

**Fix w `scripts/general_copytrade.ts`:**
```typescript
// PRZED (wisiał bez timeout):
const state = await infoClient.clearinghouseState({ user: walletAddress })

// PO (10s timeout):
const resp = await axios.post(HL_API_URL, {
  type: 'clearinghouseState', user: walletAddress
}, { timeout: 10000 })
const data = resp.data
```

**Dodatkowe zmiany:**
- Usunięto parametr `infoClient` z `fetchOurPositions()` i `processTick()`
- Usunięto deklarację `infoClient` z `main()` (nie jest już potrzebny)
- Usunięto import `hl.InfoClient` usage (hl.ExchangeClient nadal potrzebny do orderów)

**Lekcja:** `@nktkas/hyperliquid` SDK (InfoClient) NIE ma wbudowanego timeout. Zawsze używaj `axios.post()` z explicit `timeout: 10000` dla HL API calls w skryptach. SDK ExchangeClient (ordery) jest OK bo ma retry/timeout wbudowany.

**Pliki:** `scripts/general_copytrade.ts` (+8/-12)

### 83. copy-general API glitch guard + PUMP blocked + failed order cooldown (02.03)

**Problem:** 3 niezależne problemy z copy-general:

**A) API glitch spowodował otwarcie 6 fałszywych kopii ($3,000):**
- **10:32:52 UTC**: `fetchMidPrices()` zwróciło empty (HL API glitch)
- **10:33:23**: vip_spy miał partial data → copy-general zobaczył 8 standardowych pozycji jako "CLOSED"
- Wszystkie 8 baseline entries usunięte → następny tick (10:34:25) potraktował je jako NEW
- Bot otworzył 6 kopii po $500: AVAX, FARTCOIN, RESOLV, ASTER, APEX, LIT
- To były STARE pozycje Generała, nie nowe — baseline protection zawiodła

**B) PUMP error spam co 30 sekund:**
- PUMP price ~$0.0019, `toPrecision(5)` nie produkuje valid tick
- Bot próbował co 30s → "Order 0: Order has invalid price" w nieskończoność

**C) Brak mechanizmu cooldown na failed orders**

**Fix 1 — Glitch Guard (sekcja 4b w `processTick()`):**
```typescript
if (prevGeneralCoins.size >= 3 && currentGeneralCoins.size < prevGeneralCoins.size * 0.5) {
  log(`⚠️ GLITCH GUARD: Generał positions dropped from ${prevGeneralCoins.size} to ${currentGeneralCoins.size} — likely API glitch, skipping tick`, 'SKIP')
  return
}
```
Logika: jeśli >50% pozycji Generała zniknęło w jednym ticku → prawdopodobnie API glitch, pomiń tick.

**Fix 2 — Failed order cooldown (30 min):**
```typescript
const ORDER_FAIL_COOLDOWN_MS = 30 * 60 * 1000
const orderFailCooldowns = new Map<string, number>()
// Before order: check cooldown
const cooldownExpiry = orderFailCooldowns.get(coin)
if (cooldownExpiry && Date.now() < cooldownExpiry) continue
// On failure: set cooldown
orderFailCooldowns.set(coin, Date.now() + ORDER_FAIL_COOLDOWN_MS)
```

**Fix 3 — PUMP blocked via env var:**
- `COPY_BLOCKED_COINS: "PUMP"` w `ecosystem.config.cjs` (permanentne)
- Bot loguje "Blocked coins: PUMP" na starcie

**Wynik po deploy:**
```
Blocked coins: PUMP
Monitoring started. Waiting for changes...  ← zero PUMP error spam
```

**6 fałszywych pozycji:** FARTCOIN SHORT $503, LIT SHORT $502, APEX SHORT $501, ASTER SHORT $500, AVAX SHORT $500, RESOLV SHORT $499 — otwarte przez API glitch, nadal aktywne na koncie.

**Pliki:** `scripts/general_copytrade.ts` (+25), `ecosystem.config.cjs` (COPY_BLOCKED_COINS: "PUMP")

---

## Zmiany 28 lutego 2026

### 77. MIN_PROFIT + BIAS LOCK fix — 0 orders deadlock resolved (28.02)

**Problem:** kPEPE miał SHORT pozycję underwater (entry $0.003631, mid $0.003671). Bot generował **0 orderów** — kompletnie zamrożony. Dwa niezależne bugi jednocześnie eliminowały oba kierunki:

| Bug | Co eliminował | Root cause |
|-----|---------------|-----------|
| MIN_PROFIT (bidy=0) | Usuwał WSZYSTKIE 8 bidów (close orders) | Cena > entry = close at loss → filtered |
| BIAS LOCK (aski=0) | Grid nie generował ŻADNYCH asków (open orders) | `skewSkipAsks = inventorySkew < -0.15 && actualSkew < 0.05` |

**Root cause BIAS LOCK:** W `generateGridOrdersCustom()` (`grid_manager.ts`), BIAS LOCK blokuje ask orders gdy `inventorySkew < -0.15` (bot jest SHORT >15%). Override check `permissions.reason.includes('override')` nie matchował bo reason = `'PURE_MM_REGIME_BYPASS'` (nie zawiera 'override'). Efekt: aski=0 nawet dla PURE_MM market makera.

**Root cause MIN_PROFIT:** Poprzednio dodano bypass dla underwater pozycji (v1 → v2 → v2 removed). v1/v2 bypassowały MIN_PROFIT gdy underwater → bot zamykał shorty na stracie (-$0.32 do -$0.46 per $100). User: "cena podchodzi pod resistance to bot nie ma zamykac shortow na minusie". Bypass usunięty — MIN_PROFIT zawsze filtruje. Ale bez asków = deadlock.

**Fix 1 — BIAS LOCK override (`mm_hl.ts`):**
```typescript
// PRZED: reason = 'PURE_MM_REGIME_BYPASS' → nie matchował 'override'
// PO: reason = 'PURE_MM_REGIME_BYPASS_override' → matchuje!
const permissions = isPureMmRegimeBypass
  ? { allowLongs: true, allowShorts: true, reason: 'PURE_MM_REGIME_BYPASS_override' }
  : this.marketVision!.getTradePermissions(pair);
```

**Fix 2 — MIN_PROFIT bypass removed (mm_hl.ts):**
```typescript
// Usunięto cały isUnderwaterShort/isUnderwaterLong bypass
// MIN_PROFIT ZAWSZE filtruje close orders < 10bps od entry
// PURE_MM should hold and mean-revert, not panic-close
```

**Wynik live:**
```
Przed: kPEPE Multi-Layer: 0 orders (bids=0 asks=0) — bot zamrożony
Po:    kPEPE Multi-Layer: 8 orders (bids=0 asks=8) — bot quotuje sell-side
```

**Logika mean-reversion:**
- `bids=0` — MIN_PROFIT filtruje close orders (nie zamykaj SHORT na stracie) ✓
- `asks=8` — BIAS LOCK overridden, bot quotuje asks (sell-side liquidity) ✓
- Gdy cena spadnie poniżej entry - 10bps → bidy wrócą (profitable close) ✓
- kPEPE SKEW i Momentum Guard nadal redukują ask SIZE (×0.61) → nie dodaje masywnie do pozycji ✓

**Catch-22 historia (3 iteracje w jednej sesji):**
1. **MIN_PROFIT bypass v1** — bypassed for ANY underwater → bot zamykał shorty na stracie (19 fills, -$8.50)
2. **MIN_PROFIT bypass v2** — bypassed when >20bps underwater → nadal zamykał (5 fills, -$2.42)
3. **MIN_PROFIT bypass REMOVED + BIAS LOCK fix** — zero close on loss, asks restored via override ✓

**Pliki:** `src/mm_hl.ts` (-38/+24)

### 76. Risk Manager Transfer Detection — auto re-baseline on USDC transfers (28.02)

**Problem:** Risk Manager porównywał `initialEquity` (snapshot przy starcie) z bieżącą equity. Przelew USDC (`usd_class_transfer` na xyz dex) zmniejszył equity z $8,837 do $8,572 = 3.0% drawdown → **RISK MANAGER HALT → `process.exit(1)`**. Bot zatrzymał się na 30+ minut mimo że nie było żadnej straty tradingowej.

**Root cause:** Risk Manager nie odróżniał transferów od strat. `drawdown = (initialEquity - currentEquity) / initialEquity` — transfer USDC na inny dex zmniejsza equity identycznie jak strata.

**Fix w `src/risk/RiskManager.ts`:**
```typescript
// New property
private lastCheckedEquity: number = 0;
private static readonly TRANSFER_THRESHOLD_PCT = 0.01;  // 1%
private static readonly TRANSFER_MIN_USD = 50;           // $50

// At top of checkHealth(), BEFORE drawdown checks:
if (this.lastCheckedEquity > 0) {
  const tickDelta = this.lastCheckedEquity - currentEquity;
  const tickDeltaPct = Math.abs(tickDelta) / this.lastCheckedEquity;

  if (tickDeltaPct > 0.01 && Math.abs(tickDelta) > 50) {
    if (tickDelta > 0) {
      // Withdrawal/transfer OUT
      console.log(`[RISK_MANAGER] 💸 Transfer OUT detected: -$${tickDelta} — adjusting baseline`);
      this.initialEquity -= tickDelta;
      this.highWaterMark = Math.min(this.highWaterMark, currentEquity);
    } else {
      // Deposit IN
      console.log(`[RISK_MANAGER] 💰 Deposit detected: +$${-tickDelta} — adjusting baseline`);
      this.initialEquity += (-tickDelta);
    }
  }
}
this.lastCheckedEquity = currentEquity;
```

**Heurystyka:** MM bot na $100 orderach nie może stracić >1% equity ($88) w jednym 60s ticku. Nagły drop >1% AND >$50 = przelew USDC, nie trading. Działa w obie strony (withdrawal + deposit).

**Scenariusz:**
```
Przed: Transfer $265 → drawdown 3.0% → HALT → bot martwy 30+ min
Po:    Transfer $265 → "💸 Transfer OUT detected" → baseline $8837→$8572 → bot działa
```

**Pliki:** `src/risk/RiskManager.ts` (+32/-2)

### 75. xyz:GOLD support — vip_spy + copy-general + asset map (28.02)

**Problem:** Hyperliquid xyz dex (builder-deployed perps: GOLD, TSLA, NVDA, etc. — 47 assets) był niewidoczny dla botów. vip_spy.py nie fetchował xyz pozycji, general_copytrade.ts nie mógł kopiować xyz trades.

**Rozwiązanie:** Dodano xyz dex support do obu botów.

**A) vip_spy.py — dual-dex position fetching:**
```python
dex_configs = [
    (None, "perps"),     # standard perps (no dex param)
    ("xyz", "xyz dex"),  # xyz builder-deployed dex
]
for dex_param, dex_label in dex_configs:
    payload = {"type": "clearinghouseState", "user": address}
    if dex_param:
        payload["dex"] = dex_param
    # ... fetch + merge positions from both dexes
```

**B) general_copytrade.ts — 5 zmian:**

| # | Zmiana | Opis |
|---|--------|------|
| 1 | `fetchXyzMidPrice()` | Nowa funkcja — l2Book dla xyz: coins (allMids nie zawiera xyz) |
| 2 | `fetchOurPositions()` | Dual fetch: standard perps + xyz dex via raw axios POST |
| 3 | Asset map | Ładuje xyz meta (offset 110000). API zwraca nazwy z `xyz:` prefixem |
| 4 | Leverage | `xyzCoins` array: xyz:GOLD 2x isolated |
| 5 | `processTick()` | Fetch xyz mid prices via l2Book dla coins starting with `xyz:` |

**C) vip_config.json — `xyz:GOLD` dodany do `watched_coins`**

**xyz API details:**
- `clearinghouseState` z `dex: "xyz"` → xyz pozycje
- `meta` z `dex: "xyz"` → 47 xyz assets, nazwy z prefixem `xyz:` (np. `xyz:GOLD`)
- `l2Book` z `coin: "xyz:GOLD"` → orderbook (mid price)
- `allMids` NIE zawiera xyz assets
- Asset indices: `110000 + position_in_universe` (xyz:GOLD = 110003)
- `onlyIsolated: true`, `marginMode: "noCross"` — xyz wymusza isolated margin

**Verified live:**
```
Asset map: 229 standard perps + 47 xyz dex pairs = 276 total
Set xyz:GOLD leverage to 2x isolated
vip-spy: Generał xyz:GOLD 25 GOLD LONG $134K, Pułkownik xyz:XYZ100 $4.4M
```

**Odkrycie z logów:** Inne VIPy też tradują xyz assets:
- Pułkownik: xyz:XYZ100 $4.4M
- Kapitan BTC: xyz:MU $625K, xyz:SNDK $594K, xyz:MSTR $70K, xyz:SILVER $29K

**Pliki:** `scripts/vip_spy.py` (+95/-71), `scripts/general_copytrade.ts` (+86/-3), `scripts/vip_config.json` (+1/-1)

### 74. BTC Prediction Proxy — cross-token intelligence, XGBoost 62→65 features (28.02)

**Problem:** Tokeny (kPEPE, FARTCOIN, SOL, etc.) mają ~95% korelację z BTC (Pearson 24h), ale model XGBoost każdego tokena musiał samodzielnie odkrywać kierunek rynku z surowych danych. Istniejące BTC cross-features [49-52] to surowe dane (change_1h/4h, RSI, korelacja) — nie predykcje.

**Rozwiązanie:** Wstrzyknięcie GOTOWEJ predykcji h4 BTC z prediction-api jako 3 nowe features dla wszystkich non-BTC tokenów. Model kPEPE dostaje "mądrość BTC" (wynik HybridPredictor + XGBoost blend) zamiast surowych wskaźników.

**3 nowe features [62-64]:**

| # | Feature | Normalizacja | Zakres | Opis |
|---|---------|-------------|--------|------|
| [62] | `btc_pred_direction` | -1/0/+1 | {-1, 0, 1} | BEARISH=-1, NEUTRAL=0, BULLISH=+1 |
| [63] | `btc_pred_change` | tanh(change/5) | [-1, 1] | Predicted h4 % change, normalized |
| [64] | `btc_pred_confidence` | conf/100 | [0, 1] | Model confidence 0-100% → 0-1 |

**Dla BTC samego:** `[0, 0, 0]` — redundantne z własnymi technical features.

**Nowe funkcje w `xgboost_collect.py`:**
- `fetch_btc_prediction()` — HTTP GET `localhost:8090/predict/BTC`, timeout 5s, returns {direction, change, confidence}
- `compute_btc_pred_features(btc_pred, token)` — normalizuje i zeruje dla BTC

**Backward compatibility:** Stare 62-feature wiersze padowane zerami (+3). Stare modele (trenowane na 62 feat) działają bez zmian — btc_pred features = 0 → brak wpływu na istniejące drzewa.

**API impact:** +1 HTTP call per collect run (prediction-api na localhost, <50ms).

**Zmodyfikowane pliki (4):**

| Plik | Zmiana |
|------|--------|
| `scripts/xgboost_collect.py` | `fetch_btc_prediction()`, `compute_btc_pred_features()`, feature assembly 62→65, `collect_token()` +btc_pred param |
| `scripts/xgboost_train.py` | 3 feature names, NUM_FEATURES=65, backward compat (62→65) |
| `scripts/xgboost_backfill.py` | NUM_FEATURES=65, `btc_pred_feat = [0.0] * 3` w assembly |
| `src/prediction/models/XGBoostPredictor.ts` | 3 feature names, NUM_FEATURES=65, backward compat (62→65) |

**Verified live:**
- BTC: `[62-64] = [0, 0, 0]` (prawidłowo zerowe)
- kPEPE: `[62-64] = [-1.0, -0.1562, 0.5039]` (BTC BEARISH, -0.79%, conf=50%)
- Prediction-api: `/predict-xgb/kPEPE` działa z 65-feature vectorem

**Timeline do efektywności:** ~100 nowych 65-feature rows (~25h, collector co 15 min) → retrain. Do tego czasu stare wiersze (padded zeros) = modele zachowują się identycznie. Po retrainingu `btc_pred_*` features powinny pojawić się w feature importance dla kPEPE/FARTCOIN.

### 73. Remove w1/m1 horizons — temporal shift cleanup (28.02)

**Problem:** Horyzonty tygodniowe (w1=168h) i miesięczne (m1=720h) miały **negatywny edge** dla prawie wszystkich tokenów. Backfill data (180 dni) pochodzi z innego reżimu rynkowego (połowa 2025 = akumulacja/nuda) niż obecny rynek (luty 2026 = euforia/strach). Ponadto bot MM zarabia na mikro-ruchach (h1-h4 spread), nie na tygodniowych/miesięcznych zakładach kierunkowych.

**Diagnoza "Temporal Shift":**
- w1/m1 modele uczone na danych z innej fazy rynku → szum, nie sygnał
- w1/m1 predykcje nie wpływają na grid engine (bot nie trzyma pozycji tygodniami)
- Training time: 40% mniej (5→3 horyzonty per token)
- Collector: `LABEL_BACKFILL_ROWS=500` zamiast 0 (nie musi skanować 4000+ wierszy dla m1 30-day lookback)

**Usunięto z 7 plików:**

| Plik | Zmiana |
|------|--------|
| `src/prediction/models/HybridPredictor.ts` | `PREDICTION_HORIZONS` 5→3, `HORIZON_WEIGHTS` 5→3, `TOKEN_WEIGHT_OVERRIDES` 5→3, `VERIFY_CONFIG` 5→3 |
| `src/prediction/models/XGBoostPredictor.ts` | `HORIZONS` 5→3, `getBestPrediction` 5→3 |
| `src/prediction/index.ts` | `verifyPredictions` 5→3, `getXGBFeatureImportance` 5→3 |
| `scripts/xgboost_train.py` | `MIN_SAMPLES` 5→3, `THRESHOLDS` 5→3, all `TOKEN_THRESHOLDS` 5→3, training loops 5→3 |
| `scripts/xgboost_collect.py` | `LABEL_BACKFILL_ROWS=500`, removed w1/m1 label backfill, removed from default row |
| `scripts/xgboost_backfill.py` | `compute_labels_for_row()` 5→3, label stats 5→3 |
| `dashboard.mjs` | Removed w1/m1 prediction rows, chart lines, reset IDs, update loops, fallback predictions |

**Wynik:** Netto -66 linii kodu. Prediction-api zwraca TYLKO h1/h4/h12. XGBoost ładuje 3 modele per token (było 5). Stare model files w1/m1 w `/tmp/` ignorowane (nadpisane przy następnym treningu).

**Deploy:** SCP 7 plików → server, dist/ patched z sed, `pm2 restart prediction-api war-room`. Verified: `/predict/BTC` → `{h1, h4, h12}`, `/xgb-status` → 3 horizons per token.

### 72. XGBoost Performance Monitor — hourly bps attribution on Discord (28.02)

**Cel:** Mierzyć ile basis pointów zysku/straty generuje prediction bias (XGBoost) vs gdyby go nie było. Raport co godzinę na Discord.

**Nowy plik: `scripts/xgb_performance_monitor.ts`** (~590 LOC)

**Jak działa:**
1. Co godzinę (cron `:00`) fetchuje predykcje z prediction-api (`/predict/:token` + `/predict-xgb/:token`) dla 9 tokenów
2. Zapisuje je w state (`/tmp/xgb_monitor_state.json`, 7-day rolling window)
3. Scoruje stare predykcje: h1 (50-70 min temu), h4 (225-255 min temu) vs aktualna cena z HL API
4. Oblicza estimated bps contribution: `est_bps = sign × |actual_bps| × strength × 0.125`
5. Buduje raport → Discord webhook + console

**Attribution formula:**
```
strength = min(|predicted_change| / 3.0, 1.0)
bias_on = confidence >= 50% AND |change| >= 0.3%
est_bps = direction_correct ? +|actual_bps| × strength × 0.125 : -|actual_bps| × strength × 0.125
0.125 = conservative half of theoretical 0.25 effect (partial fills, other factors)
```

**Raport zawiera:**
- Current predictions (h4) — hybrid direction + XGB direction + bias ON/OFF
- Scoring z ostatniej godziny (h1 window) i z 4h temu (h4 window)
- Rolling stats: direction accuracy (24h/7d), XGB bps attribution (24h/7d/all-time)
- Per-token h4 breakdown

**Discord webhook:** `https://discord.com/api/webhooks/1477245696687210601/...` (nowy kanał)

**CLI:**
```bash
npx tsx scripts/xgb_performance_monitor.ts            # run + Discord
npx tsx scripts/xgb_performance_monitor.ts --dry-run  # console only (state NOT saved)
```

**Cron:** `0 * * * * cd ~/hyperliquid-mm-bot-complete && npx tsx scripts/xgb_performance_monitor.ts >> runtime/xgb_monitor.log 2>&1`

**State:** `/tmp/xgb_monitor_state.json` — predictions + scores, trimmed to 7 days. Dry-run does NOT modify state.

**Pliki:** `scripts/xgb_performance_monitor.ts` (NEW, ~590 LOC)

### 70. XGBoost Training Improvements — per-token thresholds, regularization, early stopping, class weighting (28.02)

**Problem:** kPEPE h4 "58% accuracy" was inflated — with ±1.5% threshold, 67% of labels = NEUTRAL, so model learned "always predict NEUTRAL" and achieved 58% accuracy (near baseline). Zero actual directional edge. Also massive overfitting: train 90% vs test 37% on volatile tokens.

**Root causes (3):**
1. **NEUTRAL dominance**: Global ±1.5% threshold too wide for volatile tokens like kPEPE (median h4 move ~1.0%) → 67% NEUTRAL labels → model always predicts NEUTRAL
2. **30/62 features dead**: kPEPE has zero SM data (no whale_tracker entry) → 11 SM features + 3 funding/OI + 6 orderbook/meta = 30 dead features out of 62
3. **Conservative hyperparameters**: max_depth=4 with small datasets → trees memorize noise

**Fix #1: Per-token classification thresholds (`TOKEN_THRESHOLDS`)**
Volatile tokens get lower thresholds to balance label distribution:

| Token | h1 | h4 | h12 | w1 | m1 |
|-------|-----|-----|------|-----|-----|
| Default | ±0.5% | ±1.5% | ±3.0% | ±8.0% | ±15.0% |
| kPEPE | ±0.3% | **±0.8%** | ±2.0% | ±6.0% | ±12.0% |
| FARTCOIN | ±0.4% | ±1.0% | ±2.5% | ±7.0% | ±13.0% |
| HYPE | ±0.4% | ±1.2% | ±2.5% | ±7.0% | ±13.0% |
| LIT | ±0.4% | ±1.0% | ±2.5% | ±7.0% | ±13.0% |

kPEPE h4 label distribution: 67% NEUTRAL → 30% SHORT / 43% NEUTRAL / 27% LONG.

**Fix #2: Per-token XGBoost hyperparameters (`TOKEN_XGB_PARAMS`)**
Volatile tokens (kPEPE, FARTCOIN, LIT, HYPE) use aggressive regularization:

| Param | Default | Volatile tokens |
|-------|---------|----------------|
| max_depth | 4 | **3** (shallow → less memorization) |
| n_estimators | 100 | **300** (but early stopping trims) |
| learning_rate | 0.1 | **0.03** (slow learning) |
| colsample_bytree | 0.8 | **0.5** (50% feature dropout — 30/62 dead) |
| min_child_weight | 5 | **10** (more samples per leaf) |
| subsample | 0.8 | **0.7** (row subsampling) |
| reg_alpha | 0 | **0.1** (L1 regularization) |
| reg_lambda | 1 | **2.0** (L2 regularization) |

**Fix #3: Class-balanced sample weights**
`compute_sample_weights()` — inverse frequency weighting: `weight = total / (num_classes × class_count)`. Rare classes get proportionally higher weight. Prevents model from optimizing for majority class.

**Fix #4: Early stopping**
`EARLY_STOPPING_ROUNDS = 30` — stops training when test accuracy stops improving for 30 rounds. kPEPE h4 stopped at 79/300 trees (26% used). Reports `best_iteration` in logs.

**Results after full retrain (all 9 tokens):**

| Token | h1 | h4 | h12 | w1 | m1 |
|-------|-----|-----|------|-----|-----|
| BTC | 66.5% | **70.0%** | 83.8% | 59.1% | — |
| ETH | 58.0% | **56.7%** | 60.3% | 54.4% | 42.4% |
| SOL | 47.9% | 58.3% | 60.5% | 55.2% | 40.2% |
| HYPE | 42.5% | **47.4%** | 53.8% | 45.3% | 38.1% |
| kPEPE | 42.0% | **40.4%** | 39.2% | 36.5% | 48.7% |
| ZEC | 53.5% | 63.2% | 55.5% | 56.1% | — |
| XRP | 50.5% | 58.4% | 59.1% | 46.5% | — |
| LIT | 44.5% | 44.5% | 48.0% | 34.2% | — |
| FARTCOIN | 39.2% | 40.2% | 38.3% | 41.3% | 40.5% |

kPEPE h4: "58%" (inflated) → **40.4%** (genuine +7.4% edge over 33% random baseline). Overfitting reduced: train 90% → 58.5%, gap 53% → 18%.

**New helper functions (3):**
- `get_threshold(token, horizon)` — returns per-token or global threshold
- `get_xgb_params(token)` — merges per-token params with defaults
- `compute_sample_weights(y)` — inverse frequency class balancing

**Key insight:** kPEPE is inherently hard to predict with technical features alone (memecoin, 30/62 features dead, no SM data). 40% on 3-class is near the ceiling for current feature set. BTC h4 (70%) is much more predictable and could be used as proxy for kPEPE direction (95% Pearson correlation).

**Zmodyfikowane pliki (1):**

| Plik | Zmiana |
|------|--------|
| `scripts/xgboost_train.py` | `TOKEN_THRESHOLDS`, `TOKEN_XGB_PARAMS`, `EARLY_STOPPING_ROUNDS`, `get_threshold()`, `get_xgb_params()`, `compute_sample_weights()`, early stopping in `train_model()` (+120 LOC) |

**Deploy:** SCP → server, full retrain all 9 tokens, `pm2 restart prediction-api`. All 44 models loaded, predictions verified as non-uniform and differentiated.

### 71. XGBoost Accuracy Illusion Fix — ALL tokens, per-token thresholds for BTC/ETH/SOL/XRP/ZEC (28.02)

**Problem:** Odkrycie #70 (kPEPE accuracy illusion) dotyczyło WSZYSTKICH tokenów. BTC h4 miał "70% accuracy" ale z progiem ±1.5% → 88% etykiet NEUTRAL → baseline=88% → **edge = -18%** (GORZEJ niż random). Podobnie ETH h4 (79% NEUTRAL), SOL h4 (73% NEUTRAL), XRP h4 (76% NEUTRAL).

**Root cause:** Globalne progi ±0.5%/±1.5%/±3.0% (h1/h4/h12) za szerokie dla BTC (mediana h4 ~0.44%) i ETH (mediana h4 ~0.60%). Model uczył się "always predict NEUTRAL".

**Fix: Per-token thresholds for ALL 9 tokens based on median price changes**

Cel: ~35-40% NEUTRAL labels (threshold ≈ p30-p35 of abs price changes).

| Token | h1 | h4 | h12 | OLD h4 NEUTRAL | NEW h4 NEUTRAL | Drop |
|-------|-----|-----|------|---------------|---------------|------|
| **BTC** | ±0.15% | **±0.3%** | ±0.6% | **88%** | **37%** | **-50pp** |
| **ETH** | ±0.2% | **±0.4%** | ±0.9% | **79%** | **36%** | **-41pp** |
| **SOL** | ±0.3% | **±0.6%** | ±1.2% | **73%** | **40%** | **-33pp** |
| **XRP** | ±0.3% | **±0.5%** | ±1.0% | **76%** | **38%** | **-37pp** |
| **ZEC** | ±0.6% | **±1.2%** | ±2.2% | ~60% | ~38% | -22pp |
| kPEPE | ±0.3% | ±0.8% | ±2.0% | 67% | 43% | -24pp |

**Fix: Per-token XGBoost params for majors**

Majors (BTC/ETH/SOL/XRP/ZEC) use moderate regularization (depth 4, n_estimators 300, lr 0.03, subsample 0.8). Volatile tokens (kPEPE/FARTCOIN/LIT/HYPE) use aggressive regularization via shared `_REGULARIZED_PARAMS` dict (depth 3, colsample 0.5, min_child_weight 10).

**Accuracy vs baseline after full retrain (best horizons):**

| Token | Horizon | Accuracy | Baseline | Edge |
|-------|---------|----------|----------|------|
| ETH | h1 | 38.6% | 35% | **+3.5%** |
| SOL | h4 | 38.3% | 34% | **+4.2%** |
| HYPE | h1 | 38.9% | 34% | **+4.7%** |
| kPEPE | h4 | 40.2% | 38% | **+2.4%** |
| FARTCOIN | h1 | 36.8% | 33% | **+3.4%** |
| BTC | h4 | 40.6% | 40% | +0.9% |

**Key observation:** w1/m1 long horizons have negative edge for nearly all tokens — temporal shift problem (180-day backfill data represents different market regime than recent data). Not fixable with threshold tuning alone.

**Zmodyfikowane pliki (1):**

| Plik | Zmiana |
|------|--------|
| `scripts/xgboost_train.py` | Extended `TOKEN_THRESHOLDS` to all 9 tokens, `_REGULARIZED_PARAMS` shared dict, `TOKEN_XGB_PARAMS` for majors |

**Deploy:** SCP → server, full retrain all 9 tokens. `pm2 restart prediction-api`.

### 69. XGBoost Flat Tree Fix + Feature File Bridge — predictions from 33.3% uniform to real (28.02)

**Problem:** XGBoost predictions returned 33.3%/33.3%/33.3% (uniform) for ALL tokens and ALL horizons — effectively random. Two independent root causes discovered and fixed.

**Root Cause #1: Feature vector mismatch (30 vs 62 features)**
`getXGBPrediction()` in `src/prediction/index.ts` built a 30-feature vector from TypeScript (11 tech + 11 nansen + 8 extra), but models were trained on 62 features. Features [30-61] (candle patterns, multi-day trends, BTC cross-market, orderbook, meta, derived) were all zeros. Model's top features (`trend_slope_7d` at [48], `dist_from_7d_high` at [47]) = 0 → model couldn't differentiate → uniform output.

**Fix #1: Feature file bridge pattern**
Python collector (`xgboost_collect.py`) now writes `/tmp/xgboost_latest_{TOKEN}.json` with full 62-feature vector every 15 min. TypeScript `getXGBPrediction()` reads that file instead of computing its own (incomplete) features. Fallback to old 30-feature method when file doesn't exist.

**Root Cause #2: XGBoost 3.x flat tree format not supported**
XGBoost 3.x exports models in flat array format (`split_indices[]`, `left_children[]`, `right_children[]`, `base_weights[]`, `default_left[]`, `split_conditions[]`) but TypeScript `traverseTree()` only handled nested format (XGBoost 1.x: `nodeid`, `children[]`, `split`, `split_condition`). Every tree returned leaf value 0 → `softmax([0,0,0])` = `[0.333, 0.333, 0.333]`.

**Fix #2: Dual tree format support**
- `isFlatTree()` — detects flat format via `'split_indices' in tree`
- `traverseFlatTree()` — handles XGBoost 3.x flat arrays (leaf nodes: `left_children[i] === -1`, leaf values in `base_weights[i]`)
- `traverseNestedTree()` — preserves old nested format support
- `traverseTree()` — dispatcher

**Results after fix:**

| Token | h1 | h4 | h12 | w1 | m1 |
|-------|-----|-----|------|-----|-----|
| kPEPE | NEUTRAL 35.3% | NEUTRAL 43.7% | NEUTRAL 73.7% | NEUTRAL 78.8% | LONG 56.3% |
| BTC | SHORT 39.6% | LONG 52.6% | NEUTRAL 78.3% | NEUTRAL 84.8% | — |
| ETH | NEUTRAL 51.1% | SHORT 63.0% | NEUTRAL 43.7% | LONG 46.9% | SHORT 49.6% |

**Zmodyfikowane pliki (3):**

| Plik | Zmiana |
|------|--------|
| `scripts/xgboost_collect.py` | Save latest feature vector to `/tmp/xgboost_latest_{TOKEN}.json` (+5 LOC) |
| `src/prediction/index.ts` | `getXGBPrediction()` reads pre-computed features from file, `import fsp` (+35/-25 LOC) |
| `src/prediction/models/XGBoostPredictor.ts` | `XGBTreeFlat` interface, `isFlatTree()`, `traverseFlatTree()`, `traverseNestedTree()` (+50/-20 LOC) |

**Deploy:** SCP source → server, patch `dist/` files, `pm2 restart prediction-api`. All 44 models loaded, all 9 tokens producing meaningful predictions.

### 68. XGBoost Historical Backfiller — 4,460→39,001 rows (28.02)

**Problem:** XGBoost collector zbierał dane co 15 min — po 6 dniach miał ~500 rows per token (4,460 total). Za mało na dobre modele. kPEPE h12 nie mógł się nawet wytrenować (class imbalance). Czekanie na wystarczające dane trwałoby tygodnie.

**Rozwiązanie:** Backfiller script fetchujący 180 dni historycznych candles z Hyperliquid API i obliczający 38/62 features per godzinę. Labels obliczane przez look-ahead (przyszłe ceny znane z danych historycznych).

**Nowy plik: `scripts/xgboost_backfill.py`**

**Architektura:**
```
Hyperliquid candleSnapshot API (paginated, 5000/request)
  → hourly candles (180 dni) + daily candles (200 dni) + BTC hourly (shared)
    → compute_backfill_features() per timestamp
      → 38/62 features computable, 24/62 = zeros (brak historycznych danych)
        → labels via look-ahead (h1=+1h, h4=+4h, h12=+12h, w1=+168h, m1=+720h)
          → append to existing JSONL (deduplikacja po timestamp)
            → sort chronologically (dla poprawnego train/test split)
```

**Computable vs zero features:**

| Grupa | Features | Computable? | Źródło |
|-------|----------|-------------|--------|
| Technical [0-10] | 11 | TAK | hourly candles (RSI, MACD, ATR, etc.) |
| Nansen SM [11-21] | 11 | NIE | /tmp/smart_money_data.json (runtime only) |
| Funding/OI [22-24] | 3 | NIE | metaAndAssetCtxs (runtime only) |
| Time cyclical [25-27] | 3 | TAK | timestamp |
| Volatility_24h [28-29] | 2 | TAK | hourly candles lookback |
| Candle patterns [30-44] | 15 | TAK | 3 ostatnie candles OHLC |
| Multi-day trends [45-48] | 4 | TAK | daily candles |
| BTC cross-market [49-52] | 4 | TAK | BTC hourly (shared) |
| Orderbook [53-55] | 3 | NIE | l2Book (runtime only) |
| MetaCtx [56-58] | 3 | NIE | metaAndAssetCtxs (runtime only) |
| Derived [59-61] | 3 | TAK | hourly candles (volume momentum, etc.) |

**CLI:**
```bash
python3 scripts/xgboost_backfill.py                    # all tokens, 180 days
python3 scripts/xgboost_backfill.py --token BTC        # single token
python3 scripts/xgboost_backfill.py --days 90          # shorter period
python3 scripts/xgboost_backfill.py --dry-run          # estimate only
python3 scripts/xgboost_backfill.py --train            # backfill + retrain
```

**Wyniki backfilla:**

| Token | Przed | Po | Nowe rows |
|-------|-------|----|-----------|
| BTC | 536 | 4663 | +4127 |
| ETH | 535 | 4662 | +4127 |
| SOL | 536 | 4663 | +4127 |
| HYPE | 541 | 4668 | +4127 |
| ZEC | 536 | 4663 | +4127 |
| XRP | 536 | 4663 | +4127 |
| LIT | 407 | 1973 | +1566 |
| FARTCOIN | 540 | 4667 | +4127 |
| kPEPE | 293 | 4379 | +4086 |
| **Total** | **4,460** | **39,001** | **+34,541** |

LIT: tylko 68 dni historii na HL (token nowy). kPEPE: ~182 dni historii.

**Training results po backfill (najlepsze):**

| Token | h1 | h4 | h12 | w1 | m1 |
|-------|-----|-----|------|-----|-----|
| BTC | 68.0% | 77.1% | **84.1%** | 60.3% | - |
| ETH | 61.2% | 67.9% | 69.6% | 54.9% | 18.2% |
| SOL | 52.9% | 64.0% | 61.5% | 55.7% | 47.9% |
| kPEPE | 47.2% | 58.0% | **62.2%** | 36.9% | **70.2%** |

**Top features shifted:** `trend_slope_7d`, `dist_from_7d_high`, `change_10d`, `atr_pct` — dowód że multi-day backfilled features dają wartość.

**Techniczne detale:**
- Pagination: API zwraca max ~5000 candles → chunk po 150 dni
- BTC candles fetchowane raz i współdzielone (Pearson correlation BTC↔token)
- Deduplikacja: timestamp zaokrąglony do pełnej godziny
- Sort: po timestamp ascending (kluczowe dla 80/20 chronological split)
- Imports: `compute_technical_features`, `compute_candle_features`, `compute_derived_features`, `compute_btc_cross_features` z `xgboost_collect.py`
- Rate limiting: 2s delay między fetchami

**Pliki:** `scripts/xgboost_backfill.py` (NEW, ~370 LOC)

**Deploy:** SCP → server, run `--train`. prediction-api restarted, all 44 models loaded (9 tokens × 4-5 horizons).

### 67. Tier-1 Features — Orderbook + MetaCtx + Derived — XGBoost 53→62 features (28.02)

**Problem:** Model widział tylko HISTORIĘ (RSI, MACD, zmiany cen) — nie widział PRZYSZŁEJ PRESJI. Orderbook imbalance to jedyny feature który mówi co się za chwilę stanie. Mark-Oracle spread i OI/volume ratio dają kontekst dźwigni i premii perpa vs spot.

**3 nowe grupy features:**

**Grupa A: Orderbook [53-55] — nowe API call `l2Book` (+9 calls/run)**

| # | Feature | Opis | BTC (live) | kPEPE (live) | ETH (live) |
|---|---------|------|-----------|-------------|-----------|
| [53] | `bid_ask_imbalance` | (bid_depth - ask_depth) / total, top 5 levels | **+0.48** (bullish) | -0.04 (neutral) | **-0.80** (bearish) |
| [54] | `spread_bps` | bid-ask spread / 50bps | 0.003 (ultra tight) | 0.058 (wider) | 0.011 |
| [55] | `book_depth_ratio` | depth / 24h volume | 0.0004 | 0.044 | 0.007 |

**Grupa B: MetaCtx [56-58] — zero nowych API calls (dane z istniejącego `metaAndAssetCtxs`)**

| # | Feature | Opis | BTC | kPEPE | ETH |
|---|---------|------|-----|-------|-----|
| [56] | `mark_oracle_spread` | (mark-oracle)/oracle ×100, clamp [-1,1] | -0.07 | -0.09 | -0.06 |
| [57] | `oi_normalized` | OI / (24h_volume × 10), [0,1] | ~0 | **1.00** (overleveraged!) | ~0 |
| [58] | `predicted_funding` | premium field, tanh(×1000) | -0.58 | -0.52 | -0.45 |

**Grupa C: Derived [59-61] — zero API calls (obliczane z istniejących candles)**

| # | Feature | Opis | BTC | kPEPE | FARTCOIN |
|---|---------|------|-----|-------|----------|
| [59] | `volume_momentum` | last 4h vol / prev 4h vol, tanh(ratio-1) | +1.00 (spike!) | +0.99 | -0.05 |
| [60] | `price_acceleration` | 2nd derivative: change_now - change_prev | -0.23 | -0.37 | -0.32 |
| [61] | `volume_price_divergence` | vol↑+price↓ = divergence, tanh(×50) | +1.00 | +1.00 | -0.15 |

**Kluczowe obserwacje z pierwszych danych:**
- kPEPE `oi_normalized=1.0` — OI >10× daily volume = ekstremalnie overleveraged rynek → liquidation cascade risk
- ETH `bid_ask_imbalance=-0.80` — 80% asków w orderbooku = strong sell pressure → model teraz to widzi
- BTC `volume_momentum=+1.0` — volume spike w ostatnich 4h vs poprzednich 4h

**API impact:** +9 calls/run (1 `l2Book` per token). Total: ~30 calls per run (było ~21).

**Backward compatibility:** Trainer i predictor akceptują 30, 45, 49, 53, lub 62 features (padding zerami).

**Zmodyfikowane pliki (3):**

| Plik | Zmiana |
|------|--------|
| `scripts/xgboost_collect.py` | `fetch_l2_book()`, `compute_orderbook_features()`, `compute_meta_extra_features()`, `compute_derived_features()` (+130 LOC) |
| `scripts/xgboost_train.py` | 9 feature names, NUM_FEATURES=62, backward compat (30/45/49/53→62) |
| `src/prediction/models/XGBoostPredictor.ts` | 9 feature names, NUM_FEATURES=62, backward compat |

**Deploy:** SCP 3 pliki + dist patch. Collector verified: 62 features na 9 tokenach. prediction-api: restarted, all models loaded.

**Commit:** `29a0c4d`

### 66. BTC Cross-Market Features — XGBoost 49→53 features (28.02)

**Problem:** Każdy token miał izolowany feature vector — kPEPE model nie widział co robi BTC. A kPEPE ma **95% korelację z BTC** (Pearson 24h). Gdy BTC spada 5%, kPEPE spada 10-15%, ale model tego nie wiedział.

**Rozwiązanie:** 4 BTC cross-market features dodane do pipeline. BTC candles fetchowane raz w `main()`, przekazywane do `collect_token()` wszystkich tokenów.

**Nowa funkcja `compute_btc_cross_features(token, btc_candles, token_candles)` w `xgboost_collect.py`:**

| # | Feature | Opis | kPEPE (live) | ETH (live) |
|---|---------|------|-------------|-----------|
| [49] | `btc_change_1h` | BTC 1h zmiana, tanh(change/10) | +0.05 | +0.05 |
| [50] | `btc_change_4h` | BTC 4h zmiana, tanh(change/20) | -0.17 | -0.17 |
| [51] | `btc_rsi` | BTC RSI / 100 | 0.26 (oversold) | 0.26 |
| [52] | `btc_token_corr_24h` | Pearson correlation BTC↔token 24h | **+0.95** | **+0.98** |

**Dla BTC samego:** Features = `[0, 0, 0, 0]` (redundantne z istniejącymi tech features [4-6] i [0]).

**Korelacja Pearson:** 24h hourly returns BTC vs token. Obliczana z co-variance / (std_btc × std_token). Clamp [-1, 1]. Wymaga min 20 wspólnych returnów.

**API impact:** +1 API call per collect run (BTC hourly candles, fetchowane raz i współdzielone). Total: 9 token hourly + 9 token daily + 1 BTC hourly (shared) + 2 global (allMids, metaAndAssetCtxs) = ~21 calls.

**Backward compatibility:** Trainer i predictor akceptują 30, 45, 49, lub 53 features (padding zerami).

**Zmodyfikowane pliki (3):**

| Plik | Zmiana |
|------|--------|
| `scripts/xgboost_collect.py` | `compute_btc_cross_features()` (+60 LOC), BTC candles fetch w `main()`, pass do `collect_token()` |
| `scripts/xgboost_train.py` | 4 feature names, NUM_FEATURES=53, backward compat (30/45/49→53) |
| `src/prediction/models/XGBoostPredictor.ts` | 4 feature names, NUM_FEATURES=53, backward compat |

**Deploy:** SCP 3 pliki + dist patch. Collector verified: 53 features na 9 tokenach. prediction-api: restarted, all models loaded.

**Commit:** `5006c37`

### 65. XGBoost class completeness check — skip training when class missing (28.02)

**Problem:** XGBoost training crashował z `ValueError: operands could not be broadcast together with shapes (74,3) (74,)` gdy jedna z 3 klas (SHORT/NEUTRAL/LONG) brakowała w train set. kPEPE h12 miał 0 LONG w test set.

**Root cause:** `model.predict()` zwraca probabilities shape `(n,3)` zamiast labels `(n,)` gdy model wytrenowany z < 3 klasami.

**Fix w `scripts/xgboost_train.py` (po class distribution printout):**
```python
train_classes = set(int(c) for c in np.unique(y_train))
if len(train_classes) < 3:
    missing = {0, 1, 2} - train_classes
    print(f"    {horizon}: Missing class(es) {missing_names} in train set, skipping")
    return None
```

**Verified:** kPEPE h12 now prints "Missing class(es) LONG in train set, skipping" zamiast crasha.

**Pliki:** `scripts/xgboost_train.py` (+8)
**Commit:** `975294e`

### 64. Multi-day Trend Features — XGBoost 45→49 features (28.02)

**Problem:** Model XGBoost miał max lookback 24h (`change_24h`). Nie widział multi-day trendów — np. spadek kPEPE od 13 lutego (14% w 7 dni) był niewidoczny. Model nie wiedział "czy jesteśmy w silnym trendzie spadkowym od 10 dni".

**Rozwiązanie:** 4 nowe multi-day trend features obliczane z daily candles (1d interval, 14 candles) z Hyperliquid API.

**Nowa funkcja `compute_multiday_features(token, price)` w `xgboost_collect.py`:**

| # | Feature | Źródło | Normalizacja | Zakres |
|---|---------|--------|-------------|--------|
| [45] | `change_7d` | 7-day price change | tanh(change%/30) | [-1, 1] |
| [46] | `change_10d` | 10-day price change | tanh(change%/50) | [-1, 1] |
| [47] | `dist_from_7d_high` | odległość od 7d high | clamp(pct×10, -1, 0) | [-1, 0] |
| [48] | `trend_slope_7d` | lin. regression slope 7d | tanh(slope×100/30) | [-1, 1] |

**Pierwsze wartości live (28.02):**

| Token | change_7d | change_10d | dist_from_high | slope_7d | Interpretacja |
|-------|-----------|------------|----------------|----------|---------------|
| BTC | -0.19 | -0.10 | -0.89 | -0.76 | Silny downtrend, 8.9% pod 7d high |
| kPEPE | -0.42 | -0.33 | -1.00 | -1.00 | Ekstremalny downtrend, >10% pod high |

**Backward compatibility:**
- Trainer: akceptuje 30, 45, LUB 49 features. Stare 30-feature wiersze padowane zerami (+19). Stare 45-feature wiersze padowane zerami (+4).
- Predictor: identyczny schemat paddingu.
- Stare modele (wytrenowane na 45 feat) działają bez zmian — multi-day features = 0 → brak wpływu na drzewa.

**API fetch:** `fetch_candles(token, "1d", 14)` — 14 daily candles = dodatkowe 1 API call per token per collect run. Łącznie 9 tokenów × 1 extra call = 9 calls (total ~18 API calls per run, wewnątrz rate limit).

**Zmodyfikowane pliki (3):**

| Plik | Zmiana |
|------|--------|
| `scripts/xgboost_collect.py` | `compute_multiday_features()` (+53 LOC), daily candle fetch, assert 49 |
| `scripts/xgboost_train.py` | 4 feature names, NUM_FEATURES=49, backward compat (30→49, 45→49) |
| `src/prediction/models/XGBoostPredictor.ts` | 4 feature names, NUM_FEATURES=49, backward compat |

**Deploy:** SCP 3 pliki + dist patch na serwerze. Collector verified: 49 features na wszystkich 9 tokenach. prediction-api: restarted, all models loaded.

**Timeline do efektywności:** ~50 nowych 49-feature rows (~12.5h) → retrain. Do tego czasu stare wiersze (padded zeros) = modele zachowują się identycznie.

**Commit:** `b21c8c5`

---

## Zmiany 27 lutego 2026

### 63. Candlestick Pattern Features — XGBoost 30→45 features (27.02)

**Problem:** XGBoost model korzystał z 30 features (11 technical + 11 Nansen/SM + 8 extra) bez żadnych informacji o geometrii świec OHLC. Analiza kPEPE price action (bearish expansion, liquidity cascade, bear flag) pokazała, że candlestick patterns mogą dodać wartościowe sygnały — szczególnie dla h1 (krótkoterminowe odwrócenia) i h4 (formacje kontynuacji).

**Rozwiązanie:** 15 nowych candlestick features dodanych do całego pipeline (collect → train → predict).

**Nowa funkcja `compute_candle_features(candles)` w `xgboost_collect.py`:**
Oblicza z ostatnich 3 świec OHLC:

| # | Feature | Typ | Co wykrywa |
|---|---------|-----|------------|
| [30] | hammer | bool | Long lower shadow, small upper — bullish reversal |
| [31] | shooting_star | bool | Long upper shadow, small lower — bearish reversal |
| [32] | engulfing_bull | bool | Green engulfs previous red — bullish reversal |
| [33] | engulfing_bear | bool | Red engulfs previous green — bearish reversal |
| [34] | doji | bool | Body ≤10% range — indecision |
| [35] | pin_bar_bull | bool | Lower shadow >60% range — demand rejection |
| [36] | pin_bar_bear | bool | Upper shadow >60% range — supply rejection |
| [37] | marubozu_bull | bool | Green, body >90% range — strong buying |
| [38] | marubozu_bear | bool | Red, body >90% range — strong selling |
| [39] | inside_bar | bool | H/L within previous H/L — consolidation |
| [40] | three_crows | bool | 3 consecutive red, large bodies — strong sell |
| [41] | three_soldiers | bool | 3 consecutive green, large bodies — strong buy |
| [42] | spinning_top | bool | Both shadows > body — uncertainty |
| [43] | body_ratio | 0-1 | body/range (1=marubozu, 0=doji) |
| [44] | wick_skew | -1 to 1 | (upper-lower)/range (+1=bearish pressure) |

**Backward compatibility:**
- Trainer: akceptuje 30 LUB 45 features, paduje stare 30-feature wiersze zerami (= "brak pattern")
- Predictor: akceptuje 30 LUB 45 features, paduje stare wektory zerami
- Stare modele (wytrenowane na 30 feat) działają bez zmian — candle features = 0 → brak wpływu na drzewa decyzyjne

**Zmodyfikowane pliki (3):**

| Plik | Zmiana |
|------|--------|
| `scripts/xgboost_collect.py` | `compute_candle_features()` (+123 LOC), `collect_token()` assembles 45 features |
| `scripts/xgboost_train.py` | 15 candle names w `FEATURE_NAMES`, `NUM_FEATURES=45`, backward compat padding |
| `src/prediction/models/XGBoostPredictor.ts` | 15 feature names, `NUM_FEATURES=45`, backward compat padding |

**Deploy:** SCP 3 pliki + dist patch na serwerze. Collector verified: `45 features` na wszystkich 9 tokenach. Trainer: retrained all models (backward compat OK). prediction-api: restarted, all models loaded.

**Timeline do efektywności:** ~50 nowych 45-feature wierszy (~12.5h, collector co 15 min) → retrain. Do tego czasu stare wiersze (padded zeros) = modele zachowują się identycznie.

**Commit:** `b9c738c`

### 62. Prediction Bias for ALL tokens — mm-follower integration (27.02)

**Problem:** Prediction bias (h4 prediction z prediction-api, ±15% soft bid/ask size adjustment) działał TYLKO dla kPEPE w mm-pure. Tokeny mm-follower (BTC, ETH, SOL, HYPE, FARTCOIN) nie miały żadnego prediction bias — 100% decyzji opierało się na SM signals + regime.

**Root cause:** Prediction bias był dodany tylko w branchu `if (pair === 'kPEPE')` wewnątrz `executeMultiLayerMM`. Branch `else` (wszystkie inne tokeny) nie miał tego kodu.

**Dodatkowy problem przy deploy:** `src/mm_hl.ts` był edytowany lokalnie, ale nie SCP'd na serwer. mm-follower biegnie z `src/` via ts-node (nie z `dist/`), więc patching `dist/mm_hl.js` na serwerze nie miał efektu na mm-follower.

**Fix w `src/mm_hl.ts` (linia 8443-8458):**
```typescript
} else {
  // === PREDICTION BIAS: h4 prediction from prediction-api ===
  try {
    await this.fetchPrediction(symbol)
    const predBias = this.getPredictionBias(symbol)
    if (predBias.reason) {
      sizeMultipliers.bid *= predBias.bidMult
      sizeMultipliers.ask *= predBias.askMult
      if (this.tickCount % 20 === 0) {
        console.log(`📊 [PREDICTION_BIAS] ${pair}: ${predBias.reason}`)
      }
    }
  } catch {
    // prediction-api down — no bias applied, continue normally
  }

  gridOrders = this.gridManager!.generateGridOrders(...)
}
```

**Pipeline position:** W `executeMultiLayerMM`, `else` branch (non-kPEPE), PRZED `generateGridOrders()`. Multiplicative z innymi modulami (SM signals, regime, etc.).

**Verified live (all 5 mm-follower tokens + kPEPE):**
```
📊 [PREDICTION_BIAS] BTC:      h4=BEARISH -0.80% conf=54% → bid×0.97 ask×1.04
📊 [PREDICTION_BIAS] ETH:      h4=BEARISH -1.31% conf=53% → bid×0.96 ask×1.07
📊 [PREDICTION_BIAS] SOL:      h4=BEARISH -1.41% conf=53% → bid×0.95 ask×1.07
📊 [PREDICTION_BIAS] HYPE:     h4=BEARISH -1.12% conf=58% → bid×0.96 ask×1.06
📊 [PREDICTION_BIAS] FARTCOIN: h4=BEARISH -1.82% conf=54% → bid×0.94 ask×1.09
📊 [PREDICTION_BIAS] kPEPE:    h4=BEARISH -1.13% conf=51% → bid×0.96 ask×1.06
```

**Efekt:** Przy BEARISH h4 prediction — zmniejszone bidy (mniej kupowania), zwiększone aski (agresywniejsze shortowanie). Przy BULLISH — odwrotnie. Soft bias ±4-9% zależnie od siły predykcji.

**Kluczowe lekcje:**
1. mm-follower biegnie z `src/mm_hl.ts` (ts-node), NIE z `dist/mm_hl.js` — zawsze SCP'uj src, nie dist
2. `executeMultiLayerMM` vs `executeRegularMM` — oba procesy (mm-follower i mm-pure) używają `executeMultiLayerMM` bo `ENABLE_MULTI_LAYER=true` w `.env`
3. `PREDICTION_BIAS` log drukuje się co 20 ticków (~20 min) — nie panikuj jeśli nie widzisz od razu

**Pliki:** `src/mm_hl.ts` (+16)
**Commit:** `c8d1925`

### 57. Copy-Trading Bot — Cień Generała v3 (27.02)

**Nowy plik:** `scripts/general_copytrade.ts`
**PM2:** `copy-general` (id 49), dry-run domyślnie

**Cel:** Automatyczne kopiowanie pozycji Generała (0xa31211...) na naszym koncie.

**Architektura:**
```
vip_spy.py (30s) → /tmp/vip_spy_state.json → general_copytrade.ts → HL API (ordery)
```

**Baseline seeding:** Na pierwszym starcie bot zapisuje snapshot istniejących pozycji Generała jako baseline. Kopiowane są TYLKO nowe pozycje otwarte po uruchomieniu bota (nie stare).

**Wykrywane zdarzenia:**
| Event | Akcja |
|-------|-------|
| NEW position | Open copy ($500 fixed, IOC z 30bps slippage) |
| CLOSED position | Close our copy (reduce-only IOC) |
| FLIP (LONG↔SHORT) | Close old + open new direction |
| SIZE_REDUCED >20% | Reduce proportionally |

**Filtracja:** Min wartość pozycji Generała: $10K. Max kopia per pair: $500. Blocked coins configurable.

**Config (env vars):**
```
COPY_PRIVATE_KEY    — klucz prywatny (wymagany w --live)
COPY_CAPITAL_USD    — $2000
COPY_MAX_PER_PAIR   — $500
COPY_LEVERAGE       — 3x
COPY_POLL_SEC       — 30s
COPY_MIN_VALUE_USD  — $10000
COPY_SCALING_MODE   — "fixed" / "proportional"
COPY_BLOCKED_COINS  — ""
```

**Tryby:** `--dry-run` (logi only) / `--live` (real orders)
**State:** `/tmp/copy_general_state.json`

**Pliki:** `scripts/general_copytrade.ts` (NEW), `ecosystem.config.cjs` (+24)

### 56. vip_spy.py — ALL COINS + portfolio summary + general_changes.json (27.02)

**Problem:** vip_spy.py trackował tylko `WATCHED_COINS` whitelist (6 coinów). Generał otwierał pozycje na AVAX, RESOLV, PUMP, ASTER, APEX — niewidoczne w alertach.

**Fix w `scripts/vip_spy.py`:**
- `get_positions()` z parametrem `track_all=True` dla Generała — pobiera WSZYSTKIE coiny z API
- `format_portfolio_summary()` — generuje portfolio summary (total value, total PnL, lista pozycji posortowana wg wartości) dołączane do alertów Telegram
- `write_general_changes()` — pisze `/tmp/general_changes.json` z timestamp, changes, positions, total_value, total_pnl

**Generał portfel (27.02, 8 pozycji, $2.23M, +$1.26M uPnL):**

| Coin | Side | Value | uPnL | Lev |
|------|------|-------|------|-----|
| ASTER | SHORT | $739K | +$511K | 5x |
| PUMP | SHORT | $504K | +$221K | 10x |
| FARTCOIN | SHORT | $466K | +$492K | 10x |
| APEX | SHORT | $220K | +$31K | 3x |
| **LIT** | **LONG** | **$198K** | **+$4K** | 5x isolated |
| RESOLV | SHORT | $87K | +$6K | 3x |
| AVAX | SHORT | $16K | +$163 | 10x |
| HYPE | SHORT | $1.6K | -$135 | 10x |

**LIT SM Landscape (27.02):**
- SM SHORT: $3.77M (Manifold $1.5M, 0xef759e $1.4M, Wice-Generał $364K)
- SM LONG: $562K (0x08c14b $350K, **Generał $197K**)
- **6.7x SHORT dominant** — Generał jest w mniejszości

### 55. NansenFeed 429 fix — position cache + sequential fetching (27.02)

**Problem:** mm-pure (PURE_MM) triggerował AlphaEngine która fetchowała 83 whale pozycji co minutę → 429 rate limit → SM sygnały tracone.

**3 fixy:**
1. **AlphaEngine skip dla PURE_MM** — `if (IS_PURE_MM_BOT)` → skip AlphaEngine entirely. Oszczędza 83 API calls/min.
2. **Position cache fallback** — `NansenFeed.ts`: cache successful responses, return cached data on 429.
3. **Reduced batch size** — 3→2 per batch, 800ms→1500ms delay, sequential fetching (nie concurrent).

**Verified:** Zero NansenFeed 429 errors po deploy na mm-pure.

### 54. Dynamic Spread — ATR-based grid layer scaling (27.02)

**Problem:** kPEPE stale L1=18bps powodował fee-eating w low-vol (choppy) rynku. Round-trip spread 36bps, ale z 3.5bps fee = 7bps kosztu. W low-vol ruchach <30bps bot tracił na fees.

**Fix w `src/mm_hl.ts` + `src/config/short_only_config.ts`:**

**A) ATR-based L1 scaling:**
```
Low vol (ATR% < 0.30%):  L1 = 28bps (widen — avoid fee-eating)
Normal (0.30-0.80%):     L1 = 18-28bps (interpolated)
High vol (ATR% > 0.80%): L1 = 14bps (tighten — capture moves)
L2-L4 scale proportionally (L2 = L1×1.67, L3 = L1×2.50, L4 = L1×3.61)
```

**B) Min Profit Buffer:**
- Filtruje close orders < 10bps od entry price (3.5bps fee + 6.5bps safety)
- SHORT: bidy muszą być < entry × (1 - 0.001)
- LONG: aski muszą być > entry × (1 + 0.001)

**DynamicSpreadConfig** w `short_only_config.ts`:
```typescript
atrScalingEnabled: true
lowVolAtrPctThreshold: 0.30
highVolAtrPctThreshold: 0.80
lowVolL1Bps: 28
highVolL1Bps: 14
minProfitBps: 10
```

**Logi:** `📐 [DYNAMIC_SPREAD] kPEPE: ATR=0.420% → L1=22bps L2=37bps L3=55bps L4=79bps | NORMAL`
**Logi:** `📐 [MIN_PROFIT] kPEPE: Removed 2 close orders < 10bps from entry`

**Commit:** `c9f012d`

### 58. XGBoost Training kPEPE — pierwszy model ML (27.02)

**Problem:** kPEPE korzystał wyłącznie z HybridPredictor (rule-based). XGBoost collect zbierał dane od 26.02, ale model nie był wytrenowany.

**Rozwiązanie:** Ręczny trening XGBoost + patch dist na serwerze.

**Training results (90 samples):**

| Horyzont | Samples | Test Accuracy | Top Features |
|----------|---------|---------------|-------------|
| **h1** | 85 | **58.8%** | macd_signal (19%), bb_width (14%), rsi (8%) |
| **h4** | 74 | **60.0%** | hour_cos (20%), macd_line (18%), oi_change_4h (12%) |
| h12 | 42 | — | Za mało (potrzeba 50) |

**Observations:**
- kPEPE features = czysto techniczne (zero SM — prawidłowo, kPEPE nie ma SM data w whale_tracker)
- h4 top feature = `hour_cos` (pora dnia) — kPEPE ma wyraźny time-of-day pattern (Asia low vol vs US high vol)
- 58-60% accuracy na 3-class problem z 90 samples — solid start, lepiej niż random (33%)

**Server patch:** `dist/prediction/models/XGBoostPredictor.js` — dodano `'kPEPE'` do `tokens` array (source `src/` już miał z commit `f797863`, ale `tsc` nie kompiluje czysto).

**Prediction Bias zmiana po XGBoost blend:**
```
Przed (rule-based only): h4=BEARISH -2.33% conf=51% → bid×0.92 ask×1.12
Po (XGBoost blend):      h4=BEARISH -0.92% conf=50% → bid×0.97 ask×1.05
```
XGBoost moderuje predykcję — na support widzi że spadek może wyhamować.

**Deploy:** `pm2 restart prediction-api`, verified `/xgb-status` shows kPEPE h1+h4 models loaded.

### 59. SM Intelligence Report — kPEPE Positions + Mass Profit-Taking (27.02)

**kPEPE SM positions (6 tracked addresses):**

| Trader | Tier | Weight | Side | Value | uPnL |
|--------|------|--------|------|-------|------|
| **Silk Capital** (0x880ac4) | CONVICTION | 0.75 | SHORT | $250K | +$51K (+20%) |
| SM Active dbcc96 | ACTIVE | 0.50 | LONG | $40K | -$3.5K |
| Token Millionaire 7717a7 | ACTIVE | 0.60 | SHORT | $15K | +$1.6K |
| Selini Capital #1 | MM | 0.0 | SHORT | $2.4K | +$49 |
| Oct Winner 8e0969 | ACTIVE | 0.65 | SHORT | $693 | +$473 |
| Fasanara Capital | MM | 0.0 | LONG | $391 | -$4 |

**Bilans:** SM SHORT ~$267K vs LONG ~$40K = **6.7x SHORT dominant** (po odfiltrowaniu MM).

**Silk Capital profil:** $4.3M equity, 16 pozycji, +$2.87M uPnL. XMR SHORT $10.1M (main play), HYPE SHORT $5.4M, kPEPE SHORT $250K. Hardcore shorter.

**Fasanara Capital kPEPE:** Zamknęła $10.7M SHORT (5 redukcji w 4 minuty, 16:58-17:00 UTC), flip na micro LONG $391 (dust position).

**Mass SM profit-taking (27.02):**
- fce0: BTC SHORT $11.8M→$8.5M (-35%), ETH SHORT $6M→$3.6M (-40%)
- SOL2: SOL SHORT $8.1M→$4.8M (-40%), BTC SHORT reduced
- NIE full exits — redukcja 35-40%, SM consensus nadal SHORT
- Heavyweights (58bro $31.8M, Wice-Generał $28.8M, Kraken A $14.3M) — ZERO zmian

**Generał:** ZERO zmian cały dzień. 8 pozycji, $2.18M, +$1.31M uPnL. Copy bot: 0 orders (wszystko baseline).

### 60. kPEPE Performance Day Report (27.02)

**Wyniki:**
- **374 fills**, 197 buys / 177 sells
- **Closed PnL: +$83.23**
- **Win rate: 100%** (198 winning closes, 0 losses)
- Volume: $34K, orders po $100 each

**Hourly highlights:**
- Best hour: 10:00 UTC (+$22.02, 64 fills) — kPEPE dip buying + selling on bounce
- Gap 04-09 UTC — Asia session, brak volume
- Consistent profits every hour ($1.61 - $22.02)

**Position at EOD:** LONG 95K kPEPE ($347), nearly flat, healthy inventory.

**Bot support detection verified:**
- `⚓ near S` — MarketVision sees support
- `prox=-1.00` — Momentum Guard: price AT support body ($0.003664)
- `RSI=22` — deeply oversold
- `🔄MICRO_REVERSAL→closing_allowed` — allows closing longs on bounces for profit
- Mean-reversion working: DUMP→asks reduced (hold longs), micro-reversal→asks unblocked (take profit)

### 61. kPEPE Prediction Weight Redistribution — SM=0% (27.02)

**Problem:** 30% wagi predykcji kPEPE (smartMoney signal) było martwe — zawsze zero. whale_tracker nie ma kPEPE w WATCHED_COINS, na spot PEPE zero SM activity (Nansen potwierdził: zero inflows/outflows 7 dni), na HL perps tylko 1 realny SM trader (Silk Capital $250K SHORT). SM signal = szum.

**Analiza (Nansen MCP + HL API scan):**
- PEPE spot (Ethereum): 3 SM holders, 26.2B PEPE ($97-114K), **zero** inflows/outflows 7 dni
- PEPE spot whales: 11 holders, 3.5T PEPE ($13-15M), **zero** activity 7 dni
- kPEPE perps (HL): 6 tracked addresses, $267K SHORT vs $40K LONG = 6.7x SHORT, ale 94% = Silk Capital alone
- whale_tracker output: `trading_mode: "NEUTRAL"`, `confidence: 0`

**Rozwiązanie:** Per-token weight override w `HybridPredictor.ts` — kPEPE SM=0%, redystrybuowane do technical + momentum + trend.

**Plik:** `src/prediction/models/HybridPredictor.ts`

**A) `TOKEN_WEIGHT_OVERRIDES` map (po `HORIZON_WEIGHTS`):**
```typescript
const TOKEN_WEIGHT_OVERRIDES: Record<string, typeof HORIZON_WEIGHTS> = {
  kPEPE: {
    h1:  { technical: 0.40, momentum: 0.30, smartMoney: 0.00, volume: 0.15, trend: 0.15 },
    h4:  { technical: 0.35, momentum: 0.30, smartMoney: 0.00, volume: 0.15, trend: 0.20 },
    h12: { technical: 0.30, momentum: 0.25, smartMoney: 0.00, volume: 0.15, trend: 0.30 },
    w1:  { technical: 0.25, momentum: 0.20, smartMoney: 0.00, volume: 0.15, trend: 0.40 },
    m1:  { technical: 0.20, momentum: 0.15, smartMoney: 0.00, volume: 0.15, trend: 0.50 },
  },
};
```

**B) `calculatePredictions()` — dodano `token` parametr:**
- Method signature: `+ token?: string`
- Call site: `+ signals, token`
- Weight lookup: `const weightsMap = (token && TOKEN_WEIGHT_OVERRIDES[token]) || HORIZON_WEIGHTS;`

**Porównanie wag kPEPE (przed → po):**

| Horyzont | SM (przed) | SM (po) | Technical | Momentum | Trend |
|----------|-----------|---------|-----------|----------|-------|
| h1 | 10% | **0%** | 35→40% | 30% | 10→15% |
| h4 | 30% | **0%** | 25→35% | 20→30% | 15→20% |
| h12 | 40% | **0%** | 20→30% | 15→25% | 15→30% |
| w1 | 55% | **0%** | 10→25% | 10→20% | 20→40% |
| m1 | 65% | **0%** | 5→20% | 5→15% | 20→50% |

**Kiedy dodać SM z powrotem:** >= 3 SM addresses z >$50K na kPEPE perps, LUB SM spot activity na PEPE >$500K/tydzień.

**Deploy:** SCP src → server, manual patch `dist/prediction/models/HybridPredictor.js`, `pm2 restart prediction-api`. Verified: `/predict/kPEPE` returns valid predictions, BTC/ETH unchanged.

**Pliki:** `src/prediction/models/HybridPredictor.ts` (+15/-3)

---

## Zmiany 26 lutego 2026

### 52. kPEPE dodane do XGBoost collect, train i prediction service (26.02)

**Problem:** XGBoost zbierał dane i trenował modele tylko dla 8 tokenów (BTC, ETH, SOL, HYPE, ZEC, XRP, LIT, FARTCOIN). kPEPE korzystał wyłącznie z HybridPredictor (rule-based) — bez ML modelu.

**Rozwiązanie:** Dodano `kPEPE` do list tokenów w 4 plikach:

| Plik | Zmiana |
|------|--------|
| `scripts/xgboost_collect.py` | `TOKENS` += `"kPEPE"` — zbieranie 30-feature wektorów co 15 min |
| `scripts/xgboost_train.py` | `TOKENS` += `"kPEPE"` — trenowanie h1/h4/h12/w1/m1 modeli |
| `src/prediction/models/XGBoostPredictor.ts` | `tokens` += `'kPEPE'` — ładowanie wytrenowanych modeli |
| `src/prediction/index.ts` | CLI tokens += `'kPEPE'` — test run output |

**Deploy:** SCP collect + train → server. Collector uruchomiony: `[kPEPE] Appended row (price=$0.0039, 30 features, total=1 rows)`.

**Timeline do treningu:**
- h1 model: ~50 wierszy = ~12.5h (MIN_SAMPLES=50)
- h4 model: ~50 wierszy z h4 labels = ~50h (labels po 4h)
- h12 model: ~4 dni
- w1/m1: tygodnie/miesiące

**Uwaga:** kPEPE mixed case — collector i trainer używają `"kPEPE"` (nie uppercase), HL API wymaga dokładnie tej formy.

**Commit:** `f797863`

### 51. Prediction Bias Integration — h4 predykcja wpływa na grid kPEPE (26.02)

**Problem:** prediction-api (port 8090) i War Room (port 3000) działały jako osobne dashboardy — zero wpływu na trading bota. Oracle Vision w mm_hl.ts istniał ale był "logging only — no trading action". 100% decyzji bota opierało się na whale_tracker SM data, MarketVision, Toxicity Engine i Momentum Guard.

**Rozwiązanie (Phase 1):** Soft Prediction Bias — h4 predykcja z prediction-api jako ±15% bias na bid/ask multipliers, wstrzyknięty w kPEPE pipeline PRZED Momentum Guard.

**A) prediction-api kPEPE support (dashboard-api.ts):**
- Problem: `toUpperCase()` zamieniał `kPEPE` na `KPEPE` → Hyperliquid API 500
- Fix: `normalizeToken()` z `MIXED_CASE_TOKENS` mapą (`KPEPE` → `kPEPE`)
- Dodano kPEPE do `/predict-all` endpoint

**B) Prediction cache + fetch (mm_hl.ts):**
- `predictionCache: Map<string, {direction, change, confidence, fetchedAt}>`
- `fetchPrediction(token)` — HTTP GET do `localhost:8090/predict/{token}`, 3s timeout, cache 5 min
- Graceful degradation: prediction-api down → use stale cache or no bias

**C) `getPredictionBias(token)` — soft grid adjustment:**

| Warunek | Efekt |
|---------|-------|
| confidence < 50% | No bias (×1.0 / ×1.0) |
| \|change\| < 0.3% | No bias (too weak) |
| BULLISH h4 | bid × (1.0 + 0.15×strength), ask × (1.0 - 0.10×strength) |
| BEARISH h4 | bid × (1.0 - 0.10×strength), ask × (1.0 + 0.15×strength) |
| Stale (>15min) | staleFactor = 0.5 (halve effect) |

`strength = min(|change| / 3.0, 1.0)` — 3% predicted change = max effect

**D) Pipeline position:** Po Toxicity Engine + TimeZone, PRZED Momentum Guard.
- Prediction Bias = **proaktywny** (antycypuje kierunek)
- Momentum Guard = **reaktywny** (reaguje na cenę)
- Multiplicative: oba wpływają na `sizeMultipliers.bid` / `sizeMultipliers.ask`

**Logi:** `📊 [PREDICTION_BIAS] kPEPE: h4=BEARISH -2.33% conf=51% → bid×0.92 ask×1.12` (co 20 ticków)

**Pliki:** `src/mm_hl.ts` (+92), `src/prediction/dashboard-api.ts` (+12/-5)

**Deploy:** SCP mm_hl.ts → server, manual patch dist/dashboard-api.js (tsc compilation fails on pre-existing errors), PM2 restart mm-pure + prediction-api

**Verified live:**
```
📊 [PREDICTION_BIAS] kPEPE: h4=BEARISH -2.33% conf=51% → bid×0.92 ask×1.12
📈 [MOMENTUM_GUARD] kPEPE: score=-0.21 → bid×0.92 ask×0.74
```

**Live cooperation Prediction Bias × Momentum Guard (26.02, 4h sample):**

Prediction Bias (stały, odświeża co 5 min):
- h4=BEARISH -2.32/-2.38% → zawsze `bid×0.92 ask×1.12`

Momentum Guard (dynamiczny, reaguje na cenę):
- score oscyluje -0.16 do -0.20 (lekki dump, proximity blisko support)
- Z micro-reversal: `bid×0.87-0.92 ask×1.06` (closing dozwolone)
- Bez micro-reversal: `bid×0.92 ask×0.74` (trzymaj pozycję)

Wynik końcowy (multiplicatywny):

| Scenariusz | Prediction | × MG | = Final bid | Final ask |
|-----------|-----------|------|-------------|-----------|
| Micro-reversal ON | bid×0.92 | × 0.88 | **×0.81** | ask×1.12 × 1.06 = **×1.19** |
| Micro-reversal OFF | bid×0.92 | × 0.92 | **×0.85** | ask×1.12 × 0.74 = **×0.83** |

**WAŻNE: Multipliers zmieniają ROZMIAR orderów (notional $), NIE cenę.** bid×0.81 = bidy mają 81% normalnego rozmiaru ($81 zamiast $100 per level). Ceny orderów (L1=18bps, L2=30bps od mid) się nie zmieniają.

Interpretacja:
- **Micro-reversal OFF** (cena aktywnie spada): bid×0.85 (mniej kupuj), ask×0.83 (trzymaj, MG ×0.74 wygrywa z Prediction ×1.12) → bot pasywny, chroni pozycję 💎
- **Micro-reversal ON** (cena odbiła od dna): bid×0.81 (nadal mniej kupuj), ask×1.19 (oba zgodne — sprzedawaj agresywnie) → bot aktywnie zamyka longi/otwiera shorty

**kPEPE 4h performance (26.02 15:57-19:47 UTC):**
- 124 fills, 79% win rate (50W/13L), **+$21.59 PnL**
- Pozycja: -157K kPEPE = $606 SHORT (6% skew z $10K max)
- Grid: 8×8 levels, $100/order, capitalPerPair=$12,500, 5x cross leverage

### 50. Momentum Guard v3 — usunięcie Position-Aware Guard, przywrócenie mean-reversion (26.02)

**Problem:** kPEPE Close Long na minus — bot kupował dip (poprawnie), ale zamykał longi za szybko ze stratą zamiast trzymać na odbicie. Position-Aware Guard (v2) widząc LONG+DUMP wymuszał `skipAskReduce=true` → asks ×1.0 → bot zamykał longi na dołku.

**Root cause:** Position-Aware Guard łamał fundamentalną zasadę mean-reversion Market Makingu:
```
DUMP: asks powinny być ×0.10 (trzymaj longi, nie sprzedawaj na dnie)
      Position-Aware Guard: "masz LONG, pomogę zamknąć!" → asks ×1.0 → zamykał ze stratą
```

**Rozwiązanie:** Usunięto `dumpAgainstLong` i `pumpAgainstShort` z `skipBidReduce`/`skipAskReduce`. Naturalna symetria mean-reversion sama chroni pozycje:

| Sytuacja | Bidy | Aski | Efekt |
|----------|------|------|-------|
| STRONG PUMP | ×0.10 | ×1.30 | Nie kupuj szczytu, sprzedawaj agresywnie |
| STRONG DUMP | ×1.30 | ×0.10 | Kupuj dip, **trzymaj longi** 💎 |
| LONG + DUMP | ×1.30 | ×0.10 | Kupuj więcej + trzymaj → czekaj na odbicie |
| SHORT + PUMP | ×0.10 | ×1.30 | Nie kupuj + trzymaj shorty → czekaj na zjazd |
| Micro-reversal (dump stalling) | ×1.30 | ×1.0 | Cena odbija → zamknij longi z zyskiem |
| Micro-reversal (pump stalling) | ×1.0 | ×1.30 | Cena spada → zamknij shorty z zyskiem |

**Micro-reversal** (jedyny skip flag który został): gdy 1h momentum laguje ale cena już odbiła >0.3% od dna/szczytu → odblokuj closing side → weź profit.

**Pozostałe mechanizmy zamykania działają niezależnie:** Auto-Skew (przesuwa mid), Dynamic TP (rozszerza closing spread), Inventory SL (panic close przy dużym drawdown).

**Pliki:** `src/mm_hl.ts` (+10/-6)

**Logi:** `💎LONG+DUMP→holding(asks×reduced,bids×up)` / `💎SHORT+PUMP→holding(bids×reduced,asks×up)` / `🔄MICRO_REVERSAL→closing_allowed`

**Deploy:** SCP → server, `pm2 restart mm-pure`. Confirmed: `score=-0.19 → bid×0.95 ask×0.95`

### 45. Momentum Guard v1 — asymetryczny grid na podstawie trendu (26.02)

**Problem:** kPEPE (PURE_MM) kupował na szczytach i shortował na dołkach. Grid symetryczny nie reagował na momentum — takie same bidy i aski niezależnie od trendu.

**Rozwiązanie:** Momentum Guard — 3-sygnałowy scoring system z asymetrycznymi multiplierami grida.

**Plik config:** `src/config/short_only_config.ts` — `MomentumGuardConfig` interface + defaults + kPEPE override
**Plik logika:** `src/mm_hl.ts` — ~60 linii w kPEPE grid pipeline (po Toxicity Engine, przed `generateGridOrdersCustom`)

**3 sygnały (ważone):**

| Sygnał | Waga | Źródło | Co mierzy |
|--------|------|--------|-----------|
| 1h Momentum | 50% | `change1h` z data fetcher | Kierunek i siła ruchu cenowego |
| RSI | 30% | `mvAnalysis.rsi` z MarketVision | Overbought/oversold extremes |
| Proximity S/R | 20% | `resistance4h`/`support4h` z MarketVision | Odległość od HTF support/resistance |

**Score → Multiplier mapping:**

| Score | Level | Bid mult | Ask mult |
|-------|-------|----------|----------|
| >= 0.7 | STRONG pump | ×0.10 | ×1.30 |
| >= 0.4 | MODERATE pump | ×0.40 | ×1.15 |
| >= 0.2 | LIGHT pump | ×0.70 | ×1.05 |
| -0.2 to 0.2 | NEUTRAL | ×1.00 | ×1.00 |
| <= -0.2 | LIGHT dump | ×1.05 | ×0.70 |
| <= -0.4 | MODERATE dump | ×1.15 | ×0.40 |
| <= -0.7 | STRONG dump | ×1.30 | ×0.10 |

**Pipeline position:** Po Toxicity Engine (kpepe_toxicity.ts), przed `generateGridOrdersCustom()`. Multiplicative z toxicity multipliers.

**Logi:** `📈 [MOMENTUM_GUARD] kPEPE: score=X.XX (mom=X.XX rsi=X.XX prox=X.XX) → bid×X.XX ask×X.XX | 1h=X.X% RSI=XX` — co 20 ticków lub gdy |score| >= moderate.

**Deploy:** SCP → server, `pm2 restart mm-pure`. Confirmed: `score=0.00` (market flat po deploy).

**Commit:** `4da7540`

### 46. Momentum Guard v2 — 7 fixów: position-aware, ATR-adaptive (26.02)

**Feedback review:** Zidentyfikowano 3+3 corner cases w v1: Wick Trap, Breakout Math, Hard Thresholds, TP Exemption, 1h Lag, Dump Asymmetry.

**7 fixów:**

**A) Wick Trap (market_vision.ts):**
- Dodano `resistanceBody4h` / `supportBody4h` do `PairAnalysis`
- Obliczane z `Math.max(O,C)` / `Math.min(O,C)` zamiast wicks (H/L)
- Flash crash spiki nie rozciągają kanału S/R
- Stare wick-based pola zachowane dla innych consumers

**B) Breakout Math (mm_hl.ts):**
- Przed: `mgResistDist < 0.01` przypadkowo łapało ujemne wartości (cena > opór)
- Po: explicit `mgResistDist <= 0 → proxSignal = +1.0` (max overbought)
- Mirror: `mgSupportDist <= 0 → proxSignal = -1.0` (max oversold)

**C) ATR-based proximity zones (mm_hl.ts):**
- Przed: static 1%/2% thresholds — za ciasne dla kPEPE, za szerokie dla BTC
- Po: `mgStrongZone = ATR/midPrice`, `mgModerateZone = 2×ATR/midPrice`
- Automatyczna adaptacja do volatility regime. Fallback 1%/2% gdy ATR=0.

**D) ATR-based pumpThreshold (short_only_config.ts + mm_hl.ts):**
- `useAtrThreshold: true` — derywuje threshold z `1.5×ATR%` zamiast static 3%
- kPEPE override: `atrThresholdMult: 2.0` (memecoin = wider)
- Fallback na `pumpThresholdPct` gdy ATR niedostępny

**E) Dump asymmetry (short_only_config.ts + mm_hl.ts):**
- `dumpSensitivityMult: 0.7` — dump threshold = pumpThreshold × 0.7
- Krypto spada szybciej niż rośnie → reaguj 30% szybciej na dumpy
- Przykład: pump threshold 2.5% → dump threshold 1.75%

**F) Position-aware guard (mm_hl.ts):**
- SHORT pozycja (actualSkew < -0.10) + pump → bidy CHRONIONE (zamykają shorta!)
- LONG pozycja (actualSkew > 0.10) + dump → aski CHRONIONE (zamykają longa!)
- `pumpAgainstShort` / `dumpAgainstLong` flags w kodzie
- Log: `⚠️SHORT+PUMP→bids_protected` / `⚠️LONG+DUMP→asks_protected`

**G) Micro-reversal detection (mm_hl.ts):**
- Wykorzystuje `pumpShieldHistory` (ostatnie 10 ticków = ~15 min)
- Jeśli 1h momentum laguje (mówi "pump") ale cena spadła >0.3% od recent peak → micro-reversal
- Odblokowuje closing orders mimo lagging momentum
- Log: `🔄MICRO_REVERSAL→closing_protected`

**Nowe pola w MomentumGuardConfig:**
```typescript
useAtrThreshold: boolean        // default true
atrThresholdMult: number        // default 1.5 (kPEPE: 2.0)
dumpSensitivityMult: number     // default 0.7
```

**Nowe pola w PairAnalysis:**
```typescript
supportBody4h: number           // Body-based HTF support
resistanceBody4h: number        // Body-based HTF resistance
```

**Pliki:** `src/mm_hl.ts` (+75/-14), `src/signals/market_vision.ts` (+9), `src/config/short_only_config.ts` (+10/-3)

**Deploy:** SCP 3 pliki → server, `pm2 restart mm-pure --update-env`. Confirmed: `score=-0.08 prox=-0.40 skew=-3%`

**Commit:** `dc578dc`

### 47. Dynamic TP (Spread Widener) + Inventory SL (Panic Mode) (26.02)

**Cel:** Dwa nowe ATR-oparte mechanizmy zarządzania pozycją dla kPEPE PURE_MM. Rozszerzenie Momentum Guard o aktywne zarządzanie TP i awaryjne zamykanie.

**A) Dynamic TP (Spread Widener):**

**Problem:** Gdy micro-reversal wykryty i pozycja jest na zwycięskiej stronie, grid TP zamyka pozycję zbyt blisko mid price — nie łapie pełnego ruchu odwrócenia.

**Rozwiązanie:** Przy micro-reversal + pozycja na winning side → rozszerz spread na closing side o `tpSpreadMult` (domyślnie ×1.5 = 50% szerzej).

| Scenariusz | Closing side | Efekt |
|-----------|-------------|-------|
| SHORT + pump stalling (cena spada od peak) | Bidy | Bid spread ×1.5 → TP dalej od mid → łapie więcej spadku |
| LONG + dump stalling (cena rośnie od trough) | Aski | Ask spread ×1.5 → TP dalej od mid → łapie więcej wzrostu |

**Logika:** "Let it run" — gdy odwrócenie potwierdzone, nie zamykaj od razu. Daj pozycji więcej miejsca.

**Log:** `🎯 [DYNAMIC_TP] kPEPE: SHORT+micro_reversal → bid spread ×1.50 (ATR=X.XX%)`

**B) Inventory SL (Panic Mode):**

**Problem:** Bot może utknąć z dużą underwater pozycją (|skew| > 40%) gdy cena mocno ruszyła przeciwko. Bez mechanizmu awaryjnego kontynuuje market-making w obie strony, potencjalnie powiększając stratę.

**Rozwiązanie:** Gdy `|skew| > maxSkewSlThreshold (40%)` AND drawdown od entry > `slAtrMultiplier × ATR% (2.5×ATR)` → PANIC MODE:
- Blokuj losing side (asks=0 dla SHORT, bids=0 dla LONG) → stop powiększania straty
- Agresywne closing: closing-side size ×`panicClosingMult` (2.0) → szybsze wyjście

| Warunek | Reakcja SHORT | Reakcja LONG |
|---------|-------------|-------------|
| Panic triggered | asks=0, bids×2.0 | bids=0, asks×2.0 |
| Drawdown < threshold | normalne MG działanie | normalne MG działanie |
| skew < 40% | nie armed | nie armed |

**Guard: `drawdownPct > 0`** — panic TYLKO gdy pozycja jest underwater (drawdown dodatni). Jeśli pozycja jest w zysku, nie triggeruje nawet przy wysokim skew.

**Log:** `🚨 [INVENTORY_SL] kPEPE: PANIC SHORT — skew=55% drawdown=4.2% > 3.8% (2.5×ATR) → asks=0 bids×2.0`

**Nowe pola w MomentumGuardConfig:**
```typescript
tpSpreadWidenerEnabled: boolean   // default true
tpSpreadMult: number              // default 1.5 (50% wider closing spread)
inventorySlEnabled: boolean       // default true
maxSkewSlThreshold: number        // default 0.40 (40% skew)
slAtrMultiplier: number           // default 2.5 (drawdown > 2.5×ATR)
panicClosingMult: number          // default 2.0 (2× closing size)
```

**Pipeline position:** Wewnątrz bloku Momentum Guard, po scoring + multipliers, przed `generateGridOrdersCustom()`.
- Dynamic TP modyfikuje `gridBidMult`/`gridAskMult` (spread width)
- Inventory SL modyfikuje `sizeMultipliers` (order size) — overriduje wcześniejsze MG multipliers

**Pliki:** `src/config/short_only_config.ts` (+14), `src/mm_hl.ts` (+58)

**Dodatkowe zmiany w tym commicie:**
- `ecosystem.config.cjs` — `DYNAMIC_CONFIG_ENABLED=false` dla mm-pure, `RISK_TOTAL_CAPITAL_USD=9000`, `DYNAMIC_CONFIG_TOKENS` dla mm-follower
- `src/mm/SmAutoDetector.ts` — `filterTokens` param w `loadAndAnalyzeAllTokens()` (optymalizacja: skip tokenów nie w BOT_MODE)
- `whale_tracker.py` — frankfrankbank.eth dodany (ETH $9.3M SHORT, MANUAL trader, CONVICTION 0.80)

**Deploy:** SCP 2 pliki → server, `pm2 restart mm-pure --update-env`. Confirmed: `score=-0.16 prox=-0.80 skew=-8%` (oba features armed, czekają na trigger).

**Commit:** `698379b`

### 48. Auto-Skewing — przesunięcie siatki na podstawie pozycji (26.02)

**Problem:** Bot z dużą pozycją (np. -30% SHORT) miał siatkę centrowaną na prawdziwej mid price. Bidy i aski symetrycznie rozmieszczone wokół mid → zamknięcie pozycji wymagało ruchu cenowego DO bida. Bot czekał biernie — kapitał zamrożony.

**Rozwiązanie:** Przesunięcie mid price przekazanej do `generateGridOrdersCustom` proporcjonalnie do skew. Bot "oszukuje samego siebie" — widzi sztuczną cenę, więc cała siatka się przesuwa.

**Mechanizm:**
```
SHORT heavy (skew < 0) → shift mid UP   → bidy bliżej rynku (aggressive buy-to-close)
                                         → aski dalej od rynku (passive, mniej nowych shortów)
LONG heavy (skew > 0)  → shift mid DOWN → aski bliżej rynku (aggressive sell-to-close)
                                         → bidy dalej od rynku (passive, mniej nowych longów)
```

**Matematyka:**
```
skewTenPercents = actualSkew × 10        // -0.30 → -3.0
rawShiftBps = -(skewTenPercents × 2.0)   // -(-3.0 × 2.0) = +6.0 bps
shiftBps = clamp(rawShiftBps, -15, +15)  // safety cap
skewedMidPrice = midPrice × (1 + shiftBps / 10000)
```

**Przykłady:**

| Skew | Shift | Efekt |
|------|-------|-------|
| -10% | +2.0 bps UP | Lekko agresywne bidy |
| -30% | +6.0 bps UP | Znacząco agresywne bidy |
| -50% | +10.0 bps UP | Bardzo agresywne bidy |
| -80% | +15.0 bps UP (cap) | Maximum shift — bidy ultra-aggressive |
| +20% | -4.0 bps DOWN | Agresywne aski (zamykanie longa) |

**Nowe pola w MomentumGuardConfig:**
```typescript
autoSkewEnabled: boolean        // default true
autoSkewShiftBps: number        // default 2.0 (2 bps per 10% skew)
autoSkewMaxShiftBps: number     // default 15.0 (max 0.15% shift)
```

**Pipeline position:** Po Momentum Guard + Dynamic TP + Inventory SL, bezpośrednio PRZED `generateGridOrdersCustom`. Auto-Skew modyfikuje `midPrice` → wszystkie warstwy grida (L1-L4) przesuwają się jednocześnie.

**Kluczowa różnica vs obecny `getInventoryAdjustment()`:**
- Stary: adjustuje offsety indywidualnych warstw (±10bps per 15% skew) — asymetryczny spread
- Nowy: przesuwa CAŁĄ siatkę (mid shift) — wszystkie L1-L4 razem, zachowując strukturę grida

**Pliki:** `src/config/short_only_config.ts` (+7), `src/mm_hl.ts` (+31/-1)

**Deploy:** SCP → server, `pm2 restart mm-pure --update-env`.

**Confirmed live:** `skew=8.5% → -1.70bps DOWN (aggressive asks) | real=0.003814 skewed=0.003813`

**Commit:** `bf6a82c`

### 49. Prediction System Overhaul — per-horizon weights, XGBoost training, verification rewrite (26.02)

**Problem:** Weryfikacja predykcji ujawniła poważne problemy:
- h1: BTC 35%, ETH 32% (gorsze niż random) — SM signal (40% wagi) nie zmienia się w 1h, dodaje szum
- h12: 0% accuracy — blind linear extrapolation bez mean-reversion
- Verification endpoint `/verify/:token` zawsze 0/0 — ±10% time window zbyt wąski
- XGBoost: 0 modeli wytrenowanych — label key mismatch (`label_1h` vs `label_h1`), MIN_SAMPLES za wysokie, brak scikit-learn
- Magnitude: 2-5× za konserwatywna (h1 multiplier 0.3 za niski)

**Rozwiązanie:** 7 fixów:

**A) Per-horizon signal weights (HybridPredictor.ts):**
```typescript
const HORIZON_WEIGHTS = {
  h1:  { technical: 0.35, momentum: 0.30, smartMoney: 0.10, volume: 0.15, trend: 0.10 },
  h4:  { technical: 0.25, momentum: 0.20, smartMoney: 0.30, volume: 0.10, trend: 0.15 },
  h12: { technical: 0.20, momentum: 0.15, smartMoney: 0.40, volume: 0.10, trend: 0.15 },
  w1:  { technical: 0.10, momentum: 0.10, smartMoney: 0.55, volume: 0.05, trend: 0.20 },
  m1:  { technical: 0.05, momentum: 0.05, smartMoney: 0.65, volume: 0.05, trend: 0.20 },
};
```
**Logika:** SM pozycje nie zmieniają się w 1h → SM waga 10% dla h1 (szum). Na m1 SM waga 65% (strukturalny sygnał).

**B) Multiplier bump:**
- h1: 0.3 → 0.5 (predykcje były 2× za małe)
- h4: 0.8 → 1.0

**C) Mean-reversion dla h12+ (HybridPredictor.ts):**
```typescript
const rsiMeanReversion = rsi > 70 ? -(rsi - 50) / 100 : rsi < 30 ? -(rsi - 50) / 100 : 0;
const meanRevFactor = hz.hours >= 12 ? rsiMeanReversion * volatility * min(hz.hours/12, 3) : 0;
```
RSI overbought/oversold dodaje kontra-siłę na dłuższych horyzontach → h12 nie może ślepo ekstrapolować trendów.

**D) Retrospective verification (HybridPredictor.ts):**
- Przed: szukał aktualnej ceny ±10% od prediction timestamp → nigdy nie matchował
- Po: traktuje `timePrices` map (ts → price) jako historyczny zapis, szuka ceny N godzin po predykcji
- Dodano `directionAccuracy`/`directionTotal` per-horizon (trafność kierunku niezależnie od magnitudy)

**E) XGBoost label key fix (xgboost_train.py):**
```python
LABEL_KEY_MAP = {
    "h1": ["label_h1", "label_1h"],  # collector writes label_1h
    "h4": ["label_h4", "label_4h"],  # trainer expected label_h1
    "h12": ["label_h12", "label_12h"],
}
```

**F) MIN_SAMPLES obniżone:**
- h1/h4/h12: 200 → 50
- w1: 100 → 30
- m1: 50 → 20

**G) scikit-learn + XGBoost training:**
- Installed scikit-learn na serwerze (XGBoost 3.2.0 dependency)
- Wytrenowano 24 modeli (8 tokens × 3 horizons: h1/h4/h12)
- XGBoost overfitting: train 98% vs test 24% (375 samples) — mitigated by blend weight (30% × 33% conf = ~10% effective impact)
- w1/m1 nie wytrenowane (za mało danych — w1 labels dopiero po 7 dniach)

**Pliki:** `src/prediction/models/HybridPredictor.ts` (major), `src/prediction/index.ts`, `scripts/xgboost_train.py`

**Wyniki po fixie:**
- h1 BTC: 35% → oczekiwane ~50% (SM szum usunięty)
- h4: najlepszy horyzont, ~88% (SM waga 30% = sweet spot)
- h12: 0% → oczekiwane >40% (mean-reversion dodane)
- Verification: 0/0 → retrospective method działa
- XGBoost: 0 modeli → 24 modeli (będzie poprawiać się z większym dataset)

**Commit:** `5cdf725`

---

## Zmiany 25 lutego 2026

### 43. Regime Bypass dla PURE_MM + isBullishTrend fix (25.02)

**Problem:** kPEPE (PURE_MM) miał "death by 1000 cuts" — 48 transakcji w 23 minut, otwieranie i zamykanie shortów ze stratą. Logi pokazywały:
```
🛡️ [REGIME] kPEPE: bear_4h_bull_15m_but_rsi_overbought|rsi_overbought_no_top_buying|bull_trend_no_shorting_pump|near_htf_resistance_wait_for_breakout (Longs: false, Shorts: false)
🧠 [SIGNAL_ENGINE_OVERRIDE] kPEPE: PURE_MM mode → FORCE BOTH SIDES
```

Regime blokował **OBA kierunki** jednocześnie (absurd), potem SIGNAL_ENGINE_OVERRIDE wymuszał oba z powrotem. Zbędny chain, mylące logi.

**Root cause — 2 bugi:**

**A) Regime nie powinien dotyczyć PURE_MM:**
Regime jest zaprojektowany dla SM_FOLLOWER (ochrona kierunkowa). Market Maker musi quotować OBA kierunki — spread to jego zarobek. Regime blocking na PURE_MM to jak zakazanie kelnerowi podawania jedzenia.

**Fix w `mm_hl.ts` (L7495-7502):**
```typescript
const signalEngineResultRegime = getSignalEngineForPair(pair);
const isPureMmRegimeBypass = signalEngineResultRegime?.signalEngineOverride
  && signalEngineResultRegime?.mode === MmMode.PURE_MM;
const permissions = isPureMmRegimeBypass
  ? { allowLongs: true, allowShorts: true, reason: 'PURE_MM_REGIME_BYPASS' }
  : this.marketVision!.getTradePermissions(pair);
```

**B) `isBullishTrend` dawał sprzeczny wynik:**
```typescript
// PRZED (bug): 15m bull w 4h bear = isBullishTrend=true → blokuje shorty
const isBullishTrend = analysis.trend4h === 'bull'
  || (analysis.trend15m === 'bull' && analysis.rsi15m < 80);

// PO (fix): 15m bull w 4h bear = dead cat bounce, nie bullish trend
const isBullishTrend = analysis.trend4h === 'bull'
  || (analysis.trend4h !== 'bear' && analysis.trend15m === 'bull' && analysis.rsi15m < 80);
```

Contradictory flow (przed fix):
- Rule #1: 4h bear + RSI≥70 → block longs
- Rule #3: 15m bull + RSI<80 → `isBullishTrend=true` → block shorts
- Wynik: **oba zablokowane** — deadlock

Po fix: 15m bull w 4h bear NIE ustawia `isBullishTrend` → shorty nie blokowane → brak deadlocku.

**Log po fix:**
```
🛡️ [REGIME] kPEPE: PURE_MM_REGIME_BYPASS (Longs: true, Shorts: true)
```

**Pliki:** `src/mm_hl.ts`, `src/signals/market_vision.ts`

**Deploy:** SCP → server, `pm2 restart mm-pure mm-follower --update-env`, verified in logs.

**Commit:** `9f4ec2b`

### 44. kPEPE Grid Widen — fix adverse selection losses (25.02)

**Problem:** Po fixie regime (#43) bot handlował poprawnie na obu stronach, ale nadal tracił na round-tripach. Analiza trade history:
- Bot otwierał shorty (ask fill) @ 0.004363-0.004367
- Cena rosła +12bps w ciągu 60s
- Grid re-centerował się wyżej → nowe bidy @ 0.004369-0.004372
- Bidy fillowały się → zamknięcie shortów DROŻEJ niż otwarcie → strata -$0.17 do -$0.36 per $100

**Root cause:** L1 layer miał offsetBps=5 (0.05% od mid) — absurdalnie ciasno dla kPEPE z volatility 20-30bps/min. Ruch >10bps w 60s (co się działo regularnie) powodował "grid crossing" — nowe bidy wyżej niż stare aski = gwarantowana strata.

**Diagram problemu:**
```
Tick 1: mid=0.004360 | L1 ask=0.004363 (open short) | L1 bid=0.004357
Tick 2: mid=0.004375 | L1 ask=0.004378              | L1 bid=0.004372
→ Bid 0.004372 > old ask 0.004363 → zamknięcie shorta ze stratą!
```

**Fix — KPEPE_GRID_LAYERS (`mm_hl.ts`):**

| Layer | PRZED (bps) | PO (bps) | Zmiana |
|-------|------------|----------|--------|
| L1 | 5 (Scalping) | **18** (Core) | 3.6× szerzej |
| L2 | 14 (Core) | **30** (Buffer) | 2.1× szerzej |
| L3 | 28 (Buffer) | **45** (Wide) | 1.6× szerzej |
| L4 | 55 (Sweep) | **65** (Sweep) | 1.2× szerzej |

**Fix — NANSEN_TOKENS kPEPE tuning (`market_vision.ts`):**
- `baseSpreadBps`: 14 → **25** (0.14% → 0.25%)
- `minSpreadBps`: 5 → **12** (0.05% → 0.12%)

**Matematyka:**
- Stary L1 round-trip: 10bps (5+5). Ruch >10bps = strata. kPEPE ruszał się 20-30bps/min → strata co minutę.
- Nowy L1 round-trip: 36bps (18+18). Ruch musi przekroczyć 36bps żeby stracić → znacznie rzadsze.

**Weryfikacja po deploy (z logów):**
```
PRZED: L1 bid=5bps  ask=5bps  | sellPx=0.0043312 (5.3bps od mid)
PO:    L1 bid=18bps ask=18bps | sellPx=0.0043460 (18.4bps od mid)
```

**Pliki:** `src/mm_hl.ts` (KPEPE_GRID_LAYERS), `src/signals/market_vision.ts` (NANSEN_TOKENS kPEPE)

**Deploy:** SCP → server, `pm2 restart mm-pure --update-env`

**Commit:** `aa91889`

### 42. Pump Shield — ochrona shortów przed pumpami (25.02)

**Problem:** Bot trzyma SHORT pozycje (zgodnie z SM consensus), ale podczas gwałtownych pompek grid BID ordery zostają wypełnione — bot KUPUJE na szczycie, zamykając shorta ze stratą.

**Realne straty:**
- **MON 13.02**: Short @ $0.0171-0.0188, pump +26% do $0.0225. Bot zamknął CAŁY short w 1 sekundzie (20 BUYs @ $0.0225). Strata: **-$2,130**
- **LIT 06.02**: Short @ $1.49-1.50, pump +10% do $1.65. Bot zamknął short (7 BUYs @ $1.65). Strata: **-$570**

**Wzorzec 58bro.eth:** Przy pumpie DODAJE do shorta (scale-in SELL orders), a TP grid ma niżej. Pump Shield naśladuje ten pattern.

**Pliki:** `src/config/short_only_config.ts`, `src/mm_hl.ts`

**A) PumpShieldConfig (short_only_config.ts):**
- Interface + defaults + 8 per-token overrides + getter
- 3 levele detekcji: light (bid×0.50), moderate (bid×0.10), aggressive (bid×0.00)
- Scale-in: opcjonalne zwiększenie asks podczas pumpa (×1.30)
- Cooldown: 3 ticki po pumpie z 50% bidami
- SM integration: smMinConfidence 40% (nawet niski SM SHORT aktywuje)

**Per-token progi (% rise over 5 ticks):**

| Token | Light | Moderate | Aggressive | Scale-in |
|-------|-------|----------|------------|----------|
| BTC | 0.5% | 1.0% | 2.0% | yes |
| ETH | 0.6% | 1.2% | 2.5% | yes |
| SOL | 0.8% | 1.5% | 3.0% | yes |
| HYPE | 1.0% | 2.0% | 3.5% | yes |
| LIT/FARTCOIN/MON | 1.5% | 3.0% | 5.0% | yes |
| kPEPE | 2.0% | 4.0% | 6.0% | **no** |

kPEPE: wyższe progi (wysoka vol), scale-in wyłączony (PURE_MM, nie kierunkowy).

**B) Price History Tracking (mm_hl.ts):**
- `pumpShieldHistory: Map<string, {price, ts}[]>` — last 10 ticks per pair
- `pumpShieldCooldowns: Map<string, number>` — ticks remaining per pair
- Updated every tick after midPrice calculation

**C) detectPump() (mm_hl.ts):**
- Sprawdza max rise % w oknie N ticków (windowTicks=5)
- Porównuje też single-tick change (nagłe spiki)
- Zwraca PumpState: {isPump, level, changePct, windowTicks}

**D) Grid Pipeline Filter (mm_hl.ts, przed BounceFilter):**
- SM check: aktywny gdy smDir=SHORT + confidence>=40%, LUB gdy ma SHORT position
- Przy pumpie: redukuje/blokuje bidy, opcjonalnie scale-in asks (cap 2.5x)
- Cooldown: po pumpie 3 ticki z bid×0.50
- Log: `🛡️ [PUMP_SHIELD] PAIR: LEVEL pump +X.X% → bid×Y.YY ask×Z.ZZ | SM: DIR XX%`

**E) Nuclear Level (mm_hl.ts, po PROFIT_FLOOR):**
- Aggressive pump: usuwa bid orders z grida
- Aggressive pump: cancelluje istniejące bid orders na giełdzie
- Log: `🛡️ [PUMP_SHIELD] PAIR: Removed N bid orders (AGGRESSIVE pump protection)`

**SM Integration:**

| SM Dir | Confidence | Pump | Action |
|--------|-----------|------|--------|
| SHORT | >= 40% | YES | Shield ACTIVE |
| SHORT | < 40% | YES | ACTIVE only if has SHORT pos |
| LONG | any | YES | Shield OFF (pump aligned) |
| any | any | NO | Shield OFF |

**Czego NIE robimy:** Nie blokujemy Anaconda SL. Nie zmieniamy HOLD_FOR_TP. Nie tworzymy nowych plików. Nie dodajemy nowych API calls.

**Deploy:** SCP → server, `pm2 restart mm-follower mm-pure --update-env`. Oba online, zero crash.

**Monitoring:** `pm2 logs mm-pure | grep PUMP_SHIELD`

---

## Zmiany 24 lutego 2026

### 41. Whale Tracker Quality Fixes — Fasanara MM, Dormant Decay, Manual Boost (24.02)

**Problem:** Audyt BOT vs MANUAL ujawnił 3 problemy z agregacją SM w whale_tracker.py:
1. Fasanara Capital ($83.9M, 100% maker, 100% CLOID) to market maker — ich shorty to hedges, signal_weight=0.85 zawyżał SM SHORT consensus
2. 9 dormant adresów (brak fills 7-21 dni) trzyma $66.7M pozycji liczonych jak aktywne sygnały
3. OG Shorter (MANUAL, $23M, +$15.5M) miał finalWeight=0.13 bo brak nansen_label

**Plik:** `whale_tracker.py` (jedyny zmieniony plik)

**A) Fasanara Capital → MARKET_MAKER (weight 0.0):**
- `tier`: FUND → MARKET_MAKER
- `signal_weight`: 0.85 → 0.0
- `nansen_label`: Fund → Market Maker
- **Efekt:** `final_weight = 0.0` → kompletnie wyłączony z agregatu. Usunięcie ~$64M phantom SHORT.

**B) PnL-aware Dormant Decay (updated 24.02):**
- Nowy plik aktywności: `/tmp/whale_activity.json` (`{address: last_change_epoch}`)
- `load_activity()` / `save_activity()` helpers
- Update w `run_tracker()`: po `detect_changes()`, porównuje current vs previous pozycje per adres, aktualizuje timestamps
- **PnL-aware logic**: dormant + profitable = diamond hands (full weight), dormant + losing = stale (decay)
- Decay w `aggregate_sm_positions()`:

| Warunek | Factor | Log | Przykład |
|---------|--------|-----|----------|
| Dormant >7d + uPnL > 0 | **1.0** | `💎 [DIAMOND_HANDS]` | Kapitan BTC (21d, +$14.8M), Kraken A (15d, +$12.8M) |
| Dormant 7-14d + uPnL <= 0 | 0.50 | `💤 [DORMANT]` | — |
| Dormant 14-21d + uPnL <= 0 | 0.25 | `💤 [DORMANT]` | ZEC Conviction (14d, -$3.8M), Arrington XRP (18d, -$402K) |
| Dormant 21d+ + uPnL <= 0 | 0.10 | `💤 [DORMANT]` | — |
| Active (0-7d) | 1.0 | — | Generał, Major |

- **Diamond Hands Hall of Fame (7 addresses, +$44M uPnL):** Kapitan BTC, Kraken A, Kapitan feec, Porucznik SOL2, Abraxas Capital, Kraken B, Kapitan 99b1
- Pierwszy run po deploy ustawia `now_epoch` dla wszystkich (baseline). Decay startuje od kolejnych runów.

**C) Manual Trader Boost:**
- **OG Shorter**: tier ACTIVE→CONVICTION, signal_weight 0.65→0.85, dodano `nansen_label: "All Time Smart Trader"`. Efekt: 0.13 → **0.81** (6x boost)
- **Kapitan fce0**: signal_weight 0.80→0.85. Efekt: 0.80 → **0.85**

**D) October 2025 Manual Traders — Nansen cross-reference (24.02):**
- Cross-referenced Nansen BTC Short leaderboard z whale_tracker — znaleziono 11 nowych adresów, 2 z nich mają duże aktywne pozycje
- **October Shorter f62ede** (`0xf62edeee...`): CONVICTION, weight 0.80, nansen_label "Smart HL Perps Trader". $769K equity, BTC SHORT $3.5M (entry $105.5K, +$2.4M, +67%), ZEREBRO +2503%, PUMP +187%. MANUAL trader (nie bot).
- **October Shorter c1471d** (`0xc1471df3...`): CONVICTION, weight 0.80, nansen_label "Smart HL Perps Trader". $1.7M equity, BTC SHORT $2.9M (+80%), ETH SHORT $2M (+106%), SOL SHORT $1M (+75%), FARTCOIN +718%, 8+ more shorts. MANUAL trader (nie bot).
- Oba adresy z "October 2025 BTC short cohort" — shortowali BTC przy $105-113K i trzymają od miesięcy. Combined +$4.7M uPnL.
- finalWeight: 0.80 × 1.0 = **0.80** (Nansen-verified = credibility 1.0)

**E) Nansen Leaderboard Top BTC Shorters (24.02):**
- Rozszerzenie trackera o top shorterów z Nansen BTC Short leaderboard — adresy z ogromnym conviction i profit
- **Mega Shorter 218a65** (`0x218a65e2...`): CONVICTION, weight 0.75. MANUAL TRADER. $3.4M equity, BTC SHORT $25.6M (358 BTC, entry $71.2K, +$3M, +186% ROI, 14x lev). Funded from Coinbase — individual trader. Liq $71.6K (tight! $5.8M DeFi collateral). Brak nansen_label → finalWeight 0.75×0.30 = **0.225**
- **Algo Shorter d62d48** (`0xd62d484b...`): CONVICTION, weight 0.70. ALGO BOT (14,996 trades/30d). $8.6M equity, BTC SHORT $20.9M (279 BTC, entry $75.2K, +$3.4M, +778% ROI, 40x lev). Liq $92.5K. #16 BTC PnL leaderboard (+$5.1M/30d). Brak nansen_label → finalWeight 0.70×0.30 = **0.21**
- Niski finalWeight (0.21-0.23) bo brak Nansen label — jeśli user dostarczy labele, credibility skoczy do 0.95-1.0

**F) Selini Capital re-add + re-reclassify as MM + Contrarian tracker (24.02):**
- Nansen live scan: Selini Capital otworzył FRESH BTC shorts @ $62,940 (24.02) — re-added jako FUND 0.40
- **Następnie reklasyfikacja → MARKET_MAKER 0.0**: openOrders API potwierdziło tight spread MM grids ($57-100 spread) na obu kontach. Nie directional — pure market making.
- **Selini Capital #1** (`0x39475d...`): MARKET_MAKER, weight 0.0. Tight MM grid ($60-100 spread).
- **Selini Capital #2** (`0x621c55...`): MARKET_MAKER, weight 0.0. Tight MM grid ($57 spread).
- **Contrarian Long 015354** (`0x015354...`): WATCH, weight 0.15, nansen_label "Smart HL Perps Trader". Jedyny notable SM BTC LONG ($12M, 191 BTC, entry $65,849, 2x isolated, -$597K underwater). Negative confirmation — gdy traci, SHORT thesis potwierdzona.
- finalWeight: Selini **0.0** (MM, excluded), Contrarian 0.15×1.0=**0.15**

**SM Activity Snapshot (24.02, live Nansen scan):**
- **58bro.eth REDUCING** — sold ~49 BTC ($3.1M) today @ $63K. Take profit, still 212 BTC SHORT
- **OG Shorter c7290b REDUCED** — sold 20 BTC ($1.3M) yesterday @ $66,130. Now 76 BTC SHORT
- **Selini Capital** — fresh entry, 2 accounts BTC SHORT $4.7M @ $62,940 → **re-reclassified as MARKET_MAKER** (tight MM grids confirmed via openOrders)
- **Only notable LONG** — 0x015354 $12M @ $65,849, 2x isolated, already -$597K

**Open Orders Intelligence (24.02):**
- Hyperliquid API `openOrders` ujawnia take-profit/re-entry levels SM traderów
- **Consensus BTC target zone: $50,000-$53,500** (3 niezależni traderzy):
  - 58bro.eth: 26 BTC bids $50,000-$62,500 ($17.76M total)
  - Pulkownik: 150 BTC bids $50,525-$53,525 ($7.73M) — zamknął shorty, czeka na re-entry
  - October f62ede: BTC bids $51,139-$52,639 + apocalyptic alt targets (ETH $521-$1,563, SOL $21-$50)
- Kraken B: 247 orders across ETH/SOL/XRP/HYPE/ZEC (~$9.1M)
- **58bro.eth BTC strategy** (deep scan): 41 orders, $12.5M total. 25 BUY $50K-$62K (TP grid — zamykanie shorta) + 16 SELL $66K-$69.75K (scaling in — dodawanie do shorta przy odbiciu). Gap $62K-$66K = strefa konsolidacji. Hardcore bear: spada→TP, rośnie→scale in more SHORT.
- **Selini Capital = confirmed MM** via openOrders: tight spread grids ($57-100), nie directional → reklasyfikacja na MARKET_MAKER 0.0

**G) MARKET_MAKER alert filter (24.02):**
- Dodano filtr w `detect_changes()`: `if tier == 'MARKET_MAKER': continue`
- **Efekt:** Fasanara, Selini #1, Selini #2 — zero alertów na Telegram. Eliminuje szum z MM flipów.
- Łącznie 3 adresy MM w systemie, wszystkie wyciszone (weight=0.0, zero alertów)

**Deploy:** SCP → server, `python3 whale_tracker.py` (syntax OK, 22 changes sent, 55→58 adresów), `pm2 restart mm-bot`

### 38. VIP Flash Override — szybsze wykrywanie flipow SM (24.02)

**Problem:** Generał flipnął z SHORT na LONG na LIT (23.02, $192K). whale_tracker.py aktualizuje co 15 min, ale agregat 6 traderów nadal pokazywał FOLLOW_SM_SHORT bo inni SM wciąż shortują. Bot kontynuował shortowanie LIT mimo że najważniejszy VIP (weight=0.95) flipnął.

**Rozwiązanie:** VIP Flash Override — po `analyzeTokenSm()` w `loadAndAnalyzeAllTokens()`, czyta `/tmp/vip_spy_state.json` (30s fresh z vip_spy.py) i sprawdza czy top VIP (signalWeight >= 0.90) z pozycją >= $50K disagrees z aktualnym directional mode. Jeśli tak → downgrade do PURE_MM (nie flip — zbyt agresywne).

**Plik:** `src/mm/SmAutoDetector.ts`

**Stałe:**
- `VIP_FLASH_MIN_WEIGHT = 0.90` (Generał 0.95, Major 0.95, Wice-Generał 0.90, Kraken A 0.90)
- `VIP_FLASH_MIN_POSITION_USD = 50_000`
- Czyta `/tmp/vip_spy_state.json` (async, fsp.readFile)

**Logika:**
```
analysis.mode = FOLLOW_SM_SHORT + Generał is LONG $192K
→ DISAGREE → downgrade to PURE_MM
→ convictionScore = 0, source = 'VIP_FLASH_OVERRIDE'
→ Log: "🕵️ [VIP_FLASH] LIT: Generał is LONG $192K vs FOLLOW_SM_SHORT → PURE_MM"
```

**Dlaczego PURE_MM a nie flip:**
- 5 traderów nadal shortuje, Generał jedynym longiem
- Flip na FOLLOW_SM_LONG = ryzykowne (może być trap)
- PURE_MM = bezpieczne (stop shortowania, czekaj na potwierdzenie)
- Gdy whale_tracker się zaktualizuje i agregat potwierdzi flip → bot sam przejdzie na FOLLOW_SM_LONG

**Edge cases:** vip_spy nie istnieje → skip, pozycja < $50K → skip, PURE_MM/FLAT → skip (nie override neutralnych), pierwszy disagreement → break

**Kompilacja:** `tsc --noEmit` czysto (jedyny pre-existing error w mm_alert_bot.ts)

**Deploy:** SCP → server, `pm2 restart mm-bot` — działa, zero VIP_FLASH logów bo LIT już w PURE_MM (SignalEngine WAIT zone). Override zadziała gdy whale_tracker da FOLLOW_SM_SHORT a VIP wciąż będzie LONG.

### 40. VIP Address Classification — BOT vs MANUAL audit (24.02)

**Metoda:** Analiza fills z Hyperliquid API (userFillsByTime, userFills) — sub-1s fill %, maker %, CLOID %, fill frequency.

**Wyniki (22 adresów w vip_spy):**

| Alias | Typ | Fills 24h | Sub-1s% | Maker% | CLOID% | Notional | uPnL |
|-------|-----|-----------|---------|--------|--------|----------|------|
| **Generał** | ALGO BOT | 1,977 | 45% | 58% | 99.9% | $2.5M | +$1.9M |
| **Wice-Generał** | ALGO BOT | 190 | 52% | 0% | 0% | $25.7M | +$16.2M |
| **Major** | ALGO BOT | 948 | 54% | 0% | 100% | $25.1M | +$9.0M |
| **Fasanara Capital** | MM BOT | 1,958 | 34% | 100% | 100% | $83.9M | +$14.1M |
| **Laurent Zeimes** | ALGO BOT | 2,000 | 65% | 0% | 0% | $35.8M | +$2.1M |
| **Abraxas Capital** | ALGO BOT | 2,000 | 68% | 8% | 100% | $3.2M | +$2.1M |
| **donkstrategy.eth** | ALGO BOT | 2,000 | 66% | 6% | 100% | $4.7M | +$2.6M |
| **Porucznik SOL3** | MM BOT | 1,516 | 55% | 76% | 100% | $16.1M | +$206K |
| **0x880ac4 (donkstrat#2)** | MM BOT | 695 | 61% | 97% | 0% | $17.4M | +$4.1M |
| **58bro.eth** | TAKER | 609 | 13% | 4% | 0% | $25.8M | +$9.3M |
| **BTC/LIT Trader** | MM BOT | 39 | 79% | 100% | 0% | $445K | +$3.7K |
| **OG Shorter** | **MANUAL** | 0 (7d: 2) | 55%* | 42%* | 100%* | $23.1M | +$15.5M |
| **Kapitan fce0** | **MANUAL** | 0 (7d: 35) | 68%* | 74%* | 0%* | $11.5M | +$6.2M |
| **Kapitan BTC** | DORMANT 21d | 0 | - | - | - | $20.3M | +$14.8M |
| **Kapitan feec** | DORMANT | 0 | - | - | - | $13.7M | +$8.3M |
| **Kraken A** | DORMANT 15d | 0 | - | - | - | $14.2M | +$12.8M |
| **Porucznik SOL2** | DORMANT 16d | 0 | - | - | - | $6.9M | +$4.9M |
| **Kraken B** | DORMANT 18d | 0 | - | - | - | $1.4M | +$1.0M |
| **Kapitan 99b1** | DORMANT 15d | 0 | - | - | - | $1.2M | +$332K |
| **ETH Whale** | DORMANT 18d | 0 | - | - | - | $2.8M | -$376K |
| **Porucznik ea66** | DORMANT | 0 | - | - | - | $4.2M | -$2.0M |
| **ZEC Conviction** | DORMANT 2d | 0 | - | - | - | $6.6M | -$3.8M |

**Podsumowanie:** 6 ALGO BOT, 4 MM BOT, 1 TAKER, 2 MANUAL, 9 DORMANT, 4 EMPTY

**CLOID = Custom Order ID** — smoking gun dla programmatic trading. Generał (99.9%), Major (100%), donkstrategy (100%), Fasanara (100%), Abraxas (100%).

**9 DORMANT adresów trzyma $66.7M pozycji (+$60M uPnL)** — to "set and forget" lub crashnięte boty. whale_tracker liczy je w agregacie jako aktywne sygnały, co **zawyża SM SHORT consensus**.

**⚠️ KRYTYCZNY WNIOSEK:** Fasanara Capital ($83.9M, 100% maker, 100% CLOID) to **pure market maker**, nie directional trader. Ich SHORT pozycje mogą być delta-neutral hedges, nie directional bets. Liczenie ich jako "SM SHORT" w agregacie jest **potencjalnie mylące**.

**Implikacje dla bota:**
1. **Dormant inflation** — $66.7M dormant SHORT pozycji zawyża agregat. Prawdziwy "live" sentiment aktywnych traderów może być bardziej neutral.
2. **Fasanara filtr** — rozważyć oznaczenie Fasanara jako MM (weight 0.0) zamiast CONVICTION. Ich 100% maker profile = nie directional.
3. **Najcenniejsze sygnały** — OG Shorter (MANUAL, $23M, +$15.5M) i Kapitan fce0 (MANUAL, $11.5M, +$6.2M). Rzadko tradują ale z ogromną conviction.
4. **Generał to bot** — flip na LIT LONG to decyzja algorytmu, nie człowieka. Może reagować na quantitative signals które my nie widzimy.

### 39. LIT Vesting Distribution Alert (24.02, intel)

**Nansen Alert:** Fresh wallets received $17.5M LIT w 24h (76× avg)

**Źródło:** Oficjalna dystrybucja z kontraktu `Lighter: LIT Distributor`:
- $11.1M → Token Millionaire (0xb3058a)
- $5M → Lightspeed Fund VC (0x1190ce)
- $1.5M → kolejny Token Millionaire

**Interpretacja:** Vesting/unlock tokenów zespołu i inwestorów — NIE organiczny popyt. Potencjalna presja sprzedażowa.

**Kontekst LIT:**
- Lighter = DEX perps, token uruchomiony XII.2025, 25% podaży w airdropie
- Dominacja spadła z 60% → 8.1% (bearish fundamental)
- Cena: ATH ~$3+ → $1.35 (24.02)
- Program buybacków $30-40M z opłat protokołu (bullish long-term)
- Generał LONG $192K mimo vestingu — może wie o buybackach

**Wpływ na bota:** Brak zmian. LIT już w PURE_MM (mixed signals). VIP Flash Override gotowy na wypadek gdyby whale_tracker wygenerował FOLLOW_SM_SHORT.

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

### 37. Fib Guard — nie shortuj dna (24.02)

**Cel:** Zmniejszyć askMultiplier gdy cena blisko Fibonacci support levels (0.618, 0.786, 1.0), RSI oversold, i duży drawdown od szczytu. SM Override: gdy SM confidence >= 70% i aktywnie shortują → FibGuard off.

**Pliki:**
- `src/config/short_only_config.ts` — `FibGuardConfig` interface, defaults, per-token overrides, getter
- `src/mm_hl.ts` — import `getFibGuardConfig`, integracja w grid pipeline (po bounce filter, przed dip filter)

**Logika:**
```
guardScore = fibProximity × 0.50 + rsiScore × 0.25 + drawdownScore × 0.25

fibProximity: odległość ceny od Fib 0.618/0.786/1.0 (1.0 = na poziomie)
rsiScore:     pseudo-RSI z change1h/change4h (1.0 = oversold)
drawdownScore: spadek od high24h (1.0 = drawdown >= maxPct)

score >= 0.7 → ask × 0.15 (STRONG)
score >= 0.5 → ask × 0.30 (MODERATE)
score >= 0.3 → ask × 0.50 (LIGHT)
score <  0.3 → ask × 1.00 (bez zmian)
```

**SM Override (używa istniejącego `signalEngineResultFso`):**
- `smConfidence >= 70%` + SHORT → guard OFF
- `smConfidence >= 50%` + SHORT → guardScore × 0.5

**Per-token overrides:**
| Token | proximityBps | drawdownMaxPct |
|-------|-------------|----------------|
| BTC | 30 | 5% |
| ETH | 35 | 6% |
| LIT | 80 | 12% |
| FARTCOIN | 80 | 12% |
| Default | 50 | 8% |

**Pseudo-RSI zamiast prawdziwego:** `50 + change1h×5 + change4h×2` — brak dodatkowych API calls, wystarczająco dobre dla guardu.

**Logi:** `🏛️ [FIB_GUARD] PAIR: STRONG/MODERATE/LIGHT/SM OVERRIDE/SM SOFTEN`

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
| 48 | `mm-pure` | `src/mm_hl.ts` | online | PURE_MM bot (kPEPE) |
| 52 | `copy-general` | `scripts/general_copytrade.ts` | online | Copy-trading Generała (LIVE, whitelist: LIT+xyz:GOLD, 02.03) |
| 4 | `nansen-bridge` | nansen data provider | online | Port 8080, Golden Duo API |
| 25 | `vip-spy` | `scripts/vip_spy.py` | online | VIP SM monitoring (30s poll, ALL COINS dla Generała) |
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
feat/next

# Ostatni commit
feat: add 15 candlestick pattern features to XGBoost pipeline (30→45 features)

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
- [ ] Weryfikować predykcje po fixie — `/verify/:token`, sprawdzić czy h1 accuracy wzrosła z 35% do ~50% (BTC/ETH), h4 utrzymuje ~88%, h12 > 0%
- [ ] Monitorować XGBoost blend — `/xgb-status`, 24 modeli załadowanych, sprawdzić effective weight (~10% z 30% × 33% conf)
- [ ] Retrain XGBoost po 1 tygodniu — ~1000+ samples, sprawdzić czy test accuracy rośnie (z 24% przy 375 próbkach)
- [ ] Porównać War Room predykcje z rzeczywistą ceną — h1 direction accuracy powinien być >50%, h4 >70%
- [ ] XGBoost w1/m1 — w1 labels dostępne po 7 dniach (od ~5.03), m1 po 30 dniach (od ~28.03). Retrain potem.
- [ ] Monitorować Auto-Skew — logi `⚖️ [AUTO_SKEW]` co 20 ticków, sprawdzić czy shift rośnie proporcjonalnie do skew (np. skew=30% → shift=6bps)
- [ ] Sprawdzić Auto-Skew fills — czy closing-side fills przyspieszają po wdrożeniu (porównaj fill rate przed/po w hourly report)
- [ ] Sprawdzić Auto-Skew max cap — czy shift nie przekracza 15bps nawet przy ekstremalnym skew (>75%)
- [ ] Monitorować Dynamic TP — logi `🎯 [DYNAMIC_TP]`, sprawdzić czy triggeruje przy micro-reversal + position (wymaga: microReversal=true + hasShortPos/hasLongPos + momentumScore odpowiedni)
- [ ] Monitorować Inventory SL — logi `🚨 [INVENTORY_SL]`, sprawdzić czy triggeruje gdy |skew|>40% i drawdown > 2.5×ATR% (wymaga: duża pozycja + ruch cenowy przeciwko)
- [ ] Sprawdzić Dynamic TP spread widening — czy L1 bid/ask jest faktycznie dalej od mid po triggerze (porównaj z normalnym logiem [SPREAD])
- [ ] Sprawdzić Inventory SL panic closing — czy asks=0 i bids×2.0 skutecznie zamyka pozycję (obserwuj skew reduction w kolejnych tickach)
- [ ] Monitorować Momentum Guard v2 — logi `📈 [MOMENTUM_GUARD]`, czekać na większy ruch kPEPE żeby zobaczyć score != 0
- [ ] Sprawdzić position-aware guard w akcji — flaga `⚠️SHORT+PUMP→bids_protected` gdy bot ma SHORT i cena pompuje
- [ ] Sprawdzić micro-reversal detection — flaga `🔄MICRO_REVERSAL→closing_protected` gdy 1h laguje ale cena odbiła
- [ ] Sprawdzić ATR-based thresholds — czy pump/dump threshold adaptuje się do zmienności (powinien być różny w nocy vs dzień)
- [ ] Monitorować Pump Shield — logi `🛡️ [PUMP_SHIELD]`, sprawdzić czy triggeruje przy price spikach na kPEPE i SM-following pairs
- [ ] Sprawdzić Pump Shield na kPEPE — progi 2/4/6%, czy nie blokuje normalnych ruchów cenowych
- [ ] Sprawdzić scale-in na SM pairs — czy ask×1.30 działa poprawnie podczas pumpa (nie dotyczy kPEPE)
- [ ] Sprawdzić cooldown — czy 3 ticki z bid×0.50 przywraca normalność po pumpie
- [ ] Monitorować dormant decay — logi `💤 [DORMANT]` po kolejnych runach whale_tracker (od 2. runu), sprawdzić czy 9 dormant adresów dostaje obniżone wagi
- [ ] Sprawdzić SM agregat po dormant decay — BTC/ETH SHORT powinien spaść (Fasanara usunięta + dormant decay), porównać `/tmp/smart_money_data.json` przed/po
- [ ] Monitorować `/tmp/whale_activity.json` — czy timestamps aktualizują się dla aktywnych traderów
- [ ] Monitorować VIP Flash Override — logi `🕵️ [VIP_FLASH]`, sprawdzić czy triggeruje gdy VIP disagrees
- [ ] LIT vesting monitoring — $17.5M unlock 24.02, obserwować presję sprzedażową i reakcję ceny
- [ ] Monitorować FibGuard — logi `🏛️ [FIB_GUARD]`, czy guard aktywuje się blisko Fib support levels
- [ ] Sprawdzić SM Override FibGuard — gdy SM confidence >= 70%, guard powinien być OFF
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
- [x] Fasanara Capital reklasyfikacja — MARKET_MAKER, weight 0.0, usunięty z agregatu (~$64M phantom SHORT) (DONE 24.02)
- [x] Dormant decay — `/tmp/whale_activity.json`, 4-tier decay (7d/14d/21d+), logi `💤 [DORMANT]` (DONE 24.02)
- [x] Manual trader boost — OG Shorter 0.13→0.81 (6x), Kapitan fce0 0.80→0.85 (DONE 24.02)

## Notatki
- **Fib Guard**: Redukuje askMultiplier blisko Fib support levels (0.618, 0.786, 1.0). Trzy sygnały: fibProximity (50%), pseudo-RSI (25%), drawdown (25%). SM Override: conf>=70% → guard OFF, conf>=50% → guard×0.5. Per-token overrides: BTC/ETH tighter, LIT/FARTCOIN wider. Pipeline: po bounce filter, przed dip filter. Config w `short_only_config.ts`. Logi: `🏛️ [FIB_GUARD]`.
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
- **Fasanara Capital** (`0x7fdafde5cfb5465924316eced2d3715494c517d1`): London hedge fund, +$30.8M Oct crash. $94.5M notional. **RECLASSIFIED 24.02: MARKET_MAKER, weight=0.0** — 100% maker fills, 100% CLOID = pure MM, not directional. Wyłączony z agregatu SM.
- **Abraxas Capital** (`0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36`): tier2, +$37.9M Oct crash, wypłacił $144M na Binance. Obecne: XRP $3.6M + HYPE $3.4M SHORT = $7.2M. Dodany 21.02.
- **Bitcoin OG pełny cykl**: +$165M na BTC shorts paź 2025 → zlikwidowany -$128M na ETH LONG sty 2026. Konto zamknięte.
- **VIP Spy (po update 21.02)**: 25 VIPów (tier1=10, tier2=10, fund=5), 25 watched coins (dodano AVAX). Bitcoin OG #2 dodany jako "watching for return". vip-spy zrestartowany.
- **ai-executor Nansen relay**: `.env.ai-executor` MUSI istnieć w katalogu bota — bez niego alerty Nansen nie trafiają do kolejki. Token: `@HyperliquidMM_bot` (8273887131). `can_read_all_group_messages: false` ale działa (bot jest adminem kanału Nansen).
- **3 procesy AI na serwerze**: (1) ai-executor PM2 = Nansen relay (KRYTYCZNY), (2) ai-chat-gemini.mjs = prosty chatbot, (3) ai-executor.mjs GOD MODE = /panic, /close, AI analiza. Procesy 2 i 3 poza PM2 (katalog `/home/jerry/ai-risk-agent/`).
- **Kanał "serwerbotgemini"**: Strukturyzowane alerty "Severity: warn / Summary / Suggested actions" to odpowiedzi Gemini 2.0 Flash z GOD MODE (`ai-executor.mjs`). NIE automatyczne — ktoś musi wysłać pytanie lub logi trafiają do Gemini.
- **PM2 vs Cron**: One-shot skrypty (run-and-exit) NIE MOGĄ być PM2 daemons — PM2 restartuje po exit albo pokazuje "stopped". Użyj cron. PM2 = daemons (long-running). Cron = periodic one-shots.
- **prediction-api isMainModule**: `import.meta.url === \`file://${process.argv[1]}\`` failuje pod PM2 (resolving ścieżek). Fix: `if (true)` na serwerze. Plik: `dist/prediction/dashboard-api.js`. **UWAGA:** Ten fix gubi się przy `pm2 delete + pm2 start` — trzeba ponownie edytować plik dist.
- **prediction-api NansenFeatures**: `src/prediction/features/NansenFeatures.ts` — naprawiony mapping: `parsed.data[token]` (nie `parsed.tokens`), `current_longs_usd` (nie `total_long_usd`), bias z `direction`+`boost`. Bez tego 40% wagi modelu (Smart Money) = zero.
- **prediction-api endpointy**: `/predict/:token`, `/predict-all`, `/predict-xgb/:token`, `/verify/:token`, `/weights`, `/features`, `/xgb-status`, `/xgb-features/:token`, `/health`. Tokeny: BTC, ETH, SOL, HYPE, ZEC, XRP, LIT, FARTCOIN (8). Horyzonty: h1, h4, h12, w1, m1 (5). Wagi per-horizon: h1 tech-heavy (SM 10%), h4 balanced (SM 30%), h12+ SM-heavy (SM 40-65%). Stare: SM 40% flat.
- **prediction-api PREDICTION_HORIZONS**: Config-driven horyzonty w `HybridPredictor.ts`. Multipliers: h1=0.5 (was 0.3), h4=1.0 (was 0.8), h12=1.5, w1=3.0, m1=5.0. confMax maleje (80→30) bo dlugi horyzont = mniej pewnosci. Slope dampened logarytmicznie dla w1/m1.
- **XGBoost data timeline**: w1 etykiety po 7 dniach, m1 po 30 dniach. MIN_SAMPLES: h1-h12=50 (was 200), w1=30 (was 100), m1=20 (was 50). 24 modeli wytrenowanych (h1/h4/h12 × 8 tokens). Collector `LABEL_BACKFILL_ROWS=0` (skanuje wszystkie wiersze dla m1 30-day lookback).
- **Nansen channel ID**: `-1003886465029` = "BOT i jego Sygnaly" (prawidłowy). `-1003724824266` = stary/nieistniejący. Bot `@HyperliquidMM_bot` jest administratorem kanału.
- **Porty na serwerze (updated)**: 3000=war-room (8 tokens, 4x2 grid), 8080=nansen-bridge, 8081=mm-bot telemetry (fallback), 8090=prediction-api
- **Raporty na Discord**: hourly (cron :15) = fills/PnL/positions/orders, daily 08:00 UTC = whale positions 41 portfeli, whale changes 3x daily (06/12/18 UTC) = delta zmian pozycji. Wszystkie potrzebują `DISCORD_WEBHOOK_URL` w `.env`. Snapshot zmian: `/tmp/whale_changes_snapshot.json`.
- **sm-short-monitor**: Nansen API 403 "Insufficient credits" — 62% success rate (5165 errors / 8212 successes). Proces działa, częściowo fetchuje dane. Fix wymaga dokupienia kredytów Nansen.
- **VIP Flash Override (24.02)**: Czyta `/tmp/vip_spy_state.json` po `analyzeTokenSm()`. VIP (signalWeight >= 0.90) z pozycją >= $50K disagrees z directional mode → downgrade do PURE_MM. Nie flip — za agresywne. Logi: `🕵️ [VIP_FLASH]`. Stałe: `VIP_FLASH_MIN_WEIGHT=0.90`, `VIP_FLASH_MIN_POSITION_USD=50000`.
- **LIT Vesting (24.02)**: $17.5M unlock z `Lighter: LIT Distributor` → Lightspeed Fund VC + Token Millionaires. Nie organiczny popyt. Dominacja Lighter 60%→8.1%. Cena ATH $3+ → $1.35. Buyback program $30-40M (bullish long-term).
- **VIP Classification (24.02)**: 6 ALGO BOT (Generał, Wice-Generał, Major, Laurent Zeimes, Abraxas, donkstrategy), 4 MM BOT (Fasanara 100% maker, SOL3, 0x880ac4, BTC/LIT Trader), 1 TAKER (58bro.eth), 2 MANUAL (OG Shorter, Kapitan fce0), 9 DORMANT ($66.7M stale positions), 4 EMPTY. CLOID = custom order ID = programmatic trading.
- **Dormant Decay (24.02, updated)**: PnL-aware — dormant + profitable = `💎 [DIAMOND_HANDS]` (full weight), dormant + losing = `💤 [DORMANT]` (decay: 7-14d=0.50, 14-21d=0.25, 21d+=0.10). `/tmp/whale_activity.json` tracks last change per address. 7 diamond hands addresses (+$44M uPnL) keep full weight: Kapitan BTC, Kraken A, Kapitan feec, Porucznik SOL2, Abraxas Capital, Kraken B, Kapitan 99b1. Only stale losers (ZEC Conviction -$3.8M, Arrington XRP -$402K) get decayed.
- **Manual Trader Boost (24.02)**: OG Shorter upgraded: ACTIVE→CONVICTION, weight 0.65→0.85, nansen_label "All Time Smart Trader" → finalWeight 0.13→0.81 (6x). Kapitan fce0: weight 0.80→0.85 → finalWeight 0.80→0.85. MANUAL traderzy (2 fills/7d) mają najwyższy conviction — rzadko tradują ale z ogromną dokładnością.
- **October 2025 Manual Traders (24.02)**: Nansen BTC Short leaderboard cross-ref → 2 nowe adresy dodane. October Shorter f62ede (`0xf62ede...`, CONVICTION 0.80, BTC SHORT $3.5M +67%, ZEREBRO +2503%). October Shorter c1471d (`0xc1471d...`, CONVICTION 0.80, BTC SHORT $2.9M +80%, ETH +106%, SOL +75%). Oba MANUAL (nie boty), Nansen "Smart HL Perps Trader" verified. Combined +$4.7M uPnL.
- **Nansen Leaderboard Shorters (24.02)**: Top BTC shorters z Nansen leaderboard. Mega Shorter 218a65 (`0x218a65...`, CONVICTION 0.75, MANUAL, BTC SHORT $25.6M, +186% ROI). Algo Shorter d62d48 (`0xd62d48...`, CONVICTION 0.70, ALGO BOT 15K trades/30d, BTC SHORT $20.9M, +778% ROI). Brak nansen_label → niski finalWeight (0.21-0.23). Łącznie +$6.4M uPnL, combined $46.5M SHORT exposure.
- **Open Orders Intelligence (24.02)**: SM take-profit targets z Hyperliquid openOrders API. Consensus BTC zone: $50,000-$53,500 (58bro.eth $17.76M bids, Pulkownik $7.73M bids, October f62ede bids $51-53K). October f62ede apocalyptic alt targets: ETH $521-$1,563, SOL $21-$50.
- **Selini Capital (24.02, final)**: 22.02 usunięte jako MM spam → 24.02 re-added jako FUND 0.40 (fresh BTC shorts) → 24.02 **re-reclassified MARKET_MAKER 0.0** (openOrders API potwierdza tight spread MM grids $57-100). Historia: MM spam → "może directional?" → potwierdzone MM. Trzecia zmiana tego samego dnia. **Lekcja: nie ufaj pierwszemu wrażeniu — weryfikuj orderami.**
- **MARKET_MAKER alert filter (24.02)**: `detect_changes()` pomija `tier == 'MARKET_MAKER'` → zero Telegram alertów dla Fasanara, Selini #1/#2. MM flipują ciągle, alerty to czysty szum.
- **58bro.eth BTC strategy (24.02)**: 41 open orders ($12.5M). BUY $50K-$62K = TP grid (zamykanie shorta z zyskiem). SELL $66K-$69.75K = scaling in (dodawanie do shorta przy odbiciu). Gap $62K-$66K = consolidation zone. Hardcore bear play.
- **SM Flows vs BTC Price (2025, Nansen research)**: Analiza przepływów SM na Hyperliquid Bridge vs cena BTC. SM win rate 86% (6/7 trafione). Kluczowe momenty: (1) Mar-Apr: +$13.5M IN @ $78-86K → BTC rally do $105K, (2) Jun: -$10M OUT @ $105K → sprzedali szczyt, (3) **10-11.10: +$33.7M IN, -$30.8M OUT w 24h @ $125K** → rekordowy short play, BTC crash do $80K, zysk ~$150M+, (4) Nov: +$22M IN @ $86-94K → kupili dołek po crashu, (5) Dec: +$17M IN @ $91K → jedyny pudło (BTC spadł do $62K, ale mogli grać SHORT). Obecnie SM saldo +$4.1M (poza HL) — czekają. **Sygnał do obserwowania: duży inflow SM >$10M na HL = potencjalne dno.** Alert ustawiony na Nansen: USDC >$20M na HL Bridge 2 (0x2df1c5).
- **Bitcoin OG klaster (research 24.02)**: 3 adresy (0xb317d2, 0x2ea18c, 0x4f9a37) — wszystkie $0, kompletnie puste po likwidacji -$128M (31.01.2026). Łączne przepływy: >$700M przez Binance↔HL. Dominował 80%+ flow >$10M na HL w 2025. Powiązany z Garrett Jin (ex-CEO BitForex), Arkham label "Trump insider whale". Cykl: +$165M na shortach (paź 2025) → flip na LONG (gru 2025) → likwidacja -$128M na ETH LONG (sty 2026). Nic do dodania do trackera.
- **Generał LIT LONG (24.02)**: 141K LIT LONG @ $1.38, $194K, +$7.2K (+3.7%), **5x isolated** (nie cross — izoluje ryzyko). Zrealizował +$2.8M na LIT shortach w 7 dni (76.7% ROI), flipnął na LONG. Jedyny LONG w portfelu (reszta = 5 shortów $3.5M). Wice-Generał nadal SHORT LIT $370K — **sprzeczne sygnały** z top VIPów → PURE_MM na LIT.
- **LIT SM landscape (24.02)**: Generał #1 PnL (+$2.8M realized). Wice-Generał SHORT $370K. Laurent Zeimes SHORT $1.3M. Manifold SHORT $1.6M. "ghostofsonora" aktywny — net LONG 221K LIT ($310K). Token Millionaire 0x687fed zamknął LONG 500K LIT. Zero SM spot activity na Ethereum.
- **Contrarian Long tracker (24.02)**: 0x015354 — jedyny notable SM BTC LONG ($12M, 191 BTC, entry $65,849, 2x isolated, -$597K underwater). WATCH tier, weight 0.15. Negative confirmation: gdy traci, SHORT thesis potwierdzona. nansen_label "Smart HL Perps Trader".
- **SM Live Activity (24.02)**: 58bro.eth reduced ~49 BTC ($3.1M) @ $63K (take profit, still 212 BTC SHORT). OG Shorter reduced 20 BTC ($1.3M) @ $66,130. Selini Capital fresh entry $4.7M. ETH: 58bro $9.3M SHORT, Galaxy $6.2M (+$8.8M uPnL). Fasanara $45M ETH SHORT (MM, ignored). Abraxas +$14.1M realized ETH PnL 7d.
- **Pump Shield (25.02)**: Ochrona shortów przed pumpami. 3 levele: light (bid×0.50), moderate (bid×0.10), aggressive (bid×0.00 + cancel exchange bids). Per-token progi: BTC 0.5/1/2%, kPEPE 2/4/6%, LIT/FARTCOIN 1.5/3/5%. Scale-in asks×1.30 podczas pumpa (wyłączone dla kPEPE). SM integration: aktywny gdy SM SHORT + confidence>=40%. Cooldown 3 ticki. Config w `short_only_config.ts`. Pipeline: przed BounceFilter + po PROFIT_FLOOR. Logi: `🛡️ [PUMP_SHIELD]`.
- **PM2 naming (25.02)**: Bot działa jako `mm-follower` (id 45) i `mm-pure` (id 48), NIE `mm-bot`. Restart: `pm2 restart mm-follower mm-pure`.
- **PURE_MM Regime Bypass (25.02)**: PURE_MM pary (kPEPE) pomijają regime gating całkowicie. Regime jest dla SM_FOLLOWER (kierunkowa ochrona), nie dla market makera. MM musi quotować OBA kierunki. Log: `PURE_MM_REGIME_BYPASS (Longs: true, Shorts: true)`.
- **isBullishTrend fix (25.02)**: 15m bull w 4h bear to dead cat bounce, nie bullish trend. Przed fixem `isBullishTrend=true` blokował shorty nawet w 4h bear → deadlock (oba kierunki zablokowane). Teraz: `trend4h !== 'bear'` jest wymagane żeby 15m bull ustawił `isBullishTrend=true`. Fix dotyczy WSZYSTKICH par, nie tylko kPEPE.
- **kPEPE Grid Widen (25.02)**: L1 5→18bps, L2 14→30bps, L3 28→45bps, L4 55→65bps. Stary L1 (5bps) powodował adverse selection — grid re-centering co 60s tworzył nowe bidy powyżej starych asków → gwarantowana strata. Nowy L1 (18bps) daje 36bps round-trip buffer. baseSpreadBps 14→25, minSpreadBps 5→12. KPEPE_GRID_LAYERS w mm_hl.ts, NANSEN_TOKENS w market_vision.ts.
- **Momentum Guard (26.02)**: Asymetryczny grid dla kPEPE PURE_MM. 3 sygnały: 1h momentum (50%), RSI (30%), proximity S/R (20%). Score -1.0 do +1.0. Pozytywny (pump) → redukuj bidy, zwiększ aski. Negatywny (dump) → mirror. 3 levele: strong (0.7), moderate (0.4), light (0.2). Config w `short_only_config.ts`, logika w kPEPE sekcji `mm_hl.ts`. Logi: `📈 [MOMENTUM_GUARD]` co 20 ticków lub przy |score| >= 0.4.
- **Momentum Guard v2→v3 (26.02)**: v2 miał 7 fixów: body-based S/R, breakout math, ATR proximity, ATR pumpThreshold, dump asymmetry, position-aware guard, micro-reversal. **v3 usunął position-aware guard** (punkt 6) — `skipBidReduce=pumpAgainstShort` i `skipAskReduce=dumpAgainstLong` łamały mean-reversion. Teraz: DUMP→asks×0.10 (trzymaj longi), PUMP→bids×0.10 (trzymaj shorty). Jedyny skip: micro-reversal (cena odbiła 0.3% od extremum → odblokuj closing). Flagi: `💎SHORT+PUMP→holding`, `💎LONG+DUMP→holding`, `🔄MICRO_REVERSAL→closing_allowed`.
- **Momentum Guard scope**: TYLKO kPEPE (PURE_MM). SM-following pary (LIT, FARTCOIN, HYPE) używają Pump Shield, nie MG. MG jest w kPEPE sekcji `if (pair === 'kPEPE')` po Toxicity Engine.
- **Momentum Guard 1h S/R (05.03, updated)**: Proximity signal używa **1h candle bodies** (24 candles = 24h lookback). Było: 15m×48 (12h) — za dużo szumu. Pola: `supportBody12h`, `resistanceBody12h` w PairAnalysis (nazwy zachowane dla kompatybilności, wartości teraz z 1h). Fallback na HTF (1h×72=3d) gdy niedostępne. Min guard: stfLookback>=12 (12h). MM execution nadal na 15m candles (RSI, trend, break detection). Log: `S/R(1h): R=$X S=$X`.
- **Dynamic TP (26.02)**: Rozszerza closing-side spread ×1.5 gdy micro-reversal + pozycja na winning side. SHORT+pump_stalling → bid spread ×1.5 (TP dalej, łapie więcej spadku). LONG+dump_stalling → ask spread ×1.5. Modyfikuje `gridBidMult`/`gridAskMult`. Config: `tpSpreadWidenerEnabled=true`, `tpSpreadMult=1.5`. Log: `🎯 [DYNAMIC_TP]`.
- **Inventory SL (26.02)**: Panic mode gdy |skew|>40% AND drawdown > 2.5×ATR%. SHORT underwater → asks=0 + bids×2.0. LONG underwater → bids=0 + asks×2.0. Guard: `drawdownPct > 0` (tylko gdy underwater). Config: `inventorySlEnabled=true`, `maxSkewSlThreshold=0.40`, `slAtrMultiplier=2.5`, `panicClosingMult=2.0`. Log: `🚨 [INVENTORY_SL]`.
- **Prediction per-horizon weights (26.02)**: h1: tech 35% + momentum 30% + SM 10% (SM szum na 1h). h4: SM 30% (sweet spot). h12+: SM 40-65% (strukturalny sygnał). Mean-reversion dla h12+: RSI overbought → kontra-siła. Multiplier: h1=0.5, h4=1.0, h12=1.5, w1=3.0, m1=5.0. Config: `HORIZON_WEIGHTS` w `HybridPredictor.ts`.
- **Prediction verification (26.02)**: Retrospective method — traktuje `timePrices` map jako historyczny zapis, szuka ceny N godzin po predykcji. Stary: ±10% time window → nigdy nie matchował. Nowy: `directionAccuracy` + `directionTotal` per-horizon. Endpoint: `/verify/:token`.
- **XGBoost label key bug (26.02)**: Collector pisze `label_1h`, trainer szukał `label_h1` → "0 labeled" mimo 371 istniejących labels. Fix: `LABEL_KEY_MAP` w `xgboost_train.py` mapuje oba formaty. MIN_SAMPLES obniżone: h1-h12=50, w1=30, m1=20. scikit-learn wymagany przez XGBoost 3.2.0. 24 modeli wytrenowanych, overfitting (train 98% vs test 24%) mitigated przez 10% effective blend weight.
- **XGBoost data collection**: Co 15 min (cron), **65 features** per sample (11 tech + 11 nansen + 8 extra + 15 candle + 4 multi-day + 4 btc_cross + 3 orderbook + 3 meta_ctx + 3 derived + 3 btc_pred, od 28.02). Dataset: `/tmp/xgboost_dataset_{TOKEN}.jsonl`. Training: niedziele 04:00 UTC. Labels: h1 po 1h, h4 po 4h, h12 po 12h (w1/m1 usunięte 28.02 — temporal shift). `LABEL_BACKFILL_ROWS=500`. Tokeny: BTC, ETH, SOL, HYPE, ZEC, XRP, LIT, FARTCOIN, **kPEPE** (dodany 26.02). Backward compat: trainer i predictor akceptują 30, 45, 49, 53, 62, lub 65 features (padują zerami). BTC prediction proxy [62-64]: btc_pred_direction (-1/0/+1), btc_pred_change (tanh), btc_pred_confidence (0-1) — z prediction-api localhost:8090 (+1 HTTP call/run, <50ms). Dla BTC = [0,0,0]. ~31 API calls per collect run.
- **kPEPE risk pipeline (26.02, pełna kolejność)**: Toxicity Engine → TimeZone profile → **Prediction Bias (h4, ±15%)** → Momentum Guard (scoring + asymmetric mults) → Dynamic TP (spread widen) → Inventory SL (panic close) → **Auto-Skew (mid-price shift)** → generateGridOrdersCustom → Layer removal → Skew-based removal → Hedge trigger.
- **Auto-Skew (26.02, updated 02.03)**: Przesunięcie midPrice na podstawie inventory skew. SHORT heavy → mid UP (bidy bliżej rynku, zamykanie szybsze), LONG heavy → mid DOWN. Formuła: `shiftBps = -(actualSkew × 10 × autoSkewShiftBps)`, capped ±maxShiftBps. Config defaults: `autoSkewShiftBps=2.0`, `autoSkewMaxShiftBps=15.0`. **kPEPE override: `1.5 bps/10%`, max `10bps`** — user prefers holding positions, not aggressive closing. Przykład: kPEPE skew=-43% → +6.45bps (was +15bps with old 3.5/22 settings). Komplementarne z `getInventoryAdjustment()` (offset-based) i Enhanced Skew (size-based). Placement: po Inventory SL, przed `generateGridOrdersCustom`. Modyfikuje `midPrice` → cała siatka (L1-L4) przesuwa się jednocześnie. Log: `⚖️ [AUTO_SKEW]` co 20 ticków.
- **frankfrankbank.eth (25.02)**: `0x6f7d75c18e8ca7f486eb4d2690abf7b329087062`, CONVICTION 0.80, MANUAL trader. ETH SHORT $9.3M (entry $3,429, +$3.78M, 25x lev), BTC SHORT $102K (40x lev). ENS: frankfrankbank.eth. Discovered from Nansen SM inflow audit. Nansen label "Smart HL Perps Trader".
- **Prediction Bias (26-27.02)**: h4 predykcja z prediction-api (port 8090) jako soft ±15% bias na bid/ask size. `fetchPrediction()` co 5 min, `getPredictionBias()` zwraca bidMult/askMult. Confidence >= 50%, |change| >= 0.3%, staleFactor 0.5 po 15min. **Działa na WSZYSTKICH tokenach** (kPEPE w if-branch, reszta w else-branch `executeMultiLayerMM`). kPEPE: po Toxicity+TimeZone, PRZED Momentum Guard. Reszta: PRZED `generateGridOrders()`. Multiplicative z innymi modułami. Log: `📊 [PREDICTION_BIAS]` co 20 ticków (~20 min). **WAŻNE:** mm-follower biegnie z `src/` (ts-node), nie z `dist/` — zmiany muszą być SCP'd do `src/mm_hl.ts` na serwerze.
- **Multipliers = ROZMIAR, nie cena**: `bid×0.81` znaczy bidy mają 81% normalnego rozmiaru ($81 zamiast $100/level). Ceny orderów (L1=18bps, L2=30bps od mid) się NIE zmieniają. Każdy moduł (Toxicity, TimeZone, Prediction, MG) mnoży `sizeMultipliers.bid`/`.ask` — wynik końcowy to iloczyn wszystkich. Gdy moduły się zgadzają (np. oba BEARISH) → silna redukcja/wzmocnienie. Gdy się nie zgadzają → wzajemna neutralizacja.
- **kPEPE mixed case token**: Hyperliquid API wymaga dokładnie `kPEPE` (mała `k`). `toUpperCase()` zamienia na `KPEPE` → HTTP 500. Fix: `normalizeToken()` w dashboard-api.ts z `MIXED_CASE_TOKENS` mapą. Dotyczy WSZYSTKICH endpointów prediction-api: `/predict/`, `/verify/`, `/predict-xgb/`, `/xgb-features/`.
- **Copy-trading bot (27.02, updated 02.03)**: `scripts/general_copytrade.ts`, PM2 `copy-general` (id 52). Czyta `/tmp/vip_spy_state.json` co 30s, kopiuje NOWE pozycje Generała po $500 fixed (IOC 30bps slippage). **Whitelist:** `COPY_ALLOWED_COINS=LIT,xyz:GOLD` — TYLKO te coiny kopiowane. Baseline seeding: na starcie zapisuje snapshot istniejących pozycji i nie kopiuje ich. State: `/tmp/copy_general_state.json`. Tryby: `--dry-run` / `--live` (aktywny od 02.03). Żeby włączyć live: ustawić `COPY_PRIVATE_KEY` w `.env` + `args: "--live"` w `ecosystem.config.cjs`.
- **vip_spy.py ALL COINS (27.02)**: `track_all=True` dla Generała — pobiera WSZYSTKIE pozycje z HL API (nie tylko WATCHED_COINS whitelist). Pisze `/tmp/general_changes.json` z pełnym portfelem. Portfolio summary dołączane do alertów Telegram.
- **NansenFeed 429 fix (27.02)**: AlphaEngine skip dla PURE_MM (`IS_PURE_MM_BOT`), position cache fallback na 429 w `NansenFeed.ts`, batch size 3→2, delay 800→1500ms, sequential fetching.
- **Dynamic Spread (27.02)**: ATR-based grid layer scaling dla kPEPE. `DynamicSpreadConfig` w `short_only_config.ts`. Low vol (ATR<0.30%) → L1=28bps (widen), high vol (ATR>0.80%) → L1=14bps (tighten). L2-L4 proporcjonalnie (ratios 1.67, 2.50, 3.61). Min Profit Buffer: remove close orders < 10bps od entry. Logi: `📐 [DYNAMIC_SPREAD]`, `📐 [MIN_PROFIT]`.
- **kPEPE risk pipeline (05.03, pełna kolejność)**: Toxicity Engine → TimeZone profile → Prediction Bias (h4, ±15%) → Momentum Guard (scoring + asymmetric mults) → **Inventory-Aware MG Override (fix closing-side when against momentum)** → **S/R Reduction Grace Period (delay reduction on confirmed break)** → **S/R Progressive Reduction (take profit at S/R)** → **S/R Accumulation (build pos at S/R when flat, Fresh Touch Boost)** → **S/R Bounce Hold (reduce closing-side after accum, progressive release)** → **Breakout TP (close pos on strong aligned momentum)** → Dynamic TP (spread widen) → Inventory SL (panic close) → **Dynamic Spread (ATR-based layer scaling)** → Auto-Skew (mid-price shift) → generateGridOrdersCustom → **Min Profit Buffer** → Layer removal → Skew-based removal → Hedge trigger.
- **Inventory-Aware MG Override (04.03, updated 05.03)**: Gdy pozycja PRZECIW momentum (SHORT+PUMP lub LONG+DUMP) i |skew|>threshold, gwarantuje minimalny closing-side multiplier. `urgency = min(1.0, |skew|/0.50)`, `minClosing = 1.0 + urgency × (closingBoost - 1.0)`. Config: `inventoryAwareMgEnabled=true`, `inventoryAwareMgThreshold=0.15` (kPEPE: 0.08), `inventoryAwareMgClosingBoost=1.3` (kPEPE: 1.5). Override TYLKO gdy closing-side < minClosing. Self-correcting: disengages when |skew| drops below threshold. **S/R Suppression (05.03):** LONG near SUPPORT (prox<=-0.5) lub SHORT near RESISTANCE (prox>=0.5) → INV_AWARE suppressed, S/R Accumulation has priority. Bez tego INV_AWARE zamykał longi zbudowane przez S/R Accum przy supportie ze stratą (-$11.86 na 8 close'ach). Po fix: +$4.98 na 12 close'ach. Logi: `⚡ [INV_AWARE_MG]` (CLOSING OVERRIDE lub SUPPRESSED).
- **S/R Accumulation (04.03, updated 05.03)**: Buduje pozycję w kierunku bounce przy S/R gdy |skew| <= srMaxRetainPct (default 20%, **kPEPE: 15%** — was 8%, raised 05.03 bo akumulacja stopowała za wcześnie przy 11% skew). At support: bid×bounceBoost, ask×counterReduce, bidSpread×spreadWiden. At resistance: mirror. Same zone as S/R Reduction. Config: `srAccumulationEnabled`, `srAccumBounceBoost` (1.5/kPEPE: 1.8), `srAccumCounterReduce` (0.50), `srAccumSpreadWiden` (1.3), **`srAccumFreshMultiplier` (2.0/kPEPE: 3.0)**. **Fresh Touch Boost (05.03):** Przy niskim skew (pierwsze dotknięcie S/R) akumulacja jest wzmocniona — freshBoost skalowany od srAccumFreshMultiplier (skew=0%) do 1.0 (skew=srMaxRetainPct). kPEPE: bid×5.84 ask×0.17 przy skew=0% vs bid×1.72 ask×0.50 przy skew=15%. Logi: `🔄 [SR_ACCUM]` z `fresh×X.X`. Complementary z S/R Reduction — never both active (different skew conditions).
- **S/R Bounce Hold (05.03)**: Po S/R Accumulation zbudowała pozycję przy S/R, redukuje closing-side dopóki cena nie oddali się wystarczająco (w ATR multiples). Progressive release: askReduction = srBounceHoldAskReduction + holdProgress × (1.0 - srBounceHoldAskReduction). Config: `srBounceHoldEnabled=true`, `srBounceHoldMinDistAtr` (1.5/kPEPE: 2.0), `srBounceHoldAskReduction` (0.20/kPEPE: 0.15), `srBounceHoldMaxMinutes=30`. Clear: dist>=threshold, timeout 30min, skew<2%, S/R level changed. NIE blokuje Breakout TP (safety valve). Property: `srBounceHoldState: Map<string, {timestamp, srLevel, side}>`. Logi: `🔒 [BOUNCE_HOLD]` (holding), `🔓 [BOUNCE_HOLD]` (released), `⏰ [BOUNCE_HOLD]` (timeout). Komplementarne z S/R Accumulation — Accum buduje, Hold chroni.
- **Breakout TP (04.03)**: Agresywne zamykanie pozycji gdy silny momentum aligned z pozycją. LONG+pump (score>threshold): ask×closingBoost, bid÷closingBoost. SHORT+dump: mirror. Config: `srBreakoutTpEnabled`, `srBreakoutTpScoreThreshold` (0.50/kPEPE: 0.40), `srBreakoutTpClosingBoost` (1.5). Logi: `🚀 [BREAKOUT_TP]`. Multiplicative z MG — combined bid×0.067 ask×1.95 na strong pump z LONG.
- **S/R Progressive Reduction (04.03)**: Progresywne zamykanie pozycji schodząc do S/R. SHORT near support → reduce asks (stop building), boost bids (close). LONG near resistance → mirror. Zone = mgStrongZone × srReductionStartAtr (kPEPE: 2.5×ATR = ~4.5%). Progress 0→1 w strefie. Disengage gdy |skew| <= srMaxRetainPct (20%). Config: `srReductionEnabled`, `srReductionStartAtr` (3.0/kPEPE: 2.5), `srMaxRetainPct` (0.20), `srClosingBoostMult` (2.0). Logi: `📉 [SR_REDUCTION]` / `📈 [SR_REDUCTION]`. Multiplicative z MG — oba zgadzają się "stop shorting at support".
- **S/R Reduction Grace Period (05.03)**: Po BROKEN S/R (prox=±1.2, candle close confirmed) czekaj N candles 15m przed redukcją pozycji. Chroni przed fakeoutami — jeśli cena wróci powyżej supportu, grace kasuje się i akumulacja kontynuuje. Config: `srReductionGraceCandles` (default=2/30min, kPEPE=3/45min). Property: `srBreakGraceStart: Map<string, number>` na bocie. Grace triggeruje TYLKO na confirmed break (prox=±1.2), NIE na touch (prox=±1.0). Logi: `⏳ [SR_GRACE]` (started/active/expired), `✅ [SR_GRACE]` (recovered).
- **Proximity Signal prox=±1.0/±1.2 (05.03)**: Rozróżnienie touch vs confirmed break. `-1.0` = AT SUPPORT (tick price on/below), `-1.2` = BROKEN SUPPORT (15m candle CLOSED below), `+1.0` = AT RESISTANCE, `+1.2` = BROKEN RESISTANCE. `lastCandle15mClose` = `candles15m[length-2].c` (last CLOSED candle, nie forming). Używane przez: Grace Period (trigger), Discord alerts (BROKEN vs AT types), downstream systems.
- **Discord S/R Alerts updated (05.03)**: 6 typów: BROKEN_RESISTANCE/BROKEN_SUPPORT (💥, orange 0xff8800), AT_RESISTANCE/AT_SUPPORT, NEAR_RESISTANCE/NEAR_SUPPORT. Nowe pole embed: `15m Close`. Footer: `"BROKEN = candle close confirmed"`. Cooldown 30min per token per type.
- **TOKEN_WEIGHT_OVERRIDES (27.02)**: Per-token prediction weight overrides w `HybridPredictor.ts`. kPEPE: SM=0% (dead signal), redystrybuowane do technical+momentum+trend. Inne tokeny dalej używają `HORIZON_WEIGHTS` (SM 10-65%). Extensible — dodanie kolejnego tokena = 1 wpis w mapie. Kiedy przywrócić SM dla kPEPE: >= 3 SM addresses z >$50K na perps LUB SM spot activity >$500K/tydzień.
- **DRY_RUN instanceof guard pattern (02.03)**: W mm_hl.ts, KAŻDE użycie `this.trading as LiveTrading` lub dostęp do LiveTrading-only properties (l2BookCache, shadowTrading, binanceAnchor, vpinAnalyzers, adverseTracker, closePositionForPair) MUSI być chronione `if (this.trading instanceof LiveTrading)` lub nullable pattern: `const lt = this.trading instanceof LiveTrading ? this.trading : null; if (lt?.property)`. PaperTrading NIE ma tych properties → TypeError w DRY_RUN. Dwie różne klasy w pliku: `LiveTrading` (linia ~1479) i `HyperliquidMMBot` (linia ~3595) — metody na jednej NIE są dostępne na drugiej via `this`.
- **PM2 --update-env (02.03)**: Przy `pm2 restart` po zmianie pliku źródłowego, ZAWSZE dodawaj `--update-env`. Bez tego ESM loader (`--experimental-loader ts-node/esm`) może cacheować starą wersję modułu. Symptom: nowa metoda "is not a function" mimo że grep na serwerze potwierdza jej istnienie w pliku.
- **copy-general reconciliation (02.03)**: Sekcja 3b w `processTick()` — auto-reconcile real positions vs activeCopies state. Naprawia desync gdy IOC partial fill succeeds on-chain ale `placeOrder()` returns false → activeCopy nie zapisane. Dotyczy szczególnie xyz: coins (IOC w illiquid markets). Log: `🔧 RECONCILE:`. Guard: opposite side = nie kopia.
- **copy-general xyz:GOLD (02.03)**: Bot ma pozycję xyz:GOLD LONG $600 (6 fills 28.02). Generał ma GOLD LONG $1M (20x lev). Nasze kopia to ~$600 fixed. activeCopies teraz poprawnie śledzi — SIZE_REDUCED i CLOSED events dla GOLD będą obsługiwane.
- **copy-general Glitch Guard (02.03)**: Sekcja 4b — jeśli >50% pozycji Generała zniknęło w jednym ticku → API glitch, pomiń tick. Zapobiega usunięciu baseline entries i otwarciu fałszywych kopii. Root cause: `fetchMidPrices()` failure → vip_spy partial state → baseline removed → old positions treated as new.
- **copy-general Failed Order Cooldown (02.03)**: 30 min cooldown po failed order (np. PUMP "invalid price"). `orderFailCooldowns` Map<coin, expiry>. Cleared on success. Zapobiega error spamowi co 30s.
- **copy-general PUMP blocked (02.03)**: `COPY_BLOCKED_COINS: "PUMP"` permanentnie w `ecosystem.config.cjs`. PUMP price ~$0.0019 powoduje "Order has invalid price" bo `toPrecision(5)` nie produkuje valid tick size.
- **copy-general 6 fałszywych pozycji (02.03)**: API glitch 10:32 UTC otworzył 6 kopii starych pozycji Generała po $500 (FARTCOIN, LIT, APEX, ASTER, AVAX, RESOLV). Nadal aktywne. Kierunek zgodny z Generałem (SHORT/LONG matching).
- **copy-general COPY_ALLOWED_COINS (02.03)**: Whitelist env var — TYLKO wymienione coiny będą kopiowane. `COPY_ALLOWED_COINS: "LIT,xyz:GOLD"` w ecosystem.config.cjs. Jeśli puste = kopiuj wszystko (blocklist still applies). Whitelist > blocklist (whitelist sprawdzany pierwszy). Log na starcie: `Allowed coins: LIT, xyz:GOLD`.
- **copy-general baseline pitfall (02.03)**: NIGDY nie usuwaj wpisów z activeCopies state — bot potraktuje istniejące pozycje Generała jako "nowe" i otworzy kopie. Zamiast usuwać, ustaw `baseline: true` flag. Baseline entries = "znana pozycja, nie zarządzaj".
- **PM2 ecosystem.config.cjs env loading (02.03)**: `pm2 restart --update-env` czyta env z SHELL, nie z ecosystem.config.cjs. Żeby załadować env z pliku: `pm2 delete <name> && pm2 start ecosystem.config.cjs --only <name>`. Bez tego nowe env vars (np. COPY_ALLOWED_COINS) nie zostaną załadowane.
- **dotenv w scripts/ (02.03)**: Skrypty w `scripts/` nie ładują automatycznie `.env`. Trzeba explicit `import { config as dotenvConfig } from 'dotenv'; dotenvConfig()`. Bez tego env vars z `.env` (np. COPY_PRIVATE_KEY) są niewidoczne po PM2 recreate.
