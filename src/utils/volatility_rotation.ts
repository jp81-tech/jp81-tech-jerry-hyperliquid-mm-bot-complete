import fs from 'fs'
import { enforceAllowed } from "../selection/allowed.js";
import path from 'path'
import { HyperliquidAPI, VolatilityScore } from '../api/hyperliquid.js'

export type RotationState = {
  lastUpdate: number
  currentPairs: string[]
  history: { ts: number; pairs: string[]; reason: string }[]
}

export class VolatilityRotation {
  private api: HyperliquidAPI
  private stateFile: string
  private state: RotationState
  private minVolatility: number
  private rotationThreshold: number

  constructor(options: {
    stateFile?: string
    minVolatility?: number
    rotationThreshold?: number
  } = {}) {
    this.api = new HyperliquidAPI()
    this.stateFile = options.stateFile || path.join(process.cwd(), 'data/rotation_state.json')
    this.minVolatility = options.minVolatility || 2.0  // Min 2% volatility
    this.rotationThreshold = options.rotationThreshold || 1.5  // 1.5x score diff to rotate
    this.state = this.loadState()
  }

  private loadState(): RotationState {
    try {
      if (fs.existsSync(this.stateFile)) {
        return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'))
      }
    } catch (e) {}
    return {
      lastUpdate: 0,
      currentPairs: [],
      history: []
    }
  }

  private saveState() {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true })
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2))
  }

  async getTop3Pairs(): Promise<VolatilityScore[]> {
    const scores = await this.api.calculateVolatilityScores()
    
    // Filter: min volatility + exclude stablecoins
    const filtered = scores.filter(s => 
      s.volatility24h >= this.minVolatility &&
      !['USDC', 'USDT', 'DAI', 'BUSD'].includes(s.pair)
    )

    return filtered.slice(0, 3)  // Trade top 3 pairs by volatility
  }

  async shouldRotate(top3: VolatilityScore[]): Promise<{ rotate: boolean; reason: string }> {
    if (this.state.currentPairs.length === 0) {
      return { rotate: true, reason: 'Initial setup' }
    }

    const currentPairNames = this.state.currentPairs
    const newPairNames = top3.map(s => s.pair)

    // Check if any pair dropped out
    const droppedOut = currentPairNames.filter(p => !newPairNames.includes(p))
    if (droppedOut.length > 0) {
      return { rotate: true, reason: `Pairs dropped: ${droppedOut.join(', ')}` }
    }

    // Check if new pair has significantly better score
    const newPairs = newPairNames.filter(p => !currentPairNames.includes(p))
    if (newPairs.length > 0) {
      // Find lowest current pair score vs new pair score
      const currentScores = top3.filter(s => currentPairNames.includes(s.pair))
      const newScores = top3.filter(s => newPairs.includes(s.pair))
      
      if (newScores.length > 0 && currentScores.length > 0) {
        const lowestCurrent = Math.min(...currentScores.map(s => s.score))
        const highestNew = Math.max(...newScores.map(s => s.score))
        
        if (highestNew > lowestCurrent * this.rotationThreshold) {
          return { rotate: true, reason: `Better pairs available: ${newPairs.join(', ')}` }
        }
      }
    }

    return { rotate: false, reason: 'Current pairs still optimal' }
  }

  async rotate(): Promise<{ newPairs: string[]; scores: VolatilityScore[]; rotated: boolean; reason: string }> {
    const top3 = await this.getTop3Pairs()
    const decision = await this.shouldRotate(top3)

    if (decision.rotate) {
      this.state.currentPairs = top3.map(s => s.pair)
      this.state.lastUpdate = Date.now()
      this.state.history.push({
        ts: Date.now(),
        pairs: this.state.currentPairs,
        reason: decision.reason
      })
      
      // Keep last 100 history entries
      if (this.state.history.length > 100) {
        this.state.history = this.state.history.slice(-100)
      }

      this.saveState()
    }

    return {
      newPairs: this.state.currentPairs,
      scores: top3,
      rotated: decision.rotate,
      reason: decision.reason
    }
  }

  getCurrentPairs(): string[] {
    const baseDir = process.cwd();
    const filtered = enforceAllowed(baseDir, this.state.currentPairs);
    return filtered
  }

  getHistory() {
    return this.state.history
  }
}
