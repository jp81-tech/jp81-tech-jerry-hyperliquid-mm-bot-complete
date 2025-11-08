# Complete Bot Modes Comparison

## 🎯 Summary: 5 Available Trading Modes

| Mode | Capital | Max/Token | Risk | Best For |
|------|---------|-----------|------|----------|
| **CURRENT** ✅ | 80% (~$13.6k) | $1,200 | Medium | Normal markets + confluence |
| **BEAR** 🐻 | 35% (~$6k) | $800 | Low | Market crashes, preservation |
| **AGGRESSIVE** 🚀 | ~100% | $35k total | High | Bull runs, max turnover |
| **BALANCED** ⚖️ | ~70% | $25k total | Medium | Sideways, steady income |
| **HTM Archive** 📦 | N/A | N/A | N/A | Historical snapshot |

---

## Mode Details

### 1. CURRENT MODE (✅ ACTIVE)

**Status**: Currently running
**Philosophy**: Maximize profit with confluence boost in normal markets

```yaml
Capital Utilization:  80% (~$13.6k of $17k account)
Max Per Token:        $1,200
Base Order:           $200
Spread:               35 bps (0.35%)
Confluence Boost:     2.0x (tokens in both rotation + copy get 2x capital)
Momentum Filter:      25% (block LONGs if price >25% above MA)
Daily Loss Limit:     $300
Active Layers:        3
Pairs:                6 (rotated every 4h)
```

**Features**:
- ✅ Position limit fix applied ($1.2k max or 2x confluence)
- ✅ Auto-close legacy positions
- ✅ Confluence-driven allocation
- ✅ Momentum guard configured (not yet in code)

**Best For**:
- Normal/bull market conditions
- BTC stable or trending up
- Want to use confluence signals

**Command**: Already active

---

### 2. BEAR MODE 🐻 (Ready)

**Status**: Created, not active
**Philosophy**: Preserve capital during market downturns

```yaml
Capital Utilization:  35% (~$6k) ⚠️ 56% LESS than normal
Max Per Token:        $800 ⚠️ $400 smaller positions
Base Order:           $200
Spread:               35 bps
Confluence Boost:     1.5x ⚠️ Less aggressive (was 2.0x)
Momentum Filter:      15% ⚠️ Tighter (was 25%)
Daily Loss Limit:     $300
Bear Mode Flag:       1
```

**Changes vs Current**:
- 🛡️ Uses only 35% of capital (vs 80%)
- 🛡️ Smaller max position ($800 vs $1,200)
- 🛡️ Lower confluence boost (1.5x vs 2.0x)
- 🛡️ Tighter momentum filter (15% vs 25%)
- ⚡ More aggressive legacy cleanup

**Best For**:
- Market crash / liquidation events
- BTC drops >10% in 24h
- Daily loss approaching limit ($240+)
- High volatility / uncertainty

**Commands**:
```bash
# Manual switch
mm-mode-bear

# Auto-switch (enable monitoring)
mm-auto-bear-enable
```

---

### 3. AGGRESSIVE MODE 🚀 (Ready)

**Status**: Created, not active
**Philosophy**: Maximum turnover (700k-1.2M daily target)

```yaml
Base Order:           $350 🔥 75% LARGER
Clip Size:            $100
Max Open Notional:    $35,000
Active Layers:        4 (of 5 total)
Layer Spacing:        15, 25, 40, 60, 85 bps
Spread (Dynamic):     3-12 bps 🔥 MUCH TIGHTER (vs 35 bps)
Quote Chase:          ENABLED (aggressively refill)
Pairs:                8 (vs 6)
Rotation:             Every 2h (vs 4h)
Min 24h Volume:       $400k
```

**Features**:
- 🚀 Multi-layer grid (5 layers, 4 active)
- 🚀 Very tight spreads (3-12 bps)
- 🚀 Quote chasing enabled
- 🚀 More pairs, faster rotation
- 🚀 Dynamic spread adjustment

**Risks**:
- ⚠️ Much higher capital exposure
- ⚠️ More fills = more fees
- ⚠️ Requires high liquidity

**Best For**:
- Strong bull run
- High-volume altseason
- Account >$25k
- Want to maximize turnover

**Command**:
```bash
cp .env.aggressive .env
pm2 restart hyperliquid-mm --update-env
```

---

### 4. BALANCED MODE ⚖️ (Ready)

**Status**: Created, not active
**Philosophy**: Moderate risk/reward (300-500k daily target)

```yaml
Base Order:           $300 ⚖️ Middle ground
Clip Size:            $90
Max Open Notional:    $25,000
Active Layers:        4 (of 5 total)
Layer Spacing:        25, 40, 60, 85, 115 bps
Spread (Dynamic):     4-15 bps
Quote Chase:          DISABLED (patient fills)
Pairs:                6
Rotation:             Every 3h
Min 24h Volume:       $500k (higher than aggressive)
```

