import { TelemetrySnapshot, PerformanceMetrics, DiagnosticsLog } from '../types/telemetry.js'
import { MetricsAggregator } from './MetricsAggregator.js'
import { PerformanceTracker } from './PerformanceTracker.js'
import { DiagnosticsLogger } from './DiagnosticsLogger.js'

export class TelemetryCollector {
  private readonly aggregator: MetricsAggregator
  private readonly performance: PerformanceTracker
  private readonly diagnostics: DiagnosticsLogger

  constructor(
    aggregator = new MetricsAggregator(),
    performance = new PerformanceTracker(),
    diagnostics = new DiagnosticsLogger()
  ) {
    this.aggregator = aggregator
    this.performance = performance
    this.diagnostics = diagnostics
  }

  recordSnapshot(snapshot: TelemetrySnapshot): void {
    this.aggregator.record(snapshot)
  }

  recordPerformance(metrics: PerformanceMetrics): void {
    this.performance.record(metrics)
  }

  recordDiagnostics(log: DiagnosticsLog): void {
    this.diagnostics.record(log)
  }

  getLatestSnapshot(token: string): TelemetrySnapshot | undefined {
    return this.aggregator.getLatest(token)
  }
}



