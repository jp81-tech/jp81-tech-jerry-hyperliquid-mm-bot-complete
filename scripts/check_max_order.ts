import { config } from 'dotenv'
config()
import * as hl from '@nktkas/hyperliquid'

const info = new hl.InfoClient({ url: 'https://api.hyperliquid.xyz/info' })

const pairs = ['HMSTR', 'BOME', 'TURBO', 'XPL', 'UMA', 'BTC']

info.meta().then(meta => {
  pairs.forEach(p => {
    const u = meta.universe.find(x => x.name === p)
    if (u) {
      console.log(`${p}: szDecimals=${u.szDecimals}`)
    }
  })
}).catch(e => console.error(e))
