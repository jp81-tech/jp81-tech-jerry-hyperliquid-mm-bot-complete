/**
 * Nansen Alert Parser V2
 * Enhanced parsing for SM position changes and whale activity
 * 2026-01-24
 */

import { NansenAlert, AlertType } from '../types/nansen_alerts.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const ALERT_LOG_FILE = '/tmp/nansen_alert_log.json';
const SIGNAL_STATE_FILE = '/tmp/nansen_mm_signal_state.json';

// ═══════════════════════════════════════════════════════════════
// MM BOT ALERT THRESHOLDS - Dostosowane do wolumenów tokenów
// Zaktualizowane 2026-01-24 na podstawie Nansen dashboard
// ═══════════════════════════════════════════════════════════════
const MM_ALERT_THRESHOLDS: Record<string, {
  chain: string;
  min1hFlow: number;       // dla inflow (akumulacja)
  min24hFlow: number;
  min1hOutflow: number;    // dla outflow (short signal) - NOWE!
  min24hOutflow: number;
  minMarketCap: number;
  dailyVolume: number;
}> = {
  VIRTUAL: {
    chain: 'base',
    min1hFlow: 75_000,        // $75K/1h inflow
    min24hFlow: 250_000,      // $250K/24h inflow
    min1hOutflow: 25_000,     // $25K/1h outflow = SHORT SIGNAL
    min24hOutflow: 100_000,   // $100K/24h outflow = SHORT SIGNAL
    minMarketCap: 100_000_000,
    dailyVolume: 7_000_000,   // ~$7M/day (zaktualizowane)
  },
  FARTCOIN: {
    chain: 'solana',
    min1hFlow: 100_000,       // $100K/1h inflow
    min24hFlow: 300_000,      // $300K/24h inflow
    min1hOutflow: 25_000,     // $25K/1h outflow = SHORT SIGNAL
    min24hOutflow: 100_000,   // $100K/24h outflow = SHORT SIGNAL
    minMarketCap: 50_000_000,
    dailyVolume: 8_000_000,   // ~$8M/day (zaktualizowane)
  },
  LIT: {
    chain: 'ethereum',
    min1hFlow: 5_000,         // $5K/1h inflow (niska płynność!)
    min24hFlow: 15_000,       // $15K/24h inflow
    min1hOutflow: 3_000,      // $3K/1h outflow = SHORT SIGNAL (BARDZO NISKI PRÓG!)
    min24hOutflow: 10_000,    // $10K/24h outflow = SHORT SIGNAL
    minMarketCap: 5_000_000,
    dailyVolume: 70_000,      // ~$70K/day fresh flow (bardzo niska!)
  },
};

// ═══════════════════════════════════════════════════════════════
// CONTRARIAN ALERT FILTERS - Tylko znaczące ruchy SM!
// ═══════════════════════════════════════════════════════════════
const CONTRARIAN_CONFIG = {
  // Minimalna wartość transakcji SM do aktywacji alertu
  MIN_SM_FLOW_USD: 50_000,       // $50K minimum dla SM flow
  MIN_WHALE_POSITION_USD: 100_000, // $100K minimum dla whale activity

  // Tokeny z aktywną strategią MM
  MM_TOKENS: ['VIRTUAL', 'LIT', 'FARTCOIN'],

  // Tokeny z aktywną strategią contrarian
  CONTRARIAN_TOKENS: ['VIRTUAL', 'LIT', 'FARTCOIN'],

  // Preferowane typy alertów dla contrarian (priorytet)
  PRIORITY_ALERT_TYPES: [
    'SM_POSITION_CHANGE',  // SM otwiera/zamyka pozycje
    'WHALE_ACTIVITY',      // Duże ruchy whale
    'SM_DISTRIBUTION',     // SM sprzedaje (bearish)
    'FLASH_DUMP',          // Nagły dump
  ]
};

// ═══════════════════════════════════════════════════════════════
// MM SIGNAL STATE - Śledzenie sygnałów dla decyzji MM
// ═══════════════════════════════════════════════════════════════
export interface MMSignalState {
  token: string;
  lastSmAccumulation: { timestamp: string; value: number } | null;
  lastAiTrendReversal: { timestamp: string; signals: string[] } | null;
  combinedSignal: 'GREEN' | 'YELLOW' | 'RED' | 'NONE';
  lastUpdate: string;
  alertCount24h: number;
}

