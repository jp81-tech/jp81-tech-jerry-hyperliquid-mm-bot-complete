import { PerformanceMetrics } from '../types/telemetry.js'

export class PerformanceTracker {
  private history: PerformanceMetrics[] = []

  record(metrics: PerformanceMetrics): void {
    this.history.push(metrics)
    if (this.history.length > 500) {
      this.history.shift()
    }
  }

  getHistory(): PerformanceMetrics[] {
    return [...this.history]
  }
}



