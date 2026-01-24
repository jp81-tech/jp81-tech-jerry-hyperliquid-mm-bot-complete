import http from 'http'
import { TelemetryCollector } from './TelemetryCollector.js'
import { AlertManager, PauseStatus } from '../alerts/AlertManager.js'
import { AlertSeverity } from '../types/alerts.js'
import { Logger } from '../utils/logger.js'

// ============================================================
// TELEMETRY REST SERVER
// GET /telemetry/latest - Current bot state
// GET /telemetry/health - Health check
// GET /telemetry/pause - Pause status
// GET /watchdog - Fill watchdog status
// POST /telemetry/resume - Manual resume (if paused)
// POST /telemetry/clear-alerts - Clear SQUEEZE_RISK alerts
// ============================================================

export interface ShadowTradingSummary {
  enabled: boolean
  activeAdjustments: number
  activeSignals: number
  tokenSentiment: Record<string, { longs: number; shorts: number; consensus: string }>
}

export interface TelemetryEndpointData {
  timestamp: string
  health: 'OK' | 'PAUSED' | 'DEGRADED' | 'ERROR'
  pause: PauseStatus
  positions: PositionSummary[]
  alerts: AlertSummary
  contrarian: ContrarianSummary
  performance: PerformanceSummary
  shadow?: ShadowTradingSummary
  smartSignals?: Record<string, SmartSignalSummary>
  watchdog?: WatchdogSummary
  positionRisk?: PositionRiskTelemetry
}

interface PositionSummary {
  token: string
  side: 'LONG' | 'SHORT' | 'NONE'
  valueUsd: number
  distToTriggerPct: number | null
  distToStopPct: number | null
  severity: string
}

interface AlertSummary {
  critical: number
  high: number
  warning: number
  info: number
  squeezeRiskTokens: string[]
}

interface ContrarianSummary {
  activeTokens: string[]
  smConflicts: Record<string, string>
}

interface PerformanceSummary {
  dailyPnl: number
  totalPnl: number
  successRate: number
}

interface SmartSignalSummary {
  type: string
  direction: 'long' | 'short' | 'neutral'
  confidence: number
  reasons: string[]
  warnings: string[]
}

interface WatchdogSummary {
  lastFillIso: string | null
  idleMinutes: number
  maxIdleMinutes: number
  triggered: boolean
}

interface WatchdogData {
  lastFillTimestamp: number
  idleMs: number
  maxIdleMs: number
  triggered: boolean
}

interface PositionRiskTelemetry {
  status: {
    isPaused: boolean
    reason?: string
    equity: number
    peak: number
    maxPerTokenUsd: number
    maxTotalExposureUsd: number
    reserveRatio: number
    reserveTargetUsd: number
  }
  exposure?: {
    totalExposureUsd: number
    totalLimitUsd: number
    utilizationPct: number
    pendingBidUsd: number
    pendingAskUsd: number
    byToken: Record<string, number>
    timestamp: string
  }
}

export interface TelemetryServerOptions {
  port?: number
  telemetryCollector?: TelemetryCollector
  alertManager?: AlertManager
  getPositions?: () => PositionSummary[]
  getPerformance?: () => PerformanceSummary
  getContrarianData?: () => ContrarianSummary
  getShadowData?: () => ShadowTradingSummary | null
  getSmartSignals?: () => Record<string, SmartSignalSummary> | null
  getWatchdogData?: () => WatchdogData | null
  getPositionRisk?: () => PositionRiskTelemetry | null
  logger?: Logger
}

export class TelemetryServer {
  private readonly port: number
  private readonly telemetryCollector?: TelemetryCollector
  private readonly alertManager?: AlertManager
  private readonly getPositions: () => PositionSummary[]
  private readonly getPerformance: () => PerformanceSummary
  private readonly getContrarianData: () => ContrarianSummary
  private readonly getShadowData: () => ShadowTradingSummary | null
  private readonly getSmartSignals: () => Record<string, SmartSignalSummary> | null
  private readonly getWatchdogData: () => WatchdogData | null
  private readonly getPositionRisk: () => PositionRiskTelemetry | null
  private readonly logger: Logger
  private server: http.Server | null = null