function loadSignalState(): Record<string, MMSignalState> {
  try {
    if (existsSync(SIGNAL_STATE_FILE)) {
      return JSON.parse(readFileSync(SIGNAL_STATE_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function saveSignalState(state: Record<string, MMSignalState>): void {
  try {
    writeFileSync(SIGNAL_STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

export function getMMSignalState(token: string): MMSignalState | null {
  const state = loadSignalState();
  return state[token.toUpperCase()] || null;
}

export function getMMSignalForToken(token: string): 'GREEN' | 'YELLOW' | 'RED' | 'NONE' {
  const state = getMMSignalState(token);
  if (!state) return 'NONE';

  // Use helper function for consistent logic
  return calculateSignalFromState(state);
}

// Helper: Calculate signal from in-memory state (avoids file read race condition)
function calculateSignalFromState(tokenState: MMSignalState): 'GREEN' | 'YELLOW' | 'RED' | 'NONE' {
  const now = Date.now();
  const smTime = tokenState.lastSmAccumulation ? new Date(tokenState.lastSmAccumulation.timestamp).getTime() : 0;
  const aiTime = tokenState.lastAiTrendReversal ? new Date(tokenState.lastAiTrendReversal.timestamp).getTime() : 0;

  const hoursAgoSm = (now - smTime) / (1000 * 60 * 60);
  const hoursAgoAi = (now - aiTime) / (1000 * 60 * 60);

  // GREEN: Both signals within 24h
  if (tokenState.lastSmAccumulation && tokenState.lastAiTrendReversal && hoursAgoSm < 24 && hoursAgoAi < 24) {
    return 'GREEN';
  }

  // YELLOW: One signal within 24h (must have actual signal, not just 0 timestamp)
  if ((tokenState.lastSmAccumulation && hoursAgoSm < 24) || (tokenState.lastAiTrendReversal && hoursAgoAi < 24)) {
    return 'YELLOW';
  }

  // RED: No signals for 48h+ (only if we had signals before)
  if (tokenState.lastSmAccumulation && tokenState.lastAiTrendReversal && hoursAgoSm > 48 && hoursAgoAi > 48) {
    return 'RED';
  }

  return 'NONE';
}

function updateSignalState(token: string, type: 'SM_ACCUMULATION' | 'AI_TREND_REVERSAL', data: any): void {
  const state = loadSignalState();
  const upperToken = token.toUpperCase();

  if (!state[upperToken]) {
    state[upperToken] = {
      token: upperToken,
      lastSmAccumulation: null,
      lastAiTrendReversal: null,
      combinedSignal: 'NONE',
      lastUpdate: new Date().toISOString(),
      alertCount24h: 0,
    };
  }

  if (type === 'SM_ACCUMULATION') {
    state[upperToken].lastSmAccumulation = {
      timestamp: new Date().toISOString(),
      value: data.value_usd || 0,
    };
  } else if (type === 'AI_TREND_REVERSAL') {
    state[upperToken].lastAiTrendReversal = {
      timestamp: new Date().toISOString(),
      signals: data.signals || [],
    };
  }

  state[upperToken].alertCount24h++;
  state[upperToken].lastUpdate = new Date().toISOString();

  // Calculate signal from in-memory state (not from file!)
  state[upperToken].combinedSignal = calculateSignalFromState(state[upperToken]);

  saveSignalState(state);

  console.log(`🎯 [MM_SIGNAL] ${upperToken}: ${state[upperToken].combinedSignal} ` +
    `| SM: ${state[upperToken].lastSmAccumulation ? 'YES' : 'NO'} ` +
    `| AI: ${state[upperToken].lastAiTrendReversal ? 'YES' : 'NO'}`);
}

export class NansenAlertParserV2 {

  parseMessage(message: string): NansenAlert | null {
    try {
      const parsers = [
        this.parseSmShortOpen,              // SM SHORT OPEN from real-time monitor (highest priority!)
        this.parseSmLongOpen,               // SM LONG OPEN from real-time monitor
        this.parseMmBotSmOutflowShortSignal,// SM OUTFLOW (Short Signal) from Nansen dashboard - BEARISH!
        this.parseMmBotSmInflowLongSignal,  // SM INFLOW (Long Signal) from Nansen dashboard - BULLISH!
        this.parseMmBotSmAccumulation,      // MM Bot SM Accumulation alerts (START signal)
        this.parseMmBotSmOutflow,           // MM Bot SM Outflow alerts (STOP signal)
        this.parseMmBotAiTrendReversal,     // MM Bot AI Trend Reversal alerts
        this.parseSmTokenFlow,      // SM Token Flow z filtrem wartości
        this.parseSmPositionChange,
        this.parseWhaleActivity,
        this.parseAccumulationDistribution,
        this.parseFlashSignal,
        this.parseCexFlow,
        this.parseMomentum,
        this.parseCapitulation,
      ];

      for (const parser of parsers) {
        const alert = parser.call(this, message);
        if (alert) {
          this.logAlert(alert);
          return alert;
        }
      }
      return null;
    } catch (error) {
      console.error('[AlertParser] Failed to parse:', error);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // MM BOT: SM OUTFLOW (Short Signal) - NOWY!
  // Format: "🤖 MM Bot: LIT - SM OUTFLOW (Short Signal)"
  // SM sprzedaje spot → prawdopodobnie otwiera shorty na HL perps
  // ═══════════════════════════════════════════════════════════════
  private parseMmBotSmOutflowShortSignal(message: string): NansenAlert | null {
    // Wzorce dla alertów SM OUTFLOW (Short Signal) z Nansen dashboard
    const patterns = [
      /MM\s*Bot[:\s]+(\w+)\s*[-–—]?\s*SM\s*OUTFLOW\s*\(?Short\s*Signal\)?/i,
      /🤖.*?MM\s*Bot[:\s]+(\w+)\s*[-–—]?\s*SM\s*OUTFLOW/i,
      /(\w+)\s*[-–—]?\s*SM\s*OUTFLOW\s*\(?Short/i,
      /SM\s*OUTFLOW.*?(\w+).*?\$([0-9,.]+[KMB]?)/i,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        const token = this.findToken(match, message);
        if (!token || !CONTRARIAN_CONFIG.MM_TOKENS.includes(token)) continue;

        const thresholds = MM_ALERT_THRESHOLDS[token];
        const value = this.findValue(match, message) || thresholds?.min1hOutflow || 10000;
        const chain = thresholds?.chain || this.extractChain(message);

        // Sprawdź czy wartość przekracza próg outflow
        const outflowThreshold = thresholds?.min1hOutflow || 10000;
        if (value < outflowThreshold) {
          console.log(`[AlertParser] SM OUTFLOW ${token}: $${value.toFixed(0)} < threshold $${outflowThreshold} - IGNORED`);
          continue;
        }

        // Oblicz siłę sygnału: 2x+ powyżej progu = STRONG
        const thresholdRatio = outflowThreshold > 0 ? value / outflowThreshold : 1;
        const signalStrength = thresholdRatio >= 2 ? 'STRONG' : thresholdRatio >= 1.5 ? 'MODERATE' : 'NORMAL';

        console.log(`🔻 [AlertParser] SM OUTFLOW SHORT SIGNAL: ${token} -$${(value/1000).toFixed(0)}K on ${chain} - ${signalStrength} BEARISH! (${thresholdRatio.toFixed(1)}x threshold)`);
        console.log(`   📊 Logika: SM sprzedaje spot ${token} → prawdopodobnie otwiera shorty na HL perps`);

        // NIE aktualizujemy SM_ACCUMULATION - to jest sygnał BEARISH!
        // Możemy wyczyścić sygnał akumulacji jeśli istnieje
        const state = loadSignalState();
        if (state[token.toUpperCase()]?.lastSmAccumulation) {
          console.log(`   ⚠️ Clearing SM Accumulation signal for ${token} - OUTFLOW detected!`);
          state[token.toUpperCase()].lastSmAccumulation = null;
          state[token.toUpperCase()].combinedSignal = 'RED';  // BEARISH
          state[token.toUpperCase()].lastUpdate = new Date().toISOString();
          saveSignalState(state);
        }

        return {
          id: this.generateId(),
          name: 'SM OUTFLOW Short Signal ' + token,
          token: token.toUpperCase(),
          chain: chain,
          timestamp: new Date(),
          type: 'SM_DISTRIBUTION',  // Bearish type!
          data: {
            value_usd: value,
            direction: 'outflow',
            source: 'nansen-dashboard-outflow',
            is_significant: true,
            is_short_signal: true,  // KLUCZOWE: to jest sygnał SHORT!
            signal_strength: signalStrength,
            threshold_ratio: thresholdRatio,
            thresholds: thresholds,
            logic: 'SM sprzedaje spot → otwiera shorty na perps',
          }
        };
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // MM BOT: SM INFLOW (Long Signal) - NOWY!
  // Format: "🤖 MM Bot: LIT - SM INFLOW (Long Signal)"
  // SM kupuje spot → prawdopodobnie otwiera longi na HL perps
  // ═══════════════════════════════════════════════════════════════
  private parseMmBotSmInflowLongSignal(message: string): NansenAlert | null {
    // Wzorce dla alertów SM INFLOW (Long Signal) z Nansen dashboard
    const patterns = [
      /MM\s*Bot[:\s]+(\w+)\s*[-–—]?\s*SM\s*INFLOW\s*\(?Long\s*Signal\)?/i,
      /🤖.*?MM\s*Bot[:\s]+(\w+)\s*[-–—]?\s*SM\s*INFLOW/i,
      /(\w+)\s*[-–—]?\s*SM\s*INFLOW\s*\(?Long/i,
      /SM\s*INFLOW.*?(\w+).*?\$([0-9,.]+[KkMmBb]?)/i,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        const token = this.findToken(match, message);
        if (!token || !CONTRARIAN_CONFIG.MM_TOKENS.includes(token)) continue;

        const thresholds = MM_ALERT_THRESHOLDS[token];
        const value = this.findValue(match, message) || thresholds?.min1hFlow || 10000;
        const chain = thresholds?.chain || this.extractChain(message);

        // Sprawdź czy wartość przekracza próg inflow
        const inflowThreshold = thresholds?.min1hFlow || 10000;
        if (value < inflowThreshold) {
          console.log(`[AlertParser] SM INFLOW ${token}: $${value.toFixed(0)} < threshold $${inflowThreshold} - IGNORED`);
          continue;
        }

        // Oblicz siłę sygnału: 2x+ powyżej progu = STRONG
        const thresholdRatio = inflowThreshold > 0 ? value / inflowThreshold : 1;
        const signalStrength = thresholdRatio >= 2 ? 'STRONG' : thresholdRatio >= 1.5 ? 'MODERATE' : 'NORMAL';

        console.log(`🔺 [AlertParser] SM INFLOW LONG SIGNAL: ${token} +$${(value/1000).toFixed(0)}K on ${chain} - ${signalStrength} BULLISH! (${thresholdRatio.toFixed(1)}x threshold)`);
        console.log(`   📊 Logika: SM kupuje spot ${token} → prawdopodobnie otwiera longi na HL perps`);

        // Aktualizuj sygnał SM_ACCUMULATION - to jest sygnał BULLISH!
        updateSignalState(token, 'SM_ACCUMULATION', {
          value_usd: value,
          chain,
          signalStrength,
          thresholdRatio,
          source: 'nansen-dashboard-inflow'
        });

        return {
          id: this.generateId(),
          name: 'SM INFLOW Long Signal ' + token,
          token: token.toUpperCase(),
          chain: chain,
          timestamp: new Date(),
          type: 'SM_ACCUMULATION',  // Bullish type!
          data: {
            value_usd: value,
            direction: 'inflow',
            source: 'nansen-dashboard-inflow',
            is_significant: true,
            is_long_signal: true,  // KLUCZOWE: to jest sygnał LONG!
            signal_strength: signalStrength,
            threshold_ratio: thresholdRatio,
            thresholds: thresholds,
            logic: 'SM kupuje spot → otwiera longi na perps',
          }
        };
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // MM BOT: SM ACCUMULATION ALERTS
  // Format: "MM Bot: VIRTUAL SM Accumulation" lub podobne
  // Wykrywa akumulację Smart Money - sygnał dna
  // ═══════════════════════════════════════════════════════════════
  private parseMmBotSmAccumulation(message: string): NansenAlert | null {
    // Wzorce dla alertów SM Accumulation z Nansen
    const patterns = [
      /MM\s*Bot[:\s]+(\w+)\s*SM\s*Accumulation/i,
      /(\w+)\s*SM\s*Accumulation.*?(?:Alert|Signal)/i,
      /Smart\s*Money\s*(?:Token\s*)?(?:In)?[Ff]low.*?(\w+).*?\$([0-9,.]+[KMB]?)/i,
      /(\w+).*?SM\s*[Ii]nflow.*?\$([0-9,.]+[KMB]?)/i,
      /🟢.*?SM.*?Accumulation.*?(\w+)/i,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        const token = this.findToken(match, message);
        if (!token || !CONTRARIAN_CONFIG.MM_TOKENS.includes(token)) continue;

        const thresholds = MM_ALERT_THRESHOLDS[token];
        const value = this.findValue(match, message) || thresholds?.min1hFlow || 50000;

        // Sprawdź czy wartość przekracza próg
        if (thresholds && value < thresholds.min1hFlow) {
          console.log(`[AlertParser] MM Bot SM Accumulation ${token}: $${value.toFixed(0)} < threshold $${thresholds.min1hFlow} - IGNORED`);
          continue;
        }

        const chain = thresholds?.chain || this.extractChain(message);

        // Oblicz siłę sygnału: 2x+ powyżej progu = STRONG
        const thresholdRatio = thresholds ? value / thresholds.min1hFlow : 1;
        const signalStrength = thresholdRatio >= 2 ? 'STRONG' : thresholdRatio >= 1.5 ? 'MODERATE' : 'NORMAL';

        console.log(`✅ [AlertParser] MM Bot SM Accumulation: ${token} $${(value/1000).toFixed(0)}K on ${chain} - ${signalStrength} SIGNAL! (${thresholdRatio.toFixed(1)}x threshold)`);

        // Update signal state
        updateSignalState(token, 'SM_ACCUMULATION', { value_usd: value, chain, signalStrength, thresholdRatio });

        return {
          id: this.generateId(),
          name: 'MM Bot SM Accumulation ' + token,
          token: token.toUpperCase(),
          chain: chain,
          timestamp: new Date(),
          type: 'SM_ACCUMULATION',
          data: {
            value_usd: value,
            direction: 'inflow',
            source: 'mm-bot-nansen',
            is_significant: true,
            signal_strength: signalStrength,
            threshold_ratio: thresholdRatio,
            thresholds: thresholds,
          }
        };
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // MM BOT: AI TREND REVERSAL ALERTS
  // Format: "MM Bot: VIRTUAL AI Trend Reversal" lub podobne
  // Wykrywa zmianę trendu przez AI - fresh wallets, SM flow, top holders
  // ═══════════════════════════════════════════════════════════════
  private parseMmBotAiTrendReversal(message: string): NansenAlert | null {
    // Wzorce dla alertów AI Trend Reversal z Nansen
    const patterns = [
      /MM\s*Bot[:\s]+(\w+)\s*[-–—]?\s*AI\s*(?:Trend\s*)?Reversal/i,  // Handle dash variants
      /(\w+)\s*[-–—]?\s*AI\s*(?:Trend\s*)?(?:Reversal|Signal)/i,      // Handle dash variants
      /AI\s*(?:Trend\s*)?Reversal.*?(\w+)/i,                          // AI Trend Reversal ... TOKEN
      /AI\s*Signal.*?(\w+).*?(fresh.?wallet|sm.?flow|top.?holder)/i,
      /🔵.*?AI.*?(?:Trend|Reversal).*?(\w+)/i,
      /(\w+).*?(?:fresh.?wallet|new.?wallet).*?(?:accumulation|inflow)/i,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        const token = this.findToken(match, message);
        if (!token || !CONTRARIAN_CONFIG.MM_TOKENS.includes(token)) continue;

        const thresholds = MM_ALERT_THRESHOLDS[token];
        const chain = thresholds?.chain || this.extractChain(message);

        // Wykryj typy sygnałów AI
        const signals: string[] = [];
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes('fresh') || lowerMsg.includes('new wallet')) signals.push('fresh-wallet');
        if (lowerMsg.includes('sm') || lowerMsg.includes('smart money')) signals.push('sm-flow');
        if (lowerMsg.includes('top holder') || lowerMsg.includes('top-holder')) signals.push('top-holder-changes');
        if (lowerMsg.includes('dex')) signals.push('dex-flow');

        if (signals.length === 0) signals.push('ai-signal');

        console.log(`✅ [AlertParser] MM Bot AI Trend Reversal: ${token} on ${chain} - Signals: ${signals.join(', ')}`);

        // Update signal state
        updateSignalState(token, 'AI_TREND_REVERSAL', { signals, chain });

        return {
          id: this.generateId(),
          name: 'MM Bot AI Trend Reversal ' + token,
          token: token.toUpperCase(),
          chain: chain,
          timestamp: new Date(),
          type: 'MOMENTUM_LONG',  // AI Trend Reversal = bullish momentum
          data: {
            signals: signals,
            direction: 'reversal',
            source: 'mm-bot-nansen-ai',
            is_significant: true,
            thresholds: thresholds,
          }
        };
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // SM SHORT OPEN - Real-time from sm_short_monitor via Nansen API
  // Format: "🔴 SM SHORT OPEN: LIT - Smart Money opened $50k SHORT at $1.234 | Trader: Smart HL Perps Trader"
  // High priority - direct SM position opens on Hyperliquid perps
  // ═══════════════════════════════════════════════════════════════
  private parseSmShortOpen(message: string): NansenAlert | null {
    const patterns = [
      /SM\s*SHORT\s*OPEN[:\s]+(\w+)\s*[-–—]?\s*Smart\s*Money\s*opened\s*\$([0-9,.]+[KMk]?)\s*SHORT\s*at\s*\$([0-9,.]+)/i,
      /🔴.*?SM\s*SHORT\s*OPEN[:\s]+(\w+).*?\$([0-9,.]+[KMk]?)\s*SHORT/i,
      /SM\s*SHORT\s*OPEN[:\s]+(\w+)/i,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        const token = match[1]?.toUpperCase();
        if (!token) continue;

        // Check if it's a watched token
        if (!CONTRARIAN_CONFIG.MM_TOKENS.includes(token) &&
            !['BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'DOGE'].includes(token)) {
          console.log(`[AlertParser] SM SHORT OPEN ${token}: Not in watched tokens - IGNORED`);
          continue;
        }

        const value = match[2] ? this.parseValue(match[2]) : 50000;
        const entryPrice = match[3] ? parseFloat(match[3]) : 0;

        // Extract trader label
        const traderMatch = message.match(/Trader[:\s]+(.+?)(?:\s*$|\s*\|)/i);
        const traderLabel = traderMatch ? traderMatch[1].trim() : 'Unknown SM';

        console.log(`🔻 [AlertParser] SM SHORT OPEN: ${token} $${(value/1000).toFixed(1)}K at $${entryPrice.toFixed(4)} by ${traderLabel}`);

        return {
          id: this.generateId(),
          name: 'SM SHORT OPEN ' + token,
          token: token,
          chain: 'hyperliquid',
          timestamp: new Date(),
          type: 'SM_POSITION_CHANGE',
          data: {
            side: 'short',
            action: 'open',
            value_usd: value,
            entry_price: entryPrice,
            trader_label: traderLabel,
            source: 'sm_short_monitor',
            is_significant: true,
            is_sm_signal: true,
          }
        };
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // SM LONG OPEN - Real-time from sm_short_monitor via Nansen API
  // Format: "🟢 SM LONG OPEN: LIT - Smart Money opened $100k LONG at $1.234 | Trader: Fund"
  // High priority - direct SM position opens on Hyperliquid perps
  // ═══════════════════════════════════════════════════════════════
  private parseSmLongOpen(message: string): NansenAlert | null {
    const patterns = [
      /SM\s*LONG\s*OPEN[:\s]+(\w+)\s*[-–—]?\s*Smart\s*Money\s*opened\s*\$([0-9,.]+[KMk]?)\s*LONG\s*at\s*\$([0-9,.]+)/i,
      /🟢.*?SM\s*LONG\s*OPEN[:\s]+(\w+).*?\$([0-9,.]+[KMk]?)\s*LONG/i,
      /SM\s*LONG\s*OPEN[:\s]+(\w+)/i,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        const token = match[1]?.toUpperCase();
        if (!token) continue;

        // Check if it's a watched token
        if (!CONTRARIAN_CONFIG.MM_TOKENS.includes(token) &&
            !['BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'DOGE'].includes(token)) {
          console.log(`[AlertParser] SM LONG OPEN ${token}: Not in watched tokens - IGNORED`);
          continue;
        }

        const value = match[2] ? this.parseValue(match[2]) : 50000;
        const entryPrice = match[3] ? parseFloat(match[3]) : 0;

        // Extract trader label
        const traderMatch = message.match(/Trader[:\s]+(.+?)(?:\s*$|\s*\|)/i);
        const traderLabel = traderMatch ? traderMatch[1].trim() : 'Unknown SM';

        console.log(`🔺 [AlertParser] SM LONG OPEN: ${token} $${(value/1000).toFixed(1)}K at $${entryPrice.toFixed(4)} by ${traderLabel}`);

        // Update signal state - SM Long = bullish accumulation signal
        updateSignalState(token, 'SM_ACCUMULATION', {
          value_usd: value,
          chain: 'hyperliquid',
          signalStrength: value >= 100000 ? 'STRONG' : 'NORMAL',
          source: 'sm_long_open'
        });

        return {
          id: this.generateId(),
          name: 'SM LONG OPEN ' + token,
          token: token,
          chain: 'hyperliquid',
          timestamp: new Date(),
          type: 'SM_POSITION_CHANGE',
          data: {
            side: 'long',
            action: 'open',
            value_usd: value,
            entry_price: entryPrice,
            trader_label: traderLabel,
            source: 'sm_short_monitor',
            is_significant: true,
            is_sm_signal: true,
          }
        };
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // MM BOT: SM OUTFLOW/DISTRIBUTION ALERTS (STOP MM signal)
  // Wykrywa wyprzedaż przez Smart Money - sygnał do zatrzymania MM
  // ═══════════════════════════════════════════════════════════════
  private parseMmBotSmOutflow(message: string): NansenAlert | null {
    const patterns = [
      /MM\s*Bot[:\s]+(\w+)\s*SM\s*(?:Out[Ff]low|Distribution)/i,
      /(\w+)\s*SM\s*(?:Out[Ff]low|Distribution|Selling)/i,
      /Smart\s*Money\s*(?:Token\s*)?Out[Ff]low.*?(\w+).*?\$([0-9,.]+[KMB]?)/i,
      /🔴.*?SM.*?(?:Out[Ff]low|Distribution).*?(\w+)/i,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        const token = this.findToken(match, message);
        if (!token || !CONTRARIAN_CONFIG.MM_TOKENS.includes(token)) continue;

        const thresholds = MM_ALERT_THRESHOLDS[token];
        const value = this.findValue(match, message) || thresholds?.min1hFlow || 50000;
        const chain = thresholds?.chain || this.extractChain(message);

        // Dla outflow używamy tych samych progów co dla inflow
        if (thresholds && value < thresholds.min1hFlow) {
          console.log(`[AlertParser] MM Bot SM Outflow ${token}: $${value.toFixed(0)} < threshold - IGNORED`);
          continue;
        }

        console.log(`🔴 [AlertParser] MM Bot SM OUTFLOW: ${token} -$${(value/1000).toFixed(0)}K on ${chain} - STOP SIGNAL!`);

        // Update signal state - clear accumulation signal
        const state = loadSignalState();
        if (state[token.toUpperCase()]) {
          state[token.toUpperCase()].lastSmAccumulation = null;  // Clear bullish signal
          state[token.toUpperCase()].combinedSignal = 'RED';
          state[token.toUpperCase()].lastUpdate = new Date().toISOString();
          saveSignalState(state);
        }

        return {
          id: this.generateId(),
          name: 'MM Bot SM Outflow ' + token,
          token: token.toUpperCase(),
          chain: chain,
          timestamp: new Date(),
          type: 'SM_DISTRIBUTION',
          data: {
            value_usd: value,
            direction: 'outflow',
            source: 'mm-bot-nansen',
            is_stop_signal: true,
            thresholds: thresholds,
          }
        };
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // SM TOKEN FLOW - Główny parser dla Contrarian z filtrem wartości
  // Parsuje alerty typu "sm-token-flow" z Nansen
  // ═══════════════════════════════════════════════════════════════
  private parseSmTokenFlow(message: string): NansenAlert | null {
    // Wykryj alerty SM Token Flow
    const smFlowPatterns = [
      /Smart\s*Money\s*(?:Token\s*)?Flow.*?(\w{2,10}).*?\$([0-9,.]+[KMB]?)/i,
      /SM\s*Flow.*?(\w{2,10}).*?\$([0-9,.]+[KMB]?)/i,
      /Token\s*Flow.*?Smart.*?(\w{2,10}).*?\$([0-9,.]+[KMB]?)/i,
      /🎲.*?Contrarian.*?(\w{2,10}).*?SM\s*short\s*\$([0-9,.]+[KMB]?)/i,
    ];

    for (const pattern of smFlowPatterns) {
      const match = message.match(pattern);
      if (match) {
        const token = this.findToken(match, message);
        const value = this.parseValue(match[2] || '0');

        // FILTR: Ignoruj małe ruchy
        if (value < CONTRARIAN_CONFIG.MIN_SM_FLOW_USD) {
          console.log(`[AlertParser] SM Flow ${token}: $${value.toFixed(0)} < min $${CONTRARIAN_CONFIG.MIN_SM_FLOW_USD} - IGNORED`);
          return null;
        }

        // FILTR: Tylko tokeny z aktywną strategią contrarian
        if (token && !CONTRARIAN_CONFIG.CONTRARIAN_TOKENS.includes(token)) {
          console.log(`[AlertParser] SM Flow ${token}: Not in contrarian tokens - IGNORED`);
          return null;
        }

        const side = this.findSide(match, message);
        const direction = message.toLowerCase().includes('outflow') ? 'outflow' : 'inflow';

        if (token) {
          console.log(`✅ [AlertParser] SM Token Flow: ${token} ${side || 'unknown'} $${(value/1000).toFixed(0)}K - SIGNIFICANT!`);

          return {
            id: this.generateId(),
            name: 'SM Token Flow ' + token,
            token: token.toUpperCase(),
            chain: 'hyperliquid',
            timestamp: new Date(),
            type: side === 'short' ? 'SM_DISTRIBUTION' : side === 'long' ? 'SM_ACCUMULATION' : 'WHALE_ACTIVITY',
            data: {
              value_usd: value,
              side: side,
              direction: direction,
              source: 'sm-token-flow',
              is_significant: true,
            }
          };
        }
      }
    }
    return null;
  }

  private parseSmPositionChange(message: string): NansenAlert | null {
    const patterns = [
      /Smart.*?Trader.*?(0x[a-f0-9]{6,})?.*?(Open|Close|Add|Reduce)\s*(SHORT|LONG)\s*(\w+).*?\$([0-9,.]+[KMB]?)/i,
      /TOP\s*SM.*?(0x[a-f0-9]{6,})?.*?(Open|Close|Add|Reduce)?\s*(SHORT|LONG)?\s*(\w+)?/i,
      /Smart\s*Money.*?(\w{2,10}).*?(SHORT|LONG).*?\$([0-9,.]+[KMB]?)/i,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        const token = this.findToken(match, message);
        const side = this.findSide(match, message);
        const action = this.findAction(match, message);
        const value = this.findValue(match, message);
        const address = this.findAddress(match, message);

        if (token && (side || action)) {
          return {
            id: this.generateId(),
            name: ('SM ' + (action || 'activity') + ' ' + (side || '') + ' ' + token).trim(),
            token: token.toUpperCase(),
            chain: 'hyperliquid',
            timestamp: new Date(),
            type: 'SM_POSITION_CHANGE',
            data: {
              address,
              label: this.extractLabel(message),
              value_usd: value,
              action: action as any,
              side: side as any,
            }
          };
        }
      }
    }
    return null;
  }

  private parseWhaleActivity(message: string): NansenAlert | null {
    const pattern = /🐋.*?(SHORT|LONG)\s*(\w+).*?\$([0-9,.]+[KMB]?)(?:.*?PnL.*?\$([0-9,.]+[KMB]?))?/i;
    const match = message.match(pattern);

    if (match) {
      const token = match[2].toUpperCase();
      const value = this.parseValue(match[3]);

      // FILTR: Ignoruj małe pozycje whale dla tokenów contrarian
      if (CONTRARIAN_CONFIG.CONTRARIAN_TOKENS.includes(token) &&
          value < CONTRARIAN_CONFIG.MIN_WHALE_POSITION_USD) {
        console.log(`[AlertParser] Whale ${token}: $${value.toFixed(0)} < min $${CONTRARIAN_CONFIG.MIN_WHALE_POSITION_USD} - IGNORED`);
        return null;
      }

      console.log(`✅ [AlertParser] Whale Activity: ${token} ${match[1]} $${(value/1000).toFixed(0)}K - SIGNIFICANT!`);

      return {
        id: this.generateId(),
        name: 'Whale ' + match[1] + ' ' + token,
        token: token,
        chain: 'hyperliquid',
        timestamp: new Date(),
        type: 'WHALE_ACTIVITY',
        data: {
          side: match[1].toLowerCase() as 'long' | 'short',
          value_usd: value,
          pnl_usd: match[4] ? this.parseValue(match[4]) : undefined,
          address: this.findAddress(null, message),
          is_significant: true,
        }
      };
    }
    return null;
  }

  private parseAccumulationDistribution(message: string): NansenAlert | null {
    const accMatch = message.match(/(\w+)\s*(?:Massive\s*)?Accumulation.*?\+?\$([0-9,.]+[KMB]?)/i);
    if (accMatch) {
      return {
        id: this.generateId(),
        name: 'Accumulation ' + accMatch[1],
        token: accMatch[1].toUpperCase(),
        chain: this.extractChain(message),
        timestamp: new Date(),
        type: 'SM_ACCUMULATION',
        data: {
          value_usd: this.parseValue(accMatch[2]),
          direction: 'inflow',
          timeframe: this.extractTimeframe(message),
        }
      };
    }

    const distMatch = message.match(/(\w+)\s*Distribution.*?-?\$([0-9,.]+[KMB]?)/i);
    if (distMatch) {
      return {
        id: this.generateId(),
        name: 'Distribution ' + distMatch[1],
        token: distMatch[1].toUpperCase(),
        chain: this.extractChain(message),
        timestamp: new Date(),
        type: 'SM_DISTRIBUTION',
        data: {
          value_usd: this.parseValue(distMatch[2]),
          direction: 'outflow',
          timeframe: this.extractTimeframe(message),
        }
      };
    }
    return null;
  }

  private parseFlashSignal(message: string): NansenAlert | null {
    const buyMatch = message.match(/(\w+)\s*Flash\s*Buy.*?\$([0-9,.]+[KMB]?)/i);
    if (buyMatch) {
      return {
        id: this.generateId(),
        name: 'Flash Buy ' + buyMatch[1],
        token: buyMatch[1].toUpperCase(),
        chain: this.extractChain(message),
        timestamp: new Date(),
        type: 'FLASH_BUY',
        data: {
          value_usd: this.parseValue(buyMatch[2]),
          direction: 'inflow',
        }
      };
    }

    const dumpMatch = message.match(/(\w+)\s*Flash\s*Dump.*?\$([0-9,.]+[KMB]?)/i);
    if (dumpMatch) {
      return {
        id: this.generateId(),
        name: 'Flash Dump ' + dumpMatch[1],
        token: dumpMatch[1].toUpperCase(),
        chain: this.extractChain(message),
        timestamp: new Date(),
        type: 'FLASH_DUMP',
        data: {
          value_usd: this.parseValue(dumpMatch[2]),
          direction: 'outflow',
        }
      };
    }
    return null;
  }

  private parseCexFlow(message: string): NansenAlert | null {
    const depositMatch = message.match(/(\w+)\s*CEX\s*Deposit.*?\$([0-9,.]+[KMB]?)/i);
    if (depositMatch) {
      return {
        id: this.generateId(),
        name: 'CEX Deposit ' + depositMatch[1],
        token: depositMatch[1].toUpperCase(),
        chain: this.extractChain(message),
        timestamp: new Date(),
        type: 'CEX_DEPOSIT',
        data: {
          value_usd: this.parseValue(depositMatch[2]),
          direction: 'outflow',
        }
      };
    }

    const withdrawMatch = message.match(/(\w+)\s*CEX\s*Withdrawal.*?\$([0-9,.]+[KMB]?)/i);
    if (withdrawMatch) {
      return {
        id: this.generateId(),
        name: 'CEX Withdrawal ' + withdrawMatch[1],
        token: withdrawMatch[1].toUpperCase(),
        chain: this.extractChain(message),
        timestamp: new Date(),
        type: 'CEX_WITHDRAWAL',
        data: {
          value_usd: this.parseValue(withdrawMatch[2]),
          direction: 'inflow',
        }
      };
    }
    return null;
  }

  private parseMomentum(message: string): NansenAlert | null {
    const longMatch = message.match(/(\w+).*?(?:Momentum|Strong).*?LONG/i);
    if (longMatch) {
      return {
        id: this.generateId(),
        name: 'Momentum Long ' + longMatch[1],
        token: longMatch[1].toUpperCase(),
        chain: this.extractChain(message),
        timestamp: new Date(),
        type: 'MOMENTUM_LONG',
        data: { side: 'long' }
      };
    }

    const shortMatch = message.match(/(\w+).*?(?:Momentum|Strong).*?SHORT/i);
    if (shortMatch) {
      return {
        id: this.generateId(),
        name: 'Momentum Short ' + shortMatch[1],
        token: shortMatch[1].toUpperCase(),
        chain: this.extractChain(message),
        timestamp: new Date(),
        type: 'MOMENTUM_SHORT',
        data: { side: 'short' }
      };
    }
    return null;
  }

  private parseCapitulation(message: string): NansenAlert | null {
    const match = message.match(/(\w+)\s*Capitulation.*?(?:outflow.*?\$([0-9,.]+[KMB]?))?/i);
    if (match) {
      return {
        id: this.generateId(),
        name: 'Capitulation ' + match[1],
        token: match[1].toUpperCase(),
        chain: this.extractChain(message),
        timestamp: new Date(),
        type: 'CAPITULATION',
        data: {
          value_usd: match[2] ? this.parseValue(match[2]) : undefined,
          direction: 'outflow',
        }
      };
    }
    return null;
  }

  private findToken(match: RegExpMatchArray | null, message: string): string | null {
    if (match) {
      for (const group of match) {
        if (group && /^[A-Z]{2,10}$/i.test(group) && 
            !['SHORT', 'LONG', 'OPEN', 'CLOSE', 'ADD', 'REDUCE'].includes(group.toUpperCase())) {
          return group.toUpperCase();
        }
      }
    }
    const knownTokens = ['LIT', 'FARTCOIN', 'VIRTUAL', 'ETH', 'BTC', 'SOL', 'HYPE', 'XRP', 'DOGE', 'PUMP', 'WIF', 'SUI', 'PEPE', 'ZEC'];
    for (const token of knownTokens) {
      if (message.toUpperCase().includes(token)) {
        return token;
      }
    }
    return null;
  }

  private findSide(match: RegExpMatchArray | null, message: string): 'long' | 'short' | null {
    const lower = message.toLowerCase();
    if (lower.includes('short')) return 'short';
    if (lower.includes('long')) return 'long';
    return null;
  }

  private findAction(match: RegExpMatchArray | null, message: string): string | null {
    const lower = message.toLowerCase();
    if (lower.includes('open')) return 'open';
    if (lower.includes('close')) return 'close';
    if (lower.includes('add')) return 'add';
    if (lower.includes('reduce')) return 'reduce';
    return null;
  }

  private findValue(match: RegExpMatchArray | null, message: string): number {
    if (match) {
      for (const group of match) {
        if (group && /^[0-9,.]+[KkMmBb]?$/.test(group)) {
          return this.parseValue(group);
        }
      }
    }
    // Match values like $5.2k, $100K, $1.5M, $2B (case-insensitive)
    const valueMatch = message.match(/\$([0-9,.]+[KkMmBb]?)/i);
    if (valueMatch) {
      return this.parseValue(valueMatch[1]);
    }
    return 0;
  }

  private findAddress(match: RegExpMatchArray | null, message: string): string | undefined {
    const addrMatch = message.match(/0x[a-fA-F0-9]{6,40}/);
    return addrMatch ? addrMatch[0].toLowerCase() : undefined;
  }

  private parseValue(value: string): number {
    const num = parseFloat(value.replace(/[,$]/g, ''));
    if (value.toUpperCase().includes('B')) return num * 1_000_000_000;
    if (value.toUpperCase().includes('M')) return num * 1_000_000;
    if (value.toUpperCase().includes('K')) return num * 1_000;
    return num;
  }

  private extractChain(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes('hyperliquid') || lower.includes(' hl ') || lower.includes('perp')) return 'hyperliquid';
    if (lower.includes('ethereum')) return 'ethereum';
    if (lower.includes('solana')) return 'solana';
    return 'hyperliquid';
  }

  private extractTimeframe(message: string): '1h' | '24h' | '7d' {
    if (message.includes('7d') || message.includes('7 day')) return '7d';
    if (message.includes('1h') || message.includes('1 hour')) return '1h';
    return '24h';
  }

  private extractLabel(message: string): string | undefined {
    const match = message.match(/(Smart\s*(?:HL\s*)?(?:Perps\s*)?Trader|TOP\s*SM|Wintermute|Manifold|Selini|Galaxy)/i);
    return match ? match[0] : undefined;
  }

  private generateId(): string {
    return 'alert_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  private logAlert(alert: NansenAlert): void {
    try {
      let logs: NansenAlert[] = [];
      if (existsSync(ALERT_LOG_FILE)) {
        logs = JSON.parse(readFileSync(ALERT_LOG_FILE, 'utf8'));
      }
      logs.push(alert);
      if (logs.length > 100) logs = logs.slice(-100);
      writeFileSync(ALERT_LOG_FILE, JSON.stringify(logs, null, 2));
    } catch (e) {}
  }
}

export const alertParser = new NansenAlertParserV2();

// ═══════════════════════════════════════════════════════════════
// EXPORT: MM Signal Functions (already exported above with 'export function')
// Additional exports:
// ═══════════════════════════════════════════════════════════════
export { MM_ALERT_THRESHOLDS };
export type { MMSignalState };
