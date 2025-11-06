import { performance } from "perf_hooks"

export type LatencySnapshot = {
  ts: number
  rpc: { url: string; ms: number }[]
  venues: { name: string; ms: number }[]
}

export class LatencyMonitor {
  private rpcUrls: string[]
  private venueProbes: { name: string; url: string; method?: string }[]
  private history: LatencySnapshot[] = []
  private maxHistory = 60

  constructor(rpcUrls: string[], venueProbes: { name: string; url: string; method?: string }[]) {
    this.rpcUrls = rpcUrls
    this.venueProbes = venueProbes
  }

  private async probe(url: string, method = "POST", body?: any): Promise<number> {
    const t0 = performance.now()
    try {
      const r = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? JSON.stringify(body ?? { jsonrpc:"2.0", id:1, method:"eth_blockNumber", params:[] }) : undefined
      })
      await r.text()
      return Math.max(0, performance.now() - t0)
    } catch {
      return 9e9
    }
  }

  async tick(): Promise<LatencySnapshot> {
    const rpc = await Promise.all(this.rpcUrls.map(async url => ({ url, ms: await this.probe(url, "POST") })))
    const venues = await Promise.all(this.venueProbes.map(async v => ({ name: v.name, ms: await this.probe(v.url, v.method ?? "GET") })))
    const snap: LatencySnapshot = { ts: Date.now(), rpc, venues }
    this.history.push(snap)
    if (this.history.length > this.maxHistory) this.history.shift()
    return snap
  }

  getSummary() {
    const last = this.history[this.history.length - 1]
    const avg = <T extends { ms: number }>(arr: T[]) => Math.round(arr.reduce((s, x) => s + x.ms, 0) / Math.max(1, arr.length))
    const rpcAvg = last ? avg(last.rpc) : 0
    const venAvg = last ? avg(last.venues) : 0
    return { last, rpcAvg, venAvg }
  }

  suggestInterval(baseSec: number, maxSec: number) {
    const { rpcAvg, venAvg } = this.getSummary()
    const worst = Math.max(rpcAvg || 0, venAvg || 0)
    if (!worst || worst >= 5_000) return Math.min(maxSec, baseSec * 2)
    if (worst > 1_500) return Math.min(maxSec, Math.round(baseSec * 1.5))
    if (worst < 400) return Math.max(1, Math.round(baseSec * 0.7))
    return baseSec
  }
}
