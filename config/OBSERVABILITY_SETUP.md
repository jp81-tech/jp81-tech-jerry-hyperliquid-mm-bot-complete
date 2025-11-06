# Observability Stack Setup Guide
**Complete drop-in configs for zero-touch monitoring**

---

## Quick Start (Copy-Paste)

```bash
# 1. Copy configs to system directories
sudo cp config/promtail-config.yml /etc/promtail/promtail-mm-bot.yml
sudo cp config/loki-ruler-alerts.yml /etc/loki/rules/mm-bot-alerts.yml
sudo cp config/alertmanager-config.yml /etc/alertmanager/alertmanager.yml
sudo cp config/logrotate-mm-bot /etc/logrotate.d/mm-bot

# 2. Update Slack webhook and PagerDuty key in alertmanager.yml
sudo nano /etc/alertmanager/alertmanager.yml

# 3. Restart services
sudo systemctl restart promtail
sudo systemctl restart loki
sudo systemctl restart alertmanager

# 4. Verify scraping
curl http://localhost:3100/loki/api/v1/label | jq
# Should show: {"status":"success","data":["job","pair","side",...]}

# 5. Import Grafana dashboard
# Upload docs/grafana_dashboard_v2.json to Grafana UI
```

---

## Stack Architecture

```
┌─────────────────┐
│  MM Bot         │
│  bot.log        │ ← Structured quant_evt logs
└────────┬────────┘
         │
         ├───────────────────┐
         │                   │
    ┌────▼────┐         ┌────▼────┐
    │ Promtail│         │ logrotate│
    │ (scrape)│         │ (cleanup)│
    └────┬────┘         └─────────┘
         │
    ┌────▼────┐
    │  Loki   │ ← Time-series log storage
    │ (store) │
    └────┬────┘
         │
         ├───────────────────┬──────────────┐
         │                   │              │
    ┌────▼────┐         ┌────▼────┐   ┌────▼────┐
    │ Grafana │         │  Ruler  │   │ LogQL   │
    │(visualize)         │ (alert) │   │ (query) │
    └─────────┘         └────┬────┘   └─────────┘
                              │
                         ┌────▼────┐
                         │Alertmgr │ ← Route to Slack/PD
                         └────┬────┘
                              │
                    ┌─────────┴─────────┐
               ┌────▼────┐         ┌────▼────┐
               │  Slack  │         │PagerDuty│
               └─────────┘         └─────────┘
```

---

## Installation Steps

### 1. Install Loki Stack (if not already installed)

```bash
# Download Loki
wget https://github.com/grafana/loki/releases/download/v2.9.3/loki-linux-amd64.zip
unzip loki-linux-amd64.zip
sudo mv loki-linux-amd64 /usr/local/bin/loki
sudo chmod +x /usr/local/bin/loki

# Download Promtail
wget https://github.com/grafana/loki/releases/download/v2.9.3/promtail-linux-amd64.zip
unzip promtail-linux-amd64.zip
sudo mv promtail-linux-amd64 /usr/local/bin/promtail
sudo chmod +x /usr/local/bin/promtail

# Download Alertmanager
wget https://github.com/prometheus/alertmanager/releases/download/v0.26.0/alertmanager-0.26.0.linux-amd64.tar.gz
tar xzf alertmanager-0.26.0.linux-amd64.tar.gz
sudo mv alertmanager-0.26.0.linux-amd64/alertmanager /usr/local/bin/
sudo chmod +x /usr/local/bin/alertmanager
```

### 2. Create System Directories

```bash
# Loki
sudo mkdir -p /etc/loki /var/lib/loki /etc/loki/rules

# Promtail
sudo mkdir -p /etc/promtail /var/lib/promtail

# Alertmanager
sudo mkdir -p /etc/alertmanager /var/lib/alertmanager
```

### 3. Deploy Configs

```bash
cd /root/hyperliquid-mm-bot-complete

# Copy configs
sudo cp config/promtail-config.yml /etc/promtail/promtail.yml
sudo cp config/loki-ruler-alerts.yml /etc/loki/rules/mm-bot.yml
sudo cp config/alertmanager-config.yml /etc/alertmanager/alertmanager.yml
sudo cp config/logrotate-mm-bot /etc/logrotate.d/mm-bot
```

### 4. Create Loki Config (if not exists)

