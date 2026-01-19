/**
 * NansenFeed.ts - TypeScript port of whale_tracker.py data fetching layer
 *
 * Provides real-time Smart Money position tracking from Hyperliquid API
 * with Nansen-verified credibility weighting.
 */

import axios from 'axios'
import { EventEmitter } from 'events'

// ============================================================
// TYPES & INTERFACES
// ============================================================

export interface Position {
  coin: string
  side: 'Long' | 'Short'
  size: number
  entryPrice: number
  unrealizedPnl: number
  liquidationPrice: number
  leverage: number
  positionValue: number
}

export interface AccountState {
  positions: Position[]
  accountValue: number
  timestamp: string
}

export type WhaleTier = 'CONVICTION' | 'FUND' | 'ACTIVE' | 'MARKET_MAKER'

export interface WhaleInfo {
  name: string
  emoji: string
  tier: WhaleTier
  signalWeight: number
  nansenLabel: NansenLabel
  minChange: number
  notes: string
}

export type NansenLabel =
  | 'Smart HL Perps Trader'
  | 'All Time Smart Trader'
  | 'Fund'
  | '90D Smart Trader'
  | '30D Smart Trader'
  | 'Whale'
  | 'Unknown'
  | 'Market Maker'

export interface AggregatedCoinData {
  longs: number
  shorts: number
  longsUpnl: number
  shortsUpnl: number
  longsCount: number
  shortsCount: number
}

export type TradingMode =
  | 'FOLLOW_SM_LONG'
  | 'FOLLOW_SM_SHORT'
  | 'CONTRARIAN_LONG'
  | 'CONTRARIAN_SHORT'
  | 'NEUTRAL'
  | 'BLOCKED'

export interface TradingModeResult {
  mode: TradingMode
  confidence: number
  reason: string
  maxPositionMultiplier: number
  positionRatio: number
  pnlRatio: number
  longValueUsd: number
  shortValueUsd: number
  longPnlUsd: number
  shortPnlUsd: number
  momentumWarning?: string
  divergenceWarning?: string
  squeezeDurationHours?: number
  squeezeFailed?: boolean
}

export interface SmartMoneyData {
  timestamp: string
  source: string
  data: Record<string, CoinSmartMoneyEntry>
}

export interface CoinSmartMoneyEntry {
  bias: number
  signal: 'bullish' | 'bearish' | 'neutral'
  flow: number
  currentLongsUsd: number
  currentShortsUsd: number
  longsUpnl: number
  shortsUpnl: number
  topTradersPnl: 'longs_winning' | 'shorts_winning'
  trend: 'increasing_longs' | 'increasing_shorts' | 'stable' | 'unknown'
  trendStrength: 'strong' | 'moderate' | 'weak'
  momentum: number
  velocity: number
  flowChange7d: number
  longsCount: number
  shortsCount: number
  tradingMode: TradingMode
  tradingModeConfidence: number
  maxPositionMultiplier: number
}

export interface NansenBiasOutput {
  boost: number
  direction: 'long' | 'short' | 'neutral'
  biasStrength: 'strong' | 'moderate' | 'soft'
  buySellPressure: number
  updatedAt: string
  trend: 'increasing_longs' | 'increasing_shorts' | 'stable' | 'unknown'
  trendStrength: 'strong' | 'moderate' | 'weak'
  trendAdjustment: number
  tradingMode: TradingMode
  tradingModeConfidence: number
  tradingModeReason: string
  maxPositionMultiplier: number
  positionRatio: number
  pnlRatio: number
  longValueUsd: number
  shortValueUsd: number
  longPnlUsd: number
  shortPnlUsd: number
  momentumWarning?: string
  divergenceWarning?: string
  squeezeDurationHours?: number
  squeezeFailed?: boolean
}

// ============================================================
// CONSTANTS - Ported from whale_tracker.py
// ============================================================

const HL_API_URL = 'https://api.hyperliquid.xyz/info'

/**
 * CREDIBILITY MULTIPLIERS - Whale vs Smart Money
 *
 * KEY INSIGHT: Big position ≠ Smart Money!
 * - Whale: Large position but UNVERIFIED track record
 * - Smart Money: Nansen-labeled with VERIFIED profitable edge
 * - Fund: Institutional player with professional management
 *
 * Final weight = signalWeight (size) × credibilityMultiplier (skill)
 */
export const CREDIBILITY_MULTIPLIERS: Record<NansenLabel, number> = {
  'Smart HL Perps Trader': 1.0,   // Nansen verified - FULL weight
  'All Time Smart Trader': 0.95,  // Nansen verified - Very high
  'Fund': 0.90,                    // Institutional - High weight
  '90D Smart Trader': 0.85,        // Recent track record
  '30D Smart Trader': 0.75,        // Short track record
  'Whale': 0.30,                   // Big but UNVERIFIED - reduced!
  'Unknown': 0.20,                 // No label - minimal weight
  'Market Maker': 0.0,             // IGNORE - they flip constantly
}

/**
 * Quick lookup cache for Nansen-verified addresses
 * Format: address prefix (6-8 chars) -> label
 */
