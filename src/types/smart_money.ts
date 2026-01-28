export interface SmartMoneyEntry {
  bias?: number
  flow?: number
  trend?: string
  trend_strength?: string
  momentum?: number
  velocity?: number
  flow_change_7d?: number
  current_longs_usd?: number
  current_shorts_usd?: number
  longs_upnl?: number
  shorts_upnl?: number
  signal?: string
  top_traders_pnl?: string
  marketData?: any

  // ============================================================
  // SM REVERSAL DETECTION FIELDS (24h position changes)
  // Used for automatic blocking when SM closes positions en masse
  // ============================================================
  longs_count?: number                  // Current number of SM longs
  shorts_count?: number                 // Current number of SM shorts
  longs_count_change_24h?: number       // Change in long count (negative = closing)
  shorts_count_change_24h?: number      // Change in short count (negative = closing)
  longs_upnl_change_24h?: number        // Change in longs unrealized PnL
  shorts_upnl_change_24h?: number       // Change in shorts unrealized PnL
  longs_usd_change_24h?: number         // Change in longs USD value (negative = reducing)
  shorts_usd_change_24h?: number        // Change in shorts USD value (negative = reducing)
  new_long_positions_24h?: number       // New long positions opened
  new_short_positions_24h?: number      // New short positions opened
  closed_long_positions_24h?: number    // Long positions closed
  closed_short_positions_24h?: number   // Short positions closed

  // ============================================================
  // TRADING MODE (from whale_tracker.py determine_trading_mode)
  // Includes "Stale PnL" momentum protection
  // ============================================================
  trading_mode?: string                   // FOLLOW_SM_SHORT, FOLLOW_SM_LONG, CONTRARIAN_*, NEUTRAL
  trading_mode_confidence?: number        // 0-100 (ALREADY includes momentum penalty!)
  max_position_multiplier?: number        // 0.0-1.0 (based on confidence)

  // On-chain data (CEX + Whale flows)
  onchain?: {
    whale_net_flow_24h?: number      // Whale accumulation (+) / distribution (-)
    cex_net_flow_24h?: number        // CEX inflow (+) = sell pressure / outflow (-) = accumulation
    fresh_wallet_inflow_24h?: number // Fresh wallet activity (retail FOMO indicator)
    whale_balance_change_7d_pct?: number // % change in whale holdings
    timestamp?: string
  }
}

export interface SmartMoneyFile {
  timestamp: string
  source?: string
  data: Record<string, SmartMoneyEntry>
}



