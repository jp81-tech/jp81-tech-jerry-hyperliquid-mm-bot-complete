# Nansen MCP Architecture Limitation

## Problem

The Nansen API uses **Model Context Protocol (MCP)**, which cannot be accessed via standard HTTP POST requests from GitHub Actions or automated scripts.

### Evidence

1. **Direct HTTP calls fail with 406 Not Acceptable**:
   ```
   HTTP 406: Not Acceptable
   ```

2. **Claude Code MCP tool returns 401 Unauthorized**:
   ```javascript
   mcp__nansen__token_current_top_holders({
     parameters: { mode: "perps", token_address: "BTC", label_type: "smart_money" }
   })
   // Returns: 401 Unauthorized
   ```

3. **MCP requires special protocol/client**:
   - MCP is NOT a REST API
   - Requires specialized MCP client (like Claude Code's built-in client)
   - Cannot be called from GitHub Actions runners
   - Cannot be called from standard Node.js scripts using `fetch()`

## Why GitHub Actions Can't Work

The original plan was:
```
GitHub Actions (every 5 min)
  → Query Nansen MCP API
  → Calculate Smart Money bias
  → Push to Data Provider API
```

**This fails because**:
- GitHub Actions runners don't have MCP client access
- Direct HTTP POST to `https://mcp.nansen.ai/ra/mcp/` returns 406/401
- Even with correct API key, MCP protocol is not compatible with standard HTTP

## Correct Workflow

Since **automated queries are not possible**, use this manual workflow instead:

### Option A: Manual Updates (RECOMMENDED)

```bash
# 1. On your local machine with Claude Code access
node update-smart-money.mjs

# This script will:
# - Query Nansen MCP (requires MCP client)
# - Calculate bias
# - Push to Data Provider API at http://65.109.92.187:8080
```

### Option B: Push Data Directly to Data Provider

When you have Smart Money data from other sources:

```bash
curl -X POST http://65.109.92.187:8080/api/update_bias \
  -H "Content-Type: application/json" \
  -d '{
    "token": "BTC",
    "bias": "LONG",
    "longPct": 75.5,
    "shortPct": 24.5,
    "totalPositions": 20
  }'
```

### Option C: Disable GitHub Actions Workflow

Since the workflow will continue to fail:

```bash
# Disable the workflow
mv .github/workflows/update-nansen-self-hosted.yml \
   .github/workflows/update-nansen-self-hosted.yml.disabled
```

## Data Provider API

The Data Provider API at `http://65.109.92.187:8080` is still working correctly:

- **GET** `/api/smart_money_bias` - Get all bias data
- **GET** `/api/smart_money_bias/:token` - Get specific token bias
- **POST** `/api/update_bias` - Manually update bias data
- **GET** `/health` - Health check

## API Keys Status

Current Nansen API key: `zkt0q6IxFlIamOx94RaCgXausNkJWK7X`
- Updated in GitHub Secrets: ✅
- Updated in `.claude.json`: ✅
- Updated in `update-smart-money.mjs`: ✅

**Note**: Even with correct API key, MCP access requires Claude Code's MCP client.

## Recommendation

**Disable the GitHub Actions workflow** and use manual updates when needed:

```bash
# On local machine with Claude Code
cd /Users/jerry/hyperliquid-mm-bot-complete/nansen-data-provider
node update-smart-money.mjs
```

Or query Data Provider for current bias in your bot:

```typescript
// In your MM bot
const response = await fetch('http://65.109.92.187:8080/api/smart_money_bias/BTC');
const data = await response.json();
console.log('Smart Money bias for BTC:', data.data.bias);
```
