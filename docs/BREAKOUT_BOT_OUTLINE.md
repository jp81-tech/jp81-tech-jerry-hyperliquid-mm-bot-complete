# Donchian Breakout Bot — Zarys Projektu

## 1. Koncept

Osobny bot trend-following na Hyperliquid. Nie ma nic wspólnego z market makingiem — wchodzi w pozycję gdy cena przebija Donchian Channel i jedzie z trendem.

**Inspiracja:** Moon Dev EZBot (`if price > BREAKOUT_PRICE: buy()`) — ale z prawdziwym risk management.

**Filozofia:** Breakout boty zarabiają rzadko ale dużo. 30-40% win rate, ale winning trades 3-5x większe niż losers. Nie próbuj łapać odwrócenia — jedź z trendem aż się skończy.

---

## 2. Strategia

### Filtr trendu: EMA 200 na 5m candles
- Cena > EMA200 → tylko LONG
- Cena < EMA200 → tylko SHORT
- Zapobiega wchodzeniu w breakouty przeciw głównemu trendowi

### Entry: Donchian Channel 20-period na 1m candles
- LONG: cena przebija 20-period HIGH → entry
- SHORT: cena przebija 20-period LOW → entry
- Potwierdzone zamknięciem candle (nie wick)

### Stop Loss: Donchian opposite band
- LONG entry → SL = 20-period LOW (dynamiczny, podąża za ceną)
- SHORT entry → SL = 20-period HIGH
- Trailing: SL się przesuwa z każdą nową candle

### Take Profit: 3R target
- R = odległość entry→SL
- TP = entry + 3×R (LONG) lub entry - 3×R (SHORT)
- Opcjonalnie: partial close 50% @ 2R, reszta trailing

### Filtr dodatkowy: Volume confirmation
- Breakout candle musi mieć volume > 1.5× avg(20 candles)
- Zapobiega false breakouts na niskim volume

---

## 3. Tokeny do handlu

Większe, bardziej płynne tokeny — lepsze breakouty:

| Token | Dlaczego | Leverage |
|-------|----------|----------|
| BTC | Najczystsze breakouty, najwyższy volume | 5x |
| ETH | Silna korelacja z BTC, dobra płynność | 5x |
| SOL | Wysokie momentum, trendy trwają dłużej | 3x |
| HYPE | Dobre swingi, dość płynny | 3x |

**NIE** kPEPE/FARTCOIN/LIT — za dużo szumu, fałszywe breakouty co 5 minut.

---

## 4. Risk Management

| Parametr | Wartość |
|----------|---------|
| Equity risk per trade | 1% (np. $100 przy $10K) |
| Max concurrent positions | 3 |
| Max daily loss | 3% equity |
| Max drawdown (kill switch) | 10% equity |
| Position sizing | `risk_usd / (entry - SL)` |

### Sizing example
```
Equity: $10,000
Risk per trade: 1% = $100
BTC entry: $65,000 (LONG breakout)
Donchian LOW (SL): $64,500
Distance: $500 (0.77%)
Position size: $100 / 0.77% = $12,987
Leverage needed: $12,987 / $10,000 = ~1.3x (comfortable)
```

---

## 5. Architektura

### Osobny proces, osobny portfel

```
┌─────────────────────────────────────┐
│  breakout_bot.ts                    │
│  PM2: breakout-bot                  │
│  Portfel: BREAKOUT_PRIVATE_KEY      │
│  Tick: co 15s (1m candle granularity)│
│                                     │
│  ┌────────────┐  ┌───────────────┐  │
│  │ DataEngine │  │ SignalEngine   │  │
│  │ (candles)  │──│ (EMA+Donchian)│  │
│  └────────────┘  └───────┬───────┘  │
│                          │          │
│  ┌────────────┐  ┌───────▼───────┐  │
│  │ RiskEngine │──│ OrderEngine   │  │
│  │ (sizing)   │  │ (IOC/ALO)    │  │
│  └────────────┘  └───────────────┘  │
└─────────────────────────────────────┘
```

