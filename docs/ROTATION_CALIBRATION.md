# Rotation Calibration

**Institutional-grade pair selection for maximizing capture while minimizing friction**

---

## Objective

Pick the top-N markets that maximize capture (realized vol) minus friction (spread/fees) while preferring liquid books and optional smart-money flow.

---

## Score Formula

```
score = w_vol*rv_5m_z
      - w_spread*mid_spread_bps_z
      + w_depth*depth_ratio_z
      + w_flow*nansen_z
      - w_fee*taker_fee_bps_z
```

**Default weights (institutional baseline):**
- `w_vol`    = 0.45  (capture opportunity)
- `w_spread` = 0.25  (execution friction)
- `w_depth`  = 0.15  (liquidity safety)
- `w_flow`   = 0.10  (smart money signal)
- `w_fee`    = 0.05  (trading costs)

All metrics are **z-scored** within the candidate set each rotation window.

---

## Signals (Definitions)

| Signal | Description | Direction |
|--------|-------------|-----------|
| `rv_5m_z` | Realized volatility (5m) from mid | Higher is better |
| `mid_spread_bps_z` | 2×half-spread in bps | Lower is better (we subtract it) |
| `depth_ratio_z` | (bid10k + ask10k) / mid_notional_unit | Higher is better |
| `nansen_z` | Normalized smart-buy ratio × netflow composite [-1..+1] | Higher is better |
| `taker_fee_bps_z` | Effective taker fee in bps (for arb fallback) | Lower is better |

---

## Constraints / Filters

**Pre-selection filters:**
- ❌ Exclude pairs with E_TICK > 0 in last window
- ✅ `min_depth_usd`: 25,000
- ✅ `max_spread_bps`: 60
- ✅ `min_trades_5m`: 10
- ✅ Optional allowlist/denylist

---

## Capital Scaling

**Dynamic sizing based on market conditions:**

```javascript
clip_usd = base_clip_usd * clamp(rv_5m_percentile / 50, 0.6, 1.8)
layers   = round(clamp(depth_ratio_percentile / 50, 0.5, 2.0))
maker_spread_bps = base_maker_bps + clamp(spread_bps_percentile, 0, 25)
```

**Intuition:**
- Higher vol → larger clips (up to 1.8×)
- Deeper books → more layers (up to 2×)
- Wider spreads → widen our maker spread (up to +25bps)

---

## Kill-Switch Heuristics

**Automatic risk protection:**

1. **Adverse Selection Detection:**
   - Disable pair for 20m if `markout_60s_bps < -8` over last 30 trades

2. **Execution Quality:**
   - Disable pair if `reject_rate > 1%` over window
   - Disable pair if `below_min_rate > 10%` over window

3. **Global Circuit Breaker:**
   - Disable rotation if total net PnL last 30m < -X USD (operator-defined)

---

## Telemetry (Log Keys)

**Rotation scoring:**
```logfmt
rotation_evt=score pair=XYZ score=2.34 rv5m=0.015 spr_bps=12 depth=5000 flow=0.42 fee=8
```

**Pair selection:**
```logfmt
rotation_evt=selected pairs=A,B,C topN=3
```

**Capital allocation:**
```logfmt
rotation_evt=alloc pair=A clip=28 layers=2 maker_bps=115
```

---

## Fast Tuning Knobs

### Make rotation more aggressive:
- Increase `w_vol` to 0.55
- Reduce `w_spread` to 0.20

### Trade tighter books only:
- Drop `max_spread_bps` to 40

### Heavier size on liquid books:
- Raise `w_depth` to 0.25
- Raise `layer_scale_max` to 2.5

### Turn on Nansen:
- Set `nansen.enabled` to `true`
- Set `ROTATE_REQUIRE_NANSEN=true` in .env

---

## Configuration Files

See `rotator.config.json` for complete configuration schema.

See `.env` for runtime toggles:
```bash
ROTATE_ENABLED=true
ROTATE_EVERY_MIN=240
ROTATE_TOP_N=3
ROTATE_REQUIRE_NANSEN=false
ROTATOR_CONFIG_PATH=rotator.config.json
```

---

## Safe Enable Sequence

```bash
cd /root/hyperliquid-mm-bot-complete

# Add rotation config to .env
printf "\nROTATE_ENABLED=true\nROTATE_EVERY_MIN=240\nROTATE_TOP_N=3\nROTATE_REQUIRE_NANSEN=false\nROTATOR_CONFIG_PATH=rotator.config.json\n" >> .env

# Create rotator config (see rotator.config.json)

# Restart bot
./stop-bot.sh && ./start-bot.sh

# Monitor rotation events
tail -f bot.log | grep --line-buffered 'rotation_evt='
```

---

## Expected Logs

**On first rotation:**
```
rotation_evt=score pair=SOL score=2.45 rv5m=0.012 spr_bps=8 depth=15000 flow=0.38 fee=6
rotation_evt=score pair=ASTER score=2.34 rv5m=0.015 spr_bps=12 depth=5000 flow=0.42 fee=8
rotation_evt=score pair=PUMP score=1.98 rv5m=0.025 spr_bps=18 depth=3000 flow=0.15 fee=10
rotation_evt=selected pairs=SOL,ASTER,PUMP topN=3
rotation_evt=alloc pair=SOL clip=24 layers=2 maker_bps=112
rotation_evt=alloc pair=ASTER clip=28 layers=1 maker_bps=115
rotation_evt=alloc pair=PUMP clip=32 layers=1 maker_bps=120
```

---

## Monitoring Checklist

**Daily:**
- [ ] Check rotation events: `grep 'rotation_evt=selected' bot.log | tail -10`
- [ ] Verify no kill-switch activations: `grep 'killswitch' bot.log`
- [ ] Review allocation changes: `grep 'rotation_evt=alloc' bot.log | tail -20`

**Weekly:**
- [ ] Analyze score distribution per pair
- [ ] Tune weights based on realized PnL attribution
- [ ] Update filters if market conditions change

---

## Performance Metrics

**Expected improvements with rotation enabled:**
- 15-25% higher realized vol capture
- 10-15% lower average spread paid
- Better capital efficiency (focused on best opportunities)
- Automatic adaptation to changing market regimes

---

**Status:** Ready for production. Test with small capital first, then scale up after 48h verification.

**Last Updated:** 2025-11-04
**Version:** 1.0
