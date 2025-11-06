import WebSocket from 'ws'

export type L2BookUpdate = {
  coin: string
  levels: [[string, string][], [string, string][]] // [asks, bids]
  time: number
}

export type UserFillUpdate = {
  coin: string
  px: string
  sz: string
  side: string
  time: number
  fee: string
  oid: number
  cloid?: string
}

export type WebSocketMessage =
  | { channel: 'l2Book'; data: L2BookUpdate }
  | { channel: 'user'; data: { fills: UserFillUpdate[] } }

export class HyperliquidWebSocket {
  private ws: WebSocket | null = null
  private url: string
  private subscriptions: Map<string, Set<(data: any) => void>> = new Map()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectDelay = 1000 // Start with 1s
  private heartbeatInterval: NodeJS.Timeout | null = null
  private isConnecting = false

  constructor(isTestnet = false) {
    this.url = isTestnet
      ? 'wss://api.hyperliquid-testnet.xyz/ws'
      : 'wss://api.hyperliquid.xyz/ws'
  }

  async connect(): Promise<void> {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return
    }

    this.isConnecting = true

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url)

        this.ws.on('open', () => {
          console.log('✅ WebSocket connected to Hyperliquid')
          this.isConnecting = false
          this.reconnectAttempts = 0
          this.reconnectDelay = 1000
          this.startHeartbeat()
          resolve()
        })

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString()) as WebSocketMessage
            this.handleMessage(message)
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error)
          }
        })

        this.ws.on('error', (error: Error) => {
          console.error('WebSocket error:', error)
          this.isConnecting = false
          reject(error)
        })

        this.ws.on('close', () => {
          console.log('WebSocket closed, attempting reconnect...')
          this.isConnecting = false
          this.stopHeartbeat()
          this.attemptReconnect()
        })
      } catch (error) {
        this.isConnecting = false
        reject(error)
      }
    })
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached')
      return
    }

    this.reconnectAttempts++
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000)

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

    setTimeout(() => {
      this.connect().catch(console.error)
    }, delay)
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping()
      }
    }, 30000) // Ping every 30s
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  subscribeL2Book(coin: string, callback: (data: L2BookUpdate) => void): void {
    const key = `l2Book:${coin}`
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set())
    }
    this.subscriptions.get(key)!.add(callback)

    // Send subscription message
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        method: 'subscribe',
        subscription: {
          type: 'l2Book',
          coin
        }
      }))
    }
  }

  subscribeUserFills(user: string, callback: (data: UserFillUpdate[]) => void): void {
    const key = `user:${user}`
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set())
    }
    this.subscriptions.get(key)!.add(callback)

    // Send subscription message
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        method: 'subscribe',
        subscription: {
          type: 'user',
          user
        }
      }))
    }
  }

  private handleMessage(message: WebSocketMessage): void {
    if (message.channel === 'l2Book') {
      const key = `l2Book:${message.data.coin}`
      const callbacks = this.subscriptions.get(key)
      if (callbacks) {
        callbacks.forEach(cb => cb(message.data))
      }
    } else if (message.channel === 'user' && message.data.fills) {
      // Find user subscription
      for (const [key, callbacks] of this.subscriptions.entries()) {
        if (key.startsWith('user:')) {
          callbacks.forEach(cb => cb(message.data.fills))
        }
      }
    }
  }

  unsubscribe(coin: string, type: 'l2Book' | 'user'): void {
    const key = `${type}:${coin}`
    this.subscriptions.delete(key)

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        method: 'unsubscribe',
        subscription: {
          type,
          coin: type === 'l2Book' ? coin : undefined,
          user: type === 'user' ? coin : undefined
        }
      }))
    }
  }

  disconnect(): void {
    this.stopHeartbeat()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.subscriptions.clear()
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }
}
