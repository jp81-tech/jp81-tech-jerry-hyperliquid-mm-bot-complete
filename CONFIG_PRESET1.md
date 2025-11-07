# Configuration Preset #1: Safe & Fast Legacy Close

## Applied: 2025-11-07 19:28:29 UTC

### Settings:
```bash
LEGACY_MIN_PROFIT_USD=5
FUNDING_CLOSE_IF_AGAINST_MIN=12
FUNDING_BUFFER_BPS=1
FUNDING_MAX_LOSS_USD=15
LEGACY_CLOSE_IF_NOT_ACTIVE_MIN=3
AUTO_CLOSE_LEGACY=1
LEGACY_ONLY_IF_PROFIT=1
```

### Confluence Settings:
```bash
CONFLUENCE_ENABLED=1
TARGET_UTILIZATION=0.80
CONFLUENCE_BOOST_X=1.6
MIN_ALLOC_USD=100
MAX_ALLOC_USD=1200
```

### Active Pairs (Confluence):
- ZEC, NEAR, XPL, FIL

### Automation:
- Cron: */2 * * * * mm-close-legacy-profit
- Script: /usr/local/bin/mm-close-legacy-profit
- Funding tracker: runtime/funding_against_state.json

### Logic:
Legacy positions are closed when:
1. Profit > $5 USD, OR
2. Funding rate against position for 12+ minutes (with 1 bps buffer)
3. Max loss cap: $15 (won't close if loss exceeds this)
