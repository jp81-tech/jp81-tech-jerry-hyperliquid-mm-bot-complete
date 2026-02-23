/**
 * Nansen Alert Integration Service
 * Connects alert parser and trading logic with MM bot
 * 2026-01-24
 */

import { NansenAlertParserV2, alertParser, getMMSignalForToken, getMMSignalState, MMSignalState } from './nansen_alert_parser_v2.js';
import { TradingLogicEngine, tradingLogic } from './trading_logic_engine.js';
import { NansenAlert, BotState, TradingDecision, TradingAction } from '../types/nansen_alerts.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const STATE_FILE = '/tmp/nansen_alert_integration_state.json';
const DECISION_LOG_FILE = '/tmp/nansen_trading_decisions.json';

export interface IntegrationState {
  last_alert: NansenAlert | null;
  last_decision: TradingDecision | null;
  active_locks: {
    bid_locked: boolean;
    ask_locked: boolean;
    locked_at: string | null;
    locked_reason: string | null;
  };
  token_states: Record<string, {
    mode: 'MM' | 'FOLLOW_SM' | 'HOLD_FOR_TP';
    position_side: 'long' | 'short' | 'none';
    position_size: number;
    entry_price: number;
    unrealized_pnl: number;
    skew: number;
  }>;
}

export class NansenAlertIntegration {
  private parser: NansenAlertParserV2;
  private engine: TradingLogicEngine;
  private state: IntegrationState;

  constructor() {
    this.parser = alertParser;
    this.engine = tradingLogic;
    this.state = this.loadState();
  }

  // ═══════════════════════════════════════════════════════════════
  // GŁÓWNA METODA - Przetwórz alert i zwróć decyzję
  // ═══════════════════════════════════════════════════════════════
  processAlertMessage(message: string, token: string): TradingDecision | null {
    // 1. Parsuj alert
    const alert = this.parser.parseMessage(message);
    if (!alert) {
      console.log('[NansenIntegration] Could not parse message');
      return null;
    }

    // 2. Sprawdź czy alert dotyczy naszego tokena
    if (alert.token !== token.toUpperCase()) {
      console.log('[NansenIntegration] Alert for ' + alert.token + ', we trade ' + token);
      return null;
    }

    // 3. Pobierz stan bota dla tokena
    const botState = this.getBotState(token);
    if (!botState) {
      console.log('[NansenIntegration] No bot state for ' + token);
      return null;
    }

    // 4. Wygeneruj decyzję
    const decision = this.engine.processAlert(alert, botState);
    
    // 5. Zapisz stan
    this.state.last_alert = alert;
    this.state.last_decision = decision;
    this.saveState();
    this.logDecision(alert, decision);

    console.log('[NansenIntegration] ' + token + ': ' + decision.action + ' (' + decision.confidence + '%) - ' + decision.reason);

    return decision;
  }

  // ═══════════════════════════════════════════════════════════════
  // METODY DLA MM BOTA
  // ═══════════════════════════════════════════════════════════════

  /**
   * Sprawdź czy bidy powinny być zablokowane
   */
  shouldLockBids(token: string): { locked: boolean; reason: string } {
    const tokenState = this.state.token_states[token.toUpperCase()];
    
    // Sprawdź ostatnią decyzję
    if (this.state.last_decision && this.state.last_alert?.token === token.toUpperCase()) {
      if (this.state.last_decision.action === 'LOCK_BIDS') {
        return { locked: true, reason: this.state.last_decision.reason };
      }
    }

    // Sprawdź aktywne locki
    if (this.state.active_locks.bid_locked) {
      return { locked: true, reason: this.state.active_locks.locked_reason || 'Active bid lock' };
    }

    return { locked: false, reason: '' };
  }

  /**
   * Sprawdź czy aski powinny być zablokowane
   */
  shouldLockAsks(token: string): { locked: boolean; reason: string } {
    const tokenState = this.state.token_states[token.toUpperCase()];
    
    if (this.state.last_decision && this.state.last_alert?.token === token.toUpperCase()) {
      if (this.state.last_decision.action === 'LOCK_ASKS') {
        return { locked: true, reason: this.state.last_decision.reason };
      }
    }

    if (this.state.active_locks.ask_locked) {
      return { locked: true, reason: this.state.active_locks.locked_reason || 'Active ask lock' };
    }

    return { locked: false, reason: '' };
  }

  /**
   * Sprawdź czy pozycja powinna być zamknięta
   */
  shouldClosePosition(token: string): { close: boolean; reason: string } {
    if (this.state.last_decision && this.state.last_alert?.token === token.toUpperCase()) {
      const action = this.state.last_decision.action;
      if (action === 'CLOSE_LONG' || action === 'CLOSE_SHORT') {
        return { close: true, reason: this.state.last_decision.reason };
      }
    }
    return { close: false, reason: '' };
  }

