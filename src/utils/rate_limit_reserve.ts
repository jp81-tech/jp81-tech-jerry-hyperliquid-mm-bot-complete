/**
 * Reserve Rate Limit for Hyperliquid
 *
 * Allows purchasing additional rate limit capacity for high-frequency trading.
 * Cost: $0.0005 USDC per request
 * No trading volume requirement
 */

export class RateLimitReserver {
  private exchClient: any
  private isEnabled: boolean
  private reservedRequests: number = 0

  constructor(exchClient: any, enabled: boolean = false) {
    this.exchClient = exchClient
    this.isEnabled = enabled
  }

  /**
   * Reserve additional rate limit capacity
   * @param numRequests Number of requests to reserve
   * @returns Success status
   */
  async reserveCapacity(numRequests: number): Promise<boolean> {
    if (!this.isEnabled) {
      console.log('⚠️  Rate limit reservation disabled in config')
      return false
    }

    try {
      const cost = numRequests * 0.0005
      console.log(`💰 Reserving ${numRequests} requests (cost: $${cost.toFixed(4)} USDC)`)

      const result = await this.exchClient.customAction({
        action: {
          type: 'reserveRequestWeight',
          numRequests
        }
      })

      if (result && result.status === 'ok') {
        this.reservedRequests += numRequests
        console.log(`✅ Reserved ${numRequests} requests (total: ${this.reservedRequests})`)
        return true
      } else {
        console.error('❌ Failed to reserve rate limit:', result)
        return false
      }
    } catch (error) {
      console.error('❌ Error reserving rate limit:', error)
      return false
    }
  }

  /**
   * Auto-reserve when approaching rate limit
   * @param currentUsage Current rate limit usage (0-1)
   * @param threshold Threshold to trigger reservation (default 0.8 = 80%)
   */
  async autoReserve(currentUsage: number, threshold: number = 0.8): Promise<void> {
    if (!this.isEnabled) return

    if (currentUsage >= threshold) {
      console.log(`⚠️  High rate limit usage: ${(currentUsage * 100).toFixed(0)}%`)
      // Reserve 100 additional requests
      await this.reserveCapacity(100)
    }
  }

  /**
   * Get total reserved requests
   */
  getReservedCount(): number {
    return this.reservedRequests
  }

  /**
   * Enable/disable rate limit reservation
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled
    console.log(`Rate limit reservation ${enabled ? 'enabled' : 'disabled'}`)
  }
}
