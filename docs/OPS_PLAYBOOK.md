# 🛠 Operations Playbook

**Quick reference for day-2 operations, monitoring, and troubleshooting**

---

## 🔒 Initial Hardening

### Lock .env and Create Backup

```bash
cd /root/hyperliquid-mm-bot-complete
cp .env .env.backup.$(date +%F_%H%M)
chmod 600 .env
```

### Pin Node Dependencies

```bash
npm ci
```

### Verify Core Configuration

```bash
# Check overrides
grep 'SPEC_OVERRIDE' .env

# Check recent quantization
tail -200 bot.log | grep 'quant_evt=attempt' | tail -10

# Count E_TICK errors (expect 0)
tail -1000 bot.log | grep 'err_code=E_TICK' | wc -l

# Check SOL behavior
tail -200 bot.log | grep 'pair=SOL' | egrep 'below_min|attempt' | tail -10
```

---

## 📊 Daily Monitoring

### Setup 24h Report Cron

**Run daily at 08:35 Zurich time:**

```bash
mkdir -p /root/hyperliquid-mm-bot-complete/reports

crontab -l > /tmp/crontab.tmp 2>/dev/null || true
echo "35 8 * * * cd /root/hyperliquid-mm-bot-complete && LOKI_URL=http://localhost:3100 scripts/report-24h.sh > reports/last-24h.txt 2>&1" >> /tmp/crontab.tmp
crontab /tmp/crontab.tmp
```

**Manual run anytime:**

```bash
cd /root/hyperliquid-mm-bot-complete
export LOKI_URL="http://localhost:3100"
bash scripts/report-24h.sh
```

**Check last report:**

```bash
cat /root/hyperliquid-mm-bot-complete/reports/last-24h.txt
```

### Daily Health Checks

```bash
# 1. E_TICK count (expect 0)
grep -c "err_code=E_TICK" /root/hyperliquid-mm-bot-complete/bot.log

# 2. Spec override active
tail -100 /root/hyperliquid-mm-bot-complete/bot.log | grep SPEC_OVERRIDE | head -3

# 3. Recent quantization
tail -50 /root/hyperliquid-mm-bot-complete/bot.log | grep quant_evt=attempt | tail -10

# 4. Bot uptime
ps aux | grep "node.*mm_hl" | grep -v grep
```

---

## 🔄 Rotation Management

### Enable Rotation

```bash
cd /root/hyperliquid-mm-bot-complete

printf "\nROTATE_ENABLED=true\nROTATE_EVERY_MIN=240\nROTATE_TOP_N=3\nROTATE_REQUIRE_NANSEN=false\n" >> .env

./stop-bot.sh
./start-bot.sh

# Monitor rotation events
tail -f bot.log | grep rotation_evt
```

### Disable Rotation (Rollback)

```bash
cd /root/hyperliquid-mm-bot-complete

sed -i 's/^ROTATE_ENABLED=true/ROTATE_ENABLED=false/' .env

./stop-bot.sh
./start-bot.sh
```

### Check Rotation Status

```bash
# Verify rotation is enabled
grep ROTATE_ENABLED /root/hyperliquid-mm-bot-complete/.env

# Check recent rotation events
tail -100 /root/hyperliquid-mm-bot-complete/bot.log | grep rotation_evt

# Check pair scores
tail -100 /root/hyperliquid-mm-bot-complete/bot.log | grep "rotation_evt=score"
```

---

## 🛡 Retry Guard

### Check Retry Guard Status

```bash
# Verify retry guard is enabled
grep RETRY_GUARD /root/hyperliquid-mm-bot-complete/.env

# Check for retry activity (only appears if E_TICK occurs)
grep -i 'retry_guard\|spec refresh' /root/hyperliquid-mm-bot-complete/bot.log | tail -10
```

### Verify Spec Cache

```bash
# Check for spec refresh logs
grep 'spec refresh\|SPEC_OVERRIDE applied' /root/hyperliquid-mm-bot-complete/bot.log | tail -20
```

---

## ⚠️ Alert Management

### Deploy E_TICK Alert to Grafana

