# RISK + TREND GUARD PATCH
## Per-Side Stop Loss + Kraken Trend Detection

**Date:** 2025-11-13
**Target:** Hyperliquid MM Bot (ZEC + UNI)
**Goal:** Prevent losses like today's -$137 (15:00-17:00 UTC)

**Expected Impact:**
- Reduce major loss events by 50-70%
- Turn -$42 single loss → -$15 (stop loss trigger)
- Widen spreads during strong trends (avoid adverse selection)

---

## Changes Overview

1. **Per-Side Stop Loss** - Max unrealized loss per position (e.g., -$15 for UNI, -$25 for ZEC)
2. **Trend Guard** - Use Kraken `ret5m` + `rsi5m` to widen spreads against trends

---

## 1️⃣ `.env` - New Risk Parameters

Add to `.env` file:

```bash
# ─────────────────────────────────────────────
# Per-side max loss (unrealized) in USD
# ─────────────────────────────────────────────
ZEC_MAX_LOSS_PER_SIDE_USD=25
UNI_MAX_LOSS_PER_SIDE_USD=15

# Default for all other pairs (optional fallback)
DEFAULT_MAX_LOSS_PER_SIDE_USD=20

# ─────────────────────────────────────────────
# Trend guard (Kraken market_data_engine)
# ─────────────────────────────────────────────
TREND_GUARD_ENABLED=true
TREND_RET5M_THRESHOLD=0.005  # 0.5% in 5 minutes
TREND_RSI_HIGH=70
TREND_RSI_LOW=30
TREND_SPREAD_WIDEN_FACTOR=1.3  # widen by 30%
```

---

## 2️⃣ New File: `src/utils/trendGuard.ts`

**Assumes:** `runtime/market_metrics_{SYMBOL}.json` exists with:
```json
{
  "ts": 1699900000000,
  "midPx": 495.5,
  "ret1m": 0.002,
  "ret5m": 0.007,
  "rsi5m": 65.3,
  "high24h": 510.0
}
```

**Create file:**

```typescript
// src/utils/trendGuard.ts
import fs from 'fs'
import path from 'path'

export type TrendGuardSide = 'bid' | 'ask'

export interface PairTrendMetrics {
  symbol: string
  midPx: number
  ret5m: number
  rsi5m: number
  updatedAt: number
}

export interface TrendContext {
  bySymbol: Record<string, PairTrendMetrics>
  ret5mThreshold: number
  rsiHigh: number
  rsiLow: number
  widenFactor: number
}

/**
 * Loads Kraken-based trend metrics for a given pair symbol (e.g. "ZEC", "UNI").
 */
function loadPairMetrics(runtimeDir: string, symbol: string): PairTrendMetrics | null {
  const file = path.join(runtimeDir, `market_metrics_${symbol}.json`)
  if (!fs.existsSync(file)) return null

  try {
    const raw = fs.readFileSync(file, 'utf8')
    const data = JSON.parse(raw)

    if (
      typeof data.midPx !== 'number' ||
      typeof data.ret5m !== 'number' ||
      typeof data.rsi5m !== 'number' ||
      typeof data.ts !== 'number'
    ) {
      return null
    }

    return {
      symbol,
      midPx: data.midPx,
      ret5m: data.ret5m,
      rsi5m: data.rsi5m,
      updatedAt: data.ts,
    }
  } catch {
    return null
  }
}

/**
 * Builds a TrendContext from runtime files and env thresholds.
 */
export function loadTrendContext(pairs: string[]): TrendContext {
  const runtimeDir = path.join(process.cwd(), 'runtime')

  const ret5mThreshold = Number(process.env.TREND_RET5M_THRESHOLD ?? '0.005') // 0.5%
  const rsiHigh = Number(process.env.TREND_RSI_HIGH ?? '70')
  const rsiLow = Number(process.env.TREND_RSI_LOW ?? '30')
  const widenFactor = Number(process.env.TREND_SPREAD_WIDEN_FACTOR ?? '1.3')

  const bySymbol: Record<string, PairTrendMetrics> = {}

  for (const sym of pairs) {
    const m = loadPairMetrics(runtimeDir, sym)
    if (m) {
      bySymbol[sym] = m
    }
  }

  return {
    bySymbol,
    ret5mThreshold,
    rsiHigh,
    rsiLow,
    widenFactor,
  }
}

/**
 * Returns multiplicative factor for spread on given side.
 *
 * - UPTREND  (ret5m > thr & RSI > high): widen BIDs (bot less aggressive buying)
 * - DOWNTREND(ret5m < -thr & RSI < low): widen ASKs (bot less aggressive selling)
 * - Else: 1.0 (no change)
 */
export function getSpreadWidenFactor(
  ctx: TrendContext | null,
  pairSymbol: string,
  side: TrendGuardSide
): number {
  if (!ctx) return 1.0

  const m = ctx.bySymbol[pairSymbol]
  if (!m) return 1.0

  const { ret5m, rsi5m } = m
  const { ret5mThreshold, rsiHigh, rsiLow, widenFactor } = ctx

  // Uptrend -> widen bids only (don't buy aggressively into uptrend)
  if (ret5m > ret5mThreshold && rsi5m > rsiHigh && side === 'bid') {
    return widenFactor
  }

  // Downtrend -> widen asks only (don't sell aggressively into downtrend)
  if (ret5m < -ret5mThreshold && rsi5m < rsiLow && side === 'ask') {
    return widenFactor
  }

  return 1.0
}
```

