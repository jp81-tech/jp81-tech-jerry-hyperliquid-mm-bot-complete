# Trading Mode Comparison: NORMAL vs BEAR

## Quick Reference

| Feature | NORMAL Mode | BEAR Mode | Reason |
|---------|-------------|-----------|--------|
| **Capital Allocation** |
| TARGET_UTILIZATION | 0.80 (80%) | 0.35 (35%) | Less capital at risk in bear |
| MAX_ALLOC_USD | 1200 | 800 | Smaller position sizes |
| MIN_ALLOC_USD | 100 | 80 | Lower minimum allocation |
| **Risk Management** |
| MAX_DAILY_LOSS_USD | 300 | 300 | Same stop loss |
| Momentum Filter | 25% limit | 15% limit | Tighter parabola protection |
| AUTO_CLOSE_LEGACY | Optional | 1 (forced) | Faster cleanup of old positions |
| **Position Management** |
| Confluence Boost | 2.0x | 1.5x | Less aggressive confluence |
| Legacy Close Threshold | Higher | Lower | Close losers faster |
| **Strategy** |
| Focus | Growth + profit | Capital preservation |
| Bias | Neutral/Long | Defensive |

## Detailed Settings

### NORMAL Mode (.env)


### BEAR Mode (.env.bear)


## When to Switch Modes

### Activate BEAR Mode When:
- BTC drops >10% in 24h
- Market-wide liquidation cascade
- Major macro uncertainty (Fed decisions, war, etc.)
- Daily loss approaching limit (+)
- Multiple tokens in portfolio showing losses
- Low liquidity / widening spreads

### Return to NORMAL Mode When:
- Market stabilizes for 24+ hours
- BTC forms higher lows
- Portfolio back in profit
- Volatility normalizes
- Clear trend emerges (up or sideways)

## Switching Commands



## Expected Performance Difference

### NORMAL Mode
- **PnL Variance**: High (bigger wins, bigger losses)
- **Capital Usage**: 80% (.6k of k)
- **Position Count**: 6-8 tokens
- **Fill Rate**: High (tight spreads, frequent fills)
- **Best For**: Trending markets, bull runs

### BEAR Mode
- **PnL Variance**: Low (smaller wins, limited losses)
- **Capital Usage**: 35% (k of k)
- **Position Count**: 3-5 tokens  
- **Fill Rate**: Lower (wider spreads, selective)
- **Best For**: Bear markets, high volatility, capital preservation

## Monitoring After Switch

After switching modes, monitor for 15-30 minutes:

┌────┬───────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┬──────────┬──────────┬──────────┬──────────┐
│ id │ name      │ namespace   │ version │ mode    │ pid      │ uptime │ ↺    │ status    │ cpu      │ mem      │ user     │ watching │
└────┴───────────┴─────────────┴─────────┴─────────┴──────────┴────────┴──────┴───────────┴──────────┴──────────┴──────────┴──────────┘

## Reverting a Bad Switch

If you switched to wrong mode:



## Advanced: Hybrid Mode

You can manually create a hybrid by editing .env:



Then activate:

