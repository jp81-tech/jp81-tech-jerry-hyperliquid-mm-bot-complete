# Auto-Rotation & Nansen Integration

**Intelligent capital allocation with smart money signals**

---

## Overview

The rotation system dynamically reallocates capital to the best-performing pairs every N minutes based on:
- Realized volatility (opportunity)
- Spread costs (efficiency)
- Market depth (safety)
- Trading fees (profitability)
- Nansen smart money signals (optional)

---

## Components

### 1. Rotator Module (`src/selection/rotator.ts`)

**Core Functions:**
- `scorePair()` - Score a single pair using weighted factors
- `pickTopN()` - Select top N pairs by score
- `getRotatorConfigFromEnv()` - Load config from ENV

**Scoring Formula:**
```typescript
score = wVol * log(1 + vol5m)
      + wSpread * -log(1 + spreadBps/1e4)
      + wDepth * log(1 + depthUsd/1e3)
      + wFees * -feesBps/10000
      + wNansen * nansenSignal  // [-1..+1]
```

### 2. Nansen Adapter (`src/signals/nansen_adapter.ts`)

**Signal Functions:**
- `getNansenSignal()` - Simple buy ratio signal
- `getNansenCompositeSignal()` - Composite signal (buy ratio + netflow + accumulation)
- `isNansenDataFresh()` - Check data age
- `getPairsWithFreshNansen()` - Get pairs with recent data

**Global State:**
```typescript
globalThis.__nansen = {
  'ASTER': {
    smart_buy_ratio: 0.65,        // 0..1 (65% smart money buys)
    smart_money_netflow_24h: 50000,  // USD
    whale_accumulation_score: 75,    // 0..100
    timestamp: 1730700000000
  },
  // ... more pairs
}
```

### 3. Retry Guard (`src/utils/retry_guard.ts`)

**E_TICK Protection:**
- Spec caching with TTL (default 60s)
- Automatic spec refresh on E_TICK error
- One-retry mechanism with fresh specs
- Logging for diagnostics

---

## Configuration

### ENV Variables

**Rotation Control:**
```bash
ROTATE_ENABLED=true
ROTATE_EVERY_MIN=240          # 4 hours
ROTATE_TOP_N=3
ROTATE_REQUIRE_NANSEN=false
```

**Scoring Weights:**
```bash
ROTATE_W_VOL=1.0
ROTATE_W_SPREAD=-0.6
ROTATE_W_DEPTH=0.4
ROTATE_W_FEES=-0.4
ROTATE_W_NANSEN=0.5
```

**Filters:**
```bash
ROTATE_MIN_DEPTH_USD=2000
ROTATE_MAX_SPREAD_BPS=40
```

**Retry Guard:**
```bash
RETRY_GUARD_ENABLED=true
RETRY_GUARD_MAX_RETRIES=1
RETRY_GUARD_SPEC_TTL_MS=60000
```

**Per-Pair Minimum Notional:**
```bash
PAIR_MIN_NOTIONAL_USD_SOL=20
PAIR_MIN_NOTIONAL_USD_ASTER=10
```

---

## Usage Examples

### Basic Rotation (No Nansen)

```typescript
import { pickTopN, getRotatorConfigFromEnv } from './selection/rotator.js'

const stats: MarketStats[] = [
  { pair: 'ASTER', realizedVol5m: 0.015, spreadBps: 12, topOfBookUsd: 5000, feesBps: 8 },
  { pair: 'SOL', realizedVol5m: 0.008, spreadBps: 8, topOfBookUsd: 15000, feesBps: 6 },
  { pair: 'PUMP', realizedVol5m: 0.025, spreadBps: 18, topOfBookUsd: 3000, feesBps: 10 }
]

const config = getRotatorConfigFromEnv()
const topPairs = pickTopN(stats, null, 3, config)

console.log('Selected pairs:', topPairs)
```

### With Nansen Signals

