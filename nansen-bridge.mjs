/**
 * NANSEN BRIDGE - Serves Smart Money data from file
 *
 * Data is updated by Claude Code MCP calls and stored in /tmp/smart_money_data.json
 */

import express from 'express';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.json());

const PORT = 8080;
const DATA_FILE = '/tmp/smart_money_data.json';

// Cache for performance
let cachedData = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 1000; // 1 minute

function loadData() {
    const now = Date.now();
    if (cachedData && (now - cacheTime) < CACHE_TTL) {
        return cachedData;
    }

    try {
        if (fs.existsSync(DATA_FILE)) {
            const content = fs.readFileSync(DATA_FILE, 'utf-8');
            cachedData = JSON.parse(content);
            cacheTime = now;
            return cachedData;
        }
    } catch (err) {
        console.error('[PROXY] Failed to load data file:', err.message);
    }
    return null;
}

// Convert file data to API format
function convertToApiFormat(symbol, fileData) {
    if (!fileData || !fileData.data || !fileData.data[symbol]) {
        return null;
    }

    const d = fileData.data[symbol];
    const flow = d.flow || 0;

    // Use actual SM and Whale data if available (from fresh Nansen MCP queries)
    const smNetUsd = d.sm_net_usd ?? Math.round(flow);
    const whaleNetUsd = d.whale_net_usd ?? Math.round(flow * 0.3);

    return {
        symbol,
        sm_net_balance_usd: smNetUsd,
        whale_net_balance_usd: whaleNetUsd,
        sm_holders: flow > 0 ? 50 : (flow < 0 ? 20 : 10),
        whale_dump_alert: whaleNetUsd < -10000000 || d.whale_dump_alert,
        bias: d.bias,
        signal: d.signal,
        trades: d.trades,
        timestamp: new Date(fileData.timestamp).getTime(),
        // Pass through divergence data if present
        divergence_type: d.divergence?.type,
        divergence_strength: d.divergence?.strength,
        divergence_spread_mult: d.divergence?.spread_multiplier,
        divergence_inventory_mult: d.divergence?.inventory_multiplier
    };
}

// Single symbol endpoint
app.get('/api/hl_bias/:symbol', (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const fileData = loadData();

    if (!fileData) {
        return res.status(500).json({ success: false, error: 'Data file not found' });
    }

    const data = convertToApiFormat(symbol, fileData);
    if (data) {
        console.log(`[PROXY] ${symbol}: bias=${data.bias} flow=$${(data.sm_net_balance_usd/1e6).toFixed(1)}M`);
        res.json({ success: true, data });
    } else {
        res.status(404).json({ success: false, error: `No data for ${symbol}` });
    }
});

// Golden Duo endpoint - all symbols
app.get('/api/golden_duo', (req, res) => {
    const fileData = loadData();

    if (!fileData) {
        return res.status(500).json({ success: false, error: 'Data file not found' });
    }

    const results = {};
    const symbols = Object.keys(fileData.data || {});

    for (const symbol of symbols) {
        const data = convertToApiFormat(symbol, fileData);
        if (data) {
            results[symbol] = data;
        }
    }

    console.log(`[PROXY] Golden Duo: ${Object.keys(results).length} symbols loaded`);
    res.json(results);
});

// Health check
app.get('/health', (req, res) => {
    const fileData = loadData();
    const age = fileData ? Math.round((Date.now() - new Date(fileData.timestamp).getTime()) / 60000) : -1;

    res.json({
        status: 'ok',
        dataAge: age >= 0 ? `${age} minutes` : 'no data',
        symbols: fileData ? Object.keys(fileData.data || {}).length : 0
    });
});

// ════════════════════════════════════════════════════════════════
// TIER 2 TACTICAL ENDPOINT
// ════════════════════════════════════════════════════════════════
app.get('/api/latest_trades', (req, res) => {
    const fileData = loadData();
    if (!fileData || !fileData.latest_trades) {
        // Fallback to whale_trades if latest_trades not yet populated
        const legacyTrades = fileData?.whale_trades || [];
        return res.json({ success: true, trades: legacyTrades });
    }
    res.json({ success: true, trades: fileData.latest_trades });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Nansen Proxy running on port ${PORT}`);
    console.log(`📂 Data source: ${DATA_FILE}`);

    const fileData = loadData();
    if (fileData) {
        console.log(`✅ Loaded ${Object.keys(fileData.data || {}).length} symbols`);
        console.log(`📅 Data timestamp: ${fileData.timestamp}`);
    } else {
        console.log(`⚠️  No data file found. Update with Claude Code MCP.`);
    }
});
