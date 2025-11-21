# 🔔 MM Bot Monitoring System

Complete monitoring and crash diagnostics system for Hyperliquid MM Bot.

## 📦 Components

### 1. Manual Crash Collection (`collect_crash.sh`)

Manually collect crash data when you notice the bot is dead/hung.

**Usage:**
```bash
cd /root/hyperliquid-mm-bot-complete
./collect_crash.sh "optional description"
```

**Example:**
```bash
./collect_crash.sh "bot stopped submitting after AVAX rotation"
```

**What it does:**
- ✅ Checks process status (alive/dead)
- ✅ Saves last 200 lines of `bot.log` to `crash_YYYYMMDD_HHMMSS.log`
- ✅ Extracts key metrics (last timestamp, seq numbers, errors)
- ✅ Counts open orders
- ✅ Generates automatic diagnosis
- ✅ Appends entry to `crash_timeline.txt`

**Output:**
```
📄 Files created:
   - crash_20251111_121025.log
   - Updated: crash_timeline.txt
```

---

### 2. Automated Health Check (`scripts/check_bot_alive.sh`)

Background health check script that verifies:
- Process exists (`pgrep -f mm_hl.ts`)
- Recent activity (last `quant_evt=submit` within 5 minutes)

**Usage:**
```bash
cd /root/hyperliquid-mm-bot-complete
./scripts/check_bot_alive.sh
```

**Exit codes:**
- `0` = Bot is alive and healthy
- `1` = Bot is dead or hung

**Example output:**
```bash
# Healthy:
OK: Last submit 47 seconds ago (2025-11-11T11:52:13)

# Dead:
DEAD: No mm_hl.ts process found

# Hung:
HUNG: Last submit was 312 seconds ago (max: 300)
      Last submit: 2025-11-11T11:47:00
```

---

### 3. Slack Alerts (`scripts/slack_alert.sh`)

Sends formatted Slack alerts when bot is dead/hung.

**Features:**
- 📨 Rich Slack message with status details
- 🔇 10-minute cooldown between alerts (prevents spam)
- 🔗 Action buttons with SSH commands
- 📊 Includes last activity timestamp

**Requirements:**
```bash
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
```

**Usage:**
```bash
cd /root/hyperliquid-mm-bot-complete
SLACK_WEBHOOK_URL="https://hooks.slack.com/..." ./scripts/slack_alert.sh
```

**Slack message format:**
```
⚠️ MM Bot Alert

Status: HUNG: Last submit was 312 seconds ago (max: 300)
Time: 2025-11-11 11:52:00 UTC

Actions:
• SSH to server: ssh root@207.246.92.212
• Check status: cd /root/hyperliquid-mm-bot-complete && ./collect_crash.sh
• Restart: ./start-bot.sh
```

---

### 4. Automated Monitoring Cron (`setup_monitoring_cron.sh`)

Sets up automated monitoring that runs every 5 minutes.

**Setup:**
```bash
# 1. Set Slack webhook (one-time)
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"

# 2. Run setup script
/tmp/setup_monitoring_cron.sh
```

**What it does:**
- ✅ Creates cron job: `*/5 * * * *` (every 5 minutes)
- ✅ Checks bot health automatically
- ✅ Sends Slack alert if dead/hung
- ✅ Logs to `/var/log/mm_bot_monitor.log`

**Verify cron is running:**
```bash
# Check cron job exists
crontab -l | grep slack_alert

# View monitoring logs
tail -f /var/log/mm_bot_monitor.log
```

**Disable monitoring:**
```bash
crontab -e
# Delete the line containing "slack_alert.sh"
```

---

## 🚀 Quick Start

### Option A: Manual Monitoring Only

Use this if you want to manually check when you suspect issues.

```bash
cd /root/hyperliquid-mm-bot-complete

# When you notice bot is dead/hung:
./collect_crash.sh "bot stopped at 11:52"

# Review crash data:
tail -80 crash_timeline.txt
tail -50 crash_20251111_*.log
```

### Option B: Automated Monitoring with Slack Alerts

Use this for 24/7 monitoring with automatic alerts.

```bash
# 1. Get Slack webhook URL from: https://api.slack.com/messaging/webhooks
#    Example: https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX

# 2. Export webhook URL (add to ~/.bashrc for persistence)
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
echo export SLACK_WEBHOOK_URL=https://hooks.slack.com/... >> ~/.bashrc

# 3. Setup cron monitoring
/tmp/setup_monitoring_cron.sh

# 4. Test alert manually
cd /root/hyperliquid-mm-bot-complete
./scripts/slack_alert.sh

# 5. Monitor logs
tail -f /var/log/mm_bot_monitor.log
```

