# 📘 INSTITUTIONAL TRADING RUNBOOK - ZEC + UNI

## 🎯 Strategy Overview

**Capital:** $16,000  
**Active Pairs:** ZEC + UNI only  
**Style:** Institutional 2-pair focus with risk limits  
**Auto-Optimizer:** Active (blocks BOME, HMSTR, sub-$12 notional pairs)

---

## 📊 Per-Pair Configuration

### ZEC (Zcash)
```
Clip Size:        $180 USD (~0.35 ZEC @ $500)
Max Clips:        5
Max Exposure:     $900 USD
Daily Loss Limit: -$250 USD
Nansen Bias:      SELL (sell-bias per smart money flow)
```

**Trading Rules:**
- **SELL Bias Active:** Tight ASK (10 bps), Wide BID (50 bps)
- **Anti-Pump:** No new SHORT if 5m move > +2.5% AND position in loss > $180
- **Max Position:** 5 clips × $180 = $900 max exposure
- **Daily Circuit Breaker:** Stop new orders if daily PnL < -$250

---

### UNI (Uniswap)
```
Clip Size:        $120 USD (~15 UNI @ $8)
Max Clips:        5
Max Exposure:     $600 USD
Daily Loss Limit: -$150 USD
Nansen Bias:      NEUTRAL (dynamic based on signals)
```

**Trading Rules:**
- **Bias Dynamic:** Adjusts ASK/BID spread based on Nansen signals
- **Anti-Pump/Dump:** No new orders if 5m move > ±2.5%
- **Max Position:** 5 clips × $120 = $600 max exposure
- **Daily Circuit Breaker:** Stop new orders if daily PnL < -$150

---

## 🛡️ Risk Management

### Anti-Pump Protection
**Trigger:** 5-minute price change > +2.5%  
**Action:**
- Freeze new SELL orders (don't add to losing SHORT)
- Allow existing order management (cancel/replace OK)
- Allow profit-taking on existing positions
- Resume after 15min cooldown OR price stabilizes

### Daily Loss Limits
| Pair | Daily Limit | Action When Hit |
|------|-------------|-----------------|
| ZEC  | -$250 USD   | Freeze new ZEC orders, manage existing only |
| UNI  | -$150 USD   | Freeze new UNI orders, manage existing only |

**Reset:** Midnight UTC (00:00)

---

## 🔧 Operational Commands

### Daily Startup
```bash
cd /root/hyperliquid-mm-bot-complete
npx tsx scripts/check_account.ts
npx tsx scripts/check_position_pnl.ts
systemctl status mm-bot.service
```

### Emergency Stop
```bash
systemctl stop mm-bot.service
npx tsx scripts/cancel_all_orders.ts
```

### Position Monitoring
```bash
# Watch fills live
journalctl -u mm-bot.service -f | grep filled

# Check current positions
npx tsx scripts/check_position_pnl.ts
```

---

**Last Updated:** 2025-11-13 07:40 UTC
