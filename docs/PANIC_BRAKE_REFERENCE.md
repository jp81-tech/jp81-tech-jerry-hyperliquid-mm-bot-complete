# 🛡️ Panic Brake & Watchdog Reference

**Last Updated:** 2025-11-04 16:35 UTC
**Status:** Production-ready, maximum hardening deployed

---

## Quick Status Check

```bash
# One-liner health check
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete
echo "Rotation: $(jq -r ".pairs | join(\", \")" runtime/active_pairs.json)"
echo "Bot PID: $(pgrep -af "node.*mm_hl.ts" | head -1 | awk "{print \$1}")"
echo "E_TICK: $(tail -1000 bot.log | grep -c "err_code=E_TICK")"
echo "Panic: $(systemctl is-active mm-panic-watchdog)"
tail -10 runtime/watchdog.log
'
```

---

## Protection Architecture

### 8-Layer Defense System

```
Layer 1: Strict Mode           → ROTATION_STRICT_ONLY=true
Layer 2: Bot Denylist          → ACTIVE_PAIRS_DENYLIST=XPL,ASTER
Layer 3: Bot Allowlist         → ACTIVE_PAIRS_ALLOWLIST=FARTCOIN,HYPE,ZEC,ZK
Layer 4: Daemon Denylist       → rotator.config.json
Layer 5: Daemon Allowlist      → rotator.config.json
Layer 6: Alert Watchdog        → Cron (every 2min)
Layer 7: PANIC BRAKE (dual)    → Cron (2min) + Systemd (60s)
Layer 8: Cancel Sweep          → Cron (every 3min)
```

### Dual Panic Brake

**Cron-based Panic Brake:**
- Runs every 2 minutes via crontab
- Script: `scripts/watchdog_panic.sh`
- Logs to: `runtime/watchdog.log`

**Systemd-based Panic Brake:**
- Runs every 60 seconds as independent service
- Service: `mm-panic-watchdog.service`
- Auto-restart on failure

**How it works:**
1. Reads `ACTIVE_PAIRS_DENYLIST` from .env (XPL,ASTER)
2. Checks positions via `check-positions.ts`
3. If deny pair detected → runs `./stop-bot.sh` immediately
4. Logs alert with timestamp to `runtime/watchdog.log`

---

## Daily Operations

### Morning Health Check (24h Watch)

```bash
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212 '
cd /root/hyperliquid-mm-bot-complete

# Active pairs
jq -r ".pairs[]" runtime/active_pairs.json

# Configuration
grep -E "^ROTATION_STRICT_ONLY=|^ACTIVE_PAIRS_DENYLIST=|^ACTIVE_PAIRS_ALLOWLIST=" .env

# Bot status
pgrep -af "node.*mm_hl.ts"

# Recent trading + errors
tail -200 bot.log | grep -E "rotation_evt=apply|quant_evt=submit|order_evt=submit" | tail -40
tail -1000 bot.log | grep -c "err_code=E_TICK"

# Watchdog status
tail -60 runtime/watchdog.log
systemctl status mm-panic-watchdog --no-pager
'
```

### Expected Output

```
Active Pairs: HYPE, ZK, ZEC, FARTCOIN
Strict Mode: true
Denylist: XPL,ASTER
Bot PID: 309230
E_TICK count: 0
Panic watchdog: active (running)
```

---

## If Panic Brake Triggers

### What Happens

```
1. Deny position detected (XPL or ASTER)
2. Watchdog logs: "PANIC: Denylisted position open: XPL"
3. Bot stops immediately (./stop-bot.sh)
4. Alert timestamp in runtime/watchdog.log
5. No further trading until restart
```

### Recovery Steps

```bash
# 1. SSH to server
ssh -i ~/.ssh/id_ed25519 root@207.246.92.212
cd /root/hyperliquid-mm-bot-complete

# 2. Check watchdog log
tail -50 runtime/watchdog.log | grep PANIC

# 3. Close deny position manually in Hyperliquid UI
#    - Go to Hyperliquid UI → Positions
#    - Find XPL or ASTER position
#    - Close with Reduce-Only = YES

# 4. Verify position closed
source .env
PRIVATE_KEY="$PRIVATE_KEY" npx tsx check-positions.ts 2>&1 | grep -i "xpl\|aster"

# 5. Restart bot
./start-bot.sh

# 6. Verify restart
tail -f bot.log | grep -m 5 "rotation_evt="
```

---

## Watchdog Management

### Check Systemd Panic Watchdog

```bash
# Status
systemctl status mm-panic-watchdog

# Logs
journalctl -u mm-panic-watchdog -n 50

# Restart
systemctl restart mm-panic-watchdog

# Stop/Start
systemctl stop mm-panic-watchdog
systemctl start mm-panic-watchdog
```

### Check Cron Watchdogs