  /**
   * Aktualizuj stan tokena (wywoływane przez MM bota)
   */
  updateTokenState(
    token: string, 
    mode: 'MM' | 'FOLLOW_SM' | 'HOLD_FOR_TP',
    positionSide: 'long' | 'short' | 'none',
    positionSize: number,
    entryPrice: number,
    unrealizedPnl: number,
    skew: number
  ): void {
    this.state.token_states[token.toUpperCase()] = {
      mode,
      position_side: positionSide,
      position_size: positionSize,
      entry_price: entryPrice,
      unrealized_pnl: unrealizedPnl,
      skew
    };
    this.saveState();
  }

  /**
   * Ustaw lock na bidy/aski
   */
  setLock(type: 'bid' | 'ask' | 'both' | 'none', reason: string): void {
    if (type === 'bid' || type === 'both') {
      this.state.active_locks.bid_locked = true;
    }
    if (type === 'ask' || type === 'both') {
      this.state.active_locks.ask_locked = true;
    }
    if (type === 'none') {
      this.state.active_locks.bid_locked = false;
      this.state.active_locks.ask_locked = false;
    }
    this.state.active_locks.locked_at = new Date().toISOString();
    this.state.active_locks.locked_reason = reason;
    this.saveState();
  }

  /**
   * Zwolnij locki (po 30 minutach lub ręcznie)
   */
  releaseLocks(): void {
    this.state.active_locks.bid_locked = false;
    this.state.active_locks.ask_locked = false;
    this.state.active_locks.locked_reason = null;
    this.saveState();
    console.log('[NansenIntegration] Locks released');
  }

