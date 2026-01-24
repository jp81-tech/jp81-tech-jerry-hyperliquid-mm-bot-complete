import { EventEmitter } from 'events'
import crypto from 'crypto'
import { Alert, AlertCategory, AlertSeverity } from '../types/alerts.js'
import { TelemetrySnapshot } from '../types/telemetry.js'
import { Logger } from '../utils/logger.js'
import { NotificationService } from './NotificationService.js'

// ============================================================
// AUTO-PAUSE CONFIGURATION
// ============================================================
interface AutoPauseConfig {
  enabled: boolean
  // 3+ CRITICAL alerts in 15 min → pause for 30 min
  shortWindow: { alertCount: number; windowMs: number; pauseMs: number }
  // 5+ CRITICAL alerts in 1h → pause for 2h
  longWindow: { alertCount: number; windowMs: number; pauseMs: number }
}

interface CriticalAlertEntry {
  timestamp: Date
  token: string
  category: AlertCategory
}

const DEFAULT_AUTO_PAUSE_CONFIG: AutoPauseConfig = {
  enabled: process.env.DISABLE_AUTO_PAUSE !== 'true',
  shortWindow: { alertCount: 3, windowMs: 15 * 60 * 1000, pauseMs: 30 * 60 * 1000 },
  longWindow: { alertCount: 5, windowMs: 60 * 60 * 1000, pauseMs: 2 * 60 * 60 * 1000 }
}

export interface PauseStatus {
  isPaused: boolean
  pausedUntil: Date | null
  reason: string | null
  sources: string[]
  criticalAlertsInWindow: number
}

export class AlertManager extends EventEmitter {
  private readonly logger: Logger
  private readonly notificationService: NotificationService
  private readonly activeAlerts: Map<string, Alert> = new Map()
  private readonly previousBias: Map<string, number> = new Map()

  // Auto-pause tracking
  private readonly autoPauseConfig: AutoPauseConfig
  private readonly criticalAlertHistory: CriticalAlertEntry[] = []
  private pausedUntil: Date | null = null
  private pauseReason: string | null = null
  private readonly externalPauses: Map<string, { reason: string; timestamp: Date }> = new Map()

  constructor(logger = new Logger(), notificationService = new NotificationService()) {
    super()
    this.logger = logger
    this.notificationService = notificationService
    this.autoPauseConfig = { ...DEFAULT_AUTO_PAUSE_CONFIG }
  }

  // ============================================================
  // AUTO-PAUSE PUBLIC API
  // ============================================================

  getPauseStatus(): PauseStatus {
    this.cleanupOldAlerts()
    const now = new Date()
    const autoPaused = this.pausedUntil !== null && this.pausedUntil > now
    const externalPaused = this.externalPauses.size > 0
    const isPaused = autoPaused || externalPaused
    const externalReason = externalPaused
      ? Array.from(this.externalPauses.entries())
        .map(([source, entry]) => `${source}: ${entry.reason}`)
        .join(' | ')
      : null

    return {
      isPaused,
      pausedUntil: autoPaused ? this.pausedUntil : null,
      reason: autoPaused ? this.pauseReason : externalReason,
      sources: [
        ...(autoPaused ? ['auto'] : []),
        ...(externalPaused ? Array.from(this.externalPauses.keys()) : [])
      ],
      criticalAlertsInWindow: this.criticalAlertHistory.length
    }
  }

  shouldPauseTrading(): boolean {
    return this.getPauseStatus().isPaused
  }

  manualResume(): void {
    const hadAutoPause = !!this.pausedUntil
    const hadExternalPause = this.externalPauses.size > 0

    if (!hadAutoPause && !hadExternalPause) {
      return
    }

    if (hadAutoPause) {
      this.logger.info(`[AutoPause] Manual resume - was paused until ${this.pausedUntil!.toISOString()}`)
      this.pausedUntil = null
      this.pauseReason = null
    }

    if (hadExternalPause) {
      this.externalPauses.clear()
      this.logger.info('[AutoPause] Manual resume cleared external pause sources')
    }

    this.emit('resumed', { manual: true })
  }

