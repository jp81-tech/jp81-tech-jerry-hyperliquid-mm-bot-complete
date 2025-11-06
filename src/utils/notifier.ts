export interface Notifier {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

export class ConsoleNotifier implements Notifier {
  info(msg: string){ console.log(`[INFO] ${msg}`) }
  warn(msg: string){ console.warn(`[WARN] ${msg}`) }
  error(msg: string){ console.error(`[ERROR] ${msg}`) }
}