### Główna pętla (co 15s)

```
1. Fetch 1m candles (last 25) + 5m candles (last 210)
2. Calculate indicators (Donchian 20, EMA 200)
3. Check existing positions → trailing SL, TP
4. Check for new breakout signals
5. If signal + risk OK → place order (IOC)
6. Log state + Discord alert
```

### Reużywane komponenty z MM bota

| Komponent | Plik | Co reużywamy |
|-----------|------|--------------|
| `HyperliquidAPI` | `src/api/hyperliquid.ts` | `getCandles()`, `getMetaAndAssetCtxs()`, `getClearinghouseState()` |
| `@nktkas/hyperliquid` | SDK | `ExchangeClient` do orderów (IOC reduce-only) |
| `technicalindicators` | npm | `EMA`, `DonchianChannels` |
| `axios` | npm | HTTP requests |
| `ethers` | npm | Wallet signing |
| Discord notifier | `src/utils/discord_notifier.ts` | `sendDiscordEmbed()` |

### Nowe komponenty

| Komponent | Odpowiedzialność |
|-----------|-----------------|
| `BreakoutDataEngine` | Fetch + cache candles, compute indicators |
| `BreakoutSignalEngine` | Donchian breakout detection + EMA filter |
| `BreakoutRiskEngine` | Position sizing, max positions, daily loss tracking |
| `BreakoutOrderEngine` | Place/cancel orders, trailing SL management |
| `BreakoutBot` (main) | Orchestrator — tick loop, state management |

---

## 6. Struktura plików

```
scripts/
  breakout_bot.ts          # Entry point (shebang: #!/usr/bin/env npx tsx)

src/breakout/
  BreakoutBot.ts           # Main class — tick loop, orchestrator
  BreakoutDataEngine.ts    # Candle fetching + indicator computation
  BreakoutSignalEngine.ts  # Breakout detection logic
  BreakoutRiskEngine.ts    # Position sizing + risk limits
  BreakoutOrderEngine.ts   # Order placement + SL/TP management
  types.ts                 # Interfaces
  config.ts                # Default config + env overrides
```

---

## 7. Config (env vars)

```bash
# Wallet
BREAKOUT_PRIVATE_KEY=0x...          # Osobny portfel!

# Strategy
BREAKOUT_TOKENS=BTC,ETH,SOL,HYPE   # Tokeny do handlu
BREAKOUT_DONCHIAN_PERIOD=20         # Donchian lookback (1m candles)
BREAKOUT_EMA_PERIOD=200             # EMA trend filter (5m candles)
BREAKOUT_VOLUME_MULT=1.5            # Volume confirmation multiplier
BREAKOUT_TP_R_MULT=3.0              # Take Profit = 3×R

# Risk
BREAKOUT_RISK_PCT=1.0               # % equity per trade
BREAKOUT_MAX_POSITIONS=3            # Max concurrent positions
BREAKOUT_MAX_DAILY_LOSS_PCT=3.0     # Daily loss kill switch
BREAKOUT_MAX_DRAWDOWN_PCT=10.0      # Total drawdown kill switch
BREAKOUT_DEFAULT_LEVERAGE=5         # Default leverage

# Execution
BREAKOUT_TICK_SEC=15                # Main loop interval
BREAKOUT_IOC_SLIPPAGE_BPS=20       # Slippage for IOC entry
```

---

## 8. PM2 Config

```javascript
// W ecosystem.config.cjs dodać:
{
  name: "breakout-bot",
  cwd: "/home/jerry/hyperliquid-mm-bot-complete",
  script: "scripts/breakout_bot.ts",
  interpreter: "npx",
  interpreter_args: "tsx",
  args: "--live",
  env: {
    BREAKOUT_TOKENS: "BTC,ETH,SOL,HYPE",
    BREAKOUT_RISK_PCT: "1.0",
    BREAKOUT_MAX_POSITIONS: "3",
    BREAKOUT_DEFAULT_LEVERAGE: "5",
  },
  max_memory_restart: "150M",
  max_restarts: 10,
  autorestart: true,
}
```