  setExternalPause(source: string, reason: string): void {
    const existing = this.externalPauses.get(source)
    if (existing?.reason === reason) {
      return
    }
    this.externalPauses.set(source, { reason, timestamp: new Date() })
    this.logger.warn(`[AutoPause] External pause (${source}): ${reason}`)
    this.emit('paused', { source, reason, external: true })
  }

  clearExternalPause(source: string): void {
    if (this.externalPauses.delete(source)) {
      this.logger.info(`[AutoPause] External pause cleared (${source})`)
      if (!this.shouldPauseTrading()) {
        this.emit('resumed', { manual: false, source })
      }
    }
  }

  private cleanupOldAlerts(): void {
    const now = Date.now()
    const maxAge = this.autoPauseConfig.longWindow.windowMs
    while (this.criticalAlertHistory.length > 0) {
      const oldest = this.criticalAlertHistory[0]
      if (now - oldest.timestamp.getTime() > maxAge) {
        this.criticalAlertHistory.shift()
      } else {
        break
      }
    }
  }

  private checkAutoPause(alert: Alert): void {
    if (!this.autoPauseConfig.enabled) return
    if (alert.severity !== AlertSeverity.CRITICAL) return

    // Record the critical alert
    this.criticalAlertHistory.push({
      timestamp: alert.timestamp,
      token: alert.token,
      category: alert.category
    })

    this.cleanupOldAlerts()

    const now = Date.now()
    const { shortWindow, longWindow } = this.autoPauseConfig

    // Check short window (3+ in 15 min)
    const shortWindowStart = now - shortWindow.windowMs
    const shortCount = this.criticalAlertHistory.filter(
      e => e.timestamp.getTime() >= shortWindowStart
    ).length

    if (shortCount >= shortWindow.alertCount) {
      const pauseUntil = new Date(now + shortWindow.pauseMs)
      if (!this.pausedUntil || pauseUntil > this.pausedUntil) {
        this.pausedUntil = pauseUntil
        this.pauseReason = `${shortCount} CRITICAL alerts in ${shortWindow.windowMs / 60000} min`
        this.logger.warn(
          `🛑 [AUTO-PAUSE] Trading paused for ${shortWindow.pauseMs / 60000} min | ` +
          `Reason: ${this.pauseReason}`
        )
        this.emit('paused', { until: this.pausedUntil, reason: this.pauseReason })
      }
    }

    // Check long window (5+ in 1h)
    const longWindowStart = now - longWindow.windowMs
    const longCount = this.criticalAlertHistory.filter(
      e => e.timestamp.getTime() >= longWindowStart
    ).length

    if (longCount >= longWindow.alertCount) {
      const pauseUntil = new Date(now + longWindow.pauseMs)
      if (!this.pausedUntil || pauseUntil > this.pausedUntil) {
        this.pausedUntil = pauseUntil
        this.pauseReason = `${longCount} CRITICAL alerts in ${longWindow.windowMs / 60000} min`
        this.logger.warn(
          `🛑 [AUTO-PAUSE EXTENDED] Trading paused for ${longWindow.pauseMs / 60000} min | ` +
          `Reason: ${this.pauseReason}`
        )
        this.emit('paused', { until: this.pausedUntil, reason: this.pauseReason })
      }
    }
  }

  evaluateSnapshot(snapshot: TelemetrySnapshot): void {
    const alerts: Alert[] = []
    alerts.push(...this.checkWhaleUnderwater(snapshot))
    alerts.push(...this.checkConcentration(snapshot))
    alerts.push(...this.checkBiasShift(snapshot))
    alerts.push(...this.checkVolatility(snapshot))
    alerts.push(...this.checkContrarian(snapshot))
    alerts.push(...this.checkSmartSignal(snapshot))

    for (const alert of alerts) {
      this.pushAlert(alert)
    }

    this.previousBias.set(snapshot.token, snapshot.smartMoney.biasRatio)
  }

  pushAlert(alert: Alert): void {
    this.cleanupExpiredAlerts()
    this.activeAlerts.set(alert.id, alert)
    this.notificationService.send(alert)
    this.emit('alert', alert)
    this.checkAutoPause(alert)
  }

  // Get all active alerts for telemetry
  getActiveAlerts(): Alert[] {
    this.cleanupExpiredAlerts()
    return Array.from(this.activeAlerts.values())
  }

