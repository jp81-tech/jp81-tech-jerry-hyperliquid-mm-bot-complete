export class RateLimiter {
  private nextAllowedTime = 0;
  private readonly minInterval: number;

  constructor(requestsPerSecond: number = 2) {
    this.minInterval = 1000 / requestsPerSecond;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();
    const targetTime = Math.max(now, this.nextAllowedTime);
    this.nextAllowedTime = targetTime + this.minInterval;

    const wait = targetTime - now;
    if (wait > 0) {
      await this.sleep(wait);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