**If Grafana is on this server:**

```bash
sudo cp /root/hyperliquid-mm-bot-complete/config/grafana-provisioning/alerting/mm-bot-etick.yaml \
  /etc/grafana/provisioning/alerting/

sudo systemctl reload grafana-server
```

### Verify Alert is Active

```bash
# Check Grafana alert rules
curl -s http://localhost:3000/api/ruler/grafana/api/v1/rules | jq '.[] | keys'

# Or via Grafana UI:
# http://your-server:3000/alerting/list
```

---

## 🔧 SOL Notional Calibration

### Current Behavior

SOL orders with notional ~$16 are filtered because exchange minimum is ~$20.

### Option 1: Set Per-Pair Minimum

```bash
cd /root/hyperliquid-mm-bot-complete

printf "\nPAIR_MIN_NOTIONAL_USD_SOL=20\n" >> .env

./stop-bot.sh
./start-bot.sh
```

### Option 2: Increase Global Minimum

```bash
cd /root/hyperliquid-mm-bot-complete

sed -i 's/^MIN_NOTIONAL_USD=.*/MIN_NOTIONAL_USD=20/' .env

./stop-bot.sh
./start-bot.sh
```

### Option 3: Increase BASE_ORDER_USD

```bash
cd /root/hyperliquid-mm-bot-complete

sed -i 's/^BASE_ORDER_USD=.*/BASE_ORDER_USD=100/' .env

./stop-bot.sh
./start-bot.sh
```

### Verify SOL Orders

```bash
# Check if SOL orders are now submitting
tail -100 /root/hyperliquid-mm-bot-complete/bot.log | grep 'pair=SOL' | grep 'quant_evt=submit'

# Check for below_min (should stop appearing)
tail -100 /root/hyperliquid-mm-bot-complete/bot.log | grep 'pair=SOL.*below_min'
```

---

## 📈 Performance Monitoring

### Check Order Success Rate

```bash
# Overall success rate
grep 'quant_evt=submit' /root/hyperliquid-mm-bot-complete/bot.log | \
  awk '{total++; if($0 ~ /ok=1/) success++} END {print "Success: " success "/" total " (" (success/total*100) "%)"}'

# Per-pair success rate
grep 'quant_evt=submit' /root/hyperliquid-mm-bot-complete/bot.log | \
  awk -F'pair=' '{if(NF>1) print $2}' | awk '{print $1}' | sort | uniq -c
```

### Check Quantization Health

```bash
# Count attempts vs submits
echo "Attempts: $(grep -c 'quant_evt=attempt' bot.log)"
echo "Submits:  $(grep -c 'quant_evt=submit' bot.log)"
echo "Below min: $(grep -c 'quant_evt=below_min' bot.log)"

# Check for any errors
grep 'err_code=' /root/hyperliquid-mm-bot-complete/bot.log | tail -20
```

### Monitor Bot Health

```bash
# Check process
ps aux | grep "node.*mm_hl" | grep -v grep

# Check memory usage
ps aux | grep "node.*mm_hl" | grep -v grep | awk '{print "Memory: " $6/1024 " MB"}'

# Check disk usage
du -sh /root/hyperliquid-mm-bot-complete/bot.log*
```

---

## 🔄 Rollback Procedures

### Rollback: Disable SOL Override

```bash
cd /root/hyperliquid-mm-bot-complete

sed -i 's/^SPEC_OVERRIDE_SOL_TICK=.*/# SPEC_OVERRIDE_SOL_TICK=0.01/' .env
sed -i 's/^SPEC_OVERRIDE_SOL_LOT=.*/# SPEC_OVERRIDE_SOL_LOT=0.1/' .env

./stop-bot.sh
./start-bot.sh

# Verify SOL now uses default spec
tail -100 bot.log | grep 'pair=SOL' | head -5
```

### Rollback: Disable Rotation

```bash
cd /root/hyperliquid-mm-bot-complete

sed -i 's/^ROTATE_ENABLED=true/ROTATE_ENABLED=false/' .env

./stop-bot.sh
./start-bot.sh
```

### Rollback: Restore .env Backup

