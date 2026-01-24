/**
 * Nansen Alert Types - Full Integration
 * 2026-01-24
 */

export type AlertType = 
  | 'SM_ACCUMULATION'
  | 'SM_DISTRIBUTION'
  | 'FLASH_BUY'
  | 'FLASH_DUMP'
  | 'CEX_DEPOSIT'
  | 'CEX_WITHDRAWAL'
  | 'WHALE_ACTIVITY'
  | 'MOMENTUM_LONG'
  | 'MOMENTUM_SHORT'
  | 'SM_POSITION_CHANGE'
  | 'CAPITULATION'
  | 'POTENTIAL_BOTTOM';

export type TradingAction = 
  | 'OPEN_LONG'
  | 'OPEN_SHORT'
  | 'CLOSE_LONG'
  | 'CLOSE_SHORT'
  | 'HOLD'
  | 'REDUCE_POSITION'
  | 'INCREASE_POSITION'
  | 'LOCK_BIDS'
  | 'LOCK_ASKS'
  | 'UNLOCK_ALL';

export interface NansenAlert {
  id: string;
  name: string;
  token: string;
  chain: string;
  timestamp: Date;
  type: AlertType;
  data: {
    address?: string;
    label?: string;
    value_usd?: number;
    direction?: 'inflow' | 'outflow';
    timeframe?: '1h' | '24h' | '7d';
    action?: 'buy' | 'sell' | 'open' | 'close' | 'add' | 'reduce';
    side?: 'long' | 'short';
    entry_price?: number;
    pnl_usd?: number;
  };
}

export interface BotState {
  token: string;
  position: {
    side: 'long' | 'short' | 'none';
    size: number;
    entry_price: number;
    unrealized_pnl: number;
  };
  mode: 'MM' | 'FOLLOW_SM' | 'HOLD_FOR_TP';
  skew: number;
  bid_locked: boolean;
  ask_locked: boolean;
  last_alert: NansenAlert | null;
}

export interface SMPosition {
  address: string;
  label: string;
  side: 'long' | 'short';
  size_usd: number;
  entry_price: number;
  pnl_usd: number;
  last_action: 'open' | 'close' | 'add' | 'reduce';
  last_action_time: Date;
}

export interface TradingDecision {
  action: TradingAction;
  reason: string;
  confidence: number;
  suggested_size?: number;
  suggested_price?: number;
  override_hold_for_tp?: boolean;
}

export interface MMConfig {
  min_tp_percent: number;
  sm_close_override_usd: number;
  max_position_usd: number;
  default_leverage: number;
  spread_percent: number;
  rebalance_threshold: number;
}
