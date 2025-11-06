import { LatencyMonitor } from "./latencyMonitor.js"
import { ExecutionOptimizer } from "./executionOptimizer.js"
import { HealthChecker } from "./healthChecker.js"
import { ConsoleNotifier, Notifier } from "../utils/notifier.js"

export type SupervisorHooks = {
  getExecStats: () => Promise<{ lastN: number; success: number; fail: number; avgLatencyMs: number }>
  getBalances: () => Promise<{ eth: number; usdc?: number }>
  getStaleSec: () => Promise<number>
  pingVenue: () => Promise<boolean>
  pingRpc: () => Promise<boolean>
  applyTuning: (t: { orderUsdFactor: number; maxConcurrent: number; backoffMs: number; makerSpreadFactor: number }) => Promise<void>
  setIntervalSec: (sec: number) => void
  onKillSwitch?: () => Promise<void>
}

export class Supervisor {
  private latency: LatencyMonitor
  private optimizer: ExecutionOptimizer
  private health: HealthChecker
  private hooks: SupervisorHooks
  private notify: Notifier
  private baseInterval: number
  private maxInterval: number

  constructor(args: {
    rpcUrls: string[]
    venueProbes: { name: string; url: string; method?: string }[]
    hooks: SupervisorHooks
    baseIntervalSec?: number
    maxIntervalSec?: number
    notifier?: Notifier
  }) {
    this.latency = new LatencyMonitor(args.rpcUrls, args.venueProbes)
    this.optimizer = new ExecutionOptimizer()
    this.health = new HealthChecker()
    this.hooks = args.hooks
    this.notify = args.notifier ?? new ConsoleNotifier()
    this.baseInterval = args.baseIntervalSec ?? Number(process.env.MM_INTERVAL_SEC || 20)
    this.maxInterval = args.maxIntervalSec ?? 45
  }

  async tick() {
    const snap = await this.latency.tick()
    const stats = await this.hooks.getExecStats()
    const balances = await this.hooks.getBalances()
    const stale = await this.hooks.getStaleSec()
    const venueOk = await this.hooks.pingVenue()
    const rpcOk = await this.hooks.pingRpc()
    this.health.pushError(venueOk && rpcOk)

    const gasGwei = Number(process.env.LAST_GAS_GWEI || "0")
    const tuning = this.optimizer.tune(stats, isFinite(gasGwei) ? gasGwei : undefined)
    await this.hooks.applyTuning(tuning)

    const nextInt = this.latency.suggestInterval(this.baseInterval, this.maxInterval)
    this.hooks.setIntervalSec(nextInt)

    const healthEval = this.health.evaluate({
      ts: Date.now(),
      ethBalance: balances.eth,
      usdcBalance: balances.usdc,
      venueOk, rpcOk,
      errorRate1h: this.health.getErrorRate(),
      staleDataSec: stale,
    })

    if (healthEval.severity === "CRITICAL") {
      this.notify.error(`CRITICAL ${healthEval.alerts.join(" | ")}`)
      if (this.hooks.onKillSwitch) await this.hooks.onKillSwitch()
    } else if (healthEval.severity === "WARN") {
      this.notify.warn(`WARN ${healthEval.alerts.join(" | ")}`)
    }

    return { snap, tuning, healthEval }
  }
}