**Features**:
- ⚖️ Moderate order sizes
- ⚖️ Wider spreads than aggressive
- ⚖️ No quote chasing
- ⚖️ Fewer rotations
- ⚖️ Higher volume requirement

**Best For**:
- Sideways/choppy markets
- Want steady income
- Account $15-25k
- Don't want aggressive fills

**Command**:
```bash
cp .env.balanced .env
pm2 restart hyperliquid-mm --update-env
```

---

## 📊 Side-by-Side Comparison

| Feature | Current | Bear 🛡️ | Aggressive 🚀 | Balanced ⚖️ |
|---------|---------|----------|---------------|-------------|
| **Capital Usage** | 80% | 35% | ~100% | ~70% |
| **Order Size** | $200 | $200 | $350 | $300 |
| **Max/Token** | $1,200 | $800 | $35k total | $25k total |
| **Spread** | 35 bps | 35 bps | 3-12 bps | 4-15 bps |
| **Layers** | 3 | 3 | 4 active | 4 active |
| **Confluence** | 2.0x | 1.5x | N/A | N/A |
| **Momentum Filter** | 25% | 15% | N/A | N/A |
| **Pairs** | 6 | 4-6 | 8 | 6 |
| **Rotation** | 4h | 4h | 2h | 3h |
| **Quote Chase** | No | No | Yes | No |
| **Philosophy** | Profit | Preserve | Maximize | Steady |
| **Risk Level** | Medium | Low | High | Medium |

---

## 🔄 Switching Modes

### Manual Switching

```bash
# To Bear (defensive)
mm-mode-bear

# Back to Normal
mm-mode-normal

# To Aggressive (high turnover)
cp .env.aggressive .env
pm2 restart hyperliquid-mm --update-env

# To Balanced (moderate)
cp .env.balanced .env
pm2 restart hyperliquid-mm --update-env
```

### Automatic Bear Mode

```bash
# Enable auto-switching (monitors market every 10 min)
mm-auto-bear-enable

# Check if active
mm-auto-bear-status

# Disable
mm-auto-bear-disable
```

Auto-bear triggers when **2 of 3** conditions met:
1. 3+ of top 5 pairs drop >5%
2. Daily PnL >80% of loss limit
3. Account down >10% from peak

---

## 🎯 Decision Guide

### Use CURRENT if:
- ✅ Normal market (BTC not crashing)
- ✅ Want confluence allocation
- ✅ Moderate risk OK
- ✅ Account $12-20k

### Use BEAR if:
- ⚠️ Market crashing
- ⚠️ High volatility
- ⚠️ Daily loss approaching $240+
- ⚠️ Want capital preservation

### Use AGGRESSIVE if:
- 🚀 Strong bull run
- 🚀 High alt volume
- 🚀 Want max turnover
- 🚀 Account >$25k
- 🚀 High risk tolerance

### Use BALANCED if:
- ⚖️ Sideways market
- ⚖️ Want steady income
- ⚖️ Moderate risk
- ⚖️ Account $15-25k

---

## 🛡️ Safety Checklist

Before switching modes:

1. **Backup current config**
   ```bash
   cp .env .env.backup_$(date +%F_%H-%M)
   ```

2. **Switch mode**
   ```bash
   mm-mode-bear  # or other mode
   ```

3. **Verify restart**
   ```bash
   pm2 status
   ```

4. **Check logs**
   ```bash
   pm2 logs hyperliquid-mm --lines 50
   ```

5. **Monitor positions**
   ```bash
   mm-status-positions
   ```

6. **Watch for 15-30 min**
   ```bash
   tail -f /root/.pm2/logs/mm-bot-out.log
   ```

---

## 📁 Files Location

All mode files in: `/root/hyperliquid-mm-bot-complete/`

```
.env                  - Current active config
.env.bear             - Bear mode preset
.env.aggressive       - Aggressive preset
.env.balanced         - Balanced preset
.env.htm_*            - Historical archive
.env.backup_*         - Auto backups
```

---

## 🔧 Management Tools

```bash
# Mode switching
mm-mode-bear          # Switch to bear (defensive)
mm-mode-normal        # Return to normal

# Auto-bear
mm-auto-bear-enable   # Enable auto-switching
mm-auto-bear-disable  # Disable auto-switching
mm-auto-bear-status   # Check auto status

# Monitoring
mm-status-positions   # Position distribution %
pm2 status            # Bot status
pm2 logs hyperliquid-mm --lines 100  # View logs
```

---

## 📈 Current Setup

**Active Mode**: CURRENT (normal + confluence)
**Account Value**: ~$17,000
**Capital in Use**: ~$15,000 (88%)
**Leverage**: 0.9x (safe)
**Active Positions**: 8

**Available Modes**: 4 ready to activate
**Auto-Bear**: Disabled (can enable anytime)
**Position Limits**: Fixed and working
**Confluence**: Active with 2.0x boost