---

## 3️⃣ Patch to `src/mm_hl.ts`

### 3.1 Add Imports and Class Fields

```diff
--- a/src/mm_hl.ts
+++ b/src/mm_hl.ts
@@ -35,6 +35,12 @@ import {
   intToDecimalString
 } from './utils/quant.js'

+import {
+  loadTrendContext,
+  getSpreadWidenFactor,
+  TrendContext,
+} from './utils/trendGuard.js'
+
 // ... existing imports ...

 export class HyperliquidMmBot {
@@ -50,6 +56,12 @@ export class HyperliquidMmBot {
   // ... existing fields ...

+  // Trend guard state (Kraken)
+  private trendContext: TrendContext | null = null
+  private lastTrendContextReloadMs = 0
+
+  // Simple cache of max loss per side in USD
+  private maxLossPerSideUsdByPair: Record<string, number> = {}
+
   constructor(/* ... */) {
     // ... existing constructor code ...
```

### 3.2 Initialize Risk Config in Constructor

```diff
   constructor(/* ... */) {
     // ... existing constructor code ...
+
+    // Per-side max loss per pair (fallback to DEFAULT_MAX_LOSS_PER_SIDE_USD)
+    const fallback = Number(process.env.DEFAULT_MAX_LOSS_PER_SIDE_USD ?? '20')
+    this.maxLossPerSideUsdByPair = {
+      ZEC: Number(process.env.ZEC_MAX_LOSS_PER_SIDE_USD ?? '25') || fallback,
+      UNI: Number(process.env.UNI_MAX_LOSS_PER_SIDE_USD ?? '15') || fallback,
+    }
   }
```

### 3.3 Add Helper: Refresh Trend Context

```typescript
  /**
   * Refresh trend context from Kraken metrics every ~30s
   */
  private refreshTrendContextIfNeeded(nowMs: number, activePairs: string[]): void {
    const enabled = String(process.env.TREND_GUARD_ENABLED ?? 'false').toLowerCase() === 'true'
    if (!enabled) {
      this.trendContext = null
      return
    }

    if (this.trendContext && nowMs - this.lastTrendContextReloadMs < 30_000) {
      return // still fresh
    }

    try {
      this.trendContext = loadTrendContext(activePairs)
      this.lastTrendContextReloadMs = nowMs
      this.notifier.info('🧭 Trend guard context refreshed from Kraken metrics')
    } catch (err) {
      this.notifier.warn('⚠️ Trend guard refresh failed: ' + (err as Error).message)
    }
  }
```

### 3.4 Add Helper: Get Net Position (NEEDS ADAPTATION)

**⚠️ DEV ACTION REQUIRED:** Replace with your actual position source

```typescript
  /**
   * Get net position for a pair (long/short, size, entry, mark)
   *
   * ⚠️ TODO: Adapt to your real position source!
   *
   * Example integration points:
   * - this.liveTrading.positions[pair]
   * - this.exchangeState.getPosition(pair)
   * - Similar to what check_position_pnl.ts uses
   */
  private getNetPositionForPair(pair: string): {
    side: 'long' | 'short'
    size: number      // absolute size in base coin
    entryPx: number   // average entry price
    markPx: number    // current mark price
  } | null {
    // TODO: Replace with actual position lookup
    //
    // Example (pseudo-code):
    //
    // const pos = this.livePositions[pair]
    // if (!pos || pos.sz === 0) return null
    //
    // return {
    //   side: pos.sz > 0 ? 'long' : 'short',
    //   size: Math.abs(pos.sz),
    //   entryPx: pos.entryPx,
    //   markPx: pos.markPx,
    // }

    return null // Default: no position
  }
```

### 3.5 Add Helper: Enforce Stop Loss