```typescript
import { pickTopN } from './selection/rotator.js'
import { getNansenCompositeSignal } from './signals/nansen_adapter.js'

globalThis.__nansen = {
  'ASTER': {
    smart_buy_ratio: 0.72,
    smart_money_netflow_24h: 125000,
    whale_accumulation_score: 85,
    timestamp: Date.now()
  },
  'SOL': {
    smart_buy_ratio: 0.55,
    smart_money_netflow_24h: -30000,
    whale_accumulation_score: 45,
    timestamp: Date.now()
  }
}

const topPairs = pickTopN(
  stats,
  (pair) => getNansenCompositeSignal(pair),
  3
)
```

### E_TICK Retry Guard

```typescript
import { getSpecWithCache, refreshSpec, isETICKError } from './utils/retry_guard.js'

const specProvider = async (pair: string) => {
  return await hyperliquid.getAssetMeta(pair)
}

try {
  const spec = await getSpecWithCache('SOL', specProvider, 60000)
  await placeOrder(...)
} catch (err) {
  if (isETICKError(err)) {
    const freshSpec = await refreshSpec('SOL', specProvider)
    await placeOrder(...)
  }
}
```

---

## Integration with Bot

### Step 1: Calculate Market Stats

Add to your main loop (every cycle):

```typescript
const stats: MarketStats[] = []

for (const pair of candidatePairs) {
  const l1 = await exchange.getL1(pair)
  const vol5m = calculateRealizedVol(pair, 5)

  stats.push({
    pair,
    realizedVol5m: vol5m,
    spreadBps: (l1.ask - l1.bid) / l1.mid * 10000,
    topOfBookUsd: Math.min(l1.bidSizeUsd, l1.askSizeUsd),
    feesBps: exchange.getFees(pair) * 10000
  })
}
```

### Step 2: Rotation Timer

Add rotation logic:

```typescript
let lastRotationMs = Date.now()
const rotateEveryMs = Number(process.env.ROTATE_EVERY_MIN ?? 240) * 60000

if (Date.now() - lastRotationMs >= rotateEveryMs) {
  const requireNansen = process.env.ROTATE_REQUIRE_NANSEN === 'true'
  const nansenFn = requireNansen ? getNansenCompositeSignal : null

  const topPairs = pickTopN(stats, nansenFn, Number(process.env.ROTATE_TOP_N ?? 3))

  console.log(`rotation_evt=rebalance pairs=${topPairs.join(',')} ts=${Date.now()}`)

  this.activePairs = topPairs
  lastRotationMs = Date.now()
}
```

### Step 3: E_TICK Guard in Submit

Wrap order submission:

```typescript
let attempt = 0
const maxRetries = Number(process.env.RETRY_GUARD_MAX_RETRIES ?? 1)

while (attempt <= maxRetries) {
  try {
    const spec = await getSpecWithCache(pair, getAssetMeta, 60000)
    const result = await submitOrder(...)
    break
  } catch (err) {
    if (isETICKError(err) && attempt < maxRetries) {
      logRetryAttempt(pair, attempt + 1, maxRetries, 'E_TICK')
      await refreshSpec(pair, getAssetMeta)
      attempt++
    } else {
      throw err
    }
  }
}
```

---

## Monitoring

### 24h Report Script

```bash
export LOKI_URL="http://localhost:3100"
bash scripts/report-24h.sh
```

**Output:**
```
E_TICK_total_last_24h=0
attempts_by_pair_last_24h: ASTER=542
attempts_by_pair_last_24h: SOL=189
attempts_by_pair_last_24h: PUMP=328
```

### Grafana Alert

The E_TICK alert (`config/grafana-provisioning/alerting/mm-bot-etick.yaml`) fires if any E_TICK errors occur within 5 minutes.

### Rotation Logs

```logfmt
rotation_evt=rebalance pairs=ASTER,SOL,FARTCOIN ts=1730700123456
rotation_evt=score pair=ASTER score=2.34 vol=0.015 spread=12 depth=5000 nansen=0.42
```

---

## Testing

### Test Rotator Scoring

