#!/usr/bin/env node
/**
 * Smart Money Data Updater
 *
 * This script runs in Claude Code environment (has MCP access) and:
 * 1. Queries Nansen MCP for Smart Money positions
 * 2. Parses the results
 * 3. Pushes to Data Provider API on production server
 *
 * Usage:
 *   node update-smart-money.mjs
 *
 * Cron (every 5 minutes):
 *   Run every 5 minutes: cd /path/to/nansen-data-provider && node update-smart-money.mjs >> update.log 2>&1
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

// Configuration
const DATA_PROVIDER_URL = process.env.DATA_PROVIDER_URL || 'http://65.109.92.187:8080';
const NANSEN_API_KEY = process.env.NANSEN_API_KEY || 'DGLPOtSE9rbfy1O2ZnQO7eBmUBM2Qxcf';
const TARGET_TOKENS = ['BTC', 'ETH', 'SOL', 'HYPE', 'ZEC'];

/**
 * Parse markdown table to count Long vs Short positions
 */
function parseMarkdownTable(markdown) {
  const lines = markdown.split('\n');
  let longCount = 0;
  let shortCount = 0;

  for (const line of lines) {
    if (!line.trim().startsWith('|')) continue;
    if (line.includes('|:---')) continue;
    if (line.includes('| Trader Address')) continue;

    const columns = line.split('|').map(c => c.trim()).filter(c => c);
    if (columns.length < 3) continue;

    const side = columns[2]; // Side column
    if (side.toLowerCase().includes('long')) longCount++;
    if (side.toLowerCase().includes('short')) shortCount++;
  }

  return { longCount, shortCount };
}

/**
 * Query Nansen MCP for Smart Money positions
 *
 * NOTE: This uses the actual MCP tool call syntax that works in Claude Code
 */
async function queryNansenMCP(tokenSymbol) {
  console.log(`[${tokenSymbol}] Querying Nansen MCP...`);

  try {
    // Call MCP using npx (Claude Code environment)
    const cmd = `npx -y @anthropic-ai/mcp-client call https://mcp.nansen.ai/ra/mcp/ \
      mcp__nansen__token_current_top_holders \
      '{"request":{"parameters":{"mode":"perps","token_address":"${tokenSymbol}","label_type":"smart_money"},"page":1}}' \
      --header "NANSEN-API-KEY:${NANSEN_API_KEY}" \
      --allow-http`;

    const { stdout, stderr } = await execPromise(cmd, {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024
    });

    if (stderr && !stderr.includes('npm notice')) {
      console.error(`[${tokenSymbol}] Warning:`, stderr);
    }

    // Parse the response
    try {
      const result = JSON.parse(stdout);
      const content = result.content?.[0]?.text || '';

      if (!content) {
        throw new Error('No content in MCP response');
      }

      return content;
    } catch (parseError) {
      console.error(`[${tokenSymbol}] Failed to parse MCP response:`, parseError.message);
      return null;
    }

  } catch (error) {
    console.error(`[${tokenSymbol}] MCP query failed:`, error.message);
    return null;
  }
}

/**
 * Calculate Smart Money bias from MCP response
 */
function calculateBias(tokenSymbol, markdownContent) {
  const { longCount, shortCount } = parseMarkdownTable(markdownContent);
  const totalCount = longCount + shortCount;

  if (totalCount === 0) {
    console.log(`[${tokenSymbol}] No positions found`);
    return { bias: 'NEUTRAL', longPct: 50, shortPct: 50, totalPositions: 0 };
  }

  const longPct = (longCount / totalCount) * 100;
  const shortPct = (shortCount / totalCount) * 100;

  let bias = 'NEUTRAL';
  if (longPct > 70) bias = 'LONG';
  else if (longPct < 30) bias = 'SHORT';

  console.log(`[${tokenSymbol}] ${longCount}L / ${shortCount}S (${longPct.toFixed(1)}% long) → ${bias}`);

  return {
    bias,
    longPct: Math.round(longPct * 10) / 10,
    shortPct: Math.round(shortPct * 10) / 10,
    totalPositions: totalCount
  };
}

/**
 * Push bias data to Data Provider API
 */
async function pushToDataProvider(tokenSymbol, biasData) {
  try {
    const response = await fetch(`${DATA_PROVIDER_URL}/api/update_bias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: tokenSymbol,
        ...biasData
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    console.log(`[${tokenSymbol}] ✅ Pushed to Data Provider`);
    return result;

  } catch (error) {
    console.error(`[${tokenSymbol}] ❌ Failed to push to Data Provider:`, error.message);
    return null;
  }
}

/**
 * Update Smart Money data for all tokens
 */
async function updateAllTokens() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${new Date().toISOString()}] Starting Smart Money update`);
  console.log(`${'='.repeat(60)}\n`);

  const results = [];

  for (const token of TARGET_TOKENS) {
    try {
      // Query Nansen MCP
      const markdownContent = await queryNansenMCP(token);

      if (!markdownContent) {
        console.log(`[${token}] Skipping due to query failure\n`);
        results.push({ token, status: 'failed' });
        continue;
      }

      // Calculate bias
      const biasData = calculateBias(token, markdownContent);

      // Push to Data Provider
      await pushToDataProvider(token, biasData);

      results.push({ token, status: 'success', ...biasData });

      // Small delay between requests to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.error(`[${token}] Error:`, error.message);
      results.push({ token, status: 'error', error: error.message });
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('Update Summary:');
  results.forEach(r => {
    const status = r.status === 'success' ? '✅' : '❌';
    const detail = r.status === 'success'
      ? `${r.bias} (${r.longPct}%L)`
      : r.error || 'failed';
    console.log(`  ${status} ${r.token}: ${detail}`);
  });
  console.log(`${'='.repeat(60)}\n`);

  return results;
}

// Run the update
updateAllTokens()
  .then(results => {
    const successCount = results.filter(r => r.status === 'success').length;
    console.log(`Completed: ${successCount}/${results.length} successful`);

    if (successCount > 0) {
      console.log('Update completed'); // Required for workflow success check
      process.exit(0);
    } else {
      console.error('Update failed: no successful token updates');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('Fatal error:', error && error.stack ? error.stack : error);
    process.exit(1);
  });
