import { DiagnosticsLog } from '../types/telemetry.js'
import { Logger } from '../utils/logger.js'

export class DiagnosticsLogger {
  private logs: DiagnosticsLog[] = []
  private readonly logger: Logger

  constructor(logger = new Logger()) {
    this.logger = logger
  }

  record(log: DiagnosticsLog): void {
    this.logs.push(log)
    if (this.logs.length > 1000) {
      this.logs.shift()
    }
    const label = log.event ?? 'diagnostic'
    if (log.level === 'WARN') {
      this.logger.warn(`${log.token} | ${label}: ${log.message}`)
    } else if (log.level === 'ERROR') {
      this.logger.error(`${log.token} | ${label}: ${log.message}`)
    } else if (log.level === 'INFO') {
      this.logger.info(`${log.token} | ${label}: ${log.message}`)
    }
  }

  getLogs(): DiagnosticsLog[] {
    return [...this.logs]
  }
}


