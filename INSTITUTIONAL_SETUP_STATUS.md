# 🏛️ INSTITUTIONAL SETUP - Implementation Status

**Date:** 2025-11-13  
**Status:** Configuration Ready, Code Integration Pending

---

## ✅ Completed

### 1. Configuration (.env)
All institutional parameters added:

```bash
# Dynamic Clip Sizing
DYNAMIC_CLIP=true
CLIP_MIN_USD=40
CLIP_MAX_USD=180
CLIP_VOL_FACTOR=0.25

# Exposure Limits
MAX_EXPOSURE_MULTIPLIER=6
# ZEC: 6 × $180 = $1,080 max exposure
# UNI: 6 × $180 = $1,080 max exposure

# Anti-Pump/Dump Protection  
ANTI_PUMP_ENABLED=true
PUMP_THRESHOLD_1M=2.0%
PUMP_THRESHOLD_5M=3.5%

ANTI_DUMP_ENABLED=true
DUMP_THRESHOLD_1M=2.0%
DUMP_THRESHOLD_5M=3.5%

# Nansen Bias Adjustment
BIAS_ENABLED=true
BIAS_STRENGTH=0.35
BIAS_DECAY_MIN=30 min
BIAS_DECAY_MAX=240 min

# Daily Loss Limits
DAILY_LOSS_LIMIT_USD=120
DAILY_LOSS_PAUSE_MIN=180

# Spread Control
SPREAD_BASE_BPS=28
SPREAD_MAX_BPS=45
SPREAD_VOL_MULTIPLIER=1.5
```

### 2. Utility Modules Created
- `src/utils/riskConfig.ts` - Configuration loader ✅
- `src/utils/clipSizing.ts` - Dynamic clip calculation (pending upload)
- `src/utils/exposureGuard.ts` - Position size limits (pending upload)
- `src/utils/volatilityGuards.ts` - Anti-pump/dump (pending upload)
- `src/utils/biasEngine.ts` - Nansen bias spreads (pending upload)
- `src/utils/dailyLossGuard.ts` - Daily loss tracking (pending upload)

### 3. Documentation
- `RUNBOOK_INSTITUTIONAL.md` - Operations manual ✅
- `INSTITUTIONAL_SETUP_STATUS.md` - This file ✅

---

## ⏳ Pending Integration

The utility modules are ready but need to be integrated into your main trading bot file. This requires:

### Integration Points

#### 1. Dynamic Clip Sizing
**Location:** Where you currently use `BASE_ORDER_USD`  
**Current Code (example):**
```typescript
const baseOrderUsd = Number(process.env.BASE_ORDER_USD ?? "175");
const sizeUsd = baseOrderUsd;
```

**Replace With:**
```typescript
import { computeClipUsd } from "./utils/clipSizing";

const vol24hPct = pairVolatility?.volatility24h ?? 2.0;
const midPx = book.midPx;

const clipUsd = computeClipUsd({
  pair: symbol,
  midPx,
  vol24h: vol24hPct,
});

const sizeUsd = clipUsd;
```

#### 2. Exposure Guard
**Location:** Before placing new orders  
**Add:**
```typescript
import { canIncreaseExposure } from "./utils/exposureGuard";

const positionUsd = currentPositionSz * midPx;
if (!canIncreaseExposure({ pair: symbol, currentPositionUsd: positionUsd, clipUsd })) {
  log.info(`[RISK] skip ${symbol} order: exposure cap reached`, { positionUsd, clipUsd });
  return;
}
```

#### 3. Anti-Pump/Dump Protection
**Location:** Before submitting orders  
**Add:**
```typescript
import { shouldBlockByPumpDump } from "./utils/volatilityGuards";

const ret1m = last1mReturnPct;  // Calculate from recent candles
const ret5m = last5mReturnPct;  

const guard = shouldBlockByPumpDump({
  pair: symbol,
  side: side === "buy" ? "buy" : "sell",
  ret1mPct: ret1m,
  ret5mPct: ret5m,
});

if (guard.block) {
  log.info(`[RISK] skip ${symbol} ${side} by anti-pump/dump`, guard);
  return;
}
```

#### 4. Bias Adjustment
**Location:** Where spreads are calculated  
**Add:**
```typescript
import { adjustSpreadByBias } from "./utils/biasEngine";
import { riskConfig } from "./utils/riskConfig";

let spreadBps = riskConfig.spreadBaseBps;

const spreadBuyBps = adjustSpreadByBias(symbol, "buy", spreadBps);
const spreadSellBps = adjustSpreadByBias(symbol, "sell", spreadBps);
```

#### 5. Daily Loss Guard
**Location:** At start of order cycle  
**Add:**
```typescript
import { isPairPausedByDailyLoss } from "./utils/dailyLossGuard";

if (isPairPausedByDailyLoss(symbol)) {
  log.warn(`[RISK] ${symbol} is paused by daily loss limit`);
  return;
}
```

---

## 📊 Current System State

**Active Now:**
- Auto-Optimizer: ✅ Working (blocks BOME, HMSTR, sub-$12 notional)
- Pair Lockdown: ✅ Working (ZEC + UNI only)
- Account Health: ✅ Healthy ($16,604 value, $15,092 withdrawable)
- Positions: ✅ Profitable (ZEC SHORT +$9.64, UNI SHORT +$2.06)

**Pending Activation:**
- Dynamic clip sizing
- Exposure limits per pair
- Anti-pump/dump protection
- Nansen bias spreads
- Daily loss circuit breakers

---

## 🎯 Next Steps

### Option A: Full Integration (Recommended)
1. Locate main trading bot file (`src/mm_hl.ts` or similar)
2. Add imports for all utility modules
3. Integrate at the 5 key points above
4. Test with single pair first (ZEC only)
5. Monitor logs for `[RISK]` messages
6. Gradually enable all features

### Option B: Phased Rollout
1. **Phase 1:** Dynamic clip + exposure guard only
2. **Phase 2:** Add anti-pump/dump protection
3. **Phase 3:** Add bias adjustment + daily loss limits

### Option C: Manual Operation
Continue with current setup:
- Manual monitoring via RUNBOOK commands
- Configuration ready for future activation
- System stable as-is

---

## 🔍 Testing Checklist

When you integrate the code:

- [ ] Bot compiles without TypeScript errors
- [ ] Dynamic clips show in logs (40-180 USD range)
- [ ] Exposure guard blocks over-sized positions
- [ ] Anti-pump blocks BUY during >2% pumps
- [ ] Bias adjustment changes spreads per Nansen signals
- [ ] Daily loss limit pauses pairs after -$120 loss
- [ ] Telegram alerts working (if configured)
- [ ] No margin errors or API rejections

---

## 📞 Support Files

- **Operations:** `RUNBOOK_INSTITUTIONAL.md`
- **Configuration:** `.env` (institutional section at end)
- **Utilities:** `src/utils/` directory
- **Backups:** `.env.backup_institutional_*` files

---

**Last Updated:** 2025-11-13 08:00 UTC