```bash
cd /root/hyperliquid-mm-bot-complete

# List available backups
ls -la .env.backup.*

# Restore specific backup
cp .env.backup.2025-11-04_0630 .env

./stop-bot.sh
./start-bot.sh
```

### Emergency: Revert to Last Known Good Config

```bash
cd /root/hyperliquid-mm-bot-complete

# If you have git tracking
git checkout .env
git checkout src/mm_hl.ts

# Or restore from backup
cp .env.backup.$(ls -t .env.backup.* | head -1) .env

./stop-bot.sh
./start-bot.sh
```

---

## 🔍 Troubleshooting

### Issue: E_TICK Errors Reappearing

**Diagnose:**
```bash
# Count recent E_TICK errors
tail -1000 bot.log | grep 'err_code=E_TICK' | wc -l

# Which pairs?
tail -1000 bot.log | grep 'err_code=E_TICK' | grep -o 'pair=[A-Z]*' | sort | uniq -c

# Check if override is active
tail -100 bot.log | grep SPEC_OVERRIDE
```

**Fix:**
```bash
# Verify override in .env
grep SPEC_OVERRIDE .env

# Restart bot to reapply overrides
./stop-bot.sh && ./start-bot.sh

# If still failing, add/update override
printf "\nSPEC_OVERRIDE_PAIRNAME_TICK=0.01\nSPEC_OVERRIDE_PAIRNAME_LOT=0.1\n" >> .env
./stop-bot.sh && ./start-bot.sh
```

### Issue: Bot Not Starting

**Diagnose:**
```bash
# Check for running process
ps aux | grep "node.*mm_hl" | grep -v grep

# Check recent logs
tail -50 bot.log

# Check for syntax errors
npx tsx --check src/mm_hl.ts
```

**Fix:**
```bash
# Kill any stale processes
pkill -f "node.*mm_hl"

# Restart fresh
./start-bot.sh

# Check logs
tail -f bot.log
```

### Issue: High Memory Usage

**Diagnose:**
```bash
# Check memory
ps aux | grep "node.*mm_hl" | grep -v grep | awk '{print "Memory: " $6/1024 " MB"}'

# Check log size
ls -lh bot.log*
```

**Fix:**
```bash
# Rotate logs manually
./stop-bot.sh
gzip bot.log
mv bot.log.gz bot.log.$(date +%F_%H%M).gz
./start-bot.sh

# Or setup logrotate (already configured)
sudo logrotate -f /etc/logrotate.d/mm-bot
```

### Issue: Rotation Not Working

**Diagnose:**
```bash
# Check if enabled
grep ROTATE_ENABLED .env

# Check for rotation logs
tail -100 bot.log | grep rotation_evt

# Check for errors
tail -100 bot.log | grep -i error | grep -i rotat
```

**Fix:**
```bash
# Verify rotation modules exist
ls -la src/selection/rotator.ts
ls -la src/signals/nansen_adapter.ts

# Re-enable rotation
sed -i 's/^ROTATE_ENABLED=.*/ROTATE_ENABLED=true/' .env
./stop-bot.sh && ./start-bot.sh
```

---

## 📞 Quick Reference Commands

### Start/Stop/Restart

```bash
cd /root/hyperliquid-mm-bot-complete

./start-bot.sh          # Start bot
./stop-bot.sh           # Stop bot
./stop-bot.sh && ./start-bot.sh  # Restart bot
```

### Check Status

```bash
# Bot running?
ps aux | grep "node.*mm_hl" | grep -v grep

# Recent activity
tail -20 /root/hyperliquid-mm-bot-complete/bot.log

# Live monitoring
tail -f /root/hyperliquid-mm-bot-complete/bot.log
```

### Check Configuration

```bash
# View .env
cat /root/hyperliquid-mm-bot-complete/.env

# Check overrides
grep SPEC_OVERRIDE /root/hyperliquid-mm-bot-complete/.env

# Check rotation config
grep ROTATE /root/hyperliquid-mm-bot-complete/.env
```

### Quick Health Check