const NANSEN_SM_LABELS: Record<string, NansenLabel> = {
  '0xb317d2': 'Smart HL Perps Trader',  // Bitcoin OG - $717M ETH
  '0xbaae15': 'Smart HL Perps Trader',  // $4.7M FARTCOIN SHORT
  '0xa31211': 'Smart HL Perps Trader',  // $7.4M LIT SHORT
  '0x35d115': 'Smart HL Perps Trader',  // $64.4M SOL SHORT
  '0x45d26f': 'Smart HL Perps Trader',  // $40.5M BTC SHORT
  '0x5d2f44': 'Smart HL Perps Trader',  // $46.3M BTC SHORT
  '0x71dfc0': 'Smart HL Perps Trader',  // $25.4M BTC SHORT
  '0x06cecf': 'Smart HL Perps Trader',  // $11.8M SOL SHORT
  '0x6bea81': 'Smart HL Perps Trader',  // $8.1M SOL SHORT
  '0x936cf4': 'Smart HL Perps Trader',  // $6.6M SOL SHORT
  '0x56cd86': 'Smart HL Perps Trader',  // $3.9M SOL SHORT
  '0xd7a678': 'Smart HL Perps Trader',  // $3.7M SOL SHORT
  '0x519c72': 'Smart HL Perps Trader',  // $6.2M ZEC LONG
  '0x9eec98': 'Smart HL Perps Trader',  // $182.8M ETH LONG
  '0xfeec88': 'Smart HL Perps Trader',  // $22.6M BTC SHORT
  '0xfce053': 'Smart HL Perps Trader',  // $21.7M BTC SHORT
  '0x99b109': 'Smart HL Perps Trader',  // $34.3M BTC SHORT
  '0xea6670': 'Smart HL Perps Trader',  // $9.1M BTC SHORT
  '0x3c363e': 'Smart HL Perps Trader',  // $1.9M ETH SHORT
  '0x2ed5c4': 'Smart HL Perps Trader',  // ASTER trader
  '0x689f15': 'Smart HL Perps Trader',  // BTC trader
  '0x92e977': 'Smart HL Perps Trader',  // BTC/LIT trader
  '0x1e771e': 'Smart HL Perps Trader',  // DOGE/ETH shorter
  '0xa2acb1': 'Smart HL Perps Trader',  // Hikari - $5.6M BTC LONG
  '0x8a0cd1': 'Smart HL Perps Trader',  // $1.6M BTC SHORT
  '0x091159': 'Smart HL Perps Trader',  // LIT trader
  '0x0b2396': 'Smart HL Perps Trader',  // DOGE trader
  '0xcac196': 'Fund',  // Galaxy Digital
  '0x7fdafd': 'Fund',  // Fasanara Capital
  '0x023a3d': 'Fund',  // Auros Global
  '0xecb63c': 'Fund',  // Wintermute
  '0x5b5d51': 'Fund',  // Abraxas Capital
  '0x8def9f': 'All Time Smart Trader',  // Laurent Zeimes
  '0x418aa6': 'Smart HL Perps Trader',  // 58bro.eth
}

/**
 * WHALES tracking list - Full config from whale_tracker.py
 * TIER SYSTEM:
 * - TIER 1 (CONVICTION): signalWeight 0.9-1.0 - Follow closely
 * - TIER 2 (FUND): signalWeight 0.7-0.85 - Institutional money
 * - TIER 3 (ACTIVE): signalWeight 0.5-0.7 - Active traders
 * - TIER 4 (MM): signalWeight 0.0 - IGNORE (market makers)
 */