---

## 📊 Monitoring Logs

**Monitor log location:** `/var/log/mm_bot_monitor.log`

**View real-time:**
```bash
tail -f /var/log/mm_bot_monitor.log
```

**Example healthy log:**
```
2025-11-11 11:50:01 - ✅ Bot is alive - no alert needed
2025-11-11 11:55:01 - ✅ Bot is alive - no alert needed
2025-11-11 12:00:01 - ✅ Bot is alive - no alert needed
```

**Example alert log:**
```
2025-11-11 12:05:01 - ⚠️  HUNG: Last submit was 312 seconds ago
2025-11-11 12:05:01 - ✅ Slack alert sent successfully
2025-11-11 12:10:01 - 🔇 Alert cooldown active (298 / 600 seconds)
```

---

## 🛠️ Troubleshooting

### Slack alerts not working

**Check 1: Webhook URL is set**
```bash
echo $SLACK_WEBHOOK_URL
# Should output: https://hooks.slack.com/services/...
```

**Check 2: Test webhook manually**
```bash
curl -X POST -H "Content-Type: application/json" \
  --data {text:Test alert} \
  "$SLACK_WEBHOOK_URL"
# Should output: ok
```

**Check 3: Check monitoring logs**
```bash
tail -50 /var/log/mm_bot_monitor.log
# Look for errors
```

### Cron job not running

**Check 1: Verify cron job exists**
```bash
crontab -l | grep slack_alert
# Should show: */5 * * * * cd /root/...
```

**Check 2: Check cron service is running**
```bash
systemctl status cron
# or
service cron status
```

**Check 3: Run script manually**
```bash
cd /root/hyperliquid-mm-bot-complete
./scripts/slack_alert.sh
```

### False positive alerts

If you get alerts but bot is actually working:

**Adjust timeout in `scripts/check_bot_alive.sh`:**
```bash
# Edit line 8:
MAX_AGE_SECONDS=300  # Change to 600 (10 minutes) or higher
```

---

## 📝 Files Overview

```
/root/hyperliquid-mm-bot-complete/
├── collect_crash.sh              # Manual crash collection (5.0K)
├── crash_timeline.txt            # Crash history timeline
├── crash_*.log                   # Individual crash snapshots
├── scripts/
│   ├── check_bot_alive.sh        # Health check script (1.4K)
│   └── slack_alert.sh            # Slack alert sender (2.4K)
└── /tmp/
    └── setup_monitoring_cron.sh  # Cron setup script (2.2K)

/var/log/
└── mm_bot_monitor.log            # Monitoring logs
```

---

## 🎯 Best Practices

1. **Check monitoring logs daily:**
   ```bash
   tail -50 /var/log/mm_bot_monitor.log
   ```

2. **Keep last 10 crash logs:**
   ```bash
   cd /root/hyperliquid-mm-bot-complete
   ls -lht crash_*.log | head -10
   # Delete older ones:
   ls -t crash_*.log | tail -n +11 | xargs rm -f
   ```

3. **Review crash timeline weekly:**
   ```bash
   tail -200 crash_timeline.txt
   # Look for patterns (same coins, same times, etc.)
   ```

4. **Test Slack alerts monthly:**
   ```bash
   # Stop bot temporarily
   ./stop-bot.sh
   sleep 360  # Wait 6 minutes
   # Should receive Slack alert
   ./start-bot.sh
   ```

---

## 🔄 Integration with Existing System

This monitoring system works alongside:
- ✅ Global error handlers in `src/mm_hl.ts`
- ✅ Existing crash documentation (`README_DEBUG.md`, `CRASH_TEMPLATE.txt`)
- ✅ Manual debugging tools (`check_positions.ts`, `check-all-orders.ts`)

**Complete debugging workflow:**
```
1. Slack alert received (automated)
   ↓
2. SSH to server
   ↓
3. Run: ./collect_crash.sh "description"
   ↓
4. Review: tail -80 crash_timeline.txt
   ↓
5. Analyze: tail -100 crash_20251111_*.log
   ↓
6. Fix code if pattern found
   ↓
7. Restart: ./start-bot.sh
```

---

## 📞 Support

For issues with monitoring system:
1. Check monitoring logs: `/var/log/mm_bot_monitor.log`
2. Test individual components manually
3. Review crash timeline for patterns

For bot crashes:
1. Use `./collect_crash.sh` to gather data
2. Review `crash_timeline.txt`
3. Check `README_DEBUG.md` for common patterns