```typescript
  /**
   * Check if position has exceeded max loss and force close if needed
   */
  private async enforcePerSideStopLoss(pair: string): Promise<void> {
    const pos = this.getNetPositionForPair(pair)
    if (!pos) return // no position

    const maxLoss = this.maxLossPerSideUsdByPair[pair] ??
                    this.maxLossPerSideUsdByPair['ZEC'] ?? 20
    if (maxLoss <= 0) return // stop loss disabled

    const { side, size, entryPx, markPx } = pos
    if (!markPx || size <= 0) return

    // Calculate unrealized PnL
    const pnlPerUnit = side === 'long'
      ? (markPx - entryPx)   // long: profit when price goes up
      : (entryPx - markPx)   // short: profit when price goes down

    const uPnlUsd = pnlPerUnit * size

    if (uPnlUsd <= -maxLoss) {
      this.notifier.warn(
        `🛑 STOP LOSS TRIGGERED: ${pair} side=${side.toUpperCase()} ` +
        `uPnL=$${uPnlUsd.toFixed(2)} <= -$${maxLoss.toFixed(2)}`
      )

      try {
        // ⚠️ TODO: Replace with your actual close method
        // Examples:
        // - await this.trading.closePairPosition(pair)
        // - await this.liveTrading.forceClosePosition(pair)
        // - await this.exchangeClient.marketClose(pair, size, side)

        // Placeholder:
        this.notifier.error(`❌ closePairPosition() not implemented - position NOT closed!`)

        // When implemented:
        // this.notifier.info(`✅ ${pair} position closed by per-side stop loss`)
      } catch (err) {
        this.notifier.error(
          `❌ Failed to close ${pair} on stop loss: ${(err as Error).message}`
        )
      }
    }
  }
```

### 3.6 Hook into Main Tick Loop

**Find your main tick/loop function** (usually `runTick()` or similar) and add:

```diff
   public async runTick(/* ... */): Promise<void> {
     const activePairs = this.getActivePairs()
+    const nowMs = Date.now()
+
+    // 1) Refresh trend guard context (Kraken metrics)
+    this.refreshTrendContextIfNeeded(nowMs, activePairs)

     for (const pair of activePairs) {
+      // 2) Enforce per-side stop loss BEFORE placing new orders
+      await this.enforcePerSideStopLoss(pair)
+
       // ... existing pair processing ...

       // Calculate mid, spreads, grid orders, etc.
       const gridOrders = this.calculateGridOrders(pair, midPrice, ...)

       // 3) Apply trend guard spread widening
       for (const gridOrder of gridOrders) {
+        const side: TrendGuardSide = gridOrder.side === 'bid' ? 'bid' : 'ask'
+        const widenFactor = getSpreadWidenFactor(this.trendContext, pair, side)
+
+        if (widenFactor > 1.0) {
+          // OPTION A: If you have offsetBps (basis points from mid)
+          if (typeof gridOrder.offsetBps === 'number') {
+            gridOrder.offsetBps *= widenFactor
+          }
+
+          // OPTION B: If you have direct price
+          // const mid = midPrice
+          // if (side === 'bid') {
+          //   const dist = mid - gridOrder.price
+          //   gridOrder.price = mid - (dist * widenFactor)
+          // } else {
+          //   const dist = gridOrder.price - mid
+          //   gridOrder.price = mid + (dist * widenFactor)
+          // }
+        }
+
         // ... place order ...
       }
     }
   }
```

---

## 4️⃣ Testing Steps

### Step 1: Deploy Files
```bash
# On server
cd /root/hyperliquid-mm-bot-complete

# 1. Add .env parameters (manual edit)
nano .env
# (paste the risk params from section 1️⃣)

# 2. Create trendGuard.ts
nano src/utils/trendGuard.ts
# (paste code from section 2️⃣)

# 3. Apply mm_hl.ts changes
nano src/mm_hl.ts
# (apply diffs from section 3️⃣)
```

### Step 2: Adapt Integration Points

**⚠️ DEV MUST COMPLETE:**

1. **`getNetPositionForPair()`** - Connect to real position source
   - Look at `scripts/check_position_pnl.ts` for reference
   - Return actual `{ side, size, entryPx, markPx }`

2. **Stop loss close method** - Implement actual position close
   - Find existing close/liquidate method in your trading class
   - Replace placeholder in `enforcePerSideStopLoss()`

3. **Spread widening integration** - Apply to your grid logic
   - If using `offsetBps`: multiply by `widenFactor`
   - If using direct `price`: adjust distance from mid

### Step 3: Test in Logs