export const WHALES: Record<string, WhaleInfo> = {
  // ================================================================
  // TIER 1: CONVICTION TRADERS (signalWeight: 0.9-1.0)
  // ================================================================
  '0xb317d2bc2d3d2df5fa441b5bae0ab9d8b07283ae': {
    name: 'Bitcoin OG',
    emoji: '🐋',
    tier: 'CONVICTION',
    signalWeight: 1.0,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.05,
    notes: '$717M ETH LONG, $92M BTC LONG, $68M SOL LONG'
  },
  '0xbaae15f6ffe2aa6e0e9ffde6f1888c8092f4b22a': {
    name: 'SM HL Trader baae15',
    emoji: '🤓',
    tier: 'CONVICTION',
    signalWeight: 0.95,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.05,
    notes: 'BTC/PUMP LONG, FARTCOIN SHORT, $9M+ trades'
  },
  '0xa312114b5795dff9b8db50474dd57701aa78ad1e': {
    name: 'SM Conviction a31211',
    emoji: '🔴',
    tier: 'CONVICTION',
    signalWeight: 1.0,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.05,
    notes: 'Main LIT/DOGE shorter. $7.4M LIT SHORT, $2M DOGE SHORT'
  },
  '0x35d1151ef1aab579cbb3109e69fa82f94ff5acb1': {
    name: 'SM Trader 35d115',
    emoji: '🤓',
    tier: 'CONVICTION',
    signalWeight: 0.95,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.05,
    notes: '$64.3M SOL SHORT (+$8.7M uPnL)'
  },
  '0x5d2f4460ac3514ada79f5d9838916e508ab39bb7': {
    name: 'SM Conviction 5d2f44',
    emoji: '🔴',
    tier: 'CONVICTION',
    signalWeight: 0.95,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.05,
    notes: '$46.3M BTC SHORT (+$19.4M uPnL!)'
  },
  '0x45d26f28196d226497130c4bac709d808fed4029': {
    name: 'SM Conviction 45d26f',
    emoji: '🔴',
    tier: 'CONVICTION',
    signalWeight: 0.9,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.05,
    notes: '$40.5M BTC SHORT, $28.9M ETH SHORT'
  },
  '0x71dfc07de32c2ebf1c4801f4b1c9e40b76d4a23d': {
    name: 'SM Conviction 71dfc0',
    emoji: '🔴',
    tier: 'CONVICTION',
    signalWeight: 0.9,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.05,
    notes: '$25.4M BTC SHORT, $19.8M ETH SHORT'
  },
  '0x06cecfbac34101ae41c88ebc2450f8602b3d164b': {
    name: 'SM Trader 06cecf',
    emoji: '🤓',
    tier: 'CONVICTION',
    signalWeight: 0.85,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.05,
    notes: '$11.8M SOL SHORT (+$3.5M uPnL)'
  },
  '0x6bea81d7a0c5939a5ce5552e125ab57216cc597f': {
    name: 'SM Trader 6bea81',
    emoji: '🤓',
    tier: 'CONVICTION',
    signalWeight: 0.80,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.05,
    notes: '$8.1M SOL SHORT (+$2M uPnL)'
  },
  '0x936cf4fb95c30ce83f658b5bbb247e4bb381bb0f': {
    name: 'SM Trader 936cf4',
    emoji: '🤓',
    tier: 'CONVICTION',
    signalWeight: 0.75,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.05,
    notes: '$6.6M SOL SHORT (+$488k uPnL)'
  },
  '0x519c721de735f7c9e6146d167852e60d60496a47': {
    name: 'SM Conviction 519c72',
    emoji: '🟢',
    tier: 'CONVICTION',
    signalWeight: 0.85,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.05,
    notes: '$6.2M ZEC LONG'
  },
  '0x2ed5c47a79c27c75188af495a8093c22ada4f6e7': {
    name: 'SM HL Trader 2ed5c4',
    emoji: '🤓',
    tier: 'CONVICTION',
    signalWeight: 0.85,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.08,
    notes: 'ASTER LONG $3.8M'
  },
  '0x689f15c9047f73c974e08c70f12a5d6a19f45c15': {
    name: 'SM HL Trader 689f15',
    emoji: '🤓',
    tier: 'CONVICTION',
    signalWeight: 0.85,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.08,
    notes: 'BTC LONG $3.2M'
  },
  '0x3c363e96d22c056d748f199fb728fc80d70e461a': {
    name: 'SM HL Trader 3c363e',
    emoji: '🤓',
    tier: 'CONVICTION',
    signalWeight: 0.80,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.08,
    notes: 'SUI trader'
  },
  '0x56cd86d6ef24a3f51ce6992b7f1db751b0a0276a': {
    name: 'Token Millionaire 56cd86',
    emoji: '🤓',
    tier: 'CONVICTION',
    signalWeight: 0.85,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.08,
    notes: '$3.9M SOL SHORT (+$618k uPnL)'
  },
  '0xd7a678fcf72c1b602850ef2f3e2d668ec41fa0ed': {
    name: 'Consistent Winner d7a678',
    emoji: '🤓',
    tier: 'CONVICTION',
    signalWeight: 0.85,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.08,
    notes: '$3.7M SOL SHORT (+$1.1M uPnL)'
  },
  '0xea6670ebdb4a388a8cfc16f6497bf4f267b061ee': {
    name: 'SM HL Trader ea6670',
    emoji: '🤓',
    tier: 'CONVICTION',
    signalWeight: 0.85,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.08,
    notes: '$9.1M BTC SHORT'
  },
  '0x92e9773ad2b4ba6e2e57e7fc1f9305aef80ab6c2': {
    name: 'SM HL Trader 92e977',
    emoji: '🤓',
    tier: 'CONVICTION',
    signalWeight: 0.80,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.10,
    notes: 'BTC/LIT trader'
  },
  '0x1e771e1b95c86491299d6e2a5c3b3842d03b552e': {
    name: 'SM HL Trader 1e771e',
    emoji: '🤓',
    tier: 'CONVICTION',
    signalWeight: 0.75,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.10,
    notes: 'DOGE/ETH shorter'
  },
  '0xa2acb1c1d689fd3785696277537a504fcea8d1d0': {
    name: 'Hikari',
    emoji: '🟢',
    tier: 'CONVICTION',
    signalWeight: 0.75,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.10,
    notes: '$5.6M BTC LONG'
  },
  '0x8a0cd16a004e21e04936a0a01c6f5a49ff937914': {
    name: 'SM HL Trader 8a0cd1',
    emoji: '🤓',
    tier: 'CONVICTION',
    signalWeight: 0.75,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.10,
    notes: '$1.6M BTC SHORT'
  },
  '0x091159a8106b077c13e89bc09701117e8b5f129a': {
    name: 'SM HL Trader 091159',
    emoji: '🤓',
    tier: 'CONVICTION',
    signalWeight: 0.75,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.10,
    notes: 'LIT trader'
  },
  '0x0b23968e02c549f99ff77b6471be3a78cbfff37b': {
    name: 'SM HL Trader 0b2396',
    emoji: '🤓',
    tier: 'CONVICTION',
    signalWeight: 0.70,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.10,
    notes: 'DOGE trader'
  },

  // ================================================================
  // TIER 2: INSTITUTIONAL / FUNDS (signalWeight: 0.7-0.85)
  // ================================================================
  '0xcac19662ec88d23fa1c81ac0e8570b0cf2ff26b3': {
    name: 'Galaxy Digital',
    emoji: '🏦',
    tier: 'FUND',
    signalWeight: 0.85,
    nansenLabel: 'Fund',
    minChange: 0.05,
    notes: '$34.5M BTC SHORT, $20.9M ETH SHORT'
  },
  '0x8def9f50456c6c4e37fa5d3d57f108ed23992dae': {
    name: 'Laurent Zeimes',
    emoji: '🦈',
    tier: 'FUND',
    signalWeight: 0.8,
    nansenLabel: 'All Time Smart Trader',
    minChange: 0.10,
    notes: 'Known trader, +$391k PnL historically'
  },
  '0xc4241dc9bfeb5126c0766df35a87ed3fbd630c78': {
    name: 'Arrington XRP Capital',
    emoji: '💼',
    tier: 'FUND',
    signalWeight: 0.7,
    nansenLabel: 'Fund',
    minChange: 0.10,
    notes: '$22k SUI LONG'
  },
  '0x418aa6bf98a2b2bc93779f810330d88cde488888': {
    name: '58bro.eth',
    emoji: '🔴',
    tier: 'FUND',
    signalWeight: 0.8,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.05,
    notes: '$10.2M BTC SHORT, $16.4M ETH SHORT'
  },

  // ================================================================
  // TIER 3: ACTIVE TRADERS (signalWeight: 0.5-0.7)
  // ================================================================
  '0x9eec98d048d06d9cd75318fffa3f3960e081daab': {
    name: 'SM Active 9eec98',
    emoji: '🟢',
    tier: 'ACTIVE',
    signalWeight: 0.85, // UPGRADED - $182.8M ETH LONG is massive
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.08,
    notes: '$182.8M ETH LONG'
  },
  '0xfeec88b13fc0be31695069f02bac18538a154e9c': {
    name: 'SM Active feec88',
    emoji: '🔴',
    tier: 'ACTIVE',
    signalWeight: 0.80,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.08,
    notes: '$22.6M BTC SHORT (+$4M)'
  },
  '0xfce053a5e461683454bf37ad66d20344c0e3f4c0': {
    name: 'SM Active fce053',
    emoji: '🔴',
    tier: 'ACTIVE',
    signalWeight: 0.80,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.08,
    notes: '$21.7M BTC SHORT'
  },
  '0x99b1098d9d50aa076f78bd26ab22e6abd3710729': {
    name: 'SM Active 99b109',
    emoji: '🔴',
    tier: 'ACTIVE',
    signalWeight: 0.80,
    nansenLabel: 'Smart HL Perps Trader',
    minChange: 0.08,
    notes: '$34.3M BTC SHORT'
  },
  '0xc7290b4b308431a985fa9e3e8a335c2f7650517c': {
    name: 'SM Active c7290b',
    emoji: '🔴',
    tier: 'ACTIVE',
    signalWeight: 0.65,
    nansenLabel: 'Unknown',
    minChange: 0.10,
    notes: '$11.2M BTC SHORT, $7.3M ETH SHORT'
  },
  '0x570b09e27a87f9acbce49f85056745d29b3ee3c6': {
    name: 'SM Active 570b09',
    emoji: '🔴',
    tier: 'ACTIVE',
    signalWeight: 0.6,
    nansenLabel: 'Unknown',
    minChange: 0.10,
    notes: '$2.6M SOL SHORT, $2.6M BTC SHORT'
  },
  '0x179c17d04be626561b0355a248d6055a80456aa5': {
    name: 'SM Active 179c17',
    emoji: '🔴',
    tier: 'ACTIVE',
    signalWeight: 0.6,
    nansenLabel: 'Unknown',
    minChange: 0.10,
    notes: '$3.1M SOL SHORT'
  },
  '0xbe494a5e3a719a78a45a47ab453b7b0199d9d101': {
    name: 'SM Active be494a',
    emoji: '🔴',
    tier: 'ACTIVE',
    signalWeight: 0.6,
    nansenLabel: 'Unknown',
    minChange: 0.10,
    notes: '$2.8M SOL SHORT'
  },
  '0xe4d83945c0322f3d340203a7129b7eb5cacae847': {
    name: 'SM Active e4d839',
    emoji: '🔴',
    tier: 'ACTIVE',
    signalWeight: 0.6,
    nansenLabel: 'Unknown',
    minChange: 0.10,
    notes: '$2.3M SOL SHORT'
  },
  '0xb1694de2324433778487999bd86b1acb3335ebc4': {
    name: 'SM Active b1694d',
    emoji: '🔴',
    tier: 'ACTIVE',
    signalWeight: 0.55,
    nansenLabel: 'Unknown',
    minChange: 0.15,
    notes: '$1.9M SOL SHORT'
  },
  '0xa4be91acc74feabab71b8878b66b8f5277212520': {
    name: 'SM Active a4be91',
    emoji: '🔴',
    tier: 'ACTIVE',
    signalWeight: 0.55,
    nansenLabel: 'Unknown',
    minChange: 0.15,
    notes: '$1.4M SOL SHORT'
  },
  '0xe2823659be02e0f48a4660e4da008b5e1abfdf29': {
    name: 'SM Active e28236',
    emoji: '🟢',
    tier: 'ACTIVE',
    signalWeight: 0.6,
    nansenLabel: 'Unknown',
    minChange: 0.15,
    notes: '$1.1M ZEC LONG, $1.6M ETH LONG'
  },
  '0x039405fa4636364e6023df1e06b085a462b9cdc9': {
    name: 'SM Active 039405',
    emoji: '🔴',
    tier: 'ACTIVE',
    signalWeight: 0.65,
    nansenLabel: 'Unknown',
    minChange: 0.15,
    notes: '$293k LIT SHORT (+$118k)'
  },
  '0x782e432267376f377585fc78092d998f8442ab83': {
    name: 'SM Active 782e43',
    emoji: '🟡',
    tier: 'ACTIVE',
    signalWeight: 0.5,
    nansenLabel: 'Unknown',
    minChange: 0.15,
    notes: '$3.8M BTC SHORT, $1.3M SOL LONG - mixed'
  },
  '0xdca131ba8f428bd2f90ae962e4cb2d226312505e': {
    name: 'SM Active dca131',
    emoji: '🔴',
    tier: 'ACTIVE',
    signalWeight: 0.55,
    nansenLabel: 'Unknown',
    minChange: 0.15,
    notes: '$2.8M BTC SHORT'
  },
  '0x649156ebf0a350deb18a1e4835873defd4dc5349': {
    name: 'donkstrategy.eth',
    emoji: '🔴',
    tier: 'ACTIVE',
    signalWeight: 0.55,
    nansenLabel: 'Unknown',
    minChange: 0.15,
    notes: '$2.4M BTC SHORT'
  },
  '0x84abc08c0ea62e687c370154de1f38ea462f4d37': {
    name: 'SM Active 84abc0',
    emoji: '🔴',
    tier: 'ACTIVE',
    signalWeight: 0.5,
    nansenLabel: 'Unknown',
    minChange: 0.15,
    notes: '$4.3M ETH SHORT'
  },
  '0xc12f6e6f7a11604871786db86abf33fdf36fb0ad': {
    name: 'SM Active c12f6e',
    emoji: '🔴',
    tier: 'ACTIVE',
    signalWeight: 0.5,
    nansenLabel: 'Unknown',
    minChange: 0.15,
    notes: '$2.5M ETH SHORT'
  },
  '0xdbcc96bcada067864902aad14e029fe7c422f147': {
    name: 'SM Active dbcc96',
    emoji: '🟢',
    tier: 'ACTIVE',
    signalWeight: 0.5,
    nansenLabel: 'Unknown',
    minChange: 0.20,
    notes: '$428k SOL LONG'
  },

  // ================================================================
  // TIER 4: MARKET MAKERS (signalWeight: 0.0 - IGNORE!)
  // ================================================================
  '0x091144e651b334341eabdbbbfed644ad0100023e': {
    name: 'Manifold Trading',
    emoji: '📊',
    tier: 'MARKET_MAKER',
    signalWeight: 0.0,
    nansenLabel: 'Market Maker',
    minChange: 0.50,
    notes: 'IGNORE - Market maker, frequent flips'
  },
  '0x34fb5ec7d4e939161946340ea2a1f29254b893de': {
    name: 'Selini Capital MM1',
    emoji: '📊',
    tier: 'MARKET_MAKER',
    signalWeight: 0.0,
    nansenLabel: 'Market Maker',
    minChange: 0.50,
    notes: 'IGNORE - Market maker'
  },
  '0x621c5551678189b9a6c94d929924c225ff1d63ab': {
    name: 'Selini Capital MM2',
    emoji: '📊',
    tier: 'MARKET_MAKER',
    signalWeight: 0.0,
    nansenLabel: 'Market Maker',
    minChange: 0.50,
    notes: 'IGNORE - Market maker'
  },
}

