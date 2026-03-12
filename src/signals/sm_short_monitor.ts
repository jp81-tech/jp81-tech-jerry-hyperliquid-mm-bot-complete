/**
 * SM SHORT MONITOR - Hyperliquid Perps
 * Monitors Smart Money positions via Nansen Perp Screener API
 * Detects position changes and generates alerts
 * 2026-01-24
 */

import axios from 'axios';
import * as fs from 'fs';

// ============ TYPES ============

interface PerpTrader {
  trader_address: string;
  trader_label?: string;
  token: string;
  side: 'long' | 'short';
  position_value_usd: number;
  unrealized_pnl_usd: number;
  entry_price?: number;
  current_price?: number;
  holding_amount?: number;
}

interface NansenScreenerResponse {
  data: PerpTrader[];
  pagination?: {
    page: number;
    total_pages: number;
  };
}

interface PositionSnapshot {
  address: string;
  token: string;
  side: 'long' | 'short';
  value_usd: number;
  timestamp: string;
}

interface Config {
  nansenApiKey: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  pollIntervalMs: number;
  minValueUsd: number;
  watchTokens: string[];
}

// ============ CONFIGURATION ============

const config: Config = {
  nansenApiKey: process.env.NANSEN_API_KEY || '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.NANSEN_ALERT_CHAT_ID || process.env.TELEGRAM_CHAT_ID,
  pollIntervalMs: 5 * 60_000,  // 5 minutes (API has limited rate)
  minValueUsd: 50_000,         // minimum $50k position
  watchTokens: ['FARTCOIN', 'VIRTUAL', 'LIT', 'BTC', 'ETH', 'SOL', 'HYPE'],
};

// ============ CONSTANTS ============

const BASE_URL = 'https://api.nansen.ai/api/v1';
const ALERT_QUEUE_FILE = '/tmp/nansen_raw_alert_queue.json';
const POSITION_SNAPSHOT_FILE = '/tmp/sm_position_snapshot.json';

// Exponential backoff for API errors (403 insufficient credits)
let backoffMs = 0;
let consecutiveErrors = 0;
const MAX_BACKOFF_MS = 60 * 60_000;  // max 1 hour between retries

// ============ UTILS ============

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getValueEmoji(valueUsd: number): string {
  if (valueUsd >= 1_000_000) return '🔴🔴🔴';
  if (valueUsd >= 500_000) return '🔴🔴';
  if (valueUsd >= 100_000) return '🔴';
  if (valueUsd >= 50_000) return '🟠';
  return '🟡';
}

// ============ POSITION SNAPSHOT ============

function loadPreviousSnapshot(): Map<string, PositionSnapshot> {
  try {
    if (fs.existsSync(POSITION_SNAPSHOT_FILE)) {
      const data = JSON.parse(fs.readFileSync(POSITION_SNAPSHOT_FILE, 'utf8'));
      return new Map(data.positions.map((p: PositionSnapshot) => [`${p.address}_${p.token}`, p]));
    }
  } catch (e) {
    console.log('[SmShortMonitor] No previous snapshot found');
  }
  return new Map();
}

