import { Alert } from '../types/alerts.js'
import { ConsoleNotifier } from '../utils/notifier.js'

export class NotificationService {
  constructor(private readonly notifier = new ConsoleNotifier()) {}

  send(alert: Alert): void {
    const prefix = `🚨 [${alert.severity}] [${alert.token}] ${alert.title}`
    this.notifier.info(`${prefix} | ${alert.message}`)
  }
}



