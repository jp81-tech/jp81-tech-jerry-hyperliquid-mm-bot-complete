export type HealthSnapshot = {
  ts: number
  ethBalance: number
  usdcBalance?: number
  venueOk: boolean
  rpcOk: boolean
  errorRate1h: number
  staleDataSec?: number
}

export class HealthChecker {
  private errWindow: number[] = []
  private maxErrs = 3600
  private cfg = {
    minEth: Number(process.env.MIN_ETH_BALANCE || 0.002),
    maxErrorRate: Number(process.env.MAX_ERROR_RATE || 0.25),
    maxStaleSec: Number(process.env.MAX_STALE_SEC || 30),
  }

  pushError(ok: boolean) {
    this.errWindow.push(ok ? 0 : 1)
    if (this.errWindow.length > this.maxErrs) this.errWindow.shift()
  }

  getErrorRate() {
    if (!this.errWindow.length) return 0
    const s = this.errWindow.reduce((a, b) => a + b, 0)
    return s / this.errWindow.length
  }

  evaluate(s: HealthSnapshot) {
    const alerts: string[] = []
    if (s.ethBalance < this.cfg.minEth) alerts.push(`Low gas: ${s.ethBalance} ETH < ${this.cfg.minEth}`)
    if (!s.venueOk) alerts.push("Venue unreachable")
    if (!s.rpcOk) alerts.push("RPC unhealthy")
    if (s.staleDataSec && s.staleDataSec > this.cfg.maxStaleSec) alerts.push(`Stale data ${s.staleDataSec}s`)
    const er = this.getErrorRate()
    if (er > this.cfg.maxErrorRate) alerts.push(`High error rate ${(er*100).toFixed(1)}%`)
    const severity = alerts.length >= 2 ? "CRITICAL" : (alerts.length === 1 ? "WARN" : "OK")
    return { severity, alerts }
  }
}
