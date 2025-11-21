# Institutional Mode Configuration

## Overview
Bot operates in **Institutional Mode** with hard limits on order sizes and inventory positions per coin.

## Order Size Configuration

### Tier 1: Large, Expensive Coins

| Coin | minUsd | targetUsd | maxUsd | maxUsdAbs | Typical Notional | Max Order Size |
|------|--------|-----------|--------|-----------|------------------|----------------|
| **ZEC** | 12 | 18 | 45 | 900 | 18-45 USD | ~0.07 ZEC (~45 USD) |
| **UNI** | 11 | 16 | 40 | - | 16-40 USD | ~5 UNI (~40 USD) |

### Tier 2: Meme Coins / Smaller

| Coin | minUsd | targetUsd | maxUsd | maxUsdAbs | Typical Notional | Max Order Size |
|------|--------|-----------|--------|-----------|------------------|----------------|
| **VIRTUAL** | 10 | 14 | 30 | - | 14-30 USD | ~26 VIRTUAL (~30 USD) |
| **HMSTR** | 11 | 16 | 40 | - | 16-40 USD | ~34k HMSTR (~40 USD) |
| **BOME** | 11 | 16 | 40 | - | 16-40 USD | ~1.4M BOME (~40 USD) |

## Inventory Limits (Max Position Per Coin)

| Coin | Max Inventory | Max Notional (approx) | Notes |
|------|---------------|----------------------|-------|
| **ZEC** | 4 ZEC | ~2,640 USD | Conservative limit |
| **UNI** | 120 UNI | ~960-1,200 USD | Based on 8-10 USD/UNI |
| **VIRTUAL** | 2,000 VIRTUAL | ~2,000-2,400 USD | Based on 1-1.2 USD/VIRTUAL |
| **HMSTR** | 800,000 HMSTR | ~800-1,200 USD | Based on 0.001-0.0015 USD/HMSTR |
| **BOME** | 250,000 BOME | ~500-750 USD | Based on 0.002-0.003 USD/BOME |

## Normalization Logic

### MIN Clamp
- If `notional < minUsd` → size is increased to meet `minUsd`
- Prevents orders below exchange minimum (e.g., UNI $7 → $11)

### MAX Clamp (Soft)
- If `notional > targetUsd * 2` OR `notional > maxUsd` → size is reduced
- For ZEC: `targetUsd * 2 = 36`, `maxUsd = 45` → typical clamp at 36-45 USD
- Example: 1.00 ZEC @ 660 USD → clamped to ~0.03-0.07 ZEC (18-45 USD)

### ABS Clamp (Hard)
- If `notional > maxUsdAbs` → size is reduced to `maxUsdAbs`
- ZEC only: absolute ceiling of 900 USD (~1.3 ZEC)
- Prevents runaway orders even in extreme scenarios

### Step Rounding
- All sizes are rounded to `coinStep` (lot size)
- Ensures orders match Hyperliquid's lot requirements

## Inventory Guard

### Logic
- Before placing order, checks projected position: `currentPos + delta`
- If `|projectedPos| > MAX_INVENTORY_COINS[coin]` → order is rejected
- Delta: `+sizeCoins` for buy, `-sizeCoins` for sell

### Example
- Current ZEC position: 3.5 ZEC (long)
- Order: BUY 1.0 ZEC
- Projected: 4.5 ZEC
- Result: **BLOCKED** (exceeds max 4 ZEC)

## Log Messages

### `[INSTIT_SIZE]`
- Shows when order size was adjusted
- Reasons: `[SANITY_MIN]`, `[SANITY_MAX]`, `[SANITY_ABS]`, or `OK`

### `[INVENTORY_GUARD]`
- Shows when order was blocked due to inventory limit
- Includes: current position, projected position, max limit

### `🔍 DEBUG submit`
- Final order details before SDK submission
- Shows: pair, size, step, price, notional

## Verification

### Expected Behavior

**VIRTUAL / UNI / HMSTR / BOME:**
- Notional: 10-40 USD per order
- Never below 10 USD (minUsd)
- Never above 40 USD (maxUsd)

**ZEC (when enabled):**
- Notional: 18-45 USD per order (typical)
- Never above 900 USD (maxUsdAbs)
- Max inventory: 4 ZEC total

### Monitoring Commands

```bash
# Watch for size adjustments
journalctl -u mm-bot.service -f | grep '\[INSTIT_SIZE\]'

# Watch for inventory blocks
journalctl -u mm-bot.service -f | grep '\[INVENTORY_GUARD\]'

# Check final order sizes
journalctl -u mm-bot.service -f | grep 'DEBUG submit'
```

## Risk Summary

### Maximum Theoretical Exposure (Full Grid)

Assuming 13 layers per side (L1-L4 active + parking):

| Coin | Max Order | Max Layers | Max Side Exposure | Total Max Exposure |
|------|-----------|------------|-------------------|-------------------|
| **ZEC** | 45 USD | 13 | ~585 USD | ~1,170 USD |
| **UNI** | 40 USD | 13 | ~520 USD | ~1,040 USD |
| **VIRTUAL** | 30 USD | 13 | ~390 USD | ~780 USD |

**Note:** Actual exposure is typically lower due to:
- Grid spacing (not all layers active simultaneously)
- Inventory guard limiting position size
- Market conditions affecting fill rates

### Capital Allocation (12k Total)

Conservative estimate:
- ZEC: ~2,000-2,500 USD (2-3 pairs × ~1,000 USD)
- UNI: ~1,500-2,000 USD
- VIRTUAL: ~1,000-1,500 USD
- HMSTR/BOME: ~1,000-1,500 USD each
- Buffer: ~2,000-3,000 USD

## Configuration Location

All settings are in `src/mm_hl.ts`:

- `INSTITUTIONAL_SIZE_CONFIG` (lines ~64-93)
- `MAX_INVENTORY_COINS` (lines ~99-105)
- `normalizeOrderSizeInstitutional()` function (lines ~523-616)
- `isInventoryAllowed()` function (lines ~629-657)

## Adjusting Limits

To modify limits for a specific coin:

1. Edit `INSTITUTIONAL_SIZE_CONFIG[coin]` for order size limits
2. Edit `MAX_INVENTORY_COINS[coin]` for position limits
3. Restart bot: `systemctl restart mm-bot.service`

**Recommendation:** Test changes on paper trading first, or start with conservative values and increase gradually.