```bash
cd /root/hyperliquid-mm-bot-complete

echo "=== E_TICK Errors ==="
tail -1000 bot.log | grep -c 'err_code=E_TICK'

echo "=== Spec Overrides ==="
tail -100 bot.log | grep SPEC_OVERRIDE | head -3

echo "=== Recent Quantization ==="
tail -50 bot.log | grep quant_evt=attempt | tail -5

echo "=== Bot Process ==="
ps aux | grep "node.*mm_hl" | grep -v grep
```

---

## 📋 Daily Checklist

**Morning (08:30 - 09:00):**
- [ ] Check 24h report: `cat reports/last-24h.txt`
- [ ] Verify E_TICK count is 0
- [ ] Check bot is running: `ps aux | grep mm_hl`
- [ ] Review recent logs: `tail -50 bot.log`

**Mid-day (12:00 - 13:00):**
- [ ] Check order success rate
- [ ] Verify rotation (if enabled): `tail -100 bot.log | grep rotation_evt`
- [ ] Monitor memory usage

**Evening (18:00 - 19:00):**
- [ ] Review full day's activity
- [ ] Check for any anomalies
- [ ] Verify log rotation working

**Weekly:**
- [ ] Review and archive old logs
- [ ] Check disk usage
- [ ] Update .env backup: `cp .env .env.backup.$(date +%F)`
- [ ] Review alert history (if Grafana deployed)

---

## 🎓 Common Operations

### Add New Spec Override

```bash
cd /root/hyperliquid-mm-bot-complete

# Add override
printf "\nSPEC_OVERRIDE_NEWPAIR_TICK=0.0001\nSPEC_OVERRIDE_NEWPAIR_LOT=1\n" >> .env

# Restart
./stop-bot.sh && ./start-bot.sh

# Verify
tail -100 bot.log | grep "SPEC_OVERRIDE applied for NEWPAIR"
```

### Remove Spec Override

```bash
cd /root/hyperliquid-mm-bot-complete

# Comment out override
sed -i 's/^SPEC_OVERRIDE_SOL_TICK=/# SPEC_OVERRIDE_SOL_TICK=/' .env
sed -i 's/^SPEC_OVERRIDE_SOL_LOT=/# SPEC_OVERRIDE_SOL_LOT=/' .env

# Restart
./stop-bot.sh && ./start-bot.sh
```

### Update Rotation Parameters

```bash
cd /root/hyperliquid-mm-bot-complete

# Update rotation interval (4h → 6h)
sed -i 's/^ROTATE_EVERY_MIN=.*/ROTATE_EVERY_MIN=360/' .env

# Update top N (3 → 5 pairs)
sed -i 's/^ROTATE_TOP_N=.*/ROTATE_TOP_N=5/' .env

# Restart
./stop-bot.sh && ./start-bot.sh
```

### Enable Nansen Integration

```bash
cd /root/hyperliquid-mm-bot-complete

# Enable Nansen
printf "\nROTATE_REQUIRE_NANSEN=true\nROTATE_W_NANSEN=0.5\n" >> .env

# Setup Nansen feed (your implementation)
# globalThis.__nansen = { ... }

# Restart
./stop-bot.sh && ./start-bot.sh
```

---

## 📚 Documentation Quick Links

- **V3 Handoff:** `docs/V3_HANDOFF.md`
- **Rotation System:** `docs/ROTATION_SYSTEM.md`
- **Quantization V2:** `docs/QUANTIZATION_V2_DEPLOYMENT.md`
- **Complete Stack:** `docs/COMPLETE_STACK_V3.md`
- **Operations:** `docs/OPS_PLAYBOOK.md` (this file)

---

## 🆘 Emergency Contacts

**Critical Issues:**
- E_TICK errors > 5% over 10 minutes
- Bot crash/restart loop
- Memory leak (>1GB)
- Disk full

**Response:**
1. Stop bot: `./stop-bot.sh`
2. Check logs: `tail -100 bot.log`
3. Restore backup: `cp .env.backup.* .env`
4. Restart: `./start-bot.sh`
5. Monitor: `tail -f bot.log`

---

**Last Updated:** 2025-11-04
**Version:** 3.0