```bash
sudo tee /etc/loki/loki-config.yml > /dev/null <<'EOF'
auth_enabled: false

server:
  http_listen_port: 3100
  grpc_listen_port: 9096

common:
  path_prefix: /var/lib/loki
  storage:
    filesystem:
      chunks_directory: /var/lib/loki/chunks
      rules_directory: /var/lib/loki/rules
  replication_factor: 1
  ring:
    instance_addr: 127.0.0.1
    kvstore:
      store: inmemory

schema_config:
  configs:
    - from: 2020-10-24
      store: boltdb-shipper
      object_store: filesystem
      schema: v11
      index:
        prefix: index_
        period: 24h

ruler:
  alertmanager_url: http://localhost:9093
  storage:
    type: local
    local:
      directory: /etc/loki/rules
  rule_path: /var/lib/loki/rules-temp
  ring:
    kvstore:
      store: inmemory
  enable_api: true
  enable_alertmanager_v2: true

limits_config:
  retention_period: 336h  # 14 days
EOF
```

### 5. Create Systemd Services

**Loki:**
```bash
sudo tee /etc/systemd/system/loki.service > /dev/null <<'EOF'
[Unit]
Description=Loki Log Aggregation Server
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/loki -config.file=/etc/loki/loki-config.yml
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
EOF
```

**Promtail:**
```bash
sudo tee /etc/systemd/system/promtail.service > /dev/null <<'EOF'
[Unit]
Description=Promtail Log Shipper
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/promtail -config.file=/etc/promtail/promtail.yml
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
EOF
```

**Alertmanager:**
```bash
sudo tee /etc/systemd/system/alertmanager.service > /dev/null <<'EOF'
[Unit]
Description=Prometheus Alertmanager
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/alertmanager \
  --config.file=/etc/alertmanager/alertmanager.yml \
  --storage.path=/var/lib/alertmanager
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
EOF
```

### 6. Enable and Start Services

```bash
sudo systemctl daemon-reload
sudo systemctl enable loki promtail alertmanager
sudo systemctl start loki promtail alertmanager
```

### 7. Verify Services

```bash
# Check status
sudo systemctl status loki
sudo systemctl status promtail
sudo systemctl status alertmanager

# Check logs
sudo journalctl -u loki -f
sudo journalctl -u promtail -f
sudo journalctl -u alertmanager -f

# Test Loki API
curl http://localhost:3100/ready
# Should return: ready

# Test Promtail scraping
curl http://localhost:9080/metrics | grep promtail_read_lines_total
# Should show increasing line counts

# Test Alertmanager
curl http://localhost:9093/api/v1/status
# Should return: {"status":"success",...}
```

---

## Configuration Customization

### Update Slack Webhook

```bash
sudo nano /etc/alertmanager/alertmanager.yml

# Find this line:
slack_api_url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK'

# Replace with your actual webhook URL from Slack:
# 1. Go to https://api.slack.com/apps
# 2. Create new app → Incoming Webhooks
# 3. Copy webhook URL
```

### Update PagerDuty Integration

```bash
sudo nano /etc/alertmanager/alertmanager.yml

# Find this line:
routing_key: 'YOUR_PAGERDUTY_INTEGRATION_KEY'

# Replace with your PagerDuty integration key:
# 1. Go to PagerDuty → Services → Your Service
# 2. Integrations → Add Integration → Events API V2
# 3. Copy Integration Key
```

### Update Hostname

```bash
sudo nano /etc/promtail/promtail.yml

# Find this line:
host: mm-ny1

# Replace with your server hostname:
host: your-hostname-here
```

---

## Grafana Dashboard Import

### 1. Access Grafana
```bash
# Default: http://localhost:3000
# Default credentials: admin / admin
```

### 2. Add Loki Datasource
1. Configuration → Data Sources → Add data source
2. Select "Loki"
3. URL: `http://localhost:3100`
4. Save & Test

### 3. Import Dashboard
1. Dashboards → Import
2. Upload file: `docs/grafana_dashboard_v2.json`
3. Select Loki datasource
4. Import

### 4. Set Variables
- `job`: `mm-bot` (default)
- `host`: `.*` (regex for all hosts)
- `pair`: `.*` (regex for all pairs, or specify `SOL|ASTER`)
- `side`: `.*` (regex for all sides, or specify `buy|sell`)

---

## Alert Verification

### Test Alert Firing

```bash
# Stop bot to trigger MMBotNoLogs alert
./stop-bot.sh

# Wait 5 minutes, check Alertmanager:
curl http://localhost:9093/api/v1/alerts | jq '.data[] | select(.labels.alertname=="MMBotNoLogs")'

# Should see alert in "firing" state

# Restart bot
./start-bot.sh

# Wait 5 minutes, alert should resolve
```

### View Active Alerts

```bash
# Alertmanager API
curl http://localhost:9093/api/v1/alerts | jq

# Loki ruler API
curl http://localhost:3100/loki/api/v1/rules | jq
```