  // Manually acknowledge/dismiss all alerts for a token
  acknowledgeAlertsForToken(token: string): number {
    const tokenUpper = token.toUpperCase()
    let count = 0
    for (const [id, alert] of this.activeAlerts.entries()) {
      if (alert.token.toUpperCase() === tokenUpper) {
        this.activeAlerts.delete(id)
        count++
      }
    }
    if (count > 0) {
      this.logger.info(`[AlertManager] Acknowledged ${count} alerts for ${tokenUpper}`)
    }
    return count
  }

  // Clear all SQUEEZE_RISK alerts (useful after manual position adjustment)
  clearSqueezeRiskAlerts(): number {
    let count = 0
    for (const [id, alert] of this.activeAlerts.entries()) {
      if (alert.category === AlertCategory.SQUEEZE_RISK) {
        this.activeAlerts.delete(id)
        count++
      }
    }
    if (count > 0) {
      this.logger.info(`[AlertManager] Cleared ${count} SQUEEZE_RISK alerts`)
    }
    return count
  }

  // Get alert counts by severity
  getAlertCounts(): Record<AlertSeverity, number> {
    this.cleanupExpiredAlerts()
    const counts = {
      [AlertSeverity.INFO]: 0,
      [AlertSeverity.WARNING]: 0,
      [AlertSeverity.HIGH]: 0,
      [AlertSeverity.CRITICAL]: 0,
      [AlertSeverity.EMERGENCY]: 0
    }
    for (const alert of this.activeAlerts.values()) {
      counts[alert.severity]++
    }
    return counts
  }

  private cleanupExpiredAlerts(): void {
    const now = Date.now()
    for (const [id, alert] of this.activeAlerts.entries()) {
      if (alert.expiresAt && alert.expiresAt.getTime() <= now) {
        this.activeAlerts.delete(id)
      }
    }
  }

  private dismissAlerts(filter: (alert: Alert) => boolean): void {
    for (const [id, alert] of this.activeAlerts.entries()) {
      if (filter(alert)) {
        this.activeAlerts.delete(id)
      }
    }
  }

  private dismissAlertsForToken(category: AlertCategory, token: string): void {
    this.dismissAlerts((alert) => alert.category === category && alert.token === token)
  }

  private checkWhaleUnderwater(snapshot: TelemetrySnapshot): Alert[] {
    const pnl = snapshot.smartMoney.topWhaleUnrealizedPnl ?? 0
    const alerts: Alert[] = []
    if (pnl < -1_000_000) {
      alerts.push(
        this.createAlert(snapshot, AlertCategory.WHALE_UNDERWATER, AlertSeverity.HIGH, 'Whale underwater > $1M', `Top whale uPnL ${pnl.toFixed(0)}`)
      )
    }
    return alerts
  }

  private checkConcentration(snapshot: TelemetrySnapshot): Alert[] {
    const risk = snapshot.smartMoney.concentrationRisk ?? 0
    if (risk < 0.8) return []
    return [
      this.createAlert(
        snapshot,
        AlertCategory.CONCENTRATION_RISK,
        AlertSeverity.WARNING,
        'High concentration risk',
        `Top trader controls ${(risk * 100).toFixed(1)}% of position`
      )
    ]
  }

  private checkBiasShift(snapshot: TelemetrySnapshot): Alert[] {
    const prev = this.previousBias.get(snapshot.token)
    const current = snapshot.smartMoney.biasRatio
    if (prev === undefined) return []
    if (Math.abs(current - prev) < 0.05) return []
    return [
      this.createAlert(
        snapshot,
        AlertCategory.BIAS_SHIFT,
        AlertSeverity.INFO,
        'Bias shift detected',
        `Bias ratio moved ${((current - prev) * 100).toFixed(1)} pts`
      )
    ]
  }

  private checkVolatility(snapshot: TelemetrySnapshot): Alert[] {
    const move = Math.abs(snapshot.market.priceChangePct24h ?? 0)
    if (move < 5) return []
    return [
      this.createAlert(
        snapshot,
        AlertCategory.VOLATILITY_SPIKE,
        AlertSeverity.WARNING,
        'Volatility spike',
        `Price moved ${move.toFixed(2)}% in 24h`
      )
    ]
  }

