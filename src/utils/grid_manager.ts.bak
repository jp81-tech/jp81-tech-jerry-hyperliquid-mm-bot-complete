/**
 * Institutional Multi-Layer Grid Manager
 *
 * Implements professional market making with 5-layer order book structure:
 * - L1-L3: Active layers (front-line quoting)
 * - L4-L5: Parking layers (activated on large moves)
 */

export type GridLayer = {
  level: number              // 1-5
  offsetBps: number          // Distance from mid (±20, ±30, ±45, ±65, ±90)
  capitalPct: number         // Percentage of capital (25, 30, 25, 15, 5)
  ordersPerSide: number      // Number of orders per side (2, 2, 2, 1, 1)
  isActive: boolean          // True for L1-L3, false for L4-L5 (parking)
}

export type GridOrder = {
  layer: number
  side: 'bid' | 'ask'
  price: number
  sizeUsd: number
  units: number
}

export class GridManager {
  private layers: GridLayer[] = [
    { level: 1, offsetBps: 20, capitalPct: 25, ordersPerSide: 2, isActive: true },
    { level: 2, offsetBps: 30, capitalPct: 30, ordersPerSide: 2, isActive: true },
    { level: 3, offsetBps: 45, capitalPct: 25, ordersPerSide: 2, isActive: true },
    { level: 4, offsetBps: 65, capitalPct: 15, ordersPerSide: 1, isActive: false }, // Parking
    { level: 5, offsetBps: 90, capitalPct: 5, ordersPerSide: 1, isActive: false }   // Parking
  ]

  private config = {
    enableMultiLayer: process.env.ENABLE_MULTI_LAYER === 'true',
    numLayers: parseInt(process.env.NUM_LAYERS || '5'),
    activeLayers: parseInt(process.env.ACTIVE_LAYERS || '3'),
    driftTriggerBps: parseFloat(process.env.DRIFT_TRIGGER_BPS || '6'),
    parkingActivationBps: parseFloat(process.env.PARKING_ACTIVATION_BPS || '25')
  }

  constructor() {
    // Override layers from env if configured
    if (process.env.LAYER_CAPITAL_PCT) {
      const capitalPcts = process.env.LAYER_CAPITAL_PCT.split(',').map(p => parseInt(p))
      const offsets = process.env.LAYER_OFFSETS_BPS?.split(',').map(p => parseInt(p)) || [20, 30, 45, 65, 90]

      if (capitalPcts.length === 5 && offsets.length === 5) {
        for (let i = 0; i < 5; i++) {
          this.layers[i].capitalPct = capitalPcts[i]
          this.layers[i].offsetBps = offsets[i]
        }
      }
    }

    // Set active layers based on ACTIVE_LAYERS environment variable
    for (let i = 0; i < 5; i++) {
      this.layers[i].isActive = (i < this.config.activeLayers)
    }
  }

  /**
   * Generate all grid orders for a given symbol
   */
  generateGridOrders(
    symbol: string,
    midPrice: number,
    capitalPerPair: number,
    minOrderSize: number = 0.001,
    inventorySkew: number = 0 // -1 to 1 (negative = net short, positive = net long)
  ): GridOrder[] {
    if (!this.config.enableMultiLayer) {
      return [] // Fallback to legacy single-layer
    }

    const orders: GridOrder[] = []

    for (const layer of this.layers) {
      // Skip parking layers if not activated
      if (!layer.isActive && !this.shouldActivateParkingLayer(inventorySkew)) {
        continue
      }

      // Calculate layer capital allocation
      const layerCapital = (capitalPerPair * layer.capitalPct) / 100
      const orderSizeUsd = layerCapital / (layer.ordersPerSide * 2) // Divide by 2 for bid/ask

      // Apply inventory skew adjustment
      const bidOffsetBps = layer.offsetBps + this.getInventoryAdjustment(inventorySkew, 'bid')
      const askOffsetBps = layer.offsetBps + this.getInventoryAdjustment(inventorySkew, 'ask')

      // Generate bid orders (stagger prices to avoid duplicates)
      for (let i = 0; i < layer.ordersPerSide; i++) {
        // Stagger by 2 bps per order to ensure different ticks after rounding (e.g., 20, 22, 24 bps)
        const staggerBps = i * 2
        const bidPrice = midPrice * (1 - (bidOffsetBps + staggerBps) / 10000)
        const units = orderSizeUsd / bidPrice

        if (units * bidPrice >= minOrderSize) {
          orders.push({
            layer: layer.level,
            side: 'bid',
            price: bidPrice,
            sizeUsd: orderSizeUsd,
            units: units
          })
        }
      }

      // Generate ask orders (stagger prices to avoid duplicates)
      for (let i = 0; i < layer.ordersPerSide; i++) {
        // Stagger by 2 bps per order to ensure different ticks after rounding
        const staggerBps = i * 2
        const askPrice = midPrice * (1 + (askOffsetBps + staggerBps) / 10000)
        const units = orderSizeUsd / askPrice

        if (units * askPrice >= minOrderSize) {
          orders.push({
            layer: layer.level,
            side: 'ask',
            price: askPrice,
            sizeUsd: orderSizeUsd,
            units: units
          })
        }
      }
    }

    return orders
  }

  /**
   * Check if we should reprice orders based on price drift
   */
  shouldReprice(currentMid: number, lastMid: number): boolean {
    const driftBps = Math.abs((currentMid - lastMid) / lastMid) * 10000
    return driftBps >= this.config.driftTriggerBps
  }

  /**
   * Calculate inventory skew adjustment (±10 bps per 15% skew)
   */
  private getInventoryAdjustment(skew: number, side: 'bid' | 'ask'): number {
    const skewThreshold = 0.15 // 15% skew

    if (Math.abs(skew) < skewThreshold) {
      return 0 // No adjustment
    }

    // If net long (skew > 0), widen bids, narrow asks
    // If net short (skew < 0), narrow bids, widen asks
    const adjustmentBps = (skew / skewThreshold) * 10 // ±10 bps per 15% skew

    return side === 'bid'
      ? adjustmentBps      // Positive skew = widen bids (+10 bps)
      : -adjustmentBps     // Positive skew = narrow asks (-10 bps)
  }

  /**
   * Determine if parking layers should be activated
   */
  private shouldActivateParkingLayer(inventorySkew: number): boolean {
    // Activate parking layers if:
    // 1. High inventory imbalance (>20%)
    // 2. Large price movement (handled externally via drift trigger)
    return Math.abs(inventorySkew) > 0.20
  }

  /**
   * Get active layers for current market conditions
   */
  getActiveLayers(): GridLayer[] {
    return this.layers.filter(l => l.isActive)
  }

  /**
   * Get all layers (including parking)
   */
  getAllLayers(): GridLayer[] {
    return this.layers
  }

  /**
   * Calculate total notional for a symbol (all layers combined)
   */
  calculateTotalNotional(capitalPerPair: number): number {
    const activeLayers = this.layers.filter(l => l.isActive || this.shouldActivateParkingLayer(0))
    const totalPct = activeLayers.reduce((sum, l) => sum + l.capitalPct, 0)
    return (capitalPerPair * totalPct) / 100
  }

  /**
   * Get summary of grid structure
   */
  getSummary(): string {
    const active = this.layers.filter(l => l.isActive)
    const parking = this.layers.filter(l => !l.isActive)

    return `Grid: ${active.length} active layers (L1-L${active.length}), ${parking.length} parking layers`
  }
}