```bash
npx tsx -e "
import { scorePair } from './src/selection/rotator.js'

const s = {
  pair: 'ASTER',
  realizedVol5m: 0.015,
  spreadBps: 12,
  topOfBookUsd: 5000,
  feesBps: 8
}

console.log('Score:', scorePair(s, null))
"
```

### Test Nansen Signal

```bash
npx tsx -e "
import { getNansenCompositeSignal } from './src/signals/nansen_adapter.js'

globalThis.__nansen = {
  'ASTER': {
    smart_buy_ratio: 0.72,
    smart_money_netflow_24h: 125000,
    whale_accumulation_score: 85,
    timestamp: Date.now()
  }
}

console.log('Nansen signal:', getNansenCompositeSignal('ASTER'))
"
```

---

## Production Deployment

### 1. Enable Rotation

```bash
cat >> .env << 'EOF'

# Auto-rotation
ROTATE_ENABLED=true
ROTATE_EVERY_MIN=240
ROTATE_TOP_N=3
ROTATE_REQUIRE_NANSEN=false

# Scoring weights
ROTATE_W_VOL=1.0
ROTATE_W_SPREAD=-0.6
ROTATE_W_DEPTH=0.4
ROTATE_W_FEES=-0.4
ROTATE_W_NANSEN=0.5

# Filters
ROTATE_MIN_DEPTH_USD=2000
ROTATE_MAX_SPREAD_BPS=40

# Retry guard
RETRY_GUARD_ENABLED=true
RETRY_GUARD_MAX_RETRIES=1
RETRY_GUARD_SPEC_TTL_MS=60000
EOF
```

### 2. Deploy E_TICK Alert

```bash
sudo cp config/grafana-provisioning/alerting/mm-bot-etick.yaml \
  /etc/grafana/provisioning/alerting/

sudo systemctl reload grafana-server
```

### 3. Setup Daily Report Cron

```bash
crontab -e

# Add:
0 9 * * * cd /root/hyperliquid-mm-bot-complete && LOKI_URL=http://localhost:3100 bash scripts/report-24h.sh >> reports/daily-$(date +\%Y\%m\%d).log 2>&1
```

### 4. Enable Nansen (Optional)

If you have Nansen Pro access:

```bash
echo "ROTATE_REQUIRE_NANSEN=true" >> .env
```

Then populate `globalThis.__nansen` in your Nansen feed handler.

---

## Expected Results

### Week 1
- Auto-rotation active every 4h
- Capital flowing to highest-score pairs
- Zero E_TICK errors (retry guard active)
- Rotation logs showing pair selection

### Month 1
- Consistent top-N pair selection
- Adaptive to market regime changes
- Nansen signals (if enabled) improving selection
- Complete audit trail in Loki

---

## Rollback

### Disable Rotation

```bash
# In .env
ROTATE_ENABLED=false

./stop-bot.sh && ./start-bot.sh
```

### Disable Retry Guard

```bash
# In .env
RETRY_GUARD_ENABLED=false

./stop-bot.sh && ./start-bot.sh
```

---

## Files Reference

```
src/
├── selection/
│   └── rotator.ts              ← Pair scoring and selection
├── signals/
│   └── nansen_adapter.ts       ← Nansen signal normalization
└── utils/
    └── retry_guard.ts          ← E_TICK retry with spec refresh

scripts/
└── report-24h.sh               ← Daily success report

config/grafana-provisioning/alerting/
└── mm-bot-etick.yaml           ← E_TICK alert rule

docs/
└── ROTATION_SYSTEM.md          ← This file
```

---

## FAQ

**Q: How often should I rotate?**
A: Start with 4h (240 min). Adjust based on market regime and gas costs.

**Q: Do I need Nansen?**
A: No. The rotator works without Nansen using vol/spread/depth/fees only.

**Q: What if E_TICK retry fails?**
A: The guard logs `retry_guard_exhausted` and skips the order. Check for spec drift.

**Q: Can I test rotation without deploying?**
A: Yes, use the test snippets above or add `ROTATE_DRY_RUN=true` (not yet implemented).

---

**Status:** Ready for production. Test locally, then enable `ROTATE_ENABLED=true`.
