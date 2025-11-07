# Confluence Trading & Legacy Position Management

## Quick Status Check

### 1. Full System Status
```bash
/usr/local/bin/mm-status-all
```

Shows:
- Active pairs (from open orders)
- All positions
- Open orders summary

### 2. Watch Legacy Auto-Close (Live)
```bash
tail -f /root/hyperliquid-mm-bot-complete/runtime/legacy_close.log
```

### 3. Current Confluence Configuration
```bash
cd /root/hyperliquid-mm-bot-complete
grep -E '^(CONFLUENCE|TARGET_UTIL|LEGACY|FUNDING)' .env
```

## Legacy Position Cleanup

### Automatic (Cron - Every 2 Minutes)
Script: `/usr/local/bin/mm-close-legacy-profit`
- Detects positions NOT in active rotation
- Closes them automatically
- Logs to: `runtime/legacy_close.log`

### Manual Cleanup Options

#### A) Cancel Old Orders (Gentle)
```bash
cd /root/hyperliquid-mm-bot-complete
npx tsx scripts/cancel_non_active_orders.ts
```

#### B) Nuke Mode (Aggressive)
```bash
/usr/local/bin/mm-nuke-legacy-now
```

Does:
1. Cancels ALL orders for legacy pairs
2. Attempts to close positions (3× per pair)
3. Verifies cleanup

Repeat 1-2× if first attempt hits liquidity issues.

#### C) Forced Market-Style (Nuclear Option)
```bash
cd /root/hyperliquid-mm-bot-complete

# Cancel orders for specific legacy coins
npx tsx scripts/cancel-open-orders.ts HMSTR kSHIB UMA BOME TURBO || true

# Close each position (multiple attempts)
LEGACY="HMSTR kSHIB UMA BOME TURBO"
for c in $LEGACY; do 
  npx tsx scripts/close-position.ts "$c" || true
  sleep 2
done

# Verify
npx tsx scripts/check_positions.ts | grep -E "HMSTR|kSHIB|UMA|BOME|TURBO" || echo "✅ no legacy"
```

## Confluence Settings

### Current Setup (Safe Baseline)
- **Utilization**: 80% of capital
- **Max Boost**: 1.6x
- **Min Allocation**: $100 per pair
- **Max Allocation**: $1200 per pair
- **Legacy Close**: Enabled, closes after 12min funding against

### Check Which Pairs Are Selected
```bash
cd /root/hyperliquid-mm-bot-complete
pm2 logs hyperliquid-mm --lines 100 --nostream | grep "Using confluence-based pairs" | tail -3
```

### Check Confluence Boosts
```bash
cd /root/hyperliquid-mm-bot-complete
pm2 logs hyperliquid-mm --lines 100 --nostream | grep "confluence boost" | tail -5
```

## Troubleshooting

### IOC Orders Not Filling?
**Symptom**: `close-position.ts` says "Closed" but position remains

**Solution**:
1. Cancel all orders for that coin
2. Wait 2-3 seconds
3. Try closing again (1-2 more attempts)

```bash
cd /root/hyperliquid-mm-bot-complete
npx tsx scripts/cancel-open-orders.ts COIN_NAME
sleep 3
npx tsx scripts/close-position.ts COIN_NAME
```

### Position Partially Closes?
**Normal behavior** - IOC orders fill what's available. Run nuke mode for multiple attempts.

### Funding Burning PnL?
Auto-close triggers after 12 minutes of funding against position (configured in .env: `FUNDING_CLOSE_IF_AGAINST_MIN=12`)

## Git Snapshot

```bash
cd /root/hyperliquid-mm-bot-complete
git add .env /usr/local/bin/mm-* src/ runtime/*.backup || true
git commit -m "Confluence on (80% util, 1.6x boost) + legacy auto-close + nuke helpers" || true
```

## Pro Tips

1. **Confluence Boost**: Pairs with signals from BOTH rotation + copy-trading get higher capital allocation (up to 1.6x-2.0x)

2. **Capital Management**: Bot uses 80% of capital, distributed across 5-6 pairs based on confluence scores

3. **Legacy Detection**: Any position NOT in current open orders = legacy → auto-close attempts every 2 min

4. **Funding Protection**: If funding rate works against your position for >12 min, auto-close triggers regardless of PnL

5. **Case Sensitivity**: Token symbols are case-sensitive (kSHIB ≠ KSHIB) - fixed in codebase

## Files Reference

- **Main Config**: `.env`
- **Legacy Close Script**: `/usr/local/bin/mm-close-legacy-profit`
- **Nuke Script**: `/usr/local/bin/mm-nuke-legacy-now`
- **Status Helper**: `/usr/local/bin/mm-status-all`
- **Legacy Log**: `runtime/legacy_close.log`
- **Cron Config**: Run `crontab -l` to see
