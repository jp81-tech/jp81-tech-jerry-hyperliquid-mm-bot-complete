export type ExecStats = {
  lastN: number
  success: number
  fail: number
  avgLatencyMs: number
}

export type ExecTuning = {
  orderUsdFactor: number
  maxConcurrent: number
  backoffMs: number
  makerSpreadFactor: number
}

export class ExecutionOptimizer {
  private minOrderFactor = 0.5
  private maxOrderFactor = 1.5
  private minSpreadFactor = 0.7
  private maxSpreadFactor = 1.4

  tune(stats: ExecStats, gasGwei?: number): ExecTuning {
    const total = Math.max(1, stats.lastN)
    const sr = stats.success / total
    let orderUsdFactor = 1.0
    let makerSpreadFactor = 1.0
    let maxConcurrent = 1
    let backoffMs = 800

    if (sr >= 0.8) {
      orderUsdFactor = 1.15
      makerSpreadFactor = 0.9
      maxConcurrent = 2
      backoffMs = 400
    } else if (sr >= 0.6) {
      orderUsdFactor = 1.0
      makerSpreadFactor = 1.0
      maxConcurrent = 1
      backoffMs = 650
    } else {
      orderUsdFactor = 0.8
      makerSpreadFactor = 1.1
      maxConcurrent = 1
      backoffMs = 1200
    }

    if (typeof gasGwei === "number" && gasGwei > 0) {
      if (gasGwei > 4) {
        orderUsdFactor = Math.max(this.minOrderFactor, orderUsdFactor * 0.85)
        makerSpreadFactor = Math.min(this.maxSpreadFactor, makerSpreadFactor * 1.1)
      } else if (gasGwei < 1.5) {
        orderUsdFactor = Math.min(this.maxOrderFactor, orderUsdFactor * 1.1)
        makerSpreadFactor = Math.max(this.minSpreadFactor, makerSpreadFactor * 0.95)
      }
    }

    return {
      orderUsdFactor: Number(orderUsdFactor.toFixed(2)),
      maxConcurrent,
      backoffMs,
      makerSpreadFactor: Number(makerSpreadFactor.toFixed(2)),
    }
  }
}