/** Coins to track */
export const TRACKED_COINS = ['BTC', 'ETH', 'SOL', 'HYPE', 'FARTCOIN', 'XRP', 'DOGE', 'WIF', 'PUMP', 'kPEPE', 'ZEC', 'LIT', 'SUI']

// Thresholds for trading mode determination
const MODE_THRESHOLDS = {
  SHORT_DOMINANT_RATIO: 2.0,    // shorts/longs > 2.0 = SHORT dominant
  LONG_DOMINANT_RATIO: 0.5,     // shorts/longs < 0.5 = LONG dominant
  MIN_TOTAL_USD: 50000,         // Minimum $50k total exposure for signal
  UNDERWATER_THRESHOLD: 0,      // uPnL < 0 = underwater
  PNL_DOMINANT_RATIO: 3.0,      // If PnL ratio > 3.0x, treat as dominant
}

// Confidence to position multiplier mapping
const CONFIDENCE_TO_POSITION_MULT: Array<[number, number, number]> = [
  [90, 100, 1.0],    // 90-100% confidence -> full position
  [75, 90, 0.75],    // 75-90% confidence -> 75% position
  [60, 75, 0.5],     // 60-75% confidence -> 50% position
  [40, 60, 0.25],    // 40-60% confidence -> 25% position
  [0, 40, 0.1],      // <40% confidence -> 10% position
]