  constructor(options: TelemetryServerOptions) {
    this.port = options.port ?? parseInt(process.env.TELEMETRY_PORT ?? '8080', 10)
    this.telemetryCollector = options.telemetryCollector
    this.alertManager = options.alertManager
    this.getPositions = options.getPositions ?? (() => [])
    this.getPerformance = options.getPerformance ?? (() => ({ dailyPnl: 0, totalPnl: 0, successRate: 0 }))
    this.getContrarianData = options.getContrarianData ?? (() => ({ activeTokens: [], smConflicts: {} }))
    this.getShadowData = options.getShadowData ?? (() => null)
    this.getSmartSignals = options.getSmartSignals ?? (() => null)
    this.getWatchdogData = options.getWatchdogData ?? (() => null)
    this.getPositionRisk = options.getPositionRisk ?? (() => null)
    this.logger = options.logger ?? new Logger()
  }

  start(): void {
    if (this.server) return
    this.tryPort(this.port)
  }

  private tryPort(port: number, attempts: number = 0): void {
    const maxAttempts = 5  // Try up to 5 ports (8080-8084 or configured+0 to +4)

    if (attempts >= maxAttempts) {
      this.logger.error(`[TelemetryServer] Failed to start - all ports ${this.port}-${this.port + maxAttempts - 1} in use`)
      return
    }

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res)
    })

    this.server.listen(port, () => {
      this.logger.info(`[TelemetryServer] ✅ Listening on port ${port}`)
    })

    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        this.logger.warn(`[TelemetryServer] Port ${port} in use, trying ${port + 1}...`)
        this.server?.close()
        this.server = null
        this.tryPort(port + 1, attempts + 1)
      } else {
        this.logger.error(`[TelemetryServer] Error: ${err.message}`)
      }
    })
  }

  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
      this.logger.info('[TelemetryServer] Stopped')
    }
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? '/'
    const method = req.method ?? 'GET'

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    try {
      if (url === '/telemetry/latest' && method === 'GET') {
        this.handleLatest(res)
      } else if (url === '/telemetry/health' && method === 'GET') {
        this.handleHealth(res)
      } else if (url === '/telemetry/pause' && method === 'GET') {
        this.handlePauseStatus(res)
      } else if (url === '/telemetry/resume' && method === 'POST') {
        this.handleResume(res)
      } else if (url === '/telemetry/clear-alerts' && method === 'POST') {
        this.handleClearAlerts(res)
      } else if (url === '/watchdog' && method === 'GET') {
        this.handleWatchdog(res)
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found' }))
      }
    } catch (err: any) {
      this.logger.error(`[TelemetryServer] Error handling ${url}: ${err.message}`)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
  }

  private handleLatest(res: http.ServerResponse): void {
    const pauseStatus = this.alertManager?.getPauseStatus() ?? {
      isPaused: false,
      pausedUntil: null,
      reason: null,
      sources: [],
      criticalAlertsInWindow: 0
    }

    const alertCounts = this.alertManager?.getAlertCounts() ?? {
      [AlertSeverity.INFO]: 0,
      [AlertSeverity.WARNING]: 0,
      [AlertSeverity.HIGH]: 0,
      [AlertSeverity.CRITICAL]: 0,
      [AlertSeverity.EMERGENCY]: 0
    }

    // Get squeeze risk tokens from active alerts
    const squeezeRiskTokens = this.alertManager?.getActiveAlerts()
      .filter(a => a.category === 'SQUEEZE_RISK')
      .map(a => a.token) ?? []

    const health: TelemetryEndpointData['health'] = pauseStatus.isPaused
      ? 'PAUSED'
      : alertCounts[AlertSeverity.CRITICAL] > 0
        ? 'DEGRADED'
        : 'OK'

    const shadowData = this.getShadowData()
    const smartSignalData = this.getSmartSignals()
    const watchdogData = this.getWatchdogData()
    const positionRisk = this.getPositionRisk()

    const data: TelemetryEndpointData = {
      timestamp: new Date().toISOString(),
      health,
      pause: pauseStatus,
      positions: this.getPositions(),
      alerts: {
        critical: alertCounts[AlertSeverity.CRITICAL],
        high: alertCounts[AlertSeverity.HIGH],
        warning: alertCounts[AlertSeverity.WARNING],
        info: alertCounts[AlertSeverity.INFO],
        squeezeRiskTokens: [...new Set(squeezeRiskTokens)]
      },
      contrarian: this.getContrarianData(),
      performance: this.getPerformance(),
      shadow: shadowData ?? undefined,
      smartSignals: smartSignalData && Object.keys(smartSignalData).length > 0 ? smartSignalData : undefined,
      watchdog: watchdogData
        ? {
            lastFillIso: watchdogData.lastFillTimestamp
              ? new Date(watchdogData.lastFillTimestamp).toISOString()
              : null,
            idleMinutes: Number((watchdogData.idleMs / 60000).toFixed(2)),
            maxIdleMinutes: Number((watchdogData.maxIdleMs / 60000).toFixed(2)),
            triggered: watchdogData.triggered
          }
        : undefined,
      positionRisk: positionRisk ?? undefined
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data, null, 2))
  }

  private handleHealth(res: http.ServerResponse): void {
    const pauseStatus = this.alertManager?.getPauseStatus()
    const isPaused = pauseStatus?.isPaused ?? false

    res.writeHead(isPaused ? 503 : 200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: isPaused ? 'PAUSED' : 'OK',
      timestamp: new Date().toISOString(),
      pausedUntil: pauseStatus?.pausedUntil?.toISOString() ?? null
    }))
  }

  private handlePauseStatus(res: http.ServerResponse): void {
    const status = this.alertManager?.getPauseStatus() ?? {
      isPaused: false,
      pausedUntil: null,
      reason: null,
      sources: [],
      criticalAlertsInWindow: 0
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ...status,
      pausedUntil: status.pausedUntil?.toISOString() ?? null
    }))
  }

  private handleResume(res: http.ServerResponse): void {
    if (!this.alertManager) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'AlertManager not configured' }))
      return
    }

    const wasPaused = this.alertManager.shouldPauseTrading()
    this.alertManager.manualResume()

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      success: true,
      wasPaused,
      message: wasPaused ? 'Trading resumed' : 'Trading was not paused'
    }))
  }

  private handleClearAlerts(res: http.ServerResponse): void {
    if (!this.alertManager) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'AlertManager not configured' }))
      return
    }

    const cleared = this.alertManager.clearSqueezeRiskAlerts()

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      success: true,
      clearedCount: cleared,
      message: cleared > 0 ? `Cleared ${cleared} SQUEEZE_RISK alerts` : 'No alerts to clear'
    }))
  }

  private handleWatchdog(res: http.ServerResponse): void {
    const watchdogData = this.getWatchdogData()

    if (!watchdogData) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: 'UNKNOWN',
        message: 'No fill data available yet',
        lastFill: null,
        idleMinutes: null,
        maxIdleMinutes: null,
        triggered: false
      }))
      return
    }

    const idleMinutes = Math.round(watchdogData.idleMs / 60000)
    const maxIdleMinutes = Math.round(watchdogData.maxIdleMs / 60000)
    const status = watchdogData.triggered ? 'ALERT' : idleMinutes > maxIdleMinutes / 2 ? 'WARNING' : 'OK'

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status,
      lastFill: new Date(watchdogData.lastFillTimestamp).toISOString(),
      lastFillAgo: `${idleMinutes} minutes ago`,
      idleMinutes,
      maxIdleMinutes,
      triggered: watchdogData.triggered,
      message: watchdogData.triggered
        ? `⚠️ No fills for ${idleMinutes} min (max ${maxIdleMinutes})`
        : `✅ Last fill ${idleMinutes} min ago`
    }))
  }
}