  private checkContrarian(snapshot: TelemetrySnapshot): Alert[] {
    const ctr = snapshot.contrarian
    if (!ctr || ctr.severity === 'NONE' || ctr.severity === 'LOW') {
      this.dismissAlertsForToken(AlertCategory.SQUEEZE_RISK, snapshot.token)
      return []
    }

    // Deduplicate: don't create new alert if one already exists for this token
    const existingAlert = Array.from(this.activeAlerts.values()).find(
      a => a.category === AlertCategory.SQUEEZE_RISK && a.token === snapshot.token
    )
    if (existingAlert) {
      return [] // Alert already exists, don't create duplicate
    }

    const severity =
      ctr.severity === 'CRITICAL'
        ? AlertSeverity.CRITICAL
        : ctr.severity === 'HIGH'
          ? AlertSeverity.HIGH
          : AlertSeverity.WARNING

    const title = `Contrarian conflict ${ctr.severity}`
    const millions = Math.abs(ctr.smNetPositionUsd) / 1_000_000
    const messageParts = [
      `Bot ${ctr.botSide.toUpperCase()} vs SM ${ctr.smSide.toUpperCase()}`,
      `SM position ~$${millions.toFixed(2)}M`,
      ctr.squeezeTriggerPrice ? `Trigger $${ctr.squeezeTriggerPrice.toFixed(4)}` : null,
      ctr.stopLossPrice ? `Stop $${ctr.stopLossPrice.toFixed(4)}` : null
    ].filter(Boolean)

    const expiresInMs =
      ctr.severity === 'CRITICAL'
        ? 45 * 60 * 1000
        : ctr.severity === 'HIGH'
          ? 30 * 60 * 1000
          : 15 * 60 * 1000

    return [
      this.createAlert(
        snapshot,
        AlertCategory.SQUEEZE_RISK,
        severity,
        title,
        messageParts.join(' | '),
        { expiresInMs }
      )
    ]
  }

  private checkSmartSignal(snapshot: TelemetrySnapshot): Alert[] {
    const smSignal = snapshot.smSignal
    if (!smSignal || smSignal.type === 'NEUTRAL') {
      this.dismissAlertsForToken(AlertCategory.SMART_SIGNAL, snapshot.token)
      return []
    }

    const existing = Array.from(this.activeAlerts.values()).find(
      (alert) =>
        alert.category === AlertCategory.SMART_SIGNAL &&
        alert.token === snapshot.token &&
        alert.data?.signalType === smSignal.type
    )
    if (existing) {
      return []
    }

    const severity =
      smSignal.type === 'STRONG_LONG' || smSignal.type === 'STRONG_SHORT'
        ? AlertSeverity.HIGH
        : smSignal.type === 'BLOCKED'
          ? AlertSeverity.WARNING
          : AlertSeverity.INFO

    const title =
      smSignal.type === 'BLOCKED'
        ? 'Smart Money signal unavailable'
        : `Smart Money ${smSignal.type.replace('_', ' ')}`

    const details: string[] = [
      `Confidence ${(smSignal.confidence * 100).toFixed(0)}%`,
      `Direction ${smSignal.direction.toUpperCase()}`
    ]
    if (smSignal.reasons.length) {
      details.push(smSignal.reasons[0])
    } else if (smSignal.warnings.length) {
      details.push(smSignal.warnings[0])
    }

    return [
      this.createAlert(
        snapshot,
        AlertCategory.SMART_SIGNAL,
        severity,
        title,
        details.join(' | ')
      )
    ].map((alert) => {
      alert.data.signalType = smSignal.type
      alert.data.confidence = smSignal.confidence
      return alert
    })
  }

  private createAlert(
    snapshot: TelemetrySnapshot,
    category: AlertCategory,
    severity: AlertSeverity,
    title: string,
    message: string,
    options?: { expiresInMs?: number }
  ): Alert {
    const alert: Alert = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      token: snapshot.token,
      category,
      severity,
      title,
      message,
      data: {},
      acknowledged: false,
      actions: []
    }

    if (options?.expiresInMs) {
      alert.expiresAt = new Date(Date.now() + options.expiresInMs)
    }

    return alert
  }
}


