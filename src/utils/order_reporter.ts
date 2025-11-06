import { ConsoleNotifier } from './notifier.js'

export type OrderHistoryEntry = {
  cloid: string
  oid?: string
  pair: string
  side: 'buy' | 'sell'
  price: number
  size: number
  timestamp: number
  status: 'placed' | 'modified' | 'cancelled' | 'filled' | 'rejected'
  method: 'place' | 'batchModify' | 'cancel'
}

export type OrderStats = {
  total: number
  placed: number
  modified: number
  cancelled: number
  filled: number
  rejected: number
  byPair: Record<string, number>
}

export class OrderReporter {
  private notifier: ConsoleNotifier
  private reportTimes: number[] = [8, 12, 18, 20] // Hours for reports (UTC)
  private lastReportHour: number = -1

  constructor(notifier: ConsoleNotifier) {
    this.notifier = notifier
  }

  /**
   * Check if it's time to send a report
   */
  shouldSendReport(): boolean {
    const now = new Date()
    const currentHour = now.getUTCHours()

    // Check if we're at a report time and haven't sent yet this hour
    if (this.reportTimes.includes(currentHour) && this.lastReportHour !== currentHour) {
      this.lastReportHour = currentHour
      return true
    }

    return false
  }

  /**
   * Generate formatted order report
   */
  generateReport(orders: OrderHistoryEntry[], stats: OrderStats, sinceHours: number = 4): string {
    const now = Date.now()
    const sinceTime = now - (sinceHours * 60 * 60 * 1000)
    const recentOrders = orders.filter(o => o.timestamp >= sinceTime)

    let report = `
═══════════════════════════════════════════════════════════
📊 ORDER REPORT - ${new Date().toUTCString()}
═══════════════════════════════════════════════════════════

📈 SUMMARY (Last ${sinceHours}h):
   Total Orders: ${stats.total}
   ✅ Placed:    ${stats.placed}
   🔄 Modified:  ${stats.modified}
   ✔️  Filled:    ${stats.filled}
   ❌ Cancelled: ${stats.cancelled}
   ⚠️  Rejected:  ${stats.rejected}

📊 BY PAIR:
`

    // Sort pairs by activity
    const sortedPairs = Object.entries(stats.byPair).sort((a, b) => b[1] - a[1])
    for (const [pair, count] of sortedPairs) {
      report += `   ${pair.padEnd(10)} ${count} orders\n`
    }

    report += `\n🔍 RECENT ORDERS (Last 20):\n`

    // Show last 20 orders
    const last20 = recentOrders.slice(-20).reverse()
    for (const order of last20) {
      const time = new Date(order.timestamp).toISOString().substring(11, 19)
      const statusEmoji = this.getStatusEmoji(order.status)
      const methodEmoji = order.method === 'batchModify' ? '🔄' : order.method === 'place' ? '➕' : '❌'

      report += `   ${time} ${statusEmoji} ${methodEmoji} ${order.pair.padEnd(6)} ${order.side === 'buy' ? 'BUY ' : 'SELL'} @$${order.price.toFixed(4)} | cloid: ${order.cloid.substring(0, 16)}...\n`
    }

    report += `\n═══════════════════════════════════════════════════════════\n`

    return report
  }

  private getStatusEmoji(status: string): string {
    switch (status) {
      case 'placed': return '✅'
      case 'modified': return '🔄'
      case 'filled': return '✔️'
      case 'cancelled': return '❌'
      case 'rejected': return '⚠️'
      default: return '❓'
    }
  }

  /**
   * Send report via notifier (console + Telegram)
   */
  async sendReport(orders: OrderHistoryEntry[], stats: OrderStats): Promise<void> {
    const report = this.generateReport(orders, stats)
    this.notifier.info(report)
  }
}