### Silence Alerts (for maintenance)

```bash
# Create 2-hour silence for all mm-bot alerts
curl -X POST http://localhost:9093/api/v1/silences \
  -H "Content-Type: application/json" \
  -d '{
    "matchers": [
      {"name": "component", "value": "mm-bot", "isRegex": false}
    ],
    "startsAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "endsAt": "'$(date -u -d '+2 hours' +%Y-%m-%dT%H:%M:%SZ)'",
    "createdBy": "ops-team",
    "comment": "Maintenance window"
  }'
```

---

## Troubleshooting

### Promtail Not Scraping

**Check log file permissions:**
```bash
ls -l /root/hyperliquid-mm-bot-complete/bot.log
# Should be readable by root (Promtail runs as root)
```

**Check Promtail targets:**
```bash
curl http://localhost:9080/targets | jq
# Should show bot.log target with "ready" status
```

**Check Promtail metrics:**
```bash
curl http://localhost:9080/metrics | grep promtail_read_lines_total
# Should be increasing
```

### Loki Not Receiving Logs

**Check Loki ingestion:**
```bash
curl http://localhost:3100/loki/api/v1/labels | jq
# Should show: ["job", "pair", "side", ...]
```

**Query logs directly:**
```bash
curl -G -s "http://localhost:3100/loki/api/v1/query" \
  --data-urlencode 'query={job="mm-bot"} |= "quant_evt="' \
  --data-urlencode 'limit=10' | jq
```

### Alerts Not Firing

**Check ruler evaluation:**
```bash
curl http://localhost:3100/loki/api/v1/rules | jq
# Should show mm-bot-health, mm-bot-errors groups
```

**Check alert state:**
```bash
curl http://localhost:9093/api/v1/alerts | jq '.data[] | {name: .labels.alertname, state: .status.state}'
```

**Test alert manually:**
```bash
# Stop bot to trigger MMBotNoLogs
./stop-bot.sh
# Wait 5 min, check Slack/PagerDuty
```

### High Cardinality Warnings

If Loki complains about high cardinality, remove `cloid` from labels in Promtail config:
```yaml
# Remove this line from pipeline_stages > labels:
cloid:  # ← Delete this, keep cloid as field only
```

---

## Maintenance

### Rotate Logs Manually

```bash
sudo logrotate -f /etc/logrotate.d/mm-bot
ls -lh /root/hyperliquid-mm-bot-complete/bot.log*
```

### Clean Old Loki Data

```bash
# Loki auto-cleans after retention_period (14 days)
# Manual cleanup:
sudo rm -rf /var/lib/loki/chunks/*
sudo systemctl restart loki
```

### Backup Alert Rules

```bash
sudo cp /etc/loki/rules/mm-bot.yml /root/hyperliquid-mm-bot-complete/config/loki-ruler-alerts.yml.backup
```

---

## Monitoring Checklist

Daily:
- [ ] Check Grafana dashboard for anomalies
- [ ] Review Slack #mm-bot-info for spec changes

Weekly:
- [ ] Review error rate trends (should be decreasing)
- [ ] Check disk usage: `df -h /var/lib/loki`
- [ ] Verify log rotation: `ls -lh bot.log*`

Monthly:
- [ ] Review and tune alert thresholds
- [ ] Update Grafana dashboard panels
- [ ] Test PagerDuty escalation

---

## Quick Reference

| Component | Port | Config | Logs |
|-----------|------|--------|------|
| Loki | 3100 | `/etc/loki/loki-config.yml` | `journalctl -u loki` |
| Promtail | 9080 | `/etc/promtail/promtail.yml` | `journalctl -u promtail` |
| Alertmanager | 9093 | `/etc/alertmanager/alertmanager.yml` | `journalctl -u alertmanager` |
| Grafana | 3000 | `/etc/grafana/grafana.ini` | `journalctl -u grafana` |

**Useful Commands:**
```bash
# Restart all services
sudo systemctl restart loki promtail alertmanager

# Check service status
sudo systemctl status loki promtail alertmanager | grep Active

# View recent logs
sudo journalctl -u loki -u promtail -u alertmanager --since "10 minutes ago"

# Test log scraping
tail -f /root/hyperliquid-mm-bot-complete/bot.log | grep quant_evt
```

---

## Support

For issues with:
- **Bot logs**: Check `docs/SRE_RUNBOOK.md`
- **Loki stack**: https://grafana.com/docs/loki/latest/
- **Alerts**: Check `docs/loki-ruler-alerts.yml` comments
- **Dashboard**: Check `docs/CORRELATION_COMPLETE.md`

All configs tested on Ubuntu 20.04/22.04 with systemd.