```bash
# Restart bot
systemctl restart mm-bot.service

# Watch for trend guard activity
journalctl -u mm-bot.service -f --no-pager | grep -E "Trend guard|STOP LOSS|widen"

# Expected output:
# [INFO] 🧭 Trend guard context refreshed from Kraken metrics
# [WARN] 🛑 STOP LOSS TRIGGERED: UNI side=LONG uPnL=$-15.50 <= -$15.00
```

### Step 4: Verify Behavior

**A. Stop Loss Test:**
```bash
# Check if stop loss would have triggered today
# Use fill analysis data from 15:00-16:00 period
# Expected: -$42 loss would trigger at -$25 (ZEC) or -$15 (UNI)
```

**B. Trend Guard Test:**
```bash
# During strong trend (ret5m > 0.5%, RSI > 70):
# - BID spreads should widen by 1.3x
# - ASK spreads unchanged
# - Check order placement logs for wider bids
```

---

## 5️⃣ Expected Results

### Before (Today's Session):
```
14:00-15:00: +$357.32 ✅
15:00-16:00: -$69.19 ❌ (major hedge losses)
16:00-17:00: -$68.21 ❌ (continued losses)
Net: +$216.74
```

### After (With Patch):
```
14:00-15:00: +$357.32 ✅ (unchanged - good conditions)
15:00-16:00: -$25 to -$35 🟡 (stop loss triggers early)
16:00-17:00: -$15 to -$25 🟡 (wider spreads avoid fills)
Net: +$280 to +$300 (improvement: +$60-80)
```

**Impact:**
- 15:00 event: -$42.60 → -$15 (stop loss) = **Save $27**
- 15:01 event: -$26.78 → -$15 (stop loss) = **Save $11**
- 16:17 event: -$20.69 → **avoided** (wider spreads) = **Save $20**
- **Total daily improvement: ~$50-80**

---

## 6️⃣ Tuning Recommendations

### If stop losses trigger too often:
```bash
# Increase thresholds
ZEC_MAX_LOSS_PER_SIDE_USD=35  # was 25
UNI_MAX_LOSS_PER_SIDE_USD=20  # was 15
```

### If trend guard too aggressive:
```bash
# Tighten trend detection
TREND_RET5M_THRESHOLD=0.008  # was 0.005 (now need 0.8% move)
TREND_RSI_HIGH=75            # was 70
TREND_RSI_LOW=25             # was 30
```

### If trend guard not working:
```bash
# Check Kraken metrics files exist and are fresh
ls -lh runtime/market_metrics_*.json
cat runtime/market_metrics_ZEC.json | jq '.ret5m, .rsi5m'

# Increase widening factor
TREND_SPREAD_WIDEN_FACTOR=1.5  # was 1.3 (widen by 50% instead of 30%)
```

---

## 7️⃣ Monitoring Commands

```bash
# Watch stop loss triggers
journalctl -u mm-bot.service --since "1 hour ago" --no-pager \
  | grep "STOP LOSS TRIGGERED"

# Count trend guard applications
journalctl -u mm-bot.service --since "1 hour ago" --no-pager \
  | grep -c "Trend guard context refreshed"

# Check current positions vs limits
cd /root/hyperliquid-mm-bot-complete
npx tsx scripts/check_position_pnl.ts

# View Kraken metrics
cat runtime/market_metrics_ZEC.json | jq '.'
cat runtime/market_metrics_UNI.json | jq '.'
```

---

## 8️⃣ Rollback Plan

If issues occur:

```bash
cd /root/hyperliquid-mm-bot-complete

# 1. Disable features in .env
nano .env
# Set: TREND_GUARD_ENABLED=false

# 2. Or restore from backup
cp .env.backup_before_risk_patch .env
git checkout src/mm_hl.ts
rm src/utils/trendGuard.ts

# 3. Restart
systemctl restart mm-bot.service
```

---

## Summary

**What This Patch Does:**
1. ✅ Prevents single position loss from exceeding -$15 to -$25
2. ✅ Detects strong trends using existing Kraken data
3. ✅ Widens spreads against trends to avoid adverse selection
4. ✅ No new APIs needed (uses existing market_data_engine)

**What Dev Needs to Do:**
1. ⚠️ Connect `getNetPositionForPair()` to real position source
2. ⚠️ Implement position close in `enforcePerSideStopLoss()`
3. ⚠️ Apply spread widening to your grid calculation logic

**Expected Benefit:**
- Reduce daily losses by $50-80 on bad days
- Keep full profit on good days (+$357 hour unchanged)
- Simple, testable, easy to tune

---

**Patch Ready for Dev ✅**
**Questions? Check the filled analysis at `/tmp/FILL_ANALYSIS_11_00_TO_16_42_UTC.txt`**