// ============================================================
// NansenFeed CLASS
// ============================================================

export class NansenFeed extends EventEmitter {
  private allPositions: Map<string, AccountState> = new Map()
  private aggregatedData: Record<string, AggregatedCoinData> = {}
  private lastUpdateTime: Date | null = null

  constructor() {
    super()
  }

  /**
   * Quick lookup for Nansen label from cached prefixes
   */
  private getNansenLabel(address: string): NansenLabel {
    const addrPrefix = address.toLowerCase().slice(0, 8)
    for (const [prefix, label] of Object.entries(NANSEN_SM_LABELS)) {
      if (addrPrefix.startsWith(prefix.toLowerCase())) {
        return label
      }
    }
    return 'Unknown'
  }

  /**
   * Fetch positions from Hyperliquid API for a single address
   */
  async fetchPosition(address: string): Promise<AccountState> {
    const payload = { type: 'clearinghouseState', user: address }

    try {
      const response = await axios.post(HL_API_URL, payload, { timeout: 10000 })
      const data = response.data

      const positions: Position[] = []
      for (const p of data.assetPositions || []) {
        const pos = p.position
        const size = parseFloat(pos.szi)
        if (size !== 0) {
          const entryPrice = parseFloat(pos.entryPx)
          positions.push({
            coin: pos.coin,
            side: size > 0 ? 'Long' : 'Short',
            size: Math.abs(size),
            entryPrice,
            unrealizedPnl: parseFloat(pos.unrealizedPnl),
            liquidationPrice: parseFloat(pos.liquidationPx || '0'),
            leverage: pos.leverage?.value || 0,
            positionValue: Math.abs(size) * entryPrice
          })
        }
      }

      return {
        positions,
        accountValue: parseFloat(data.marginSummary?.accountValue || '0'),
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      console.error(`[NansenFeed] Error fetching position for ${address.slice(0, 10)}: ${error}`)
      return { positions: [], accountValue: 0, timestamp: new Date().toISOString() }
    }
  }

  /**
   * Fetch all whale positions in parallel
   */
  async fetchAllPositions(): Promise<Map<string, AccountState>> {
    const addresses = Object.keys(WHALES)
    const results = new Map<string, AccountState>()

    // Fetch in batches of 10 to avoid rate limiting
    const batchSize = 10
    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize)
      const promises = batch.map(async (addr) => {
        const state = await this.fetchPosition(addr)
        return { address: addr.toLowerCase(), state }
      })

      const batchResults = await Promise.all(promises)
      for (const { address, state } of batchResults) {
        results.set(address, state)
      }

      // Small delay between batches
      if (i + batchSize < addresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    this.allPositions = results
    this.lastUpdateTime = new Date()
    return results
  }

  /**
   * Aggregate SM positions for each coin WITH WEIGHTING by:
   * - signalWeight (size factor) - how large is the position
   * - credibilityMultiplier (skill factor) - is it Nansen verified
   *
   * Final weight = signalWeight × credibilityMultiplier
   */
  aggregatePositions(allData?: Map<string, AccountState>): Record<string, AggregatedCoinData> {
    const data = allData || this.allPositions
    const aggregated: Record<string, AggregatedCoinData> = {}

    // Initialize for all tracked coins
    for (const coin of TRACKED_COINS) {
      aggregated[coin] = {
        longs: 0,
        shorts: 0,
        longsUpnl: 0,
        shortsUpnl: 0,
        longsCount: 0,
        shortsCount: 0
      }
    }

    data.forEach((accountState, address) => {
      const whaleInfo = WHALES[address.toLowerCase()]
      if (!whaleInfo) return

      // Size factor (0-1)
      const signalWeight = whaleInfo.signalWeight

      // Skill factor (0-1)
      const nansenLabel = whaleInfo.nansenLabel
      const credibility = CREDIBILITY_MULTIPLIERS[nansenLabel] ?? 0.2

      // Final weight = size × credibility
      const finalWeight = signalWeight * credibility

      // Market makers (credibility=0) are ignored
      if (finalWeight === 0) return

      for (const pos of accountState.positions) {
        if (!aggregated[pos.coin]) continue

        // Weight position by finalWeight (size × credibility)
        const value = pos.positionValue * finalWeight
        const upnl = pos.unrealizedPnl * finalWeight

        if (pos.side === 'Long') {
          aggregated[pos.coin].longs += value
          aggregated[pos.coin].longsUpnl += upnl
          aggregated[pos.coin].longsCount += 1
        } else {
          aggregated[pos.coin].shorts += value
          aggregated[pos.coin].shortsUpnl += upnl
          aggregated[pos.coin].shortsCount += 1
        }
      }
    })

    this.aggregatedData = aggregated
    return aggregated
  }

  /**
   * Calculate bias (0-1, where 0.5 = neutral)
   */
  calculateBias(longs: number, shorts: number): number {
    const total = longs + shorts
    if (total === 0) return 0.5
    return longs / total
  }

  /**
   * Get position multiplier from confidence level
   */
  private getPositionMultFromConfidence(confidence: number): number {
    for (const [minC, maxC, mult] of CONFIDENCE_TO_POSITION_MULT) {
      if (confidence >= minC && confidence < maxC) {
        return mult
      }
    }
    return 0.5 // Default
  }

  /**
   * Determine trading mode based on SM positioning and uPnL
   */
  determineTradingMode(
    weightedLongs: number,
    weightedShorts: number,
    longsUpnl: number,
    shortsUpnl: number,
    options: {
      shortsUpnlChange24h?: number
      longsUpnlChange24h?: number
      velocity?: number
      squeezeDurationHours?: number
      trend?: string
    } = {}
  ): TradingModeResult {
    const {
      shortsUpnlChange24h = 0,
      longsUpnlChange24h = 0,
      velocity = 0,
      squeezeDurationHours = 0,
      trend = 'unknown'
    } = options

    const total = weightedLongs + weightedShorts

    // Base diagnostic data
    const baseData = {
      longValueUsd: Math.round(weightedLongs),
      shortValueUsd: Math.round(weightedShorts),
      longPnlUsd: Math.round(longsUpnl),
      shortPnlUsd: Math.round(shortsUpnl),
    }

    // "Stale PnL" protection
    let momentumPenalty = 0
    let momentumWarning: string | undefined

    if (shortsUpnl > 100000 && shortsUpnlChange24h < -50000) {
      momentumPenalty = Math.min(30, Math.abs(shortsUpnlChange24h) / 100000 * 10)
      momentumWarning = `⚠️ Shorts losing momentum (-$${Math.round(Math.abs(shortsUpnlChange24h) / 1000)}k 24h)`
    }

    if (longsUpnl > 100000 && longsUpnlChange24h < -50000) {
      momentumPenalty = Math.min(30, Math.abs(longsUpnlChange24h) / 100000 * 10)
      momentumWarning = `⚠️ Longs losing momentum (-$${Math.round(Math.abs(longsUpnlChange24h) / 1000)}k 24h)`
    }

    // Divergence detection
    let divergenceWarning: string | undefined
    const smDirection = weightedShorts > weightedLongs * 2 ? 'short' :
                         weightedLongs > weightedShorts * 2 ? 'long' : 'neutral'

    // Check for divergence
    if (smDirection === 'short' && shortsUpnl > longsUpnl && velocity > 100000) {
      divergenceWarning = `⚠️ DIVERGENCE: SM SHORT winning but +$${Math.round(velocity / 1000)}k inflow (squeeze risk)`
      momentumPenalty = Math.max(momentumPenalty, 15)
    }
    if (smDirection === 'long' && longsUpnl > shortsUpnl && velocity < -100000) {
      divergenceWarning = `⚠️ DIVERGENCE: SM LONG winning but -$${Math.round(Math.abs(velocity) / 1000)}k outflow (dump risk)`
      momentumPenalty = Math.max(momentumPenalty, 15)
    }
    if (smDirection === 'short' && trend === 'increasing_longs') {
      const existingWarning = divergenceWarning ? divergenceWarning + ' | ' : ''
      divergenceWarning = existingWarning + '⚠️ TREND DIVERGENCE: SM SHORT but trend=increasing_longs'
      momentumPenalty = Math.max(momentumPenalty, 10)
    }
    if (smDirection === 'long' && trend === 'increasing_shorts') {
      const existingWarning = divergenceWarning ? divergenceWarning + ' | ' : ''
      divergenceWarning = existingWarning + '⚠️ TREND DIVERGENCE: SM LONG but trend=increasing_shorts'
      momentumPenalty = Math.max(momentumPenalty, 10)
    }

    // Not enough data
    if (total < MODE_THRESHOLDS.MIN_TOTAL_USD) {
      return {
        mode: 'NEUTRAL',
        confidence: 0,
        reason: `Insufficient SM exposure ($${Math.round(total / 1000)}k < $50k min)`,
        maxPositionMultiplier: 0.1,
        positionRatio: 0,
        pnlRatio: 0,
        ...baseData,
        momentumWarning,
        divergenceWarning,
      }
    }

    // Calculate position ratio
    const ratio = weightedLongs === 0
      ? (weightedShorts > 0 ? 999.0 : 1.0)
      : weightedShorts / weightedLongs

    // Calculate PnL ratio
    let pnlRatio = 0.0
    if (shortsUpnl > 0 && longsUpnl > 0) {
      pnlRatio = Math.max(shortsUpnl, longsUpnl) / Math.min(shortsUpnl, longsUpnl)
    } else if (shortsUpnl > 0 || longsUpnl > 0) {
      pnlRatio = 999.0
    }

    // CASE 1: SM SHORT DOMINANT (ratio > 2)
    if (ratio > MODE_THRESHOLDS.SHORT_DOMINANT_RATIO) {
      if (shortsUpnl > MODE_THRESHOLDS.UNDERWATER_THRESHOLD) {
        // SM shorts are profitable -> FOLLOW THEM
        let confidence = Math.min(95, 50 + (shortsUpnl / 100000) * 10)
        confidence = Math.max(30, confidence - momentumPenalty)
        const posMult = this.getPositionMultFromConfidence(confidence)
        let reason = `SM SHORT dominant (ratio ${ratio.toFixed(1)}x) and winning (+$${Math.round(shortsUpnl / 1000)}k uPnL)`
        if (momentumWarning) reason += ` | ${momentumWarning}`

        return {
          mode: 'FOLLOW_SM_SHORT',
          confidence: Math.round(confidence),
          reason,
          maxPositionMultiplier: posMult,
          positionRatio: Math.round(ratio * 100) / 100,
          pnlRatio: Math.round(pnlRatio * 100) / 100,
          ...baseData,
          momentumWarning,
          divergenceWarning,
        }
      } else {
        // SM shorts are underwater -> CONTRARIAN (potential squeeze)
        let confidence = Math.min(70, 30 + Math.abs(shortsUpnl) / 500000 * 20)
        confidence = Math.max(10, confidence)
        const reason = `SM SHORT underwater (-$${Math.round(Math.abs(shortsUpnl) / 1000)}k uPnL) - squeeze potential!`

        return {
          mode: 'CONTRARIAN_LONG',
          confidence: Math.round(confidence),
          reason,
          maxPositionMultiplier: 0.25,
          positionRatio: Math.round(ratio * 100) / 100,
          pnlRatio: Math.round(pnlRatio * 100) / 100,
          squeezeDurationHours: Math.round(squeezeDurationHours * 10) / 10,
          ...baseData,
          momentumWarning,
          divergenceWarning,
        }
      }
    }

    // CASE 2: SM LONG DOMINANT (ratio < 0.5)
    if (ratio < MODE_THRESHOLDS.LONG_DOMINANT_RATIO) {
      if (longsUpnl > MODE_THRESHOLDS.UNDERWATER_THRESHOLD) {
        // SM longs are profitable -> FOLLOW THEM
        let confidence = Math.min(95, 50 + (longsUpnl / 100000) * 10)
        confidence = Math.max(30, confidence - momentumPenalty)
        const posMult = this.getPositionMultFromConfidence(confidence)
        let reason = `SM LONG dominant (ratio ${ratio.toFixed(2)}x) and winning (+$${Math.round(longsUpnl / 1000)}k uPnL)`
        if (momentumWarning) reason += ` | ${momentumWarning}`

        return {
          mode: 'FOLLOW_SM_LONG',
          confidence: Math.round(confidence),
          reason,
          maxPositionMultiplier: posMult,
          positionRatio: Math.round(ratio * 100) / 100,
          pnlRatio: Math.round(pnlRatio * 100) / 100,
          ...baseData,
          momentumWarning,
          divergenceWarning,
        }
      } else {
        // SM longs are underwater -> CONTRARIAN (go SHORT)
        let confidence = Math.min(70, 30 + Math.abs(longsUpnl) / 500000 * 20)
        confidence = Math.max(10, confidence)
        const reason = `SM LONG underwater (-$${Math.round(Math.abs(longsUpnl) / 1000)}k uPnL) - reversal potential`

        return {
          mode: 'CONTRARIAN_SHORT',
          confidence: Math.round(confidence),
          reason,
          maxPositionMultiplier: 0.25,
          positionRatio: Math.round(ratio * 100) / 100,
          pnlRatio: Math.round(pnlRatio * 100) / 100,
          squeezeDurationHours: Math.round(squeezeDurationHours * 10) / 10,
          ...baseData,
          momentumWarning,
          divergenceWarning,
        }
      }
    }

    // CASE 3: NEUTRAL (ratio 0.5 - 2.0) - check PnL dominance
    // Check if shorts are winning big (even in neutral position ratio)
    if (shortsUpnl > 0 && longsUpnl > 0) {
      const currentPnlRatio = shortsUpnl / longsUpnl
      if (currentPnlRatio > MODE_THRESHOLDS.PNL_DOMINANT_RATIO) {
        let confidence = Math.min(86, 50 + (currentPnlRatio / 10) * 10)
        confidence = Math.max(30, confidence - momentumPenalty)
        const posMult = this.getPositionMultFromConfidence(confidence)
        let reason = `SM SHORT winning BIG (${currentPnlRatio.toFixed(1)}x PnL ratio) despite neutral positions`
        if (momentumWarning) reason += ` | ${momentumWarning}`

        return {
          mode: 'FOLLOW_SM_SHORT',
          confidence: Math.round(confidence),
          reason,
          maxPositionMultiplier: posMult,
          positionRatio: Math.round(ratio * 100) / 100,
          pnlRatio: Math.round(currentPnlRatio * 100) / 100,
          ...baseData,
          momentumWarning,
          divergenceWarning,
        }
      }
    }

    // Check if shorts profitable and longs underwater
    if (shortsUpnl > 0 && longsUpnl <= 0) {
      const pnlDiff = shortsUpnl - longsUpnl
      if (pnlDiff > 500000) {
        let confidence = Math.min(86, 50 + (pnlDiff / 1000000) * 15)
        confidence = Math.max(30, confidence - momentumPenalty)
        const posMult = this.getPositionMultFromConfidence(confidence)
        let reason = `SM SHORT profitable (+$${Math.round(shortsUpnl / 1000)}k) while LONG underwater (-$${Math.round(Math.abs(longsUpnl) / 1000)}k)`
        if (momentumWarning) reason += ` | ${momentumWarning}`

        return {
          mode: 'FOLLOW_SM_SHORT',
          confidence: Math.round(confidence),
          reason,
          maxPositionMultiplier: posMult,
          positionRatio: Math.round(ratio * 100) / 100,
          pnlRatio: 999.0,
          ...baseData,
          momentumWarning,
          divergenceWarning,
        }
      }
    }

    // Check if longs winning big
    if (longsUpnl > 0 && shortsUpnl > 0) {
      const currentPnlRatio = longsUpnl / shortsUpnl
      if (currentPnlRatio > MODE_THRESHOLDS.PNL_DOMINANT_RATIO) {
        let confidence = Math.min(86, 50 + (currentPnlRatio / 10) * 10)
        confidence = Math.max(30, confidence - momentumPenalty)
        const posMult = this.getPositionMultFromConfidence(confidence)
        let reason = `SM LONG winning BIG (${currentPnlRatio.toFixed(1)}x PnL ratio) despite neutral positions`
        if (momentumWarning) reason += ` | ${momentumWarning}`

        return {
          mode: 'FOLLOW_SM_LONG',
          confidence: Math.round(confidence),
          reason,
          maxPositionMultiplier: posMult,
          positionRatio: Math.round(ratio * 100) / 100,
          pnlRatio: Math.round(currentPnlRatio * 100) / 100,
          ...baseData,
          momentumWarning,
          divergenceWarning,
        }
      }
    }

    // Check if longs profitable and shorts underwater
    if (longsUpnl > 0 && shortsUpnl <= 0) {
      const pnlDiff = longsUpnl - shortsUpnl
      if (pnlDiff > 500000) {
        let confidence = Math.min(86, 50 + (pnlDiff / 1000000) * 15)
        confidence = Math.max(30, confidence - momentumPenalty)
        const posMult = this.getPositionMultFromConfidence(confidence)
        let reason = `SM LONG profitable (+$${Math.round(longsUpnl / 1000)}k) while SHORT underwater (-$${Math.round(Math.abs(shortsUpnl) / 1000)}k)`
        if (momentumWarning) reason += ` | ${momentumWarning}`

        return {
          mode: 'FOLLOW_SM_LONG',
          confidence: Math.round(confidence),
          reason,
          maxPositionMultiplier: posMult,
          positionRatio: Math.round(ratio * 100) / 100,
          pnlRatio: 999.0,
          ...baseData,
          momentumWarning,
          divergenceWarning,
        }
      }
    }

    // Still neutral - no clear PnL dominance
    return {
      mode: 'NEUTRAL',
      confidence: 30,
      reason: `Mixed SM signals (ratio ${ratio.toFixed(2)}x) - no clear direction`,
      maxPositionMultiplier: 0.25,
      positionRatio: Math.round(ratio * 100) / 100,
      pnlRatio: Math.round(pnlRatio * 100) / 100,
      ...baseData,
      momentumWarning,
      divergenceWarning,
    }
  }

  /**
   * Generate Smart Money data output for bot consumption
   */
  generateSmartMoneyData(aggregated?: Record<string, AggregatedCoinData>): SmartMoneyData {
    const data = aggregated || this.aggregatedData
    const timestamp = new Date().toISOString()

    const entries: Record<string, CoinSmartMoneyEntry> = {}

    for (const coin of TRACKED_COINS) {
      const coinData = data[coin]
      if (!coinData) continue

      const bias = this.calculateBias(coinData.longs, coinData.shorts)
      const flow = coinData.longs - coinData.shorts
      const signal: 'bullish' | 'bearish' | 'neutral' =
        bias > 0.6 ? 'bullish' : bias < 0.4 ? 'bearish' : 'neutral'

      const tradingMode = this.determineTradingMode(
        coinData.longs,
        coinData.shorts,
        coinData.longsUpnl,
        coinData.shortsUpnl
      )

      entries[coin] = {
        bias: Math.round(bias * 100) / 100,
        signal,
        flow: Math.round(flow),
        currentLongsUsd: Math.round(coinData.longs),
        currentShortsUsd: Math.round(coinData.shorts),
        longsUpnl: Math.round(coinData.longsUpnl),
        shortsUpnl: Math.round(coinData.shortsUpnl),
        topTradersPnl: coinData.shortsUpnl > coinData.longsUpnl ? 'shorts_winning' : 'longs_winning',
        trend: 'unknown',
        trendStrength: 'weak',
        momentum: 0,
        velocity: 0,
        flowChange7d: 0,
        longsCount: coinData.longsCount,
        shortsCount: coinData.shortsCount,
        tradingMode: tradingMode.mode,
        tradingModeConfidence: tradingMode.confidence,
        maxPositionMultiplier: tradingMode.maxPositionMultiplier,
      }
    }

    return {
      timestamp,
      source: 'NansenFeed_TypeScript',
      data: entries,
    }
  }

  /**
   * Generate Nansen Bias output for bot consumption
   */
  generateNansenBias(aggregated?: Record<string, AggregatedCoinData>): Record<string, NansenBiasOutput> {
    const data = aggregated || this.aggregatedData
    const timestamp = new Date().toISOString()
    const output: Record<string, NansenBiasOutput> = {}

    for (const coin of TRACKED_COINS) {
      const coinData = data[coin]
      if (!coinData) continue

      const bias = this.calculateBias(coinData.longs, coinData.shorts)
      const flow = coinData.longs - coinData.shorts

      const tradingMode = this.determineTradingMode(
        coinData.longs,
        coinData.shorts,
        coinData.longsUpnl,
        coinData.shortsUpnl
      )

      // Calculate boost (0.05 to 2.0)
      let boost: number
      let direction: 'long' | 'short' | 'neutral'
      let biasStrength: 'strong' | 'moderate' | 'soft'

      if (bias > 0.65) {
        direction = 'long'
        boost = 1.0 + (bias - 0.5) * 2  // 1.0 to 2.0
        biasStrength = bias > 0.75 ? 'strong' : 'moderate'
      } else if (bias < 0.35) {
        direction = 'short'
        boost = 1.0 - (0.5 - bias) * 1.9  // 0.05 to 1.0
        biasStrength = bias < 0.25 ? 'strong' : 'moderate'
      } else {
        direction = 'neutral'
        boost = 1.0
        biasStrength = 'soft'
      }

      output[coin] = {
        boost: Math.round(boost * 100) / 100,
        direction,
        biasStrength,
        buySellPressure: Math.round(flow),
        updatedAt: timestamp,
        trend: 'unknown',
        trendStrength: 'weak',
        trendAdjustment: 1.0,
        tradingMode: tradingMode.mode,
        tradingModeConfidence: tradingMode.confidence,
        tradingModeReason: tradingMode.reason,
        maxPositionMultiplier: tradingMode.maxPositionMultiplier,
        positionRatio: tradingMode.positionRatio,
        pnlRatio: tradingMode.pnlRatio,
        longValueUsd: tradingMode.longValueUsd,
        shortValueUsd: tradingMode.shortValueUsd,
        longPnlUsd: tradingMode.longPnlUsd,
        shortPnlUsd: tradingMode.shortPnlUsd,
        momentumWarning: tradingMode.momentumWarning,
        divergenceWarning: tradingMode.divergenceWarning,
        squeezeDurationHours: tradingMode.squeezeDurationHours,
        squeezeFailed: tradingMode.squeezeFailed,
      }
    }

    return output
  }

  /**
   * Full update cycle - fetch all positions, aggregate, and emit data
   */
  async update(): Promise<{
    smartMoneyData: SmartMoneyData
    nansenBias: Record<string, NansenBiasOutput>
    aggregated: Record<string, AggregatedCoinData>
  }> {
    console.log(`[NansenFeed] Starting update cycle...`)
    const startTime = Date.now()

    // Fetch all positions
    await this.fetchAllPositions()
    console.log(`[NansenFeed] Fetched ${this.allPositions.size} whale positions`)

    // Aggregate
    const aggregated = this.aggregatePositions()
    console.log(`[NansenFeed] Aggregated positions for ${TRACKED_COINS.length} coins`)

    // Generate outputs
    const smartMoneyData = this.generateSmartMoneyData(aggregated)
    const nansenBias = this.generateNansenBias(aggregated)

    const elapsed = Date.now() - startTime
    console.log(`[NansenFeed] Update complete in ${elapsed}ms`)

    // Emit update event
    this.emit('update', { smartMoneyData, nansenBias, aggregated })

    return { smartMoneyData, nansenBias, aggregated }
  }

  /**
   * Get current aggregated data
   */
  getAggregatedData(): Record<string, AggregatedCoinData> {
    return this.aggregatedData
  }

  /**
   * Get last update time
   */
  getLastUpdateTime(): Date | null {
    return this.lastUpdateTime
  }

  /**
   * Get all whale addresses
   */
  getWhaleAddresses(): string[] {
    return Object.keys(WHALES)
  }

  /**
   * Get whale info by address
   */
  getWhaleInfo(address: string): WhaleInfo | undefined {
    return WHALES[address.toLowerCase()]
  }
}

// Export singleton instance
export const nansenFeed = new NansenFeed()
