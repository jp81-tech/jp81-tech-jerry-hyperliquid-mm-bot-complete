import { AlertCategory, AlertSeverity } from './alerts.js'
import type { SmartMoneySignalDirection, SmartMoneySignalType } from '../signals/sm_signal_service.js'

export interface TelemetrySnapshot {
  timestamp: Date
  token: string
  smartMoney: {
    totalLongsUsd: number
    totalShortsUsd: number
    biasRatio: number
    netPositionUsd: number
    numLongTraders: number
    numShortTraders: number
    topWhaleAddress?: string
    topWhalePositionUsd?: number
    topWhaleUnrealizedPnl?: number
    concentrationRisk?: number
  }
  flow: {
    balanceChange7d: number
    trend?: string
    isPivot?: boolean
  }
  market: {
    markPrice?: number
    priceChangePct24h?: number
    volume24h?: number
    openInterest?: number
    fundingRateAnnualized?: number
  }
  bot: {
    currentInventory: number
    targetInventory: number
    capitalMultiplier: number
  }
  config: {
    baseSpreadBps: number
    minSpreadBps: number
    maxSpreadBps: number
    baseOrderSizeUsd: number
    bidSizeMultiplier: number
    askSizeMultiplier: number
  }
  smSignal?: {
    type: SmartMoneySignalType
    direction: SmartMoneySignalDirection
    confidence: number
    netPositionUsd: number
    reasons: string[]
    warnings: string[]
  }
  signals: string[] | readonly string[]
  contrarian?: {
    severity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    smNetPositionUsd: number
    botSide: 'long' | 'short' | 'neutral'
    smSide: 'long' | 'short' | 'neutral'
    squeezeTriggerPrice?: number
    stopLossPrice?: number
  }
}

export interface PerformanceMetrics {
  timestamp: Date
  token: string
  period: '1h' | '4h' | '24h'
  pnl: {
    realized: number
    unrealized: number
    fees: number
    funding: number
  }
  trades: {
    total: number
    wins: number
    losses: number
  }
}

export interface DiagnosticsLog {
  timestamp: Date
  token: string
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  event?: string
  message: string
  context?: Record<string, any>
}

export interface AlertEvent {
  alertId: string
  token: string
  severity: AlertSeverity
  category: AlertCategory
  timestamp: Date
  title: string
  message: string
}


