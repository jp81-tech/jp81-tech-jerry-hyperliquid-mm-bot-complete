# Watchdog & Backup System

## Installed Components

### 1. Nightly ENV Backup
**Script:** `/root/hyperliquid-mm-bot-complete/scripts/nightly_env_backup.sh`
**Cron:** Daily at 23:00 UTC
**Location:** `/etc/cron.d/env_nightly_backup`
**Log:** `/var/log/env_backup.log`

**Features:**
- Creates timestamped `.env` backups
- Maintains symlink to latest backup
- Auto-cleanup: removes backups older than 14 days
- Keeps max 30 backups
- Sends Discord/Slack alert on completion

**Backups stored in:** `/root/hyperliquid-mm-bot-complete/backups/env/`

### 2. Watchdog Auto-Restore
**Script:** `/root/hyperliquid-mm-bot-complete/scripts/watchdog_restore.sh`
**Cron:** Every 5 minutes
**Location:** `/etc/cron.d/mm_watchdog`
**Log:** `/var/log/watchdog.log`

**Trigger:** ≥3 restarts within 1 hour

**Actions when triggered:**
1. Restores latest `.env` backup
2. Copies to `src/.env`
3. Sends alert with reason
4. Restarts PM2 with `--update-env`
5. Resets watchdog baseline

### 3. Manual Panic Restore
**Script:** `/root/hyperliquid-mm-bot-complete/scripts/watchdog_manual.sh`

**Usage:**
```bash
/root/hyperliquid-mm-bot-complete/scripts/watchdog_manual.sh
```

**Features:**
- Shows latest backup info
- Restores `.env` manually
- Sends Discord/Slack alert
- Restarts PM2
- Resets watchdog baseline

### 4. PM2 Configuration
- **Startup:** Enabled via systemd (`pm2-root.service`)
- **Alerts:** Enabled (`pm2:notify true`)
- **Auto-resurrect:** On server reboot

## Quick Commands

### Check Status
```bash
# View cron jobs
crontab -l
cat /etc/cron.d/env_nightly_backup
cat /etc/cron.d/mm_watchdog

# Check PM2
pm2 list
systemctl status pm2-root

# View logs
tail -f /var/log/env_backup.log
tail -f /var/log/watchdog.log
```

### Manual Operations
```bash
# Create backup now
/root/hyperliquid-mm-bot-complete/scripts/nightly_env_backup.sh

# Trigger watchdog manually
/root/hyperliquid-mm-bot-complete/scripts/watchdog_manual.sh

# List backups
ls -lth /root/hyperliquid-mm-bot-complete/backups/env/

# View watchdog baseline
cat /root/hyperliquid-mm-bot-complete/runtime/watchdog/baseline.txt
```

### Testing
```bash
# Simulate crashes (3 restarts)
pm2 restart hyperliquid-mm
pm2 restart hyperliquid-mm
pm2 restart hyperliquid-mm

# Wait for next cron run (max 5 min)
# Watchdog should auto-restore

# Check what happened
tail -20 /var/log/watchdog.log
```

## Maintenance

### Disable/Enable Cron Jobs
```bash
# Disable
chmod -x /etc/cron.d/env_nightly_backup
chmod -x /etc/cron.d/mm_watchdog

# Enable
chmod +x /etc/cron.d/env_nightly_backup
chmod +x /etc/cron.d/mm_watchdog

# Restart cron
systemctl restart cron
```

### Adjust Thresholds
Edit `/root/hyperliquid-mm-bot-complete/scripts/watchdog_restore.sh`:
- `WINDOW=3600` - time window in seconds (default: 1 hour)
- `THRESHOLD=3` - restart count (default: 3 restarts)

## Alerts

Alerts are sent to Discord/Slack webhooks configured in `.env`:
- `DISCORD_WEBHOOK_URL`
- `SLACK_WEBHOOK_URL`

Priority: Slack → Discord (uses first available)

## Installation Date
2025-11-05 17:45 UTC
