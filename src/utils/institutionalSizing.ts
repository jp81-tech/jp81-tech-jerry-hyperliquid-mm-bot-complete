/**
 * Institutional Sizing Engine
 * 
 * Professional MM desk sizing with:
 * - Per-pair clip configuration
 * - Layer progression (bigger clips at deeper layers)
 * - Exposure caps per side
 */

export interface InstitutionalSizingConfig {
  baseClipUsd: number
  maxLayersPerSide: number
  maxExposurePerSideUsd: number
}

export interface SizingResult {
  sizeUsd: number
  units: number
  scaledFromBase: boolean
  cappedByExposure: boolean
  reason?: string
}

const DEFAULT_LAYER_MULTIPLIER = 1.25

export function getInstitutionalConfig(pair: string): InstitutionalSizingConfig | null {
  const pairUpper = pair.toUpperCase()
  
  const baseClipKey = pairUpper + "_BASE_CLIP_USD"
  const maxLayersKey = pairUpper + "_MAX_LAYERS_PER_SIDE"
  const maxExposureKey = pairUpper + "_MAX_EXPOSURE_PER_SIDE_USD"
  
  const baseClip = process.env[baseClipKey]
  const maxLayers = process.env[maxLayersKey]
  const maxExposure = process.env[maxExposureKey]
  
  if (!baseClip || !maxLayers || !maxExposure) {
    return null
  }
  
  return {
    baseClipUsd: Number(baseClip),
    maxLayersPerSide: Number(maxLayers),
    maxExposurePerSideUsd: Number(maxExposure),
  }
}

export function calculateInstitutionalClip(
  pair: string,
  layer: number,
  currentSideExposure: number
): SizingResult | null {
  const config = getInstitutionalConfig(pair)
  
  if (!config) {
    return null
  }
  
  const remainingExposure = config.maxExposurePerSideUsd - currentSideExposure
  
  if (remainingExposure <= 0) {
    const expStr = currentSideExposure.toFixed(0)
    const maxStr = config.maxExposurePerSideUsd.toString()
    return {
      sizeUsd: 0,
      units: 0,
      scaledFromBase: false,
      cappedByExposure: true,
      reason: "Exposure cap reached (" + expStr + "/" + maxStr + ")",
    }
  }
  
  const layerMultiplier = Number(process.env.INSTITUTIONAL_LAYER_MULTIPLIER ?? DEFAULT_LAYER_MULTIPLIER)
  const layerScale = Math.pow(layerMultiplier, layer)
  
  let targetClipUsd = config.baseClipUsd * layerScale
  let cappedByExposure = false
  
  if (targetClipUsd > remainingExposure) {
    targetClipUsd = remainingExposure
    cappedByExposure = true
  }
  
  return {
    sizeUsd: targetClipUsd,
    units: 0,
    scaledFromBase: true,
    cappedByExposure,
  }
}

export class ExposureTracker {
  private exposure: Map<string, { buy: number; sell: number }> = new Map()
  
  getExposure(pair: string, side: "buy" | "sell"): number {
    const pairExp = this.exposure.get(pair)
    if (!pairExp) return 0
    return pairExp[side]
  }
  
  addExposure(pair: string, side: "buy" | "sell", amount: number): void {
    if (!this.exposure.has(pair)) {
      this.exposure.set(pair, { buy: 0, sell: 0 })
    }
    const pairExp = this.exposure.get(pair)!
    pairExp[side] += amount
  }
  
  reset(pair?: string): void {
    if (pair) {
      this.exposure.set(pair, { buy: 0, sell: 0 })
    } else {
      this.exposure.clear()
    }
  }
}
