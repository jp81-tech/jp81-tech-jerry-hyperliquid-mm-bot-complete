

# Auto-Bear Quick Reference

Auto-bear automatically switches between NORMAL and BEAR modes based on market conditions.

## Commands

```bash
mm-auto-bear-enable    # Enable (runs every 10 min via cron)
mm-auto-bear-disable   # Disable  
mm-auto-bear-status    # Check status and recent activity
```

## Triggers (2 of 3 needed for bear mode)

1. **Price Drops**: 3+ of top 5 pairs drop >5%
2. **Loss Limit**: Daily PnL >80% of MAX_DAILY_LOSS_USD
3. **Drawdown**: Account down >10% from peak

## Recovery (both needed for normal mode)

1. Daily PnL > -$50
2. 4+ of 5 pairs recover >2%

## Files

- Script: `scripts/auto_bear_monitor.ts`
- State: `runtime/auto_bear_state.json`  
- Log: `runtime/auto_bear.log`

## Not Enabled By Default

Auto-bear is **created but NOT active**. To activate:

```bash
mm-auto-bear-enable
```

See AUTO_BEAR_README.md for full documentation.