```bash
# View cron schedule
crontab -l | grep watchdog

# View watchdog log
tail -100 runtime/watchdog.log

# Test panic brake manually
cd /root/hyperliquid-mm-bot-complete
bash scripts/watchdog_panic.sh
```

---

## Finding External XPL Source

### Off-Server Investigation

1. **Check Hyperliquid UI Trade History**
   - Open https://app.hyperliquid.xyz
   - Go to Trade History
   - Filter: XPL, last 48 hours
   - Look for source (desktop, mobile, API)

2. **Revoke External Access**
   - Revoke all WalletConnect sessions
   - Remove Hyperliquid from MetaMask "Connected Sites"
   - Log out Hyperliquid on all devices/browsers

3. **Verify PRIVATE_KEY Isolation**
   - Ensure PRIVATE_KEY only used by bot
   - Check for other scripts/services using same key
   - Consider wallet rotation if issue persists

### On-Server Forensics (Already Done ✅)

```bash
# Bot has ZERO XPL/ASTER trading activity confirmed
# Source is 100% external (mobile app, web UI, or another script)
```

---

## Configuration Reference

### Current Sizing ($18k equity)

```bash
BASE_ORDER_USD=130
CLIP_USD=36
MAX_POSITION_USD=700
```

### Protection Settings

```bash
ROTATION_STRICT_ONLY=true
ACTIVE_PAIRS_DENYLIST=XPL,ASTER
ACTIVE_PAIRS_ALLOWLIST=FARTCOIN,HYPE,ZEC,ZK
```

### File Locations

```
Bot log:            bot.log
Watchdog log:       runtime/watchdog.log
Active pairs:       runtime/active_pairs.json
Panic brake:        scripts/watchdog_panic.sh
Alert watchdog:     scripts/watchdog_deny_positions.sh
Cancel sweep:       scripts/cancel_deny_orders.sh
Systemd service:    /etc/systemd/system/mm-panic-watchdog.service
```

---

## Sizing Formula (For Future Updates)

```bash
# When equity changes:
EQUITY_USD=18000
PAIRS=4  # Number of active pairs

# Calculate new sizing
BASE=$(python3 -c "print(round($EQUITY_USD * 0.0075 * 4 / $PAIRS))")
CLIP=$(python3 -c "print(round($BASE * 0.28))")
MAXPOS=$(python3 -c "print(round($BASE * 5.0))")

echo "BASE_ORDER_USD=$BASE"
echo "CLIP_USD=$CLIP"
echo "MAX_POSITION_USD=$MAXPOS"

# Apply to .env
cp .env .env.backup.$(date +%Y%m%d_%H%M)
sed -i "s/^BASE_ORDER_USD=.*/BASE_ORDER_USD=${BASE}/" .env
sed -i "s/^CLIP_USD=.*/CLIP_USD=${CLIP}/" .env
sed -i "s/^MAX_POSITION_USD=.*/MAX_POSITION_USD=${MAXPOS}/" .env

# Restart bot
./stop-bot.sh && ./start-bot.sh
```

---

## Emergency Contacts

**If panic brake triggers:**
1. Check `runtime/watchdog.log` for alert timestamp
2. Close deny position in Hyperliquid UI
3. Verify position closed with `check-positions.ts`
4. Restart bot with `./start-bot.sh`

**If external XPL source persists:**
1. Complete off-server investigation (above)
2. Consider implementing fully-signed auto-closer
3. Consider wallet rotation as last resort

---

## Optional Upgrades

### Fully-Signed Auto-Closer

**What it does:**
- Automatically closes deny positions (not just stops bot)
- Uses bot's existing signer
- Submits reduce-only market orders
- Closes position within ~60 seconds

**When to use:**
- If manual closing is too slow
- If deny positions reappear frequently
- For maximum automation

**Ready to implement on request.**

### Wallet Rotation

**What it does:**
- Generate new wallet address
- Move funds to new wallet
- Update .env with new PRIVATE_KEY
- Restart bot with new wallet

**When to use:**
- If external source cannot be identified
- If PRIVATE_KEY may be compromised
- As last resort protection

**Playbook available on request.**

---

## Success Criteria

```
✅ Bot running (PID visible)
✅ Active pairs = HYPE, ZK, ZEC, FARTCOIN (rotation file)
✅ E_TICK errors = 0
✅ Daily PnL = Positive
✅ Rotation events = apply (not skip)
✅ Panic watchdog = active
✅ Rotation daemon = active
✅ No XPL/ASTER positions
✅ Watchdog log = No PANIC alerts
```

---

**Status:** Bulletproof ✅
**Protection:** Maximum 🛡️
**Monitoring:** Dual (Cron + Systemd)
**Ready:** Production 🚀

**Last Verified:** 2025-11-04 16:35 UTC