  /**
   * Automatyczne zwalnianie locków po czasie
   */
  autoReleaseLocks(maxMinutes: number = 30): void {
    if (!this.state.active_locks.locked_at) return;
    
    const lockedAt = new Date(this.state.active_locks.locked_at).getTime();
    const now = Date.now();
    const minutesLocked = (now - lockedAt) / (1000 * 60);
    
    if (minutesLocked >= maxMinutes) {
      console.log('[NansenIntegration] Auto-releasing locks after ' + minutesLocked.toFixed(0) + ' minutes');
      this.releaseLocks();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // KONFIGURACJA
  // ═══════════════════════════════════════════════════════════════

  setMinTpPercent(percent: number): void {
    this.engine.setMinTpPercent(percent);
  }

  setSmCloseOverride(usd: number): void {
    this.engine.setSmCloseOverride(usd);
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════

  private getBotState(token: string): BotState | null {
    const tokenState = this.state.token_states[token.toUpperCase()];
    if (!tokenState) {
      // Zwróć domyślny stan
      return {
        token: token.toUpperCase(),
        position: {
          side: 'none',
          size: 0,
          entry_price: 0,
          unrealized_pnl: 0,
        },
        mode: 'FOLLOW_SM',
        skew: 0,
        bid_locked: false,
        ask_locked: false,
        last_alert: null,
      };
    }

    return {
      token: token.toUpperCase(),
      position: {
        side: tokenState.position_side,
        size: tokenState.position_size,
        entry_price: tokenState.entry_price,
        unrealized_pnl: tokenState.unrealized_pnl,
      },
      mode: tokenState.mode,
      skew: tokenState.skew,
      bid_locked: this.state.active_locks.bid_locked,
      ask_locked: this.state.active_locks.ask_locked,
      last_alert: this.state.last_alert,
    };
  }

  private loadState(): IntegrationState {
    try {
      if (existsSync(STATE_FILE)) {
        return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
      }
    } catch (e) {}
    
    return {
      last_alert: null,
      last_decision: null,
      active_locks: {
        bid_locked: false,
        ask_locked: false,
        locked_at: null,
        locked_reason: null,
      },
      token_states: {}
    };
  }

  private saveState(): void {
    try {
      writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (e) {}
  }

  private logDecision(alert: NansenAlert, decision: TradingDecision): void {
    try {
      let logs: any[] = [];
      if (existsSync(DECISION_LOG_FILE)) {
        logs = JSON.parse(readFileSync(DECISION_LOG_FILE, 'utf8'));
      }
      logs.push({
        timestamp: new Date().toISOString(),
        alert: {
          type: alert.type,
          token: alert.token,
          data: alert.data,
        },
        decision: {
          action: decision.action,
          reason: decision.reason,
          confidence: decision.confidence,
        }
      });
      if (logs.length > 200) logs = logs.slice(-200);
      writeFileSync(DECISION_LOG_FILE, JSON.stringify(logs, null, 2));
    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════
  // STATUS
  // ═══════════════════════════════════════════════════════════════

  getStatus(): string {
    const lines = ['=== Nansen Alert Integration Status ==='];
    
    lines.push('\nActive Locks:');
    lines.push('  Bids: ' + (this.state.active_locks.bid_locked ? 'LOCKED' : 'unlocked'));
    lines.push('  Asks: ' + (this.state.active_locks.ask_locked ? 'LOCKED' : 'unlocked'));
    if (this.state.active_locks.locked_reason) {
      lines.push('  Reason: ' + this.state.active_locks.locked_reason);
    }
    
    if (this.state.last_alert) {
      lines.push('\nLast Alert:');
      lines.push('  Type: ' + this.state.last_alert.type);
      lines.push('  Token: ' + this.state.last_alert.token);
      lines.push('  Time: ' + this.state.last_alert.timestamp);
    }
    
    if (this.state.last_decision) {
      lines.push('\nLast Decision:');
      lines.push('  Action: ' + this.state.last_decision.action);
      lines.push('  Confidence: ' + this.state.last_decision.confidence + '%');
      lines.push('  Reason: ' + this.state.last_decision.reason);
    }

    const tokens = Object.keys(this.state.token_states);
    if (tokens.length > 0) {
      lines.push('\nToken States:');
      for (const token of tokens) {
        const ts = this.state.token_states[token];
        lines.push('  ' + token + ': ' + ts.mode + ' | ' + ts.position_side + ' ' + ts.position_size + ' @ $' + ts.entry_price.toFixed(2));
      }
    }

    return lines.join('\n');
  }
}

// Export singleton
export const nansenIntegration = new NansenAlertIntegration();

// Export funkcje pomocnicze do użycia w MM bocie
export function processNansenAlert(message: string, token: string): TradingDecision | null {
  return nansenIntegration.processAlertMessage(message, token);
}

export function shouldBlockBids(token: string): { locked: boolean; reason: string } {
  nansenIntegration.autoReleaseLocks(30); // Auto-release after 30 min
  return nansenIntegration.shouldLockBids(token);
}

export function shouldBlockAsks(token: string): { locked: boolean; reason: string } {
  nansenIntegration.autoReleaseLocks(30);
  return nansenIntegration.shouldLockAsks(token);
}

export function updateBotState(
  token: string,
  mode: 'MM' | 'FOLLOW_SM' | 'HOLD_FOR_TP',
  positionSide: 'long' | 'short' | 'none',
  positionSize: number,
  entryPrice: number,
  unrealizedPnl: number,
  skew: number
): void {
  nansenIntegration.updateTokenState(token, mode, positionSide, positionSize, entryPrice, unrealizedPnl, skew);
}

// ═══════════════════════════════════════════════════════════════
// MM SIGNAL FUNCTIONS - Decyzje o uruchomieniu/zatrzymaniu MM
// ═══════════════════════════════════════════════════════════════

/**
 * Pobierz sygnał MM dla tokena
 * @returns 'GREEN' = start MM, 'YELLOW' = ostrożność, 'RED' = stop MM, 'NONE' = brak danych
 */
export function getMMTradingSignal(token: string): 'GREEN' | 'YELLOW' | 'RED' | 'NONE' {
  return getMMSignalForToken(token);
}

/**
 * Sprawdź czy można uruchomić MM dla tokena
 * GREEN = SM Accumulation + AI Trend Reversal w ciągu 24h
 */
export function shouldStartMM(token: string): { start: boolean; reason: string; signal: string } {
  const signal = getMMSignalForToken(token);
  const state = getMMSignalState(token);

  if (signal === 'GREEN') {
    return {
      start: true,
      reason: `SM Accumulation + AI Trend Reversal confirmed within 24h`,
      signal: 'GREEN'
    };
  }

  if (signal === 'YELLOW') {
    const hasSm = state?.lastSmAccumulation !== null;
    const hasAi = state?.lastAiTrendReversal !== null;
    return {
      start: false,
      reason: `Partial signal: SM=${hasSm ? 'YES' : 'NO'}, AI=${hasAi ? 'YES' : 'NO'} - wait for confirmation`,
      signal: 'YELLOW'
    };
  }

  if (signal === 'RED') {
    return {
      start: false,
      reason: `No alerts for 48h+ - market inactive`,
      signal: 'RED'
    };
  }

  return {
    start: false,
    reason: `No signal data available`,
    signal: 'NONE'
  };
}

/**
 * Sprawdź czy należy zatrzymać MM dla tokena
 * RED = brak alertów przez 48h+
 */
export function shouldStopMM(token: string): { stop: boolean; reason: string } {
  const signal = getMMSignalForToken(token);

  if (signal === 'RED') {
    return {
      stop: true,
      reason: `No Nansen alerts for 48h+ - stopping MM`
    };
  }

  return {
    stop: false,
    reason: ''
  };
}

/**
 * Pobierz pełny status sygnałów MM dla tokena
 */
export function getMMSignalStatus(token: string): {
  signal: 'GREEN' | 'YELLOW' | 'RED' | 'NONE';
  state: MMSignalState | null;
  recommendation: string;
} {
  const signal = getMMSignalForToken(token);
  const state = getMMSignalState(token);

  let recommendation = '';
  switch (signal) {
    case 'GREEN':
      recommendation = '✅ START MM - SM Accumulation + AI Trend Reversal confirmed';
      break;
    case 'YELLOW':
      recommendation = '⚠️ CAUTION - Partial signal, wait for confirmation';
      break;
    case 'RED':
      recommendation = '🛑 STOP MM - No activity for 48h+';
      break;
    default:
      recommendation = '❓ NO DATA - Waiting for first alert';
  }

  return { signal, state, recommendation };
}
