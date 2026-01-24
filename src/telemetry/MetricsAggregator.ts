import { TelemetrySnapshot } from '../types/telemetry.js'

export class MetricsAggregator {
  private latest: Map<string, TelemetrySnapshot> = new Map()

  record(snapshot: TelemetrySnapshot): void {
    this.latest.set(snapshot.token, snapshot)
  }

  getLatest(token: string): TelemetrySnapshot | undefined {
    return this.latest.get(token)
  }
}