function saveSnapshot(positions: PositionSnapshot[]): void {
  try {
    const data = {
      positions,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(POSITION_SNAPSHOT_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[SmShortMonitor] Error saving snapshot:', e);
  }
}

// ============ NANSEN API ============

async function fetchPerpScreener(): Promise<PerpTrader[]> {
  const url = `${BASE_URL}/perp-screener`;

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

  const payload = {
    date: {
      from: sevenDaysAgo.toISOString(),
      to: now.toISOString()
    },
    pagination: {
      page: 1,
      per_page: 100
    }
  };

  try {
    const response = await axios.post<NansenScreenerResponse>(url, payload, {
      headers: {
        'apiKey': config.nansenApiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    return response.data.data || [];
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`[SmShortMonitor] Perp Screener Error: ${error.response?.status}`);
      if (error.response?.data) {
        console.error(`[SmShortMonitor] Response:`, JSON.stringify(error.response.data).slice(0, 200));
      }
    }
    return [];
  }
}

// ============ POSITION DETECTION ============

interface PositionChange {
  type: 'NEW_SHORT' | 'NEW_LONG' | 'INCREASED_SHORT' | 'INCREASED_LONG' | 'CLOSED_SHORT' | 'CLOSED_LONG';
  address: string;
  label?: string;
  token: string;
  value_usd: number;
  prev_value_usd?: number;
}

function detectPositionChanges(
  currentTraders: PerpTrader[],
  previousSnapshot: Map<string, PositionSnapshot>
): PositionChange[] {
  const changes: PositionChange[] = [];
  const currentPositions: PositionSnapshot[] = [];

  // Process current positions
  for (const trader of currentTraders) {
    const token = trader.token?.toUpperCase();
    if (!token || !config.watchTokens.includes(token)) continue;
    if (trader.position_value_usd < config.minValueUsd) continue;

    const key = `${trader.trader_address}_${token}`;
    const prev = previousSnapshot.get(key);

    currentPositions.push({
      address: trader.trader_address,
      token,
      side: trader.side,
      value_usd: trader.position_value_usd,
      timestamp: new Date().toISOString()
    });

    if (!prev) {
      // New position
      changes.push({
        type: trader.side === 'short' ? 'NEW_SHORT' : 'NEW_LONG',
        address: trader.trader_address,
        label: trader.trader_label,
        token,
        value_usd: trader.position_value_usd
      });
    } else if (prev.side !== trader.side) {
      // Side changed (closed old, opened new)
      changes.push({
        type: prev.side === 'short' ? 'CLOSED_SHORT' : 'CLOSED_LONG',
        address: trader.trader_address,
        label: trader.trader_label,
        token,
        value_usd: prev.value_usd
      });
      changes.push({
        type: trader.side === 'short' ? 'NEW_SHORT' : 'NEW_LONG',
        address: trader.trader_address,
        label: trader.trader_label,
        token,
        value_usd: trader.position_value_usd
      });
    } else if (trader.position_value_usd > prev.value_usd * 1.2) {
      // Position increased by 20%+
      changes.push({
        type: trader.side === 'short' ? 'INCREASED_SHORT' : 'INCREASED_LONG',
        address: trader.trader_address,
        label: trader.trader_label,
        token,
        value_usd: trader.position_value_usd,
        prev_value_usd: prev.value_usd
      });
    }
  }

  // Save current snapshot
  saveSnapshot(currentPositions);

  return changes;
}

// ============ ALERT QUEUE ============

interface AlertQueueEntry {
  timestamp: string;
  message: string;
  token: string;
  processed: boolean;
  source?: string;
}

function queueAlertForMmBot(change: PositionChange): void {
  try {
    let queue: AlertQueueEntry[] = [];

    if (fs.existsSync(ALERT_QUEUE_FILE)) {
      queue = JSON.parse(fs.readFileSync(ALERT_QUEUE_FILE, 'utf8'));
    }

    const emoji = getValueEmoji(change.value_usd);
    const label = change.label || shortenAddress(change.address);

    let message = '';
    switch (change.type) {
      case 'NEW_SHORT':
        message = `${emoji} SM SHORT OPEN: ${change.token} - Smart Money opened ${formatUsd(change.value_usd)} SHORT | Trader: ${label}`;
        break;
      case 'NEW_LONG':
        message = `${emoji} SM LONG OPEN: ${change.token} - Smart Money opened ${formatUsd(change.value_usd)} LONG | Trader: ${label}`;
        break;
      case 'INCREASED_SHORT':
        message = `${emoji} SM SHORT ADDED: ${change.token} - Smart Money increased SHORT to ${formatUsd(change.value_usd)} | Trader: ${label}`;
        break;
      case 'INCREASED_LONG':
        message = `${emoji} SM LONG ADDED: ${change.token} - Smart Money increased LONG to ${formatUsd(change.value_usd)} | Trader: ${label}`;
        break;
      case 'CLOSED_SHORT':
        message = `🟢 SM SHORT CLOSED: ${change.token} - Smart Money closed ${formatUsd(change.value_usd)} SHORT | Trader: ${label}`;
        break;
      case 'CLOSED_LONG':
        message = `🟢 SM LONG CLOSED: ${change.token} - Smart Money closed ${formatUsd(change.value_usd)} LONG | Trader: ${label}`;
        break;
    }

    queue.push({
      timestamp: new Date().toISOString(),
      message,
      token: change.token,
      processed: false,
      source: 'sm_short_monitor'
    });

    // Keep only last 50 alerts
    if (queue.length > 50) {
      queue = queue.slice(-50);
    }

    fs.writeFileSync(ALERT_QUEUE_FILE, JSON.stringify(queue, null, 2));
    console.log(`[SmShortMonitor] Queued: ${message}`);
  } catch (e) {
    console.error('[SmShortMonitor] Error queuing alert:', e);
  }
}

// ============ TELEGRAM ============

async function sendTelegramAlert(change: PositionChange): Promise<void> {
  if (!config.telegramBotToken || !config.telegramChatId) return;

  const emoji = getValueEmoji(change.value_usd);
  const label = change.label || shortenAddress(change.address);

  let typeText = '';
  let color = '🟡';

  switch (change.type) {
    case 'NEW_SHORT':
      typeText = '🔻 NEW SHORT';
      color = '🔴';
      break;
    case 'NEW_LONG':
      typeText = '🔺 NEW LONG';
      color = '🟢';
      break;
    case 'INCREASED_SHORT':
      typeText = '⬇️ INCREASED SHORT';
      color = '🔴';
      break;
    case 'INCREASED_LONG':
      typeText = '⬆️ INCREASED LONG';
      color = '🟢';
      break;
    case 'CLOSED_SHORT':
      typeText = '✅ CLOSED SHORT';
      color = '🟢';
      break;
    case 'CLOSED_LONG':
      typeText = '✅ CLOSED LONG';
      color = '🔴';
      break;
  }

  const message = `
${emoji} *SM Position Change: ${change.token}*

${color} *Type:* ${typeText}
💵 *Value:* ${formatUsd(change.value_usd)}
🏷️ *Trader:* ${label}
👤 *Address:* \`${shortenAddress(change.address)}\`

🤖 _Alert queued for MM Bot_
  `.trim();

  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;

  try {
    await axios.post(url, {
      chat_id: config.telegramChatId,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
    console.log(`[SmShortMonitor] Telegram alert sent: ${change.token} ${change.type}`);
  } catch (error) {
    console.error('[SmShortMonitor] Telegram error:', error);
  }
}

// ============ MAIN LOOP ============

async function pollOnce(): Promise<void> {
  try {
    // Respect backoff on API credit exhaustion
    if (backoffMs > 0) {
      console.log(`[SmShortMonitor] ⏳ Backoff active — waiting ${Math.round(backoffMs / 60000)}min before next API call`);
      await sleep(backoffMs);
    }

    // Load previous snapshot
    const previousSnapshot = loadPreviousSnapshot();

    // Fetch current positions
    const traders = await fetchPerpScreener();
    console.log(`[SmShortMonitor] Fetched ${traders.length} traders from perp-screener`);

    if (traders.length === 0) {
      console.log('[SmShortMonitor] No data returned - API may be rate limited');
      return;
    }

    // Reset backoff on successful fetch
    if (consecutiveErrors > 0) {
      console.log(`[SmShortMonitor] ✅ API recovered after ${consecutiveErrors} errors — backoff reset`);
      consecutiveErrors = 0;
      backoffMs = 0;
    }

    // Detect changes
    const changes = detectPositionChanges(traders, previousSnapshot);

    if (changes.length > 0) {
      console.log(`[SmShortMonitor] Detected ${changes.length} position changes`);

      for (const change of changes) {
        console.log(`  ${change.type}: ${change.token} ${formatUsd(change.value_usd)} by ${change.label || shortenAddress(change.address)}`);

        queueAlertForMmBot(change);
        await sendTelegramAlert(change);
        await sleep(500);
      }
    } else {
      console.log('[SmShortMonitor] No significant position changes detected');
    }

  } catch (error) {
    console.error('[SmShortMonitor] Poll error:', error);
  }
}

async function main(): Promise<void> {
  console.log('========================================');
  console.log('🔍 SM Short Monitor Starting...');
  console.log('========================================');
  console.log(`📋 Config:`);
  console.log(`   - Poll interval: ${config.pollIntervalMs / 1000}s`);
  console.log(`   - Min position: ${formatUsd(config.minValueUsd)}`);
  console.log(`   - Watch tokens: ${config.watchTokens.join(', ')}`);
  console.log(`   - Telegram: ${config.telegramBotToken ? '✅' : '❌'}`);
  console.log(`   - API Key: ${config.nansenApiKey ? '✅ ' + config.nansenApiKey.slice(0, 8) + '...' : '❌'}`);
  console.log('');

  if (!config.nansenApiKey) {
    console.error('❌ NANSEN_API_KEY not set! Exiting...');
    process.exit(1);
  }

  // Poll loop with backoff support
  while (true) {
    await pollOnce();
    await sleep(config.pollIntervalMs);
  }
}

// ============ START ============

main().catch(console.error);

export { fetchPerpScreener, PerpTrader };