---

## 9. Fazy implementacji

### Faza 1: Skeleton + Paper Trading (~1 dzień)
- Entry point `breakout_bot.ts` z tick loop
- `BreakoutDataEngine` — fetch candles z `HyperliquidAPI`
- `BreakoutSignalEngine` — Donchian + EMA z `technicalindicators`
- Logowanie sygnałów (console + Discord)
- `--dry-run` mode — zero orderów, tylko logowanie
- PM2 deploy jako `breakout-bot`

### Faza 2: Live Execution (~1 dzień)
- `BreakoutOrderEngine` — IOC orders z `@nktkas/hyperliquid` SDK
- `BreakoutRiskEngine` — position sizing, max positions
- Trailing SL (update co tick)
- `--live` mode z osobnym portfelem
- Discord alerty: ENTRY, SL HIT, TP HIT, TRAILING UPDATE

### Faza 3: Hardening (~1 dzień)
- Daily loss kill switch
- Drawdown kill switch
- Rate limiting (HL API 2 req/s)
- Partial TP @ 2R (50% close)
- State persistence (`/tmp/breakout_state.json`)
- Reconnection / restart recovery

### Faza 4: Optymalizacja (ongoing)
- Backtest framework (reuse candle data)
- Parameter sweep (Donchian period, EMA period, R multiplier)
- Per-token tuning (BTC: 20-period, SOL: 15-period)
- Korelacja z MM botem (nie otwieraj breakout LONG na BTC gdy MM jest SHORT kPEPE — optional)

---

## 10. Breakout vs MM — porównanie

| Cecha | MM Bot (mm-pure) | Breakout Bot |
|-------|-------------------|--------------|
| Strategia | Mean-reversion, bid+ask | Trend-following, directional |
| Win rate | ~60-70% | ~30-40% |
| R:R ratio | ~1:1 | ~1:3 |
| Holding time | Sekundy-minuty | Minuty-godziny |
| # trades/day | 50-200 | 2-8 |
| Tokeny | kPEPE, VIRTUAL (illiquid) | BTC, ETH, SOL (liquid) |
| Portfel | Główny | Osobny |
| Ryzyko | Inventory (underwater position) | False breakout (SL hit) |

**Dlaczego dwa boty a nie jeden?** Fundamentalnie sprzeczne strategie. MM chce range-bound market. Breakout chce trending market. Łączenie w jednym procesie = konflikty decyzyjne, niemożliwe do debugowania.

---

## 11. Potential Issues + Mitigations

| Problem | Rozwiązanie |
|---------|-------------|
| False breakouts (choppy market) | EMA filter + volume confirmation + tight SL |
| Slippage na entry | IOC z 20bps slippage cap, liquid tokens only |
| HL API rate limit | 2 req/s limiter (reuse z MM bota), batch candle fetch |
| Bot restart = lost state | `/tmp/breakout_state.json` persistence, reconcile on startup |
| Overnight gaps | Trailing SL + max hold time (optional) |
| Korelacja BTC/ETH/SOL | Max 1 position per "group" (optional) |

---

## 12. API Calls per Tick

| Call | Count | Purpose |
|------|-------|---------|
| `candleSnapshot` 1m | 4 (per token) | Donchian + volume |
| `candleSnapshot` 5m | 4 (per token) | EMA 200 |
| `clearinghouseState` | 1 | Current positions |
| `allMids` | 1 | Current prices |
| **Total** | ~10 | Well within 2/s rate limit (10 calls / 15s tick = 0.67/s) |

---

## Quick Start (po implementacji)

```bash
# 1. Osobny portfel — przelej $1000 USDC
# 2. Deploy
pm2 start ecosystem.config.cjs --only breakout-bot

# 3. Monitor
pm2 logs breakout-bot --lines 50

# 4. Discord
# Alerty: BREAKOUT LONG BTC @ $65,000 | SL $64,500 | TP $66,500 | Size $13K
```
